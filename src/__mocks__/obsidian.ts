// Runtime stand-in for the `obsidian` package, which ships type definitions only
// and therefore has no entry point for a test runner to resolve. Wired up by the
// `obsidian` alias in vitest.config.ts; TypeScript still typechecks against the
// real obsidian.d.ts, since the alias only applies to the test runner.
//
// Covers what the modules under test import. A test that needs real behaviour
// here should build its own fake for the narrow API it calls.

export class App {}

export class TFile {}

/** Network access has no place in a unit test — fail loudly if something reaches it. */
export function requestUrl(): never {
  throw new Error("requestUrl is not available in tests");
}
