#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Adds a release entry to src/changelog.json from the commits since the last
// tag. Run by the release workflow just before the build, so the notes in the
// published bundle match the release they ship with, then committed back to
// main afterwards.
//
// Idempotent: if the running version already has an entry, this exits without
// touching the file, so a re-run of a failed release is safe.
//
// Usage: node scripts/generate-changelog.mjs [--dry-run]
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { addEntry, buildChanges, toReleaseBody, MAX_ENTRIES } from "./changelog-entries.mjs";

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The tag the previous release was cut from. Throws rather than falling back
 *  to "all of history": a shallow clone or a tagless repo would otherwise
 *  re-announce every change the plugin ever made as this release's news. */
function lastTag(git) {
  if (git("rev-parse", "--is-shallow-repository") === "true") {
    throw new Error(
      "this is a shallow clone, so the previous release tag is not visible. " +
        "Check out with fetch-depth: 0.",
    );
  }
  try {
    return git("describe", "--tags", "--abbrev=0");
  } catch {
    throw new Error(
      "no tag found to compare against. Release notes are written from the " +
        "commits since the last tag, so there has to be one.",
    );
  }
}

/**
 * The repository's web root, for the compare link on a release body.
 *
 * GitHub Actions sets both of these for every step, so the release workflow
 * needs no plumbing to get one. A local run has neither, and the body is then
 * written without a compare link rather than with a broken one.
 */
function compareBase(env) {
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repository } = env;
  return server && repository ? `${server}/${repository}` : undefined;
}

/**
 * Writes this release's entry into <root>/src/changelog.json, and optionally the
 * body of the GitHub release into <root>/notesFile.
 *
 * Takes the repository root rather than assuming the one it lives in, so a
 * test can point it at a throwaway repo and exercise the git and file handling
 * rather than only the string rewriting. `env` is a parameter for the same
 * reason: the compare link depends on it, and a test should not have to fake
 * the process environment to check that.
 */
export function generate({
  root = DEFAULT_ROOT,
  dryRun = false,
  log = console.log,
  notesFile,
  env = process.env,
} = {}) {
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      // Capture git's stderr rather than letting it print, so failures surface
      // once, as a message from here.
      stdio: ["ignore", "pipe", "pipe"],
    }).trimEnd();

  const version = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")).version;
  const existing = JSON.parse(readFileSync(join(root, "src", "changelog.json"), "utf8"));

  const tag = lastTag(git);
  const subjects = git("log", `${tag}..HEAD`, "--no-merges", "--format=%s")
    .split("\n")
    .filter((line) => line.trim() !== "");

  const { changes, skipped, unreadable } = buildChanges(subjects);
  const date = git("log", "-1", "--format=%cs");
  const entry = { version, date, changes };
  const result = addEntry(existing, entry);

  log(`changelog: ${subjects.length} commit(s) since ${tag}`);
  log(`changelog: ${changes.length} user-facing, ${skipped.length} internal, ${unreadable.length} unreadable`);
  if (unreadable.length > 0) {
    // The ones that matter: a real change that will reach no user because its
    // subject doesn't say what it did.
    log("changelog: NOT written up, and not readable — these changes are unannounced:");
    for (const { subject, reason } of unreadable) log(`  - ${subject}  (${reason})`);
  }
  for (const old of result.dropped) {
    log(`changelog: dropped ${old}, over the ${MAX_ENTRIES}-entry cap`);
  }

  if (dryRun) {
    log("changelog: --dry-run, not writing. This entry would be:");
    log(JSON.stringify(entry, null, 2));
  } else if (!result.added) {
    log(`changelog: ${version} already has an entry, nothing to do.`);
  } else {
    writeFileSync(
      join(root, "src", "changelog.json"),
      `${JSON.stringify(result.entries, null, 2)}\n`,
    );
    log(`changelog: wrote ${version} to src/changelog.json`);
  }

  // Written whether or not the entry above was new, so re-running a release
  // that failed after tagging still produces the right body. Sourced from the
  // stored entry rather than the one just computed, for the same reason: the
  // tag has already moved by then, so the commit range comes back empty and
  // the computed entry would claim the release changed nothing.
  if (notesFile) {
    const stored = result.entries.find((e) => e.version === version);
    const body = toReleaseBody(stored, { previous: tag, compareBase: compareBase(env) });
    if (dryRun) {
      log(`changelog: --dry-run, not writing. The ${version} release body would be:`);
      log(body);
    } else {
      writeFileSync(join(root, notesFile), body);
      log(`changelog: wrote the ${version} release body to ${notesFile}`);
    }
  }

  return { entry, result, skipped, unreadable, tag };
}

// Only run when invoked as a script, so importing this to test it does not
// start writing files.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    // A bare --notes-file with no path would otherwise look the same as no flag
    // at all, and the release would ship with an empty body and no complaint.
    const flag = process.argv.indexOf("--notes-file");
    const notesFile = flag === -1 ? undefined : process.argv[flag + 1];
    if (flag !== -1 && !notesFile) throw new Error("--notes-file needs a path to write to.");
    generate({ dryRun: process.argv.includes("--dry-run"), notesFile });
  } catch (err) {
    // A stack trace here means a CI misconfiguration, not a code bug. Say what
    // went wrong in one line so the release log is readable.
    console.error(`changelog: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
