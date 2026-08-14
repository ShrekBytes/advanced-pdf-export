// ─────────────────────────────────────────────────────────────────────────────
// Plugin entry point.
//
// Thin bootstrap: registers the command/context-menu entry, owns the loaded
// settings object, and hands off to PDFExportModal (export-modal.ts) and
// PDFExportSettingTab (settings-tab.ts) for everything UI-related.
// ─────────────────────────────────────────────────────────────────────────────

import { Menu, Plugin, TFile } from "obsidian";
import {
  DocStyle, PDFExportSettings, PRESETS, DEFAULT_SETTINGS, extractDocStyle,
} from "./settings";
import { PDFExportModal } from "./export-modal";
import { PDFExportSettingTab } from "./settings-tab";
import { warmUpMathJax } from "./markdown";

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

    // Migration: boldColor was added per-preset; absent value keeps current body text color.
    if (data.boldColor === undefined) {
      this.settings.boldColor = this.settings.bodyColor;
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
