// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestUrl } from "obsidian";
import { getMathJaxCSSInlined } from "./css-builder";

vi.mock("obsidian", async (importOriginal) => ({
  ...await importOriginal<typeof import("obsidian")>(),
  requestUrl: vi.fn(),
}));

const bytes = Uint8Array.from([1, 2, 3, 4]);
const localFetch = vi.fn<typeof fetch>();

function setCSS(css: string): void {
  const style = document.createElement("style");
  style.id = "MJX-CHTML-styles";
  style.textContent = css;
  document.head.appendChild(style);
}

describe("getMathJaxCSSInlined font resources", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    vi.stubGlobal("activeDocument", {
      head: document.head,
      baseURI: "app://obsidian.md/index.html",
      adoptedStyleSheets: [],
    });
    vi.stubGlobal("activeWindow", { fetch: localFetch });
    localFetch.mockResolvedValue(new Response(bytes));
    vi.mocked(requestUrl).mockImplementation((input) => {
      const url = typeof input === "string" ? input : input.url;
      if (!/^https?:/i.test(url)) throw new Error("Unsupported protocol");
      const response = { status: 200, headers: {}, arrayBuffer: bytes.buffer, json: {}, text: "" };
      return Object.assign(Promise.resolve(response), {
        arrayBuffer: Promise.resolve(response.arrayBuffer),
        json: Promise.resolve(response.json),
        text: Promise.resolve(response.text),
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });

  it("embeds MathJax 4 root-relative fonts through Obsidian's app protocol", async () => {
    setCSS('@font-face {font-family: MJX-TEX-N; src: url("/lib/mathjax/tex-font/chtml/woff2/mjx-tex-n.woff2")}');
    expect(await getMathJaxCSSInlined()).toContain("url('data:font/woff2;base64,AQIDBA==')");
    expect(localFetch).toHaveBeenCalledWith("app://obsidian.md/lib/mathjax/tex-font/chtml/woff2/mjx-tex-n.woff2");
    expect(requestUrl).not.toHaveBeenCalled();
  });

  it("resolves document-relative fonts", async () => {
    setCSS('@font-face {font-family: Math; src: url("lib/font.woff")}');
    expect(await getMathJaxCSSInlined()).toContain("data:font/woff;base64,AQIDBA==");
    expect(localFetch).toHaveBeenCalledWith("app://obsidian.md/lib/font.woff");
  });

  it("embeds MathJax 3 absolute app font URLs through the host window", async () => {
    const url = "app://obsidian.md/lib/mathjax/output/chtml/fonts/woff-v2/MathJax_Main-Regular.woff";
    setCSS(`@font-face {font-family: MJXTEX; src: url("${url}")}`);
    expect(await getMathJaxCSSInlined()).toContain("data:font/woff;base64,AQIDBA==");
    expect(localFetch).toHaveBeenCalledWith(url);
    expect(requestUrl).not.toHaveBeenCalled();
  });

  it("keeps CORS-free requestUrl loading for HTTP(S) fonts", async () => {
    setCSS('@font-face {font-family: Math; src: url("https://example.com/font.woff2")}');
    expect(await getMathJaxCSSInlined()).toContain("data:font/woff2;base64,AQIDBA==");
    expect(requestUrl).toHaveBeenCalledWith("https://example.com/font.woff2");
    expect(localFetch).not.toHaveBeenCalled();
  });

  it("keeps data URLs unchanged and loads duplicate fonts only once", async () => {
    setCSS('@font-face {font-family: Embedded; src: url("data:font/woff2;base64,AAAA")} '
      + '@font-face {font-family: One; src: url("/font.woff2")} '
      + '@font-face {font-family: Two; src: url("/font.woff2")}');
    const css = await getMathJaxCSSInlined();
    expect(css).toContain("data:font/woff2;base64,AAAA");
    expect(css.match(/AQIDBA==/g)).toHaveLength(2);
    expect(localFetch).toHaveBeenCalledTimes(1);
    expect(requestUrl).not.toHaveBeenCalled();
  });

  it("reports a missing local font and retains its absolute URL as fallback", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    localFetch.mockResolvedValue(new Response(null, { status: 404 }));
    setCSS('@font-face {font-family: Math; src: url("/missing.woff2")}');
    expect(await getMathJaxCSSInlined()).toContain("url('app://obsidian.md/missing.woff2')");
    expect(warn).toHaveBeenCalledWith(
      "[advanced-pdf-export] failed to inline math font:",
      "app://obsidian.md/missing.woff2", expect.any(Error),
    );
  });

  it("keeps a remote URL as fallback when requestUrl rejects", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(requestUrl).mockRejectedValue(new Error("Network unavailable"));
    setCSS('@font-face {font-family: Math; src: url("https://example.com/font.woff2")}');
    expect(await getMathJaxCSSInlined()).toContain("https://example.com/font.woff2");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("preserves a MathJax 3 absolute app URL when the host fetch rejects", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const url = "app://obsidian.md/lib/mathjax/output/chtml/fonts/woff-v2/MathJax_Main-Regular.woff";
    localFetch.mockRejectedValue(new Error("Local font unavailable"));
    setCSS(`@font-face {font-family: MJXTEX; src: url("${url}")}`);
    expect(await getMathJaxCSSInlined()).toContain(`url("${url}")`);
    expect(warn).toHaveBeenCalledWith(
      "[advanced-pdf-export] failed to inline math font:", url, expect.any(Error),
    );
    expect(requestUrl).not.toHaveBeenCalled();
  });

  it("reports an unsuccessful HTTP font response", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(requestUrl).mockResolvedValue({
      status: 404, headers: {}, arrayBuffer: new ArrayBuffer(0), json: {}, text: "",
    });
    setCSS('@font-face {font-family: Math; src: url("https://example.com/missing.woff2")}');
    expect(await getMathJaxCSSInlined()).toContain("https://example.com/missing.woff2");
    expect(warn).toHaveBeenCalledWith(
      "[advanced-pdf-export] failed to inline math font:",
      "https://example.com/missing.woff2", expect.any(Error),
    );
  });

  it("skips resource requests when there is no MathJax CSS", async () => {
    expect(await getMathJaxCSSInlined()).toBe("");
    expect(localFetch).not.toHaveBeenCalled();
    expect(requestUrl).not.toHaveBeenCalled();
  });
});
