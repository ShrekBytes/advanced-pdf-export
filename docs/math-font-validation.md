# Math font export validation

Tested on 2026-10-09 in actual Obsidian desktop runtimes, using separate temporary
profiles and a temporary vault on Windows. The official Obsidian 1.13.7 and
1.14.4 app packages ran through the installed desktop launcher (installer
1.12.7, Electron 39.8.3 / Chromium 142.0.7444.265). These were real app-protocol
requests and PDF exports, not the mocked unit-test environment. This does not
claim coverage of every installer/Electron combination or of 1.13.0 itself.

The baseline was a production build of commit
`1013e401cef7fe45663ae65b6f1fa79bfb17806d`, the parent of the fix. Both builds used
the same settings and fixture. Generated release bundles were not used as the
comparison baseline, so unrelated bundled CSS differences cannot affect it.

## Fixture and settings

One page, A4 portrait, Academic preset, 13 px Times New Roman, preview scale 1:

```latex
$$
P_{shaft}=W_n\,\bar p\,V_s\,f\,\frac{T_H-T_C}{T_H+T_C}
$$
```

## Version scope and compatibility

| Runtime | MathJax | Font URL shape | Baseline | Fixed build |
| --- | --- | --- | --- | --- |
| Obsidian 1.13.7 | 3.2.2 | Absolute `app://obsidian.md/lib/mathjax/output/chtml/fonts/woff-v2/...` | No fonts inlined; the export window successfully loads the absolute app URLs | 22 WOFF resources inlined; same rendering |
| Obsidian 1.14.4 | 4.1.3 | Root-relative `/lib/mathjax/tex-font/chtml/woff2/...` | No fonts inlined; `MJX-TEX-ZERO` and `MJX-TEX-N` have status `error` in the export | 24 WOFF2 resources inlined; both used font families load |

Thus the inlining failure predates MathJax 4: `requestUrl` fails for both URL
shapes. The visible export regression is triggered by the root-relative URLs,
which cannot resolve from the export's blob document. MathJax 3's absolute app
URLs previously survived as a working fallback.

On 1.13.7, a direct call to the real Obsidian `requestUrl` with
`app://obsidian.md/lib/mathjax/output/chtml/fonts/woff-v2/MathJax_Zero.woff`
throws `ClientRequest only supports http: and https: protocols`. The real
`activeWindow.fetch` returns 200 and 1,368 bytes. All 22 resources returned 200.
The used families `MJXZERO`, `MJXTEX` and `MJXTEX-I` loaded in the fixed export.

An additional 1.13.7 fault-injection check rejected the source window's fetch
for that one real app font during document construction. The resulting CSS
retained the original absolute URL, emitted exactly one resource warning, and
the export window still loaded the font. The wrapper was restored immediately
after the check. This intentionally failing run is separate from the healthy
run warning counts below.

On both versions, the fixed export had no font errors or `mjx-merror` nodes;
the numerator was above the denominator. Width and height of `mjx-math`,
`mjx-frac`, `mjx-num`, `mjx-den`, `mjx-line`, `mjx-over` and `mjx-c` matched the
Panel preview exactly at the measured precision (tolerance 0.1 CSS px).

The 1.13.7 baseline and fixed one-page PDFs both rasterize at 144 dpi to the same
RGB pixel hash:

```text
c795cd38e34c52bc3f20ea969216c8104e7f1b8f4163cd78be14b00fab1d48dc
```

This checks the actual printed result as well as the DOM/font loading state.
On 1.14.4, the baseline fraction height differs from its preview by 7.234375 CSS
px; the fixed export has zero difference and uses the intended MathJax fonts.

## Export cost

Five repetitions per build/runtime, after rendering the preview and fetching
the local font resources once to verify their status and byte counts. These
are warm-resource measurements, not cold startup benchmarks. Timings use
`performance.now()` around the production modal methods. The preview layout,
MathJax initialization, save dialog and disk write are excluded. Document
construction includes the existing stylesheet stability wait. Total also
includes querying font state and formula metrics in the export window.

| Runtime / build | Embedded resources | Raw embedded font bytes | HTML bytes | PDF bytes | Build HTML median | Load window median | Print median | Total median |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1.13.7 baseline | 0 | 0 | 33,674 | 23,568 | 136.6 ms | 82.9 ms | 57.2 ms | 275.6 ms |
| 1.13.7 fixed | 22 | 328,684 | 470,589 | 23,568 | 143.0 ms | 92.7 ms | 55.7 ms | 293.1 ms |
| 1.14.4 baseline | 0 | 0 | 54,634 | 30,783 | 136.5 ms | 83.7 ms | 123.1 ms | 348.6 ms |
| 1.14.4 fixed | 24 | 303,836 | 459,108 | 24,716 | 147.4 ms | 103.9 ms | 58.6 ms | 311.8 ms |

Raw total-time samples, in ms:

| Runtime / build | Samples |
| --- | --- |
| 1.13.7 baseline | 290.8, 280.0, 275.6, 267.8, 271.0 |
| 1.13.7 fixed | 293.1, 288.1, 308.4, 292.6, 293.2 |
| 1.14.4 baseline | 335.9, 351.5, 348.6, 338.8, 350.1 |
| 1.14.4 fixed | 311.5, 303.7, 311.8, 313.1, 312.3 |

Base64 increases the temporary export HTML by 436,915 bytes (about 427 KiB) on
1.13.7 and 404,474 bytes (about 395 KiB) on 1.14.4. The final PDF does not copy
all of the base64 CSS: PDF size is unchanged on 1.13.7 and decreases by 6,067
bytes on 1.14.4, where the baseline used fallback fonts.

There is measurable HTML construction/window loading overhead. In this fixture,
the total median increases by 17.5 ms on 1.13.7. The lower 1.14.4 total should
not be generalized as a speed improvement: its baseline is rendering with
failed fonts. These small local samples are not a performance guarantee for
other documents or machines. Font inlining remains concurrent and deduplicated
within each export; this change adds no persistent font cache or subsetting.

Captured source-window `console.warn` calls during all five healthy document construction /
export repetitions: **zero on both versions**. No font faces had status `error`
in the fixed export; unused declared faces remained `unloaded`, as expected.

## Why retain two fetch paths?

Obsidian's [official API declaration](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts)
documents `requestUrl` as an HTTP/HTTPS request without CORS restrictions.
Using renderer `fetch` for remote fonts would reintroduce CORS failures when
the font server does not permit the Obsidian origin.

Confirmed in the 1.13.7 runtime using an HTTP endpoint at
`http://127.0.0.1:9228/font.woff2`, returning four bytes and no
`Access-Control-Allow-Origin` header: `requestUrl` returned 200 and four bytes;
`activeWindow.fetch` threw `TypeError: Failed to fetch`. This is a transport
check; those four probe bytes are not a valid font. Local app resources take
the renderer path because `requestUrl` cannot handle that protocol.

The source now comments on this reason. Existing absolute HTTP(S) fonts retain
the same loader and status check; relative and absolute app fonts use the
source window's app protocol handler. Failed loads keep an absolute fallback.

## Repeating the runtime measurements

Use an isolated vault with the fixture named `test.md`, enable the built plugin,
select Academic, and open the file in its Panel. The following can be run in the
Obsidian developer console for either build, once the preview has settled:

```javascript
const modal = app.plugins.plugins['advanced-pdf-export'].activeModal;
const samples = [];
for (let i = 0; i < 5; i++) {
  const started = performance.now();
  const built = await modal.buildExportDocument();
  const buildMs = performance.now() - started;
  const loading = performance.now();
  const { win, url } = await modal.loadExportWindow(
    require('@electron/remote'), built.fullHTML,
  );
  const loadMs = performance.now() - loading;
  try {
    const fontState = await win.webContents.executeJavaScript(
      'document.fonts.ready.then(() => [...document.fonts].map(f => ({ family: f.family, status: f.status })))',
    );
    const printing = performance.now();
    const pdf = await win.webContents.printToPDF({
      pageSize: 'A4', printBackground: true, preferCSSPageSize: true,
      margins: { marginType: 'none' },
    });
    samples.push({
      buildMs, loadMs, printMs: performance.now() - printing,
      totalMs: performance.now() - started,
      htmlBytes: Buffer.byteLength(built.fullHTML), pdfBytes: pdf.length,
      embeddedFonts: (built.fullHTML.match(/data:font\//g) || []).length,
      fontState,
    });
  } finally {
    win.close();
    URL.revokeObjectURL(url);
  }
}
console.table(samples);
```

The recorded validation additionally measured the seven formula elements and
rasterized the PDFs with PyMuPDF. The console snippet queries font state but
omits those formula measurements, so total timings can differ slightly.

## Automated checks

- `npm test`: 170 passed, including 10 font-inlining cases. MathJax 3's real URL
  shape and its absolute fallback on rejection are explicitly covered.
- `npm run build`: type checking and production bundling passed.
- On Windows, the changelog fixture tests were run with Git `core.autocrlf=false`
  through environment configuration, preserving their expected LF checkouts.
