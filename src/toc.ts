// ─────────────────────────────────────────────────────────────────────────────
// Table-of-contents page generation.
//
// Builds the Contents page(s) that can be placed before the exported content.
// Entries are taken from the *paginated* content, so the page numbers they show
// are the pages the reader will actually land on rather than an estimate. The
// entries are then re-numbered by the number of pages the contents itself
// occupies — which means the contents and its numbering depend on each other,
// and are solved together by paginateToc() below.
//
// DOM-building only: no Obsidian API beyond the createDiv/createSpan element
// helpers the rest of the render path already relies on, and no stylesheet of
// its own — everything is inline so it survives the pagination sandbox, the
// preview shadow DOM, and the export HTML unchanged.
// ─────────────────────────────────────────────────────────────────────────────

import { OutlineEntry, paginateEl } from "./paginator";

export interface TocOptions {
  title: string;
  /** Deepest heading level to include, 1–6. */
  maxLevel: number;
  showPageNumbers: boolean;
}

export interface TocPagePlan {
  /** One array of nodes per contents page, ready to be placed before the content. */
  tocPages: HTMLElement[][];
  /** True when the paginator had to overflow a contents page (see paginateEl). */
  overflowed: boolean;
}

/** The paginator paginateToc() drives. Injectable so the numbering loop can be
 *  exercised with a page-count stand-in instead of real layout. */
export type TocPaginator = (
  sourceEl: HTMLElement,
  contentWidthPx: number,
  contentHeightPx: number,
  docCSS: string,
) => { pages: HTMLElement[][]; overflowed: boolean };

/** Drops entries deeper than `maxLevel` (and untitled ones), then advances every
 *  remaining page number by `pageOffset` — the number of contents pages that
 *  will precede the content in the finished PDF. Pure, so the numbering rule can
 *  be tested without any layout. */
export function shiftTocEntries(
  entries: OutlineEntry[],
  maxLevel: number,
  pageOffset: number,
): OutlineEntry[] {
  return entries
    .filter((e) => e.title.trim().length > 0 && e.level <= maxLevel)
    .map((e) => ({ title: e.title, level: e.level, page: e.page + pageOffset }));
}

/** Builds the contents as a single element whose block children — the title and
 *  one row per entry — the paginator distributes across pages. Returns null when
 *  no entry is eligible, so callers can leave the content untouched. */
export function buildTocSectionEl(
  entries: OutlineEntry[],
  options: TocOptions,
  isRTL: boolean,
): HTMLElement | null {
  const included = entries.filter((e) => e.title.trim().length > 0 && e.level <= options.maxLevel);
  if (included.length === 0) return null;

  const section = createDiv({ cls: "mpdf-toc" });
  if (isRTL) section.setAttribute("dir", "rtl");

  if (options.title.trim()) {
    const titleEl = createDiv({ cls: "mpdf-toc-title" });
    titleEl.textContent = options.title;
    titleEl.setCssStyles({
      fontSize: "1.55em",
      fontWeight: "700",
      margin: "0 0 0.9em",
      lineHeight: "1.2",
      paddingBottom: "0.35em",
      borderBottom: "2px solid rgba(128,128,128,0.35)",
    });
    section.appendChild(titleEl);
  }

  for (const entry of included) {
    section.appendChild(buildTocRow(entry, options.showPageNumbers));
  }
  return section;
}

/** One contents row: title, a dotted leader, and (optionally) the page number.
 *  The leader is a flex filler with a dotted bottom border, which is the one
 *  dot-leader technique Chromium renders consistently in print. */
function buildTocRow(entry: OutlineEntry, showPageNumber: boolean): HTMLElement {
  const row = createDiv({ cls: "mpdf-toc-row" });
  row.setCssStyles({
    display: "flex",
    alignItems: "baseline",
    gap: "0.5em",
    paddingInlineStart: `${(entry.level - 1) * 1.4}em`,
    fontSize: entry.level === 1 ? "1em" : "0.94em",
    fontWeight: entry.level <= 2 ? "600" : "400",
    lineHeight: "1.7",
    marginBottom: "0.2em",
    opacity: entry.level >= 4 ? "0.85" : "1",
  });

  const label = createSpan({ cls: "mpdf-toc-label", text: entry.title });
  label.setCssStyles({ overflowWrap: "anywhere" });
  row.appendChild(label);

  if (showPageNumber) {
    const leader = createSpan({ cls: "mpdf-toc-leader" });
    leader.setCssStyles({
      flex: "1 1 auto",
      minWidth: "1.5em",
      alignSelf: "flex-end",
      borderBottom: "1px dotted rgba(128,128,128,0.6)",
      marginBottom: "0.3em",
    });
    row.appendChild(leader);

    const page = createSpan({ cls: "mpdf-toc-page", text: String(entry.page) });
    page.setCssStyles({ flex: "0 0 auto", fontVariantNumeric: "tabular-nums" });
    row.appendChild(page);
  }
  return row;
}

/** Paginates the contents, solving for the two-way dependency between the number
 *  of contents pages and the page numbers those pages print. Starting from the
 *  assumption of one contents page, the entries are numbered, the contents is
 *  measured, and if it needed more pages the numbering is redone against that
 *  count. A second pass is normally enough — only the width of a page number can
 *  change — and maxPasses keeps a pathological document from spinning. */
export function paginateToc(
  entries: OutlineEntry[],
  options: TocOptions,
  isRTL: boolean,
  contentWidthPx: number,
  contentHeightPx: number,
  docCSS: string,
  paginate: TocPaginator = paginateEl,
  maxPasses = 5,
): TocPagePlan | null {
  const eligible = shiftTocEntries(entries, options.maxLevel, 0);
  if (eligible.length === 0) return null;

  let pageCount = 1;
  let tocPages: HTMLElement[][] = [];
  let overflowed = false;

  for (let pass = 0; pass < maxPasses; pass++) {
    const numbered = shiftTocEntries(entries, options.maxLevel, pageCount);
    const section = buildTocSectionEl(numbered, options, isRTL);
    if (!section) return null;

    const result = paginate(section, contentWidthPx, contentHeightPx, docCSS);
    tocPages = result.pages;
    overflowed = result.overflowed;
    if (tocPages.length === pageCount) break;
    pageCount = tocPages.length;
  }

  return { tocPages, overflowed };
}