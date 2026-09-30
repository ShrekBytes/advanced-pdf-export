import type { ReleaseEntry } from "../src/changelog";

export interface ParsedCommit {
  /** One of the user-facing types; toChangeLine maps it to a verb. */
  type: "feat" | "fix" | "perf" | "revert";
  scope: string;
  breaking: boolean;
  description: string;
}

export interface BuiltChanges {
  /** One user-facing sentence per user-facing commit. */
  changes: string[];
  /** Subjects that were not conventional commits, for reporting. */
  skipped: string[];
}

export interface AddEntryResult {
  entries: ReleaseEntry[];
  added: boolean;
  /** Versions pushed past the cap, oldest last. */
  dropped: string[];
}

/** How many releases the history carries. */
export declare const MAX_ENTRIES: number;

export declare function parseSubject(subject: string): ParsedCommit | null;
export declare function toChangeLine(commit: ParsedCommit): string;
export declare function buildChanges(subjects: string[]): BuiltChanges;
export declare function addEntry(
  entries: ReleaseEntry[],
  entry: ReleaseEntry,
  max?: number,
): AddEntryResult;
