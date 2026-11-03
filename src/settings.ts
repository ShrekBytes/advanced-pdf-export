// ─────────────────────────────────────────────────────────────────────────────
// Settings schema, style presets, and defaults.
//
// This is the plugin's data model: the shape of a saved settings object, the
// seven built-in style presets, and the values a fresh install starts with.
// Pure data + types — no Obsidian imports, no rendering logic. Anything that
// *turns* these settings into CSS lives in css-builder.ts; anything that
// *edits* them lives in settings-tab.ts.
// ─────────────────────────────────────────────────────────────────────────────

export const PAGE_SIZES: Record<string, { w: number; h: number }> = {
  A4:     { w: 794,  h: 1123 },
  A3:     { w: 1123, h: 1587 },
  Letter: { w: 816,  h: 1056 },
  Legal:  { w: 816,  h: 1344 },
  A5:     { w: 559,  h: 794  },
};

export interface DocStyle {
  name: string;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  paragraphSpacing: number;
  headingScale: number;
  accentColor: string;
  bodyColor: string;
  boldColor: string;
  headingColor: string;
  h1BorderBottom: boolean;
  h2BorderBottom: boolean;
  centerH1: boolean;
  blockquoteBg: string;
  blockquoteBorderColor: string;
  codeBackground: string;
  codeFontSize: number;
  codeFontFamily: string;
  codeTheme: string;
  tableHeaderBg: string;
  tableBorderColor: string;
  tableStriped: boolean;
  pageBackground: string;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
}

export interface PDFExportSettings extends DocStyle {
  pageSize: string;
  orientation: "portrait" | "landscape";
  preset: string;
  headerText: string;
  footerText: string;
  showHeader: boolean;
  showFooter: boolean;
  showHeaderBorder: boolean;
  showFooterBorder: boolean;
  showPageNumbers: boolean;
  pageNumberPosition: "center" | "left" | "right";
  pageNumberStart: number;
  /** Template for rendering the page number string. Supports {{current}},
   *  {{total}}, and {{title}} placeholders, e.g. "Page {{current}} of {{total}}". */
  pageNumberFormat: string;
  showHeaderOnFirstPage: boolean;
  showFooterOnFirstPage: boolean;
  headerAlignment: "left" | "center" | "right";
  footerTextAlignment: "left" | "center" | "right";
  headerFontSize: number;
  headerFontColor: string;
  footerFontSize: number;
  footerFontColor: string;
  linkUnderline: boolean;
  /** Corner radius of images in the export, in px (0 = square). */
  imageRadius: number;
  frameEnabled: boolean;
  frameColor: string;
  frameThickness: number;
  frameMargin: number;
  frameStyle: "solid" | "dashed" | "dotted" | "double" | "groove" | "ridge";
  hideFrontmatter: boolean;
  customFontName: string;
  /** Used only when codeFontFamily === "__custom__". */
  customCodeFontName: string;
  /** Typographic ligatures (e.g. -> and !=) for fonts that support them, such as Fira Code. */
  codeFontLigatures: boolean;
  autoBreakH1: boolean;
  autoBreakH2: boolean;
  includeFilenameAsTitle: boolean;
  previewScale: number;
  /** Width in mm, used only when pageSize === "Custom". */
  customPageWidth: number;
  /** Height in mm, used only when pageSize === "Custom". */
  customPageHeight: number;

  // ── Header/footer band sizing ─────────────────────────────────────────────
  /** Explicit header band height in px. 0 = auto (derived from headerFontSize). */
  headerHeight: number;
  /** Explicit footer band height in px. 0 = auto (derived from footerFontSize). */
  footerHeight: number;

  // ── Header/footer banner images ───────────────────────────────────────────
  /** Vault-relative path or https:// URL for a banner image behind the header text. */
  headerImagePath: string;
  /** Left/right gap in px between the banner image and the page edges (0 = edge-to-edge). */
  headerImageMargin: number;
  footerImagePath: string;
  /** Left/right gap in px between the banner image and the page edges. */
  footerImageMargin: number;

  // ── Page background (color OR image — mutually exclusive) ────────────────
  /** When true, backgroundImagePath is used instead of the pageBackground color. */
  backgroundImageEnabled: boolean;
  backgroundImagePath: string;
  /** How the image fills the background zone. */
  backgroundImageSize: "cover" | "contain" | "fill" | "tile";
  /** "full-page": behind header+content+footer. "content-only": text zone only. */
  backgroundImageScope: "full-page" | "content-only";
  /** 0–1 opacity for the background image layer. */
  backgroundImageOpacity: number;
  /** When true, headings H1–H6 are embedded as a bookmark tree in the exported PDF. */
  includeOutline: boolean;

  // ── Save location ──────────────────────────────────────────────────────────
  /** When true, the save dialog opens in the note's own folder with the note's
   *  file name pre-filled as ".pdf". Ignored when there is no source note. */
  prefillSaveLocation: boolean;

  // ── Custom CSS for .mpdf-doc ────────────────────────────────────────────────
  /** Adds everything but 
  */
   docCss : string;
}

// ─── Style Presets ────────────────────────────────────────────────────────────

export const PRESETS: Record<string, DocStyle> = {
  default: {
    name: "Default",
    fontFamily: "Georgia, serif",
    fontSize: 13,
    lineHeight: 1.85,
    paragraphSpacing: 0.65,
    headingScale: 1.0,
    accentColor: "#7c6af7",
    bodyColor: "#1a1a2e",
    boldColor: "#1a1a2e",
    headingColor: "#0d0d1a",
    h1BorderBottom: false,
    h2BorderBottom: true,
    centerH1: false,
    blockquoteBg: "transparent",
    blockquoteBorderColor: "#7c6af7",
    codeBackground: "#f0f0f8",
    codeFontSize: 0.85,
    codeFontFamily: "'Courier New', monospace",
    codeTheme: "github-light",
    tableHeaderBg: "#f0f0f8",
    tableBorderColor: "#7c6af7",
    tableStriped: true,
    pageBackground: "#ffffff",
    marginTop: 20, marginBottom: 20, marginLeft: 25, marginRight: 25,
  },
  minimal: {
    name: "Minimal",
    fontFamily: "'Helvetica Neue', Helvetica, sans-serif",
    fontSize: 12,
    lineHeight: 1.6,
    paragraphSpacing: 0.45,
    headingScale: 0.88,
    accentColor: "#333",
    bodyColor: "#222",
    boldColor: "#222",
    headingColor: "#111",
    h1BorderBottom: false,
    h2BorderBottom: false,
    centerH1: false,
    blockquoteBg: "#f8f8f8",
    blockquoteBorderColor: "#ccc",
    codeBackground: "#f4f4f4",
    codeFontSize: 0.82,
    codeFontFamily: "'Courier New', monospace",
    codeTheme: "none",
    tableHeaderBg: "#efefef",
    tableBorderColor: "#333",
    tableStriped: false,
    pageBackground: "#ffffff",
    marginTop: 16, marginBottom: 16, marginLeft: 20, marginRight: 20,
  },
  academic: {
    name: "Academic",
    fontFamily: "'Times New Roman', Times, serif",
    fontSize: 12,
    lineHeight: 2.0,
    paragraphSpacing: 0.0,
    headingScale: 0.95,
    accentColor: "#1a3a6b",
    bodyColor: "#000",
    boldColor: "#000",
    headingColor: "#000",
    h1BorderBottom: true,
    h2BorderBottom: true,
    centerH1: true,
    blockquoteBg: "transparent",
    blockquoteBorderColor: "#999",
    codeBackground: "#f9f9f9",
    codeFontSize: 0.88,
    codeFontFamily: "'Courier New', monospace",
    codeTheme: "solarized-light",
    tableHeaderBg: "#e8e8e8",
    tableBorderColor: "#1a3a6b",
    tableStriped: false,
    pageBackground: "#ffffff",
    marginTop: 25, marginBottom: 25, marginLeft: 30, marginRight: 30,
  },
  colorful: {
    name: "Colorful",
    fontFamily: "Georgia, serif",
    fontSize: 13,
    lineHeight: 1.85,
    paragraphSpacing: 0.65,
    headingScale: 1.05,
    accentColor: "#e84393",
    bodyColor: "#1a1a2e",
    boldColor: "#1a1a2e",
    headingColor: "#2d0a4e",
    h1BorderBottom: false,
    h2BorderBottom: false,
    centerH1: false,
    blockquoteBg: "#fdf0f8",
    blockquoteBorderColor: "#e84393",
    codeBackground: "#f0eaff",
    codeFontSize: 0.85,
    codeFontFamily: "'Courier New', monospace",
    codeTheme: "dracula",
    tableHeaderBg: "#2d0a4e",
    tableBorderColor: "#e84393",
    tableStriped: true,
    pageBackground: "#ffffff",
    marginTop: 20, marginBottom: 20, marginLeft: 25, marginRight: 25,
  },
  modern: {
    name: "Modern",
    fontFamily: "Arial, sans-serif",
    fontSize: 13,
    lineHeight: 1.75,
    paragraphSpacing: 0.6,
    headingScale: 1.0,
    accentColor: "#0070f3",
    bodyColor: "#111",
    boldColor: "#111",
    headingColor: "#000",
    h1BorderBottom: false,
    h2BorderBottom: false,
    centerH1: false,
    blockquoteBg: "#f0f7ff",
    blockquoteBorderColor: "#0070f3",
    codeBackground: "#f1f5f9",
    codeFontSize: 0.85,
    codeFontFamily: "'Courier New', monospace",
    codeTheme: "github-dark",
    tableHeaderBg: "#0070f3",
    tableBorderColor: "#0070f3",
    tableStriped: true,
    pageBackground: "#ffffff",
    marginTop: 20, marginBottom: 20, marginLeft: 25, marginRight: 25,
  },
  newspaper: {
    name: "Newspaper",
    fontFamily: "Georgia, serif",
    fontSize: 12,
    lineHeight: 1.7,
    paragraphSpacing: 0.4,
    headingScale: 1.1,
    accentColor: "#111",
    bodyColor: "#111",
    boldColor: "#111",
    headingColor: "#000",
    h1BorderBottom: true,
    h2BorderBottom: true,
    centerH1: true,
    blockquoteBg: "transparent",
    blockquoteBorderColor: "#111",
    codeBackground: "#f4f4f4",
    codeFontSize: 0.82,
    codeFontFamily: "'Courier New', monospace",
    codeTheme: "none",
    tableHeaderBg: "#111",
    tableBorderColor: "#111",
    tableStriped: false,
    pageBackground: "#ffffff",
    marginTop: 18, marginBottom: 18, marginLeft: 20, marginRight: 20,
  },
  dark: {
    name: "Dark",
    fontFamily: "Georgia, serif",
    fontSize: 13,
    lineHeight: 1.85,
    paragraphSpacing: 0.65,
    headingScale: 1.0,
    accentColor: "#818cf8",
    bodyColor: "#d1d5db",
    boldColor: "#d1d5db",
    headingColor: "#f1f5f9",
    h1BorderBottom: false,
    h2BorderBottom: true,
    centerH1: false,
    blockquoteBg: "#1e293b",
    blockquoteBorderColor: "#818cf8",
    codeBackground: "#0f172a",
    codeFontSize: 0.85,
    codeFontFamily: "'Courier New', monospace",
    codeTheme: "tokyo-night",
    tableHeaderBg: "#1e293b",
    tableBorderColor: "#818cf8",
    tableStriped: true,
    pageBackground: "#111827",
    marginTop: 20, marginBottom: 20, marginLeft: 25, marginRight: 25,
  },
};

export const DEFAULT_SETTINGS: PDFExportSettings = {
  pageSize: "A4",
  orientation: "portrait",
  preset: "default",
  ...PRESETS["default"],
  headerText: "",
  footerText: "",
  showHeader: true,
  showFooter: true,
  showHeaderBorder: false,
  showFooterBorder: false,
  showPageNumbers: true,
  pageNumberPosition: "right",
  pageNumberStart: 1,
  pageNumberFormat: "{{current}} / {{total}}",
  showHeaderOnFirstPage: true,
  showFooterOnFirstPage: true,
  headerAlignment:     "right",
  footerTextAlignment: "left",
  headerFontSize: 9,
  headerFontColor: "#999999",
  footerFontSize: 9,
  footerFontColor: "#aaaaaa",
  linkUnderline: true,
  imageRadius: 0,
  frameEnabled: false,
  frameColor: "#000000",
  frameThickness: 4,
  frameMargin: 8,
  frameStyle: "solid",
  hideFrontmatter: false,
  customFontName: "",
  customCodeFontName: "",
  codeFontLigatures: false,
  autoBreakH1: false,
  autoBreakH2: false,
  includeFilenameAsTitle: false,
  previewScale: 0.9,
  customPageWidth: 210,   // A4 width in mm
  customPageHeight: 297,  // A4 height in mm
  // Band sizing (0 = auto from font size)
  headerHeight: 0,
  footerHeight: 0,
  // Banner images (header / footer background)
  headerImagePath: "",
  headerImageMargin: 0,
  footerImagePath: "",
  footerImageMargin: 0,
  // Page background
  backgroundImageEnabled: false,
  backgroundImagePath: "",
  backgroundImageSize: "cover",
  backgroundImageScope: "full-page",
  backgroundImageOpacity: 1,
  // Outline / bookmarks
  includeOutline: true,
  // Save location
  prefillSaveLocation: true,
  // docCss
  docCss : `.mpdf-doc {
    font-family: var(--fontFamily);
    font-size: var(--fontSize);
    line-height: var(--lineHeight);
    color: var(--bodyColor);
    box-sizing: border-box;
    direction: var(--textDirection);
  }
  .mpdf-doc *, .mpdf-doc *::before, .mpdf-doc *::after { box-sizing: border-box; }
  .mpdf-doc strong, .mpdf-doc b { 
    font-weight: 700; 
    font-style: normal; 
    color: var(--boldColor); 
  }
  .mpdf-doc h1 strong, .mpdf-doc h1 b,
  .mpdf-doc h2 strong, .mpdf-doc h2 b,
  .mpdf-doc h3 strong, .mpdf-doc h3 b,
  .mpdf-doc h4 strong, .mpdf-doc h4 b,
  .mpdf-doc h5 strong, .mpdf-doc h5 b,
  .mpdf-doc h6 strong, .mpdf-doc h6 b { 
    color: inherit; 
  }
  .mpdf-doc em, .mpdf-doc i { 
    font-style: italic; 
    font-weight: inherit; 
  }
  .mpdf-doc mark { 
    background: #ffe066;
    color: inherit; 
    padding: 0 2px; 
    border-radius: 2px;
  }
  .mpdf-doc del, .mpdf-doc s { 
    text-decoration: line-through; 
  }
  .mpdf-doc h1 {
    font-size: round(nearest, calc(22px * var(--headingScale)), 1px);
    font-weight: 700;
    color: var(--headingColor);
    margin: 0 0 round(nearest, calc(12px * var(--headingScale)), 1px);
    line-height: 1.2;
    border-bottom: var(--h1BorderBottom);
    padding-bottom: var(--h1PaddingBottom);
    text-align: var(--h1Align);
  }
  .mpdf-doc h2 {
    font-size: round(nearest, calc(17px * var(--headingScale)), 1px);
    font-weight: 700;
    color: var(--headingColor);
    margin: round(nearest, calc(20px * var(--headingScale)), 1px) 0 round(nearest, calc(10px * var(--headingScale)), 1px);
    border-bottom: var(--h2BorderBottom);
    padding-bottom: var(--h2PaddingBottom);
  }
  .mpdf-doc h3 {
    font-size: round(nearest, calc(15px * var(--headingScale)), 1px);
    font-weight: 700;
    color: var(--headingColor);
    margin: round(nearest, calc(16px * var(--headingScale)), 1px) 0 round(nearest, calc(8px * var(--headingScale)), 1px);
    letter-spacing: 0.01em;
  }
  .mpdf-doc h4 { 
    font-size: round(nearest, calc(13px * var(--headingScale)), 1px); 
    font-weight: 700; 
    color: var(--headingColor); 
    margin: 12px 0 6px; 
    letter-spacing: 0.04em;
    }
  .mpdf-doc h5 {
    font-size: round(nearest, calc(12px * var(--headingScale)), 1px)px;
    font-weight: 600;
    color: var(--headingColor);
    margin: 10px 0 4px;
    font-style: italic; 
  }
  .mpdf-doc h6 { 
    font-size: round(nearest, calc(11px * var(--headingScale)), 1px);
    font-weight: 600; color: var(--bodyColor);
    margin: 8px 0 4px;
    font-style: italic;
    opacity: 0.75;
  }
  .mpdf-doc p { 
    margin: 0 0 var(--paragraphSpacing);
  }
  .mpdf-doc ul, .mpdf-doc ol {
    padding-inline-start: 1.4em;
    margin: 0 0 var(--paragraphSpacing); 
  }
  .mpdf-doc li {
    margin-bottom: 0.2em;
    line-height: var(--lineHeight); 
  }

  .mpdf-doc blockquote {
    border-inline-start: 3px solid var(--blockQuoteBorderColor);
    background: var(--blockQuoteBackground);
    padding-block: 4px;
    padding-inline: 1em 0;
    margin: var(--paragraphSpacing) 0;
    font-style: italic;
    color: var(--bodyColor)cc;
  }
  .mpdf-doc code {
    font-family: var(--codeFontFamily);
    font-variant-ligatures: var(--codeFontLigatures);
    font-size: var(--codeFontSize);
    background: var(--codeBackground);
    padding: 1px 4px;
    border-radius: 3px;
    color: var(--accentColor);
  }
  .mpdf-doc hr {
    border: none;
    border-top: 0.5px solid var(--accentColor)44;
    margin: calc(var(--paragraphSpacing) * 1.5) 0;
  }
  .mpdf-doc img { 
    max-width: 100%; 
    height: auto;
    display: block;
    margin: var(--paragraphSpacing) auto;
    border-radius: var(--imageRadius);
  }
  .mpdf-doc a {
    color: var(--accentColor);
    text-decoration: var(--linkUnderline);
  }
  /* postProcessRenderedHTML removes the external-link class, but some themes
     re-inject it at render time. This rule is cheap defense-in-depth. */
  .mpdf-doc a.external-link::after {
    display: none !important;
    content: none !important;
  }
  /* Hide copy-code buttons that survive postProcessRenderedHTML (e.g. re-injected by themes). */
  .mpdf-doc .copy-code-button {
    display: none !important;
  }
  .mpdf-doc table {
    width: 100%; 
    border-collapse: collapse;
    margin: 0 0 var(--paragraphSpacing); 
    font-size: 0.92em;
  }
  .mpdf-doc th {
    background: var(--tableHeaderBg);
    color: var(--tableHeaderTextColor);
    padding: 6px 10px;
    text-align: start;
    font-weight: 600;
    border: 0.5px solid var(--tableBorderColor)33;
    font-size: 0.9em;
  }
  .mpdf-doc td {
    padding: 5px 10px;
    border: 0.5px solid var(--tableBorderColor)33;
    vertical-align: top;
  }
  /* Markdown column alignment (:--:) arrives as an align attribute on th/td — a
     presentational hint, which the th rule above outranks, so headers lost their
     alignment. start/end mirror the attribute in RTL, as Obsidian's own table CSS
     does, keeping header and body cells on the same edge in either direction. */
  .mpdf-doc th[align="left"], 
  .mpdf-doc td[align="left"] {
    text-align: start;
  }
  .mpdf-doc th[align="center"], 
  .mpdf-doc td[align="center"] {
    text-align: center;
  }
  .mpdf-doc th[align="right"], 
  .mpdf-doc td[align="right"] {
    text-align: end;
  }
  .mpdf-doc tbody tr:nth-child(even) {
    background: var(--tableStriping);
  }

  /* Callouts — override theme styles with !important so preview and export are
   * identical regardless of the active Obsidian theme. */
  .mpdf-doc .callout {
    border-inline-start: 4px solid var(--accentColor) !important;
    border-start-start-radius: 0 !important;
    border-start-end-radius: 5px !important;
    border-end-end-radius: 5px !important;
    border-end-start-radius: 0 !important;
    background: var(--accentColor)12 !important;
    margin: var(--paragraphSpacing) * 1.2} 0 !important;
    padding: 0 !important;
    overflow: hidden !important;
    box-shadow: inset 0 0 0 1px var(--accentColor)22 !important;
    font-style: normal !important;
  }
  .mpdf-doc .callout-title {
    display: flex !important;
    align-items: center !important;
    gap: 7px !important;
    padding: 7px 12px !important;
    background: var(--accentColor)28 !important;
    border-bottom: 1px solid var(--accentColor)33 !important;
    font-family: var(--fontFamily) !important;
    font-size: 0.8em !important;
    font-weight: 800 !important;
    font-style: normal !important;
    letter-spacing: 0.08em !important;
    text-transform: uppercase !important;
    color: var(--accentColor) !important;
    line-height: 1.3 !important;
  }
  .mpdf-doc .callout-icon {
    display: inline-flex !important;
    align-items: center !important;
    flex-shrink: 0 !important;
    width: 15px !important;
    height: 15px !important;
    color: var(--accentColor) !important;
  }
  .mpdf-doc .callout-icon svg {
    width: 15px !important;
    height: 15px !important;
    stroke: var(--accentColor) !important;
    fill: none !important;
    stroke-width: 2 !important;
  }
  .mpdf-doc .callout-title-inner {
    flex: 1 !important;
    min-width: 0 !important;
  }
  .mpdf-doc .callout-fold { display: none !important; }
  .mpdf-doc .callout-content {
    padding: 9px 14px !important;
    color: var(--bodyColor) !important;
    font-style: normal !important;
    background: transparent !important;
  }
  .mpdf-doc .callout-content > p:first-child { margin-top: 0 !important; }
  .mpdf-doc .callout-content > p:last-child  { margin-bottom: 0 !important; }
  /* Nested blockquotes inside callout content keep a subtler indent */
  .mpdf-doc .callout-content blockquote {
    border-inline-start-color: var(--accentColor)66 !important;
    background: transparent !important;
  }

  /* Mermaid diagrams — centre the SVG and prevent it overflowing the content
   * column.  The <style> block inside the SVG is intentionally left untouched;
   * mermaid embeds its own theme CSS there. */
  .mpdf-doc .mermaid {
    display: flex;
    justify-content: center;
    margin: var(--paragraphSpacing) 0;
    overflow: hidden;
  }
  .mpdf-doc .mermaid svg {
    max-width: 100%;
    height: auto;
    display: block;
  }
  `,
};

/** Color pickers in the Colors settings group. Used to reset only those
 *  fields to the active preset's defaults without touching other DocStyle. */
export const PRESET_COLOR_KEYS = [
  "accentColor", "bodyColor", "boldColor", "headingColor",
  "blockquoteBg", "blockquoteBorderColor", "tableHeaderBg", "tableBorderColor", "codeBackground",
] as const satisfies readonly (keyof DocStyle)[];

/** Extracts only the DocStyle fields from the broader settings object.
 *  Used to snapshot the current look before switching presets, so each
 *  preset can remember per-user tweaks independently. */
export function extractDocStyle(s: PDFExportSettings): DocStyle {
  return {
    name: s.name, fontFamily: s.fontFamily, fontSize: s.fontSize,
    lineHeight: s.lineHeight, paragraphSpacing: s.paragraphSpacing,
    headingScale: s.headingScale, accentColor: s.accentColor,
    bodyColor: s.bodyColor, boldColor: s.boldColor, headingColor: s.headingColor,
    h1BorderBottom: s.h1BorderBottom, h2BorderBottom: s.h2BorderBottom,
    centerH1: s.centerH1, blockquoteBg: s.blockquoteBg,
    blockquoteBorderColor: s.blockquoteBorderColor, codeBackground: s.codeBackground,
    codeFontSize: s.codeFontSize, codeFontFamily: s.codeFontFamily, codeTheme: s.codeTheme,
    tableHeaderBg: s.tableHeaderBg, tableBorderColor: s.tableBorderColor,
    tableStriped: s.tableStriped, pageBackground: s.pageBackground,
    marginTop: s.marginTop, marginBottom: s.marginBottom,
    marginLeft: s.marginLeft, marginRight: s.marginRight,
  };
}
