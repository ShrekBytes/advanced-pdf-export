import type { ReleaseEntry, AddEntryResult } from "./changelog-entries.mjs";

export interface GenerateOptions {
  /** Repository root. Defaults to the one this script lives in. */
  root?: string;
  /** Report what would be written without touching the file. */
  dryRun?: boolean;
  /** Where the human-readable report goes. Defaults to the console. */
  log?: (message: string) => void;
}

export interface GenerateResult {
  entry: ReleaseEntry;
  result: AddEntryResult;
  /** Subjects deliberately kept out of the notes. */
  skipped: string[];
  /** Subjects that could not be read, so the change is unannounced. */
  unreadable: { subject: string; reason: string }[];
  /** The tag the range was measured from. */
  tag: string;
}

export declare function generate(options?: GenerateOptions): GenerateResult;
