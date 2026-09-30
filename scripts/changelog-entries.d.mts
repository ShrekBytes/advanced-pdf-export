import type { ReleaseEntry, AddEntryResult } from "../src/changelog";

export type CommitType = "feat" | "fix" | "perf" | "revert";

export interface ParsedCommit {
  /** One of the user-facing types; toChangeLine maps it to a verb. */
  type: CommitType;
  scope: string;
  breaking: boolean;
  description: string;
}

export type Classification =
  | { kind: "user-facing"; commit: ParsedCommit }
  | { kind: "internal"; reason: string }
  | { kind: "unreadable"; reason: string };

export interface BuiltChanges {
  /** One user-facing sentence per user-facing commit. */
  changes: string[];
  /** Subjects deliberately kept out of the notes. */
  skipped: string[];
  /** Subjects that could not be read, so the change is unannounced. */
  unreadable: { subject: string; reason: string }[];
}

export interface AddEntryResult {
  entries: ReleaseEntry[];
  added: boolean;
  /** Versions pushed past the cap, oldest last. */
  dropped: string[];
}

export interface ReleaseBodyOptions {
  /** Tag this release follows, for the compare link. */
  previous?: string;
  /** Repository web root, e.g. "https://github.com/owner/repo". */
  compareBase?: string;
}

/** Every conventional type accepted, user-facing and internal alike. */
export declare const KNOWN_TYPES: Set<string>;

/** How many releases the history carries. */
export declare const MAX_ENTRIES: number;

export declare function classifySubject(subject: string): Classification;
export declare function parseSubject(subject: string): ParsedCommit | null;
export declare function toChangeLine(commit: ParsedCommit): string;
export declare function buildChanges(subjects: string[]): BuiltChanges;
export declare function toReleaseBody(
  entry: ReleaseEntry,
  options?: ReleaseBodyOptions,
): string;
export declare function addEntry(
  entries: ReleaseEntry[],
  entry: ReleaseEntry,
  max?: number,
): AddEntryResult;
