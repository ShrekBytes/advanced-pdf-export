// @vitest-environment happy-dom

// The cut logic in splitListElement takes `fits` as a parameter, so the choice of
// where to split can be driven by a deterministic stand-in instead of real layout
// — which happy-dom cannot produce (every getBoundingClientRect is zero, so a
// measurement-based test would pass vacuously). The end-to-end check that a real
// browser renders the result without clipping lives outside this suite.

import { describe, expect, it } from "vitest";
import { splitListElement, splitTableElement } from "./paginator";

// The inline splitter walks text nodes through Obsidian's activeDocument global,
// and the table splitter builds a <tbody> through createEl. The real app provides
// both; point them at the test document.
(globalThis as unknown as { activeDocument: Document }).activeDocument = document;
(globalThis as unknown as { createEl: (tag: string) => HTMLElement }).createEl =
  (tag) => document.createElement(tag);

// happy-dom's HTMLTableSectionElement implements insertRow/deleteRow but not the
// `rows` collection that browsers expose and the splitter relies on, so supply it.
// The gap is the test environment's; the production code is correct as written.
const tbodyProto = Object.getPrototypeOf(document.createElement("tbody"));
if (!("rows" in tbodyProto)) {
  Object.defineProperty(tbodyProto, "rows", {
    configurable: true,
    get(this: HTMLElement) {
      return Array.from(this.querySelectorAll("tr"));
    },
  });
}

/** Parses a fragment and returns its single root element. */
function el(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host.firstElementChild as HTMLElement;
}

/** Stand-in for measurement: the fragment "fits" while its text stays under
 *  `limit` characters. Whitespace is ignored so indentation between tags cannot
 *  perturb the counts. */
function fitsUnder(limit: number): (node: HTMLElement) => boolean {
  return (node) => (node.textContent ?? "").replace(/\s+/g, "").length <= limit;
}

/** As above, for a page that already holds `used` characters. */
function fitsUnderWith(limit: number, used: number): (node: HTMLElement) => boolean {
  const under = fitsUnder(limit);
  return (node) => used + (node.textContent ?? "").replace(/\s+/g, "").length <= limit;
}

/** Visible text, whitespace-stripped — the assertion form used throughout. */
function text(node: HTMLElement): string {
  return (node.textContent ?? "").replace(/\s+/g, "");
}

describe("splitListElement", () => {
  it("cuts a flat list at an item boundary", () => {
    const list = el("<ul><li>aa</li><li>bb</li><li>cc</li><li>dd</li></ul>");
    const split = splitListElement(list, fitsUnder(4), false);

    expect(split).not.toBeNull();
    expect(text(split![0])).toBe("aabb");
    expect(text(split![1])).toBe("ccdd");
  });

  it("continues OL numbering across the cut", () => {
    const list = el("<ol><li>aa</li><li>bb</li><li>cc</li><li>dd</li></ol>");
    const split = splitListElement(list, fitsUnder(4), false);

    expect(split).not.toBeNull();
    expect((split![1] as HTMLOListElement).start).toBe(3);
  });

  it("returns null when the whole list fits", () => {
    const list = el("<ul><li>aa</li><li>bb</li></ul>");
    expect(splitListElement(list, fitsUnder(100), false)).toBeNull();
  });

  it("returns null when nothing can be cut and the page is not empty", () => {
    // A one-character nested item has no break point at any level, so nothing can
    // be cut: the caller flushes the page and retries against a full one.
    const list = el("<ul><li>A<ul><li>B</li></ul></li></ul>");
    expect(splitListElement(list, fitsUnder(0), false)).toBeNull();
  });

  it("fills a page that already holds content, instead of flushing it half-empty", () => {
    // Same shape as above, but the page has room for part of the nested list. The
    // cut has to happen here: flushing would waste the page, and placing the item
    // whole would clip it.
    const list = el(
      "<ul><li>AAAA<ul><li>BBBB</li><li>CCCC</li><li>DDDD</li><li>EEEE</li></ul></li></ul>",
    );
    const split = splitListElement(list, fitsUnderWith(12, 4), false);

    expect(split).not.toBeNull();
    expect(text(split![0])).toBe("AAAABBBB");
    expect(text(split![1])).toBe("CCCCDDDDEEEE");
  });

  // The regression: a list whose only top-level item owns every later bullet.
  // Tab-indented outlines always have this shape, and before the descent the list
  // was atomic — it could neither fit nor be split, so it was placed whole and
  // clipped.
  it("descends into the single top-level item and cuts its nested list", () => {
    const list = el(
      "<ul><li>AAAA<ul><li>BBBB</li><li>CCCC</li><li>DDDD</li><li>EEEE</li></ul></li></ul>",
    );
    const split = splitListElement(list, fitsUnder(12), true);

    expect(split).not.toBeNull();
    const [head, tail] = split!;

    expect(text(head)).toBe("AAAABBBBCCCC");
    expect(text(tail)).toBe("DDDDEEEE");
    // Both fragments stay lists, so indentation survives the page break.
    expect(head.tagName).toBe("UL");
    expect(tail.tagName).toBe("UL");
    expect(head.querySelectorAll("li")).toHaveLength(3);
    expect(tail.querySelectorAll("li")).toHaveLength(3);
  });

  it("suppresses the marker on a continuation item that has no text of its own", () => {
    const list = el(
      "<ul><li>AAAA<ul><li>BBBB</li><li>CCCC</li><li>DDDD</li></ul></li></ul>",
    );
    const split = splitListElement(list, fitsUnder(12), true)!;

    const continuation = split[1].firstElementChild as HTMLElement;
    expect(continuation.tagName).toBe("LI");
    expect(continuation.style.listStyle).toBe("none");
    // The first fragment's item is a normal bullet and keeps its marker.
    expect((split[0].firstElementChild as HTMLElement).style.listStyle).toBe("");
  });

  it("descends to any depth, not just one level", () => {
    const list = el("<ul><li>A<ul><li>B<ul><li>C</li><li>D</li></ul></li></ul></li></ul>");
    const split = splitListElement(list, fitsUnder(3), true);

    expect(split).not.toBeNull();
    expect(text(split![0])).toBe("ABC");
    expect(text(split![1])).toBe("D");
    // The continuation re-opens every ancestor level so nesting depth is kept.
    expect(split![1].querySelectorAll("ul")).toHaveLength(2);
  });

  it("splits a leaf item's own text when it is taller than a page", () => {
    // No nested list to cut into, so the oversized thing is the item's text and
    // that is what gets split — at a word boundary, not mid-word.
    const list = el("<ul><li>alpha beta gamma delta</li></ul>");
    const split = splitListElement(list, fitsUnder(10), true);

    expect(split).not.toBeNull();
    expect(text(split![0])).toBe("alphabeta");
    expect(text(split![1])).toBe("gammadelta");
  });

  it("marks a split leaf item's continuation marker-less", () => {
    const list = el("<ul><li>alpha beta gamma delta</li></ul>");
    const split = splitListElement(list, fitsUnder(10), true)!;

    // Both halves are <li>s so indentation is kept, but the second reads as the
    // same bullet running on — which is what a browser does when it fragments one.
    expect(split[1].firstElementChild!.tagName).toBe("LI");
    expect((split[1].firstElementChild as HTMLElement).style.listStyle).toBe("none");
    expect((split[0].firstElementChild as HTMLElement).style.listStyle).toBe("");
  });

  it("splits a leaf item on a page that already holds content", () => {
    const list = el("<ul><li>alpha beta gamma delta</li></ul>");
    const split = splitListElement(list, fitsUnderWith(16, 6), false);

    expect(split).not.toBeNull();
    expect(text(split![0])).toBe("alphabeta");
    expect(text(split![1])).toBe("gammadelta");
  });

  it("keeps a split leaf item's siblings on the continuation", () => {
    const list = el("<ul><li>alpha beta gamma delta</li><li>ZZ</li></ul>");
    const split = splitListElement(list, fitsUnder(10), true);

    expect(split).not.toBeNull();
    expect(text(split![0])).toBe("alphabeta");
    expect(text(split![1])).toBe("gammadeltaZZ");
  });

  it("reports no split when there is nothing left to break", () => {
    // A one-character item has no break point, and nothing fits a zero-height
    // page — the genuinely atomic case, where the caller must place it whole.
    const list = el("<ul><li>A</li></ul>");
    expect(splitListElement(list, fitsUnder(0), true)).toBeNull();
  });

  it("leaves an item unsplit when only its trailing content overflows", () => {
    // The nested list fits; the item does not, because of content *after* the
    // list. Cutting there is a boundary inside the item's own children rather than
    // at an item boundary, which this splitter deliberately does not do — so it
    // reports no split instead of emitting a fragment in the wrong order.
    const list = el("<ul><li>AAAA<ul><li>BBBB</li><li>CCCC</li></ul>TAIL</li></ul>");
    expect(splitListElement(list, fitsUnder(12), true)).toBeNull();
  });

  it("moves the first item forward when its nested list cannot be cut", () => {
    // Same shape with a sibling behind it: the item cannot be cut, so it goes
    // forward whole and the sibling still reaches a later page.
    const list = el(
      "<ul><li>AAAA<ul><li>BBBB</li><li>CCCC</li></ul>TAIL</li><li>ZZ</li></ul>",
    );
    const split = splitListElement(list, fitsUnder(12), true);

    expect(split).not.toBeNull();
    expect(text(split![0])).toBe("AAAABBBBCCCCTAIL");
    expect(text(split![1])).toBe("ZZ");
  });

  it("keeps trailing siblings on the continuation, not the head", () => {
    const list = el(
      "<ul><li>AAAA<ul><li>BBBB</li><li>CCCC</li></ul></li><li>ZZZZ</li></ul>",
    );
    const split = splitListElement(list, fitsUnder(8), true);

    expect(split).not.toBeNull();
    expect(text(split![0])).toBe("AAAABBBB");
    expect(text(split![1])).toBe("CCCCZZZZ");
  });
});

describe("splitTableElement", () => {
  it("cuts a multi-row table at a row boundary", () => {
    const table = el(
      "<table><tbody><tr><td>aa</td></tr><tr><td>bb</td></tr><tr><td>cc</td></tr><tr><td>dd</td></tr></tbody></table>",
    );
    const split = splitTableElement(table as HTMLTableElement, fitsUnder(4), false);

    expect(split).not.toBeNull();
    expect(text(split![0])).toBe("aabb");
    expect(text(split![1])).toBe("ccdd");
  });

  it("returns null when the whole table fits", () => {
    const table = el("<table><tbody><tr><td>aa</td></tr></tbody></table>");
    expect(splitTableElement(table as HTMLTableElement, fitsUnder(100), false)).toBeNull();
  });

  // The regression: a table whose height sits inside one row has no row boundary
  // to cut at, so it was atomic — it could neither fit nor be split, and was
  // placed whole and clipped. A browser continues such a row onto the next page.
  it("descends into a single oversized row and splits its cell", () => {
    const table = el(
      "<table><tbody><tr><td>alpha beta gamma delta</td></tr></tbody></table>",
    );
    const split = splitTableElement(table as HTMLTableElement, fitsUnder(10), true);

    expect(split).not.toBeNull();
    expect(text(split![0])).toBe("alphabeta");
    expect(text(split![1])).toBe("gammadelta");
    // Both fragments stay tables with one row, so the grid is unchanged.
    expect(split![0].querySelectorAll("tr")).toHaveLength(1);
    expect(split![1].querySelectorAll("tr")).toHaveLength(1);
  });

  it("blanks the cells that already rendered on the continuation", () => {
    const table = el(
      "<table><tbody><tr><td>alpha beta gamma delta</td><td>KEEP</td></tr></tbody></table>",
    );
    const split = splitTableElement(table as HTMLTableElement, fitsUnder(12), true)!;

    // The first page keeps the neighbour cell whole...
    expect(text(split[0])).toBe("alphaKEEP");
    // ...and the continuation keeps the cell in place but empty, so the column
    // layout is unchanged and the content is not duplicated.
    expect(text(split[1])).toBe("betagammadelta");
    const cells = split[1].querySelectorAll("td");
    expect(cells).toHaveLength(2);
    expect(cells[1].textContent).toBe("");
  });

  it("repeats the header row on both fragments", () => {
    const table = el(
      "<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>alpha beta gamma delta</td></tr></tbody></table>",
    );
    const split = splitTableElement(table as HTMLTableElement, fitsUnder(12), true);

    expect(split).not.toBeNull();
    expect(split![0].querySelector("thead")).not.toBeNull();
    expect(split![1].querySelector("thead")).not.toBeNull();
    expect(text(split![0])).toBe("Halphabeta");
    expect(text(split![1])).toBe("Hgammadelta");
  });

  it("skips a cell that cannot bound the row's height", () => {
    // Only the tallest cell can reduce the row, so the short one must be passed
    // over rather than split pointlessly.
    const table = el(
      "<table><tbody><tr><td>aa</td><td>alpha beta gamma delta</td></tr></tbody></table>",
    );
    const split = splitTableElement(table as HTMLTableElement, fitsUnder(12), true);

    expect(split).not.toBeNull();
    expect(text(split![0])).toBe("aaalphabeta");
    expect(text(split![1])).toBe("gammadelta");
  });

  it("keeps the rows after an oversized first row on the continuation", () => {
    const table = el(
      "<table><tbody><tr><td>alpha beta gamma delta</td></tr><tr><td>ZZ</td></tr></tbody></table>",
    );
    const split = splitTableElement(table as HTMLTableElement, fitsUnder(0), true);

    expect(split).not.toBeNull();
    expect(text(split![0])).toBe("alphabetagammadelta");
    expect(text(split![1])).toBe("ZZ");
  });

  it("reports no split when the cell has nothing left to break", () => {
    const table = el("<table><tbody><tr><td>A</td></tr></tbody></table>");
    expect(splitTableElement(table as HTMLTableElement, fitsUnder(0), true)).toBeNull();
  });
});
