// @vitest-environment happy-dom

import { describe, it, expect } from "vitest";
import { removeEmptyBlocks, stripCommentLines } from "./markdown";

// These fixtures are hand-written from Obsidian's reported output shape, not
// captured from a live render — this repo cannot run Obsidian's MarkdownRenderer.
// They encode what that renderer is documented to produce: a line beginning with
// `%%` becomes a block boundary, the comment text is stripped, and the boundary
// is left behind as an empty element. What is under test is therefore the
// cleanup rule, not Obsidian's parsing.

/** Builds a detached root and hands it to the cleanup, returning the inner HTML. */
function clean(html: string): string {
  const root = document.createElement("div");
  root.innerHTML = html;
  removeEmptyBlocks(root);
  return root.innerHTML;
}

describe("removeEmptyBlocks", () => {
  it("drops the empty paragraph a comment-only line leaves behind", () => {
    // "Lorem ipsum\n%%comment%%" → one paragraph, then the stripped comment block.
    expect(clean("<p>Lorem ipsum</p><p></p>")).toBe("<p>Lorem ipsum</p>");
  });

  it("drops every empty paragraph in a run of comment-only lines", () => {
    // The case from #53: five comment lines, five blank lines in the PDF.
    expect(clean("<p>Lorem ipsum</p><p></p><p></p><p></p><p></p><p></p>"))
      .toBe("<p>Lorem ipsum</p>");
  });

  it("treats a whitespace-only block as empty", () => {
    expect(clean("<p>  \n\t </p><p>keep</p>")).toBe("<p>keep</p>");
  });

  it("collapses a blockquote left holding only an empty paragraph", () => {
    // Requires the reverse pass: the inner <p> must go before the blockquote
    // is judged, or the empty box survives.
    expect(clean("<blockquote><p></p></blockquote>")).toBe("");
  });

  it("collapses nesting deeper than one level", () => {
    expect(clean("<blockquote><blockquote><p></p></blockquote></blockquote>")).toBe("");
  });

  it("keeps a blockquote that still has content after its empty paragraph goes", () => {
    expect(clean("<blockquote><p></p><p>quoted</p></blockquote>"))
      .toBe("<blockquote><p>quoted</p></blockquote>");
  });

  it("drops an empty list item, including a tight one with no inner paragraph", () => {
    // A tight list item renders as <li></li> — no <p> for a p-only rule to find.
    expect(clean("<ul><li>one</li><li></li><li>two</li></ul>"))
      .toBe("<ul><li>one</li><li>two</li></ul>");
  });

  it("keeps a list item whose only child is a nested list", () => {
    expect(clean("<ul><li><ul><li>child</li></ul></li></ul>"))
      .toBe("<ul><li><ul><li>child</li></ul></li></ul>");
  });

  it("drops a list left with no items, so its padding and margin go too", () => {
    // ul/ol carry padding-inline-start and margin-bottom in the doc CSS, so an
    // emptied one is itself the leftover gap.
    expect(clean("<p>before</p><ul><li></li></ul><p>after</p>"))
      .toBe("<p>before</p><p>after</p>");
    expect(clean("<ol><li></li></ol>")).toBe("");
  });

  it("drops a list item left holding only an empty paragraph and empty list", () => {
    expect(clean("<ul><li><p></p><ul></ul></li></ul>")).toBe("");
  });

  it("keeps a list that still has an item with text", () => {
    expect(clean("<ul><li></li><li>kept</li></ul>")).toBe("<ul><li>kept</li></ul>");
  });

  it("keeps a paragraph holding an element but no text of its own", () => {
    expect(clean('<p><img src="a.png"></p>')).toBe('<p><img src="a.png"></p>');
  });

  it("keeps code whose literal text happens to be comment syntax", () => {
    const html = "<pre><code>%%not a comment%%\nline</code></pre>";
    expect(clean(html)).toBe(html);
  });

  it("leaves a callout alone, since it is a div and never matches the selector", () => {
    const html = '<div class="callout"><div class="callout-title"></div>'
      + '<div class="callout-content"><p></p></div></div>';
    expect(clean(html)).toBe('<div class="callout"><div class="callout-title"></div>'
      + '<div class="callout-content"></div></div>');
  });
});

// stripCommentLines runs before rendering, so its correctness is string-level.
// The parity rule: N `%%` occurrences split a line into N+1 segments, and the
// tail sits outside the comment only when N is even (odd segment count) — and
// must then be blank for the line to qualify as comment-only.
describe("stripCommentLines", () => {
  it("drops comment-only lines inside a paragraph — the #53 report", () => {
    // Five comment lines between text lines, no blank lines anywhere: the case
    // removeEmptyBlocks missed, because each renders as an orphaned <br> inside
    // one paragraph rather than an empty <p>.
    const input = "hello test\nLorem ipsum\n%%comment%%\n%%comment%%\n%%comment%%\n%%comment%%\n%%comment%%\nasdasdas\naaa";
    expect(stripCommentLines(input)).toBe("hello test\nLorem ipsum\nasdasdas\naaa");
  });

  it("drops a comment-only paragraph line and tolerates trailing space", () => {
    expect(stripCommentLines("before\n%%comment%%  \nafter")).toBe("before\nafter");
  });

  it("keeps a multi-line %% block, which the renderer strips on its own", () => {
    const input = "before\n%%\ncomment\nalso comment\n%%\nafter";
    expect(stripCommentLines(input)).toBe(input);
  });

  it("keeps an inline comment between visible text", () => {
    expect(stripCommentLines("text %%comment%% more")).toBe("text %%comment%% more");
  });

  it("keeps a line with visible text after the closing %%", () => {
    expect(stripCommentLines("%%a%% tail")).toBe("%%a%% tail");
  });

  it("keeps a line whose tail re-opens a comment (odd %% count)", () => {
    expect(stripCommentLines("%%a%% visible %%")).toBe("%%a%% visible %%");
  });

  it("keeps lines indented four spaces or more (code block, not a comment)", () => {
    expect(stripCommentLines("    %%comment%%")).toBe("    %%comment%%");
    expect(stripCommentLines("  %%comment%%")).toBe("");
  });

  it("keeps %% inside fenced code", () => {
    expect(stripCommentLines("```\n%%comment%%\n```")).toBe("```\n%%comment%%\n```");
    expect(stripCommentLines("~~~\n%%comment%%\n~~~")).toBe("~~~\n%%comment%%\n~~~");
  });

  it("honours fence length and marker character for closing", () => {
    // A ``` run cannot close a ```` fence, and ~~~ cannot close ``` — so the
    // middle lines stay inside the fence and must survive.
    expect(stripCommentLines("````\n%%a%%\n```\n%%b%%\n````")).toBe("````\n%%a%%\n```\n%%b%%\n````");
    expect(stripCommentLines("```\n%%a%%\n~~~\n%%b%%\n```")).toBe("```\n%%a%%\n~~~\n%%b%%\n```");
  });

  it("resumes dropping after a fence closes", () => {
    expect(stripCommentLines("```\n%%a%%\n```\n%%b%%")).toBe("```\n%%a%%\n```");
  });

  it("drops an empty comment line", () => {
    expect(stripCommentLines("a\n%%%%\nb")).toBe("a\nb");
  });
});
