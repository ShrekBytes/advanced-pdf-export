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

describe("buildDocCSS text alignment", () => {
  const ruleFor = (css: string, selector: string) =>
    css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{[^}]*\\}`))?.[0] ?? "";

  it("defaults to auto and leaves p and li without text-align", () => {
    expect(DEFAULT_SETTINGS.textAlign).toBe("auto");
    const css = buildDocCSS({ ...DEFAULT_SETTINGS });
    expect(textAlignFor(css, ".mpdf-doc p")).toBeUndefined();
    expect(textAlignFor(css, ".mpdf-doc li")).toBeUndefined();
  });

  it.each(["left", "center", "right"] as const)("applies %s alignment to p and li", (align) => {
    const css = buildDocCSS({ ...DEFAULT_SETTINGS, textAlign: align });
    expect(textAlignFor(css, ".mpdf-doc p")).toBe(align);
    expect(textAlignFor(css, ".mpdf-doc li")).toBe(align);
    expect(ruleFor(css, ".mpdf-doc p")).not.toContain("hyphens: auto");
  });

  it("justifies p and li with hyphenation and word wrapping when textAlign is justify", () => {
    const css = buildDocCSS({ ...DEFAULT_SETTINGS, textAlign: "justify" });
    expect(textAlignFor(css, ".mpdf-doc p")).toBe("justify");
    expect(textAlignFor(css, ".mpdf-doc li")).toBe("justify");
    expect(ruleFor(css, ".mpdf-doc p")).toContain("hyphens: auto");
    expect(ruleFor(css, ".mpdf-doc p")).toContain("overflow-wrap: break-word");
    expect(ruleFor(css, ".mpdf-doc li")).toContain("hyphens: auto");
    expect(ruleFor(css, ".mpdf-doc li")).toContain("overflow-wrap: break-word");
  });

  it("keeps natural direction in RTL mode when textAlign is auto, and justifies when justify", () => {
    const rtlAuto = buildDocCSS({ ...DEFAULT_SETTINGS, textAlign: "auto" }, true);
    expect(textAlignFor(rtlAuto, ".mpdf-doc p")).toBeUndefined();
    expect(textAlignFor(rtlAuto, ".mpdf-doc li")).toBeUndefined();

    const rtlJustify = buildDocCSS({ ...DEFAULT_SETTINGS, textAlign: "justify" }, true);
    expect(textAlignFor(rtlJustify, ".mpdf-doc p")).toBe("justify");
    expect(textAlignFor(rtlJustify, ".mpdf-doc li")).toBe("justify");
  });

  it("isolates code blocks from inherited alignment and hyphenation", () => {
    const css = buildDocCSS({ ...DEFAULT_SETTINGS, textAlign: "justify" });
    expect(textAlignFor(css, ".mpdf-doc pre")).toBe("start");
    expect(textAlignFor(css, ".mpdf-doc pre code")).toBe("start");
    expect(ruleFor(css, ".mpdf-doc pre")).toContain("hyphens: none");
    expect(ruleFor(css, ".mpdf-doc pre code")).toContain("hyphens: none");
  });

  it("disables hyphenation and preserves wrapping on inline code", () => {
    const css = buildDocCSS({ ...DEFAULT_SETTINGS, textAlign: "justify" });
    expect(ruleFor(css, ".mpdf-doc code")).toContain("white-space: pre-wrap");
    expect(ruleFor(css, ".mpdf-doc code")).toContain("hyphens: none");
  });

  it("applies symmetric inline padding and removes trailing paragraph margin in blockquotes", () => {
    const css = buildDocCSS({ ...DEFAULT_SETTINGS, textAlign: "justify" });
    expect(ruleFor(css, ".mpdf-doc blockquote")).toContain("padding-inline: 1em;");
    expect(ruleFor(css, ".mpdf-doc blockquote > p:last-child")).toContain("margin-bottom: 0");
  });

  it("emits per-block alignment override rules and keeps pre blocks isolated inside aligned blocks", () => {
    const css = buildDocCSS({ ...DEFAULT_SETTINGS, textAlign: "auto" });
    for (const align of ["left", "center", "right"] as const) {
      expect(css).toContain(`.mpdf-doc [data-mpdf-align="${align}"]`);
      expect(css).toContain(`text-align: ${align}; hyphens: none;`);
    }
    expect(css).toContain('.mpdf-doc [data-mpdf-align="justify"]');
    expect(css).toContain("text-align: justify; text-justify: inter-word; hyphens: auto; overflow-wrap: break-word;");
    expect(css).toContain(".mpdf-doc [data-mpdf-align] pre");
  });
});
