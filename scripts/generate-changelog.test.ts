import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generate } from "./generate-changelog.mjs";
import type { ReleaseEntry } from "../src/changelog";

// These exercise the half that a string-rewriting test can't reach: reading
// the version, finding the previous tag, walking real git history, and writing
// the file back. Each case gets a throwaway repository, so the assertions are
// about what the generator does to a real repo rather than a mock of one.

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trimEnd();

/** A repo with one tagged release, so a new one can be measured against it. */
function makeRepo(version: string, seed: ReleaseEntry[] = []): string {
  const root = mkdtempSync(join(tmpdir(), "changelog-test-"));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "Test");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "commit.gpgsign", "false");

  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "manifest.json"), JSON.stringify({ version }, null, 2));
  writeFileSync(join(root, "src", "changelog.json"), `${JSON.stringify(seed, null, 2)}\n`);

  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "chore: initial commit");
  git(root, "tag", "1.0.0");
  return root;
}

const bump = (root: string, version: string) => {
  writeFileSync(join(root, "manifest.json"), JSON.stringify({ version }, null, 2));
};

const commit = (root: string, subject: string) => {
  writeFileSync(join(root, "scratch.txt"), subject);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", subject);
};

const readEntries = (root: string): ReleaseEntry[] =>
  JSON.parse(readFileSync(join(root, "src", "changelog.json"), "utf8"));

/** What GitHub Actions puts in the environment of every step, which is where
 *  the compare link on a release body comes from. */
const actionsEnv = { GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "o/r" };

describe("generate", () => {
  let root: string;
  const quiet = () => {};

  beforeEach(() => {
    root = makeRepo("1.0.0");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("writes an entry for the version in manifest.json", () => {
    bump(root, "1.1.0");
    commit(root, "feat: add a table border color");

    generate({ root, log: quiet });

    const entries = readEntries(root);
    expect(entries[0].version).toBe("1.1.0");
    expect(entries[0].changes).toEqual(["Added a table border color."]);
  });

  it("only counts commits made since the last tag", () => {
    // The failure this guards: measuring from the wrong point re-announces
    // every change the plugin ever made as the newest release's news.
    bump(root, "1.1.0");
    commit(root, "feat: add a table border color");

    generate({ root, log: quiet });

    expect(readEntries(root)[0].changes).toHaveLength(1);
  });

  it("leaves the tagged release's own entry out of the new one", () => {
    bump(root, "1.1.0");
    commit(root, "chore: bump version to 1.1.0");

    generate({ root, log: quiet });

    // Only the version bump, which is internal, so nothing to report.
    expect(readEntries(root)[0].changes).toEqual([]);
  });

  it("stamps the date of the newest commit", () => {
    bump(root, "1.1.0");
    commit(root, "feat: add a table border color");
    const expected = git(root, "log", "-1", "--format=%cs");

    generate({ root, log: quiet });

    expect(readEntries(root)[0].date).toBe(expected);
  });

  it("keeps the previous entries below the new one", () => {
    rmSync(root, { recursive: true, force: true });
    root = makeRepo("1.1.0", [{ version: "1.0.0", date: "2026-01-01", changes: ["Added a thing."] }]);
    commit(root, "feat: add another thing");

    generate({ root, log: quiet });

    expect(readEntries(root).map((e) => e.version)).toEqual(["1.1.0", "1.0.0"]);
  });

  it("does not write a second entry for a version it already has", () => {
    // What a re-run of a failed release looks like.
    bump(root, "1.1.0");
    commit(root, "feat: add a table border color");
    generate({ root, log: quiet });
    commit(root, "fix: a thing that should not appear twice");

    generate({ root, log: quiet });

    const entries = readEntries(root);
    expect(entries.filter((e) => e.version === "1.1.0")).toHaveLength(1);
    expect(entries[0].changes).toEqual(["Added a table border color."]);
  });

  it("trims the file to the cap when the history is longer", () => {
    rmSync(root, { recursive: true, force: true });
    const seed = Array.from({ length: 10 }, (_, i) => ({
      version: `0.${10 - i}.0`,
      date: "2026-01-01",
      changes: [],
    }));
    root = makeRepo("1.1.0", seed);
    commit(root, "feat: add a thing");

    generate({ root, log: quiet });

    const entries = readEntries(root);
    expect(entries).toHaveLength(10);
    expect(entries[0].version).toBe("1.1.0");
    // The oldest entry falls off the end, rather than the file growing.
    expect(entries.at(-1)?.version).toBe("0.2.0");
    expect(entries.map((e) => e.version)).not.toContain("0.1.0");
  });

  it("writes a file the generator can read back", () => {
    // A trailing comma or a stray key would make the plugin's own import fail,
    // and the plugin only finds out at bundle time.
    bump(root, "1.1.0");
    commit(root, "feat: add a \"quoted\" thing, with a comma");

    generate({ root, log: quiet });

    const raw = readFileSync(join(root, "src", "changelog.json"), "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(readEntries(root)[0].changes).toEqual(['Added a "quoted" thing, with a comma.']);
  });

  it("reports the subjects it could not read", () => {
    bump(root, "1.1.0");
    commit(root, "feat: add a table border color");
    commit(root, "optimize mathjax rendering delay");

    const { skipped, unreadable } = generate({ root, log: quiet });

    // "optimize mathjax rendering delay" is a real change to the plugin that
    // will reach no user, so it is reported rather than quietly dropped.
    expect(skipped).toEqual([]);
    expect(unreadable).toEqual([
      { subject: "optimize mathjax rendering delay", reason: "no conventional prefix" },
    ]);
  });

  it("keeps internal commits out of both lists", () => {
    bump(root, "1.1.0");
    commit(root, "feat: add a table border color");
    commit(root, "chore: bump version to 1.1.0");
    commit(root, "Update main.ts");

    const { skipped, unreadable } = generate({ root, log: quiet });

    // Newest first, the order git log returns them in.
    expect(skipped).toEqual(["Update main.ts", "chore: bump version to 1.1.0"]);
    expect(unreadable).toEqual([]);
  });

  it("does not touch the file in dry-run mode", () => {
    bump(root, "1.1.0");
    commit(root, "feat: add a table border color");
    const before = readFileSync(join(root, "src", "changelog.json"), "utf8");

    const { entry } = generate({ root, dryRun: true, log: quiet });

    expect(readFileSync(join(root, "src", "changelog.json"), "utf8")).toBe(before);
    expect(entry.version).toBe("1.1.0");
  });

  it("writes the release body only when asked for one", () => {
    // A local `changelog:dry` must not leave a file lying around.
    bump(root, "1.1.0");
    commit(root, "feat: add a table border color");

    generate({ root, log: quiet });

    expect(existsSync(join(root, "release-notes.md"))).toBe(false);
  });

  it("writes a release body from the same entry the plugin shows", () => {
    bump(root, "1.1.0");
    commit(root, "feat: add a table border color");
    commit(root, "fix: keep the header border from doubling");

    generate({ root, log: quiet, notesFile: "release-notes.md", env: actionsEnv });

    // Same sentences as the stored entry, so the release page and the in-app
    // notes cannot say different things. Newest first, as git log returns them.
    expect(readFileSync(join(root, "release-notes.md"), "utf8")).toBe(
      "- Fixed the header border from doubling.\n" +
        "- Added a table border color.\n\n" +
        "**Full Changelog**: https://github.com/o/r/compare/1.0.0...1.1.0\n",
    );
  });

  it("leaves the compare link out when it is not running under Actions", () => {
    bump(root, "1.1.0");
    commit(root, "feat: add a table border color");

    generate({ root, log: quiet, notesFile: "release-notes.md", env: {} });

    expect(readFileSync(join(root, "release-notes.md"), "utf8")).toBe(
      "- Added a table border color.\n",
    );
  });

  it("still writes the release body when re-run after the tag moved", () => {
    // The failure this guards: a release that failed after tagging and was
    // re-run would measure from its own tag, see no commits, and publish a
    // release claiming it changed nothing.
    bump(root, "1.1.0");
    commit(root, "feat: add a table border color");
    generate({ root, log: quiet, notesFile: "release-notes.md", env: actionsEnv });
    git(root, "tag", "1.1.0");

    rmSync(join(root, "release-notes.md"));
    generate({ root, log: quiet, notesFile: "release-notes.md", env: actionsEnv });

    expect(readFileSync(join(root, "release-notes.md"), "utf8")).toContain(
      "- Added a table border color.",
    );
  });

  it("does not write a release body in dry-run mode", () => {
    bump(root, "1.1.0");
    commit(root, "feat: add a table border color");

    generate({ root, dryRun: true, log: quiet, notesFile: "release-notes.md", env: actionsEnv });

    expect(existsSync(join(root, "release-notes.md"))).toBe(false);
  });

  it("reports a release with no user-facing changes rather than shipping a blank page", () => {
    bump(root, "1.1.0");
    commit(root, "chore: bump version to 1.1.0");

    generate({ root, log: quiet, notesFile: "release-notes.md", env: actionsEnv });

    expect(readFileSync(join(root, "release-notes.md"), "utf8")).toBe(
      "_This release has no user-facing changes._\n\n" +
        "**Full Changelog**: https://github.com/o/r/compare/1.0.0...1.1.0\n",
    );
  });

  it("refuses to guess when the previous tag is not visible", () => {
    // The failure that would otherwise be silent and wrong: a shallow clone
    // cannot see the tag, and falling back to all of history would put every
    // change the plugin ever made into this release's notes.
    bump(root, "1.1.0");
    commit(root, "feat: add a table border color");
    const before = readFileSync(join(root, "src", "changelog.json"), "utf8");

    expect(() => generate({ root, log: quiet })).not.toThrow();

    rmSync(root, { recursive: true, force: true });
    root = mkdtempSync(join(tmpdir(), "changelog-shallow-"));
    git(root, "clone", "-q", "--depth", "1", "--no-tags",
      `file://${makeRepo("2.0.0")}`, root);
    expect(git(root, "rev-parse", "--is-shallow-repository")).toBe("true");

    expect(() => generate({ root, log: quiet })).toThrow(/shallow clone/);
    expect(readFileSync(join(root, "src", "changelog.json"), "utf8")).toBe(before);
  });

  it("refuses to guess when there is no tag at all", () => {
    rmSync(root, { recursive: true, force: true });
    root = makeRepo("1.0.0");
    git(root, "tag", "-d", "1.0.0");

    expect(() => generate({ root, log: quiet })).toThrow(/no tag found/);
  });
});
