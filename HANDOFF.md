# TRUCHET STUDIO — SESSION HANDOFF (read this first in the new session)

Project dir: `D:/_truchet`  (git repo)

## What this project is
Single-file HTML app faithfully reimplementing Christopher Carlson's
Multi-Scale Truchet Patterns (christophercarlson.com). Vanilla JS + canvas.
Plan: 5 tabs (Generator, Fill, Photo, Composer, Mandala) on one engine — the
Mandala one was built and then removed at the user's request, see below.

## Status (Generator + Photo solid; Mandala tried and removed)
- ENGINE (`src/engine.js`) = literal port of Carlson's Wolfram package
  (`mstp/MultiScaleTruchetPatterns.wl`). Validated against Python oracle
  `dev/port.py` — measured tile by tile by the gates listed under *Running the gates*.
- UI: `index.html` (dev page, loads `src/engine.js` + `src/app.js` +
  `src/photo.js` + `src/fill.js` directly) + `src/app.js`, which is a tab shell:
  a tab registers itself with `registerTab(key, def)` and supplies `motifs`,
  `ready()`, `tiles(lattice)`, `picker(tiles)`, optional
  `onShow`/`onRedraw`/`viewBounds`/`mode`/`share`. Live tabs: **Generator**,
  **Photo** and **Fill** (Composer is still a placeholder).
  `node build.js` -> `dist/truchet.html` (single file, ~113 KB: engine + app +
  photo + fill inlined).
  Always open `index.html` with a cache-buster (`?v=<commit>`) when verifying.
- Photo tab (`src/photo.js`): Carlson's quadtree multi-scale subdivision driven
  by image luminance variance, with motif choice by measured ink and cell parity
  deciding light vs dark. Gates: `python dev/_photoqa.py` -> quadtree audit
  clean, tile coverage exactly the frame area, determinism PASS, Generator<->
  Photo round trip PASS, no image data in the share link, mean tone error 0.034,
  tone correlation 0.91 against pixels sampled from the real render, and every
  multi-scale control proven to change the result by driving the real DOM control
  (read-outs are repainted from the state object, so a control with no listener
  still moves its number while the pattern sits still - that is exactly how the
  dead `detail` / `smoothness` / `contrast` wiring hid: `bindRange` was defined in
  `wireUI` and never called). `detail` is capped by geometry - tiles never split
  below PHOTO_MIN_PX device pixels in the export - so its max is now set live from
  `depthCap(lattice)` and the read-out reports the cap and the depth actually used
  instead of offering a range that does nothing.
  The image is decoded locally and never enters the hash, so a Photo link reopens
  asking for the picture again.
- Ink table (`MOTIF_INK` in `src/engine.js`) is measured, not modelled, and was
  **wrong until recently**: `dev/inktest.html` first counted dark pixels over the
  whole canvas, but `fitTransform` fits a tile *including its wings* (s/3
  overshoot), so every fraction was understated by the canvas-to-square area
  ratio and the Photo tab's tone gates failed (correlation 0.57, mean error 0.296).
  Counted inside the tile square, ink runs 0.17-0.65 plain, and the two circuit
  colour classes cover 0.98-0.99 of the square - so inverted coverage is 1 - ink
  and a tile repaints its own square rather than overlaying what is below it,
  which is what makes per-tile tone control work at all. Carlson's own renderer
  matches: `SquareArcTile` is circuits only, no ground rectangle, and
  `InvertMotif` swaps a motif's colours. An earlier `ground()` hook that filled
  odd-depth tiles with dark was therefore both unfaithful and the thing wrecking
  the composite; it is gone. `python dev/_inkqa.py` re-measures and gates the
  table plus both identities.
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
The annotated reference (now in `refs/`) flagged tiles: yn, ye, ys, yw,
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
- Open `index.html`, screenshot the motif grid.
- Pixel-diff screenshots vs Python oracle: `python dev/diff_canvas.py`
  (maps canvas px ↔ world coords; supports 1/2/4-bit palette PNGs).
- Side-by-side vs Carlson's published cells: use the binary cell-matcher
  `dbg_match3.py` (root) → compares a figure's grid cells vs renders of all
  24 names (best-match per cell). Run it on a screenshot of our motif grid
  and on Carlson's figure in `refs/` and compare the two match lists.

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
- `src/style.css`, `index.html`, `build.js`, `dist/truchet.html` (~113 KB).
- `src/photo.js` (Photo tab) and `src/fill.js` (Fill tab) - both register
  themselves through `app.registerTab`, both build pictures with
  `TR.fillTiling`, and both keep their own state object (`P` / `F`) that never
  enters the share hash. Harnesses: `dev/photoharness.js`, `dev/fillharness.js`;
  gates: `dev/_photoqa.py`, `dev/_fillqa.py` (the Fill gate also drives the
  aspect/frame cases through the real UI).
The engine exports only what something outside it actually calls. The arc
plumbing (connection points, connection sets, circuit tracing, the tile cache)
is used from inside the engine and stays private; `TILE_NAMES` and
`nameForConnIdx` are exported **only** because `dev/_tilesqa.py` requires them
through node. `clamp` is defined once, in the engine, and `app.js`, `photo.js`
and `fill.js` each alias it - they used to carry three identical private copies.
Pruning an export here is safe only after checking the gates, which read the
engine both as a module (`require`) and as text (a regex over
`const MOTIF_INK = {…};`).

- `dev/port.py` - Python oracle (`fill_poly` now nonzero default).

Tooling that exists and is worth keeping: `dev/port.py`, `dev/zoom.py` (PNG
read/write, palette-capable - imported by `_tilesqa.py` from inside a `try`, so a
grep that only looks at column 0 will miss it and a cleanup will delete a gate),
the probe pages `dev/capture.html` and `dev/inktest.html` (both are **inputs to
the gates** - `dev/_inkqa.py` and `dev/_tilesqa.py` load them) and
`dev/tiletest.html` (a manual tile-pair probe no gate uses),
`dev/_resspike.js` (read by `dev/_ressqa.py`, which injects it as a script), and
the gates `dev/_inkqa.py`, `dev/_tilesqa.py`, `dev/_appqa.py`, `dev/_fillqa.py`,
`dev/_photoqa.py`, `dev/_ressqa.py`. A gate writes its own scratch pages -
`dev/_fillpage.html`, `dev/_fillshare.html`, `dev/_photopage.html`,
`dev/_resspike.html` - and those are generated and gitignored, not hand-kept.
`dev/bench.html` was dropped.

Deleted as scratch during cleanup (all reproducible, none needed to build or
verify): the fidelity one-offs `dev/gold.json`, `dev/check_gold.js`,
`dev/density_ramp.json`, `dev/seedrand.py`, `dev/diff_canvas.py`,
`dev/render_refs.py`, `dev/render_flagged.py`, `dev/annot_check.py`,
`dev/analyze_arcs*.py`, `dev/match*.py`, `dev/grid_order.py`,
`dev/orient_test.py`, `dev/_motifs15b.py`, `dev/_fillaspect.py`,
`dev/_screenshot_match.py`, `dev/_fillrule*.py`, `dev/_cmp_tile.py`,
`dev/test.html`, `dev/bench.html`, the debug scripts at the repo root
(`dbg_*.py`, `extract_nb.py`), every `flag_*.png` / `hole*.png` / `q_mstp_*` /
`ours_*` / `or_test_*` diagnostic render, the browser captures in `dev/browse/`
(116 files, 14 MB), exported wallpapers in `dev/truchet_*.png` (including a
literal `… (1).png` download duplicate and a `m…sl-bs` one for the removed
straight tiles), `dev/studio1.*`, `dev/test1-4.jpg`, `dev/motifs*.{jpg,png}`,
`dev/another_screen.png`, `dev/browse_test_tiles.png`, five
`téléchargement*.png`, `mstp.zip`, `mstp/__MACOSX/`, and the root-level
article copies `truchet_page*.html`, `truchet_text.txt`.

Carlson's figures and the reference shots supplied for this project were **not**
deleted - they moved to `refs/`: `ref_motifs_big.png` (his 15 motif cells,
428×262, 8-bit palette), `ref_mstp_full.png` (419×419 main figure),
`ref_tilingexamples.png`, `ref_multiscaletiles2.png`, `ref_wingedtileassembly*.png`,
`ref_mixtilings_full.png`, `ref_24tiles*.png`, `carlson_motifs*.png`,
`straight_lines*.png`, `straight_from.jpg` (the straight-tile experiment the
generator no longer contains, kept because the images were supplied inputs).
Full listing: `ls refs/`.

## Published

Repo `github.com/pmousse/truchet_multi`, branch `main`, tag `v1.0.0`. Nothing in
`mstp/` or `refs/` is in it - Carlson's own files stay local.

Live page: **https://pmousse.github.io/truchet_multi/** - GitHub Pages, deploying
from `main` at `/`, which means it serves the repo's own `index.html` plus `src/`
and rebuilds on every push. No duplicate copy of the app was made for it. The
single-file build is reachable too: `.../dist/truchet.html`.

The switch, for next time. In the UI it is Settings → Pages → Deploy from a
branch → `main` → `/`. In one command, with a logged-in `gh`:

```bash
gh api -X POST repos/pmousse/truchet_multi/pages --input <<<'{"source":{"branch":"main","path":"/"},"public":true}'
```

What was checked after switching it on: the deployed page and the local page
produce screenshots that are identical pixel for pixel (0 differing values out of
4,830,000 at 1400x1150); the picker gate run on the deployed screenshot reads 0
mismatches; and the Fill tab renders there rather than showing an empty stage.

**Line endings, read this before believing dist is stale.** `core.autocrlf=true`
rewrites the working tree to CRLF while the blobs are stored LF, so `dist/truchet.html`
measures 122,311 bytes on disk (2,764 CRs) and 119,547 bytes in git and on the
site - the difference is exactly those CRs, same content. `build.js` once matched
a four-script block joined with `\n`, so a fresh Windows checkout made the match
fail silently and the build aborted with "external references remain"; matching is
tolerant now, and `.gitattributes` pins text to LF so a checkout does not depend
on each machine's git config.

## Running the gates

Run all six after any change to `src/`. Each exits non-zero on failure.

```bash
node build.js                     # regenerate dist/truchet.html

python dev/_inkqa.py              # ink fractions: engine table vs measured, 24 motifs
python dev/_tilesqa.py            # tile polygons browser-vs-oracle, pixel by pixel
python dev/_appqa.py --capture    # the 15 picker previews vs the oracle, self-shot
python dev/_fillqa.py             # Fill tab through the real app UI
python dev/_photoqa.py            # Photo tab through the real app UI
python dev/_ressqa.py             # every frame format x long edge x tab: no black stage
```

`_tilesqa.py` captures its own DOM dump and `_appqa.py --capture` takes its own
screenshot, so a fresh clone can run every gate with nothing installed beyond
Python, node and Chrome at the usual path. `dev/browse/` is created as needed.
To force a fresh dump: `python dev/_tilesqa.py --recapture`. A hand-made capture
still works - `python dev/_tilesqa.py` reuses an existing dump, and
`_appqa.py <png> [x0 y0 x1 y1]` still accepts a screenshot of any window size or
hash, e.g. one taken wider:

```bash
chrome --headless=new --window-size=1730,1010 --screenshot=D:/_truchet/dev/browse/app_qa.png file:///D:/_truchet/index.html#m=%5C
python dev/_appqa.py dev/browse/app_qa.png
```

`dev/browse/` is generated scratch and is git-ignored; deleting it between
sessions is fine, the tools recreate it.
