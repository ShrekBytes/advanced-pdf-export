// @vitest-environment happy-dom

// The table-of-contents feature has two halves. Marker parsing and heading
// selection are pure — no layout, no Obsidian API — and are covered directly.
// The DOM builders and the bookmark assembly touch elements, so they run under
// happy-dom with the subset of Obsidian globals the builders call. The
// end-to-end check that a contents lands on the right page in a real Electron
// render lives outside this suite.

import { describe, expect, it, beforeAll } from "vitest";
import { OutlineEntry, PageLayout } from "./paginator";
import {
  buildCompactTocElement, buildFullTocElement, buildIndentRanks, buildTocElement,
  collectBookmarkEntries, parseTocAnchor, replaceTocMarkers,
  resolveTocPageNumberVisibility, selectTocEntries, splitSectionAtFullToc,
  TocSettings,
} from "./toc";

interface ElementInfo {
  cls?: string;
  text?: string;
}

function applyInfo(el: HTMLElement, info?: ElementInfo): HTMLElement {
  if (info?.cls) el.className = info.cls;
  if (info?.text !== undefined) el.textContent = info.text;
  return el;
}

beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.createDiv = (info?: ElementInfo) => applyInfo(document.createElement("div"), info);
  g.createSpan = (info?: ElementInfo) => applyInfo(document.createElement("span"), info);
  g.createEl = (tag: string, info?: ElementInfo) => applyInfo(document.createElement(tag), info);
  g.activeDocument = document;
  (HTMLElement.prototype as unknown as {
    setCssStyles(this: HTMLElement, styles: Partial<CSSStyleDeclaration>): void;
  }).setCssStyles = function (styles) {
    Object.assign(this.style, styles);
  };
});

/** A heading as the layout reports it. */
function heading(title: string, level: number, page: number, label = String(page), id?: string): OutlineEntry {
  return { title, level, page, label, id };
}

const settings: TocSettings = {
  defaultTitle: "Table of Contents",
  fullDepth: 6,
  fullFontSizeEm: 1,
  fullLineHeight: 1.7,
  fullShowPageNumbers: true,
  compactDepth: 6,
  compactFontSizeEm: 1,
  compactLineHeight: 1.85,
  compactShowPageNumbers: true,
  compactLeaderLengthEm: 2,
};

function fakeLayout(pageNum: number, nodes: HTMLElement[], label = String(pageNum)): PageLayout {
  return {
    pageNodes: nodes,
    pageNum,
    totalPages: 99,
    displayPageLabel: label,
    pageShowsHeader: true,
    pageShowsFooter: true,
    hasHeader: false,
    hasFooter: false,
    headerLeft: "", headerCenter: "", headerRight: "",
    footerLeft: "", footerRight: "", footerCenter: "",
  };
}

describe("replaceTocMarkers", () => {
  it("recognizes every marker form", () => {
    const md = [
      "{{toc}}",
      "{{toc_5}}",
      "{{toc:Custom title}}",
      "{{toc_compact}}",
      "{{toc_compact_3}}",
      "{{toc_compact_2:Compact title}}",
    ].join("\n");

    const { markers } = replaceTocMarkers(md);
    expect(markers).toHaveLength(6);
    expect(markers[0]).toMatchObject({ kind: "full", count: undefined, title: undefined });
    expect(markers[1]).toMatchObject({ kind: "full", count: 5 });
    expect(markers[2]).toMatchObject({ kind: "full", count: undefined, title: "Custom title" });
    expect(markers[3]).toMatchObject({ kind: "compact" });
    expect(markers[4]).toMatchObject({ kind: "compact", count: 3 });
    expect(markers[5]).toMatchObject({ kind: "compact", count: 2, title: "Compact title" });
  });

  it("leaves malformed, mis-cased, and indented markers as literal text", () => {
    const literal = [
      "{{TOC}}",
      "{{toc_0}}",
      "{{toc_abc}}",
      "{{toc_extra}}",
      "  {{toc}}",
      "`{{toc}}`",
      "{{toc}} trailing text",
    ];
    const { markdown, markers } = replaceTocMarkers(literal.join("\n"));
    expect(markers).toHaveLength(0);
    for (const line of literal) expect(markdown).toContain(line);
  });

  it("ignores markers inside fenced code", () => {
    const md = ["```", "{{toc}}", "```", "{{toc}}"].join("\n");
    const { markers } = replaceTocMarkers(md);
    expect(markers).toHaveLength(1);
  });

  it("emits a decodable anchor for each marker", () => {
    const { markdown, markers } = replaceTocMarkers("{{toc}}\n\n{{toc_compact}}");
    const anchors = markdown
      .split("\n")
      .map((line) => parseTocAnchor(line))
      .filter((a): a is { kind: "full" | "compact"; id: number } => a !== null);
    expect(anchors).toEqual([
      { kind: "full", id: markers[0].id },
      { kind: "compact", id: markers[1].id },
    ]);
  });
});

describe("splitSectionAtFullToc", () => {
  it("promotes a full-page anchor to its own section", () => {
    const section = ["Intro", "{{toc}}", "Body"].join("\n");
    const replaced = replaceTocMarkers(section).markdown;
    const parts = splitSectionAtFullToc(replaced);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("Intro");
    expect(parseTocAnchor(parts[1])?.kind).toBe("full");
    expect(parts[2]).toBe("Body");
  });

  it("does not split on a compact anchor", () => {
    const section = replaceTocMarkers(["Intro", "{{toc_compact}}", "Body"].join("\n")).markdown;
    expect(splitSectionAtFullToc(section)).toHaveLength(1);
  });
});

describe("selectTocEntries", () => {
  const headings = [
    heading("A", 1, 1),
    heading("A1", 2, 1),
    heading("A1a", 3, 2),
    heading("A2", 2, 2),
    heading("B", 1, 3),
    heading("B1", 2, 3),
  ];
  const titles = (entries: OutlineEntry[]) => entries.map((e) => e.title);

  it("lists the whole document for a full-page marker without a count", () => {
    const entries = selectTocEntries(headings, { id: 0, kind: "full" }, 0, 6);
    expect(titles(entries)).toEqual(["A", "A1", "A1a", "A2", "B", "B1"]);
  });

  it("lists the next counted headings below a full-page marker", () => {
    const entries = selectTocEntries(headings, { id: 0, kind: "full", count: 3 }, 0, 6);
    expect(titles(entries)).toEqual(["A", "A1", "A1a"]);
  });

  it("lists the anchor and its subtree until the next heading at the same level", () => {
    // Marker at the very top: anchor is A (level 1), so the span runs to B.
    expect(titles(selectTocEntries(headings, { id: 0, kind: "compact" }, 0, 6)))
      .toEqual(["A", "A1", "A1a", "A2"]);
    // Marker after A: anchor is A1 (level 2), so the span stops before A2.
    expect(titles(selectTocEntries(headings, { id: 1, kind: "compact" }, 1, 6)))
      .toEqual(["A1", "A1a"]);
    // Marker after B: anchor is B1, with nothing below it.
    expect(titles(selectTocEntries(headings, { id: 2, kind: "compact" }, 5, 6)))
      .toEqual(["B1"]);
  });

  it("lists the next counted headings below a compact marker", () => {
    const entries = selectTocEntries(headings, { id: 0, kind: "compact", count: 2 }, 0, 6);
    expect(titles(entries)).toEqual(["A", "A1"]);
  });

  it("applies the depth filter", () => {
    const entries = selectTocEntries(headings, { id: 0, kind: "compact" }, 0, 2);
    expect(titles(entries)).toEqual(["A", "A1", "A2"]);
  });

  it("returns nothing when the marker precedes no headings", () => {
    expect(selectTocEntries(headings, { id: 0, kind: "compact" }, headings.length, 6)).toEqual([]);
  });
});

describe("resolveTocPageNumberVisibility", () => {
  it("requires both the per-type switch and the global page-number switch", () => {
    expect(resolveTocPageNumberVisibility(true, true)).toBe(true);
    expect(resolveTocPageNumberVisibility(false, true)).toBe(false);
    expect(resolveTocPageNumberVisibility(true, false)).toBe(false);
    expect(resolveTocPageNumberVisibility(false, false)).toBe(false);
  });

  it("hides contents page numbers when the global page-number switch is off", () => {
    const entries = [heading("Alpha", 1, 1)];
    const gated = { ...settings, fullShowPageNumbers: resolveTocPageNumberVisibility(true, false) };
    expect(buildTocElement({ id: 0, kind: "full" }, entries, gated, false).querySelector(".mpdf-toc-page")).toBeNull();
  });
});

describe("buildIndentRanks", () => {
  it("ranks levels relative to the shallowest level present", () => {
    const ranks = buildIndentRanks([
      heading("H2", 2, 1),
      heading("H6", 6, 2),
      heading("H4", 4, 3),
    ]);
    expect(ranks.get(2)).toBe(0);
    expect(ranks.get(4)).toBe(1);
    expect(ranks.get(6)).toBe(2);
  });

  it("indents an H6 once when the scope also holds an H2", () => {
    const entries = [heading("Level 2", 2, 1), heading("Level 6", 6, 2)];
    const root = buildFullTocElement(entries, "Contents", false, settings, false);
    const rows = root.querySelectorAll<HTMLElement>(".mpdf-toc-row");
    expect(rows[0].style.paddingInlineStart).toBe("0em");
    expect(rows[1].style.paddingInlineStart).toBe("1.4em");
  });
});

describe("DOM builders", () => {
  it("builds a full-page contents with one row per entry and the display labels", () => {
    const entries = [heading("Alpha", 1, 2, "1"), heading("Beta", 2, 3, "2")];
    const root = buildFullTocElement(entries, "Table of Contents", true, settings, false);

    expect(root.querySelector(".mpdf-toc-title")?.textContent).toBe("Table of Contents");
    const rows = root.querySelectorAll(".mpdf-toc-row");
    expect(rows).toHaveLength(2);
    expect(Array.from(rows).map((r) => r.querySelector(".mpdf-toc-label")?.textContent))
      .toEqual(["Alpha", "Beta"]);
    expect(Array.from(rows).map((r) => r.querySelector(".mpdf-toc-page")?.textContent))
      .toEqual(["1", "2"]);
  });

  it("omits the leader and page number when page numbers are disabled", () => {
    const root = buildFullTocElement([heading("Alpha", 1, 1)], "Contents", false, settings, false);
    expect(root.querySelector(".mpdf-toc-leader")).toBeNull();
    expect(root.querySelector(".mpdf-toc-page")).toBeNull();
  });

  it("renders an unnumbered entry with an empty page cell", () => {
    const root = buildFullTocElement([heading("Front matter", 1, 1, "")], "Contents", true, settings, false);
    expect(root.querySelector(".mpdf-toc-page")?.textContent).toBe("");
  });

  it("builds a fit-content compact contents whose leaders fill between title and page", () => {
    const entries = [heading("Alpha", 1, 1), heading("A longer heading", 2, 2)];
    const root = buildCompactTocElement(entries, "Contents", true, settings, false);

    expect(root.classList.contains("mpdf-toc-compact")).toBe(true);
    expect(root.style.display).toBe("block");
    expect(root.style.width).toBe("fit-content");
    expect(root.querySelector(".mpdf-toc-title")?.textContent).toBe("Contents");

    const rows = root.querySelectorAll(".mpdf-toc-row");
    expect(rows).toHaveLength(2);
    for (const row of Array.from(rows)) {
      expect(row.children).toHaveLength(3);
      const leader = row.children[1] as HTMLElement;
      expect(leader.classList.contains("mpdf-toc-leader")).toBe(true);
      // Middle dashed line, not a bottom dotted one; and it grows to fill.
      expect(leader.style.borderTop).toContain("dashed");
      expect(leader.style.borderBottom).toBe("");
      expect(leader.style.flex).toContain("1 1 auto");
    }
  });

  it("strips the link underline from contents entries", () => {
    const root = buildFullTocElement(
      [heading("Linked", 1, 1, "1", "linked")],
      "Contents", true, settings, false,
    );
    const anchor = root.querySelector("a.mpdf-toc-link") as HTMLElement;
    expect(anchor.style.textDecoration).toBe("none");
    expect(anchor.style.color).toBe("inherit");
  });

  it("links each entry to its heading id", () => {
    const root = buildFullTocElement(
      [heading("Linked", 1, 1, "1", "linked")],
      "Contents", true, settings, false,
    );
    expect(root.querySelector("a.mpdf-toc-link")?.getAttribute("href")).toBe("#linked");
  });
});

describe("buildTocElement", () => {
  const entries = [heading("Alpha", 1, 1), heading("Beta", 2, 2)];

  it("gives a full-page marker the configured default heading", () => {
    const root = buildTocElement({ id: 0, kind: "full" }, entries, settings, false);
    expect(root.querySelector(".mpdf-toc-title")?.textContent).toBe("Table of Contents");
  });

  it("honours a marker-supplied heading", () => {
    const root = buildTocElement({ id: 0, kind: "full", title: "Custom" }, entries, settings, false);
    expect(root.querySelector(".mpdf-toc-title")?.textContent).toBe("Custom");
  });

  it("renders no compact heading unless the marker supplies one", () => {
    const without = buildTocElement({ id: 0, kind: "compact" }, entries, settings, false);
    expect(without.querySelector(".mpdf-toc-title")).toBeNull();

    const withTitle = buildTocElement({ id: 0, kind: "compact", title: "In this section" }, entries, settings, false);
    expect(withTitle.querySelector(".mpdf-toc-title")?.textContent).toBe("In this section");
  });

  it("keeps page-number display independent per contents type", () => {
    const fullOff = { ...settings, fullShowPageNumbers: false, compactShowPageNumbers: true };
    expect(buildTocElement({ id: 0, kind: "full" }, entries, fullOff, false).querySelector(".mpdf-toc-page")).toBeNull();
    expect(buildTocElement({ id: 0, kind: "compact" }, entries, fullOff, false).querySelector(".mpdf-toc-page")).not.toBeNull();

    const compactOff = { ...settings, fullShowPageNumbers: true, compactShowPageNumbers: false };
    expect(buildTocElement({ id: 0, kind: "full" }, entries, compactOff, false).querySelector(".mpdf-toc-page")).not.toBeNull();
    expect(buildTocElement({ id: 0, kind: "compact" }, entries, compactOff, false).querySelector(".mpdf-toc-page")).toBeNull();
  });

  it("keeps typography independent per contents type", () => {
    const styled = { ...settings, fullFontSizeEm: 0.8, fullLineHeight: 1.4, compactFontSizeEm: 0.9, compactLineHeight: 1.6 };
    const full = buildTocElement({ id: 0, kind: "full" }, entries, styled, false);
    expect(full.style.fontSize).toBe("0.8em");
    expect(full.style.lineHeight).toBe("1.4");

    const compact = buildTocElement({ id: 0, kind: "compact" }, entries, styled, false);
    expect(compact.style.fontSize).toBe("0.9em");
    expect(compact.style.lineHeight).toBe("1.6");
  });
});

describe("collectBookmarkEntries", () => {
  it("inserts a full-page contents bookmark at its physical position", () => {
    const contents = document.createElement("div");
    contents.setAttribute("data-mpdf-toc-id", "0");

    const headingNode = (title: string, level: number) => {
      const el = document.createElement(`h${level}`);
      el.textContent = title;
      return el;
    };

    const layouts = [
      fakeLayout(1, [contents], ""),
      fakeLayout(2, [headingNode("Chapter", 1)], "1"),
    ];

    const entries = collectBookmarkEntries(layouts, [{ id: 0, kind: "full" }], settings);
    expect(entries.map((e) => e.title)).toEqual(["Table of Contents", "Chapter"]);
    // Contents page is unnumbered here; the chapter carries the display label.
    expect(entries.map((e) => e.label)).toEqual(["", "1"]);
  });

  it("ignores compact contents for bookmarks", () => {
    const compact = document.createElement("div");
    compact.setAttribute("data-mpdf-toc-id", "1");
    const layouts = [fakeLayout(1, [compact], "1")];
    const entries = collectBookmarkEntries(layouts, [{ id: 1, kind: "compact" }], settings);
    expect(entries).toEqual([]);
  });
});
