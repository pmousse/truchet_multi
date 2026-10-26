# TRUCHET STUDIO — SESSION HANDOFF (read this first in the new session)

Project dir: `D:/_truchet`  (git repo, commit `a7d71e0` is latest)

## What this project is
Single-file HTML app faithfully reimplementing Christopher Carlson's
Multi-Scale Truchet Patterns (christophercarlson.com). Vanilla JS + canvas.
Plan: 5 tabs (Generator, Fill, Photo, Composer, Mandala) on one engine.

## Status
- ENGINE (`src/engine.js`) = literal port of Carlson's Wolfram package
  (`mstp/MultiScaleTruchetPatterns.wl`). Validated against Python oracle
  `dev/port.py` via `dev/gold.json` — `node dev/check_gold.js` → 24/24 PASS.
- UI Phase 1d built: `index.html` (dev page) + `src/app.js` (Generator tab:
  seed, 5 tiling types, 24-motif picker grid, palettes, PNG export,
  URL-hash share state). `node build.js` → `dist/truchet.html` (single file).
- OPEN ISSUE: user reports Generator/motif previews STILL show bad shapes
  after the fill-rule fix (see below). User says: "no it doesn't work,
  same issue in the 'motifs'". NOT YET VISUALLY VERIFIED IN A BROWSER —
  the new session (VS Code + browser/screenshot access) must verify live.

## The shape bug — what we know so far
User annotated `dev/motifs_red.jpg`: flagged tiles are yn, ye, ys, yw,
anw, ane, asw (and the selected asw). Symptom: white slits / curved-triangle
holes inside tiles, "broken lens" segments, pattern bleeding off canvas edge.

### Fix attempt 1 (committed a7d71e0, user says STILL BROKEN)
1. Fill rule: circuit polygons self-overlap on ~8 tiles; even-odd fill carved
   white holes. Changed `ctx.fill('evenodd')` → `ctx.fill()` (nonzero) in
   `traceTilePolygons` (src/engine.js ~line 387), and `dev/port.py` fill_poly
   → nonzero-winding. Python-rendered tiles now look clean
   (`flag_sheet.png`, `ours_nonzero_sheet_x2.png`) and match Carlson's style.
2. fitTransform wing margin s/4 → s/3 +2% (wing extent measured = exactly s/3).

### WHY the browser may still show the bug — CHECK THESE FIRST in new session
1. **Stale file**: user must open rebuilt `dist/truchet.html` (rebuilt by
   `node build.js`) or hard-refresh `index.html` (Ctrl+F5). `index.html` loads
   `src/engine.js` directly. A cached page would still show even-odd rendering.
   Verify: DevTools console → `Truchet` exists? Then evaluate a probe.
2. **Nonzero winding may NOT be Carlson's semantics after all.** My evidence
   was visual cell-matching vs Carlson's motifs.png. But the white trefoil
   hole ALSO appears in some of Carlson's own published tilings
   (enclosed white comps detected in `ref_mstp_full.png`). The true semantics
   of Mathematica's `Polygon` for self-intersecting circuits were never proven.
   With browser/screenshots this can finally be settled empirically.
3. Alternative hypothesis not yet tested: arcs sampling (`sampleArc`,
   0.5° polyline steps) + separate subpaths per circuit. Overlapping SAME-color
   subpaths inside one `ctx.fill()` call: nonzero winding fills union ONLY if
   overlap winding numbers have same sign; opposite-direction overlaps CANCEL
   → white holes even with nonzero. FIX CANDIDATE: draw each circuit twice
   (or fill per-circuit separately with a plain paint, never relying on
   composite winding) OR split circuits so subpaths never self-overlap.
   Try: per-circuit `beginPath(); fill()` (already the case — one fill per
   circuit) so winding cancels only WITHIN one self-overlapping circuit.
   For yn hexagon circuit [4,7,8,5,6,3] the trefoil overlaps are same-sign
   (winding 2) → should fill... verify with an isolated browser test page.
4. Wing-erasing race (earlier hypothesis): engine paints tiles depth-first;
   a later tile's white circuit polygons could paint over an earlier neighbor's
   black wings. Engine does NOT paint per-tile background rects, so probably
   fine — but confirm with a tn-grid screenshot.

### Definitive verification method (needs browser — the whole point of the switch)
- Open `dev/test.html` or `index.html`, screenshot the motif grid.
- Pixel-diff screenshots vs Python oracle: `python dev/diff_canvas.py`
  (maps canvas px ↔ world coords; supports 1/2/4-bit palette PNGs).
- Side-by-side vs Carlson's published cells: use the binary cell-matcher
  `dbg_match3.py` (root) → compares a figure's grid cells vs renders of all
  24 names (best-match per cell). Run it on a screenshot of our motif grid
  and on Carlson's `ref_motifs_big.png` and compare the two match lists.

## Key files
- `src/engine.js` — frozen-geometry engine (24 connection sets, circuits, arcs,
  sampleArc polylines, renderTiling, fitTransform, PALETTES, tilings:
  checkerboardTiling(n), gridTiling(rows,cols), randomSubdivision(random,n,maxDepth),
  surroundTiling(n), offsetSurroundTiling(m,n), fillTiling(...)).
  window.Truchet export fix is in.
- `src/app.js` — Generator UI. Motif previews: 88×88 canvas per tile,
  `T.fitTransform(cx,[{x:0,y:0,s:1}],88,88,0.04)` + `T.renderTiling` single tile.
  NOTE: single tile at s=1 with wings extending ±1/3 → fitTransform padding
  0.04 → wings are inside viewport now (margin fix), previews should show full
  wings; if user's grid shows cropped/zoomed tiles that's because fitTransform
  now zooms to the wing-bounded box (tile content looks smaller). Consider
  padding/zoom tuning for previews: maybe previews look "wrong" simply due to
  framing, not shapes!!  <-- ALSO CHECK THIS: compare old vs new preview scale.
- `src/style.css`, `index.html`, `build.js`, `dist/truchet.html` (34.7KB).
- `dev/port.py` — Python oracle (fill_poly now nonzero default).
  `dev/gold.json`, `dev/check_gold.js`, `dev/density_ramp.json`,
  `dev/seedrand.py` (JS mulberry32/seedFromString ↔ Python identical),
  `dev/diff_canvas.py`, `dev/zoom.py` (PNG read/write, palette-capable),
  `dev/render_refs.py` (ref2_*.png), `dev/render_flagged.py` (flag_sheet.png),
  `dev/test.html`, user screenshots `dev/motifs.jpg`, `dev/motifs_red.jpg`,
  `dev/studio1.jpg`, `dev/test1-4.jpg`.
- Carlson refs on disk: `ref_motifs_big.png` (his 15 motif cells, 428×262,
  8-bit palette), `ref_mstp_full.png` (419×419 main figure), `ref_tilingexamples.png`,
  `ref2_*.png`, `ref3_*.png`, `ours_nonzero_sheet_x2.png`, `flag_sheet.png`.
- Carlson source: `mstp/MultiScaleTruchetPatterns.wl` (+ .nb examples;
  notebook renders all 24 named tiles on LightGray rect {-0.5,-0.5}..{1.5,1.5},
  ImageSize 50 — no cached outputs in the .nb).
- `dbg_tile.py`, `dbg_match3.py` (root) — working tools: render one tile
  gray-style; binary best-match of grid-cells vs our 24 renders.

## Critical engine facts (do not change geometry)
- 8 points/side-pair layout: S:1,2 (x=1/3,2/3), E:3,4, N:6,5, W:7,8. math y-up,
  canvas y-flip via ctx.scale(s,-s) in fitTransform. CONFIRMED vs Carlson figure.
- 24 connection sets (NAMED_TILES order 1..24): '+.', fnw, fne, yn, tn, '-',
  fse, '/', 'ye', anw, p, ys, te, ase, '|', '+', yw, ane, 'x.', ts, tw, asw,
  fsw, '\\'.
- traceCircuits → circuits; color: circuit[0] odd → white(under), even → black(on top).
  Draw all white circuits first, then black. Circuits may REUSE points (not a
  partition) — overlap semantics is THE open question.
- Arcs: Fork B exact ellipse quarter-arcs, center = tangent-line intersection,
  sampled polylines (NO ctx.arc/ellipse). Tangent sign alternates per circuit node.
- renderTiling: sort big tiles first; parity invert at odd depth; per-depth
  palette function allowed.
- Seeds: base36 token, mulberry32; state in URL hash. Export filename encodes
  params (no watermark).

## Next actions for the new (browser-equipped) session
1. Serve/open `index.html`; screenshot the motif grid + a tn checkerboard
   pattern. Compare against `flag_sheet.png` / `ours_nonzero_sheet_x2.png`.
2. If grid still shows holes: it's browser-side — then instrument a single
   yn tile render in DevTools: log circuits + winding, try variants
   (nonzero vs evenodd vs paint-per-circuit vs circuit-arc-order changes)
   and screenshot each. Decide which matches Carlson's published look.
3. Also check preview FRAMING: fitTransform s/3 margin may now make single-tile
   previews zoom out / clip differently than the user expects.
4. Once motif grid matches Carlson visually → re-verify full patterns with
   `dev/diff_canvas.py` against port.py renders → commit → Phase 2
   (Fill + Photo tabs).

## User preferences
Faithful port, not stylized. Single-file HTML, vanilla JS, no deps. Dark
chrome, gallery-first canvas. Credit Carlson (Bridges 2018). Export PNG
1K/2K/4K + custom, filename-encoded params, no watermark. Photo modes (4) and
tabs plan already approved (see README.md).
