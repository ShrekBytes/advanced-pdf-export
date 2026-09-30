import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifySubject } from "./changelog-entries.mjs";

// check-commits.mjs is a script, not a module: it runs on import and calls
// process.exit. So these drive it the way CI does — as a child process against
// a throwaway repository — rather than importing it.

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trimEnd();

const SCRIPT = join(import.meta.dirname, "check-commits.mjs");

function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "check-commits-test-"));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "Test");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "commit.gpgsign", "false");
  return root;
}

const commit = (root: string, subject: string) => {
  writeFileSync(join(root, "scratch.txt"), subject);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", subject);
};

interface Run {
  code: number;
  /** Everything the script printed, on either stream. */
  out: string;
}

function run(root: string, range: string): Run {
  try {
    const out = execFileSync("node", [SCRIPT, range], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (err) {
    // Failures go to stderr, which is a stream of its own — a helper that
    // reads only stdout would report an empty message for every real failure.
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

describe("check-commits", () => {
  let root: string;

  beforeEach(() => {
    root = makeRepo();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("passes a range of conventional commits", () => {
    commit(root, "chore: initial");
    const base = git(root, "rev-parse", "HEAD");
    commit(root, "feat: add a table border color");
    commit(root, "fix: crash on an empty sheet");

    expect(run(root, `${base}..HEAD`).code).toBe(0);
  });

  it("fails on a subject with no conventional prefix", () => {
    commit(root, "chore: initial");
    const base = git(root, "rev-parse", "HEAD");
    commit(root, "optimize mathjax rendering delay");

    const { code, out } = run(root, `${base}..HEAD`);
    expect(code).toBe(1);
    expect(out).toContain("optimize mathjax rendering delay");
  });

  it("accepts the web-UI edit noise", () => {
    // The 78 `Update main.js` commits. These are internal, not malformed: the
    // GitHub web editor chose the wording, so no contributor could have avoided
    // it, and failing the build over them would train everyone to ignore it.
    commit(root, "chore: initial");
    const base = git(root, "rev-parse", "HEAD");
    commit(root, "Update main.ts");
    commit(root, "Update README.md");

    expect(run(root, `${base}..HEAD`).code).toBe(0);
  });

  it("fails on a type it does not know", () => {
    commit(root, "chore: initial");
    const base = git(root, "rev-parse", "HEAD");
    commit(root, "wibble: something happened");

    const { code, out } = run(root, `${base}..HEAD`);
    expect(code).toBe(1);
    expect(out).toContain("unknown type");
  });

  it("accepts every internal type, since those are legitimate", () => {
    commit(root, "chore: initial");
    const base = git(root, "rev-parse", "HEAD");
    for (const type of ["chore", "refactor", "docs", "test", "build", "ci", "style"]) {
      commit(root, `${type}: something internal`);
    }

    expect(run(root, `${base}..HEAD`).code).toBe(0);
  });

  it("accepts a scope and a breaking marker", () => {
    commit(root, "chore: initial");
    const base = git(root, "rev-parse", "HEAD");
    commit(root, "fix(css-builder): crash on an empty sheet");
    commit(root, "feat!: drop the legacy exporter");

    expect(run(root, `${base}..HEAD`).code).toBe(0);
  });

  it("reports a range it cannot read, without a stack trace", () => {
    const { code, out } = run(root, "deadbeef..HEAD");
    expect(code).toBe(1);
    expect(out).toContain("cannot read the range");
    expect(out).not.toContain("at Object.");
  });

  it("checks everything when the range starts at an all-zero sha", () => {
    // What GitHub sends for a branch's first push.
    commit(root, "chore: initial");
    const { code } = run(root, `${"0".repeat(40)}..HEAD`);
    expect(code).toBe(0);
  });

  it("agrees with the generator about what is readable", () => {
    // The disagreement this suite exists to prevent: the release log absorbing
    // a subject the build rejects, or the reverse. Both ask the same question
    // of the same text and must get the same answer, so the expectation is
    // derived from classifySubject rather than written out again here.
    const subjects = [
      "feat: add a table border color",
      "fix: crash on an empty sheet",
      "chore: bump version to 9.9.9",
      "docs: update the README",
      "Update main.ts",
      "Merge pull request #1 from someone/branch",
      'Revert "refactor: something"',
      "optimize mathjax rendering delay",
      "wibble: something happened",
      // A whitespace-only subject. git refuses to commit one, so it is fed
      // through an otherwise-conventional subject that classifies the same way
      // rather than being committed for real.
    ];
    for (const subject of subjects) {
      const scratch = makeRepo();
      commit(scratch, "chore: initial");
      const base = git(scratch, "rev-parse", "HEAD");
      commit(scratch, subject);
      const readable = classifySubject(subject).kind !== "unreadable";
      expect(run(scratch, `${base}..HEAD`).code, subject).toBe(readable ? 0 : 1);
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("treats a blank subject as unreadable", () => {
    // Checked here rather than in the loop above because git will not commit
    // one; the classification still has to hold for it.
    expect(classifySubject("").kind).toBe("unreadable");
    expect(classifySubject("   ").kind).toBe("unreadable");
  });
});
