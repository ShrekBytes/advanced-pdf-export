// ─────────────────────────────────────────────────────────────────────────────
// Release notes: the record of what changed in each version, plus the version
// comparison that decides whether a running plugin is newer than the last one
// a user saw.
//
// The entries live in changelog.json, which is generated at release time by
// scripts/generate-changelog.mjs from conventional commit messages — don't
// hand-edit it. This file holds the logic that reads it.
//
// Deliberately imports nothing from `obsidian`, so changelog.test.ts can cover
// all of it under the existing vitest alias without growing the stub in
// src/__mocks__/obsidian.ts. The running version arrives as an argument from
// main.ts (Obsidian reads it out of manifest.json); nothing here touches the
// filesystem or the plugin API.
// ─────────────────────────────────────────────────────────────────────────────

import ENTRIES from "./changelog.json";

export interface ReleaseEntry {
  /** Plain numeric semver, e.g. "4.6.0". No prerelease suffixes. */
  version: string;
  /** Release date as YYYY-MM-DD, for orientation. */
  date: string;
  /**
   * One user-facing sentence per change. Empty for a release with nothing to
   * report — an internal refactor still gets an entry, so a missing entry
   * always means "the generator didn't run", never "nothing changed".
   */
  changes: string[];
}

/** How many releases the full history carries. */
export const MAX_ENTRIES = 10;

/** Newest first. Order is asserted by the test suite, so a bad generation
 *  fails CI rather than showing up as a shuffled history. */
export const CHANGELOG: ReleaseEntry[] = ENTRIES;

/** Splits a version into its numeric parts. Anything unparseable counts as 0,
 *  so a corrupt stored version or an unexpected manifest can't throw during
 *  plugin startup — it just reads as older than everything. */
function versionParts(version: string): [number, number, number] {
  const [major = 0, minor = 0, patch = 0] = version.split(".");
  return [Number(major) || 0, Number(minor) || 0, Number(patch) || 0];
}

/** Negative when a is older than b, 0 when equal, positive when a is newer.
 *  Compares part by part as numbers, so 4.10.0 correctly beats 4.9.0. */
export function compareVersions(a: string, b: string): number {
  const [aMajor, aMinor, aPatch] = versionParts(a);
  const [bMajor, bMinor, bPatch] = versionParts(b);
  return aMajor - bMajor || aMinor - bMinor || aPatch - bPatch;
}

/** The entry for one exact version, or undefined if none was written. */
export function entryFor(version: string): ReleaseEntry | undefined {
  return CHANGELOG.find((entry) => entry.version === version);
}

/** True when the running version is newer than the one a user last saw —
 *  including a first install, which has no stored version to compare against.
 *  False after a downgrade, so reinstalling an older build stays quiet. */
export function isUnseen(lastSeen: string | undefined, current: string): boolean {
  if (!lastSeen) return true;
  return compareVersions(current, lastSeen) > 0;
}

/** The notes to show on startup, or null to show nothing. Both the first
 *  install and a normal update land here: each shows exactly the running
 *  version's entry, so the stored version only decides *whether* to show. */
export function pendingRelease(
  current: string,
  lastSeen: string | undefined,
): ReleaseEntry | null {
  if (!isUnseen(lastSeen, current)) return null;
  return entryFor(current) ?? null;
}

/** The full history, newest first, capped at `limit`. Sorted here rather than
 *  trusted from the file so a hand-reordered entry still reads correctly; the
 *  test suite separately asserts the file's own order. */
export function releaseHistory(
  entries: ReleaseEntry[] = CHANGELOG,
  limit: number = MAX_ENTRIES,
): ReleaseEntry[] {
  return [...entries]
    .sort((a, b) => compareVersions(b.version, a.version))
    .slice(0, limit);
}
