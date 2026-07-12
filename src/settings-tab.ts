// ─────────────────────────────────────────────────────────────────────────────
// Plugin settings tab (Settings → Advanced PDF Export).
//
// One long, linear form grouped into the same sections shown in the README
// (Style Preset, Page, Margin & Frame, Typography, Background, Colors,
// Header, Footer, Behaviour). Kept separate from export-modal.ts: this is a
// different UI surface (global defaults vs. a single export session) that
// doesn't share rendering logic with the modal, only the settings object.
// ─────────────────────────────────────────────────────────────────────────────

import { App, PluginSettingTab, Setting } from "obsidian";
import type MarkdownPDFPlugin from "./main";
import { PAGE_SIZES, PRESETS, PDFExportSettings } from "./settings";
import { CODE_THEMES } from "./css-builder";

export class PDFExportSettingTab extends PluginSettingTab {
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
      .setDesc("Use {{current}} and {{total}} as placeholders, e.g. \"Page {{current}} of {{total}}\", \"{{current}}/{{total}}\", or just \"{{current}}\".")
      .addText((t) =>
        t.setPlaceholder("{{current}} / {{total}}").setValue(s.pageNumberFormat)
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
