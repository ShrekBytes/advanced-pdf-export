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
};

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
    codeFontSize: s.codeFontSize, codeFontFamily: s.codeFontFamily, codeTheme: s.codeTheme, tableHeaderBg: s.tableHeaderBg,
    tableStriped: s.tableStriped, pageBackground: s.pageBackground,
    marginTop: s.marginTop, marginBottom: s.marginBottom,
    marginLeft: s.marginLeft, marginRight: s.marginRight,
  };
}
