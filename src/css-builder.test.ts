import { describe, it, expect } from "vitest";
import { buildDocCSS } from "./css-builder";
import { DEFAULT_SETTINGS } from "./settings";

/** The `text-align` declared by the rule whose selector list contains `selector`,
 *  or undefined when no rule matches it. Comments are stripped first: they hold
 *  commas and colons of their own, which would otherwise swallow the selectors
 *  of the rule that follows them. */
function textAlignFor(css: string, selector: string): string | undefined {
  for (const [, selectors, body] of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectors.split(",").some((s) => s.trim() === selector)) continue;
    return body.match(/text-align:\s*([^;]+);/)?.[1].trim();
  }
  return undefined;
}

// Markdown column alignment (|:--:|) reaches the DOM as an align attribute on
// th/td, and the presentational hint it maps to loses to any author rule — so the
// base th rule's text-align: start flattened every header to the start edge while
// body cells kept the note's alignment. These rules have to out-specify it, which
// they do by matching the attribute.
describe("buildDocCSS table alignment", () => {
  const css = buildDocCSS({ ...DEFAULT_SETTINGS });

  it("aligns headers per align attribute value", () => {
    expect(textAlignFor(css, '.mpdf-doc th[align="left"]')).toBe("start");
    expect(textAlignFor(css, '.mpdf-doc th[align="center"]')).toBe("center");
    expect(textAlignFor(css, '.mpdf-doc th[align="right"]')).toBe("end");
  });

  // Body cells had no text-align of their own, so the hint held there. The rules
  // exist so a right-to-left note keeps its headers and body cells on the same
  // edge instead of straddling the table.
  it("aligns body cells to match the headers", () => {
    expect(textAlignFor(css, '.mpdf-doc td[align="left"]')).toBe("start");
    expect(textAlignFor(css, '.mpdf-doc td[align="center"]')).toBe("center");
    expect(textAlignFor(css, '.mpdf-doc td[align="right"]')).toBe("end");
  });

  it("leaves a header with no align attribute at the start edge", () => {
    expect(textAlignFor(css, ".mpdf-doc th")).toBe("start");
  });

  // start/end mirror the attribute in a right-to-left note, the way Obsidian's own
  // reading view does, so the mapping must not be gated on the isRTL flag.
  it("maps the same way for right-to-left notes", () => {
    const rtl = buildDocCSS({ ...DEFAULT_SETTINGS }, true);
    expect(textAlignFor(rtl, '.mpdf-doc th[align="center"]')).toBe("center");
    expect(textAlignFor(rtl, '.mpdf-doc th[align="right"]')).toBe("end");
    expect(textAlignFor(rtl, '.mpdf-doc td[align="right"]')).toBe("end");
  });
});
