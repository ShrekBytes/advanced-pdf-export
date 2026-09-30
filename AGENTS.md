# AGENTS.md

Guidance for agents working in this repo. See `README.md` for what the plugin does and `docs/agents/` for how the engineering skills are wired up.

## Project shape

An Obsidian plugin. TypeScript sources live flat in `src/`, bundled to `main.js` by esbuild — `main.js` is a build artefact, not a source file. Styles are in `styles.css` and `src/css-builder.ts`.

Unit tests sit next to the file they cover as `src/*.test.ts` and run under Vitest. The `obsidian` package ships types only, so a module that imports it can't be tested — keep testable logic import-free.

| Command   | What it does                                        |
| --------- | --------------------------------------------------- |
| `npm run dev`     | esbuild in watch mode for fast iteration |
| `npm run build`   | `tsc --noEmit` typecheck, then a production bundle   |
| `npm test`        | Vitest, all `src/*.test.ts`                         |

Run `npm test` and `npm run build` before considering a change done. Both run in CI on every push and pull request.

## Agent skills

### Issue tracker

Issues live in GitHub Issues, accessed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles map to same-named labels, plus `resolved`: this repo's close-as-completed terminal state. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.