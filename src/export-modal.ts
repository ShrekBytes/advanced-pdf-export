// ─────────────────────────────────────────────────────────────────────────────
// Export panel modal: UI, render orchestration, live preview, and PDF export.
//
// drawPreview() and exportPDF() intentionally live in the same file: they
// build the *same* page structure (background → header banner → header text
// → content → footer banner → footer text → frame) from the same
// LayoutCache, just into two different targets — a live shadow-DOM preview
// vs. an HTML string handed to Electron's print pipeline. Keeping them
// together means a layout change only needs to be made once, in one place.
// ─────────────────────────────────────────────────────────────────────────────

import {
  App, Component, MarkdownView, Modal, Notice, TFile, setIcon,
} from "obsidian";
import type MarkdownPDFPlugin from "./main";
import { PAGE_SIZES, PRESETS, PDFExportSettings } from "./settings";
import {
  mmToPx, resolvePageDims, escapeHTML, escapeCSSForStyle, resolveImageUrl,
  bgImageCssProps, buildDocCSS, resolveFont, getMathJaxCSS, stripAtFontFaces,
  getMathJaxCSSInlined, waitForMathJaxStylesheetStable,
} from "./css-builder";
import {
  normalizeMarkdown, stripFrontmatter, splitMarkdownSections, isRTLContent,
  renderMarkdownToEl,
} from "./markdown";
import {
  paginateEl, buildPageLayouts, extractOutlineEntries, injectPDFOutline, PageLayout,
} from "./paginator";

// ─── Electron type shims ────────────────────────────────────────────────────────
// Minimal shims — just enough for the PDF export path below.

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

interface AppWithSettings {
  setting?: {
    open?: () => void;
    openTabById?: (id: string) => void;
  };
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

// ─── Header / footer / frame rendering helpers ───────────────────────────────
// Shared by drawPreview (DOM) and exportPDF (HTML string) below.

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
  const frame = createDiv();
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
    const span = createSpan();
    span.className = "mpdf-hf-center";
    span.textContent = center;
    container.appendChild(span);
  } else {
    const leftSpan = createSpan();
    leftSpan.textContent = left;
    container.appendChild(leftSpan);
    const rightSpan = createSpan();
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

export class PDFExportModal extends Modal {
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
    const pageSheet = new (activeWindow as unknown as typeof window).CSSStyleSheet();
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
      const shadowHost = createDiv();
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
          const bgEl = createDiv();
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
          const bannerEl = createDiv();
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
        const hdr = createDiv();
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
      const contentDiv = createDiv();
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
          const bannerEl = createDiv();
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
        const footer = createDiv();
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
