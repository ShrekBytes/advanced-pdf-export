// ─────────────────────────────────────────────────────────────────────────────
// Turning commit subjects into release-note lines.
//
// The input is a conventional commit subject, the output is one user-facing
// sentence. This is deliberately mechanical: it rewrites what a developer wrote
// for a developer, and does not try to understand the change. Anything it
// can't read is reported back as `skipped` rather than guessed at, so the
// release log shows exactly what a release is about to leave out.
//
// Plain .mjs with a sibling .d.ts so it runs under `node` in CI with no build
// step, while src/*.test.ts can still import and test it.
// ─────────────────────────────────────────────────────────────────────────────

/** Prefixes that become a user-facing line, mapped to the verb that opens it. */
const USER_FACING = {
  feat: "Added",
  fix: "Fixed",
  perf: "Improved",
  revert: "Reverted",
};

/** Prefixes with no user-visible effect. Dropped silently — the overwhelming
 *  majority of them are `chore: bump version` and similar. */
const INTERNAL = new Set(["chore", "refactor", "docs", "test", "build", "ci", "style"]);

/** Leading infinitives stripped before the verb is prepended, so
 *  "feat: add table border color" reads as "Added table border color." rather
 *  than "Added add table border color."
 *
 *  This list is the only quality lever in an otherwise mechanical rewrite: a
 *  verb missing here shows up in the notes as "Added show the thing.". Add to
 *  it when a release reads badly. */
const STRIP = {
  Added: /^(add|adds|added|introduce|introduces|introduced|implement|implements|implemented|support|supports|create|creates|created|allow|allows|allowed|new|show|shows|display|displays)\s+/i,
  Fixed: /^(fix|fixes|fixed|correct|corrects|resolve|resolves|resolved|prevent|prevents|prevented|handle|handles|handled|avoid|avoids|avoided)\s+/i,
  Improved: /^(improve|improves|improved|optimi[sz]e|optimi[sz]es|optimi[zed]ed|reduce|reduces|reduced|speed up|make faster)\s+/i,
  Reverted: /^(revert|reverts|reverted)\s+/i,
};

const CONVENTIONAL = /^(?<type>[a-z]+)(?:\((?<scope>[^)]*)\))?(?<breaking>!)?: (?<description>.+)$/;

/** How many releases the history carries. src/changelog.ts keeps its own copy
 *  for the runtime; a test asserts the two agree. */
export const MAX_ENTRIES = 10;

/** Web-UI edits and dependency chores that aren't conventional commits but are
 *  pure noise. Matched on the whole subject. */
const NOISE = /^(update|updated|add|remove) (main\.(js|ts)|styles\.css|manifest\.json|package(-lock)?\.json|README\.md|\.gitignore)$/i;

/**
 * Parses a conventional commit subject.
 * Returns null for anything that isn't one, including merge commits and the
 * noise subjects above.
 */
export function parseSubject(subject) {
  const line = subject.trim();
  if (line === "" || NOISE.test(line)) return null;
  if (/^Merge (pull request|branch|commit)/i.test(line)) return null;
  const match = CONVENTIONAL.exec(line);
  if (!match?.groups) return null;
  const { type, scope, breaking, description } = match.groups;
  if (INTERNAL.has(type)) return null;
  if (!USER_FACING[type]) return null;
  return { type, scope: scope ?? "", breaking: Boolean(breaking), description };
}

/** Rewrites a parsed commit into one sentence. A `!` marker becomes a
 *  "Breaking: " prefix, which the plugin surfaces to nobody in particular but
 *  keeps visible in the GitHub release notes. */
export function toChangeLine(commit) {
  const verb = USER_FACING[commit.type];
  const strip = STRIP[verb];
  // `strip` is undefined for a type outside USER_FACING, which the return type
  // forbids but a hand-built object could still contain.
  if (!strip) throw new Error(`no release-note verb for type "${commit.type}"`);
  let text = commit.description.trim().replace(/\.$/, "");
  const stripped = strip.exec(text);
  // The patterns all end in \s+, so a match can only happen with something
  // after it — "feat: add" leaves "add" rather than becoming a bare "Added.".
  if (stripped) text = text.slice(stripped[0].length);
  // No case change to the description: it now follows the verb, and forcing an
  // initial capital reads as "Added Configurable table border color."
  return `${commit.breaking ? "Breaking: " : ""}${verb} ${text.trim()}.`;
}

/**
 * Builds the change lines for a release from a list of commit subjects.
 * Returns the lines plus every subject that was left out, so the caller can
 * print them — a dropped subject is a change nobody will be told about.
 */
export function buildChanges(subjects) {
  const changes = [];
  const skipped = [];
  for (const subject of subjects) {
    const commit = parseSubject(subject);
    if (commit) changes.push(toChangeLine(commit));
    else skipped.push(subject);
  }
  return { changes, skipped };
}

/**
 * Puts a new entry at the top of the history and drops whatever falls past
 * the cap. Refuses to add a version that is already there, so re-running after
 * a failed release cannot produce a duplicate.
 */
export function addEntry(entries, entry, max = MAX_ENTRIES) {
  if (entries.some((existing) => existing.version === entry.version)) {
    return { entries, added: false, dropped: [] };
  }
  const next = [entry, ...entries];
  return {
    entries: next.slice(0, max),
    added: true,
    dropped: next.slice(max).map((old) => old.version),
  };
}
