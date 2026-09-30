import { describe, it, expect } from "vitest";
import { pdfFileName, resolveSaveLocation } from "./save-path";

/** Stands in for FileSystemAdapter.getFullPath: maps a vault-relative folder to
 *  an absolute one, the way a real desktop vault does. Joins without doubling
 *  a separator the base path already ends in. */
const posix = (base: string) => (folder: string) => {
  const b = base.replace(/\/+$/, "");
  return folder === "" ? b : `${b}/${folder}`;
};

/** The same, for a vault whose base path uses backslashes throughout. */
const windows = (base: string) => (folder: string) => {
  const b = base.replace(/\\+$/, "");
  return folder === "" ? b : `${b}\\${folder.replace(/\//g, "\\")}`;
};

const POSIX = posix("/home/me/Vault");

// The export dialog derives its name from this on both the pre-filled and the
// fallback path, so it has to hold for a note with no file behind it too.
describe("pdfFileName", () => {
  it("appends .pdf to a note's base name", () => {
    expect(pdfFileName("xyz")).toBe("xyz.pdf");
  });

  it("does not double the extension for a note already named .pdf.md", () => {
    expect(pdfFileName("Contract.pdf")).toBe("Contract.pdf");
  });

  it("strips a trailing .pdf case-insensitively", () => {
    expect(pdfFileName("Contract.PDF")).toBe("Contract.pdf");
  });

  it("only strips a trailing .pdf, not one mid-name", () => {
    expect(pdfFileName("a.pdf.b")).toBe("a.pdf.b.pdf");
  });

  it("falls back to export.pdf when there is no note", () => {
    expect(pdfFileName(undefined) ?? "export.pdf").toBe("export.pdf");
  });

  it("returns null for a name that reduces to nothing", () => {
    expect(pdfFileName(".pdf")).toBeNull();
  });
});

describe("resolveSaveLocation", () => {
  it("puts the PDF in the note's own folder", () => {
    expect(
      resolveSaveLocation({ path: "Notes/Ideas/xyz.md", basename: "xyz" }, POSIX),
    ).toBe("/home/me/Vault/Notes/Ideas/xyz.pdf");
  });

  it("puts a vault-root note in the vault root", () => {
    // path.lastIndexOf("/") is -1 here, so the folder must not be sliced out
    // of "xyz.md" — that would yield "xyz.m".
    expect(resolveSaveLocation({ path: "xyz.md", basename: "xyz" }, POSIX)).toBe(
      "/home/me/Vault/xyz.pdf",
    );
  });

  it("keeps the note's extension out of the name", () => {
    expect(
      resolveSaveLocation({ path: "Notes/a b.md", basename: "a b" }, POSIX),
    ).toBe("/home/me/Vault/Notes/a b.pdf");
  });

  it("does not double the extension for a note already named .pdf.md", () => {
    expect(
      resolveSaveLocation({ path: "Contract.pdf.md", basename: "Contract.pdf" }, POSIX),
    ).toBe("/home/me/Vault/Contract.pdf");
  });

  it("strips a trailing .pdf case-insensitively", () => {
    expect(
      resolveSaveLocation({ path: "Contract.PDF.md", basename: "Contract.PDF" }, POSIX),
    ).toBe("/home/me/Vault/Contract.pdf");
  });

  it("joins with a backslash on Windows vaults", () => {
    // The separator comes from the base path, so a Windows vault has to stay
    // all-backslash — a mixed result here would mean the code guesses rather
    // than derives.
    expect(
      resolveSaveLocation(
        { path: "Notes/Ideas/xyz.md", basename: "xyz" },
        windows("C:\\Users\\me\\Vault"),
      ),
    ).toBe("C:\\Users\\me\\Vault\\Notes\\Ideas\\xyz.pdf");
  });

  it("tolerates a base path that already ends in a separator", () => {
    // getFullPath normalises its own output today, so this is insurance rather
    // than an observed case — but a doubled separator would produce a path the
    // dialog can't open.
    const trailing = (folder: string) =>
      folder === "" ? "/home/me/Vault/" : `/home/me/Vault/${folder}/`;
    expect(
      resolveSaveLocation({ path: "Notes/xyz.md", basename: "xyz" }, trailing),
    ).toBe("/home/me/Vault/Notes/xyz.pdf");
  });

  it("returns null when there is no source note", () => {
    expect(resolveSaveLocation(null, POSIX)).toBeNull();
  });

  it("returns null when the vault is not a local folder", () => {
    expect(
      resolveSaveLocation({ path: "Notes/xyz.md", basename: "xyz" }, () => null),
    ).toBeNull();
  });

  it("returns null when the note name reduces to nothing", () => {
    expect(resolveSaveLocation({ path: ".pdf.md", basename: ".pdf" }, POSIX)).toBeNull();
  });
});