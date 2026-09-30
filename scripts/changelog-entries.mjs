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
const INTERNAL_TYPES = new Set(["chore", "refactor", "docs", "test", "build", "ci", "style"]);

/** Every prefix either of the two sets accepts. A subject using anything else
 *  is a typo, not a choice, and is worth reporting. */
export const KNOWN_TYPES = new Set([...Object.keys(USER_FACING), ...INTERNAL_TYPES]);

/** Leading infinitives stripped before the verb is prepended, so
 *  "feat: add table border color" reads as "Added table border color." rather
 *  than "Added add table border color."
 *
 *  This list is the only quality lever in an otherwise mechanical rewrite: a
 *  verb missing here shows up in the notes as "Added show the thing.". Add to
 *  it when a release reads badly.
 *
 *  A verb only earns a place if stripping it leaves a noun phrase behind, since
 *  that is what the new verb then takes as its object: "keep markdown table
 *  column alignment" gives "Fixed markdown table column alignment". Stripping
 *  one that heads a whole clause instead leaves the clause dangling — "make the
 *  commit check and the generator agree on what is readable" gives "Fixed the
 *  commit check and the generator agree on what is readable", no better than the
 *  "Fixed make ..." it replaced. Such a subject cannot be fixed from here; it
 *  needs rewriting at commit time. */
const STRIP = {
  Added: /^(add|adds|added|introduce|introduces|introduced|implement|implements|implemented|support|supports|create|creates|created|allow|allows|allowed|new|show|shows|display|displays)\s+/i,
  Fixed: /^(fix|fixes|fixed|correct|corrects|resolve|resolves|resolved|prevent|prevents|prevented|handle|handles|handled|avoid|avoids|avoided|keep|keeps|kept|preserve|preserves|preserved)\s+/i,
  Improved: /^(improve|improves|improved|optimi[sz]e|optimi[sz]es|optimi[zed]ed|reduce|reduces|reduced|speed up|make faster)\s+/i,
  Reverted: /^(revert|reverts|reverted)\s+/i,
};

const CONVENTIONAL = /^(?<type>[a-z]+)(?:\((?<scope>[^)]*)\))?(?<breaking>!)?: (?<description>.+)$/;

/** How many releases the history carries. src/changelog.ts keeps its own copy
 *  for the runtime; a test asserts the two agree. */
export const MAX_ENTRIES = 10;

/** Web-UI edits the GitHub file editor produces, which carry no information
 *  about intent. Internal rather than malformed: the editor chose the wording,
 *  so no amount of care from a contributor would have avoided it. */
const NOISE = /^(update|updated|add|remove) (main\.(js|ts)|styles\.css|manifest\.json|package(-lock)?\.json|README\.md|\.gitignore)$/i;

/** Lines git itself writes. */
const GIT_WRITTEN = /^(Merge (pull request|branch|commit)|Revert ")/;

/**
 * Classifies a commit subject three ways, because two different questions get
 * asked about the same text and collapsing them to a yes/no is how the
 * generator and the commit check end up disagreeing:
 *
 *   "user-facing" — belongs in the release notes
 *   "internal"    — deliberately not in the notes, and nothing to report
 *   "unreadable"  — not in the notes, and someone should know why
 *
 * Only "unreadable" is a problem. "internal" covers both `chore: bump version`
 * and the `Update main.ts` the web editor writes.
 */
export function classifySubject(subject) {
  const line = subject.trim();
  if (line === "") return { kind: "unreadable", reason: "empty subject" };
  if (NOISE.test(line)) return { kind: "internal", reason: "a web-editor file update" };
  if (GIT_WRITTEN.test(line)) return { kind: "internal", reason: "written by git" };

  const match = CONVENTIONAL.exec(line);
  if (!match?.groups) {
    return { kind: "unreadable", reason: "no conventional prefix" };
  }
  const { type, scope, breaking, description } = match.groups;
  if (!KNOWN_TYPES.has(type)) {
    return { kind: "unreadable", reason: `unknown type "${type}"` };
  }
  if (INTERNAL_TYPES.has(type)) {
    return { kind: "internal", reason: `\`${type}:\` has no user-visible effect` };
  }
  return {
    kind: "user-facing",
    commit: { type, scope: scope ?? "", breaking: Boolean(breaking), description },
  };
}

/**
 * Parses a conventional commit subject into the parts a release-note line is
 * built from, or null for anything that should not be written up — whether
 * because it is internal or because it cannot be read.
 */
export function parseSubject(subject) {
  const result = classifySubject(subject);
  return result.kind === "user-facing" ? result.commit : null;
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
 *
 * Returns the lines, plus the subjects left out split by whether anything
 * should be done about them: `skipped` is the quiet majority (`chore:`, merge
 * commits, web-editor updates) and `unreadable` is a change that will reach no
 * user because nobody could read how to describe it.
 */
export function buildChanges(subjects) {
  const changes = [];
  const skipped = [];
  const unreadable = [];
  for (const subject of subjects) {
    const result = classifySubject(subject);
    if (result.kind === "user-facing") {
      changes.push(toChangeLine(result.commit));
    } else if (result.kind === "unreadable") {
      unreadable.push({ subject, reason: result.reason });
    } else {
      skipped.push(subject);
    }
  }
  return { changes, skipped, unreadable };
}

/**
 * Renders one stored entry as the body of a GitHub release.
 *
 * The same sentences the plugin shows after an update, from the same entry, so
 * the release page and the in-app notes cannot drift and neither has to be
 * written by hand.
 *
 * GitHub's own `--generate-notes` is deliberately not used: it summarises
 * merged pull requests, so a release whose commits were pushed straight to main
 * gets a body containing nothing but a compare link.
 *
 * `previous` and `compareBase` are the tag this release follows and the
 * repository's web root. Both are optional because a body is worth having
 * without a compare link, and a local run has no compareBase.
 */
export function toReleaseBody(entry, { previous, compareBase } = {}) {
  const lines =
    entry.changes.length > 0
      ? entry.changes.map((change) => `- ${change}`)
      : ["_This release has no user-facing changes._"];
  // A re-run of a release that failed after tagging measures from its own tag,
  // so previous can be this same version; a link comparing it to itself is
  // noise, and no link is better.
  if (previous && compareBase && previous !== entry.version) {
    lines.push("", `**Full Changelog**: ${compareBase}/compare/${previous}...${entry.version}`);
  }
  return `${lines.join("\n")}\n`;
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
