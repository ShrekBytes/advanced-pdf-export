# AGENTS.md

Guidance for agents working in this repo. See `README.md` for what the plugin does and `docs/agents/` for how the engineering skills are wired up.

## Project shape

An Obsidian plugin. TypeScript sources live flat in `src/`, bundled to `main.js` by esbuild — `main.js` is a build artefact, not a source file, so never hand-edit it. It is tracked because the release workflow commits the build it publishes; revert that commit and you break the tag, the release, and the store's build check together. Styles are in `styles.css` and `src/css-builder.ts`.

Unit tests sit next to the file they cover as `src/*.test.ts` and run under Vitest. The `obsidian` package ships types only and has no runtime entry point, so `vitest.config.ts` aliases the bare specifier to `src/__mocks__/obsidian.ts`. That stub only has to cover what the module under test actually *calls* — an import it never invokes may be missing, but anything reached at run time must be there. Keep testable logic import-free regardless; reaching for the stub is a fallback, not a licence to import whatever.

Tests that need a DOM ask for one per file with a `// @vitest-environment happy-dom` docblock. The default environment is `node`, which is right for the pure-string tests, so don't hoist it to `vitest.config.ts`.

| Command   | What it does                                        |
| --------- | --------------------------------------------------- |
| `npm run dev`     | esbuild in watch mode for fast iteration |
| `npm run build`   | `tsc --noEmit` typecheck, then a production bundle   |
| `npm test`        | Vitest, all `*.test.ts`                              |
| `npm run changelog:dry` | Preview the release notes a release would generate |
| `npm run lint:commits`  | Check commit subjects are conventional          |

Run `npm test` and `npm run build` before considering a change done. Both run in CI on every push and pull request.

`npm audit` reports moderate advisories in `@vitest/mocker` (via `vitest`) and `moment` (via `obsidian`) that are deliberate to leave: neither ships, since `obsidian` is `external` in the esbuild config, so `moment` never reaches `main.js`. Don't run `npm audit fix --force` to clear them — it offers to *downgrade* `obsidian` to `0.14.5`, which predates the 1.13 APIs used here, and to bump `vitest` to `5.0.3`, which will not install against the pinned `esbuild@0.25.5`. Either one breaks the build.

## Releasing

Bump `version` in `manifest.json` and merge. That edit is the only trigger:
`release.yml` diffs it, and when it changes, runs
`scripts/generate-changelog.mjs` to write this release's entry into
`src/changelog.json` from the commits since the last tag, then builds. Both
generated files — `src/changelog.json` and the built `main.js` — are
committed back to `main`, and the tag is created from that commit.

Order matters here, and the store enforces it: the Obsidian store rebuilds
the plugin from the tag and compares that build to the released `main.js`, so
the tag, `main`, and the release asset must all hold the same build. Anything
the build reads has to be committed *before* the tag is taken, not after. A
release that commits its generated files but tags the commit before them ships
an asset the store cannot reproduce — which is what 4.7.0 and 4.7.1 did.

Commit subjects are the source of the notes, so write them for a user:

```
feat: add configurable table border color   →  Added configurable table border color.
fix: latex math symbol missing              →  Fixed latex math symbol missing.
chore: bump version to 4.6.0                →  (left out — nothing to tell a user)
```

`feat`, `fix`, `perf` and `revert` reach the notes. Everything else is
internal and dropped, as are merge commits and the `Update main.js`-style
subjects the GitHub web editor produces.

`classifySubject()` in `scripts/changelog-entries.mjs` is the single answer to
"what is this subject?", and both the generator and `check-commits.mjs` use it.
It sorts a subject three ways: **user-facing** (goes in the notes), **internal**
(deliberately not in the notes, and nothing to report — a `chore:`, a merge, a
web-editor file update), and **unreadable** (not in the notes, and someone
should know). Only the last one fails the build, and the release log lists
those separately as changes that will go unannounced. Adding a case to one tool
without the other is how they drift apart; add it to `classifySubject`.

`scripts/check-commits.mjs` runs on pull requests *and* on pushes to `main`. On
a push the check is a signal, not a gate: the commit is already published, so it
makes an unreadable subject visible rather than preventing it. Only the
newly-pushed range is checked, so pre-existing history cannot fail it.

`src/changelog.json` is generated. Edit `scripts/changelog-entries.mjs` to
change how subjects are read or rewritten, not the JSON.

The `.d.mts` files beside the scripts declare their types for `tsc`;
`tsconfig.json` includes them so they are actually checked. Keep them in step
with the `.mjs` — a stale declaration is not caught by anything else.

Both scripts are covered by tests that build a throwaway git repository and
run the real thing against it — `scripts/generate-changelog.test.ts` and
`scripts/check-commits.test.ts`. If you change the tag handling, the cap or
the dry-run behaviour, add a case there rather than only in
`changelog-entries.test.ts`, which covers the string rewriting alone.

## Agent skills

### Issue tracker

Issues live in GitHub Issues, accessed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles map to same-named labels, plus `resolved`: this repo's close-as-completed terminal state. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.