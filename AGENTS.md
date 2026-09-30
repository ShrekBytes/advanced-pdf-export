# AGENTS.md

Guidance for agents working in this repo. See `README.md` for what the plugin does and `docs/agents/` for how the engineering skills are wired up.

## Project shape

An Obsidian plugin. TypeScript sources live flat in `src/`, bundled to `main.js` by esbuild — `main.js` is a build artefact, not a source file. Styles are in `styles.css` and `src/css-builder.ts`.

Unit tests sit next to the file they cover as `src/*.test.ts` and run under Vitest. The `obsidian` package ships types only, so a module that imports it can't be tested — keep testable logic import-free.

| Command   | What it does                                        |
| --------- | --------------------------------------------------- |
| `npm run dev`     | esbuild in watch mode for fast iteration |
| `npm run build`   | `tsc --noEmit` typecheck, then a production bundle   |
| `npm test`        | Vitest, all `*.test.ts`                              |
| `npm run changelog:dry` | Preview the release notes a release would generate |
| `npm run lint:commits`  | Check commit subjects are conventional          |

Run `npm test` and `npm run build` before considering a change done. Both run in CI on every push and pull request.

## Releasing

Bump `version` in `manifest.json` and merge. That edit is the only trigger:
`release.yml` diffs it, and when it changes, runs
`scripts/generate-changelog.mjs` to write this release's entry into
`src/changelog.json` from the commits since the last tag, builds, tags, and
publishes. The generated file is committed back to `main` afterwards, so
`main` and the published bundle never disagree.

Commit subjects are the source of the notes, so write them for a user:

```
feat: add configurable table border color   →  Added configurable table border color.
fix: latex math symbol missing              →  Fixed latex math symbol missing.
chore: bump version to 4.6.0                →  (left out — nothing to tell a user)
```

`feat`, `fix`, `perf` and `revert` reach the notes. Everything else is
internal and dropped, as are merge commits and the `Update main.js`-style
subjects the GitHub web editor produces. A subject that is none of these is
also dropped — `scripts/check-commits.mjs` runs on pull requests *and* on
pushes to `main`, and the release log lists whatever was skipped so nothing
disappears quietly. On a push the check is a signal, not a gate: the commit is
already published, so it makes an unreadable subject visible rather than
preventing it.

`src/changelog.json` is generated. Edit `scripts/changelog-entries.mjs` to
change how subjects are read or rewritten, not the JSON.

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