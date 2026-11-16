import { describe, it, expect } from "vitest";
import { buildDocCSS, clampImageRadius, withAlpha } from "./css-builder";
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

describe("buildDocCSS image radius", () => {
  const imgRule = (css: string) => css.match(/\.mpdf-doc img \{[^}]*\}/)?.[0] ?? "";

  it("defaults to square corners", () => {
    expect(imgRule(buildDocCSS({ ...DEFAULT_SETTINGS }))).toContain("border-radius: 0px");
  });

  it("applies the configured radius in px", () => {
    expect(imgRule(buildDocCSS({ ...DEFAULT_SETTINGS, imageRadius: 24 }))).toContain("border-radius: 24px");
  });

  it("clamps out-of-range and invalid values", () => {
    expect(clampImageRadius(250)).toBe(100);
    expect(clampImageRadius(-5)).toBe(0);
    expect(clampImageRadius(undefined)).toBe(0);
    expect(clampImageRadius(NaN)).toBe(0);
  });
});

describe("buildDocCSS task checkboxes", () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    accentColor: "#123456",
    bodyColor: "#654321",
    pageBackground: "#abcdef",
  };

  it("styles unchecked boxes and keeps task-list indentation", () => {
    const css = buildDocCSS(settings);
    expect(css).toContain('.mpdf-doc li:has(input[type="checkbox"]) { list-style: none; }');
    expect(css).toContain("border: 1.5px solid #654321b3");
    expect(css).toContain("border-radius: 3px");
    expect(css).toContain("background: transparent");
  });

  it("uses the page background for the checkmark and accent for checked boxes", () => {
    const css = buildDocCSS(settings);
    expect(css).toContain("background: #abcdef");
    expect(css).toContain("data:image/svg+xml");
    expect(css).toContain("background: #123456");
    expect(css).toContain("border: 1.5px solid #123456b3");
  });

  it("mutes and strikes only the task whose direct checkbox is checked", () => {
    const css = buildDocCSS(settings);
    expect(css).toContain(
      '.mpdf-doc li:has(> input[type="checkbox"]:checked) {',
    );
    expect(css).not.toContain(
      '.mpdf-doc li:has(input[type="checkbox"]:checked) {',
    );
    expect(css).toContain("color: #6543218c");
    expect(css).toContain("text-decoration: line-through");
  });
});

describe("withAlpha", () => {
  it("expands shorthand hex before adding alpha", () => {
    expect(withAlpha("#111", "b3")).toBe("#111111b3");
  });
});
