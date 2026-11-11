// ─────────────────────────────────────────────────────────────────────────────
// CSS generation.
//
// Turns a PDFExportSettings object into the actual CSS strings the preview
// (shadow DOM) and export (print HTML) paths both consume — plus the MathJax
// stylesheet-extraction helpers needed to make typeset formulas show up
// correctly in either path. Everything here is pure string-building; it
// doesn't touch the DOM beyond reading already-rendered MathJax stylesheets.
// ─────────────────────────────────────────────────────────────────────────────

import { App, TFile, requestUrl } from "obsidian";
import { PAGE_SIZES, PDFExportSettings } from "./settings";

// ─── Small utilities ──────────────────────────────────────────────────────────

/** mm → px at 96 dpi, matching Electron's print pipeline. */
export const mmToPx = (mm: number) => (mm / 25.4) * 96;

/**
 * Returns the page dimensions in px for the current settings.
 * For "Custom", converts the user-entered mm values; for named sizes, looks up
 * PAGE_SIZES directly. Orientation swapping is handled by callers (doRender).
 */
export function resolvePageDims(s: PDFExportSettings): { w: number; h: number } {
  if (s.pageSize === "Custom") {
    return {
      w: Math.max(1, Math.round(mmToPx(s.customPageWidth))),
      h: Math.max(1, Math.round(mmToPx(s.customPageHeight))),
    };
  }
  return PAGE_SIZES[s.pageSize] ?? PAGE_SIZES["A4"];
}

export function escapeHTML(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Escapes `</style` in CSS text to prevent the HTML parser from ending the
// <style> block early, regardless of where the sequence appears.
export function escapeCSSForStyle(css: string): string {
  return css.replace(/<\/style/gi, "<\\/style");
}

/** Keeps the image corner radius (px) in the slider's 0–100 range, so a
 *  hand-edited data.json can't produce an invalid radius. */
export function clampImageRadius(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
  return Math.min(100, Math.max(0, n));
}

/** Converts a vault-relative path or bare filename to an app:// resource URL,
 *  or passes https:// / data: URLs through unchanged. Returns "" for blank input. */
export function resolveImageUrl(app: App, imagePath: string): string {
  const trimmed = imagePath.trim();
  if (!trimmed) return "";
  if (/^(https?:|data:)/i.test(trimmed)) return trimmed;
  const direct = app.vault.getAbstractFileByPath(trimmed);
  if (direct instanceof TFile) return app.vault.getResourcePath(direct);
  const resolved = app.metadataCache.getFirstLinkpathDest(trimmed, "");
  if (resolved instanceof TFile) return app.vault.getResourcePath(resolved);
  console.warn("[advanced-pdf-export] Could not resolve image path:", trimmed);
  return trimmed;
}

/** Maps a `backgroundImageSize` setting value to its CSS `background-size`
 *  and `background-repeat` values. Centralises logic that would otherwise be
 *  duplicated across the preview and export render paths. */
export function bgImageCssProps(size: PDFExportSettings["backgroundImageSize"]): { size: string; repeat: string } {
  return {
    size:   size === "fill" ? "100% 100%" : size === "tile" ? "auto" : size, // "cover" | "contain" pass through
    repeat: size === "tile" ? "repeat" : "no-repeat",
  };
}

// ─── Code block syntax highlighting ────────────────────────────────────────
// Obsidian highlights fenced code with Prism `.token.<name>` spans, but the
// theme CSS that colours them is stripped for export — colours are reapplied
// here independently via the same classes.

type TokenGroup =
  | "comment" | "punctuation" | "property" | "selector"
  | "operator" | "keyword" | "function" | "regex";

// Groups Prism's token classes into the small set of categories most colour
// schemes distinguish. Multiple Prism classes commonly share one colour.
const TOKEN_GROUP_CLASSES: Record<TokenGroup, string[]> = {
  comment:     ["comment", "prolog", "doctype", "cdata"],
  punctuation: ["punctuation"],
  property:    ["property", "tag", "boolean", "number", "constant", "symbol", "deleted", "attr-name"],
  selector:    ["selector", "string", "char", "builtin", "inserted", "attr-value"],
  operator:    ["operator", "entity", "url"],
  keyword:     ["atrule", "keyword", "important"],
  function:    ["function", "class-name"],
  regex:       ["regex", "variable"],
};

interface CodeColorTheme {
  name: string;
  /** `<pre>` background. Falls back to the doc style's "Code background" when unset. */
  background?: string;
  /** Base `<pre><code>` text color. Falls back to the doc style's "Body text color" when unset. */
  text?: string;
  tokens?: Partial<Record<TokenGroup, string>>;
}

export const CODE_THEMES: Record<string, CodeColorTheme> = {
  none: { name: "None (plain)" },
  "github-light": {
    name: "GitHub Light",
    background: "#f6f8fa", text: "#24292e",
    tokens: {
      comment: "#6a737d", punctuation: "#24292e", property: "#005cc5",
      selector: "#032f62", operator: "#d73a49", keyword: "#d73a49",
      function: "#6f42c1", regex: "#032f62",
    },
  },
  "github-dark": {
    name: "GitHub Dark",
    background: "#0d1117", text: "#c9d1d9",
    tokens: {
      comment: "#8b949e", punctuation: "#c9d1d9", property: "#79c0ff",
      selector: "#a5d6ff", operator: "#ff7b72", keyword: "#ff7b72",
      function: "#d2a8ff", regex: "#a5d6ff",
    },
  },
  "atom-one-light": {
    name: "Atom One Light",
    background: "#fafafa", text: "#383a42",
    tokens: {
      comment: "#a0a1a7", punctuation: "#383a42", property: "#986801",
      selector: "#50a14f", operator: "#0184bc", keyword: "#a626a4",
      function: "#4078f2", regex: "#50a14f",
    },
  },
  "atom-one-dark": {
    name: "Atom One Dark",
    background: "#282c34", text: "#abb2bf",
    tokens: {
      comment: "#5c6370", punctuation: "#abb2bf", property: "#d19a66",
      selector: "#98c379", operator: "#56b6c2", keyword: "#c678dd",
      function: "#61afef", regex: "#98c379",
    },
  },
  monokai: {
    name: "Monokai",
    background: "#272822", text: "#f8f8f2",
    tokens: {
      comment: "#75715e", punctuation: "#f8f8f2", property: "#ae81ff",
      selector: "#e6db74", operator: "#f92672", keyword: "#f92672",
      function: "#a6e22e", regex: "#e6db74",
    },
  },
  dracula: {
    name: "Dracula",
    background: "#282a36", text: "#f8f8f2",
    tokens: {
      comment: "#6272a4", punctuation: "#f8f8f2", property: "#bd93f9",
      selector: "#f1fa8c", operator: "#ff79c6", keyword: "#ff79c6",
      function: "#50fa7b", regex: "#ff79c6",
    },
  },
  "tokyo-night": {
    name: "Tokyo Night",
    background: "#1a1b26", text: "#a9b1d6",
    tokens: {
      comment: "#565f89", punctuation: "#89ddff", property: "#ff9e64",
      selector: "#9ece6a", operator: "#89ddff", keyword: "#bb9af7",
      function: "#7aa2f7", regex: "#b4f9f8",
    },
  },
  "solarized-light": {
    name: "Solarized Light",
    background: "#fdf6e3", text: "#586e75",
    tokens: {
      comment: "#93a1a1", punctuation: "#586e75", property: "#cb4b16",
      selector: "#2aa198", operator: "#859900", keyword: "#859900",
      function: "#268bd2", regex: "#2aa198",
    },
  },
  "catppuccin-macchiato": {
    name: "Catppuccin Macchiato",
    background: "#24273a", text: "#cad3f5",
    tokens: {
      comment: "#939ab7", punctuation: "#b8c0e0", property: "#f5a97f",
      selector: "#a6da95", operator: "#91d7e3", keyword: "#c6a0f6",
      function: "#8aadf4", regex: "#f5bde6",
    },
  },
  "catppuccin-mocha": {
    name: "Catppuccin Mocha",
    background: "#1e1e2e", text: "#cdd6f4",
    tokens: {
      comment: "#9399b2", punctuation: "#bac2de", property: "#fab387",
      selector: "#a6e3a1", operator: "#89dceb", keyword: "#cba6f7",
      function: "#89b4fa", regex: "#f5c2e7",
    },
  },
};

/** Builds the `<pre>`/`<pre><code>` rules plus Prism `.token.*` colour mappings
 *  for the selected code theme. "None" keeps the previous plain styling
 *  (code background + body color, no token colours). */
function buildCodeBlockCSS(s: PDFExportSettings): string {
  const theme = CODE_THEMES[s.codeTheme] ?? CODE_THEMES.none;
  const background = theme.background ?? s.codeBackground;
  const text = theme.text ?? s.bodyColor;
  const codeFontFamily = resolveCodeFont(s);
  const ligatures = s.codeFontLigatures ? "normal" : "none";

  const tokenRules = Object.entries(theme.tokens ?? {})
    .map(([group, color]) => {
      const selector = TOKEN_GROUP_CLASSES[group as TokenGroup]
        .map((cls) => `.mpdf-doc pre code .token.${cls}`)
        .join(", ");
      const italic = group === "comment" ? " font-style: italic;" : "";
      return `${selector} { color: ${color};${italic} }`;
    })
    .join("\n  ");

  return `
  .mpdf-doc pre {
    background: ${background};
    border-radius: 4px;
    padding: 10px 12px;
    margin: 0 0 ${s.paragraphSpacing}em;
    overflow: hidden;
  }
  .mpdf-doc pre code {
    font-family: ${codeFontFamily};
    font-variant-ligatures: ${ligatures};
    font-size: ${s.codeFontSize}em;
    color: ${text};
    white-space: pre-wrap;
    overflow-wrap: break-word;
    background: none;
    padding: 0;
  }
  ${tokenRules}`;
}

// ─── Doc CSS builder ──────────────────────────────────────────────────────────

/** Returns relative luminance (0–1) of a CSS hex color; non-hex values return 1 (treat as light). */
function hexLuminance(hex: string): number {
  const full = hex.replace(
    /^#([\da-f])([\da-f])([\da-f])$/i,
    (_, r, g, b) => `#${r}${r}${g}${g}${b}${b}`,
  );
  if (!/^#[\da-f]{6}$/i.test(full)) return 1;
  const linearize = (c: number) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  const r = linearize(parseInt(full.slice(1, 3), 16) / 255);
  const g = linearize(parseInt(full.slice(3, 5), 16) / 255);
  const b = linearize(parseInt(full.slice(5, 7), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Returns the resolved CSS font-family string for the current settings. */
export function resolveFont(s: PDFExportSettings): string {
  return s.fontFamily === "__custom__" ? (s.customFontName.trim() || "inherit") : s.fontFamily;
}

/** Returns the resolved CSS font-family string for code blocks (inline and fenced). */
export function resolveCodeFont(s: PDFExportSettings): string {
  return s.codeFontFamily === "__custom__"
    ? (s.customCodeFontName.trim() || "'Courier New', monospace")
    : s.codeFontFamily;
}

/** Builds the full `.mpdf-doc` stylesheet (typography, tables, callouts,
 *  mermaid, code blocks) shared verbatim by the preview shadow DOM and the
 *  export print HTML. */
function formatFencedCss(content: string) : string {
  const sections = [...content.matchAll(/```css([\s\S]*?)```/g)].map( m => m[1].trim() );
  const css = sections.join("\n\n").trim();
  return css;
}

export function buildDocCSS(s: PDFExportSettings, isRTL = false): string {
  const hs = s.headingScale;
  const fontFamily = resolveFont(s);
  const codeFontFamily = resolveCodeFont(s);
  const tableHeaderTextColor =
    hexLuminance(s.tableHeaderBg) < 0.35 ? "#fff" : s.headingColor;
  const codeCss = buildCodeBlockCSS(s);
  let userCss = "";
  if ( s.customCssEnabled ) {
    userCss = formatFencedCss(s.currentCss);
  } else {
    userCss = formatFencedCss(s.defaultCss);
  }
  return (`
  .mpdf-doc {
    --pageSize: ${s.pageSize};
    --orientation: ${s.orientation};
    --preset: ${s.preset};
    --name: ${s.name};
    --fontFamily: ${fontFamily};
    --fontSize: ${s.fontSize}px;
    --lineHeight: ${s.lineHeight};
    --paragraphSpacing: ${s.paragraphSpacing}em;
    --headingScale: ${s.headingScale};
    --accentColor: ${s.accentColor};
    --bodyColor: ${s.bodyColor};
    --boldColor : ${s.boldColor};
    --headingScale: ${hs};
    --headingColor: ${s.headingColor};
    --h1BorderBottom: ${s.h1BorderBottom ? `2px solid ${s.accentColor}`: "none"};
    --h1PaddingBottom: ${s.h1BorderBottom ? "6px" : "auto"};
    --h2BorderBottom: ${s.h2BorderBottom ? `0.5px solid ${s.accentColor}55`: "none"};
    --h2PaddingBottom: ${s.h2BorderBottom ? "5px" : "auto"};
    --h1Align: ${s.centerH1 ? "center" : "left"};
    --textDirection: ${isRTL ? "rtl" : "ltr"};
    
    --blockQuoteBorderColor: ${s.blockquoteBorderColor};
    --blockQuoteBg: ${s.blockquoteBg};
    --codeFontFamily: ${codeFontFamily};
    --codeBackground: ${s.codeBackground};
    --codeFontSize: ${s.codeFontSize}em;
    --tableHeaderBg: ${s.tableHeaderBg};
    --tableHeaderTextColor: ${tableHeaderTextColor};
    --tableBorderColor: ${s.tableBorderColor};
    --tableStriping: ${s.tableStriped ? `${s.tableHeaderBg}55` : "auto"};
    --pageBackground: ${s.pageBackground};
    --codeFontLigatures: ${s.codeFontLigatures ? "normal" : "none"};
    --imageRadius: ${clampImageRadius(s.imageRadius)}px;
    --linkUnderline: ${s.linkUnderline ? "underline" : "none"};
  }` + codeCss + userCss).trim();
}

// ─── MathJax CSS extraction ───────────────────────────────────────────────────
// MathJax's CHTML output renders formulas via per-glyph CSS rules it writes
// incrementally at typeset time, rather than a static stylesheet — these
// helpers pull that generated CSS out so the preview shadow DOM and the
// export print HTML can both include it.

/** Collects MathJax's CSS for inclusion in shadow DOMs and the export HTML.
 *  Checked from three places — missing any one silently drops specific
 *  glyphs, with no error, while everything else renders fine:
 *    1. `style[id^='MJX-']` elements' `.textContent` — static `@font-face`
 *       rules plus whatever common characters were in the tag's original text.
 *    2. Those same elements' live `.sheet.cssRules` — MathJax's `adaptiveCSS`
 *       mode adds per-glyph rules via `insertRule()`, which updates the live
 *       sheet but never touches `.textContent`. Reading it directly makes
 *       source 1 redundant whenever `.sheet` is accessible; textContent is
 *       kept only as a fallback for the rare case a sheet can't be reached.
 *    3. `document.adoptedStyleSheets` — Constructable Stylesheets have no
 *       corresponding `<style>` DOM node, so no amount of
 *       `querySelectorAll('style')` can see them regardless of which
 *       property is read. */
export function getMathJaxCSS(): string {
  const styleEls = Array.from(
    activeDocument.head.querySelectorAll<HTMLStyleElement>("style[id^='MJX-']"),
  );

  const styleTagCSS = styleEls
    .map((el) => {
      try {
        if (el.sheet?.cssRules) {
          return Array.from(el.sheet.cssRules).map((rule) => rule.cssText).join("\n");
        }
      } catch {
        // sheet inaccessible on this element; fall back to textContent below
      }
      return el.textContent ?? "";
    })
    .join("\n");

  let adoptedCSS = "";
  try {
    const sheets = activeDocument.adoptedStyleSheets ?? [];
    adoptedCSS = sheets
      .map((sheet) => {
        try {
          return Array.from(sheet.cssRules).map((rule) => rule.cssText).join("\n");
        } catch {
          return ""; // rules inaccessible on this sheet; skip it, keep the rest
        }
      })
      .filter(Boolean)
      .join("\n");
  } catch (err) {
    // adoptedStyleSheets unsupported in this Electron/Chromium build — degrade
    // to style-tag CSS only.
    console.warn("[advanced-pdf-export] adoptedStyleSheets read failed:", err);
  }

  return adoptedCSS ? `${styleTagCSS}\n${adoptedCSS}` : styleTagCSS;
}

/** Strips @font-face rules from CSS before injecting into shadow-DOM adoptedStyleSheets.
 *  Some Electron builds silently fail to load fonts declared there; MathJax's own
 *  document-head @font-face rules remain accessible to shadow-DOM content per spec. */
export function stripAtFontFaces(css: string): string {
  return css.replace(/@font-face\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)?\}/g, "");
}

// Matches url(...) references in CSS — used by getMathJaxCSSInlined to collect
// and replace font URLs with base64 data URIs. String.replace() and matchAll()
// both reset lastIndex to 0 on each call, so this g-flagged constant is safe to share.
const CSS_URL_RE = /url\(\s*["']?([^"')]+)["']?\s*\)/g;

/** Returns MathJax CSS with all font url() references replaced by base64 data URIs.
 *  The export BrowserWindow (loaded from a blob: URL) cannot resolve relative
 *  font paths. Read app:// resources in the source window before moving the CSS;
 *  on fetch error, retain the absolute URL and report the failed resource. */
export async function getMathJaxCSSInlined(): Promise<string> {
  const css = getMathJaxCSS();
  if (!css) return "";

  const urlSet = new Set<string>();
  for (const [, u] of css.matchAll(CSS_URL_RE)) {
    const trimmedU = u.trim();
    if (!trimmedU.startsWith("data:")) urlSet.add(trimmedU);
  }

  if (!urlSet.size) return css;

  const toDataUri = async (url: string): Promise<string> => {
    let absoluteURL = url;
    try {
      // MathJax 4 serves /lib/mathjax/... fonts from Obsidian's app:// origin.
      absoluteURL = new URL(url, activeDocument.baseURI).href;
      let buffer: ArrayBuffer;
      if (/^https?:/i.test(absoluteURL)) {
        // Keep remote fonts CORS-free; renderer fetch is needed for app:// resources.
        const res = await requestUrl(absoluteURL);
        if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
        buffer = res.arrayBuffer;
      } else {
        const res = await activeWindow.fetch(absoluteURL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        buffer = await res.arrayBuffer();
      }
      const bytes = new Uint8Array(buffer);
      let bin = "";
      for (let i = 0; i < bytes.length; i += 8192) // chunk to avoid stack overflow
        bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, bytes.length)));
      const b64  = btoa(bin);
      const low  = absoluteURL.toLowerCase();
      const mime = low.includes("woff2") ? "font/woff2"
                 : low.includes("woff")  ? "font/woff"
                 : low.includes(".ttf")  ? "font/ttf"
                 : "font/otf";
      return `data:${mime};base64,${b64}`;
    } catch (err) {
      console.warn("[advanced-pdf-export] failed to inline math font:", absoluteURL, err);
      return absoluteURL;
    }
  };

  const entries = await Promise.all(
    Array.from(urlSet).map(async (url) => [url, await toDataUri(url)] as const),
  );
  const resolved = new Map(entries);

  return css.replace(CSS_URL_RE, (match, raw: string) => {
    const data = resolved.get(raw.trim());
    return data && data !== raw.trim() ? `url('${data}')` : match;
  });
}

/** Polls `getMathJaxCSS()`'s output size until it stops changing for two
 *  consecutive checks, confirming MathJax's `adaptiveCSS` has finished writing
 *  per-glyph rules for this render pass — DOM insertion of `mjx-container`
 *  alone doesn't guarantee that. Bounded by MAX_WAIT_MS so an already-settled
 *  stylesheet doesn't stall the export; resolves in ~2 polls in that case. */
export async function waitForMathJaxStylesheetStable(): Promise<void> {
  const POLL_MS = 60;
  const STABLE_ROUNDS = 2;
  const MAX_WAIT_MS = 2500;

  const start = Date.now();
  let lastLen = getMathJaxCSS().length;
  let stableRounds = 0;

  while (stableRounds < STABLE_ROUNDS && Date.now() - start < MAX_WAIT_MS) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, POLL_MS));
    const len = getMathJaxCSS().length;
    if (len === lastLen) {
      stableRounds++;
    } else {
      stableRounds = 0;
      lastLen = len;
    }
  }
}
