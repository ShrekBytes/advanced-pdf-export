// ─────────────────────────────────────────────────────────────────────────────
// Naming and locating the PDF offered in the save dialog.
//
// With no suggestion, the save dialog's default is a bare file name, so it opens
// wherever the OS last remembered and the user re-picks the folder every time.
// Given a source note, we can point it at the note's own folder instead.
//
// Deliberately free of any import: the `obsidian` package ships types only
// ("main": ""), so anything reaching for it cannot be exercised by a test.
// Keep it that way — see save-path.test.ts.
// ─────────────────────────────────────────────────────────────────────────────

/** The parts of a vault note this needs — a structural subset of TFile. */
export interface SavePathSource {
  /** Vault-relative path, e.g. "Notes/Ideas/xyz.md". */
  path: string;
  /** File name without its last extension, e.g. "xyz" for "Contract.pdf.md". */
  basename: string;
}

/**
 * The PDF's file name for a given note base name, or null when there is no
 * usable name left.
 *
 * Obsidian strips only the last extension, so "Contract.pdf.md" has base name
 * "Contract.pdf" — appending another ".pdf" would yield "Contract.pdf.pdf".
 * Strip it here, once, so the pre-filled and fallback names can't drift apart.
 */
export function pdfFileName(basename: string | undefined): string | null {
  const stem = (basename ?? "").replace(/\.pdf$/i, "");
  return stem ? stem + ".pdf" : null;
}

/**
 * Absolute path the save dialog should open on: the note's own folder, with a
 * `.pdf` name derived from its base name.
 *
 * Returns null when there is nothing sensible to point at — no source note, a
 * vault with no local folder to resolve against, or a base name that reduces to
 * nothing. Callers should fall back to the bare file name in that case.
 */
export function resolveSaveLocation(
  file: SavePathSource | null,
  absoluteFolder: (vaultFolder: string) => string | null,
): string | null {
  if (!file) return null;

  const name = pdfFileName(file.basename);
  if (!name) return null;

  // "Notes/xyz.md" → "Notes"; "xyz.md" → "" (the vault root). Note the -1
  // guard: slicing at -1 would take "xyz.md" down to "xyz.m".
  const cut = file.path.lastIndexOf("/");
  const folder = cut === -1 ? "" : file.path.slice(0, cut);

  const base = absoluteFolder(folder);
  if (!base) return null;

  const sep = base.includes("\\") ? "\\" : "/";
  return base.endsWith("/") || base.endsWith("\\") ? base + name : base + sep + name;
}