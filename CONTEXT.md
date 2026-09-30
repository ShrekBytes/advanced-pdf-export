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

The data lives in `src/changelog.json` and the window is
`ReleaseNotesModal` — implementation names, not domain language.