import { describe, it, expect } from "vitest";
import manifest from "../manifest.json";
import {
  CHANGELOG, MAX_ENTRIES, ReleaseEntry,
  compareVersions, entryFor, isUnseen, pendingRelease, releaseHistory,
} from "./changelog";

// The plugin shows release notes when the running version is newer than the
// one a user last saw. Everything below pins that decision and the shape of
// the data behind it, because both are silent when wrong: a bad comparison
// either never shows notes or shows them on every launch.

describe("compareVersions", () => {
  it("orders by major, then minor, then patch", () => {
    expect(compareVersions("5.0.0", "4.9.9")).toBeGreaterThan(0);
    expect(compareVersions("4.7.0", "4.6.9")).toBeGreaterThan(0);
    expect(compareVersions("4.6.1", "4.6.0")).toBeGreaterThan(0);
    expect(compareVersions("4.5.0", "4.6.0")).toBeLessThan(0);
  });

  it("compares each part as a number, not as text", () => {
    // The whole reason this function exists rather than a string `>`: "4.10.0"
    // sorts *before* "4.9.0" as a string, which would hide a real release.
    expect(compareVersions("4.10.0", "4.9.0")).toBeGreaterThan(0);
    expect(compareVersions("4.1.10", "4.1.9")).toBeGreaterThan(0);
  });

  it("reports equal versions as equal", () => {
    expect(compareVersions("4.6.0", "4.6.0")).toBe(0);
  });

  it("reverses when the arguments are swapped", () => {
    expect(compareVersions("4.6.0", "4.5.0")).toBeGreaterThan(0);
    expect(compareVersions("4.5.0", "4.6.0")).toBeLessThan(0);
    expect(compareVersions("4.10.0", "4.9.0")).toBeGreaterThan(0);
    expect(compareVersions("4.9.0", "4.10.0")).toBeLessThan(0);
  });

  it("treats unparseable input as older than anything, without throwing", () => {
    // A hand-edited data.json or a version Obsidian didn't expect must not
    // throw during onload — the plugin has to finish loading either way.
    expect(compareVersions("4.6.0", "not-a-version")).toBeGreaterThan(0);
    expect(compareVersions("4.6.0", "")).toBeGreaterThan(0);
  });
});

describe("isUnseen", () => {
  it("is true with no stored version, so a first install sees the notes", () => {
    expect(isUnseen(undefined, "4.6.0")).toBe(true);
    expect(isUnseen("", "4.6.0")).toBe(true);
  });

  it("is false when the stored version is the one running", () => {
    expect(isUnseen("4.6.0", "4.6.0")).toBe(false);
  });

  it("is true when the running version is newer", () => {
    expect(isUnseen("4.5.0", "4.6.0")).toBe(true);
    expect(isUnseen("4.9.0", "4.10.0")).toBe(true);
  });

  it("is false after a downgrade, so reinstalling an old version stays quiet", () => {
    expect(isUnseen("4.6.0", "4.5.0")).toBe(false);
  });

  it("is true for a corrupt stored version, so the stamp gets corrected", () => {
    expect(isUnseen("garbage", "4.6.0")).toBe(true);
  });
});

describe("pendingRelease", () => {
  const first = CHANGELOG[CHANGELOG.length - 1];

  it("returns the current version's notes when they have not been seen", () => {
    const entry = pendingRelease(first.version, "0.0.1");
    expect(entry?.version).toBe(first.version);
  });

  it("returns nothing when the notes have already been seen", () => {
    expect(pendingRelease(first.version, first.version)).toBeNull();
  });

  it("returns nothing for an unseen version that has no entry", () => {
    // A dev build with a bumped version and no entry written yet. Better to
    // show nothing than to open an empty window. The notes are not deferred
    // to a later launch: entryFor only ever matches the running version, so
    // this is caught at release time by the manifest.json assertion below
    // rather than recovered at runtime.
    expect(pendingRelease("99.0.0", "4.6.0")).toBeNull();
  });
});

describe("entryFor", () => {
  it("finds an entry by exact version", () => {
    expect(entryFor(CHANGELOG[0].version)).toBe(CHANGELOG[0]);
  });

  it("does not match a version that merely looks similar", () => {
    expect(entryFor("4.6")).toBeUndefined();
    expect(entryFor("4.6.0-beta.1")).toBeUndefined();
  });
});

describe("releaseHistory", () => {
  it("lists newest first even if the source file is reordered", () => {
    // The expectation is spelled out rather than derived from CHANGELOG: an
    // expected value computed with the same comparator as the implementation
    // moves with it, and would pass even if the sort were plain string order,
    // which puts 4.9.0 after 4.10.0.
    const shuffled = [...CHANGELOG].reverse();
    expect(releaseHistory(shuffled).map((e) => e.version)).toEqual([
      "4.6.0", "4.5.0", "4.4.0", "4.3.0", "4.2.2",
      "4.2.1", "4.2.0", "4.1.8", "4.1.7", "4.1.6",
    ]);
  });

  it("orders versions numerically, not as text", () => {
    // Written against a synthetic list rather than CHANGELOG on purpose: every
    // real version so far has a single-digit minor and patch, and "4.9.0"
    // sorts before "4.10.0" as text. Reading the real array here would pass
    // even with a string comparator, so the regression would only surface
    // once a 4.10.0 shipped.
    const future: ReleaseEntry[] = [
      { version: "4.9.0", date: "2026-01-01", changes: [] },
      { version: "4.10.0", date: "2026-02-01", changes: [] },
      { version: "4.1.10", date: "2025-12-01", changes: [] },
      { version: "4.1.9", date: "2025-11-01", changes: [] },
    ];
    expect(releaseHistory(future, 10).map((e) => e.version)).toEqual([
      "4.10.0", "4.9.0", "4.1.10", "4.1.9",
    ]);
  });

  it("honours an explicit limit", () => {
    expect(releaseHistory(CHANGELOG, 2)).toHaveLength(2);
  });

  it("leaves the source array untouched", () => {
    // A plain in-place .sort() would reorder the caller's array — and when
    // called with no argument, the module-level CHANGELOG itself.
    const source = [...CHANGELOG].reverse();
    const out = releaseHistory(source);
    expect(source.map((e) => e.version)).toEqual([...CHANGELOG].reverse().map((e) => e.version));
    expect(out).not.toBe(source);
  });
});

// The data file is maintained by hand, once per release, so these assertions
// are the guard rail. A version bump with no entry fails here rather than
// shipping a silent no-op to users.
describe("CHANGELOG", () => {
  it("has an entry for the version in manifest.json", () => {
    // The safety net for the release chore. This test is the only thing that
    // couples the two files: at runtime the plugin reads the version Obsidian
    // hands it, so a version bump with no matching entry would otherwise ship
    // a silent no-op that no user would ever see.
    expect(entryFor(manifest.version)).toBeDefined();
  });

  it("is ordered newest first", () => {
    for (let i = 0; i < CHANGELOG.length - 1; i++) {
      expect(compareVersions(CHANGELOG[i].version, CHANGELOG[i + 1].version))
        .toBeGreaterThan(0);
    }
  });

  it("stays within the cap on how many releases it carries", () => {
    expect(CHANGELOG.length).toBeLessThanOrEqual(MAX_ENTRIES);
  });

  it("has no duplicate versions", () => {
    const versions = CHANGELOG.map((e) => e.version);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it("uses plain numeric versions, no prerelease suffixes", () => {
    for (const entry of CHANGELOG) {
      expect(entry.version).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("dates every entry as YYYY-MM-DD", () => {
    for (const entry of CHANGELOG) {
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

});
