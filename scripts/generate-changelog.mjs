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
import { addEntry, buildChanges, MAX_ENTRIES } from "./changelog-entries.mjs";

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
 * Writes this release's entry into <root>/src/changelog.json.
 *
 * Takes the repository root rather than assuming the one it lives in, so a
 * test can point it at a throwaway repo and exercise the git and file handling
 * rather than only the string rewriting.
 */
export function generate({ root = DEFAULT_ROOT, dryRun = false, log = console.log } = {}) {
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

  const { changes, skipped } = buildChanges(subjects);
  const date = git("log", "-1", "--format=%cs");
  const entry = { version, date, changes };
  const result = addEntry(existing, entry);

  log(`changelog: ${subjects.length} commit(s) since ${tag}`);
  log(`changelog: ${changes.length} user-facing change(s), ${skipped.length} skipped`);
  if (skipped.length > 0) {
    // Printed because a skipped subject is a change this release will not
    // mention. Most are chores by design; see changelog-entries.mjs for what
    // counts as user-facing.
    log("changelog: not user-facing, and not written up:");
    for (const subject of skipped) log(`  - ${subject}`);
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

  return { entry, result, skipped, tag };
}

// Only run when invoked as a script, so importing this to test it does not
// start writing files.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    generate({ dryRun: process.argv.includes("--dry-run") });
  } catch (err) {
    // A stack trace here means a CI misconfiguration, not a code bug. Say what
    // went wrong in one line so the release log is readable.
    console.error(`changelog: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
