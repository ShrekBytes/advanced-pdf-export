// ─────────────────────────────────────────────────────────────────────────────
// Table-of-contents generation from inline markers.
//
// A table of contents is not a document-level toggle: it is inserted wherever
// the author places a marker on its own line. Two marker families exist:
//
//   {{toc}}                full-page contents; page breaks before and after
//   {{toc_compact}}        compact contents flowing with the surrounding text
//
// Both accept an optional count, an optional depth, and a title:
//
//   {{toc_5}}              the next five headings below the marker, at any level
//   {{toc_d3}}             the whole document, limited to H1–H3
//   {{toc_5_d3}}           the next five headings, limited to H1–H3
//   {{toc:Custom title}}   the whole document, under a custom heading
//   {{toc_compact_5:...}}  compact, five headings, custom heading
//
// A count without a depth is positional: it takes the next headings whatever
// their level, so the configured depth does not narrow it. Naming a depth is
// what re-applies the level filter, to the count when both are present.
//
// Page numbers are resolved from the paginated layout by the caller, so the
// numbers printed here are the ones the reader lands on. Selecting which
// headings a marker covers is a pure function of the ordered heading list and
// the marker's position among them, which keeps it testable without layout.
// ─────────────────────────────────────────────────────────────────────────────

import { OutlineEntry, PageLayout, extractOutlineEntries } from "./paginator";

export type TocKind = "full" | "compact";

export interface TocMarkerSpec {
  id: number;
  kind: TocKind;
  /** Explicit number of headings to include, from `{{toc_N}}`. */
  count?: number;
  /** Explicit deepest heading level, from the `d` suffix (`{{toc_dN}}`, `{{toc_N_dN}}`). */
  depth?: number;
  /** Explicit heading text, from `{{toc:Title}}`. */
  title?: string;
}

export interface TocSettings {
  defaultTitle: string;
  /** Deepest heading level included in a full-page contents. */
  fullDepth: number;
  /** Full-page font size as a multiple of the body font size. */
  fullFontSizeEm: number;
  /** Full-page line-height multiplier. */
  fullLineHeight: number;
  fullShowPageNumbers: boolean;
  /** Deepest heading level included in a compact contents. */
  compactDepth: number;
  /** Compact font size as a multiple of the body font size. */
  compactFontSizeEm: number;
  /** Compact line-height multiplier; also the height of the surrounding blank line. */
  compactLineHeight: number;
  compactShowPageNumbers: boolean;
  /** Minimum width in em of the compact dashed leader after the title. */
  compactLeaderLengthEm: number;
}

// ─── Marker parsing ──────────────────────────────────────────────────────────

/** Marker grammar. Case-sensitive: only the exact lower-case forms match. */
const MARKER_RE = /^\{\{(toc_compact|toc)(?:_(\d+))?(?:_d(\d+))?(?::(.*))?\}\}$/;

/**
 * Anchor token substituted for a marker before rendering. A private marker is
 * needed because the table of contents can only be built once every heading has
 * been paginated, which happens after the markdown has been rendered. The token
 * is a single line of plain text; Obsidian renders it as a paragraph, which the
 * caller replaces with the generated contents.
 */
const ANCHOR_RE = /^MPDF-TOC-ANCHOR-([FC])-(\d+)-9F3C$/;

function anchorText(id: number, kind: TocKind): string {
  return `MPDF-TOC-ANCHOR-${kind === "full" ? "F" : "C"}-${id}-9F3C`;
}

/** Decodes an anchor paragraph's text, or null when the paragraph is not one. */
export function parseTocAnchor(text: string): { kind: TocKind; id: number } | null {
  const match = ANCHOR_RE.exec(text.trim());
  if (!match) return null;
  return { kind: match[1] === "F" ? "full" : "compact", id: parseInt(match[2], 10) };
}

export interface TocMarkerParseResult {
  /** Markdown with every valid marker replaced by an anchor line. */
  markdown: string;
  markers: TocMarkerSpec[];
}

/**
 * Replaces each valid marker line with an anchor. Fenced code is skipped, and a
 * marker must begin at column zero and occupy the whole line; anything else —
 * an indented marker, a marker inside inline code, a malformed count — is left
 * as literal text.
 */
export function replaceTocMarkers(md: string): TocMarkerParseResult {
  const markers: TocMarkerSpec[] = [];
  const out: string[] = [];
  let inFence = false;
  let fenceMarker = "";

  for (const line of md.split("\n")) {
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fence[1];
      } else if (fence[1][0] === fenceMarker[0] && fence[1].length >= fenceMarker.length) {
        inFence = false;
      }
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }

    // Column zero only: an indented line may belong to a list or blockquote,
    // which this feature does not support.
    const atColumnZero = line === line.replace(/^\s+/, "");
    const match = atColumnZero ? MARKER_RE.exec(line.trim()) : null;
    if (!match) {
      out.push(line);
      continue;
    }

    const kind: TocKind = match[1] === "toc_compact" ? "compact" : "full";
    const count = match[2] !== undefined ? parseInt(match[2], 10) : undefined;
    if (count !== undefined && (!Number.isFinite(count) || count < 1)) {
      out.push(line);
      continue;
    }
    const depth = match[3] !== undefined ? parseInt(match[3], 10) : undefined;
    if (depth !== undefined && (depth < 1 || depth > 6)) {
      out.push(line);
      continue;
    }
    const title = match[4]?.trim();

    const id = markers.length;
    markers.push({ id, kind, count, depth, title: title || undefined });
    // Blank lines around the anchor force it into its own paragraph regardless
    // of the source spacing.
    out.push("", anchorText(id, kind), "");
  }

  return { markdown: out.join("\n"), markers };
}

/** True when a line is a full-page contents anchor, which forces page breaks. */
export function isFullTocAnchorLine(line: string): boolean {
  const match = ANCHOR_RE.exec(line.trim());
  return match?.[1] === "F";
}

/**
 * Splits a section around full-page contents anchors. Each anchor becomes its
 * own section, and the sections before and after it become their own, which is
 * what gives a full-page contents a page break on both sides.
 */
export function splitSectionAtFullToc(section: string): string[] {
  const parts: string[] = [];
  let buffer: string[] = [];
  const flush = () => {
    const text = buffer.join("\n").trim();
    if (text) parts.push(text);
    buffer = [];
  };

  for (const line of section.split("\n")) {
    if (isFullTocAnchorLine(line)) {
      flush();
      parts.push(line.trim());
    } else {
      buffer.push(line);
    }
  }
  flush();
  return parts;
}

// ─── Heading selection ───────────────────────────────────────────────────────

/**
 * Chooses the headings a marker covers.
 *
 * - An explicit count takes the next `count` headings below the marker, in
 *   document order. On its own it selects by position, not by level: only a
 *   marker that names a depth applies a level filter, so a bare count ignores
 *   the configured depth. Naming both a count and a depth applies the depth
 *   first, then takes `count`.
 * - An explicit depth (`{{toc_dN}}`) narrows selection to H1–H`N`, taking
 *   precedence over the configured depth whether or not a count is present.
 * - A full-page marker without a count covers the whole document.
 * - A compact marker without a count covers the first heading below the marker
 *   together with its descendants, stopping before the next heading at the same
 *   or a higher level.
 *
 * `firstHeadingIndex` is the index, in the ordered heading list, of the first
 * heading below the marker. `maxLevel` is the configured depth, used only when
 * the marker names no depth of its own.
 */
export function selectTocEntries(
  headings: OutlineEntry[],
  spec: TocMarkerSpec,
  firstHeadingIndex: number,
  maxLevel: number,
): OutlineEntry[] {
  const depth = spec.depth ?? maxLevel;
  const withinDepth = (entry: OutlineEntry) => entry.level <= depth;

  if (spec.count !== undefined) {
    const below = headings.slice(firstHeadingIndex);
    // A count on its own is positional; only a marker that names a depth is
    // narrowed to the configured or explicit level range.
    return (spec.depth !== undefined ? below.filter(withinDepth) : below).slice(0, spec.count);
  }

  if (spec.kind === "full") {
    return headings.filter(withinDepth);
  }

  const below = headings.slice(firstHeadingIndex);
  if (below.length === 0) return [];

  const anchorLevel = below[0].level;
  const span: OutlineEntry[] = [];
  for (const entry of below) {
    if (span.length > 0 && entry.level <= anchorLevel) break;
    span.push(entry);
  }
  return span.filter(withinDepth);
}

// ─── DOM construction ────────────────────────────────────────────────────────

/** Resolves the full-page contents heading, falling back to the configured default. */
export function resolveTocTitle(spec: TocMarkerSpec, settings: TocSettings): string {
  return spec.title ?? settings.defaultTitle;
}

/**
 * A contents entry may only print a page number that the footer also prints, so
 * the global page-number switch gates both contents types on top of their own
 * per-type switch. Disabling either one turns the contents page numbers off.
 */
export function resolveTocPageNumberVisibility(
  perTypeEnabled: boolean,
  globalEnabled: boolean,
): boolean {
  return perTypeEnabled && globalEnabled;
}

/**
 * Maps every heading level present in a contents scope to its indentation rank.
 * Indentation is relative to the scope, not to the absolute heading number: the
 * shallowest level present is flush left, and each further level is indented by
 * its position among the levels actually used. A scope holding only H2 and H6
 * therefore indents the H6 once, not four times.
 */
export function buildIndentRanks(entries: OutlineEntry[]): Map<number, number> {
  const levels = Array.from(new Set(entries.map((entry) => entry.level))).sort((a, b) => a - b);
  return new Map(levels.map((level, index) => [level, index]));
}

/** Builds the entry label, linked to its heading when the heading carries an id
 *  so the exported PDF keeps a clickable internal link. */
function buildTocLabel(entry: OutlineEntry, containerClass: string): HTMLElement {
  const container = createSpan({ cls: containerClass });
  if (entry.id) {
    const anchor = createEl("a", { cls: "mpdf-toc-link" });
    anchor.setAttribute("href", `#${entry.id}`);
    anchor.textContent = entry.title;
    // The entry itself carries the emphasis; the link decoration would add a
    // second underline under every row.
    anchor.setCssStyles({ textDecoration: "none", color: "inherit" });
    container.appendChild(anchor);
  } else {
    container.textContent = entry.title;
  }
  return container;
}

function buildFullRow(entry: OutlineEntry, showPageNumbers: boolean, indentRank: number): HTMLElement {
  const row = createDiv({ cls: "mpdf-toc-row" });
  row.setCssStyles({
    display: "flex",
    alignItems: "center",
    gap: "0.5em",
    paddingInlineStart: `${indentRank * 1.4}em`,
    fontSize: entry.level === 1 ? "1em" : "0.94em",
    fontWeight: entry.level <= 2 ? "600" : "400",
    marginBottom: "0.2em",
    opacity: entry.level >= 4 ? "0.85" : "1",
  });

  const label = buildTocLabel(entry, "mpdf-toc-label");
  label.setCssStyles({ overflowWrap: "anywhere" });
  row.appendChild(label);

  if (showPageNumbers) {
    const leader = createSpan({ cls: "mpdf-toc-leader" });
    leader.setCssStyles({
      flex: "1 1 auto",
      minWidth: "1.5em",
      alignSelf: "center",
      borderTop: "1px dashed rgba(128,128,128,0.6)",
    });
    row.appendChild(leader);

    const page = createSpan({ cls: "mpdf-toc-page", text: entry.label });
    page.setCssStyles({ flex: "0 0 auto", fontVariantNumeric: "tabular-nums" });
    row.appendChild(page);
  }
  return row;
}

function buildCompactRow(
  entry: OutlineEntry,
  showPageNumbers: boolean,
  leaderLengthEm: number,
  indentRank: number,
): HTMLElement {
  const row = createDiv({ cls: "mpdf-toc-row" });
  row.setCssStyles({
    display: "flex",
    alignItems: "center",
    gap: "0.5em",
    paddingInlineStart: `${indentRank * 1.4}em`,
  });

  const label = buildTocLabel(entry, "mpdf-toc-label");
  label.setCssStyles({
    flex: "0 0 auto",
    overflowWrap: "anywhere",
    fontWeight: entry.level <= 2 ? "600" : "400",
  });
  row.appendChild(label);

  if (showPageNumbers) {
    // The leader grows to fill whatever space the title leaves, so it always
    // starts immediately after the title and stops at the fixed page column.
    // A zero-height box centred in the row places its top border on the text
    // mid-line rather than under it.
    const leader = createSpan({ cls: "mpdf-toc-leader" });
    leader.setCssStyles({
      flex: "1 1 auto",
      minWidth: `${leaderLengthEm}em`,
      alignSelf: "center",
      borderTop: "1px dashed rgba(128,128,128,0.6)",
    });
    row.appendChild(leader);

    const page = createSpan({ cls: "mpdf-toc-page", text: entry.label });
    page.setCssStyles({ flex: "0 0 auto", fontVariantNumeric: "tabular-nums" });
    row.appendChild(page);
  }
  return row;
}

/**
 * Builds a full-page contents block. Its direct children are the title and one
 * row per entry; the paginator's container splitter distributes those children
 * across pages, so a long contents is never clipped.
 */
export function buildFullTocElement(
  entries: OutlineEntry[],
  title: string,
  showPageNumbers: boolean,
  settings: TocSettings,
  isRTL: boolean,
): HTMLElement {
  const root = createDiv({ cls: "mpdf-toc mpdf-toc-full" });
  if (isRTL) root.setAttribute("dir", "rtl");
  root.setCssStyles({
    fontSize: `${settings.fullFontSizeEm}em`,
    lineHeight: String(settings.fullLineHeight),
  });

  if (title.trim()) {
    const titleEl = createDiv({ cls: "mpdf-toc-title" });
    titleEl.textContent = title;
    titleEl.setCssStyles({
      fontSize: "1.55em",
      fontWeight: "700",
      margin: "0 0 0.9em",
      lineHeight: "1.2",
      paddingBottom: "0.35em",
      borderBottom: "2px solid rgba(128,128,128,0.35)",
    });
    root.appendChild(titleEl);
  }

  const ranks = buildIndentRanks(entries);
  for (const entry of entries) root.appendChild(buildFullRow(entry, showPageNumbers, ranks.get(entry.level) ?? 0));
  return root;
}

/**
 * Builds a compact contents block. It is `fit-content` wide, so the block is
 * only as wide as its longest row — the long title plus the configured leader
 * length plus the page number — while each row stretches to that width. A short
 * title therefore gets a longer leader rather than a blank gap, and every page
 * number lands on the same right edge.
 *
 * A compact contents carries a heading only when its marker supplied one; the
 * configured default heading is not applied here, so the block stays short by
 * default.
 */
export function buildCompactTocElement(
  entries: OutlineEntry[],
  title: string,
  showPageNumbers: boolean,
  settings: TocSettings,
  isRTL: boolean,
): HTMLElement {
  const root = createDiv({ cls: "mpdf-toc mpdf-toc-compact" });
  if (isRTL) root.setAttribute("dir", "rtl");
  root.setCssStyles({
    display: "block",
    width: "fit-content",
    maxWidth: "100%",
    fontSize: `${settings.compactFontSizeEm}em`,
    lineHeight: String(settings.compactLineHeight),
    // One blank line of separation from the surrounding text, on both sides.
    marginTop: `${settings.compactLineHeight}em`,
    marginBottom: `${settings.compactLineHeight}em`,
  });

  if (title.trim()) {
    const titleEl = createDiv({ cls: "mpdf-toc-title" });
    titleEl.textContent = title;
    titleEl.setCssStyles({
      textAlign: "start",
      fontWeight: "700",
      fontSize: "1.15em",
      paddingBottom: "0.4em",
    });
    root.appendChild(titleEl);
  }

  const ranks = buildIndentRanks(entries);
  for (const entry of entries) {
    root.appendChild(buildCompactRow(entry, showPageNumbers, settings.compactLeaderLengthEm, ranks.get(entry.level) ?? 0));
  }
  return root;
}

/** Builds the contents block a marker designates. */
export function buildTocElement(
  spec: TocMarkerSpec,
  entries: OutlineEntry[],
  settings: TocSettings,
  isRTL: boolean,
): HTMLElement {
  if (spec.kind === "full") {
    const title = spec.title ?? settings.defaultTitle;
    return buildFullTocElement(entries, title, settings.fullShowPageNumbers, settings, isRTL);
  }
  // The compact form prints a heading only when the marker supplied one.
  return buildCompactTocElement(
    entries,
    spec.title ?? "",
    settings.compactShowPageNumbers,
    settings,
    isRTL,
  );
}

// ─── Bookmarks ─────────────────────────────────────────────────────────────

function nodeContainsTocId(node: HTMLElement, id: number): boolean {
  if (node.getAttribute("data-mpdf-toc-id") === String(id)) return true;
  return node.querySelector(`[data-mpdf-toc-id="${id}"]`) !== null;
}

/** Physical page on which a generated contents first appears, or null. */
function findTocStartPage(layouts: PageLayout[], id: number): number | null {
  for (const layout of layouts) {
    if (layout.pageNodes.some((node) => nodeContainsTocId(node, id))) return layout.pageNum;
  }
  return null;
}

/**
 * Builds the PDF bookmark list. Full-page contents pages are bookmarked at their
 * physical position, interleaved with the document's own headings, so a reader's
 * outline lists a generated contents where it appears rather than at the end.
 * Compact contents are page-level flow content and get no bookmark.
 */
export function collectBookmarkEntries(
  layouts: PageLayout[],
  specs: TocMarkerSpec[],
  settings: TocSettings,
): OutlineEntry[] {
  const contentsStarts = new Map<number, TocMarkerSpec>();
  for (const spec of specs) {
    if (spec.kind !== "full") continue;
    const page = findTocStartPage(layouts, spec.id);
    if (page !== null && !contentsStarts.has(page)) contentsStarts.set(page, spec);
  }

  const entries: OutlineEntry[] = [];
  for (const layout of layouts) {
    const spec = contentsStarts.get(layout.pageNum);
    if (spec) {
      entries.push({
        title: resolveTocTitle(spec, settings),
        level: 1,
        page: layout.pageNum,
        label: layout.displayPageLabel,
      });
    }
    entries.push(...extractOutlineEntries([layout]));
  }
  return entries;
}
