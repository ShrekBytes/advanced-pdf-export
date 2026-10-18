# Advanced PDF Export

Turns Obsidian notes into paginated, styled PDFs, using the desktop app's print
pipeline.

## Language

**Panel**:
The editing and preview surface where a PDF is prepared and exported. Opens
against a note, or on its own.
_Avoid_: modal, dialog, editor

**Source note**:
The vault note the Panel was opened for. There may be none, when content is
typed or pasted into the Panel with no note behind it.
_Avoid_: current file, active file, markdown file

**Export content**:
The markdown that gets exported — whatever is in the Panel at the time. It may
differ from the Source note as saved on disk, and is never written back.
_Avoid_: note, document

**Save location**:
The file name offered in the save prompt, and the folder that prompt opens in.
Chosen by the user; beside the Source note when there is one, a bare `export`
name when there isn't.
_Avoid_: output path, output folder, destination, current file

**Document style**:
The set of typographic and colour choices determining how the PDF looks.
_Avoid_: theme, formatting

**Style preset**:
A named, reusable snapshot of the document style, applied wholesale on
selection.
_Avoid_: preset, theme, template

**Release notes**:
The user-facing changes shipped in one version of the plugin, listed newest
first. Shown for the version you updated to after an update, and for the ten
most recent from Settings.
_Avoid_: update notes, what's new

**Table of contents**:
A contents block inserted where the author places a `{{toc}}` or
`{{toc_compact}}` marker, listing headings with the page numbers they land on
and linking each entry to its heading. The full-page form occupies whole pages
and prints the configured default heading; the compact form flows with the text
and prints a heading only when its marker supplies one. Both are visible
content, distinct from the PDF *outline* (bookmarks), which is the reader's
navigation sidebar and has no page of its own.
_Avoid_: index, outline, contents page

**Numbering start page**:
The physical page on which page numbering begins. Pages before it carry no page
number, which is how leading contents pages are excluded from the count and the
body starts at the configured first number.
_Avoid_: page offset, number offset

The data lives in `src/changelog.json` and the window is
`ReleaseNotesModal` — implementation names, not domain language.
