import { describe, it, expect, vi } from "vitest";
import type { SettingDefinitionGroup, SettingDefinitionRender, SettingDefinitionControl } from "obsidian";
import { App } from "obsidian";
import { PDFExportSettingTab } from "./settings-tab";
import { CALLOUT_COLOR_KEYS, DEFAULT_SETTINGS } from "./settings";
import type MarkdownPDFPlugin from "./main";

interface CapturedButton {
  text: string;
  onClick?: () => void;
}

function isGroup(item: unknown): item is SettingDefinitionGroup {
  return typeof item === "object" && item !== null && (item as { type?: string }).type === "group";
}

function isVisible(pred: boolean | (() => boolean) | undefined): boolean {
  if (pred === undefined) return true;
  return typeof pred === "function" ? pred() : pred;
}

function makeTab(overrides: Partial<typeof DEFAULT_SETTINGS> = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...overrides };
  const plugin = {
    settings,
    activeModal: null as { render: (immediate?: boolean) => void } | null,
    saveSettings: vi.fn().mockResolvedValue(undefined),
    resetCalloutColors: vi.fn(),
    resetPresetColors: vi.fn(),
    applyPreset: vi.fn(),
    openReleaseNotes: vi.fn(),
  } as unknown as MarkdownPDFPlugin;
  const tab = new PDFExportSettingTab(new App(), plugin);
  return { tab, plugin, settings };
}

function renderPaletteButtons(paletteRow: SettingDefinitionRender): CapturedButton[] {
  const buttons: CapturedButton[] = [];
  const fakeSetting = {
    addButton(cb: (btn: unknown) => void) {
      const state: CapturedButton = { text: "" };
      const btn = {
        setButtonText(t: string) {
          state.text = t;
          return btn;
        },
        setTooltip() {
          return btn;
        },
        onClick(fn: () => void) {
          state.onClick = fn;
          return btn;
        },
      };
      cb(btn);
      buttons.push(state);
      return fakeSetting;
    },
  };
  paletteRow.render(fakeSetting as never, {} as never);
  return buttons;
}

describe("PDFExportSettingTab callout accordion", () => {
  it("places callout controls inside Colors with no separate Callouts group", () => {
    const { tab } = makeTab();
    const defs = tab.getSettingDefinitions();
    const groups = defs.filter(isGroup);

    expect(groups.find((g) => g.heading === "Callouts")).toBeUndefined();

    const colorsGroup = groups.find((g) => g.heading === "Colors");
    expect(colorsGroup).toBeDefined();
    const items = colorsGroup!.items ?? [];

    const toggleItem = items.find((i) => i.name === "Custom callout colors") as SettingDefinitionControl | undefined;
    expect(toggleItem?.control).toEqual({ type: "toggle", key: "useCalloutColors" });

    const paletteItem = items.find((i) => i.name === "Callout color palette");
    expect(paletteItem).toBeDefined();

    const calloutControls = items.filter(
      (i): i is SettingDefinitionControl =>
        "control" in i && i.control !== undefined && CALLOUT_COLOR_KEYS.includes(i.control.key as (typeof CALLOUT_COLOR_KEYS)[number]),
    );
    expect(calloutControls).toHaveLength(CALLOUT_COLOR_KEYS.length);
  });

  it("keeps the 11 callout pickers hidden until useCalloutColors is on and Show colors is clicked", () => {
    const { tab } = makeTab({ useCalloutColors: false });
    const colorsGroup = tab.getSettingDefinitions().filter(isGroup).find((g) => g.heading === "Colors")!;
    const items = colorsGroup.items ?? [];
    const paletteItem = items.find((i) => i.name === "Callout color palette") as SettingDefinitionRender;
    const calloutPickers = items.filter(
      (i): i is SettingDefinitionControl =>
        "control" in i && i.control !== undefined && CALLOUT_COLOR_KEYS.includes(i.control.key as (typeof CALLOUT_COLOR_KEYS)[number]),
    );

    // Off: palette row and all 11 pickers are hidden.
    expect(isVisible(paletteItem.visible)).toBe(false);
    expect(calloutPickers.every((p) => !isVisible(p.visible))).toBe(true);

    // Toggle on: palette row appears, pickers remain collapsed until Show colors is clicked.
    tab.setControlValue("useCalloutColors", true);
    expect(isVisible(paletteItem.visible)).toBe(true);
    expect(calloutPickers.every((p) => !isVisible(p.visible))).toBe(true);

    const buttons = renderPaletteButtons(paletteItem);
    expect(buttons[0]?.text).toBe("Show colors");

    // Expand via Show colors: button text flips and all 11 pickers become visible.
    buttons[0]?.onClick?.();
    expect(buttons[0]?.text).toBe("Hide colors");
    expect(calloutPickers.every((p) => isVisible(p.visible))).toBe(true);

    // Collapse via Hide colors: all 11 pickers hide again.
    buttons[0]?.onClick?.();
    expect(buttons[0]?.text).toBe("Show colors");
    expect(calloutPickers.every((p) => !isVisible(p.visible))).toBe(true);
  });

  it("collapses the accordion on hide() and when useCalloutColors is turned off", () => {
    const { tab, plugin } = makeTab({ useCalloutColors: true });
    const colorsGroup = tab.getSettingDefinitions().filter(isGroup).find((g) => g.heading === "Colors")!;
    const items = colorsGroup.items ?? [];
    const paletteItem = items.find((i) => i.name === "Callout color palette") as SettingDefinitionRender;
    const calloutPickers = items.filter(
      (i): i is SettingDefinitionControl =>
        "control" in i && i.control !== undefined && CALLOUT_COLOR_KEYS.includes(i.control.key as (typeof CALLOUT_COLOR_KEYS)[number]),
    );

    const buttons = renderPaletteButtons(paletteItem);
    buttons[0]?.onClick?.();
    expect(calloutPickers.every((p) => isVisible(p.visible))).toBe(true);

    // Turning off useCalloutColors resets expansion and button label.
    tab.setControlValue("useCalloutColors", false);
    expect(buttons[0]?.text).toBe("Show colors");
    tab.setControlValue("useCalloutColors", true);
    expect(calloutPickers.every((p) => !isVisible(p.visible))).toBe(true);

    // Expand again, click Reset, then leave tab via hide().
    buttons[0]?.onClick?.();
    expect(calloutPickers.every((p) => isVisible(p.visible))).toBe(true);
    buttons[1]?.onClick?.();
    expect(plugin.resetCalloutColors).toHaveBeenCalledTimes(1);

    tab.hide();
    expect(calloutPickers.every((p) => !isVisible(p.visible))).toBe(true);
  });
});
