// ─────────────────────────────────────────────────────────────────────────────
// Plugin settings tab (Settings → Advanced PDF Export).
//
// One long, linear form grouped into the same sections shown in the README
// (Style Preset, Page, Margin & Frame, Typography, Background, Colors,
// Header, Footer, Behaviour). Kept separate from export-modal.ts: this is a
// different UI surface (global defaults vs. a single export session) that
// doesn't share rendering logic with the modal, only the settings object.
// ─────────────────────────────────────────────────────────────────────────────

import {
  App, PluginSettingTab,
  SettingDefinitionItem, SettingDefinitionControl, SettingDefinitionGroup, SettingGroupItem,
} from "obsidian";
import type MarkdownPDFPlugin from "./main";
import { PAGE_SIZES, PRESETS } from "./settings";
import { CODE_THEMES } from "./css-builder";

// Settings whose values are numbers but are edited via a curated dropdown of
// friendly labels (e.g. "Tight (1.4)") rather than a free-form number field.
// SettingDropdownControl always persists a string, so these keys need the
// value coerced on the way in and out — everything else round-trips as-is.
const NUMERIC_DROPDOWN_KEYS = new Set([
  "fontSize", "codeFontSize", "lineHeight", "paragraphSpacing", "headingScale",
  "backgroundImageOpacity",
]);

export class PDFExportSettingTab extends PluginSettingTab {
  plugin: MarkdownPDFPlugin;

  /** True when any setting changed while this tab is open; triggers a single render on hide(). */
  private dirty = false;

  constructor(app: App, plugin: MarkdownPDFPlugin) {
    super(app, plugin);
    this.plugin = plugin;
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

  // ── Declarative settings API (Obsidian 1.13+) ────────────────────────────────
  // Obsidian renders this tab from the array below instead of an imperative
  // display() method. Persistence goes through markDirty() so presetSnapshots
  // keeps being saved alongside the visible settings, and so the live preview
  // modal still re-renders on hide() exactly as it did before.

  getControlValue(key: string): unknown {
    const raw = (this.plugin.settings as unknown as Record<string, unknown>)[key];
    return NUMERIC_DROPDOWN_KEYS.has(key) ? String(raw) : raw;
  }

  setControlValue(key: string, value: unknown): void {
    const settings = this.plugin.settings as unknown as Record<string, unknown>;
    settings[key] = NUMERIC_DROPDOWN_KEYS.has(key) ? parseFloat(value as string) : value;
    void this.markDirty();
    // Cheap re-evaluation of every `visible`/`disabled` predicate below — covers
    // frameEnabled, backgroundImageEnabled, fontFamily, and pageSize all toggling
    // dependent rows, regardless of which key just changed.
    this.refreshDomState();
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const s = this.plugin.settings;

    const toggle = (name: string, key: string, desc?: string, visible?: () => boolean): SettingDefinitionControl =>
      ({ name, desc, visible, control: { type: "toggle", key } });

    const text = (
      name: string, key: string,
      opts: { desc?: string; placeholder?: string; visible?: () => boolean } = {},
    ): SettingDefinitionControl =>
      ({ name, desc: opts.desc, visible: opts.visible, control: { type: "text", key, placeholder: opts.placeholder } });

    const num = (
      name: string, key: string,
      opts: { min?: number; desc?: string; visible?: () => boolean } = {},
    ): SettingDefinitionControl =>
      ({ name, desc: opts.desc, visible: opts.visible, control: { type: "number", key, min: opts.min } });

    const color = (name: string, key: string, visible?: () => boolean): SettingDefinitionControl =>
      ({ name, visible, control: { type: "color", key } });

    const dropdown = (
      name: string, key: string, options: Record<string, string>,
      opts: { desc?: string; visible?: () => boolean } = {},
    ): SettingDefinitionControl =>
      ({ name, desc: opts.desc, visible: opts.visible, control: { type: "dropdown", key, options } });

    const group = (
      heading: string | undefined, items: SettingGroupItem[], visible?: () => boolean,
    ): SettingDefinitionGroup =>
      ({ type: "group", heading, items, visible });

    const codeThemeOptions: Record<string, string> = {};
    for (const [key, theme] of Object.entries(CODE_THEMES)) codeThemeOptions[key] = theme.name;

    const fontSizeOptions: Record<string, string> = {};
    ["10", "11", "12", "13", "14", "15", "16"].forEach((v) => { fontSizeOptions[v] = v + "px"; });

    return [
      group("Style Preset", [
        {
          name: "Preset",
          desc: "Pick a preset to configure the overall document style. Fine-tune any setting below.",
          // Rendered imperatively (dropdown + button on one row) rather than as a
          // bound `control`: selecting a preset or resetting it mutates many
          // fields at once via applyPreset(), which a single-key control can't do.
          render: (setting) => {
            const presetOpts: Record<string, string> = {};
            Object.entries(PRESETS).forEach(([k, v]) => { presetOpts[k] = v.name; });
            setting
              .addDropdown((d) =>
                d.addOptions(presetOpts).setValue(s.preset).onChange((v) => {
                  this.plugin.applyPreset(v);
                  void this.markDirty();
                  this.update();
                }),
              )
              .addButton((b) =>
                b.setButtonText("Reset Preset")
                 .setTooltip("Reset current preset to its default values")
                 .onClick(() => {
                   this.plugin.applyPreset(s.preset, true);
                   void this.markDirty();
                   this.update();
                 }),
              );
          },
        },
      ]),

      group("Page", [
        dropdown("Page size", "pageSize", { ...Object.fromEntries(Object.keys(PAGE_SIZES).map((k) => [k, k])), Custom: "Custom…" }),
        num("Custom width (mm)", "customPageWidth", { min: 10, desc: "Width in millimetres.", visible: () => s.pageSize === "Custom" }),
        num("Custom height (mm)", "customPageHeight", { min: 10, desc: "Height in millimetres.", visible: () => s.pageSize === "Custom" }),
        dropdown("Orientation", "orientation", { portrait: "Portrait", landscape: "Landscape" }),
      ]),

      group("Margin & Frame", [
        num("Margin top (mm)", "marginTop", { min: 0 }),
        num("Margin bottom (mm)", "marginBottom", { min: 0 }),
        num("Margin left (mm)", "marginLeft", { min: 0 }),
        num("Margin right (mm)", "marginRight", { min: 0 }),
        toggle("Enable frame", "frameEnabled", "Draws a border around the outer edge of every page."),
        color("Frame color", "frameColor", () => s.frameEnabled),
        num("Frame thickness (px)", "frameThickness", { min: 1, visible: () => s.frameEnabled }),
        num("Frame margin (px)", "frameMargin", {
          min: 0, desc: "Gap between the page edge and the frame, applied equally on all four sides.",
          visible: () => s.frameEnabled,
        }),
        dropdown("Frame style", "frameStyle", {
          solid: "Solid", dashed: "Dashed", dotted: "Dotted", double: "Double", groove: "Groove", ridge: "Ridge",
        }, { visible: () => s.frameEnabled }),
      ]),

      group("Typography", [
        dropdown("Font family", "fontFamily", {
          "Georgia, serif":                          "Georgia (Serif)",
          "'Times New Roman', Times, serif":         "Times New Roman",
          "'Palatino Linotype', Palatino, serif":    "Palatino",
          "Arial, sans-serif":                       "Arial",
          "'Helvetica Neue', Helvetica, sans-serif": "Helvetica",
          "'Trebuchet MS', sans-serif":              "Trebuchet",
          "'Courier New', monospace":                "Courier New",
          "__custom__":                              "Custom…",
        }),
        text("Custom font name", "customFontName", {
          desc: "CSS font-family value — e.g. \"Inter, sans-serif\". The font must be installed on your system.",
          placeholder: "e.g. Inter, sans-serif",
          visible: () => s.fontFamily === "__custom__",
        }),
        dropdown("Font size (px)", "fontSize", fontSizeOptions),
        dropdown("Code font family", "codeFontFamily", {
          "'Courier New', monospace":     "Courier New",
          "Consolas, monospace":          "Consolas",
          "Menlo, Consolas, monospace":   "Menlo",
          "Monaco, monospace":            "Monaco",
          "'Fira Code', monospace":       "Fira Code",
          "'JetBrains Mono', monospace":  "JetBrains Mono",
          "'Cascadia Code', monospace":   "Cascadia Code",
          "__custom__":                   "Custom…",
        }),
        text("Custom code font name", "customCodeFontName", {
          placeholder: "e.g. Iosevka, monospace",
          visible: () => s.codeFontFamily === "__custom__",
        }),
        dropdown("Code font size", "codeFontSize", {
          "0.75": "0.75em", "0.80": "0.80em", "0.82": "0.82em", "0.85": "0.85em", "0.88": "0.88em", "0.90": "0.90em", "1.0": "1.00em",
        }),
        toggle("Code ligatures", "codeFontLigatures"),
        dropdown("Line height", "lineHeight", {
          "1.4": "Tight (1.4)", "1.6": "Compact (1.6)", "1.75": "Normal (1.75)", "1.85": "Relaxed (1.85)", "2.0": "Double (2.0)",
        }),
        dropdown("Paragraph spacing", "paragraphSpacing", {
          "0": "None", "0.3": "Tight (0.3em)", "0.5": "Normal (0.5em)", "0.65": "Relaxed (0.65em)", "1.0": "Wide (1em)",
        }),
        dropdown("Heading scale", "headingScale", {
          "0.8": "Small (0.8×)", "0.88": "0.88×", "0.9": "Compact (0.9×)", "0.95": "0.95×",
          "1.0": "Normal (1.0×)", "1.05": "1.05×", "1.1": "Large (1.1×)", "1.2": "XLarge (1.2×)",
        }, { desc: "Multiplier applied to all heading sizes." }),
      ]),

      group("Background", [
        toggle("Use image background", "backgroundImageEnabled", "When on, a background image is used instead of the solid background color."),
        color("Page background color", "pageBackground", () => !s.backgroundImageEnabled),
        text("Background image", "backgroundImagePath", {
          desc: "Vault-relative path or https:// URL.", placeholder: "assets/background.png",
          visible: () => s.backgroundImageEnabled,
        }),
        dropdown("Fit", "backgroundImageSize", {
          cover: "Cover (fill, crop edges)", contain: "Contain (fit, show gaps)", fill: "Fill (stretch to exact size)", tile: "Tile (repeat)",
        }, { visible: () => s.backgroundImageEnabled }),
        dropdown("Scope", "backgroundImageScope", { "full-page": "Full page", "content-only": "Content area only" }, {
          desc: "Full page includes header and footer bands. Content area only restricts the background to the text zone between them.",
          visible: () => s.backgroundImageEnabled,
        }),
        dropdown("Opacity", "backgroundImageOpacity", {
          "0.05": "5%", "0.1": "10%", "0.15": "15%", "0.2": "20%", "0.3": "30%", "0.4": "40%",
          "0.5": "50%", "0.6": "60%", "0.7": "70%", "0.8": "80%", "0.9": "90%", "1": "100%",
        }, { visible: () => s.backgroundImageEnabled }),
      ]),

      group("Colors", [
        color("Accent color", "accentColor"),
        color("Body text color", "bodyColor"),
        color("Heading color", "headingColor"),
        color("Blockquote background", "blockquoteBg"),
        color("Blockquote border", "blockquoteBorderColor"),
        color("Table header background", "tableHeaderBg"),
        color("Code background", "codeBackground"),
        dropdown("Code syntax theme", "codeTheme", codeThemeOptions, {
          desc: "Independent of your Obsidian theme. \"None\" uses the body text color and code background above with no highlighting.",
        }),
      ]),

      group("Header", [
        toggle("Show header", "showHeader"),
        toggle("Show on first page", "showHeaderOnFirstPage", "When off, the header is hidden on page 1. Useful for title pages."),
        text("Header text", "headerText"),
        dropdown("Alignment", "headerAlignment", { left: "Left", center: "Center", right: "Right" }),
        num("Font size (px)", "headerFontSize", { min: 1 }),
        num("Height (px)", "headerHeight", { min: 0, desc: "Explicit band height (0 = auto)." }),
        color("Font color", "headerFontColor"),
        toggle("Border", "showHeaderBorder", "Separator line below the header."),
        text("Image", "headerImagePath", {
          desc: "Vault-relative path or https:// URL. Fills the header band as a background banner.",
          placeholder: "assets/header-banner.png",
        }),
        num("Image left/right margin (px)", "headerImageMargin", { min: 0, desc: "Insets the banner from the left and right page edges." }),
      ]),

      group("Footer", [
        toggle("Show footer", "showFooter"),
        toggle("Show on first page", "showFooterOnFirstPage", "When off, the footer and page numbers are hidden on page 1. Page numbering starts from page 2."),
        text("Footer text", "footerText"),
        dropdown("Alignment", "footerTextAlignment", { left: "Left", center: "Center", right: "Right" }),
        num("Font size (px)", "footerFontSize", { min: 1 }),
        num("Height (px)", "footerHeight", { min: 0, desc: "Explicit band height (0 = auto)." }),
        color("Font color", "footerFontColor"),
        toggle("Border", "showFooterBorder", "Separator line above the footer."),
        text("Image", "footerImagePath", {
          desc: "Vault-relative path or https:// URL. Fills the footer band as a background banner.",
          placeholder: "assets/footer-banner.png",
        }),
        num("Image left/right margin (px)", "footerImageMargin", { min: 0, desc: "Insets the banner from the left and right page edges." }),
        toggle("Show page numbers", "showPageNumbers"),
        dropdown("Page number position", "pageNumberPosition", { left: "Left", center: "Center", right: "Right" }),
        text("Page number format", "pageNumberFormat", {
          desc: "Use {{current}}, {{total}}, and {{title}} as placeholders, e.g. \"Page {{current}} of {{total}}\", \"{{title}} — {{current}}/{{total}}\", or just \"{{current}}\".",
          placeholder: "{{current}} / {{total}}",
        }),
        num("Page number start", "pageNumberStart", { min: 1, desc: "Number assigned to the first visible page number." }),
      ]),

      group("Behaviour", [
        toggle("Hide frontmatter", "hideFrontmatter", "Strip the YAML frontmatter block (--- … ---) from the preview and exported PDF."),
        toggle("Include file name as title", "includeFilenameAsTitle", "Prepend the note's file name as an H1 heading at the top of the PDF."),
        toggle("Underline links", "linkUnderline", "Applies to both internal and external links."),
        toggle("Auto page break before H1", "autoBreakH1"),
        toggle("Auto page break before H2", "autoBreakH2"),
        toggle("H1 bottom border", "h1BorderBottom"),
        toggle("H2 bottom border", "h2BorderBottom"),
        toggle("Center H1", "centerH1"),
        toggle("Striped table rows", "tableStriped"),
        toggle("Include PDF outline (bookmarks)", "includeOutline",
          "Embeds a bookmark tree into the exported PDF. Most PDF readers display it in a side panel for quick navigation."),
      ]),
    ];
  }
}
