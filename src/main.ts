// ─────────────────────────────────────────────────────────────────────────────
// Plugin entry point.
//
// Thin bootstrap: registers the command/context-menu entry, owns the loaded
// settings object, and hands off to PDFExportModal (export-modal.ts) and
// PDFExportSettingTab (settings-tab.ts) for everything UI-related.
// ─────────────────────────────────────────────────────────────────────────────

import { Menu, Plugin, TFile } from "obsidian";
import {
  DocStyle, PDFExportSettings, PRESETS, DEFAULT_SETTINGS, extractDocStyle, PRESET_COLOR_KEYS,
} from "./settings";
import { PDFExportModal } from "./export-modal";
import { PDFExportSettingTab } from "./settings-tab";
import { warmUpMathJax } from "./markdown";
import { pendingRelease, releaseHistory } from "./changelog";
import { ReleaseNotesModal } from "./changelog-modal";

export default class MarkdownPDFPlugin extends Plugin {
  declare settings: PDFExportSettings;
  activeModal: PDFExportModal | null = null;
  activeNotesModal: ReleaseNotesModal | null = null;
  presetSnapshots: Record<string, DocStyle> = {};
  /** The last version whose release notes were shown. Persisted beside the
   *  settings; undefined until the plugin has shown notes for some version. */
  lastSeenVersion: string | undefined;

  async onload() {
    await this.loadSettings();
    // Deferred past startup: opening a window from onload races Obsidian's own
    // layout work, which leaves the notes behind a half-built workspace.
    this.app.workspace.onLayoutReady(() => this.showPendingReleaseNotes());
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
    this.activeNotesModal?.close();
  }

  openModal(file?: TFile) {
    if (this.activeModal) this.activeModal.close();
    new PDFExportModal(this.app, this, file).open();
  }

  /** Opens the full release-notes history. Backs the Settings button.
   *  Replaces any notes window already open, matching openModal() above. */
  openReleaseNotes(): void {
    this.activeNotesModal?.close();
    this.activeNotesModal = new ReleaseNotesModal(this.app, this, releaseHistory(), "What's new");
    this.activeNotesModal.open();
  }

  /** Shows the running version's release notes once, the first time this
   *  version is seen. First install and a normal update take the same path:
   *  each shows exactly the running version's entry. */
  private showPendingReleaseNotes(): void {
    const entry = pendingRelease(this.manifest.version, this.lastSeenVersion);
    if (!entry) return;
    // Stamp before opening, so a version that arrives while the window is
    // still open can't queue a second one on the next layout-ready.
    this.lastSeenVersion = this.manifest.version;
    void this.saveSettings();
    this.activeNotesModal?.close();
    this.activeNotesModal = new ReleaseNotesModal(
      this.app, this, [entry], `Advanced PDF Export ${entry.version}`,
    );
    this.activeNotesModal.open();
  }

  async loadSettings() {
    const data = (await this.loadData() ?? {}) as Partial<PDFExportSettings> & {
      presetSnapshots?: Record<string, DocStyle>;
      lastSeenVersion?: string;
    };
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);

    // Migration: codeTheme was added per-preset; absent value adopts the active preset's default.
    if (data.codeTheme === undefined) {
      this.settings.codeTheme = PRESETS[this.settings.preset]?.codeTheme ?? DEFAULT_SETTINGS.codeTheme;
    }

    // Migration: boldColor was added per-preset; absent value keeps current body text color.
    if (data.boldColor === undefined) {
      this.settings.boldColor = this.settings.bodyColor;
    }

    // Migration: tableBorderColor was added per-preset; absent value uses accent
    // (matching the previous hardcoded th/td border: accentColor + 33 alpha).
    if (data.tableBorderColor === undefined) {
      this.settings.tableBorderColor = this.settings.accentColor;
    }

    // Migration: the default table-of-contents heading changed from "Contents".
    // A saved value equal to the old default adopts the new one; a custom
    // heading is left untouched.
    if (data.tocTitle === "Contents") {
      this.settings.tocTitle = DEFAULT_SETTINGS.tocTitle;
    }

    this.presetSnapshots = data.presetSnapshots ?? {};
    this.lastSeenVersion = data.lastSeenVersion;
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

    // Physical page on which numbering begins must be a real page.
    s.pageNumberStartPage = Math.max(1, Math.round(s.pageNumberStartPage) || 1);

    // Page-number format: fall back to default when cleared.
    if (!s.pageNumberFormat || !s.pageNumberFormat.trim()) {
      s.pageNumberFormat = DEFAULT_SETTINGS.pageNumberFormat;
    }

    // Table-of-contents depth must land on a real heading level.
    s.tocDepth = Math.min(6, Math.max(1, Math.round(s.tocDepth) || DEFAULT_SETTINGS.tocDepth));
    s.tocCompactDepth = Math.min(6, Math.max(1, Math.round(s.tocCompactDepth) || DEFAULT_SETTINGS.tocCompactDepth));

    // Table-of-contents typography must remain renderable.
    s.tocFontSize = Math.max(0.1, s.tocFontSize || DEFAULT_SETTINGS.tocFontSize);
    s.tocLineHeight = Math.max(0.5, s.tocLineHeight || DEFAULT_SETTINGS.tocLineHeight);
    s.tocCompactFontSize = Math.max(0.1, s.tocCompactFontSize || DEFAULT_SETTINGS.tocCompactFontSize);
    s.tocCompactLineHeight = Math.max(0.5, s.tocCompactLineHeight || DEFAULT_SETTINGS.tocCompactLineHeight);
    s.tocCompactLeaderLength = Math.max(0, s.tocCompactLeaderLength ?? DEFAULT_SETTINGS.tocCompactLeaderLength);
  }

  async saveSettings() {
    await this.saveData({
      ...this.settings,
      presetSnapshots: this.presetSnapshots,
      lastSeenVersion: this.lastSeenVersion,
    });
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

  /** Restores the Colors-group pickers of the active preset to PRESETS defaults.
   *  Other presets' snapshots and non-color settings are left untouched. */
  resetPresetColors(): void {
    const key = this.settings.preset;
    const p = PRESETS[key];
    if (!p) return;
    for (const k of PRESET_COLOR_KEYS) {
      this.settings[k] = p[k];
    }
    const snap = this.presetSnapshots[key];
    if (snap) {
      for (const k of PRESET_COLOR_KEYS) {
        snap[k] = p[k];
      }
    }
  }
}
