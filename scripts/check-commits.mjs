#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Fails when a commit subject in the given range cannot be read.
//
// The release notes are written from commit subjects, so a subject nobody can
// turn into a sentence is a change that reaches no user. This is the check that
// makes that visible — on a pull request, where it can still be fixed before
// merging, and on a push to main, where it cannot and is only a signal.
//
// It shares classifySubject() with the generator rather than keeping its own
// patterns, because the two asking "is this subject readable?" differently is
// how `Update main.js` ends up absorbed by one tool and rejected by the other.
//
// Usage: node scripts/check-commits.mjs [<base>..<head>]
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from "node:child_process";
import { classifySubject, KNOWN_TYPES } from "./changelog-entries.mjs";

const range = process.argv[2] ?? "HEAD";

/** GitHub sends an all-zero `before` for a branch's first push, which is not a
 *  real revision. Check the whole history in that case rather than failing on
 *  a ref that cannot exist. */
const from = /^[0]{40}$/.test(range.split("..")[0] ?? "") ? [] : [range];

let raw;
try {
  raw = execFileSync("git", ["log", ...from, "--no-merges", "--format=%H%x00%s"], {
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

// Only "unreadable" fails. "internal" is deliberate — a `chore:` commit, a
// merge, or a file update written by the GitHub web editor are all correctly
// kept out of the notes, and none of them is anybody's mistake.
const failures = [];
for (const { sha, subject } of commits) {
  const result = classifySubject(subject);
  if (result.kind === "unreadable") {
    failures.push({ sha, subject, why: result.reason });
  }
}

if (failures.length === 0) {
  console.log(`commits: all ${commits.length} subject(s) in ${range} are readable.`);
} else {
  console.error(
    `commits: ${failures.length} of ${commits.length} subject(s) in ${range} cannot be read:\n`,
  );
  for (const { sha, subject, why } of failures) {
    console.error(`  ${sha.slice(0, 8)}  ${why}`);
    console.error(`    ${subject}`);
  }
  console.error(
    "\nExpected: <type>(<optional scope>): <description>\n" +
      `Types: ${[...KNOWN_TYPES].join(", ")}\n` +
      "\nThe release notes are written from these subjects, so a commit that\n" +
      "cannot be read here will not be told to users. Every listed type is\n" +
      "accepted; `feat`, `fix`, `perf` and `revert` are the ones that reach the\n" +
      "notes, and the rest are deliberately left out.",
  );
  process.exit(1);
}
