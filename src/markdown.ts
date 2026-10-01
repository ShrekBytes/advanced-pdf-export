// ─────────────────────────────────────────────────────────────────────────────
// Markdown preprocessing + render pipeline.
//
// Everything involved in turning a note's raw markdown text into clean,
// paginator-ready HTML: text-level prep (line-ending normalisation,
// frontmatter stripping, manual page-break splitting, RTL detection),
// then handing sections off to Obsidian's MarkdownRenderer and waiting out
// its async post-processors (Mermaid, MathJax) before cleaning up the result.
// ─────────────────────────────────────────────────────────────────────────────

import { App, Component, MarkdownRenderer, finishRenderMath } from "obsidian";
import { waitForMathJaxStylesheetStable } from "./css-builder";

// ─── Markdown text helpers ─────────────────────────────────────────────────────

/** Normalises line endings to LF so the rest of the pipeline never sees CRLF or CR. */
export function normalizeMarkdown(raw: string): string {
  return raw.replace(/\r\n|\r/g, "\n");
}

/** Strips an opening YAML frontmatter block (--- … ---). Input must be LF-normalised. */
export function stripFrontmatter(md: string): string {
  return md.replace(/^---[ \t]*\n[\s\S]*?\n---[ \t]*(\n|$)/, "");
}

/** Splits on `///` manual page-break markers, trimming and dropping empty sections. */
export function splitMarkdownSections(md: string): string[] {
  return md
    .split(/^\/\/\/\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Drops lines that consist of nothing but an inline `%%…%%` comment, so they
 * cost no vertical space in the PDF. Complements removeEmptyBlocks: it covers
 * the comment-only *paragraph*, while this handles the comment-only *line*
 * inside a paragraph, where Obsidian leaves a `<br>` behind rather than an
 * empty element — a shape no DOM-level pass can recognise.
 *
 * A line is a comment-only line when it begins with `%%` (up to three leading
 * spaces) and closes on the same line with nothing visible after the closing
 * `%%`. That narrow rule is what the #53 reporter hit, and keeping it narrow
 * means anything else — multi-line `%% … %%` blocks, indented deeper, or with
 * text after the closer, plus inline comments between words — renders exactly
 * as before, however Obsidian treats it. The body of a multi-line block is
 * stripped by the renderer anyway, so it needs no handling here.
 *
 * Deliberately a source-level pass: what never reaches the renderer can leave
 * nothing behind. Fenced code is tracked, so a `%%` inside ``` fences is
 * literal text and must survive. (It needs *no* per-line construct tracking:
 * a `%%` opening a fenced block is still a comment open, the close hunt skips
 * fences until the pair ends, and a line inside a fence is protected by the
 * flag set when the fence opened.)
 */
export function stripCommentLines(md: string): string {
  const out: string[] = [];
  let inFence = false;
  let fenceMarker = "";
  for (const line of md.split("\n")) {
    // Obsidian's fence test: up to three leading spaces, 3+ backticks or tildes.
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fence[1];
      } else if (fence[1][0] === fenceMarker[0] && fence[1].length >= fenceMarker.length) {
        inFence = false; // CommonMark close: same char, at least as long.
      }
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    // A comment-only line: opens with `%%`, its comment closes on this same
    // line, and nothing visible follows. Counted via split, not regex: N `%%`
    // occurrences split the line into N+1 segments, and toggling at each `%%`
    // leaves the line's tail outside the comment only when the occurrence count
    // is even — i.e. an odd segment count. The tail must also be blank. So
    // "%%comment%%" (2 occurrences, 3 segments, blank tail) drops; "%%" (a
    // multi-line block's opener) and "%%a%% text %%" (tail ends inside the
    // comment, so "a text" is visible) both stay.
    if (/^ {0,3}%%/.test(line)) {
      const segments = line.split("%%");
      if (segments.length % 2 === 1 && !segments[segments.length - 1].trim()) continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/** True when RTL script chars (Arabic, Hebrew, etc.) exceed 10 % of all
 *  alpha chars — ratio-based so mixed-script notes lean toward the majority. */
const RTL_CHARS   = /[\u0590-\u08FF\uFB1D-\uFDFD\uFE70-\uFEFC]/g;
const TOTAL_ALPHA = /[A-Za-z\u0590-\u08FF\uFB1D-\uFDFD\uFE70-\uFEFC]/g;
export function isRTLContent(text: string): boolean {
  const rtl   = (text.match(RTL_CHARS)   ?? []).length;
  const total = (text.match(TOTAL_ALPHA) ?? []).length;
  return total > 0 && rtl / total > 0.1;
}

// ─── Rendered-HTML cleanup ──────────────────────────────────────────────────────

// Pre-compiled once. String.replace() and String.matchAll() both reset a
// regex's lastIndex to 0 on each call, so module-level g-flagged constants are safe.
const SLUG_STRIP = /[^\p{L}\p{N}\s-]/gu;
const SLUG_SPACE = /\s+/g;
const SLUG_DASH  = /-+/g;

function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(SLUG_STRIP, "")
    .trim()
    .replace(SLUG_SPACE, "-")
    .replace(SLUG_DASH,  "-");
}

// Strips Obsidian-specific artefacts from rendered HTML so the output is
// clean for pagination and export: assigns stable heading IDs for anchor
// links, removes external-link decorators and copy-code buttons, force-expands
// callouts, strips top-level theme <style>/<script> injections while
// preserving styles embedded inside SVGs (mermaid stores its theme CSS there),
// and drops blocks that rendered empty (handled by removeEmptyBlocks below).
function postProcessRenderedHTML(root: HTMLElement): void {
  // Stable, deduplicated IDs so in-page anchor links work across shadow DOMs.
  const seen = new Map<string, number>();
  root.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((el) => {
    const text = el.textContent || "";
    const base = slugifyHeading(text);
    if (!base) return;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    el.id = count === 0 ? base : `${base}-${count}`;
  });

  // The external-link class triggers a ↗ icon via theme CSS — meaningless in print.
  root.querySelectorAll<HTMLAnchorElement>("a").forEach((a) => {
    a.classList.remove("external-link");

    // Rewrite anchor hrefs to match the slugified IDs assigned above,
    // covering both wikilink data-href and standard markdown anchors.
    const target = a.getAttribute("data-href") ?? a.getAttribute("href");
    if (target?.startsWith("#")) {
      a.setAttribute("href", "#" + slugifyHeading(target.slice(1)));
    }
  });

  root.querySelectorAll(".copy-code-button").forEach((el) => el.remove());

  // Force-expand callouts: remove fold controls and collapsed state.
  root.querySelectorAll<HTMLElement>(".callout").forEach((callout) => {
    callout.removeAttribute("data-callout-fold");
    callout.classList.remove("is-collapsed");
    callout.querySelectorAll(".callout-fold").forEach((el) => el.remove());
  });

  // Drop theme-injected top-level <style>/<script> nodes — they can break the
  // export <head> if they contain `</style>`, and are not needed in the PDF.
  // Styles inside <svg> are kept: mermaid embeds its theme CSS directly there.
  root.querySelectorAll("style, script").forEach((el) => {
    if (!el.closest("svg")) el.remove();
  });

  removeEmptyBlocks(root);
}

/**
 * Drops blocks that rendered empty, so the paginator never budgets vertical
 * space for them.
 *
 * Obsidian turns a line that *begins* with a `%%` comment into a block boundary
 * and then strips the comment text, leaving an empty element behind — the stray
 * blank line this exists to remove. Since every `p` carries `margin-bottom`,
 * the gap is a line box *plus* the paragraph spacing, not a hairline.
 *
 * A comment-only line that sits *inside* a paragraph (no blank lines around it)
 * is a different shape: the renderer strips the comment text and leaves an
 * orphaned `<br>` in the surviving paragraph, which no empty-block pass can
 * recognise. That case is handled upstream by stripCommentLines() dropping the
 * line from the source before rendering; this pass is the backstop for the
 * block-level ghost.
 *
 * Obsidian emits no trace of comments in the rendered HTML, so this cannot be
 * comment-specific: it drops any empty element of these kinds. `p` is the case
 * that was reported; the rest are there because each one keeps visible space or
 * chrome once its contents are gone — a `blockquote` keeps its border and
 * background, and `ul`/`ol` keep `padding-inline-start` plus a `margin-bottom`,
 * so emptying only the `li` would leave the gap behind one level up. Fenced and
 * inline code are safe by construction — they render as `pre`/`code`, which
 * always carry children or text.
 *
 * Known limitation: a callout whose only content is a comment survives, because
 * `.callout` is a `div` and so never matches this selector. Handled separately
 * it would mean trusting a DOM shape this repo cannot verify.
 */
export function removeEmptyBlocks(root: HTMLElement): void {
  // `ul`/`ol` only ever match here after every one of their `li` children has
  // already gone, since those are visited first — see the reverse pass below.
  const blocks = root.querySelectorAll("p, li, ul, ol, blockquote");

  // Reverse order, deliberately. querySelectorAll walks in pre-order, so a
  // forward pass would judge <blockquote><p></p></blockquote> while the
  // blockquote still held its <p> child, and leave the empty box behind.
  // Backwards, the inner <p> is removed first and the blockquote then qualifies
  // on the same pass. The NodeList is a static snapshot, so removing as we go is
  // safe.
  for (let i = blocks.length - 1; i >= 0; i--) {
    const el = blocks[i];
    if (!(el.textContent ?? "").trim() && el.children.length === 0) el.remove();
  }
}

// ─── Async post-processor waits ────────────────────────────────────────────────

/** Waits for mermaid code blocks to be converted to SVGs by Obsidian's post-processor.
 *  Resolves immediately if already rendered; times out per diagram after 5 s. */
async function waitForMermaidDiagrams(el: HTMLElement): Promise<void> {
  const containers = Array.from(el.querySelectorAll<HTMLElement>(".mermaid"));
  if (containers.length === 0) return;
  const TIMEOUT_MS = 5000;
  await Promise.all(
    containers.map(
      (m) =>
        new Promise<void>((resolve) => {
          if (m.querySelector("svg")) { resolve(); return; }
          const timer = window.setTimeout(() => { obs.disconnect(); resolve(); }, TIMEOUT_MS);
          const obs = new MutationObserver(() => {
            if (m.querySelector("svg")) {
              window.clearTimeout(timer);
              obs.disconnect();
              resolve();
            }
          });
          obs.observe(m, { childList: true, subtree: true });
        }),
    ),
  );
}

/** Waits for MathJax to finish typesetting `.math` spans (native math and
 *  Latex Suite equations share the same renderer).
 *
 *  `MathJax.startup.promise` is awaited first as a cheap early gate — it
 *  resolves once, at MathJax's initial boot, so it proves nothing about
 *  whether this particular render pass is finished. The real wait is a
 *  per-element `mjx-container` observer, followed by
 *  `waitForMathJaxStylesheetStable()`: MathJax's CHTML `adaptiveCSS` mode
 *  writes per-glyph rules to a shared stylesheet incrementally as new
 *  characters are encountered, and DOM insertion of `mjx-container` alone
 *  doesn't guarantee that write has landed yet. Bounded at 8s + 2.5s so a
 *  stuck render can't hang the export indefinitely. */
async function waitForMathRendering(el: HTMLElement): Promise<void> {
  const containers = Array.from(el.querySelectorAll<HTMLElement>(".math"));
  if (containers.length === 0) return;

  const mathJax = (window as unknown as {
    MathJax?: { startup?: { promise?: Promise<unknown> } };
  }).MathJax;
  if (mathJax?.startup?.promise) {
    try { await mathJax.startup.promise; } catch { /* fall through to per-element wait */ }
  }

  const TIMEOUT_MS = 8000;
  await Promise.all(
    containers
      .filter((m) => !m.querySelector("mjx-container"))
      .map(
        (m) =>
          new Promise<void>((resolve) => {
            const timer = window.setTimeout(() => { obs.disconnect(); resolve(); }, TIMEOUT_MS);
            const obs = new MutationObserver(() => {
              if (m.querySelector("mjx-container")) {
                window.clearTimeout(timer);
                obs.disconnect();
                resolve();
              }
            });
            obs.observe(m, { childList: true, subtree: true });
          }),
      ),
  );

  await waitForMathJaxStylesheetStable();
}

// ─── Render pipeline ────────────────────────────────────────────────────────────

/** Renders a markdown string to a detached HTML element via Obsidian's
 *  MarkdownRenderer, waiting for Mermaid/MathJax post-processors and web
 *  fonts to finish before returning the cleaned-up result. */
export async function renderMarkdownToEl(
  app: App,
  markdown: string,
  sourcePath: string,
  component: Component,
): Promise<HTMLElement> {
  const temp = createDiv();
  // Attached offscreen so Obsidian's async post-processors (mermaid, math) run in a real DOM context.
  temp.setCssStyles({ position: "fixed", top: "0", left: "-99999px", visibility: "hidden", pointerEvents: "none" });
  activeDocument.body.appendChild(temp);
  try {
    await MarkdownRenderer.render(app, markdown, temp, sourcePath, component);
    // Flushes Obsidian's MathJax render queue — MarkdownRenderer.render()'s own
    // promise can resolve before queued math has actually finished typesetting.
    // Bounded with a race: on a cold Obsidian session (MathJax not yet used
    // anywhere in this window), this has been observed to hang far longer than
    // expected instead of resolving, blocking the whole render indefinitely.
    // waitForMathRendering()/waitForMathJaxStylesheetStable() below are the
    // real, already-bounded correctness check regardless of whether this
    // resolves in time — so there's no harm in giving up on it early.
    const FINISH_RENDER_MATH_TIMEOUT_MS = 3000;
    try {
      let timer: number;
      await Promise.race([
        finishRenderMath().finally(() => window.clearTimeout(timer)),
        new Promise<void>((resolve) => { timer = window.setTimeout(resolve, FINISH_RENDER_MATH_TIMEOUT_MS); }),
      ]);
    } catch (err) {
      console.warn("[advanced-pdf-export] finishRenderMath failed:", err);
    }
    await waitForMermaidDiagrams(temp);
    await waitForMathRendering(temp);
    // Wait for MathJax's lazily-loaded @font-face files to arrive before we
    // clone nodes; glyphs in unloaded font ranges render as invisible characters.
    const docFonts = (activeDocument as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
    if (docFonts) {
      try { await docFonts.ready; } catch { /* non-critical */ }
    }
  } finally {
    activeDocument.body.removeChild(temp);
  }
  postProcessRenderedHTML(temp);
  return temp;
}

/** Fires MathJax's one-time cold-start boot and `adaptiveCSS` setup for the
 *  font families most often missing on a session's first real render (bold,
 *  AMS symbols, blackboard-bold, fraktur, calligraphic, sans-serif,
 *  typewriter, vector) as soon as the plugin loads, in the background —
 *  rather than paying that cost the first time the user actually renders.
 *
 *  Deliberately goes through the same `renderMarkdownToEl` pipeline used for
 *  real renders instead of calling `renderMath()`/`finishRenderMath()`
 *  directly: Obsidian only creates its global `MathJax` object lazily, the
 *  first time something is typeset through its markdown post-processor
 *  pipeline. Calling `renderMath()` directly before that has happened throws
 *  `ReferenceError: MathJax is not defined` instead of triggering the load.
 *
 *  Fire-and-forget: nothing downstream awaits this, and the real render path
 *  still verifies completion correctly on its own regardless of whether this
 *  has finished. */
export async function warmUpMathJax(app: App): Promise<void> {
  const component = new Component();
  component.load();
  try {
    await renderMarkdownToEl(
      app,
      "$\\mathbf{A}+\\mathfrak{A}+\\mathcal{A}+\\mathsf{A}+\\mathtt{A}+\\mathbb{A}+\\aleph+\\vec{v}$",
      "",
      component,
    );
  } catch (err) {
    console.warn("[advanced-pdf-export] MathJax warm-up failed (non-fatal):", err);
  } finally {
    component.unload();
  }
}
