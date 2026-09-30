// ─────────────────────────────────────────────────────────────────────────────
// Release notes window.
//
// One render, two callers: the popup after an update passes just the entry for
// the version that was installed, and the Settings button passes the full
// capped history. The modal renders whatever it's handed and makes no decision
// about which entries those are — that lives in changelog.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { App, Modal } from "obsidian";
import type MarkdownPDFPlugin from "./main";
import type { ReleaseEntry } from "./changelog";

export class ReleaseNotesModal extends Modal {
  private readonly plugin: MarkdownPDFPlugin;
  private readonly entries: ReleaseEntry[];
  private readonly titleText: string;

  /** `titleText` names the window for the caller's context ("Advanced PDF Export
   *  4.7.0" for a single update, "What's new" for the full history). */
  constructor(app: App, plugin: MarkdownPDFPlugin, entries: ReleaseEntry[], titleText: string) {
    super(app);
    this.plugin = plugin;
    this.entries = entries;
    this.titleText = titleText;
  }

  onClose() {
    // Released on close so the next window can replace this one, and so
    // onunload() doesn't close a window the user already dismissed.
    if (this.plugin.activeNotesModal === this) this.plugin.activeNotesModal = null;
  }

  onOpen() {
    this.modalEl.addClass("mpdf-notes-modal");
    this.setTitle(this.titleText);
    this.contentEl.empty();

    const list = this.contentEl.createDiv({ cls: "mpdf-notes" });

    for (const entry of this.entries) {
      const block = list.createDiv({ cls: "mpdf-notes-entry" });

      const head = block.createDiv({ cls: "mpdf-notes-head" });
      head.createDiv({ cls: "mpdf-notes-version", text: entry.version });
      head.createDiv({ cls: "mpdf-notes-date", text: entry.date });

      if (entry.changes.length === 0) {
        // A release can be an internal refactor with nothing to report. Say so
        // rather than leaving an empty heading — the entry's existence is the
        // signal that the release was considered, not that it changed anything.
        block.createDiv({ cls: "mpdf-notes-empty", text: "No user-facing changes." });
        continue;
      }

      const ul = block.createEl("ul", { cls: "mpdf-notes-list" });
      for (const change of entry.changes) {
        ul.createEl("li", { text: change });
      }
    }
  }
}
