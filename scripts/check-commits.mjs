#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Fails when a commit subject in the given range isn't a conventional commit.
// The generator can only write up what it can read, so an unreadable subject is
// a change that silently won't appear in the release notes — this is what
// stops that from happening on merged pull requests.
//
// Run against a PR's commit range, not the whole branch: history predating
// this check, and direct web-UI pushes to main, are out of scope.
//
// Usage: node scripts/check-commits.mjs [<base>..<head>]
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from "node:child_process";
import { parseSubject } from "./changelog-entries.mjs";

/** Every conventional type, including the internal ones the generator drops.
 *  A `chore:` commit is still a well-formed commit. */
const KNOWN = new Set([
  "feat", "fix", "perf", "refactor", "revert",
  "chore", "docs", "test", "build", "ci", "style",
]);

const SHAPE = /^(?<type>[a-z]+)(?:\((?<scope>[^)]*)\))?(?<breaking>!)?: .+$/;

const range = process.argv[2] ?? "HEAD";

/** Subjects git itself produces, which the author didn't write. */
const GIT_WRITTEN = /^(Merge |Revert ")/;

let raw;
try {
  raw = execFileSync("git", ["log", range, "--no-merges", "--format=%H%x00%s"], {
    encoding: "utf8",
    // Capture git's stderr instead of letting it print, so the only output is
    // the message below.
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (err) {
  // Almost always a ref the clone doesn't have, e.g. a base SHA that wasn't
  // fetched. Say so rather than printing a stack trace.
  const detail = err.stderr ? String(err.stderr).trim().split("\n")[0] : String(err.message);
  console.error(`commits: cannot read the range "${range}".\n  ${detail}`);
  process.exit(1);
}

const commits = raw
  .split("\n")
  .filter((line) => line !== "")
  .map((line) => {
    const [sha, subject] = line.split("\0");
    return { sha, subject };
  });

const failures = [];
for (const { sha, subject } of commits) {
  if (GIT_WRITTEN.test(subject)) continue;
  const match = SHAPE.exec(subject);
  if (!match?.groups) {
    failures.push({ sha, subject, why: "no conventional prefix" });
  } else if (!KNOWN.has(match.groups.type)) {
    failures.push({ sha, subject, why: `unknown type "${match.groups.type}"` });
  }
}

if (failures.length === 0) {
  console.log(`commits: all ${commits.length} subject(s) in ${range} are conventional.`);
} else {
  console.error(`commits: ${failures.length} of ${commits.length} subject(s) in ${range} are not conventional:\n`);
  for (const { sha, subject, why } of failures) {
    console.error(`  ${sha.slice(0, 8)}  ${why}`);
    console.error(`    ${subject}`);
  }
  console.error(
    "\nExpected: <type>(<optional scope>): <description>\n" +
      `Types: ${[...KNOWN].join(", ")}\n` +
      "\nThe release notes are written from these subjects — a commit that\n" +
      "can't be read here won't be told to users. `chore:`, `refactor:` and\n" +
      "`docs:` are accepted but intentionally left out of the notes.",
  );
  process.exit(1);
}
