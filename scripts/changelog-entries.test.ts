import { describe, it, expect } from "vitest";
import { parseSubject, toChangeLine, buildChanges, addEntry, MAX_ENTRIES } from "./changelog-entries.mjs";
import type { ReleaseEntry } from "../src/changelog";

// Every subject below is a real one from this repository's history, so the
// cases are the ones the generator will actually meet — including the 78
// `Update main.js` commits that would otherwise dominate a release.

describe("parseSubject", () => {
  it("reads a conventional subject", () => {
    expect(parseSubject("feat: add configurable table border color")).toEqual({
      type: "feat",
      scope: "",
      breaking: false,
      description: "add configurable table border color",
    });
  });

  it("reads a scope", () => {
    expect(parseSubject("fix(css-builder): crash on empty sheet")?.scope).toBe("css-builder");
  });

  it("reads a breaking-change marker", () => {
    expect(parseSubject("feat!: drop the legacy exporter")?.breaking).toBe(true);
  });

  it("keeps internal types out of the notes", () => {
    // These are well-formed commits — they just have nothing to tell a user.
    for (const subject of [
      "chore: bump version to 4.6.0",
      "refactor: split main.ts into modular components",
      "docs: update the README",
      "test: cover the save path",
      "ci: pin the node version",
    ]) {
      expect(parseSubject(subject), subject).toBeNull();
    }
  });

  it("keeps user-facing types", () => {
    for (const type of ["feat", "fix", "perf", "revert"]) {
      expect(parseSubject(`${type}: something happened`)?.type, type).toBe(type);
    }
  });

  it("rejects the web-UI edit noise", () => {
    // 78 of the last 200 commits look like this, all from edits made in the
    // GitHub file editor rather than a terminal.
    for (const subject of [
      "Update main.js",
      "Update main.ts",
      "Update README.md",
      "Update .gitignore",
      "update screenshots",
      "Add package-lock.json",
    ]) {
      expect(parseSubject(subject), subject).toBeNull();
    }
  });

  it("rejects merges and reverts git wrote itself", () => {
    expect(parseSubject('Merge pull request #52 from oilandrust/feat/table-border-color')).toBeNull();
    expect(parseSubject('Revert "refactor: remove unnecessary type assertion"')).toBeNull();
  });

  it("rejects a subject that is merely prose", () => {
    // "optimize mathjax rendering delay" was a real user-facing change written
    // without a prefix. The filter drops it; check-commits is what stops that
    // happening on a pull request from now on.
    expect(parseSubject("optimize mathjax rendering delay")).toBeNull();
    expect(parseSubject("Remove uppercase styling from H4")).toBeNull();
  });

  it("rejects an unknown type rather than guessing", () => {
    expect(parseSubject("wibble: something")).toBeNull();
  });
});

describe("toChangeLine", () => {
  const line = (subject: string) => {
    const commit = parseSubject(subject);
    return commit ? toChangeLine(commit) : null;
  };

  it("rewrites a feature as a sentence", () => {
    expect(line("feat: add configurable table border color"))
      .toBe("Added configurable table border color.");
  });

  it("rewrites a fix as a sentence", () => {
    expect(line("fix: latex math symbol missing"))
      .toBe("Fixed latex math symbol missing.");
  });

  it("strips a verb only when a noun phrase is left to take as its object", () => {
    // Both of these are real subjects from 4.7.0 that read as "Fixed keep
    // markdown table column alignment in headers." until the verb was listed.
    expect(line("fix: keep markdown table column alignment in headers"))
      .toBe("Fixed markdown table column alignment in headers.");
    expect(line("fix: preserve preset customizations when switching presets"))
      .toBe("Fixed preset customizations when switching presets.");
  });

  it("leaves a verb that heads a whole clause alone", () => {
    // Stripping "make" would give "Fixed the commit check and the generator
    // agree on what is readable", which is no more readable than what it
    // replaces. The subject needs rewriting at commit time, not a bigger
    // regex here — so the verb stays and the line stays honest about being
    // mechanical.
    expect(line("fix: make the commit check and the generator agree on what is readable"))
      .toBe("Fixed make the commit check and the generator agree on what is readable.");
  });

  it("keeps a subject that already reads as a noun phrase", () => {
    expect(line("feat: configurable table border color"))
      .toBe("Added configurable table border color.");
  });

  it("does not strip a word that is part of the meaning", () => {
    // "support" is on the strip list, but "support for X" is the noun.
    expect(line("feat: add support for ligatures")).toBe("Added support for ligatures.");
  });

  it("never produces a sentence with nothing in it", () => {
    expect(line("feat: add")).toBe("Added add.");
    expect(line("fix: fix")).toBe("Fixed fix.");
  });

  it("capitalises and terminates a multi-word description", () => {
    expect(line("feat: drop the uppercase styling from H4 headings"))
      .toBe("Added drop the uppercase styling from H4 headings.");
  });

  it("does not double the full stop", () => {
    expect(line("feat: add a setting.")).toBe("Added a setting.");
  });

  it("marks a breaking change", () => {
    expect(line("feat!: drop the legacy exporter"))
      .toBe("Breaking: Added drop the legacy exporter.");
  });
});

describe("buildChanges", () => {
  it("separates what it left out from what it could not read", () => {
    // The distinction the whole design turns on. `chore:` and `Update main.js`
    // are deliberately not in the notes and nothing is wrong. "optimize
    // mathjax rendering delay" is a real change that will reach no user
    // because its subject doesn't say what it did — the one worth reporting.
    const { changes, skipped, unreadable } = buildChanges([
      "feat: add configurable table border color",
      "chore: bump version to 4.6.0",
      "Update main.js",
      "optimize mathjax rendering delay",
    ]);
    expect(changes).toEqual(["Added configurable table border color."]);
    expect(skipped).toEqual(["chore: bump version to 4.6.0", "Update main.js"]);
    expect(unreadable).toEqual([
      { subject: "optimize mathjax rendering delay", reason: "no conventional prefix" },
    ]);
  });

  it("treats a bad type as unreadable rather than internal", () => {
    const { skipped, unreadable } = buildChanges(["wibble: something"]);
    expect(skipped).toEqual([]);
    expect(unreadable[0].reason).toContain("unknown type");
  });

  it("produces empty lists rather than failing when nothing is user-facing", () => {
    const { changes, skipped, unreadable } = buildChanges([
      "chore: bump version to 4.6.0",
      "Update main.js",
    ]);
    expect(changes).toEqual([]);
    expect(skipped).toHaveLength(2);
    expect(unreadable).toEqual([]);
  });

  it("keeps commits in the order they were given", () => {
    const { changes } = buildChanges([
      "feat: add a dropdown menu to print and export",
      "fix: use createDiv instead of createEl",
      "feat: ligature off by default",
    ]);
    expect(changes).toEqual([
      "Added a dropdown menu to print and export.",
      "Fixed use createDiv instead of createEl.",
      "Added ligature off by default.",
    ]);
  });
});

describe("addEntry", () => {
  const entry = (version: string): ReleaseEntry => ({ version, date: "2026-01-01", changes: [] });
  const history = (count: number) =>
    Array.from({ length: count }, (_, i) => entry(`4.${count - i}.0`));

  it("puts the new release at the top", () => {
    const { entries, added } = addEntry(history(3), entry("4.4.0"));
    expect(added).toBe(true);
    expect(entries[0].version).toBe("4.4.0");
    expect(entries).toHaveLength(4);
  });

  it("drops the oldest once the cap is reached", () => {
    // The failure this guards: a release that reports success but never adds
    // its entry, or adds it without trimming, so the file grows for ever.
    const { entries, dropped } = addEntry(history(MAX_ENTRIES), entry("4.11.0"));
    expect(entries).toHaveLength(MAX_ENTRIES);
    expect(entries[0].version).toBe("4.11.0");
    expect(dropped).toEqual(["4.1.0"]);
  });

  it("refuses to add a version that is already there", () => {
    // Re-running the release job after a failure must not duplicate.
    const before = history(3);
    const { entries, added, dropped } = addEntry(before, entry("4.3.0"));
    expect(added).toBe(false);
    expect(dropped).toEqual([]);
    expect(entries).toEqual(before);
  });

  it("leaves the array it was given alone", () => {
    const before = history(3);
    addEntry(before, entry("4.4.0"));
    expect(before).toHaveLength(3);
    expect(before[0].version).toBe("4.3.0");
  });

  it("handles an empty history", () => {
    const { entries } = addEntry([], entry("1.0.0"));
    expect(entries).toEqual([entry("1.0.0")]);
  });
});
