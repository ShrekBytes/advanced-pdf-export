import {
  App, Component, MarkdownRenderer, MarkdownView, Menu, Modal, Notice,
  Plugin, PluginSettingTab, Setting, TFile, requestUrl, setIcon,
  finishRenderMath,
} from "obsidian";
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNull, PDFNumber } from "pdf-lib";

// ─── Constants ────────────────────────────────────────────────────────────────

const PAGE_SIZES: Record<string, { w: number; h: number }> = {
  A4:     { w: 794,  h: 1123 },
  A3:     { w: 1123, h: 1587 },
  Letter: { w: 816,  h: 1056 },
  Legal:  { w: 816,  h: 1344 },
  A5:     { w: 559,  h: 794  },
};

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface DocStyle {
  name: string;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  paragraphSpacing: number;
  headingScale: number;
  accentColor: string;
  bodyColor: string;
  headingColor: string;
  h1BorderBottom: boolean;
  h2BorderBottom: boolean;
  centerH1: boolean;
  blockquoteBg: string;
  blockquoteBorderColor: string;
  codeBackground: string;
  codeFontSize: number;
  codeTheme: string;
  tableHeaderBg: string;
  tableStriped: boolean;
  pageBackground: string;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
}

// Minimal Electron type shims — just enough for the PDF export path.

interface ElectronBrowserWindow {
  loadURL(url: string): void;
  close(): void;
  webContents: {
    once(event: "did-fail-load", listener: (event: unknown, code: number, desc: string) => void): void;
    once(event: "did-finish-load", listener: () => void): void;
    executeJavaScript(code: string): Promise<unknown>;
    printToPDF(options: {
      pageSize: string;
      landscape: boolean;
      printBackground: boolean;
      preferCSSPageSize?: boolean;
      margins: { marginType: string };
    }): Promise<Uint8Array>;
  };
}

interface ElectronRemote {
  dialog: {
    showSaveDialog(options: {
      title: string;
      defaultPath: string;
      filters: { name: string; extensions: string[] }[];
    }): Promise<{ canceled: boolean; filePath?: string }>;
  };
  BrowserWindow: new (options: {
    show: boolean;
    webPreferences: { nodeIntegration: boolean };
  }) => ElectronBrowserWindow;
}

interface ElectronFs {
  writeFile(path: string, data: Uint8Array, cb: (err: Error | null) => void): void;
}

interface ElectronBridge {
  require(module: "@electron/remote"): ElectronRemote;
  require(module: "fs"): ElectronFs;
  require(module: string): unknown;
}

/** One entry in the PDF outline/bookmark tree, extracted from the heading nodes. */
interface OutlineEntry {
  title: string;
  level: number; // 1–6 matching H1–H6
  page:  number; // 1-indexed page number in the exported PDF
}

interface AppWithSettings {
  setting?: {
    open?: () => void;
    openTabById?: (id: string) => void;
  };
}

interface PDFExportSettings extends DocStyle {
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
  /** Template for rendering the page number string. Supports {{page_current}}
   *  and {{page_total}} placeholders, e.g. "Page {{page_current}} of {{page_total}}". */
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
  autoBreakH1: boolean;
  autoBreakH2: boolean;
  includeFilenameAsTitle: boolean;
  previewScale: number;
  /** Width in mm, used only when pageSize === "Custom". */
  customPageWidth: number;
  /** Height in mm, used only when pageSize === "Custom". */
  customPageHeight: number;

  // ── Header/footer band sizing ─────────────────────────────────────────────────
  /** Explicit header band height in px. 0 = auto (derived from headerFontSize). */
  headerHeight: number;
  /** Explicit footer band height in px. 0 = auto (derived from footerFontSize). */
  footerHeight: number;

  // ── Header/footer banner images ──────────────────────────────────────────────
  /** Vault-relative path or https:// URL for a banner image behind the header text. */
  headerImagePath: string;
  /** Left/right gap in px between the banner image and the page edges (0 = edge-to-edge). */
  headerImageMargin: number;
  footerImagePath: string;
  /** Left/right gap in px between the banner image and the page edges. */
  footerImageMargin: number;

  // ── Page background (color OR image — mutually exclusive) ─────────────────────
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

// Cached layout — holds everything drawPreview and exportPDF need so that
// zoom changes can redraw without re-paginating.
interface LayoutCache {
  layouts: PageLayout[];
  pw: number;
  ph: number;
  mTop: number;
  mLeft: number;
  mRight: number;
  footerH: number;
  headerH: number;
  contentW: number;
  contentH: number;
  docCSS: string;
  fontFamily: string;
  accentColor: string;
  pageBackground: string;
  isRTL: boolean;
}

interface PageLayout {
  pageNodes: HTMLElement[];
  pageNum: number;
  totalPages: number;
  pageShowsHeader: boolean;
  pageShowsFooter: boolean;
  hasHeader: boolean;
  hasFooter: boolean;
  headerLeft: string;
  headerCenter: string;
  headerRight: string;
  footerLeft: string;
  footerRight: string;
  footerCenter: string;
}

// ─── Style Presets ────────────────────────────────────────────────────────────

const PRESETS: Record<string, DocStyle> = {
  default: {
    name: "Default",
    fontFamily: "Georgia, serif",
    fontSize: 13,
    lineHeight: 1.85,
    paragraphSpacing: 0.65,
    headingScale: 1.0,
    accentColor: "#7c6af7",
    bodyColor: "#1a1a2e",
    headingColor: "#0d0d1a",
    h1BorderBottom: false,
    h2BorderBottom: true,
    centerH1: false,
    blockquoteBg: "transparent",
    blockquoteBorderColor: "#7c6af7",
    codeBackground: "#f0f0f8",
    codeFontSize: 0.85,
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
    headingColor: "#111",
    h1BorderBottom: false,
    h2BorderBottom: false,
    centerH1: false,
    blockquoteBg: "#f8f8f8",
    blockquoteBorderColor: "#ccc",
    codeBackground: "#f4f4f4",
    codeFontSize: 0.82,
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
    headingColor: "#000",
    h1BorderBottom: true,
    h2BorderBottom: true,
    centerH1: true,
    blockquoteBg: "transparent",
    blockquoteBorderColor: "#999",
    codeBackground: "#f9f9f9",
    codeFontSize: 0.88,
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
    headingColor: "#2d0a4e",
    h1BorderBottom: false,
    h2BorderBottom: false,
    centerH1: false,
    blockquoteBg: "#fdf0f8",
    blockquoteBorderColor: "#e84393",
    codeBackground: "#f0eaff",
    codeFontSize: 0.85,
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
    headingColor: "#000",
    h1BorderBottom: false,
    h2BorderBottom: false,
    centerH1: false,
    blockquoteBg: "#f0f7ff",
    blockquoteBorderColor: "#0070f3",
    codeBackground: "#f1f5f9",
    codeFontSize: 0.85,
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
    headingColor: "#000",
    h1BorderBottom: true,
    h2BorderBottom: true,
    centerH1: true,
    blockquoteBg: "transparent",
    blockquoteBorderColor: "#111",
    codeBackground: "#f4f4f4",
    codeFontSize: 0.82,
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
    headingColor: "#f1f5f9",
    h1BorderBottom: false,
    h2BorderBottom: true,
    centerH1: false,
    blockquoteBg: "#1e293b",
    blockquoteBorderColor: "#818cf8",
    codeBackground: "#0f172a",
    codeFontSize: 0.85,
    codeTheme: "tokyo-night",
    tableHeaderBg: "#1e293b",
    tableStriped: true,
    pageBackground: "#111827",
    marginTop: 20, marginBottom: 20, marginLeft: 25, marginRight: 25,
  },
};

const DEFAULT_SETTINGS: PDFExportSettings = {
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
  pageNumberFormat: "{{page_current}} / {{page_total}}",
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

// ─── Utilities ────────────────────────────────────────────────────────────────

/** mm → px at 96 dpi, matching Electron's print pipeline. */
const mmToPx = (mm: number) => (mm / 25.4) * 96;

/**
 * Returns the page dimensions in px for the current settings.
 * For "Custom", converts the user-entered mm values; for named sizes, looks up
 * PAGE_SIZES directly.  Orientation swapping is handled by callers (doRender).
 */
function resolvePageDims(s: PDFExportSettings): { w: number; h: number } {
  if (s.pageSize === "Custom") {
    return {
      w: Math.max(1, Math.round(mmToPx(s.customPageWidth))),
      h: Math.max(1, Math.round(mmToPx(s.customPageHeight))),
    };
  }
  return PAGE_SIZES[s.pageSize] ?? PAGE_SIZES["A4"];
}

function escapeHTML(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Escapes `</style` in CSS text to prevent the HTML parser from ending the
// <style> block early, regardless of where the sequence appears.
function escapeCSSForStyle(css: string): string {
  return css.replace(/<\/style/gi, "<\\/style");
}

/** Converts a vault-relative path or bare filename to an app:// resource URL,
 *  or passes https:// / data: URLs through unchanged. Returns "" for blank input. */
function resolveImageUrl(app: App, imagePath: string): string {
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
function bgImageCssProps(size: PDFExportSettings["backgroundImageSize"]): { size: string; repeat: string } {
  return {
    size:   size === "fill" ? "100% 100%" : size === "tile" ? "auto" : size, // "cover" | "contain" pass through
    repeat: size === "tile" ? "repeat" : "no-repeat",
  };
}

/** True when RTL script chars (Arabic, Hebrew, etc.) exceed 10 % of all
 *  alpha chars — ratio-based so mixed-script notes lean toward the majority. */
const RTL_CHARS   = /[\u0590-\u08FF\uFB1D-\uFDFD\uFE70-\uFEFC]/g;
const TOTAL_ALPHA = /[A-Za-z\u0590-\u08FF\uFB1D-\uFDFD\uFE70-\uFEFC]/g;
function isRTLContent(text: string): boolean {
  const rtl   = (text.match(RTL_CHARS)   ?? []).length;
  const total = (text.match(TOTAL_ALPHA) ?? []).length;
  return total > 0 && rtl / total > 0.1;
}

// ─── Markdown helpers ─────────────────────────────────────────────────────────

/** Normalises line endings to LF so the rest of the pipeline never sees CRLF or CR. */
function normalizeMarkdown(raw: string): string {
  return raw.replace(/\r\n|\r/g, "\n");
}

/** Strips an opening YAML frontmatter block (--- … ---). Input must be LF-normalised. */
function stripFrontmatter(md: string): string {
  return md.replace(/^---[ \t]*\n[\s\S]*?\n---[ \t]*(\n|$)/, "");
}

/** Splits on `///` manual page-break markers, trimming and dropping empty sections. */
function splitMarkdownSections(md: string): string[] {
  return md
    .split(/^\/\/\/\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Fires MathJax's one-time cold-start boot and `adaptiveCSS` setup for the
 *  font families most often missing on a session's first real render (bold,
 *  AMS symbols, blackboard-bold, fraktur, calligraphic, sans-serif,
 *  typewriter, vector) as soon as the plugin loads, in the background —
 *  rather than paying that cost the first time the user actually renders.
 *
 *  Deliberately goes through the same `renderMarkdownToEl` pipeline used for
 *  real renders instead of calling `renderMath()`/`finishRenderMath()`
 *  directly: Obsidian only creates its global `MathJax` object lazily, the
 *  first time something is typeset through its markdown post-processor
 *  pipeline. Calling `renderMath()` directly before that has happened throws
 *  `ReferenceError: MathJax is not defined` instead of triggering the load.
 *
 *  Fire-and-forget: nothing downstream awaits this, and the real render path
 *  still verifies completion correctly on its own regardless of whether this
 *  has finished. */
async function warmUpMathJax(app: App): Promise<void> {
  const component = new Component();
  component.load();
  try {
    await renderMarkdownToEl(
      app,
      "$\\mathbf{A}+\\mathfrak{A}+\\mathcal{A}+\\mathsf{A}+\\mathtt{A}+\\mathbb{A}+\\aleph+\\vec{v}$",
      "",
      component,
    );
  } catch (err) {
    console.warn("[advanced-pdf-export] MathJax warm-up failed (non-fatal):", err);
  } finally {
    component.unload();
  }
}

async function renderMarkdownToEl(
  app: App,
  markdown: string,
  sourcePath: string,
  component: Component,
): Promise<HTMLElement> {
  const temp = activeDocument.createElement("div");
  // Attached offscreen so Obsidian's async post-processors (mermaid, math) run in a real DOM context.
  temp.setCssStyles({ position: "fixed", top: "0", left: "-99999px", visibility: "hidden", pointerEvents: "none" });
  activeDocument.body.appendChild(temp);
  try {
    await MarkdownRenderer.render(app, markdown, temp, sourcePath, component);
    // Flushes Obsidian's MathJax render queue — MarkdownRenderer.render()'s own
    // promise can resolve before queued math has actually finished typesetting.
    // Bounded with a race: on a cold Obsidian session (MathJax not yet used
    // anywhere in this window), this has been observed to hang far longer than
    // expected instead of resolving, blocking the whole render indefinitely.
    // waitForMathRendering()/waitForMathJaxStylesheetStable() below are the
    // real, already-bounded correctness check regardless of whether this
    // resolves in time — so there's no harm in giving up on it early.
    const FINISH_RENDER_MATH_TIMEOUT_MS = 3000;
    try {
      let timer: number;
      await Promise.race([
        finishRenderMath().finally(() => window.clearTimeout(timer)),
        new Promise<void>((resolve) => { timer = window.setTimeout(resolve, FINISH_RENDER_MATH_TIMEOUT_MS); }),
      ]);
    } catch (err) {
      console.warn("[advanced-pdf-export] finishRenderMath failed:", err);
    }
    await waitForMermaidDiagrams(temp);
    await waitForMathRendering(temp);
    // Wait for MathJax's lazily-loaded @font-face files to arrive before we
    // clone nodes; glyphs in unloaded font ranges render as invisible characters.
    const docFonts = (activeDocument as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
    if (docFonts) {
      try { await docFonts.ready; } catch { /* non-critical */ }
    }
  } finally {
    activeDocument.body.removeChild(temp);
  }
  postProcessRenderedHTML(temp);
  return temp;
}

// Pre-compiled once. String.replace() and String.matchAll() both reset a
// regex's lastIndex to 0 on each call, so module-level g-flagged constants are safe.
const SLUG_STRIP = /[^\p{L}\p{N}\s-]/gu;
const SLUG_SPACE = /\s+/g;
const SLUG_DASH  = /-+/g;

function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(SLUG_STRIP, "")
    .trim()
    .replace(SLUG_SPACE, "-")
    .replace(SLUG_DASH,  "-");
}

// Strips Obsidian-specific artefacts from rendered HTML so the output is
// clean for pagination and export: assigns stable heading IDs for anchor
// links, removes external-link decorators and copy-code buttons, force-expands
// callouts, and strips top-level theme <style>/<script> injections while
// preserving styles embedded inside SVGs (mermaid stores its theme CSS there).
function postProcessRenderedHTML(root: HTMLElement): void {
  // Stable, deduplicated IDs so in-page anchor links work across shadow DOMs.
  const seen = new Map<string, number>();
  root.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((el) => {
    const text = el.textContent || "";
    const base = slugifyHeading(text);
    if (!base) return;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    el.id = count === 0 ? base : `${base}-${count}`;
  });

  // The external-link class triggers a ↗ icon via theme CSS — meaningless in print.
  root.querySelectorAll<HTMLAnchorElement>("a").forEach((a) => {
    a.classList.remove("external-link");

    // Rewrite anchor hrefs to match the slugified IDs assigned above,
    // covering both wikilink data-href and standard markdown anchors.
    const target = a.getAttribute("data-href") ?? a.getAttribute("href");
    if (target?.startsWith("#")) {
      a.setAttribute("href", "#" + slugifyHeading(target.slice(1)));
    }
  });

  root.querySelectorAll(".copy-code-button").forEach((el) => el.remove());

  // Force-expand callouts: remove fold controls and collapsed state.
  root.querySelectorAll<HTMLElement>(".callout").forEach((callout) => {
    callout.removeAttribute("data-callout-fold");
    callout.classList.remove("is-collapsed");
    callout.querySelectorAll(".callout-fold").forEach((el) => el.remove());
  });

  // Drop theme-injected top-level <style>/<script> nodes — they can break the
  // export <head> if they contain `</style>`, and are not needed in the PDF.
  // Styles inside <svg> are kept: mermaid embeds its theme CSS directly there.
  root.querySelectorAll("style, script").forEach((el) => {
    if (!el.closest("svg")) el.remove();
  });
}

/** Waits for mermaid code blocks to be converted to SVGs by Obsidian's post-processor.
 *  Resolves immediately if already rendered; times out per diagram after 5 s. */
async function waitForMermaidDiagrams(el: HTMLElement): Promise<void> {
  const containers = Array.from(el.querySelectorAll<HTMLElement>(".mermaid"));
  if (containers.length === 0) return;
  const TIMEOUT_MS = 5000;
  await Promise.all(
    containers.map(
      (m) =>
        new Promise<void>((resolve) => {
          if (m.querySelector("svg")) { resolve(); return; }
          const timer = window.setTimeout(() => { obs.disconnect(); resolve(); }, TIMEOUT_MS);
          const obs = new MutationObserver(() => {
            if (m.querySelector("svg")) {
              window.clearTimeout(timer);
              obs.disconnect();
              resolve();
            }
          });
          obs.observe(m, { childList: true, subtree: true });
        }),
    ),
  );
}

/** Waits for MathJax to finish typesetting `.math` spans (native math and
 *  Latex Suite equations share the same renderer).
 *
 *  `MathJax.startup.promise` is awaited first as a cheap early gate — it
 *  resolves once, at MathJax's initial boot, so it proves nothing about
 *  whether this particular render pass is finished. The real wait is a
 *  per-element `mjx-container` observer, followed by
 *  `waitForMathJaxStylesheetStable()`: MathJax's CHTML `adaptiveCSS` mode
 *  writes per-glyph rules to a shared stylesheet incrementally as new
 *  characters are encountered, and DOM insertion of `mjx-container` alone
 *  doesn't guarantee that write has landed yet. Bounded at 8s + 2.5s so a
 *  stuck render can't hang the export indefinitely. */
async function waitForMathRendering(el: HTMLElement): Promise<void> {
  const containers = Array.from(el.querySelectorAll<HTMLElement>(".math"));
  if (containers.length === 0) return;

  const mathJax = (window as unknown as {
    MathJax?: { startup?: { promise?: Promise<unknown> } };
  }).MathJax;
  if (mathJax?.startup?.promise) {
    try { await mathJax.startup.promise; } catch { /* fall through to per-element wait */ }
  }

  const TIMEOUT_MS = 8000;
  await Promise.all(
    containers
      .filter((m) => !m.querySelector("mjx-container"))
      .map(
        (m) =>
          new Promise<void>((resolve) => {
            const timer = window.setTimeout(() => { obs.disconnect(); resolve(); }, TIMEOUT_MS);
            const obs = new MutationObserver(() => {
              if (m.querySelector("mjx-container")) {
                window.clearTimeout(timer);
                obs.disconnect();
                resolve();
              }
            });
            obs.observe(m, { childList: true, subtree: true });
          }),
      ),
  );

  await waitForMathJaxStylesheetStable();
}

/** Polls `getMathJaxCSS()`'s output size until it stops changing for two
 *  consecutive checks, confirming MathJax's `adaptiveCSS` has finished writing
 *  per-glyph rules for this render pass — DOM insertion of `mjx-container`
 *  alone doesn't guarantee that. Bounded by MAX_WAIT_MS so an already-settled
 *  stylesheet doesn't stall the export; resolves in ~2 polls in that case. */
async function waitForMathJaxStylesheetStable(): Promise<void> {
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

const CODE_THEMES: Record<string, CodeColorTheme> = {
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
    font-family: 'Courier New', monospace;
    font-size: ${s.codeFontSize}em;
    color: ${text};
    white-space: pre-wrap;
    overflow-wrap: break-word;
    background: none;
    padding: 0;
  }
  ${tokenRules}`;
}

// ─── CSS generator ────────────────────────────────────────────────────────────

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
function resolveFont(s: PDFExportSettings): string {
  return s.fontFamily === "__custom__" ? (s.customFontName.trim() || "inherit") : s.fontFamily;
}

function buildDocCSS(s: PDFExportSettings, isRTL = false): string {
  const hs = s.headingScale;
  const fontFamily = resolveFont(s);
  const tableHeaderTextColor =
    hexLuminance(s.tableHeaderBg) < 0.35 ? "#fff" : s.headingColor;

  return `
  .mpdf-doc {
    font-family: ${fontFamily};
    font-size: ${s.fontSize}px;
    line-height: ${s.lineHeight};
    color: ${s.bodyColor};
    box-sizing: border-box;
    ${isRTL ? "direction: rtl;" : ""}
  }
  .mpdf-doc *, .mpdf-doc *::before, .mpdf-doc *::after { box-sizing: border-box; }
  .mpdf-doc strong, .mpdf-doc b { font-weight: 700; font-style: normal; }
  .mpdf-doc em, .mpdf-doc i { font-style: italic; font-weight: inherit; }
  .mpdf-doc mark { background: #ffe066; color: inherit; padding: 0 2px; border-radius: 2px; }
  .mpdf-doc del, .mpdf-doc s { text-decoration: line-through; }
  .mpdf-doc h1 {
    font-size: ${Math.round(22 * hs)}px;
    font-weight: 700;
    color: ${s.headingColor};
    margin: 0 0 ${Math.round(12 * hs)}px;
    line-height: 1.2;
    ${s.h1BorderBottom ? `border-bottom: 2px solid ${s.accentColor}; padding-bottom: 6px;` : ""}
    ${s.centerH1 ? "text-align: center;" : ""}
  }
  .mpdf-doc h2 {
    font-size: ${Math.round(17 * hs)}px;
    font-weight: 600;
    color: ${s.headingColor};
    margin: ${Math.round(20 * hs)}px 0 ${Math.round(10 * hs)}px;
    ${s.h2BorderBottom ? `border-bottom: 0.5px solid ${s.accentColor}55; padding-bottom: 5px;` : ""}
  }
  .mpdf-doc h3 {
    font-size: ${Math.round(15 * hs)}px;
    font-weight: 700;
    color: ${s.headingColor};
    margin: ${Math.round(16 * hs)}px 0 ${Math.round(8 * hs)}px;
    letter-spacing: 0.01em;
  }
  .mpdf-doc h4 { font-size: ${Math.round(13 * hs)}px; font-weight: 700; color: ${s.headingColor}; margin: 12px 0 6px; text-transform: uppercase; letter-spacing: 0.04em; }
  .mpdf-doc h5 { font-size: ${Math.round(12 * hs)}px; font-weight: 600; color: ${s.headingColor}; margin: 10px 0 4px; font-style: italic; }
  .mpdf-doc h6 { font-size: ${Math.round(11 * hs)}px; font-weight: 600; color: ${s.bodyColor}; margin: 8px 0 4px; font-style: italic; opacity: 0.75; }
  .mpdf-doc p { margin: 0 0 ${s.paragraphSpacing}em; }
  .mpdf-doc ul, .mpdf-doc ol { padding-inline-start: 1.4em; margin: 0 0 ${s.paragraphSpacing}em; }
  .mpdf-doc li { margin-bottom: 0.2em; line-height: ${s.lineHeight}; }
  .mpdf-doc blockquote {
    border-inline-start: 3px solid ${s.blockquoteBorderColor};
    background: ${s.blockquoteBg};
    padding-block: 4px;
    padding-inline: 1em 0;
    margin: ${s.paragraphSpacing}em 0;
    font-style: italic;
    color: ${s.bodyColor}cc;
  }
  .mpdf-doc code {
    font-family: 'Courier New', monospace;
    font-size: ${s.codeFontSize}em;
    background: ${s.codeBackground};
    padding: 1px 4px;
    border-radius: 3px;
    color: ${s.accentColor};
  }
  ${buildCodeBlockCSS(s)}
  .mpdf-doc hr {
    border: none;
    border-top: 0.5px solid ${s.accentColor}44;
    margin: ${s.paragraphSpacing * 1.5}em 0;
  }
  .mpdf-doc img { max-width: 100%; height: auto; display: block; margin: ${s.paragraphSpacing}em auto; }
  .mpdf-doc a { color: ${s.accentColor}; ${s.linkUnderline ? "" : "text-decoration: none;"} }
  /* postProcessRenderedHTML removes the external-link class, but some themes
     re-inject it at render time. This rule is cheap defense-in-depth. */
  .mpdf-doc a.external-link::after { display: none !important; content: none !important; }
  /* Hide copy-code buttons that survive postProcessRenderedHTML (e.g. re-injected by themes). */
  .mpdf-doc .copy-code-button { display: none !important; }
  .mpdf-doc table { width: 100%; border-collapse: collapse; margin: 0 0 ${s.paragraphSpacing}em; font-size: 0.92em; }
  .mpdf-doc th {
    background: ${s.tableHeaderBg};
    color: ${tableHeaderTextColor};
    padding: 6px 10px;
    text-align: start;
    font-weight: 600;
    border: 0.5px solid ${s.accentColor}33;
    font-size: 0.9em;
  }
  .mpdf-doc td { padding: 5px 10px; border: 0.5px solid ${s.bodyColor}22; vertical-align: top; }
  ${s.tableStriped ? `.mpdf-doc tbody tr:nth-child(even) { background: ${s.tableHeaderBg}55; }` : ""}

  /* Callouts — override theme styles with !important so preview and export are
   * identical regardless of the active Obsidian theme. */
  .mpdf-doc .callout {
    border-inline-start: 4px solid ${s.accentColor} !important;
    border-start-start-radius: 0 !important;
    border-start-end-radius: 5px !important;
    border-end-end-radius: 5px !important;
    border-end-start-radius: 0 !important;
    background: ${s.accentColor}12 !important;
    margin: ${s.paragraphSpacing * 1.2}em 0 !important;
    padding: 0 !important;
    overflow: hidden !important;
    box-shadow: inset 0 0 0 1px ${s.accentColor}22 !important;
    font-style: normal !important;
  }
  .mpdf-doc .callout-title {
    display: flex !important;
    align-items: center !important;
    gap: 7px !important;
    padding: 7px 12px !important;
    background: ${s.accentColor}28 !important;
    border-bottom: 1px solid ${s.accentColor}33 !important;
    font-family: ${fontFamily} !important;
    font-size: 0.8em !important;
    font-weight: 800 !important;
    font-style: normal !important;
    letter-spacing: 0.08em !important;
    text-transform: uppercase !important;
    color: ${s.accentColor} !important;
    line-height: 1.3 !important;
  }
  .mpdf-doc .callout-icon {
    display: inline-flex !important;
    align-items: center !important;
    flex-shrink: 0 !important;
    width: 15px !important;
    height: 15px !important;
    color: ${s.accentColor} !important;
  }
  .mpdf-doc .callout-icon svg {
    width: 15px !important;
    height: 15px !important;
    stroke: ${s.accentColor} !important;
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
    color: ${s.bodyColor} !important;
    font-style: normal !important;
    background: transparent !important;
  }
  .mpdf-doc .callout-content > p:first-child { margin-top: 0 !important; }
  .mpdf-doc .callout-content > p:last-child  { margin-bottom: 0 !important; }
  /* Nested blockquotes inside callout content keep a subtler indent */
  .mpdf-doc .callout-content blockquote {
    border-inline-start-color: ${s.accentColor}66 !important;
    background: transparent !important;
  }

  /* Mermaid diagrams — centre the SVG and prevent it overflowing the content
   * column.  The <style> block inside the SVG is intentionally left untouched;
   * mermaid embeds its own theme CSS there. */
  .mpdf-doc .mermaid {
    display: flex;
    justify-content: center;
    margin: ${s.paragraphSpacing}em 0;
    overflow: hidden;
  }
  .mpdf-doc .mermaid svg {
    max-width: 100%;
    height: auto;
    display: block;
  }
  `.trim();
}

/** Extracts only the DocStyle fields from the broader settings object. */
function extractDocStyle(s: PDFExportSettings): DocStyle {
  return {
    name: s.name, fontFamily: s.fontFamily, fontSize: s.fontSize,
    lineHeight: s.lineHeight, paragraphSpacing: s.paragraphSpacing,
    headingScale: s.headingScale, accentColor: s.accentColor,
    bodyColor: s.bodyColor, headingColor: s.headingColor,
    h1BorderBottom: s.h1BorderBottom, h2BorderBottom: s.h2BorderBottom,
    centerH1: s.centerH1, blockquoteBg: s.blockquoteBg,
    blockquoteBorderColor: s.blockquoteBorderColor, codeBackground: s.codeBackground,
    codeFontSize: s.codeFontSize, codeTheme: s.codeTheme, tableHeaderBg: s.tableHeaderBg,
    tableStriped: s.tableStriped, pageBackground: s.pageBackground,
    marginTop: s.marginTop, marginBottom: s.marginBottom,
    marginLeft: s.marginLeft, marginRight: s.marginRight,
  };
}

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
function getMathJaxCSS(): string {
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
function stripAtFontFaces(css: string): string {
  return css.replace(/@font-face\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)?\}/g, "");
}

/** Returns MathJax CSS with all font url() references replaced by base64 data URIs.
 *  The export BrowserWindow (loaded from a blob: URL) cannot resolve app:// font
 *  paths; inlining makes math characters visible. Falls back to the original URL
 *  on fetch error. */
async function getMathJaxCSSInlined(): Promise<string> {
  const css = getMathJaxCSS();
  if (!css) return "";

  const urlSet = new Set<string>();
  for (const [, u] of css.matchAll(CSS_URL_RE)) {
    const trimmedU = u.trim();
    if (!trimmedU.startsWith("data:")) urlSet.add(trimmedU);
  }

  if (!urlSet.size) return css;

  const toDataUri = async (url: string): Promise<string> => {
    try {
      const res = await requestUrl(url);
      if (res.status !== 200) return url;
      const bytes = new Uint8Array(res.arrayBuffer);
      let bin = "";
      for (let i = 0; i < bytes.length; i += 8192) // chunk to avoid stack overflow
        bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, bytes.length)));
      const b64  = btoa(bin);
      const low  = url.toLowerCase();
      const mime = low.includes("woff2") ? "font/woff2"
                 : low.includes("woff")  ? "font/woff"
                 : low.includes(".ttf")  ? "font/ttf"
                 : "font/otf";
      return `data:${mime};base64,${b64}`;
    } catch {
      return url;
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

// Matches url(...) references in CSS — used by getMathJaxCSSInlined to collect
// and replace font URLs with base64 data URIs. String.replace() and matchAll()
// both reset lastIndex to 0 on each call, so this g-flagged constant is safe to share.
const CSS_URL_RE = /url\(\s*["']?([^"')]+)["']?\s*\)/g;

// ─── Paginator ────────────────────────────────────────────────────────────────
// Distributes rendered block children into page-height buckets. Oversized
// elements are split by natural unit: line (PRE), row (TABLE), item (UL/OL),
// word or character (inline text).

const INLINE_SPLIT_TAGS = new Set(["P", "LI", "BLOCKQUOTE", "TD", "TH"]);

const BLOCK_TAGS = new Set([
  "P", "DIV", "SECTION", "ARTICLE", "ASIDE", "NAV", "HEADER", "FOOTER",
  "UL", "OL", "LI", "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TD", "TH",
  "PRE", "BLOCKQUOTE", "HR", "IMG",
  "H1", "H2", "H3", "H4", "H5", "H6",
]);

// PRE is absent — it gets its own line-based splitter.
const UNSPLITTABLE_TAGS = new Set([
  "CODE", "IMG", "HR", "H1", "H2", "H3", "H4", "H5", "H6",
]);

// 2px guards against sub-pixel rendering differences between the light-DOM
// paginator sandbox and the shadow DOM preview context.
const HEIGHT_EPS = 2;

function measureNodesHeight(nodes: HTMLElement[], measureEl: HTMLElement): number {
  measureEl.empty();
  for (const node of nodes) measureEl.appendChild(node.cloneNode(true));
  return measureEl.getBoundingClientRect().height;
}

function makeFitFn(
  currentPage: HTMLElement[],
  measureEl: HTMLElement,
  contentHeightPx: number,
): (node: HTMLElement) => boolean {
  return (node: HTMLElement) =>
    measureNodesHeight([...currentPage, node], measureEl) <= contentHeightPx - HEIGHT_EPS;
}

// ── Inline (text) splitter ───────────────────────────────────────────────────

function trimLeadingWhitespace(el: HTMLElement): void {
  const walker = activeDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const trimmed = (node.textContent ?? "").replace(/^\s+/, "");
    if (trimmed !== node.textContent) node.textContent = trimmed;
    if (trimmed.length > 0) break;
  }
}

function buildInlineSplitAt(
  el: HTMLElement,
  splitOffset: number,
  trimSecond = true,
): [HTMLElement, HTMLElement] | null {
  const walker = activeDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let count = 0;
  let target: Text | null = null;
  let localOffset = 0;

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const len = node.textContent?.length ?? 0;
    if (count + len >= splitOffset) {
      target = node;
      localOffset = splitOffset - count;
      break;
    }
    count += len;
  }

  if (!target) return null;

  const range1 = activeDocument.createRange();
  range1.selectNodeContents(el);
  range1.setEnd(target, localOffset);

  const range2 = activeDocument.createRange();
  range2.selectNodeContents(el);
  range2.setStart(target, localOffset);

  const first = el.cloneNode(false) as HTMLElement;
  first.appendChild(range1.cloneContents());

  const second = el.cloneNode(false) as HTMLElement;
  second.appendChild(range2.cloneContents());
  if (trimSecond) trimLeadingWhitespace(second);

  return [first, second];
}

function getWordBoundaryOffsets(text: string): number[] {
  const offsets: number[] = [];
  const re = /\s+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (match.index > 0 && match.index < text.length) offsets.push(match.index);
  }
  return offsets;
}

function splitInlineElement(
  el: HTMLElement,
  fits: (node: HTMLElement) => boolean,
  forceSplit: boolean,
): [HTMLElement, HTMLElement] | null {
  const text = el.textContent ?? "";
  if (text.length < 2) return null;

  // First attempt: binary-search for the latest word boundary that fits.
  const offsets = getWordBoundaryOffsets(text);
  if (offsets.length > 0) {
    let lo = 0, hi = offsets.length - 1, bestIdx = -1;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const split = buildInlineSplitAt(el, offsets[mid]);
      if (!split) { hi = mid - 1; continue; }
      if (fits(split[0])) { bestIdx = mid; lo = mid + 1; }
      else                { hi = mid - 1; }
    }
    if (bestIdx >= 0) return buildInlineSplitAt(el, offsets[bestIdx]);
    if (!forceSplit) return null;
  }

  // Fallback: character-level binary search (oversized single word, or forced).
  let lo = 1, hi = text.length - 1, best = 0;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const split = buildInlineSplitAt(el, mid);
    if (!split) { hi = mid - 1; continue; }
    if (fits(split[0])) { best = mid; lo = mid + 1; }
    else                { hi = mid - 1; }
  }
  return best > 0 ? buildInlineSplitAt(el, best) : null;
}

// ── List splitter ────────────────────────────────────────────────────────────

function buildListWithItems(listEl: HTMLElement, items: HTMLElement[], startAt?: number): HTMLElement {
  const clone = listEl.cloneNode(false) as HTMLElement;
  // Preserve OL numbering across page breaks.
  if (listEl.tagName === "OL" && startAt !== undefined && startAt > 1) {
    (clone as HTMLOListElement).start = startAt;
  }
  for (const item of items) clone.appendChild(item.cloneNode(true));
  return clone;
}

function splitListElement(
  listEl: HTMLElement,
  fits: (node: HTMLElement) => boolean,
  forceSplit: boolean,
): [HTMLElement, HTMLElement] | null {
  const items = Array.from(listEl.children).filter(
    (c) => (c as HTMLElement).tagName === "LI",
  ) as HTMLElement[];
  if (items.length === 0) return null;

  // Respect an existing start attribute on continuation fragments.
  const existingStart = listEl.tagName === "OL"
    ? ((listEl as HTMLOListElement).start ?? 1)
    : 1;

  let fitCount = 0;
  for (let i = 0; i < items.length; i++) {
    if (fits(buildListWithItems(listEl, items.slice(0, i + 1), existingStart))) fitCount = i + 1;
    else break;
  }

  // When forced (alone on empty page), guarantee at least 1 item moves forward.
  if (fitCount <= 0) {
    if (!forceSplit || items.length < 2) return null;
    fitCount = 1;
  }
  if (fitCount >= items.length) return null;

  return [
    buildListWithItems(listEl, items.slice(0, fitCount), existingStart),
    // Second fragment starts at existingStart + fitCount so numbering is continuous.
    buildListWithItems(listEl, items.slice(fitCount), existingStart + fitCount),
  ];
}

// ── Table splitter ───────────────────────────────────────────────────────────

function buildTableWithRows(tableEl: HTMLTableElement, rows: HTMLTableRowElement[]): HTMLTableElement {
  const clone = tableEl.cloneNode(false) as HTMLTableElement;
  const caption = tableEl.querySelector("caption");
  if (caption) clone.appendChild(caption.cloneNode(true));
  const colgroup = tableEl.querySelector("colgroup");
  if (colgroup) clone.appendChild(colgroup.cloneNode(true));
  if (tableEl.tHead) clone.appendChild(tableEl.tHead.cloneNode(true));
  const tbody = activeDocument.createElement("tbody");
  for (const row of rows) tbody.appendChild(row.cloneNode(true));
  clone.appendChild(tbody);
  return clone;
}

function splitTableElement(
  tableEl: HTMLTableElement,
  fits: (node: HTMLElement) => boolean,
  forceSplit: boolean,
): [HTMLElement, HTMLElement] | null {
  const body = tableEl.tBodies[0];
  const rows = body
    ? Array.from(body.rows)
    : Array.from(tableEl.rows).filter((r) => r.parentElement?.tagName !== "THEAD");
  if (rows.length === 0) return null;

  let fitCount = 0;
  for (let i = 0; i < rows.length; i++) {
    if (fits(buildTableWithRows(tableEl, rows.slice(0, i + 1)))) fitCount = i + 1;
    else break;
  }

  // When forced (alone on empty page), guarantee at least 1 row moves forward.
  if (fitCount <= 0) {
    if (!forceSplit || rows.length < 2) return null;
    fitCount = 1;
  }
  if (fitCount >= rows.length) return null;

  return [
    buildTableWithRows(tableEl, rows.slice(0, fitCount)),
    buildTableWithRows(tableEl, rows.slice(fitCount)),
  ];
}

// ── PRE splitter ─────────────────────────────────────────────────────────────
// Splits a code block by line. When a <code> child is present (true for all
// fenced code blocks), buildInlineSplitAt's Range-based split preserves the
// nested Prism `.token.*` span structure across the break.

/** Character offsets (within the element's full text content) marking the
 *  start of the line *after* each line — i.e. valid split points. */
function getLineEndOffsets(lines: string[]): number[] {
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offset += line.length + 1; // +1 for the newline separating this line from the next
    offsets.push(offset);
  }
  return offsets;
}

function splitPreElement(
  preEl: HTMLElement,
  fits: (node: HTMLElement) => boolean,
  forceSplit: boolean,
): [HTMLElement, HTMLElement] | null {
  const codeEl = preEl.querySelector("code");
  const lines = (codeEl ?? preEl).textContent?.split("\n") ?? [];
  // Drop the trailing empty string that String.split() produces.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  if (lines.length < 2) return null;

  const lineEndOffsets = getLineEndOffsets(lines);

  // Splits at the boundary after the first `n` lines, preserving syntax
  // highlighting via Range.cloneContents() when a <code> child is present.
  const buildSplit = (n: number): [HTMLElement, HTMLElement] | null => {
    if (!codeEl) {
      const clone = (text: string) => {
        const el = preEl.cloneNode(false) as HTMLElement;
        el.textContent = text;
        return el;
      };
      return [clone(lines.slice(0, n).join("\n")), clone(lines.slice(n).join("\n"))];
    }
    const split = buildInlineSplitAt(codeEl, lineEndOffsets[n - 1], false);
    if (!split) return null;
    const first = preEl.cloneNode(false) as HTMLElement;
    first.appendChild(split[0]);
    const second = preEl.cloneNode(false) as HTMLElement;
    second.appendChild(split[1]);
    return [first, second];
  };

  let best: [HTMLElement, HTMLElement] | null = null;
  let fitCount = 0;
  for (let i = 1; i <= lines.length; i++) {
    const candidate = buildSplit(i);
    if (!candidate || !fits(candidate[0])) break;
    best = candidate;
    fitCount = i;
  }

  if (fitCount <= 0) {
    if (!forceSplit) return null;
    best = buildSplit(1);
    fitCount = 1;
  }
  if (fitCount >= lines.length || !best) return null;

  return best;
}

// ── Element splitter dispatcher ──────────────────────────────────────────────

function isInlineSplitCandidate(el: HTMLElement): boolean {
  if (!INLINE_SPLIT_TAGS.has(el.tagName)) return false;
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((child as HTMLElement).tagName))
      return false;
  }
  return true;
}

function splitElement(
  el: HTMLElement,
  fits: (node: HTMLElement) => boolean,
  forceSplit: boolean,
): [HTMLElement, HTMLElement] | null {
  if (UNSPLITTABLE_TAGS.has(el.tagName)) return null;
  if (el.tagName === "PRE")   return splitPreElement(el, fits, forceSplit);
  if (el.tagName === "TABLE") return splitTableElement(el as HTMLTableElement, fits, forceSplit);
  if (el.tagName === "UL" || el.tagName === "OL") return splitListElement(el, fits, forceSplit);
  if (isInlineSplitCandidate(el)) return splitInlineElement(el, fits, forceSplit);
  return null;
}

// ── Main pagination loop ─────────────────────────────────────────────────────

function paginateEl(
  sourceEl: HTMLElement,
  contentWidthPx: number,
  contentHeightPx: number,
  docCSS: string,
): HTMLElement[][] {
  // Hidden shadow-root sandbox: scoped CSS prevents host-document pollution.
  const sandboxHost = activeDocument.createElement("div");
  sandboxHost.setCssStyles({
    position: "fixed", top: "0", left: "-99999px",
    width: `${contentWidthPx}px`,
    visibility: "hidden", pointerEvents: "none", zIndex: "-1",
  });

  const sandboxShadow = sandboxHost.attachShadow({ mode: "open" });

  const sandboxSheet = new CSSStyleSheet();
  sandboxSheet.replaceSync(docCSS);
  sandboxShadow.adoptedStyleSheets = [sandboxSheet];

  const inner = activeDocument.createElement("div");
  inner.className = "mpdf-doc";
  for (const child of Array.from(sourceEl.children)) {
    inner.appendChild(child.cloneNode(true));
  }
  sandboxShadow.appendChild(inner);

  // Measurement div: same width, always empty before each measurement.
  const measure = activeDocument.createElement("div");
  measure.className = "mpdf-doc";
  measure.setCssStyles({ position: "absolute", top: "0", left: "0", width: `${contentWidthPx}px`, visibility: "hidden" });
  sandboxShadow.appendChild(measure);

  activeDocument.body.appendChild(sandboxHost);

  const pages: HTMLElement[][] = [];
  try {
    let currentPage: HTMLElement[] = [];
    const children = Array.from(inner.children) as HTMLElement[];
    let idx = 0;

    while (idx < children.length) {
      const child = children[idx];
      const fits = makeFitFn(currentPage, measure, contentHeightPx);

      if (fits(child)) {
        currentPage.push(child.cloneNode(true) as HTMLElement);
        idx++;
        continue;
      }

      // Element doesn't fit. Try to split it across the page boundary.
      const forceSplit = currentPage.length === 0;
      const split = splitElement(child, fits, forceSplit);
      if (split) {
        currentPage.push(split[0]);
        pages.push(currentPage);
        currentPage = [];
        // Replace current child with the remainder for re-processing.
        const remainder = split[1];
        if (remainder.textContent?.trim() || remainder.children.length > 0) {
          children[idx] = remainder;
        } else {
          idx++;
        }
        continue;
      }

      // Can't split. If there's content on this page, flush it and retry the
      // same element on a fresh full-height page.
      if (currentPage.length > 0) {
        pages.push(currentPage);
        currentPage = [];
        continue;
      }

      // Element is alone on an empty page and truly unsplittable (e.g. a giant
      // image). Force it onto its own page and advance so we never stall.
      currentPage.push(child.cloneNode(true) as HTMLElement);
      pages.push(currentPage);
      currentPage = [];
      idx++;
    }

    if (currentPage.length > 0) pages.push(currentPage);
  } finally {
    activeDocument.body.removeChild(sandboxHost);
  }
  return pages.length > 0 ? pages : [[]];
}

// ─── Page layout builder ──────────────────────────────────────────────────────

/** Resolves a page-number format template by substituting the {{page_current}}
 *  and {{page_total}} placeholders with the given values. Falls back to the
 *  default "current / total" template when the format is empty. */
function resolvePageNumberFormat(format: string, current: number, total: number): string {
  const template = format && format.trim() ? format : "{{page_current}} / {{page_total}}";
  return template
    .replace(/\{\{\s*page_current\s*\}\}/g, String(current))
    .replace(/\{\{\s*page_total\s*\}\}/g, String(total));
}

/** Converts paginated page-node arrays into fully-resolved PageLayout objects,
 *  computing header/footer text and page number strings for each page. */
function buildPageLayouts(allPages: HTMLElement[][], s: PDFExportSettings): PageLayout[] {
  const totalPages = allPages.length;
  return allPages.map((pageNodes, i) => {
    const pageNum = i + 1;
    const pageShowsHeader = s.showHeaderOnFirstPage || i > 0;
    const pageShowsFooter = s.showFooterOnFirstPage || i > 0;

    // Page-number offset: when footer is hidden on page 1 the numbering shifts by 1.
    const displayNum   = s.showFooterOnFirstPage ? s.pageNumberStart + i       : s.pageNumberStart + (i - 1);
    const displayTotal = s.showFooterOnFirstPage ? s.pageNumberStart + totalPages - 1 : s.pageNumberStart + totalPages - 2;
    const numStr = resolvePageNumberFormat(s.pageNumberFormat, displayNum, displayTotal);

    let footerLeft = "", footerRight = "", footerCenter = "";
    let headerLeft = "", headerCenter = "", headerRight = "";

    if (pageShowsFooter) {
      if (s.footerText) {
        if      (s.footerTextAlignment === "center") footerCenter = s.footerText;
        else if (s.footerTextAlignment === "left")   footerLeft   = s.footerText;
        else                                          footerRight  = s.footerText;
      }
      // Place page number in its own zone; merge with a separator when both land in the same slot.
      if (s.showPageNumbers) {
        const join = (existing: string) => existing ? existing + " — " + numStr : numStr;
        if      (s.pageNumberPosition === "center") footerCenter = join(footerCenter);
        else if (s.pageNumberPosition === "left")   footerLeft   = join(footerLeft);
        else                                         footerRight  = join(footerRight);
      }
    }

    if (pageShowsHeader) {
      if (s.headerText) {
        if (s.headerAlignment === "center") {
          headerCenter = s.headerText;
        } else if (s.headerAlignment === "left") {
          headerLeft = s.headerText;
        } else {
          headerRight = s.headerText;
        }
      }
    }

    // Compute once here so both preview and export paths can read directly from
    // the layout object instead of re-deriving the same boolean expressions.
    const hasHeader = s.showHeader && pageShowsHeader && !!(headerLeft || headerCenter || headerRight || s.showHeaderBorder);
    const hasFooter = s.showFooter && pageShowsFooter && !!(footerLeft || footerRight || footerCenter || s.showFooterBorder);

    return { pageNodes, pageNum, totalPages, pageShowsHeader, pageShowsFooter, hasHeader, hasFooter, headerLeft, headerCenter, headerRight, footerLeft, footerRight, footerCenter };
  });
}

// ─── PDF outline (bookmarks) ──────────────────────────────────────────────────
// Electron's printToPDF does not generate bookmarks — we post-process the raw
// PDF bytes with pdf-lib to inject a hierarchical outline derived from the
// heading elements already present in the paginated layout.

/**
 * Walks every page's node list and collects heading elements in document order.
 * Headings can sit at the top level of pageNodes (the common case) or be nested
 * inside a container fragment produced by the page-splitter.
 */
function extractOutlineEntries(layouts: PageLayout[]): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  for (const layout of layouts) {
    for (const node of layout.pageNodes) {
      const topLevel: HTMLElement[] = /^H[1-6]$/.test(node.tagName) ? [node] : [];
      const nested = Array.from(node.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6"));
      for (const el of [...topLevel, ...nested]) {
        const level = parseInt(el.tagName[1], 10);
        const title = (el.textContent ?? "").trim();
        if (title) entries.push({ title, level, page: layout.pageNum });
      }
    }
  }
  return entries;
}

/**
 * Post-processes a PDF buffer produced by `printToPDF` and injects a
 * hierarchical bookmark outline built from the supplied entries.
 *
 * Heading nesting (H1 → H2 → H3 …) is preserved. Each item links to its page
 * via an XYZ destination that inherits the reader's current zoom. Sub-trees are
 * collapsed by default (negative /Count per PDF spec). PageMode is set to
 * UseOutlines so readers open the bookmarks panel on load.
 */
async function injectPDFOutline(pdfBuffer: Uint8Array, entries: OutlineEntry[]): Promise<Uint8Array> {
  if (!entries.length) return pdfBuffer;

  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const pages  = pdfDoc.getPages();
  const ctx    = pdfDoc.context;
  const n      = entries.length;

  // ── Compute tree relationships ───────────────────────────────────────────
  // parentIdx[i] = index of the nearest ancestor entry with a lower heading
  // level, or -1 when the entry sits at the root of the outline.
  const parentIdx  = new Array<number>(n).fill(-1);
  for (let i = 1; i < n; i++) {
    for (let j = i - 1; j >= 0; j--) {
      if (entries[j].level < entries[i].level) { parentIdx[i] = j; break; }
    }
  }

  // Sibling linkage (prev / next among entries that share the same parent).
  const prevSib    = new Array<number>(n).fill(-1);
  const nextSib    = new Array<number>(n).fill(-1);
  for (let i = 0; i < n; i++) {
    for (let j = i - 1; j >= 0; j--) {
      if (parentIdx[j] === parentIdx[i]) { prevSib[i] = j; break; }
    }
    for (let j = i + 1; j < n; j++) {
      if (parentIdx[j] === parentIdx[i]) { nextSib[i] = j; break; }
    }
  }

  // First / last direct child of each entry, and direct child count.
  // directChildCount is computed here in O(n) so the item-building loop
  // below doesn't need an inner scan (which would be O(n²) overall).
  const firstChild       = new Array<number>(n).fill(-1);
  const lastChild        = new Array<number>(n).fill(-1);
  const directChildCount = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const p = parentIdx[i];
    if (p >= 0) {
      if (firstChild[p] < 0) firstChild[p] = i;
      lastChild[p] = i;
      directChildCount[p]++;
    }
  }

  // ── Allocate PDF indirect references ─────────────────────────────────────
  const outlineRef = ctx.nextRef();
  const itemRefs   = entries.map(() => ctx.nextRef());

  // ── Build each outline item object ───────────────────────────────────────
  for (let i = 0; i < n; i++) {
    const pageIdx = Math.min(entries[i].page - 1, pages.length - 1);

    // XYZ destination: navigate to this page, null left/top inherits scroll, 0 zoom inherits zoom.
    const dest = PDFArray.withContext(ctx);
    dest.push(pages[pageIdx].ref);
    dest.push(PDFName.of("XYZ"));
    dest.push(PDFNull);
    dest.push(PDFNull);
    dest.push(PDFNumber.of(0));

    const itemDict = PDFDict.withContext(ctx);
    itemDict.set(PDFName.of("Title"),  PDFHexString.fromText(entries[i].title)); // UTF-16 → full Unicode
    itemDict.set(PDFName.of("Parent"), parentIdx[i] >= 0 ? itemRefs[parentIdx[i]] : outlineRef);
    itemDict.set(PDFName.of("Dest"),   dest);
    if (prevSib[i]    >= 0) itemDict.set(PDFName.of("Prev"),  itemRefs[prevSib[i]]);
    if (nextSib[i]    >= 0) itemDict.set(PDFName.of("Next"),  itemRefs[nextSib[i]]);
    if (firstChild[i] >= 0) {
      itemDict.set(PDFName.of("First"), itemRefs[firstChild[i]]);
      itemDict.set(PDFName.of("Last"),  itemRefs[lastChild[i]]);
      // Negative /Count = subtree is collapsed by default in the PDF reader.
      itemDict.set(PDFName.of("Count"), PDFNumber.of(-directChildCount[i]));
    }
    ctx.assign(itemRefs[i], itemDict);
  }

  // ── Build the outline root dictionary ────────────────────────────────────
  let rootFirst = -1, rootLast = -1, rootCount = 0;
  for (let i = 0; i < n; i++) {
    if (parentIdx[i] < 0) {
      if (rootFirst < 0) rootFirst = i;
      rootLast = i;
      rootCount++;
    }
  }
  // Safety: if every entry has a parent (e.g. the document starts with H2 and
  // never has an H1), there are no root-level items. Injecting an empty or
  // half-wired outline dict would produce a malformed PDF — bail out instead.
  if (rootFirst < 0) return pdfBuffer;

  const rootDict = PDFDict.withContext(ctx);
  rootDict.set(PDFName.of("Type"),  PDFName.of("Outlines"));
  rootDict.set(PDFName.of("First"), itemRefs[rootFirst]);
  rootDict.set(PDFName.of("Last"),  itemRefs[rootLast]);
  rootDict.set(PDFName.of("Count"), PDFNumber.of(rootCount));
  ctx.assign(outlineRef, rootDict);

  // ── Wire into the document catalog ───────────────────────────────────────
  pdfDoc.catalog.set(PDFName.of("Outlines"), outlineRef);
  pdfDoc.catalog.set(PDFName.of("PageMode"), PDFName.of("UseOutlines"));

  return await pdfDoc.save();
}

// ─── Header / footer / frame rendering helpers ───────────────────────────────

/** Shorthand `border` value for the page frame, shared by the preview and export paths. */
function frameBorderCSS(s: PDFExportSettings): string {
  return `${s.frameThickness}px ${s.frameStyle} ${s.frameColor}`;
}

/** Builds the page-edge frame element for the live preview shadow DOM.
 *  Inset from the page boundary by frameMargin (equal on all sides) so it
 *  sits outside the margin-bound header, footer, and content — the
 *  outermost decoration on the page. Returns null when the frame is disabled. */
function buildFrameOverlayEl(s: PDFExportSettings): HTMLElement | null {
  if (!s.frameEnabled) return null;
  const inset = `${s.frameMargin}px`;
  const frame = activeDocument.createElement("div");
  frame.setCssStyles({
    position: "absolute", top: inset, left: inset, right: inset, bottom: inset,
    pointerEvents: "none", boxSizing: "border-box",
    border: frameBorderCSS(s),
  });
  return frame;
}

/** Returns the page-edge frame markup for the export HTML. Empty string when disabled. */
function buildFrameOverlayHTML(s: PDFExportSettings): string {
  if (!s.frameEnabled) return "";
  const inset = `${s.frameMargin}px`;
  return `<div style="position:absolute;top:${inset};left:${inset};right:${inset};bottom:${inset};pointer-events:none;box-sizing:border-box;border:${frameBorderCSS(s)};"></div>`;
}

/** Appends center-or-left/right span nodes into a header/footer container element. */
function appendHFNodes(container: HTMLElement, center: string, left: string, right: string): void {
  if (!center && !left && !right) return;
  if (center) {
    const span = activeDocument.createElement("span");
    span.className = "mpdf-hf-center";
    span.textContent = center;
    container.appendChild(span);
  } else {
    const leftSpan = activeDocument.createElement("span");
    leftSpan.textContent = left;
    container.appendChild(leftSpan);
    const rightSpan = activeDocument.createElement("span");
    rightSpan.className = "mpdf-hf-right";
    rightSpan.textContent = right;
    container.appendChild(rightSpan);
  }
}

/** Returns the inner HTML string for a header/footer bar (used in export HTML). */
function buildHFInnerHTML(center: string, left: string, right: string): string {
  if (!center && !left && !right) return "";
  return center
    ? `<span style="flex:1;text-align:center;">${escapeHTML(center)}</span>`
    : `<span>${escapeHTML(left)}</span><span style="margin-left:auto;">${escapeHTML(right)}</span>`;
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export default class MarkdownPDFPlugin extends Plugin {
  declare settings: PDFExportSettings;
  activeModal: PDFExportModal | null = null;
  presetSnapshots: Record<string, DocStyle> = {};

  async onload() {
    await this.loadSettings();
    // Fire-and-forget: pay MathJax's one-time cold-start cost now, in the
    // background, so it's already done by the time the user opens the export
    // modal instead of adding several seconds to their first real render.
    void warmUpMathJax(this.app);
    this.addCommand({
      id: "open-panel",
      name: "Open Panel",
      callback: () => this.openModal(),
    });
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        menu.addItem((item) =>
          item.setTitle("Advanced PDF Export: Open Panel").setIcon("file-output")
              .onClick(() => this.openModal(file)),
        );
      }),
    );
    this.addSettingTab(new PDFExportSettingTab(this.app, this));
  }

  onunload() {
    this.activeModal?.close();
  }

  openModal(file?: TFile) {
    if (this.activeModal) this.activeModal.close();
    new PDFExportModal(this.app, this, file).open();
  }

  async loadSettings() {
    const data = (await this.loadData() ?? {}) as Partial<PDFExportSettings> & { presetSnapshots?: Record<string, DocStyle> };
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);

    // Migration: codeTheme was added per-preset; absent value adopts the active preset's default.
    if (data.codeTheme === undefined) {
      this.settings.codeTheme = PRESETS[this.settings.preset]?.codeTheme ?? DEFAULT_SETTINGS.codeTheme;
    }

    this.presetSnapshots = data.presetSnapshots ?? {};
    this.validateSettings();
  }

  /** Clamps critical numeric settings to safe ranges and repairs invalid
   *  enum values. Called after load so corrupt or manually-edited JSON
   *  cannot produce invisible text, zero-size pages, or bad layout. */
  private validateSettings(): void {
    const s = this.settings;

    // Unknown preset key → fall back to default.
    if (!(s.preset in PRESETS)) {
      console.warn(`[advanced-pdf-export] Unknown preset "${s.preset}", resetting to "default".`);
      s.preset = "default";
    }

    // Font sizes must be positive to produce visible text.
    s.fontSize         = Math.max(1,  s.fontSize);
    s.headerFontSize   = Math.max(1,  s.headerFontSize);
    s.footerFontSize   = Math.max(1,  s.footerFontSize);

    // Margins must be non-negative; zero is allowed (full-bleed layouts).
    s.marginTop        = Math.max(0,  s.marginTop);
    s.marginBottom     = Math.max(0,  s.marginBottom);
    s.marginLeft       = Math.max(0,  s.marginLeft);
    s.marginRight      = Math.max(0,  s.marginRight);

    // Custom page dimensions need a printable minimum.
    s.customPageWidth  = Math.max(10, s.customPageWidth);
    s.customPageHeight = Math.max(10, s.customPageHeight);

    // Preview scale must be a usable positive fraction.
    s.previewScale     = Math.max(0.1, Math.min(3, s.previewScale));

    // Page-number start must be at least 1.
    s.pageNumberStart  = Math.max(1,  s.pageNumberStart);

    // Page-number format: fall back to default when cleared.
    if (!s.pageNumberFormat || !s.pageNumberFormat.trim()) {
      s.pageNumberFormat = DEFAULT_SETTINGS.pageNumberFormat;
    }
  }

  async saveSettings() {
    await this.saveData({ ...this.settings, presetSnapshots: this.presetSnapshots });
  }

  async saveSettingsAndRender() {
    await this.saveSettings();
    this.activeModal?.render();
  }

  applyPreset(key: string, reset = false) {
    const p = PRESETS[key];
    if (!p) return;
    if (reset) {
      delete this.presetSnapshots[key];
    } else {
      this.presetSnapshots[this.settings.preset] = extractDocStyle(this.settings);
    }
    this.settings.preset = key;
    Object.assign(this.settings, p, reset ? {} : (this.presetSnapshots[key] ?? {}));
  }
}

// ─── File resolver ────────────────────────────────────────────────────────────

// Two-level cascade: explicit file → active file (if markdown) → most recent MarkdownView leaf.
function resolveActiveMarkdownFile(app: App, initialFile?: TFile | null): TFile | null {
  if (initialFile) return initialFile;

  // getActiveFile() returns the focused file regardless of view type;
  // the extension check is enough to confirm it is a markdown file.
  const activeFile = app.workspace.getActiveFile();
  if (activeFile?.extension === "md") return activeFile;

  // Fall back to the most recently used leaf that holds a MarkdownView,
  // covering cases where focus is on a non-file pane (search, settings, etc.).
  const leaf = app.workspace.getMostRecentLeaf();
  if (leaf?.view instanceof MarkdownView) return leaf.view.file ?? null;

  return null;
}

// ─── Modal ────────────────────────────────────────────────────────────────────

class PDFExportModal extends Modal {
  plugin: MarkdownPDFPlugin;
  // These, like renderBtn/exportBtn/loadingOverlayEl below, are assigned
  // unconditionally in buildUI() (called first thing in onOpen()) — never
  // read before then, so a definite-assignment assertion is accurate here.
  private editorEl!: HTMLTextAreaElement;
  private previewEl!: HTMLElement;
  private pageCountEl!: HTMLElement;
  private noteTitleEl!: HTMLElement;
  private renderBtn!: HTMLButtonElement;
  private exportBtn!: HTMLButtonElement;
  private loadingOverlayEl!: HTMLElement;

  // Owned Component for MarkdownRenderer — loaded on open, unloaded on close.
  private renderComponent = new Component();

  private readonly initialFile: TFile | null;
  private currentFile: TFile | null = null;
  private renderToken = 0;
  private layoutCache: LayoutCache | null = null;
  // Debounce handle for settings-driven re-renders; cleared on close.
  private renderDebounceTimer: number | null = null;

  constructor(app: App, plugin: MarkdownPDFPlugin, file?: TFile) {
    super(app);
    this.plugin = plugin;
    this.initialFile = file ?? null;
  }

  async onOpen() {
    this.plugin.activeModal = this;
    this.renderComponent.load();
    this.modalEl.addClass("mpdf-modal");
    this.buildUI(this.contentEl);

    const file = resolveActiveMarkdownFile(this.app, this.initialFile);

    if (file) {
      let content: string;
      try {
        content = await this.app.vault.read(file);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        new Notice(`Failed to read file "${file.basename}": ${msg}`);
        return;
      }

      // Guard: user may have closed the modal while vault.read was in flight.
      if (!this.plugin.activeModal) return;

      this.currentFile = file;
      this.editorEl.value = content;
      this.noteTitleEl.textContent = file.basename;
      this.noteTitleEl.title = file.path;
      this.render(true);
    }
  }

  onClose() {
    if (this.renderDebounceTimer !== null) {
      window.clearTimeout(this.renderDebounceTimer);
      this.renderDebounceTimer = null;
    }
    this.renderComponent.unload();
    this.plugin.activeModal = null;
    this.currentFile        = null;
    this.layoutCache        = null;
  }

  // ── UI ──────────────────────────────────────────────────────────────────────

  private buildUI(container: HTMLElement) {
    const s = this.plugin.settings;
    this.buildTopbar(container.createEl("div", { cls: "mpdf-topbar" }), s);

    const main = container.createEl("div", { cls: "mpdf-main" });

    const editorPanel = main.createEl("div", { cls: "mpdf-editor-panel" });

    this.editorEl = editorPanel.createEl("textarea", { cls: "mpdf-editor" });
    this.editorEl.placeholder =
      "Type or paste markdown here to preview and export as PDF.\n\n" +
      "Tip: open this panel from a note's right-click menu, command palette,\n" +
      "or keyboard shortcut to auto-load the active note.\n\n" +
      "Use /// on its own line for a manual page break.\n" +
      "Use --- for a horizontal rule.\n\n" +
      "Mermaid diagrams are supported:\n```mermaid\nflowchart LR\n  A --> B --> C\n```\n\n" +
      "Markdown tables:\n| Col A | Col B |\n|-------|-------|\n| Cell  | Cell  |";

    // Preview container keeps the loading overlay fixed (non-scrolling) over the panel.
    const previewContainer = main.createEl("div", { cls: "mpdf-preview-container" });
    this.previewEl = previewContainer.createEl("div", { cls: "mpdf-preview" });

    this.loadingOverlayEl = previewContainer.createEl("div", { cls: "mpdf-loading-overlay" });
    this.loadingOverlayEl.createEl("div", { cls: "mpdf-spinner" });
    this.loadingOverlayEl.createEl("span", { cls: "mpdf-loading-text", text: "Rendering…" });

    this.editorEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.render(true);
      }
    });
  }

  private buildTopbar(topbar: HTMLElement, s: PDFExportSettings) {
    const left  = topbar.createEl("div", { cls: "mpdf-topbar-left" });
    const right = topbar.createEl("div", { cls: "mpdf-topbar-right" });

    const makeSelect = (
      label: string,
      opts: Record<string, string>,
      val: string,
      cb: (v: string) => Promise<void>,
    ) => {
      const wrap = left.createEl("div", { cls: "mpdf-ctrl" });
      wrap.createEl("span", { cls: "mpdf-ctrl-label", text: label });
      const el = wrap.createEl("select", { cls: "mpdf-select" });
      for (const [v, t] of Object.entries(opts)) {
        const o = el.createEl("option", { text: t, value: v });
        if (v === val) o.selected = true;
      }
      el.addEventListener("change", () => void cb(el.value));
    };

    const presetOpts: Record<string, string> = {};
    Object.entries(PRESETS).forEach(([k, v]) => (presetOpts[k] = v.name));
    makeSelect("Style", presetOpts, s.preset, async (v) => {
      this.plugin.applyPreset(v);
      await this.plugin.saveSettingsAndRender();
    });

    const sizeOpts: Record<string, string> = {};
    Object.keys(PAGE_SIZES).forEach((k) => (sizeOpts[k] = k));
    sizeOpts["Custom"] = "Custom";

    // Build the size control manually so we can show/hide the custom-dims inputs.
    const sizeCtrl = left.createEl("div", { cls: "mpdf-ctrl" });
    sizeCtrl.createEl("span", { cls: "mpdf-ctrl-label", text: "Size" });
    const sizeSelect = sizeCtrl.createEl("select", { cls: "mpdf-select" });
    for (const [v, t] of Object.entries(sizeOpts)) {
      const o = sizeSelect.createEl("option", { text: t, value: v });
      if (v === s.pageSize) o.selected = true;
    }

    // Custom W×H inputs — visible only when "Custom" is active.
    const customCtrl = left.createEl("div", { cls: "mpdf-ctrl" });
    customCtrl.toggleClass("mpdf-is-hidden", s.pageSize !== "Custom");

    const makeNumInput = (label: string, val: number): HTMLInputElement => {
      customCtrl.createEl("span", { cls: "mpdf-ctrl-label", text: label });
      const inp = customCtrl.createEl("input", { cls: "mpdf-custom-size-input" });
      inp.type = "number"; inp.min = "10"; inp.step = "1"; inp.value = String(val);
      return inp;
    };
    const wInp = makeNumInput("W", s.customPageWidth);
    const hInp = makeNumInput("H", s.customPageHeight);
    customCtrl.createEl("span", { cls: "mpdf-ctrl-label", text: "mm" });

    sizeSelect.addEventListener("change", () => {
      this.plugin.settings.pageSize = sizeSelect.value;
      customCtrl.toggleClass("mpdf-is-hidden", sizeSelect.value !== "Custom");
      void this.plugin.saveSettingsAndRender();
    });

    const applyCustomDims = async () => {
      this.plugin.settings.customPageWidth  = Math.max(10, parseFloat(wInp.value)  || 210);
      this.plugin.settings.customPageHeight = Math.max(10, parseFloat(hInp.value) || 297);
      await this.plugin.saveSettingsAndRender();
    };
    wInp.addEventListener("change", () => void applyCustomDims());
    hInp.addEventListener("change", () => void applyCustomDims());

    makeSelect("", { portrait: "Portrait", landscape: "Landscape" }, s.orientation,
      async (v) => {
        this.plugin.settings.orientation = v as "portrait" | "landscape";
        await this.plugin.saveSettingsAndRender();
      },
    );

    const zoomWrap = left.createEl("div", { cls: "mpdf-ctrl" });
    zoomWrap.createEl("span", { cls: "mpdf-ctrl-label", text: "Zoom" });
    const zoomLabel = zoomWrap.createEl("span", {
      cls: "mpdf-ctrl-label",
      text: Math.round(s.previewScale * 100) + "%",
    });
    const zoomSlider = zoomWrap.createEl("input");
    zoomSlider.type  = "range";
    zoomSlider.min   = "0.35";
    zoomSlider.max   = "1.0";
    zoomSlider.step  = "0.05";
    zoomSlider.value = String(s.previewScale);
    zoomSlider.addClass("mpdf-zoom-slider");
    zoomSlider.addEventListener("input", () => {
      const v = parseFloat(zoomSlider.value);
      this.plugin.settings.previewScale = v;
      zoomLabel.textContent = Math.round(v * 100) + "%";
      void this.plugin.saveSettings().then(() => { this.renderPreviewOnly(); });
    });

    const breakBtn = left.createEl("button", { cls: "mpdf-btn", text: "Insert Page Break" });
    breakBtn.title = "Insert page break (///)";
    breakBtn.addEventListener("click", () => this.insertAtCursor("\n///\n"));

    this.noteTitleEl = left.createEl("div", { cls: "mpdf-topbar-title", text: "—" });

    this.pageCountEl = right.createEl("span", { cls: "mpdf-page-count", text: "— pages" });

    const settingsBtn = right.createEl("button", { cls: "mpdf-btn mpdf-btn-icon" });
    settingsBtn.setAttr("aria-label", "Open Advanced PDF Export settings");
    setIcon(settingsBtn, "settings");
    settingsBtn.addEventListener("click", () => {
      const settings = (this.app as App & AppWithSettings).setting;
      settings?.open?.();
      settings?.openTabById?.("advanced-pdf-export");
    });

    this.renderBtn = right.createEl("button", { cls: "mpdf-btn", text: "⟳ Render PDF" });
    this.renderBtn.title = "Render preview (Ctrl+Enter)";
    this.renderBtn.addEventListener("click", () => this.render(true));

    this.exportBtn = right.createEl("button", { cls: "mpdf-btn mpdf-btn-primary", text: "⬇ Export PDF" });
    this.exportBtn.addEventListener("click", () => void this.exportPDF());
  }

  private insertAtCursor(text: string) {
    const ta    = this.editorEl;
    const start = ta.selectionStart;
    const end   = ta.selectionEnd;
    ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
    ta.selectionStart = ta.selectionEnd = start + text.length;
    ta.focus();
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  // immediate=true  → run on the next frame (button click, Ctrl+Enter, onOpen).
  // immediate=false → debounce 150 ms (settings panel changes).
  render(immediate = false) {
    const token = ++this.renderToken;
    if (this.renderDebounceTimer !== null) {
      window.clearTimeout(this.renderDebounceTimer);
      this.renderDebounceTimer = null;
    }
    this.showLoading();

    const safeDo = () =>
      this.doRender(token).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[advanced-pdf-export] render error:", err);
        this.hideLoading();
        new Notice("Advanced PDF Export — render failed: " + msg);
      });

    if (immediate) {
      // Double rAF: ensures the spinner paints before synchronous pagination blocks the thread.
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => void safeDo()));
    } else {
      this.renderDebounceTimer = window.setTimeout(() => {
        this.renderDebounceTimer = null;
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => void safeDo()));
      }, 150);
    }
  }

  // Inserts `///` before H1/H2 headings, skipping headings inside fenced
  // code blocks and the very first heading in the document.
  private static insertAutoBreaks(
    md: string,
    breakH1: boolean,
    breakH2: boolean,
  ): string {
    if (!breakH1 && !breakH2) return md;

    const lines = md.split("\n");
    const out: string[] = [];
    let inFence = false;
    let fenceMarker = "";

    for (const line of lines) {
      if (!inFence) {
        const open = line.match(/^(`{3,}|~{3,})/);
        if (open) {
          inFence     = true;
          fenceMarker = open[1];
        } else if (out.length > 0) {
          if      (breakH1 && /^# /.test(line))  out.push("///");
          else if (breakH2 && /^## /.test(line)) out.push("///");
        }
      } else {
        // Close fence: same character, at least as long.
        const close = line.match(/^(`{3,}|~{3,})\s*$/);
        if (
          close &&
          close[1][0] === fenceMarker[0] &&
          close[1].length >= fenceMarker.length
        ) {
          inFence     = false;
          fenceMarker = "";
        }
      }
      out.push(line);
    }

    return out.join("\n");
  }

  private async doRender(token: number) {
    const s = this.plugin.settings;
    let md = normalizeMarkdown(this.editorEl.value);

    if (s.hideFrontmatter) {
      md = stripFrontmatter(md);
    }

    if (s.includeFilenameAsTitle && this.currentFile) {
      md = `# ${this.currentFile.basename}\n\n${md}`;
    }

    md = PDFExportModal.insertAutoBreaks(md, s.autoBreakH1, s.autoBreakH2);

    const sections = splitMarkdownSections(md);
    const dims = resolvePageDims(s);
    const pw = s.orientation === "landscape" ? dims.h : dims.w;
    const ph = s.orientation === "landscape" ? dims.w : dims.h;

    const mTop    = mmToPx(s.marginTop);
    const mBottom = mmToPx(s.marginBottom);
    const mLeft   = mmToPx(s.marginLeft);
    const mRight  = mmToPx(s.marginRight);
    const footerH = s.showFooter && (s.showPageNumbers || !!s.footerText || s.showFooterBorder || !!s.footerImagePath)
      ? (s.footerHeight > 0 ? s.footerHeight : Math.max(28, s.footerFontSize + 14))
      : 0;
    const headerH = s.showHeader && (!!s.headerText || s.showHeaderBorder || !!s.headerImagePath)
      ? (s.headerHeight > 0 ? s.headerHeight : Math.max(20, s.headerFontSize + 10))
      : 0;
    // Clamp to at least 1 px so the paginator sandbox never has zero dimensions.
    const contentW = Math.max(1, pw - mLeft - mRight);
    const contentH = Math.max(1, ph - mTop - mBottom - footerH - headerH);
    const isRTL    = isRTLContent(this.editorEl.value);
    const docCSS   = buildDocCSS(s, isRTL);
    const sourcePath = this.currentFile?.path ?? "pdf-export";

    const sectionEls = await Promise.all(
      sections.map((sec) => renderMarkdownToEl(this.app, sec, sourcePath, this.renderComponent)),
    );

    if (token !== this.renderToken) return;

    // Re-confirm the MathJax stylesheet is settled immediately before reading it.
    await waitForMathJaxStylesheetStable();

    // Strip @font-face before adding MathJax CSS to adoptedStyleSheets — document.head
    // fonts are accessible to shadow DOM per spec, and some Electron builds silently
    // fail to load fonts declared inside an adopted CSSStyleSheet.
    const rawMathCSS    = getMathJaxCSS();
    const shadowMathCSS = rawMathCSS ? stripAtFontFaces(rawMathCSS) : "";
    const fullCSS = shadowMathCSS ? `${shadowMathCSS}\n${docCSS}` : docCSS;

    const allPages: HTMLElement[][] = [];
    for (const sectionEl of sectionEls) {
      allPages.push(...paginateEl(sectionEl, contentW, contentH, fullCSS));
    }

    const layouts = buildPageLayouts(allPages, s);
    this.layoutCache = { layouts, pw, ph, mTop, mLeft, mRight, footerH, headerH, contentW, contentH, docCSS: fullCSS, fontFamily: resolveFont(s), accentColor: s.accentColor, pageBackground: s.pageBackground, isRTL };

    this.drawPreview(this.layoutCache, s.previewScale);
    this.pageCountEl.textContent = `${layouts.length} page${layouts.length !== 1 ? "s" : ""}`;
    this.hideLoading();
  }

  private renderPreviewOnly() {
    if (!this.layoutCache) return;
    this.drawPreview(this.layoutCache, this.plugin.settings.previewScale);
  }

  private showLoading() {
    this.loadingOverlayEl.addClass("mpdf-is-active");
    this.renderBtn.disabled = true;
    this.renderBtn.textContent = "Rendering…";
  }

  private hideLoading() {
    this.loadingOverlayEl.removeClass("mpdf-is-active");
    this.renderBtn.disabled = false;
    this.renderBtn.textContent = "⟳ Render PDF";
  }

  private drawPreview(c: LayoutCache, scale: number) {
    const { layouts, pw, ph, mTop, mLeft, mRight, footerH, headerH, contentW, contentH, docCSS, fontFamily, accentColor, pageBackground, isRTL } = c;
    const s = this.plugin.settings;
    this.previewEl.empty();

    // Map heading IDs → page-wrap index for in-preview anchor scrolling.
    const idToWrapIndex = new Map<string, number>();
    layouts.forEach((layout, i) => {
      for (const node of layout.pageNodes) {
        node.querySelectorAll("[id]").forEach((el) => {
          if (!idToWrapIndex.has(el.id)) idToWrapIndex.set(el.id, i);
        });
        if (node.id && !idToWrapIndex.has(node.id)) idToWrapIndex.set(node.id, i);
      }
    });

    const pageWraps: HTMLElement[] = [];

    // All pages share identical CSS — build once and adopt by reference in each shadow root.
    const shadowCSS = `
      :host {
        display: block;
        width: ${pw}px;
        height: ${ph}px;
        background: ${pageBackground};
        box-shadow: 0 2px 8px rgba(0,0,0,.30), 0 8px 32px rgba(0,0,0,.25);
        overflow: hidden;
        position: relative;
        box-sizing: border-box;
      }
      *, *::before, *::after { box-sizing: border-box; }
      .mpdf-hf-center { flex: 1; text-align: center; }
      .mpdf-hf-right { margin-left: auto; }
      ${docCSS}
    `;
    const pageSheet = new CSSStyleSheet();
    pageSheet.replaceSync(shadowCSS);

    for (const layout of layouts) {
      const scaledW = Math.round(pw * scale);
      const scaledH = Math.round(ph * scale);

      const wrap = this.previewEl.createEl("div", { cls: "mpdf-page-wrap" });
      wrap.setCssStyles({ width: `${scaledW}px`, height: `${scaledH}px` });
      wrap.createEl("div", { cls: "mpdf-page-label", text: `Page ${layout.pageNum} of ${layout.totalPages}` });
      pageWraps.push(wrap);

      const scaleWrap = wrap.createEl("div", { cls: "mpdf-page-scale" });
      scaleWrap.setCssStyles({ width: `${scaledW}px`, height: `${scaledH}px` });

      // Shadow root isolates page content from Obsidian's theme CSS.
      const shadowHost = activeDocument.createElement("div");
      shadowHost.addClass("mpdf-shadow-host");
      shadowHost.setCssStyles({ width: `${pw}px`, height: `${ph}px`, transform: `scale(${scale})` });
      scaleWrap.appendChild(shadowHost);

      const shadow = shadowHost.attachShadow({ mode: "open" });
      shadow.adoptedStyleSheets = [pageSheet];

      // ── Page background image (appended first — behind everything) ─────────────
      if (s.backgroundImageEnabled && s.backgroundImagePath) {
        const bgUrl = resolveImageUrl(this.app, s.backgroundImagePath);
        if (bgUrl) {
          const isContentOnly = s.backgroundImageScope === "content-only";
          const bgEl = activeDocument.createElement("div");
          const bgCss = bgImageCssProps(s.backgroundImageSize);
          bgEl.setCssStyles({
            position: "absolute",
            ...(isContentOnly
              ? { top: `${mTop + headerH}px`, left: `${mLeft}px`, width: `${contentW}px`, height: `${contentH}px` }
              : { inset: "0" }),
            backgroundImage:    `url('${bgUrl}')`,
            backgroundRepeat:   bgCss.repeat,
            backgroundSize:     bgCss.size,
            backgroundPosition: "center",
            opacity:            String(s.backgroundImageOpacity),
            pointerEvents:      "none",
          });
          shadow.appendChild(bgEl);
        }
      }

      const pageShowsHeader = layout.pageShowsHeader;
      const pageShowsFooter = layout.pageShowsFooter;

      // ── Header banner image (behind header text) ──────────────────────────────
      if (pageShowsHeader && s.showHeader && s.headerImagePath) {
        const imgUrl = resolveImageUrl(this.app, s.headerImagePath);
        if (imgUrl) {
          const bannerEl = activeDocument.createElement("div");
          bannerEl.setCssStyles({
            position: "absolute",
            top: `${mTop * 0.4}px`,
            left: `${s.headerImageMargin}px`,
            right: `${s.headerImageMargin}px`,
            height: `${headerH}px`,
            backgroundImage: `url('${imgUrl}')`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
            pointerEvents: "none",
          });
          shadow.appendChild(bannerEl);
        }
      }

      // ── Header text ──────────────────────────────────────────────────────────
      const hasHeader = layout.hasHeader;
      if (hasHeader) {
        const hdr = activeDocument.createElement("div");
        hdr.setCssStyles({
          position: "absolute", top: `${mTop * 0.4}px`, left: `${mLeft}px`, right: `${mRight}px`,
          height: `${headerH}px`,
          display: "flex", alignItems: "center",
          fontSize: `${s.headerFontSize}px`, color: s.headerFontColor, fontFamily: fontFamily, whiteSpace: "nowrap",
          ...(s.showHeaderBorder ? { borderBottom: `0.5px solid ${accentColor}33` } : {}),
        });
        appendHFNodes(hdr, layout.headerCenter, layout.headerLeft, layout.headerRight);
        shadow.appendChild(hdr);
      }

      // ── Content ──────────────────────────────────────────────────────────────
      const contentDiv = activeDocument.createElement("div");
      contentDiv.className = "mpdf-doc";
      if (isRTL) contentDiv.setAttribute("dir", "rtl");
      // No explicit height or overflow:hidden — :host clips at the page edge.
      // Adding a second clip here caused bottom lines to be cut off in preview
      // due to sub-pixel rounding differences between the paginator sandbox
      // (light DOM) and the shadow DOM rendering context.
      contentDiv.setCssStyles({
        position: "absolute", top: `${mTop + headerH}px`, left: `${mLeft}px`,
        width: `${contentW}px`,
      });
      for (const node of layout.pageNodes) contentDiv.appendChild(node.cloneNode(true));
      shadow.appendChild(contentDiv);

      // Wire internal anchor links via light-DOM page-wrap scrollIntoView.
      contentDiv.querySelectorAll<HTMLAnchorElement>("a[href^='#']").forEach((a) => {
        const targetId = decodeURIComponent((a.getAttribute("href") ?? "").slice(1));
        const wrapIdx  = idToWrapIndex.get(targetId);
        if (wrapIdx !== undefined) {
          a.title = `Go to page ${wrapIdx + 1}`;
          a.addEventListener("click", (e) => {
            e.preventDefault();
            pageWraps[wrapIdx]?.scrollIntoView({ behavior: "smooth", block: "start" });
          });
        }
      });

      // ── Footer banner image (behind footer text) ──────────────────────────────
      if (pageShowsFooter && s.showFooter && s.footerImagePath) {
        const imgUrl = resolveImageUrl(this.app, s.footerImagePath);
        if (imgUrl) {
          const bannerEl = activeDocument.createElement("div");
          bannerEl.setCssStyles({
            position: "absolute",
            bottom: "0",
            left: `${s.footerImageMargin}px`,
            right: `${s.footerImageMargin}px`,
            height: `${footerH}px`,
            backgroundImage: `url('${imgUrl}')`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
            pointerEvents: "none",
          });
          shadow.appendChild(bannerEl);
        }
      }

      // ── Footer text ───────────────────────────────────────────────────────────
      const hasFooter = layout.hasFooter;
      if (hasFooter) {
        const footer = activeDocument.createElement("div");
        footer.setCssStyles({
          position: "absolute", bottom: "0", left: "0", right: "0",
          height: `${footerH}px`, display: "flex", alignItems: "center",
          ...(s.showFooterBorder ? { borderTop: `0.5px solid ${accentColor}33` } : {}),
          padding: `0 ${mRight}px 0 ${mLeft}px`, fontSize: `${s.footerFontSize}px`, color: s.footerFontColor, fontFamily: fontFamily,
        });
        appendHFNodes(footer, layout.footerCenter, layout.footerLeft, layout.footerRight);
        shadow.appendChild(footer);
      }

      // ── Frame ────────────────────────────────────────────────────────────────
      // Drawn last so it overlays the page edge on top of header/footer/content.
      const frame = buildFrameOverlayEl(s);
      if (frame) shadow.appendChild(frame);
    }
  }

  // ── Export ──────────────────────────────────────────────────────────────────

  private async exportPDF() {
    const s = this.plugin.settings;

    this.exportBtn.disabled = true;
    this.exportBtn.textContent = "⬇ Exporting…";

    const resetExportBtn = () => {
      this.exportBtn.disabled = false;
      this.exportBtn.textContent = "⬇ Export PDF";
    };

    // Ensure we have a layout — run a full render if the modal was just opened.
    // The export button is already disabled, so no paint yield is needed.
    if (!this.layoutCache) {
      // Cancel any pending debounced render — this export render supersedes it.
      if (this.renderDebounceTimer !== null) {
        window.clearTimeout(this.renderDebounceTimer);
        this.renderDebounceTimer = null;
      }
      const token = ++this.renderToken;
      this.showLoading();
      try {
        await this.doRender(token);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        new Notice("Advanced PDF Export — render failed: " + msg);
        this.hideLoading();
        resetExportBtn();
        return;
      }
    }

    const cache = this.layoutCache;
    if (!cache || cache.layouts.length === 0) {
      new Notice("Nothing to export.");
      resetExportBtn();
      return;
    }

    const { layouts, pw, ph, mTop, mLeft, mRight, footerH, headerH, contentW, contentH, docCSS, fontFamily, accentColor: exportAccent, pageBackground, isRTL } = cache;

    const frameHTML = buildFrameOverlayHTML(s);

    // ── Resolve image URLs once (app:// works in Electron's BrowserWindow) ──────
    const resolvedHeaderBannerUrl = (s.showHeader && s.headerImagePath)
      ? resolveImageUrl(this.app, s.headerImagePath) : "";
    const resolvedFooterBannerUrl = (s.showFooter && s.footerImagePath)
      ? resolveImageUrl(this.app, s.footerImagePath) : "";
    const resolvedBgImgUrl = (s.backgroundImageEnabled && s.backgroundImagePath)
      ? resolveImageUrl(this.app, s.backgroundImagePath) : "";

    // Page background image HTML (identical on every page; rendered first so it's behind everything)
    const bgImgHTML = resolvedBgImgUrl ? (() => {
      const bgCss = bgImageCssProps(s.backgroundImageSize);
      const pos = s.backgroundImageScope === "content-only"
        ? `top:${mTop + headerH}px;left:${mLeft}px;width:${contentW}px;height:${contentH}px;`
        : `inset:0;`;
      const common = `background-image:url('${resolvedBgImgUrl}');background-size:${bgCss.size};background-repeat:${bgCss.repeat};background-position:center;opacity:${s.backgroundImageOpacity};pointer-events:none;`;
      return `<div style="position:absolute;${pos}${common}"></div>`;
    })() : "";

    const pageHTMLParts = layouts.map((layout) => {
      // pageNodes have already been through postProcessRenderedHTML, which
      // strips style/script tags (preserving those inside SVGs for mermaid).
      // No further sanitisation needed — serialize directly.
      const contentHTML = layout.pageNodes.map((n) => n.outerHTML).join("\n");

      const hasExportHeader = layout.hasHeader;
      const headerBorder = s.showHeaderBorder ? `border-bottom:0.5px solid ${exportAccent}33;` : "";
      const headerHTML = hasExportHeader
        ? `<div style="position:absolute;top:${mTop * 0.4}px;left:${mLeft}px;right:${mRight}px;height:${headerH}px;display:flex;align-items:center;font-size:${s.headerFontSize}px;color:${s.headerFontColor};font-family:${fontFamily};white-space:nowrap;${headerBorder}">${buildHFInnerHTML(layout.headerCenter, layout.headerLeft, layout.headerRight)}</div>`
        : "";

      const hasExportFooter = layout.hasFooter;
      const footerBorder = s.showFooterBorder ? `border-top:0.5px solid ${exportAccent}33;` : "";
      const footerHTML = hasExportFooter
        ? `<div style="position:absolute;bottom:0;left:0;right:0;height:${footerH}px;display:flex;align-items:center;${footerBorder}padding:0 ${mRight}px 0 ${mLeft}px;font-size:${s.footerFontSize}px;color:${s.footerFontColor};font-family:${fontFamily};">${buildHFInnerHTML(layout.footerCenter, layout.footerLeft, layout.footerRight)}</div>`
        : "";

      const contentDivHTML = `<div class="mpdf-doc"${isRTL ? ' dir="rtl"' : ''} style="position:absolute;top:${mTop + headerH}px;left:${mLeft}px;width:${contentW}px;">${contentHTML}</div>`;

      // Banner divs precede their text divs so DOM order puts text on top.
      const headerBannerHTML = (layout.pageShowsHeader && resolvedHeaderBannerUrl)
        ? `<div style="position:absolute;top:${mTop * 0.4}px;left:${s.headerImageMargin}px;right:${s.headerImageMargin}px;height:${headerH}px;background-image:url('${resolvedHeaderBannerUrl}');background-size:cover;background-position:center;background-repeat:no-repeat;pointer-events:none;"></div>`
        : "";
      const footerBannerHTML = (layout.pageShowsFooter && resolvedFooterBannerUrl)
        ? `<div style="position:absolute;bottom:0;left:${s.footerImageMargin}px;right:${s.footerImageMargin}px;height:${footerH}px;background-image:url('${resolvedFooterBannerUrl}');background-size:cover;background-position:center;background-repeat:no-repeat;pointer-events:none;"></div>`
        : "";

      return `<div class="mpdf-export-page">${bgImgHTML}${headerBannerHTML}${headerHTML}${contentDivHTML}${footerBannerHTML}${footerHTML}${frameHTML}</div>`;
    });

    // Re-confirm the MathJax stylesheet is settled immediately before the
    // capture that ends up in the exported PDF.
    await waitForMathJaxStylesheetStable();

    // Inline MathJax fonts as base64 data URIs — the export BrowserWindow's blob:
    // origin cannot resolve the app:// font paths MathJax normally references.
    const inlinedMathCSS = await getMathJaxCSSInlined();

    const printCSS = `
      *, *::before, *::after { box-sizing: border-box; }
      @page { size: ${pw}px ${ph}px; margin: 0; }
      html, body { margin: 0; padding: 0; background: ${pageBackground}; }
      .mpdf-export-page {
        position: relative;
        width: ${pw}px; height: ${ph}px;
        overflow: hidden;
        background: ${pageBackground};
        page-break-after: always; break-after: page;
      }
      .mpdf-export-page:last-child { page-break-after: avoid; break-after: avoid; }
      ${docCSS}
    `;

    const fullHTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${escapeHTML(this.currentFile?.basename ?? "Export")}</title>
${inlinedMathCSS ? `<style>${escapeCSSForStyle(inlinedMathCSS)}</style>` : ""}
<style>${escapeCSSForStyle(printCSS)}</style>
</head>
<body>
${pageHTMLParts.join("\n")}
</body>
</html>`;

    try {
      // Obsidian uses @electron/remote; the legacy `electron.remote` property is
      // undefined in the renderer process of modern Electron versions.
      const electron = window as unknown as ElectronBridge;
      const remote = electron.require("@electron/remote") as ElectronRemote | null;
      if (!remote?.dialog) throw new Error("no remote");

      const res = await remote.dialog.showSaveDialog({
        title: "Save PDF",
        defaultPath: (this.currentFile?.basename ?? "export") + ".pdf",
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (res.canceled || !res.filePath) {
        resetExportBtn();
        return;
      }

      new Notice("Advanced PDF Export — generating PDF…");

      const blob = new Blob([fullHTML], { type: "text/html" });
      const url  = URL.createObjectURL(blob);
      const win  = new remote.BrowserWindow({ show: false, webPreferences: { nodeIntegration: false } });

      win.loadURL(url);

      // Both events can fire for the same load — a flag ensures only the first one acts.
      let exportHandled = false;
      const cleanupWin = () => { URL.revokeObjectURL(url); win.close(); resetExportBtn(); };

      win.webContents.once("did-fail-load", (_event: unknown, _code: number, desc: string) => {
        if (exportHandled) return;
        exportHandled = true;
        new Notice("Advanced PDF Export — failed to load page: " + desc);
        cleanupWin();
      });

      win.webContents.once("did-finish-load", () => {
        if (exportHandled) return;
        exportHandled = true;

        // Ensure all @font-face fonts (including inlined MathJax fonts) are loaded
        // before capturing the PDF so math characters are not invisible.
        win.webContents
          .executeJavaScript("document.fonts.ready.then(() => true)")
          .catch(() => true)
          .then(() => {
            // Custom sizes embed @page dimensions in the HTML; preferCSSPageSize lets
            // Electron honour that rule. Named sizes pass the size string directly.
            const isCustom = s.pageSize === "Custom";
            return win.webContents.printToPDF({
              pageSize:          isCustom ? "A4" : s.pageSize,
              landscape:         !isCustom && s.orientation === "landscape",
              preferCSSPageSize: isCustom,
              printBackground:   true,
              margins:           { marginType: "none" },
            });
          })
          .then(async (data: Uint8Array) => {
            // printToPDF produces a flat PDF with no outline; inject one via pdf-lib.
            if (s.includeOutline) {
              try {
                data = await injectPDFOutline(data, extractOutlineEntries(layouts));
              } catch (outlineErr) {
                console.warn("[advanced-pdf-export] outline injection failed:", outlineErr);
              }
            }
            electron.require("fs").writeFile(res.filePath!, data, (err: Error | null) => {
              if (err) new Notice("Advanced PDF Export — failed to save: " + err.message);
              else     new Notice("✓ PDF saved — " + res.filePath);
              cleanupWin();
            });
          })
          .catch((err: Error) => {
            new Notice("Advanced PDF Export — failed to render: " + err.message);
            cleanupWin();
          });
      });
    } catch {
      new Notice("Advanced PDF Export requires the Obsidian desktop app.");
      resetExportBtn();
    }
  }
}

// ─── Settings tab ─────────────────────────────────────────────────────────────

class PDFExportSettingTab extends PluginSettingTab {
  plugin: MarkdownPDFPlugin;

  /** True when any setting changed while this tab is open; triggers a single render on hide(). */
  private dirty = false;

  constructor(app: App, plugin: MarkdownPDFPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    // Start fresh: if nothing changes before hide(), no render will happen.
    this.dirty = false;
    this.buildSettings();
  }

  /** Called by Obsidian when the user leaves this tab. Fires one render if settings changed. */
  hide(): void {
    if (this.dirty) {
      this.dirty = false;
      this.plugin.activeModal?.render(true);
    }
  }

  private async markDirty(): Promise<void> {
    this.dirty = true;
    await this.plugin.saveSettings();
  }

  /** Builds (or rebuilds) the settings UI. Separated from display() so preset/reset
   *  handlers can refresh the form without resetting the dirty flag. */
  private buildSettings(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;

    // Shared helpers ────────────────────────────────────────────────────────────
    type NumericFieldKey = "marginTop" | "marginBottom" | "marginLeft" | "marginRight"
      | "headerFontSize" | "footerFontSize" | "frameThickness" | "frameMargin"
      | "headerHeight" | "footerHeight" | "headerImageMargin" | "footerImageMargin";
    const numberSetting = (name: string, key: NumericFieldKey, min?: number, desc?: string) => {
      const st = new Setting(containerEl).setName(name);
      if (desc) st.setDesc(desc);
      return st.addText((t) =>
        t.setValue(String(s[key])).onChange((v) => {
          const n = parseInt(v, 10) || 0;
          s[key] = min !== undefined ? Math.max(min, n) : n;
          void this.markDirty();
        }),
      );
    };

    type ColorKey = "accentColor" | "bodyColor" | "headingColor" | "pageBackground"
      | "blockquoteBg" | "blockquoteBorderColor" | "tableHeaderBg" | "codeBackground"
      | "headerFontColor" | "footerFontColor" | "frameColor";
    const colorSetting = (name: string, key: ColorKey) =>
      new Setting(containerEl).setName(name).addColorPicker((cp) =>
        cp.setValue(s[key]).onChange((v) => { s[key] = v; void this.markDirty(); }),
      );

    // ── 1. Style Preset ───────────────────────────────────────────────────────
    new Setting(containerEl).setName("Style Preset").setHeading();
    new Setting(containerEl)
      .setName("Preset")
      .setDesc("Pick a preset to configure the overall document style. Fine-tune any setting below.")
      .addDropdown((d) => {
        Object.entries(PRESETS).forEach(([k, v]) => { d.addOption(k, v.name); });
        d.setValue(s.preset).onChange((v) => {
          this.plugin.applyPreset(v);
          void this.markDirty().then(() => { this.buildSettings(); });
        });
      })
      .addButton((b) =>
        b.setButtonText("Reset Preset")
         .setTooltip("Reset current preset to its default values")
         .onClick(() => {
           this.plugin.applyPreset(s.preset, true);
           void this.markDirty().then(() => { this.buildSettings(); });
         }),
      );

    // ── 2. Page ───────────────────────────────────────────────────────────────
    new Setting(containerEl).setName("Page").setHeading();
    let customPageSizeSetting: Setting;
    new Setting(containerEl).setName("Page size").addDropdown((d) => {
      Object.keys(PAGE_SIZES).forEach((k) => { d.addOption(k, k); });
      d.addOption("Custom", "Custom…");
      d.setValue(s.pageSize).onChange((v) => {
        s.pageSize = v;
        customPageSizeSetting.settingEl.toggleClass("mpdf-is-hidden", v !== "Custom");
        void this.markDirty();
      });
    });
    customPageSizeSetting = new Setting(containerEl)
      .setName("Custom page size (mm)")
      .setDesc("Width × Height in millimetres.")
      .addText((t) =>
        t.setPlaceholder("Width").setValue(String(s.customPageWidth))
         .onChange((v) => { s.customPageWidth  = Math.max(10, parseFloat(v) || 210); void this.markDirty(); }),
      )
      .addText((t) =>
        t.setPlaceholder("Height").setValue(String(s.customPageHeight))
         .onChange((v) => { s.customPageHeight = Math.max(10, parseFloat(v) || 297); void this.markDirty(); }),
      );
    customPageSizeSetting.settingEl.toggleClass("mpdf-is-hidden", s.pageSize !== "Custom");
    new Setting(containerEl).setName("Orientation").addDropdown((d) =>
      d.addOptions({ portrait: "Portrait", landscape: "Landscape" })
       .setValue(s.orientation)
       .onChange((v) => { s.orientation = v as "portrait" | "landscape"; void this.markDirty(); }),
    );

    // ── 3. Margin & Frame ─────────────────────────────────────────────────────
    new Setting(containerEl).setName("Margin & Frame").setHeading();
    new Setting(containerEl)
      .setName("Margins")
      .setDesc("Top · Bottom · Left · Right")
      .addText((t) =>
        t.setPlaceholder("Top").setValue(String(s.marginTop))
         .onChange((v) => { s.marginTop    = parseInt(v, 10) || 0; void this.markDirty(); }),
      )
      .addText((t) =>
        t.setPlaceholder("Bottom").setValue(String(s.marginBottom))
         .onChange((v) => { s.marginBottom = parseInt(v, 10) || 0; void this.markDirty(); }),
      )
      .addText((t) =>
        t.setPlaceholder("Left").setValue(String(s.marginLeft))
         .onChange((v) => { s.marginLeft   = parseInt(v, 10) || 0; void this.markDirty(); }),
      )
      .addText((t) =>
        t.setPlaceholder("Right").setValue(String(s.marginRight))
         .onChange((v) => { s.marginRight  = parseInt(v, 10) || 0; void this.markDirty(); }),
      );

    let frameColorSetting: Setting;
    let frameThicknessSetting: Setting;
    let frameMarginSetting: Setting;
    let frameStyleSetting: Setting;
    const toggleFrameSettings = (visible: boolean) => {
      [frameColorSetting, frameThicknessSetting, frameMarginSetting, frameStyleSetting]
        .forEach((st) => st.settingEl.toggleClass("mpdf-is-hidden", !visible));
    };
    new Setting(containerEl)
      .setName("Enable frame")
      .setDesc("Draws a border around the outer edge of every page.")
      .addToggle((t) =>
        t.setValue(s.frameEnabled).onChange((v) => {
          s.frameEnabled = v;
          toggleFrameSettings(v);
          void this.markDirty();
        }),
      );
    frameColorSetting     = colorSetting("Frame color", "frameColor");
    frameThicknessSetting = numberSetting("Frame thickness (px)", "frameThickness", 1);
    frameMarginSetting    = numberSetting(
      "Frame margin (px)", "frameMargin", 0,
      "Gap between the page edge and the frame, applied equally on all four sides.",
    );
    frameStyleSetting = new Setting(containerEl).setName("Frame style").addDropdown((d) =>
      d.addOptions({ solid: "Solid", dashed: "Dashed", dotted: "Dotted", double: "Double", groove: "Groove", ridge: "Ridge" })
       .setValue(s.frameStyle)
       .onChange((v) => { s.frameStyle = v as PDFExportSettings["frameStyle"]; void this.markDirty(); }),
    );
    toggleFrameSettings(s.frameEnabled);

    // ── 4. Typography ─────────────────────────────────────────────────────────
    new Setting(containerEl).setName("Typography").setHeading();
    let customFontSetting: Setting;
    new Setting(containerEl).setName("Font family").addDropdown((d) =>
      d.addOptions({
        "Georgia, serif":                          "Georgia (Serif)",
        "'Times New Roman', Times, serif":         "Times New Roman",
        "'Palatino Linotype', Palatino, serif":    "Palatino",
        "Arial, sans-serif":                       "Arial",
        "'Helvetica Neue', Helvetica, sans-serif": "Helvetica",
        "'Trebuchet MS', sans-serif":              "Trebuchet",
        "'Courier New', monospace":                "Courier New",
        "__custom__":                              "Custom…",
      }).setValue(s.fontFamily)
       .onChange((v) => {
         s.fontFamily = v;
         customFontSetting.settingEl.toggleClass("mpdf-is-hidden", v !== "__custom__");
         void this.markDirty();
       }),
    );
    customFontSetting = new Setting(containerEl)
      .setName("Custom font name")
      .setDesc("CSS font-family value — e.g. \"Inter, sans-serif\". The font must be installed on your system.")
      .addText((t) =>
        t.setPlaceholder("e.g. Inter, sans-serif")
         .setValue(s.customFontName)
         .onChange((v) => { s.customFontName = v; void this.markDirty(); }),
      );
    customFontSetting.settingEl.toggleClass("mpdf-is-hidden", s.fontFamily !== "__custom__");
    new Setting(containerEl).setName("Font size (px)").addDropdown((d) => {
      ["10","11","12","13","14","15","16"].forEach((v) => { d.addOption(v, v + "px"); });
      d.setValue(String(s.fontSize)).onChange((v) => { s.fontSize = parseInt(v); void this.markDirty(); });
    });
    new Setting(containerEl).setName("Code font size").addDropdown((d) =>
      d.addOptions({ "0.75": "0.75em", "0.80": "0.80em", "0.82": "0.82em", "0.85": "0.85em", "0.88": "0.88em", "0.90": "0.90em", "1.0": "1.00em" })
       .setValue(String(s.codeFontSize))
       .onChange((v) => { s.codeFontSize = parseFloat(v); void this.markDirty(); }),
    );
    new Setting(containerEl).setName("Line height").addDropdown((d) =>
      d.addOptions({ "1.4": "Tight (1.4)", "1.6": "Compact (1.6)", "1.75": "Normal (1.75)", "1.85": "Relaxed (1.85)", "2.0": "Double (2.0)" })
       .setValue(String(s.lineHeight))
       .onChange((v) => { s.lineHeight = parseFloat(v); void this.markDirty(); }),
    );
    new Setting(containerEl).setName("Paragraph spacing").addDropdown((d) =>
      d.addOptions({ "0": "None", "0.3": "Tight (0.3em)", "0.5": "Normal (0.5em)", "0.65": "Relaxed (0.65em)", "1.0": "Wide (1em)" })
       .setValue(String(s.paragraphSpacing))
       .onChange((v) => { s.paragraphSpacing = parseFloat(v); void this.markDirty(); }),
    );
    new Setting(containerEl)
      .setName("Heading scale")
      .setDesc("Multiplier applied to all heading sizes.")
      .addDropdown((d) =>
        d.addOptions({ "0.8": "Small (0.8×)", "0.88": "0.88×", "0.9": "Compact (0.9×)", "0.95": "0.95×", "1.0": "Normal (1.0×)", "1.05": "1.05×", "1.1": "Large (1.1×)", "1.2": "XLarge (1.2×)" })
         .setValue(String(s.headingScale))
         .onChange((v) => { s.headingScale = parseFloat(v); void this.markDirty(); }),
      );

    // ── 5. Background ─────────────────────────────────────────────────────────
    new Setting(containerEl).setName("Background").setHeading();
    let bgColorSetting: Setting;
    let bgImgPathSetting: Setting;
    let bgImgSizeSetting: Setting;
    let bgImgScopeSetting: Setting;
    let bgImgOpacitySetting: Setting;
    const showBgMode = (useImage: boolean) => {
      bgColorSetting.settingEl.toggleClass("mpdf-is-hidden", useImage);
      [bgImgPathSetting, bgImgSizeSetting, bgImgScopeSetting, bgImgOpacitySetting]
        .forEach((st) => st.settingEl.toggleClass("mpdf-is-hidden", !useImage));
    };
    new Setting(containerEl)
      .setName("Use image background")
      .setDesc("When on, a background image is used instead of the solid background color.")
      .addToggle((t) =>
        t.setValue(s.backgroundImageEnabled).onChange((v) => {
          s.backgroundImageEnabled = v;
          showBgMode(v);
          void this.markDirty();
        }),
      );
    bgColorSetting = new Setting(containerEl)
      .setName("Page background color")
      .addColorPicker((cp) =>
        cp.setValue(s.pageBackground).onChange((v) => { s.pageBackground = v; void this.markDirty(); }),
      );
    bgImgPathSetting = new Setting(containerEl)
      .setName("Background image")
      .setDesc("Vault-relative path or https:// URL.")
      .addText((t) =>
        t.setPlaceholder("assets/background.png").setValue(s.backgroundImagePath)
         .onChange((v) => { s.backgroundImagePath = v; void this.markDirty(); }),
      );
    bgImgSizeSetting = new Setting(containerEl).setName("Fit").addDropdown((d) =>
      d.addOptions({
        cover:   "Cover (fill, crop edges)",
        contain: "Contain (fit, show gaps)",
        fill:    "Fill (stretch to exact size)",
        tile:    "Tile (repeat)",
      })
       .setValue(s.backgroundImageSize)
       .onChange((v) => { s.backgroundImageSize = v as PDFExportSettings["backgroundImageSize"]; void this.markDirty(); }),
    );
    bgImgScopeSetting = new Setting(containerEl)
      .setName("Scope")
      .setDesc("Full page includes header and footer bands. Content area only restricts the background to the text zone between them.")
      .addDropdown((d) =>
        d.addOptions({ "full-page": "Full page", "content-only": "Content area only" })
         .setValue(s.backgroundImageScope)
         .onChange((v) => { s.backgroundImageScope = v as PDFExportSettings["backgroundImageScope"]; void this.markDirty(); }),
      );
    bgImgOpacitySetting = new Setting(containerEl).setName("Opacity").addDropdown((d) =>
      d.addOptions({ "0.05": "5%", "0.1": "10%", "0.15": "15%", "0.2": "20%", "0.3": "30%", "0.4": "40%", "0.5": "50%", "0.6": "60%", "0.7": "70%", "0.8": "80%", "0.9": "90%", "1": "100%" })
       .setValue(String(s.backgroundImageOpacity))
       .onChange((v) => { s.backgroundImageOpacity = parseFloat(v); void this.markDirty(); }),
    );
    showBgMode(s.backgroundImageEnabled);

    // ── 6. Colors ─────────────────────────────────────────────────────────────
    new Setting(containerEl).setName("Colors").setHeading();
    colorSetting("Accent color",            "accentColor");
    colorSetting("Body text color",         "bodyColor");
    colorSetting("Heading color",           "headingColor");
    colorSetting("Blockquote background",   "blockquoteBg");
    colorSetting("Blockquote border",       "blockquoteBorderColor");
    colorSetting("Table header background", "tableHeaderBg");
    colorSetting("Code background",         "codeBackground");
    new Setting(containerEl)
      .setName("Code syntax theme")
      .setDesc("Independent of your Obsidian theme. \"None\" uses the body text color and code background above with no highlighting.")
      .addDropdown((d) => {
        const opts: Record<string, string> = {};
        for (const [key, theme] of Object.entries(CODE_THEMES)) opts[key] = theme.name;
        d.addOptions(opts).setValue(s.codeTheme).onChange((v) => { s.codeTheme = v; void this.markDirty(); });
      });

    // ── 7. Header ─────────────────────────────────────────────────────────────
    new Setting(containerEl).setName("Header").setHeading();
    new Setting(containerEl).setName("Show header").addToggle((t) =>
      t.setValue(s.showHeader).onChange((v) => { s.showHeader = v; void this.markDirty(); }),
    );
    new Setting(containerEl)
      .setName("Show on first page")
      .setDesc("When off, the header is hidden on page 1. Useful for title pages.")
      .addToggle((t) =>
        t.setValue(s.showHeaderOnFirstPage).onChange((v) => { s.showHeaderOnFirstPage = v; void this.markDirty(); }),
      );
    new Setting(containerEl)
      .setName("Header text")
      .addText((t) => t.setValue(s.headerText).onChange((v) => { s.headerText = v; void this.markDirty(); }));
    new Setting(containerEl).setName("Alignment").addDropdown((d) =>
      d.addOptions({ left: "Left", center: "Center", right: "Right" })
       .setValue(s.headerAlignment)
       .onChange((v) => { s.headerAlignment = v as "left"|"center"|"right"; void this.markDirty(); }),
    );
    numberSetting("Font size (px)", "headerFontSize", 1);
    numberSetting("Height (px)", "headerHeight", 0, "Explicit band height (0 = auto).");
    colorSetting("Font color", "headerFontColor");
    new Setting(containerEl).setName("Border").setDesc("Separator line below the header.").addToggle((t) =>
      t.setValue(s.showHeaderBorder).onChange((v) => { s.showHeaderBorder = v; void this.markDirty(); }),
    );
    new Setting(containerEl)
      .setName("Image")
      .setDesc("Vault-relative path or https:// URL. Fills the header band as a background banner.")
      .addText((t) =>
        t.setPlaceholder("assets/header-banner.png").setValue(s.headerImagePath)
         .onChange((v) => { s.headerImagePath = v; void this.markDirty(); }),
      );
    numberSetting("Image left/right margin (px)", "headerImageMargin", 0, "Insets the banner from the left and right page edges.");

    // ── 8. Footer ─────────────────────────────────────────────────────────────
    new Setting(containerEl).setName("Footer").setHeading();
    new Setting(containerEl).setName("Show footer").addToggle((t) =>
      t.setValue(s.showFooter).onChange((v) => { s.showFooter = v; void this.markDirty(); }),
    );
    new Setting(containerEl)
      .setName("Show on first page")
      .setDesc("When off, the footer and page numbers are hidden on page 1. Page numbering starts from page 2.")
      .addToggle((t) =>
        t.setValue(s.showFooterOnFirstPage).onChange((v) => { s.showFooterOnFirstPage = v; void this.markDirty(); }),
      );
    new Setting(containerEl)
      .setName("Footer text")
      .addText((t) => t.setValue(s.footerText).onChange((v) => { s.footerText = v; void this.markDirty(); }));
    new Setting(containerEl).setName("Alignment").addDropdown((d) =>
      d.addOptions({ left: "Left", center: "Center", right: "Right" })
       .setValue(s.footerTextAlignment)
       .onChange((v) => { s.footerTextAlignment = v as "left" | "center" | "right"; void this.markDirty(); }),
    );
    numberSetting("Font size (px)", "footerFontSize", 1);
    numberSetting("Height (px)", "footerHeight", 0, "Explicit band height (0 = auto).");
    colorSetting("Font color", "footerFontColor");
    new Setting(containerEl).setName("Border").setDesc("Separator line above the footer.").addToggle((t) =>
      t.setValue(s.showFooterBorder).onChange((v) => { s.showFooterBorder = v; void this.markDirty(); }),
    );
    new Setting(containerEl)
      .setName("Image")
      .setDesc("Vault-relative path or https:// URL. Fills the footer band as a background banner.")
      .addText((t) =>
        t.setPlaceholder("assets/footer-banner.png").setValue(s.footerImagePath)
         .onChange((v) => { s.footerImagePath = v; void this.markDirty(); }),
      );
    numberSetting("Image left/right margin (px)", "footerImageMargin", 0, "Insets the banner from the left and right page edges.");
    new Setting(containerEl).setName("Show page numbers").addToggle((t) =>
      t.setValue(s.showPageNumbers).onChange((v) => { s.showPageNumbers = v; void this.markDirty(); }),
    );
    new Setting(containerEl).setName("Page number position").addDropdown((d) =>
      d.addOptions({ left: "Left", center: "Center", right: "Right" })
       .setValue(s.pageNumberPosition)
       .onChange((v) => { s.pageNumberPosition = v as "left"|"center"|"right"; void this.markDirty(); }),
    );
    new Setting(containerEl)
      .setName("Page number format")
      .setDesc("Use {{page_current}} and {{page_total}} as placeholders, e.g. \"Page {{page_current}} of {{page_total}}\", \"{{page_current}}/{{page_total}}\", or just \"{{page_current}}\".")
      .addText((t) =>
        t.setPlaceholder("{{page_current}} / {{page_total}}").setValue(s.pageNumberFormat)
         .onChange((v) => { s.pageNumberFormat = v; void this.markDirty(); }),
      );
    new Setting(containerEl)
      .setName("Page number start")
      .setDesc("Number assigned to the first visible page number.")
      .addText((t) =>
        t.setValue(String(s.pageNumberStart))
         .onChange((v) => { s.pageNumberStart = parseInt(v, 10) || 1; void this.markDirty(); }),
      );

    // ── 9. Behaviour ──────────────────────────────────────────────────────────
    new Setting(containerEl).setName("Behaviour").setHeading();
    new Setting(containerEl)
      .setName("Hide frontmatter")
      .setDesc("Strip the YAML frontmatter block (--- … ---) from the preview and exported PDF.")
      .addToggle((t) =>
        t.setValue(s.hideFrontmatter).onChange((v) => { s.hideFrontmatter = v; void this.markDirty(); }),
      );
    new Setting(containerEl)
      .setName("Include file name as title")
      .setDesc("Prepend the note's file name as an H1 heading at the top of the PDF.")
      .addToggle((t) =>
        t.setValue(s.includeFilenameAsTitle).onChange((v) => { s.includeFilenameAsTitle = v; void this.markDirty(); }),
      );
    new Setting(containerEl)
      .setName("Underline links")
      .setDesc("Applies to both internal and external links.")
      .addToggle((t) =>
        t.setValue(s.linkUnderline).onChange((v) => { s.linkUnderline = v; void this.markDirty(); }),
      );
    new Setting(containerEl).setName("Auto page break before H1").addToggle((t) =>
      t.setValue(s.autoBreakH1).onChange((v) => { s.autoBreakH1 = v; void this.markDirty(); }),
    );
    new Setting(containerEl).setName("Auto page break before H2").addToggle((t) =>
      t.setValue(s.autoBreakH2).onChange((v) => { s.autoBreakH2 = v; void this.markDirty(); }),
    );
    new Setting(containerEl).setName("H1 bottom border").addToggle((t) =>
      t.setValue(s.h1BorderBottom).onChange((v) => { s.h1BorderBottom = v; void this.markDirty(); }),
    );
    new Setting(containerEl).setName("H2 bottom border").addToggle((t) =>
      t.setValue(s.h2BorderBottom).onChange((v) => { s.h2BorderBottom = v; void this.markDirty(); }),
    );
    new Setting(containerEl).setName("Center H1").addToggle((t) =>
      t.setValue(s.centerH1).onChange((v) => { s.centerH1 = v; void this.markDirty(); }),
    );
    new Setting(containerEl).setName("Striped table rows").addToggle((t) =>
      t.setValue(s.tableStriped).onChange((v) => { s.tableStriped = v; void this.markDirty(); }),
    );
    new Setting(containerEl)
      .setName("Include PDF outline (bookmarks)")
      .setDesc(
        "Embeds a bookmark tree into the exported PDF. " +
        "Most PDF readers display it in a side panel for quick navigation.",
      )
      .addToggle((t) =>
        t.setValue(s.includeOutline).onChange((v) => { s.includeOutline = v; void this.markDirty(); }),
      );
  }
}
