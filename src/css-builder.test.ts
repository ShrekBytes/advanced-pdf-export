import { describe, it, expect } from "vitest";
import { buildDocCSS, clampImageRadius } from "./css-builder";
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

describe("buildDocCSS callout colors", () => {
  function ruleBodyFor(css: string, selector: string): string | undefined {
    for (const [, selectors, body] of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!selectors.split(",").some((s) => s.trim() === selector)) continue;
      return body.trim();
    }
    return undefined;
  }

  it("omits per-type callout rules by default", () => {
    const css = buildDocCSS({ ...DEFAULT_SETTINGS });
    expect(css).not.toContain("[data-callout=");
  });

  it("emits rules for all canonical callout types and their Obsidian aliases when enabled", () => {
    const css = buildDocCSS({ ...DEFAULT_SETTINGS, useCalloutColors: true });
    const canonicalTypes = ["tip", "warning", "success", "question", "info", "note", "abstract", "danger", "bug", "example", "quote"];
    const aliases = ["hint", "important", "caution", "check", "faq", "todo", "error", "cite"];
    for (const type of [...canonicalTypes, ...aliases]) {
      expect(ruleBodyFor(css, `.mpdf-doc .callout[data-callout="${type}" i]`)).toBeDefined();
    }
  });

  it("applies custom callout colors with alpha suffixes to border, title, icon, and backgrounds", () => {
    const css = buildDocCSS({
      ...DEFAULT_SETTINGS,
      useCalloutColors: true,
      calloutTipColor: "#123456",
    });
    const baseBody = ruleBodyFor(css, '.mpdf-doc .callout[data-callout="tip" i]') ?? "";
    const titleBody = ruleBodyFor(css, '.mpdf-doc .callout[data-callout="tip" i] .callout-title') ?? "";
    const iconBody = ruleBodyFor(css, '.mpdf-doc .callout[data-callout="tip" i] .callout-icon') ?? "";
    const svgBody = ruleBodyFor(css, '.mpdf-doc .callout[data-callout="tip" i] .callout-icon svg') ?? "";

    expect(baseBody).toContain("border-inline-start-color: #123456 !important");
    expect(baseBody).toContain("background: #12345612 !important");
    expect(titleBody).toContain("background: #12345628 !important");
    expect(titleBody).toContain("color: #123456 !important");
    expect(iconBody).toContain("color: #123456 !important");
    expect(svgBody).toContain("stroke: #123456 !important");
  });

  it("expands 3-digit hex colors to 6 digits and falls back to DEFAULT_SETTINGS when invalid", () => {
    const css = buildDocCSS({
      ...DEFAULT_SETTINGS,
      useCalloutColors: true,
      calloutWarningColor: "#f0a",
      calloutDangerColor: "not-a-hex",
    });
    const warningBody = ruleBodyFor(css, '.mpdf-doc .callout[data-callout="warning" i]') ?? "";
    const dangerBody = ruleBodyFor(css, '.mpdf-doc .callout[data-callout="danger" i]') ?? "";

    expect(warningBody).toContain("border-inline-start-color: #ff00aa !important");
    expect(warningBody).toContain("background: #ff00aa12 !important");
    expect(dangerBody).toContain(`border-inline-start-color: ${DEFAULT_SETTINGS.calloutDangerColor} !important`);
    expect(dangerBody).toContain(`background: ${DEFAULT_SETTINGS.calloutDangerColor}12 !important`);
  });
});

