export const DEFAULT_CSS = `\
# Default Stylings
\`\`\`css
.mpdf-doc {
  font-family: var(--fontFamily);
  font-size: var(--fontSize);
  line-height: var(--lineHeight);
  color: var(--bodyColor);
  box-sizing: border-box;
  direction: var(--textDirection);
}
.mpdf-doc *, .mpdf-doc *::before, .mpdf-doc *::after {
    box-sizing: border-box; 
}
.mpdf-doc strong, .mpdf-doc b { 
  font-weight: 700; 
  font-style: normal; 
  color: var(--boldColor); 
}
.mpdf-doc h1 strong, .mpdf-doc h1 b,
.mpdf-doc h2 strong, .mpdf-doc h2 b,
.mpdf-doc h3 strong, .mpdf-doc h3 b,
.mpdf-doc h4 strong, .mpdf-doc h4 b,
.mpdf-doc h5 strong, .mpdf-doc h5 b,
.mpdf-doc h6 strong, .mpdf-doc h6 b { 
  color: inherit; 
}
.mpdf-doc em, .mpdf-doc i { 
  font-style: italic; 
  font-weight: inherit; 
}
.mpdf-doc mark { 
  background: #ffe066;
  color: inherit; 
  padding: 0 2px; 
  border-radius: 2px;
}
.mpdf-doc del, .mpdf-doc s { 
  text-decoration: line-through; 
}
.mpdf-doc h1 {
  font-size: round(nearest, calc(22px * var(--headingScale)), 1px);
  font-weight: 700;
  color: var(--headingColor);
  margin: 0 0 round(nearest, calc(12px * var(--headingScale)), 1px);
  line-height: 1.2;
  border-bottom: var(--h1BorderBottom);
  padding-bottom: var(--h1PaddingBottom);
  text-align: var(--h1Align);
}
.mpdf-doc h2 {
  font-size: round(nearest, calc(17px * var(--headingScale)), 1px);
  font-weight: 700;
  color: var(--headingColor);
  margin: round(nearest, calc(20px * var(--headingScale)), 1px) 0 round(nearest, calc(10px * var(--headingScale)), 1px);
  border-bottom: var(--h2BorderBottom);
  padding-bottom: var(--h2PaddingBottom);
}
.mpdf-doc h3 {
  font-size: round(nearest, calc(15px * var(--headingScale)), 1px);
  font-weight: 700;
  color: var(--headingColor);
  margin: round(nearest, calc(16px * var(--headingScale)), 1px) 0 round(nearest, calc(8px * var(--headingScale)), 1px);
  letter-spacing: 0.01em;
}
.mpdf-doc h4 { 
  font-size: round(nearest, calc(13px * var(--headingScale)), 1px); 
  font-weight: 700; 
  color: var(--headingColor); 
  margin: 12px 0 6px; 
  letter-spacing: 0.04em;
  }
.mpdf-doc h5 {
  font-size: round(nearest, calc(12px * var(--headingScale)), 1px)px;
  font-weight: 600;
  color: var(--headingColor);
  margin: 10px 0 4px;
  font-style: italic; 
}
.mpdf-doc h6 { 
  font-size: round(nearest, calc(11px * var(--headingScale)), 1px);
  font-weight: 600; color: var(--bodyColor);
  margin: 8px 0 4px;
  font-style: italic;
  opacity: 0.75;
}
.mpdf-doc p { 
  margin: 0 0 var(--paragraphSpacing);
}
.mpdf-doc ul, .mpdf-doc ol {
  padding-inline-start: 1.4em;
  margin: 0 0 var(--paragraphSpacing); 
}
.mpdf-doc li {
  margin-bottom: 0.2em;
  line-height: var(--lineHeight); 
}

.mpdf-doc blockquote {
  border-inline-start: 3px solid var(--blockQuoteBorderColor);
  background: var(--blockQuoteBackground);
  padding-block: 4px;
  padding-inline: 1em 0;
  margin: var(--paragraphSpacing) 0;
  font-style: italic;
  color: var(--bodyColor)cc;
}
.mpdf-doc code {
  font-family: var(--codeFontFamily);
  font-variant-ligatures: var(--codeFontLigatures);
  font-size: var(--codeFontSize);
  background: var(--codeBackground);
  padding: 1px 4px;
  border-radius: 3px;
  color: var(--accentColor);
}
.mpdf-doc hr {
  border: none;
  border-top: 0.5px solid rgb(from var(--accentColor) r g b / .27);
  margin: calc(var(--paragraphSpacing) * 1.5) 0;
}
.mpdf-doc img { 
  max-width: 100%; 
  height: auto;
  display: block;
  margin: var(--paragraphSpacing) auto;
  border-radius: var(--imageRadius);
}
.mpdf-doc a {
  color: var(--accentColor);
  text-decoration: var(--linkUnderline);
}
/* postProcessRenderedHTML removes the external-link class, but some themes
    re-inject it at render time. This rule is cheap defense-in-depth. */
.mpdf-doc a.external-link::after {
  display: none !important;
  content: none !important;
}
/* Hide copy-code buttons that survive postProcessRenderedHTML (e.g. re-injected by themes). */
.mpdf-doc .copy-code-button {
  display: none !important;
}
.mpdf-doc table {
  width: 100%; 
  border-collapse: collapse;
  margin: 0 0 var(--paragraphSpacing); 
  font-size: 0.92em;
}
.mpdf-doc th {
  background: var(--tableHeaderBg);
  color: var(--tableHeaderTextColor);
  padding: 6px 10px;
  text-align: start;
  font-weight: 600;
  border: 0.5px solid rgb(from var(--tableBorderColor) r g b / .20);
  font-size: 0.9em;
}
.mpdf-doc td {
  padding: 5px 10px;
  border: 0.5px solid rgb(from var(--tableBorderColor) r g b / .20));
  vertical-align: top;
}
/* Markdown column alignment (:--:) arrives as an align attribute on th/td — a
    presentational hint, which the th rule above outranks, so headers lost their
    alignment. start/end mirror the attribute in RTL, as Obsidian's own table CSS
    does, keeping header and body cells on the same edge in either direction. */
.mpdf-doc th[align="left"], 
.mpdf-doc td[align="left"] {
  text-align: start;
}
.mpdf-doc th[align="center"], 
.mpdf-doc td[align="center"] {
  text-align: center;
}
.mpdf-doc th[align="right"], 
.mpdf-doc td[align="right"] {
  text-align: end;
}
.mpdf-doc tbody tr:nth-child(even) {
  background: var(--tableStriping);
}

/* Callouts — override theme styles with !important so preview and export are
  * identical regardless of the active Obsidian theme. */
.mpdf-doc .callout {
  border-inline-start: 4px solid var(--accentColor) !important;
  border-start-start-radius: 0 !important;
  border-start-end-radius: 5px !important;
  border-end-end-radius: 5px !important;
  border-end-start-radius: 0 !important;
  background: rgb(from var(--accentColor) r g b / .07) !important;
  margin: calc(var(--paragraphSpacing) * 1.2) 0 !important;
  padding: 0 !important;
  overflow: hidden !important;
  box-shadow: inset 0 0 0 1px rgb(from var(--accentColor) r g b / .13) !important;
  font-style: normal !important;
}
.mpdf-doc .callout-title {
  display: flex !important;
  align-items: center !important;
  gap: 7px !important;
  padding: 7px 12px !important;
  background: rgb(from var(--accentColor) r g b / .16) !important;
  border-bottom: 1px solid rgb(from var(--accentColor) r g b / .20) !important;
  font-family: var(--fontFamily) !important;
  font-size: 0.8em !important;
  font-weight: 800 !important;
  font-style: normal !important;
  letter-spacing: 0.08em !important;
  text-transform: uppercase !important;
  color: var(--accentColor) !important;
  line-height: 1.3 !important;
}
.mpdf-doc .callout-icon {
  display: inline-flex !important;
  align-items: center !important;
  flex-shrink: 0 !important;
  width: 15px !important;
  height: 15px !important;
  color: var(--accentColor) !important;
}
.mpdf-doc .callout-icon svg {
  width: 15px !important;
  height: 15px !important;
  stroke: var(--accentColor) !important;
  fill: none !important;
  stroke-width: 2 !important;
}
.mpdf-doc .callout-title-inner {
  flex: 1 !important;
  min-width: 0 !important;
}
.mpdf-doc .callout-fold { display: none !important; }
.mpdf-doc .callout-content {
  padding: 9px 14px !important;
  color: var(--bodyColor) !important;
  font-style: normal !important;
  background: transparent !important;
}
.mpdf-doc .callout-content > p:first-child { margin-top: 0 !important; }
.mpdf-doc .callout-content > p:last-child  { margin-bottom: 0 !important; }
/* Nested blockquotes inside callout content keep a subtler indent */
.mpdf-doc .callout-content blockquote {
  border-inline-start-color: rgb(from var(--accentColor) r g b / .40) !important;
  background: transparent !important;
}

/* Mermaid diagrams — centre the SVG and prevent it overflowing the content
  * column.  The <style> block inside the SVG is intentionally left untouched;
  * mermaid embeds its own theme CSS there. */
.mpdf-doc .mermaid {
  display: flex;
  justify-content: center;
  margin: var(--paragraphSpacing) 0;
  overflow: hidden;
}
.mpdf-doc .mermaid svg {
  max-width: 100%;
  height: auto;
  display: block;
}
\`\`\`
`