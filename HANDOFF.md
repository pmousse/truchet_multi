# TRUCHET STUDIO — SESSION HANDOFF (read this first in the new session)

Project dir: `D:/_truchet`  (git repo)

## What this project is
Single-file HTML app faithfully reimplementing Christopher Carlson's
Multi-Scale Truchet Patterns (christophercarlson.com). Vanilla JS + canvas.
Plan: 5 tabs (Generator, Fill, Photo, Composer, Mandala) on one engine.

## Status (shape bug RESOLVED — picker now shows Carlson's 15 motifs)
- ENGINE (`src/engine.js`) = literal port of Carlson's Wolfram package
  (`mstp/MultiScaleTruchetPatterns.wl`). Validated against Python oracle
  `dev/port.py` via `dev/gold.json` — `node dev/check_gold.js` → 24/24 PASS.
- UI Phase 1d: `index.html` (dev page) + `src/app.js` (Generator tab: seed,
  5 tiling types, motif picker, palettes, PNG export, URL-hash share state).
  `node build.js` → `dist/truchet.html` (single file, ~37 KB).
- Motif picker = **the 15 tiles Carlson shows in motifs.png**, in his grid
  order, 4 columns + a `mix` cell (see "Which 15 tiles, measured" below).
  Verified live: `python dev/_appqa.py <app screenshot> 0 0 600 2000` → 15/15
  previews match the oracle; `python dev/_tilesqa.py` → 0 deep holes and 0
  deep extra pixels on all 24 engine tiles.
- Fill rule settled empirically: NONZERO (`ctx.fill()`, no 'evenodd').
  DevTools on the live page confirms it (`getComputedStyle`-free check:
  preview canvases are backing-store scaled by devicePixelRatio, and
  `Truchet.renderPolygons` no longer exists).

## The shape bug — history (kept for context)
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

## Browser QA toolkit (this session added it — use it, it works)
Headless Chrome is how everything gets verified now:

```
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new \
  --disable-gpu --hide-scrollbars --window-size=1200,1000 \
  --force-device-scale-factor=2 --virtual-time-budget=4000 \
  --screenshot="D:/_truchet/dev/browse/app_15.png" \
  "file:///D:/_truchet/index.html?cb=x"
python dev/_appqa.py dev/browse/app_15.png 0 0 600 2000   # 15/15 previews OK
python dev/_tilesqa.py                                    # holes / extra pixels
python dev/_motifs15b.py dev/carlson_motifs.png           # who is who in his figure
python dev/_cmp_tile.py tn                                # chrome|oracle|diff strip
```
Gotchas already paid for: `_appqa.py` finds cells by flooding the DARK panel
background (cell interiors stay unvisited, so black shapes inside a cell are
safe), samples each cell near its centre (block-averaging fails on ~40px
cells), and the oracle must be padded 0.04 to match `fitTransform`.
`port.arc_circuit_polygon(2, circ)` — pps=2 is what the engine uses; pps=5
renders different geometry and produced phantom "hole" reports.

## Which 15 tiles, measured (not guessed)
`python dev/_motifs15b.py dev/carlson_motifs.png` clusters Carlson's motifs.png
ink into 15 cells, fits one square per cell from oracle geometry (fitted size
37.5 px on an 87x90 pitch, identical for all 15) and scores IoU against all 24
names x 4 rotations. IoU 0.80-0.90, no ambiguity:

    \  /  -  |  +.  x.  +        2 diagonals, 2 bars, empty, star, plus
    fnw fne fse fsw              the four "f" tiles = fnw rotated 0/90/180/270
    tn  te  ts  tw               the four "t" tiles = tn rotated the same

Absent from his figure: the four "y" tiles (yn ye ys yw), the four "anchor"
tiles (anw ane ase asw) and `p` — exactly the eight self-overlapping tiles the
user had flagged as broken, plus `p`. They are still valid tiles in Carlson's
`SquareTileNameMapping` and stay in the engine, but the UI no longer offers
them. Engine exports `T.MOTIF_NAMES` (the 15) and `T.TILE_NAMES` (all 24);
old links selecting a removed tile fall back to `/`.

## Framing model (wallpapers + social sizes) — this session

User intent: make desktop/phone wallpapers and square social posts, and the
preview must be the picture that gets exported. Crop-free filling was the
explicit request ("if I choose landscape 4K I should see the tiles displayed in
a 3840 x 2160 canvas").

What replaced the old behaviour:

- **Old**: square tiling, then Carlson-style crop (or letterbox) to the frame.
  Tiles got cut off; grid mode kept its square 3x3 inside a wide canvas.
- **New**: the *tiling* is generated for the frame. `lattice()` returns integer
  `cols x rows` of square tiles whose ratio equals the frame ratio; the render
  scales that lattice to the canvas, so it fills edge to edge. `drawScene`
  uses cover-scaling (`Math.max`) plus `renderTiling({bounds})`; the crop path
  and `drawCropped`/`boundsOf` are gone.
- Engine builders gained a second argument: `checkerboardTiling(cols, rows)`,
  `surroundTiling(cols, rows)`, `randomSubdivision(rnd, n, maxd, seedTiles)`
  (seeded from `gridTiling(rows, cols)`). Single-argument calls still give the
  original square behaviour, so `dev/check_gold.js` and the oracle are unchanged.
- `offsetSurroundTiling(m, n)` is (rows, cols) — matching the source's
  `{i,0,n-1}` on x and `{j,0,m-1}` on y. The old app call had these swapped.
- Frame formats in `src/app.js` `FRAME_FORMATS`: 1:1, 16:9, 9:16, 21:9, 4:3,
  3:4, 3:2, 2:3, 5:4, 4:5, 2:1, 1:2, custom W x H. Long-edge presets 1K/2K/
  2.5K/4K(3840)/4K+(4096).
- Preset export sizes keep the long edge exactly at the chosen resolution
  (1K/2K/2.5K/4K = 3840/4K+ = 4096) and derive the short edge from the frame
  ratio: 16:9 at 4K is **3840 x 2160**, 1:1 at 2K is 2048 x 2048, 4:5 at 4K is
  3072 x 3840. Sub-pixel ratio residue (21:9 is the worst, ~1 px) is absorbed by
  cover scaling. Custom sizes are used verbatim; `reduceRatio()` (gcd, then
  continued-fraction convergents capped at `MAX_LATTICE_SIDE = 40`) picks the
  nearest lattice.
- `n` is now a **density multiplier slider** (`density ×1 … ×N`), not a raw tile
  count. Square tiles only tile a p:q rectangle in multiples of (p, q), so the
  lattice is (p·t) × (q·t) and the slider controls `t` directly — every step
  changes the grid. The slider's max is recomputed per format from the caps
  (`MAX_LATTICE_SIDE = 64`, `MAX_LATTICE_TILES = 5000`), so 1:1 goes to ×16,
  16:9 to ×4 (64 × 36 tiles), 21:9 to ×3, 4:5 to ×12; the value is clamped on
  format change instead of saturating silently. This replaced the old
  "tiles along the short side" field, which looked dead because values between
  multiples of q mapped to the same lattice (16:9: n = 2…13 all gave 16 × 9).
  `#frameInfo` prints e.g. `48 × 27 tiles · 3840 × 2160 px · ×3`.
- `rows`/`cols` and `offCols`/`offRows` inputs were removed (the frame ratio
  sets them). Hash keys changed: `F` (format), `rs`, `fw`, `fh`; the old
  `rows/cols/oc/or` keys are ignored by old links, which land on 1:1 — same
  output as before.
- QA note: `dev/_appqa.py` now discards non-square blobs when detecting preview
  cells, because the stage starts at the panel edge (`#stage { left:300px }`) and
  a thin strip used to be counted as a cell, shifting the index mapping.

- **Motif pool (multi-select)**: the 15 motif cells plus `mix` are clickable.
  Plain click = that motif everywhere. Ctrl/Cmd/Shift+click toggles a cell into a
  *pool*; the tiling then picks one of the pooled motifs at random per tile —
  the mix idea restricted to a chosen subset (e.g. fnw + tn only). `mix` in the
  pool means all 15. Assignment is deterministic: `seed + salt(pool)` through
  `mulberry32`, tiles keyed by `x,y,s`, so the same seed keeps the same layout
  and changing the pool re-rolls it. State is `S.motifs` (array), hashed as
  `m=a,b`; old single-motif links (`m=/`, `m=mix`) still load.

## Next actions
1. Generator rendering: nothing open. If a tile is ever reported broken, ask
   for the URL hash (copy-link encodes every parameter) or a saved screenshot
   and reproduce it headlessly — do not guess.
2. Phase 2: Fill + Photo tabs (README plan) on the same engine.
3. Possible framing follow-ups: per-format saved presets, JPEG/WebP export, and
   multi-monitor sizes (e.g. 5120 x 1440) via the custom W x H row.

## User preferences
Faithful port, not stylized. Single-file HTML, vanilla JS, no deps. Dark
chrome, gallery-first canvas. Credit Carlson (Bridges 2018). Export PNG
1K/2K/4K + custom, filename-encoded params, no watermark. Photo modes (4) and
tabs plan already approved (see README.md).
