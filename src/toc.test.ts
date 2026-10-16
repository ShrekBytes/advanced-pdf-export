// @vitest-environment happy-dom

// The Contents page is built from DOM nodes and measured by the paginator,
// which happy-dom cannot lay out. These tests cover what does not need layout:
// the numbering/filtering rule, the shape of the generated section, and the
// bail-out when there is nothing to list. The end-to-end check that the
// contents lands on the right page and prints the right number is done against
// a real Electron render, not here.

import { describe, expect, it, beforeAll } from "vitest";
import { OutlineEntry } from "./paginator";
import { buildTocSectionEl, paginateToc, shiftTocEntries } from "./toc";

// Obsidian injects these element helpers onto the global scope. Reproduce just
// the subset toc.ts calls, writing through the same DOM APIs the real ones do.
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
  g.activeDocument = document;
  (HTMLElement.prototype as unknown as {
    setCssStyles(this: HTMLElement, styles: Partial<CSSStyleDeclaration>): void;
  }).setCssStyles = function (styles) {
    Object.assign(this.style, styles);
  };
});

const entries: OutlineEntry[] = [
  { title: "Intro", level: 1, page: 1 },
  { title: "Details", level: 2, page: 3 },
  { title: "Deep cut", level: 5, page: 4 },
  { title: "   ", level: 2, page: 5 },
  { title: "Wrap up", level: 1, page: 6 },
];

describe("shiftTocEntries", () => {
  it("shifts every page number by the contents page count", () => {
    const shifted = shiftTocEntries([{ title: "A", level: 1, page: 2 }], 6, 3);
    expect(shifted).toEqual([{ title: "A", level: 1, page: 5 }]);
  });

  it("drops headings below the requested depth", () => {
    const titles = shiftTocEntries(entries, 2, 0).map((e) => e.title);
    expect(titles).toEqual(["Intro", "Details", "Wrap up"]);
  });

  it("drops untitled entries rather than printing a blank row", () => {
    expect(shiftTocEntries(entries, 6, 0).some((e) => !e.title.trim())).toBe(false);
  });
});

describe("buildTocSectionEl", () => {
  it("returns null when no entry is eligible", () => {
    expect(buildTocSectionEl([{ title: "x", level: 4, page: 1 }], {
      title: "Contents", maxLevel: 3, showPageNumbers: true,
    }, false)).toBeNull();
  });

  it("builds a title and one row per eligible entry", () => {
    const section = buildTocSectionEl(entries, {
      title: "Contents", maxLevel: 2, showPageNumbers: true,
    }, false);

    expect(section).not.toBeNull();
    expect(section!.querySelector(".mpdf-toc-title")?.textContent).toBe("Contents");

    const rows = section!.querySelectorAll(".mpdf-toc-row");
    expect(rows).toHaveLength(3);
    expect(Array.from(rows).map((r) => r.querySelector(".mpdf-toc-label")?.textContent))
      .toEqual(["Intro", "Details", "Wrap up"]);
    expect(Array.from(rows).map((r) => r.querySelector(".mpdf-toc-page")?.textContent))
      .toEqual(["1", "3", "6"]);
  });

  it("omits page numbers when asked to", () => {
    const section = buildTocSectionEl(entries, {
      title: "Contents", maxLevel: 2, showPageNumbers: false,
    }, false);
    expect(section!.querySelector(".mpdf-toc-page")).toBeNull();
    expect(section!.querySelector(".mpdf-toc-leader")).toBeNull();
  });

  it("indents deeper levels relative to shallower ones", () => {
    const section = buildTocSectionEl(entries, {
      title: "Contents", maxLevel: 2, showPageNumbers: true,
    }, false);
    const rows = section!.querySelectorAll<HTMLElement>(".mpdf-toc-row");
    expect(rows[0].style.paddingInlineStart).toBe("0em");
    expect(rows[1].style.paddingInlineStart).toBe("1.4em");
  });
});

describe("paginateToc", () => {
  it("returns null without touching the paginator when nothing is eligible", () => {
    let calls = 0;
    const plan = paginateToc(
      [{ title: "Only deep", level: 6, page: 1 }],
      { title: "Contents", maxLevel: 2, showPageNumbers: true },
      false, 500, 700, "",
      () => { calls++; return { pages: [[]], overflowed: false }; },
    );
    expect(plan).toBeNull();
    expect(calls).toBe(0);
  });

  it("re-numbers entries by the page count the contents actually needs", () => {
    const content: OutlineEntry[] = [
      { title: "One", level: 1, page: 1 },
      { title: "Two", level: 1, page: 2 },
    ];
    // Stand-in that always claims two pages, so the first pass (assuming one)
    // must be redone with a two-page offset. Record what it was asked to lay out.
    let lastNumbers: number[] = [];
    const plan = paginateToc(
      content,
      { title: "Contents", maxLevel: 3, showPageNumbers: true },
      false, 500, 700, "",
      (section) => {
        lastNumbers = Array.from(section.querySelectorAll(".mpdf-toc-page"))
          .map((el) => parseInt(el.textContent ?? "", 10));
        return { pages: [[], []], overflowed: false };
      },
    );

    expect(plan!.tocPages).toHaveLength(2);
    // Content pages 1 and 2, shifted past two contents pages → 3 and 4.
    expect(lastNumbers).toEqual([3, 4]);
  });

  it("propagates the paginator's overflow flag", () => {
    const plan = paginateToc(
      [{ title: "One", level: 1, page: 1 }],
      { title: "Contents", maxLevel: 3, showPageNumbers: true },
      false, 500, 700, "",
      () => ({ pages: [[]], overflowed: true }),
    );
    expect(plan!.overflowed).toBe(true);
  });
});