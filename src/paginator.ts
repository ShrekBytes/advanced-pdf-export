// ─────────────────────────────────────────────────────────────────────────────
// Pagination engine + PDF outline (bookmarks).
//
// Takes rendered HTML sections and distributes their block children into
// page-height buckets, splitting oversized elements by natural unit (line,
// row, list item, word/character). Also builds the per-page header/footer
// text (buildPageLayouts) and, for export, injects a bookmark tree into the
// finished PDF bytes derived from the same paginated headings. This is one
// self-contained algorithm — nothing here talks to Obsidian or the DOM
// outside of measuring already-rendered elements.
// ─────────────────────────────────────────────────────────────────────────────

import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNull, PDFNumber } from "pdf-lib";
import { PDFExportSettings } from "./settings";

/** One entry in the PDF outline/bookmark tree, extracted from the heading nodes. */
export interface OutlineEntry {
  title: string;
  level: number; // 1–6 matching H1–H6
  page:  number; // 1-indexed page number in the exported PDF
}

export interface PageLayout {
  pageNodes: HTMLElement[];
  pageNum: number;
  totalPages: number;
  pageShowsHeader: boolean;
  pageShowsFooter: boolean;
  hasHeader: boolean;
  hasFooter: boolean;
  headerLeft: string;
  headerCenter: string;
  headerRight: string;
  footerLeft: string;
  footerRight: string;
  footerCenter: string;
}

// ─── Shared measurement helpers ─────────────────────────────────────────────────

const INLINE_SPLIT_TAGS = new Set(["P", "LI", "BLOCKQUOTE", "TD", "TH"]);

const BLOCK_TAGS = new Set([
  "P", "DIV", "SECTION", "ARTICLE", "ASIDE", "NAV", "HEADER", "FOOTER",
  "UL", "OL", "LI", "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TD", "TH",
  "PRE", "BLOCKQUOTE", "HR", "IMG",
  "H1", "H2", "H3", "H4", "H5", "H6",
]);

// PRE is absent — it gets its own line-based splitter.
const UNSPLITTABLE_TAGS = new Set([
  "CODE", "IMG", "HR", "H1", "H2", "H3", "H4", "H5", "H6",
]);

// 2px guards against sub-pixel rendering differences between the light-DOM
// paginator sandbox and the shadow DOM preview context.
const HEIGHT_EPS = 2;

function measureNodesHeight(nodes: HTMLElement[], measureEl: HTMLElement): number {
  measureEl.empty();
  for (const node of nodes) measureEl.appendChild(node.cloneNode(true));
  return measureEl.getBoundingClientRect().height;
}

function makeFitFn(
  currentPage: HTMLElement[],
  measureEl: HTMLElement,
  contentHeightPx: number,
): (node: HTMLElement) => boolean {
  return (node: HTMLElement) =>
    measureNodesHeight([...currentPage, node], measureEl) <= contentHeightPx - HEIGHT_EPS;
}

// ── Inline (text) splitter ───────────────────────────────────────────────────

function trimLeadingWhitespace(el: HTMLElement): void {
  const walker = activeDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const trimmed = (node.textContent ?? "").replace(/^\s+/, "");
    if (trimmed !== node.textContent) node.textContent = trimmed;
    if (trimmed.length > 0) break;
  }
}

function buildInlineSplitAt(
  el: HTMLElement,
  splitOffset: number,
  trimSecond = true,
): [HTMLElement, HTMLElement] | null {
  const walker = activeDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let count = 0;
  let target: Text | null = null;
  let localOffset = 0;

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const len = node.textContent?.length ?? 0;
    if (count + len >= splitOffset) {
      target = node;
      localOffset = splitOffset - count;
      break;
    }
    count += len;
  }

  if (!target) return null;

  const range1 = activeDocument.createRange();
  range1.selectNodeContents(el);
  range1.setEnd(target, localOffset);

  const range2 = activeDocument.createRange();
  range2.selectNodeContents(el);
  range2.setStart(target, localOffset);

  const first = el.cloneNode(false) as HTMLElement;
  first.appendChild(range1.cloneContents());

  const second = el.cloneNode(false) as HTMLElement;
  second.appendChild(range2.cloneContents());
  if (trimSecond) trimLeadingWhitespace(second);

  return [first, second];
}

function getWordBoundaryOffsets(text: string): number[] {
  const offsets: number[] = [];
  const re = /\s+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (match.index > 0 && match.index < text.length) offsets.push(match.index);
  }
  return offsets;
}

function splitInlineElement(
  el: HTMLElement,
  fits: (node: HTMLElement) => boolean,
  forceSplit: boolean,
): [HTMLElement, HTMLElement] | null {
  const text = el.textContent ?? "";
  if (text.length < 2) return null;

  // First attempt: binary-search for the latest word boundary that fits.
  const offsets = getWordBoundaryOffsets(text);
  if (offsets.length > 0) {
    let lo = 0, hi = offsets.length - 1, bestIdx = -1;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const split = buildInlineSplitAt(el, offsets[mid]);
      if (!split) { hi = mid - 1; continue; }
      if (fits(split[0])) { bestIdx = mid; lo = mid + 1; }
      else                { hi = mid - 1; }
    }
    if (bestIdx >= 0) return buildInlineSplitAt(el, offsets[bestIdx]);
    if (!forceSplit) return null;
  }

  // Fallback: character-level binary search (oversized single word, or forced).
  let lo = 1, hi = text.length - 1, best = 0;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const split = buildInlineSplitAt(el, mid);
    if (!split) { hi = mid - 1; continue; }
    if (fits(split[0])) { best = mid; lo = mid + 1; }
    else                { hi = mid - 1; }
  }
  return best > 0 ? buildInlineSplitAt(el, best) : null;
}

// ── List splitter ────────────────────────────────────────────────────────────

function buildListWithItems(listEl: HTMLElement, items: HTMLElement[], startAt?: number): HTMLElement {
  const clone = listEl.cloneNode(false) as HTMLElement;
  // Preserve OL numbering across page breaks.
  if (listEl.tagName === "OL" && startAt !== undefined && startAt > 1) {
    (clone as HTMLOListElement).start = startAt;
  }
  for (const item of items) clone.appendChild(item.cloneNode(true));
  return clone;
}

function splitListElement(
  listEl: HTMLElement,
  fits: (node: HTMLElement) => boolean,
  forceSplit: boolean,
): [HTMLElement, HTMLElement] | null {
  const items = Array.from(listEl.children).filter(
    (c) => (c as HTMLElement).tagName === "LI",
  ) as HTMLElement[];
  if (items.length === 0) return null;

  // Respect an existing start attribute on continuation fragments.
  const existingStart = listEl.tagName === "OL"
    ? ((listEl as HTMLOListElement).start ?? 1)
    : 1;

  let fitCount = 0;
  for (let i = 0; i < items.length; i++) {
    if (fits(buildListWithItems(listEl, items.slice(0, i + 1), existingStart))) fitCount = i + 1;
    else break;
  }

  // When forced (alone on empty page), guarantee at least 1 item moves forward.
  if (fitCount <= 0) {
    if (!forceSplit || items.length < 2) return null;
    fitCount = 1;
  }
  if (fitCount >= items.length) return null;

  return [
    buildListWithItems(listEl, items.slice(0, fitCount), existingStart),
    // Second fragment starts at existingStart + fitCount so numbering is continuous.
    buildListWithItems(listEl, items.slice(fitCount), existingStart + fitCount),
  ];
}

// ── Table splitter ───────────────────────────────────────────────────────────

function buildTableWithRows(tableEl: HTMLTableElement, rows: HTMLTableRowElement[]): HTMLTableElement {
  const clone = tableEl.cloneNode(false) as HTMLTableElement;
  const caption = tableEl.querySelector("caption");
  if (caption) clone.appendChild(caption.cloneNode(true));
  const colgroup = tableEl.querySelector("colgroup");
  if (colgroup) clone.appendChild(colgroup.cloneNode(true));
  if (tableEl.tHead) clone.appendChild(tableEl.tHead.cloneNode(true));
  const tbody = createEl("tbody");
  for (const row of rows) tbody.appendChild(row.cloneNode(true));
  clone.appendChild(tbody);
  return clone;
}

function splitTableElement(
  tableEl: HTMLTableElement,
  fits: (node: HTMLElement) => boolean,
  forceSplit: boolean,
): [HTMLElement, HTMLElement] | null {
  const body = tableEl.tBodies[0];
  const rows = body
    ? Array.from(body.rows)
    : Array.from(tableEl.rows).filter((r) => r.parentElement?.tagName !== "THEAD");
  if (rows.length === 0) return null;

  let fitCount = 0;
  for (let i = 0; i < rows.length; i++) {
    if (fits(buildTableWithRows(tableEl, rows.slice(0, i + 1)))) fitCount = i + 1;
    else break;
  }

  // When forced (alone on empty page), guarantee at least 1 row moves forward.
  if (fitCount <= 0) {
    if (!forceSplit || rows.length < 2) return null;
    fitCount = 1;
  }
  if (fitCount >= rows.length) return null;

  return [
    buildTableWithRows(tableEl, rows.slice(0, fitCount)),
    buildTableWithRows(tableEl, rows.slice(fitCount)),
  ];
}

// ── PRE splitter ─────────────────────────────────────────────────────────────
// Splits a code block by line. When a <code> child is present (true for all
// fenced code blocks), buildInlineSplitAt's Range-based split preserves the
// nested Prism `.token.*` span structure across the break.

/** Character offsets (within the element's full text content) marking the
 *  start of the line *after* each line — i.e. valid split points. */
function getLineEndOffsets(lines: string[]): number[] {
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offset += line.length + 1; // +1 for the newline separating this line from the next
    offsets.push(offset);
  }
  return offsets;
}

function splitPreElement(
  preEl: HTMLElement,
  fits: (node: HTMLElement) => boolean,
  forceSplit: boolean,
): [HTMLElement, HTMLElement] | null {
  const codeEl = preEl.querySelector("code");
  const lines = (codeEl ?? preEl).textContent?.split("\n") ?? [];
  // Drop the trailing empty string that String.split() produces.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  if (lines.length < 2) return null;

  const lineEndOffsets = getLineEndOffsets(lines);

  // Splits at the boundary after the first `n` lines, preserving syntax
  // highlighting via Range.cloneContents() when a <code> child is present.
  const buildSplit = (n: number): [HTMLElement, HTMLElement] | null => {
    if (!codeEl) {
      const clone = (text: string) => {
        const el = preEl.cloneNode(false) as HTMLElement;
        el.textContent = text;
        return el;
      };
      return [clone(lines.slice(0, n).join("\n")), clone(lines.slice(n).join("\n"))];
    }
    const split = buildInlineSplitAt(codeEl, lineEndOffsets[n - 1], false);
    if (!split) return null;
    const first = preEl.cloneNode(false) as HTMLElement;
    first.appendChild(split[0]);
    const second = preEl.cloneNode(false) as HTMLElement;
    second.appendChild(split[1]);
    return [first, second];
  };

  let best: [HTMLElement, HTMLElement] | null = null;
  let fitCount = 0;
  for (let i = 1; i <= lines.length; i++) {
    const candidate = buildSplit(i);
    if (!candidate || !fits(candidate[0])) break;
    best = candidate;
    fitCount = i;
  }

  if (fitCount <= 0) {
    if (!forceSplit) return null;
    best = buildSplit(1);
    fitCount = 1;
  }
  if (fitCount >= lines.length || !best) return null;

  return best;
}

// ── Element splitter dispatcher ──────────────────────────────────────────────

function isInlineSplitCandidate(el: HTMLElement): boolean {
  if (!INLINE_SPLIT_TAGS.has(el.tagName)) return false;
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((child as HTMLElement).tagName))
      return false;
  }
  return true;
}

function splitElement(
  el: HTMLElement,
  fits: (node: HTMLElement) => boolean,
  forceSplit: boolean,
): [HTMLElement, HTMLElement] | null {
  if (UNSPLITTABLE_TAGS.has(el.tagName)) return null;
  if (el.tagName === "PRE")   return splitPreElement(el, fits, forceSplit);
  if (el.tagName === "TABLE") return splitTableElement(el as HTMLTableElement, fits, forceSplit);
  if (el.tagName === "UL" || el.tagName === "OL") return splitListElement(el, fits, forceSplit);
  if (isInlineSplitCandidate(el)) return splitInlineElement(el, fits, forceSplit);
  return null;
}

// ── Main pagination loop ─────────────────────────────────────────────────────

/** Distributes a rendered section's block children into page-height buckets,
 *  splitting oversized elements by natural unit (line, row, list item, word,
 *  or character) when they don't fit whole. Returns one HTMLElement[] per page. */
export function paginateEl(
  sourceEl: HTMLElement,
  contentWidthPx: number,
  contentHeightPx: number,
  docCSS: string,
): HTMLElement[][] {
  // Hidden shadow-root sandbox: scoped CSS prevents host-document pollution.
  const sandboxHost = createDiv();
  sandboxHost.setCssStyles({
    position: "fixed", top: "0", left: "-99999px",
    width: `${contentWidthPx}px`,
    visibility: "hidden", pointerEvents: "none", zIndex: "-1",
  });

  const sandboxShadow = sandboxHost.attachShadow({ mode: "open" });

  const sandboxSheet = new (activeWindow as unknown as typeof window).CSSStyleSheet();
  sandboxSheet.replaceSync(docCSS);
  sandboxShadow.adoptedStyleSheets = [sandboxSheet];

  const inner = createDiv();
  inner.className = "mpdf-doc";
  for (const child of Array.from(sourceEl.children)) {
    inner.appendChild(child.cloneNode(true));
  }
  sandboxShadow.appendChild(inner);

  // Measurement div: same width, always empty before each measurement.
  const measure = createDiv();
  measure.className = "mpdf-doc";
  measure.setCssStyles({ position: "absolute", top: "0", left: "0", width: `${contentWidthPx}px`, visibility: "hidden" });
  sandboxShadow.appendChild(measure);

  activeDocument.body.appendChild(sandboxHost);

  const pages: HTMLElement[][] = [];
  try {
    let currentPage: HTMLElement[] = [];
    const children = Array.from(inner.children) as HTMLElement[];
    let idx = 0;

    while (idx < children.length) {
      const child = children[idx];
      const fits = makeFitFn(currentPage, measure, contentHeightPx);

      if (fits(child)) {
        currentPage.push(child.cloneNode(true) as HTMLElement);
        idx++;
        continue;
      }

      // Element doesn't fit. Try to split it across the page boundary.
      const forceSplit = currentPage.length === 0;
      const split = splitElement(child, fits, forceSplit);
      if (split) {
        currentPage.push(split[0]);
        pages.push(currentPage);
        currentPage = [];
        // Replace current child with the remainder for re-processing.
        const remainder = split[1];
        if (remainder.textContent?.trim() || remainder.children.length > 0) {
          children[idx] = remainder;
        } else {
          idx++;
        }
        continue;
      }

      // Can't split. If there's content on this page, flush it and retry the
      // same element on a fresh full-height page.
      if (currentPage.length > 0) {
        pages.push(currentPage);
        currentPage = [];
        continue;
      }

      // Element is alone on an empty page and truly unsplittable (e.g. a giant
      // image). Force it onto its own page and advance so we never stall.
      currentPage.push(child.cloneNode(true) as HTMLElement);
      pages.push(currentPage);
      currentPage = [];
      idx++;
    }

    if (currentPage.length > 0) pages.push(currentPage);
  } finally {
    activeDocument.body.removeChild(sandboxHost);
  }
  return pages.length > 0 ? pages : [[]];
}

// ─── Page layout builder ──────────────────────────────────────────────────────

/** Resolves a page-number format template by substituting the {{current}}
 *  and {{total}} placeholders with the given values. Falls back to the
 *  default "current / total" template when the format is empty. */
function resolvePageNumberFormat(format: string, current: number, total: number): string {
  const template = format && format.trim() ? format : "{{current}} / {{total}}";
  return template
    .replace(/\{\{\s*current\s*\}\}/g, String(current))
    .replace(/\{\{\s*total\s*\}\}/g, String(total));
}

/** Converts paginated page-node arrays into fully-resolved PageLayout objects,
 *  computing header/footer text and page number strings for each page. */
export function buildPageLayouts(allPages: HTMLElement[][], s: PDFExportSettings): PageLayout[] {
  const totalPages = allPages.length;
  return allPages.map((pageNodes, i) => {
    const pageNum = i + 1;
    const pageShowsHeader = s.showHeaderOnFirstPage || i > 0;
    const pageShowsFooter = s.showFooterOnFirstPage || i > 0;

    // Page-number offset: when footer is hidden on page 1 the numbering shifts by 1.
    const displayNum   = s.showFooterOnFirstPage ? s.pageNumberStart + i       : s.pageNumberStart + (i - 1);
    const displayTotal = s.showFooterOnFirstPage ? s.pageNumberStart + totalPages - 1 : s.pageNumberStart + totalPages - 2;
    const numStr = resolvePageNumberFormat(s.pageNumberFormat, displayNum, displayTotal);

    let footerLeft = "", footerRight = "", footerCenter = "";
    let headerLeft = "", headerCenter = "", headerRight = "";

    if (pageShowsFooter) {
      if (s.footerText) {
        if      (s.footerTextAlignment === "center") footerCenter = s.footerText;
        else if (s.footerTextAlignment === "left")   footerLeft   = s.footerText;
        else                                          footerRight  = s.footerText;
      }
      // Place page number in its own zone; merge with a separator when both land in the same slot.
      if (s.showPageNumbers) {
        const join = (existing: string) => existing ? existing + " — " + numStr : numStr;
        if      (s.pageNumberPosition === "center") footerCenter = join(footerCenter);
        else if (s.pageNumberPosition === "left")   footerLeft   = join(footerLeft);
        else                                         footerRight  = join(footerRight);
      }
    }

    if (pageShowsHeader) {
      if (s.headerText) {
        if (s.headerAlignment === "center") {
          headerCenter = s.headerText;
        } else if (s.headerAlignment === "left") {
          headerLeft = s.headerText;
        } else {
          headerRight = s.headerText;
        }
      }
    }

    // Compute once here so both preview and export paths can read directly from
    // the layout object instead of re-deriving the same boolean expressions.
    const hasHeader = s.showHeader && pageShowsHeader && !!(headerLeft || headerCenter || headerRight || s.showHeaderBorder);
    const hasFooter = s.showFooter && pageShowsFooter && !!(footerLeft || footerRight || footerCenter || s.showFooterBorder);

    return { pageNodes, pageNum, totalPages, pageShowsHeader, pageShowsFooter, hasHeader, hasFooter, headerLeft, headerCenter, headerRight, footerLeft, footerRight, footerCenter };
  });
}

// ─── PDF outline (bookmarks) ──────────────────────────────────────────────────
// Electron's printToPDF does not generate bookmarks — we post-process the raw
// PDF bytes with pdf-lib to inject a hierarchical outline derived from the
// heading elements already present in the paginated layout.

/**
 * Walks every page's node list and collects heading elements in document order.
 * Headings can sit at the top level of pageNodes (the common case) or be nested
 * inside a container fragment produced by the page-splitter.
 */
export function extractOutlineEntries(layouts: PageLayout[]): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  for (const layout of layouts) {
    for (const node of layout.pageNodes) {
      const topLevel: HTMLElement[] = /^H[1-6]$/.test(node.tagName) ? [node] : [];
      const nested = Array.from(node.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6"));
      for (const el of [...topLevel, ...nested]) {
        const level = parseInt(el.tagName[1], 10);
        const title = (el.textContent ?? "").trim();
        if (title) entries.push({ title, level, page: layout.pageNum });
      }
    }
  }
  return entries;
}

/**
 * Post-processes a PDF buffer produced by `printToPDF` and injects a
 * hierarchical bookmark outline built from the supplied entries.
 *
 * Heading nesting (H1 → H2 → H3 …) is preserved. Each item links to its page
 * via an XYZ destination that inherits the reader's current zoom. Sub-trees are
 * collapsed by default (negative /Count per PDF spec). PageMode is set to
 * UseOutlines so readers open the bookmarks panel on load.
 */
export async function injectPDFOutline(pdfBuffer: Uint8Array, entries: OutlineEntry[]): Promise<Uint8Array> {
  if (!entries.length) return pdfBuffer;

  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const pages  = pdfDoc.getPages();
  const ctx    = pdfDoc.context;
  const n      = entries.length;

  // ── Compute tree relationships ───────────────────────────────────────────
  // parentIdx[i] = index of the nearest ancestor entry with a lower heading
  // level, or -1 when the entry sits at the root of the outline.
  const parentIdx  = new Array<number>(n).fill(-1);
  for (let i = 1; i < n; i++) {
    for (let j = i - 1; j >= 0; j--) {
      if (entries[j].level < entries[i].level) { parentIdx[i] = j; break; }
    }
  }

  // Sibling linkage (prev / next among entries that share the same parent).
  const prevSib    = new Array<number>(n).fill(-1);
  const nextSib    = new Array<number>(n).fill(-1);
  for (let i = 0; i < n; i++) {
    for (let j = i - 1; j >= 0; j--) {
      if (parentIdx[j] === parentIdx[i]) { prevSib[i] = j; break; }
    }
    for (let j = i + 1; j < n; j++) {
      if (parentIdx[j] === parentIdx[i]) { nextSib[i] = j; break; }
    }
  }

  // First / last direct child of each entry, and direct child count.
  // directChildCount is computed here in O(n) so the item-building loop
  // below doesn't need an inner scan (which would be O(n²) overall).
  const firstChild       = new Array<number>(n).fill(-1);
  const lastChild        = new Array<number>(n).fill(-1);
  const directChildCount = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const p = parentIdx[i];
    if (p >= 0) {
      if (firstChild[p] < 0) firstChild[p] = i;
      lastChild[p] = i;
      directChildCount[p]++;
    }
  }

  // ── Allocate PDF indirect references ─────────────────────────────────────
  const outlineRef = ctx.nextRef();
  const itemRefs   = entries.map(() => ctx.nextRef());

  // ── Build each outline item object ───────────────────────────────────────
  for (let i = 0; i < n; i++) {
    const pageIdx = Math.min(entries[i].page - 1, pages.length - 1);

    // XYZ destination: navigate to this page, null left/top inherits scroll, 0 zoom inherits zoom.
    const dest = PDFArray.withContext(ctx);
    dest.push(pages[pageIdx].ref);
    dest.push(PDFName.of("XYZ"));
    dest.push(PDFNull);
    dest.push(PDFNull);
    dest.push(PDFNumber.of(0));

    const itemDict = PDFDict.withContext(ctx);
    itemDict.set(PDFName.of("Title"),  PDFHexString.fromText(entries[i].title)); // UTF-16 → full Unicode
    itemDict.set(PDFName.of("Parent"), parentIdx[i] >= 0 ? itemRefs[parentIdx[i]] : outlineRef);
    itemDict.set(PDFName.of("Dest"),   dest);
    if (prevSib[i]    >= 0) itemDict.set(PDFName.of("Prev"),  itemRefs[prevSib[i]]);
    if (nextSib[i]    >= 0) itemDict.set(PDFName.of("Next"),  itemRefs[nextSib[i]]);
    if (firstChild[i] >= 0) {
      itemDict.set(PDFName.of("First"), itemRefs[firstChild[i]]);
      itemDict.set(PDFName.of("Last"),  itemRefs[lastChild[i]]);
      // Negative /Count = subtree is collapsed by default in the PDF reader.
      itemDict.set(PDFName.of("Count"), PDFNumber.of(-directChildCount[i]));
    }
    ctx.assign(itemRefs[i], itemDict);
  }

  // ── Build the outline root dictionary ────────────────────────────────────
  let rootFirst = -1, rootLast = -1, rootCount = 0;
  for (let i = 0; i < n; i++) {
    if (parentIdx[i] < 0) {
      if (rootFirst < 0) rootFirst = i;
      rootLast = i;
      rootCount++;
    }
  }
  // Safety: if every entry has a parent (e.g. the document starts with H2 and
  // never has an H1), there are no root-level items. Injecting an empty or
  // half-wired outline dict would produce a malformed PDF — bail out instead.
  if (rootFirst < 0) return pdfBuffer;

  const rootDict = PDFDict.withContext(ctx);
  rootDict.set(PDFName.of("Type"),  PDFName.of("Outlines"));
  rootDict.set(PDFName.of("First"), itemRefs[rootFirst]);
  rootDict.set(PDFName.of("Last"),  itemRefs[rootLast]);
  rootDict.set(PDFName.of("Count"), PDFNumber.of(rootCount));
  ctx.assign(outlineRef, rootDict);

  // ── Wire into the document catalog ───────────────────────────────────────
  pdfDoc.catalog.set(PDFName.of("Outlines"), outlineRef);
  pdfDoc.catalog.set(PDFName.of("PageMode"), PDFName.of("UseOutlines"));

  return await pdfDoc.save();
}
