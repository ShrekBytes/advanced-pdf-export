// ─────────────────────────────────────────────────────────────────────────────
// Release notes: the bundled record of what changed in each version, plus the
// version comparison that decides whether a running plugin is newer than the
// last one a user saw.
//
// Deliberately imports nothing from `obsidian`, so changelog.test.ts can cover
// all of it under the existing vitest alias without growing the stub in
// src/__mocks__/obsidian.ts. The running version arrives as an argument from
// main.ts (Obsidian reads it out of manifest.json); nothing here touches the
// filesystem or the plugin API.
// ─────────────────────────────────────────────────────────────────────────────

export interface ReleaseEntry {
  /** Plain numeric semver, e.g. "4.6.0". No prerelease suffixes. */
  version: string;
  /** Release date as YYYY-MM-DD, for orientation. Optional to read, not to write. */
  date: string;
  /**
   * One user-facing sentence per change, newest release first. Empty for a
   * release with nothing to report — an internal refactor still gets an entry,
   * so a missing entry always means "nobody wrote one", never "nothing changed".
   */
  changes: string[];
}

/** How many releases the full history carries. */
export const MAX_ENTRIES = 10;

/**
 * RELEASING: on each version bump, add an entry at the top and drop the
 * oldest one, so the array stays at MAX_ENTRIES. Write one user-facing
 * sentence per change, not a commit subject. An internal-only release still
 * gets an entry, with an empty `changes` list.
 *
 * Newest first. Order is asserted by the test suite, so a hand-edit that
 * breaks it fails CI rather than showing up as a shuffled history.
 */
export const CHANGELOG: ReleaseEntry[] = [
  {
    version: "4.6.0",
    date: "2026-09-23",
    changes: [
      "Added a configurable table border color.",
      "Fixed the font weight applied to H2 headings.",
      "Removed the automatic uppercase styling from H4 headings.",
    ],
  },
  {
    version: "4.5.0",
    date: "2026-08-28",
    changes: [
      "Added a bold text color setting.",
      "Added a button to reset a preset's colors back to their defaults.",
    ],
  },
  {
    version: "4.4.0",
    date: "2026-08-15",
    changes: [
      "Added a {{title}} placeholder to the page number format.",
      "Added a dropdown menu to the print and export button.",
      "Added a dedicated code font and a ligature toggle. Ligatures are now off by default.",
    ],
  },
  {
    // Obsidian 1.13 compatibility work: new declarative settings API, no
    // user-visible change.
    version: "4.3.0",
    date: "2026-08-09",
    changes: [],
  },
  {
    version: "4.2.2",
    date: "2026-07-19",
    changes: [
      "Fixed a crash in the preview and export when a stylesheet came from another window.",
    ],
  },
  {
    // Split main.ts into modules: internal only.
    version: "4.2.1",
    date: "2026-07-12",
    changes: [],
  },
  {
    version: "4.2.0",
    date: "2026-07-10",
    changes: ["Added a customizable page number format."],
  },
  {
    version: "4.1.8",
    date: "2026-07-03",
    changes: ["Reduced the delay before MathJax content is rendered."],
  },
  {
    version: "4.1.7",
    date: "2026-07-03",
    changes: ["Fixed rendering sometimes looping."],
  },
  {
    version: "4.1.6",
    date: "2026-07-02",
    changes: ["Fixed a missing LaTeX math symbol."],
  },
];

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
