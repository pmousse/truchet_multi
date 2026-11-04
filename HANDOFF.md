# TRUCHET STUDIO — SESSION HANDOFF (read this first in the new session)

Project dir: `D:/_truchet`  (git repo)

## What this project is
Single-file HTML app faithfully reimplementing Christopher Carlson's
Multi-Scale Truchet Patterns (christophercarlson.com). Vanilla JS + canvas.
Plan: 5 tabs (Generator, Fill, Photo, Composer, Mandala) on one engine — the
Mandala one was built and then removed at the user's request, see below.

Two bodies of work live here now, and each has its own section to read: the tile shape,
which is documented as a rule under *"How big is a tile?"* in `src/engine.js` and at
length below; and the ground the tiles sit on, which is *The ground: ten fields that move
under the tiles*.

## Status (Generator + Photo + animated ground + animated ink; Mandala tried and removed)
- ENGINE (`src/engine.js`) = literal port of Carlson's Wolfram package
  (`mstp/MultiScaleTruchetPatterns.wl`). Validated against Python oracle
  `dev/port.py` — measured tile by tile by the gates listed under *Running the gates*.
- UI: `index.html` (dev page, loads `src/engine.js` + `src/app.js` +
  `src/photo.js` + `src/fill.js` directly) + `src/app.js`, which is a tab shell:
  a tab registers itself with `registerTab(key, def)` and supplies `motifs`,
  `ready()`, `tiles(lattice)`, `picker(tiles)`, optional
  `onShow`/`onRedraw`/`viewBounds`/`mode`/`share`. Live tabs: **Generator**,
  **Photo** and **Fill** (Composer is still a placeholder).
  `node build.js` -> `dist/truchet.html` (single file, ~173 KB: engine + shaders + app +
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

## The ground: ten fields that move under the tiles

The `bg` colour became a choice: a colour, or one of ten animated fields
(`src/shaders.js`, plain WebGL, no library). The requirement came from the picture, not
from the technology: a field had to behave as one field across the whole frame, not as a
pattern repeated inside every cell. The look the user asked for is `shader.jpg`, kept at
the repo root - their reference image, untracked and not published.

**A frame, not a tiled ground.** The field is its own `<canvas>` under the tile canvas,
rendered once across the frame at the same pixel size, and `buildPalette()` makes the
under class fully transparent while a field is up - the only arrangement that lets a
field show through without the tiles' own backgrounds covering it. A canvas cannot hold a
GL context and a 2D one, so there are two canvases. Since the field is now the only thing
behind the ink, it has to be opaque, and every body ends the same way -
`gl_FragColor = vec4(finish(col), 1.0);` - because the alpha is not something a field may
choose. That was a trap: six fields were quietly see-through until something measured
coverage, and a field that leaves holes in the frame is indistinguishable from the frame
having no field at all.

**The clock is a loop, not a running total.** `ph() = u_time / u_loop * TAU`, and every
field moves on `ph()` or on noise sampled along a closed path. A loop is worth having for
one reason: a field whose motion is a whole harmonic can be *checked* - a frame at phase 0
and a frame at phase `u_loop` are compared, and drift shows up as a jump against the
ordinary step between frames. That check catches fields that drift, not fields that are
frozen, so motion is measured separately.

**The fold walks the ramp in lightness order.** The palette percentage (`sm`) folds the
field's colours onto the picture's own ramp, so a busy field cannot turn a five-colour
picture into a rainbow. The fold maps the field's own lightness onto the ramp - dark end
to light end, whichever of the two palette colours is darker - so it can recolour a field
but cannot invert it. An earlier version picked a hue by hashing lightness, which
scrambled the field's internal ordering, and `wash` - a field that paints no colours of
its own and is all lightness - came out flat because of it.

**A fold may recolour a ground; it may not invert it.** That is the claim the gate
measures: render a field with the fold off, render it with the fold on, correlate the two
per pixel. All ten fields come out at 1.00. A fold that recoloured while scrambling the
lightness ordering would still land every pixel on the ramp and correlate badly, and the
gate would say so.

**The scrim replaced the noise mask, and the reason matters.** The first version patched
ground colour back over the field through a drifting noise mask. It made pictures that
looked like the old background - which is exactly the complaint that started this - and it
dimmed towards black, which only separates a field from dark ink; with light ink it
destroys contrast. The scrim (`sr`) is uniform and pulls towards the *ground* end of the
palette, so it moves the field away from the ink whichever way the ink runs. `u_warp` is
gone from the shaders, the UI and the share key.

**Legibility is colour distance, not luminance.** All ten fields measured about a hundred
luminance units clear of the ink, and one of them - Voronoi cells, with its dark navy
patches - swallowed the edges of the dark ink blobs anyway. So the gates measure distance
to the ink as a colour: how close the nearest field colour comes, how much of the frame
gets that close, and how far the darkest five percent sits from the ink's own lightness,
since that five percent is where an ink tile actually sits. Measured now: nearest field
colour 95 to 173 units from the ink, no field matching the ink's colour anywhere, darkest
five percent 97 to 144 units clear.

**The negative pass.** A legibility gate that can never fire measures nothing, and mine
could not have fired: the shipped fields never come near the ink. So the gate also runs
against a ground given the ink's own colour, which a person can really do by typing the
ink's hex into `bg`. All ten are turned down - the fold collapses onto a ramp with both
ends the same colour, the field becomes the ink - and the gate says so out loud. A ground
that could vanish can be caught.

**The file gets the frame.** Save PNG is measured through the button a person actually
presses, by reading the canvas handed to the encoder; the download itself is stubbed, so
nothing reaches disk. Over a field: 3840x3840 for a 3840 frame, mean pixel difference 0.86
against the preview composite, luminance correlation 0.999, and 51.6% of the file in
colours the tile layer could not have produced on its own. Over a solid ground: 2.84,
0.998 and **0.0%** - the solid case is the control, and its larger pixel difference is
edge resampling, because the file is drawn at its own resolution rather than stretched.
A field measured in the preview but missing from the file could not survive that pair.

**Share keys:** `gr` (solid | shader), `sh` (field key), `ss` speed, `sc` scale, `sm`
palette %, `sr` scrim %. Opening defaults: palette 45%, scrim 45%. A default is a
legibility decision, and `python dev/_defaults.py "45/45 60/40 70/30"` is the sweep that
made it: colour left in the ground rises 56 → 69 as the scrim drops, and the closest any
field colour gets to the ink falls 95 → 62 in the same move. 45/45 keeps the widest
margin; a future change to that pair is a trade between the two columns, not a free
improvement.

**Adding a field.** A body in the `SHADERS` table in `src/shaders.js` - the shared
preamble hands it `p` in frame units, `t`, `ph()`, `frameUV()`, `cosPal()` and `fbm()` -
and it has to move on `ph()`, finish with the opaque `vec4(finish(col), 1.0)`, and not
depend on where the frame happens to start. `dev/shadertest.html` shows all ten at the
same size, clock and palette with no app around them; `dev/_fold.html` shows one field
through its own palette, which is the only comfortable place to judge what the palette
percentage does.

## The ink: the same ten fields, painted onto the strokes

`Ink` gets the ground's solid/field choice, its own field picker, its own speed and size,
and two dials of its own: **Pigment** (`ikc`, how much of the ink's own colour the field
may replace) and **Relief** (`ikr`, the ink's lightness budget, 0–100%).

A field cannot simply be painted over ink. Ink *is* the shape: mix naively and the strokes
recolour unevenly, so a class stops meaning what the tiling means. Measured that way first
— folding the field's raw colour onto ink left **9.96 % of the ink** (12 458 of 125 001 ink
pixels) within 10 luminance units of the ground, because where the field's lightness
happened to match the ink's the relief term multiplied to zero. That is precisely the
failure the feature must not have, and the gate now measures it as `camo`.

**How it is built.** Three canvases stack inside the frame:

1. `#groundCanvas` (WebGL, behind) — a field, or a flat ground colour.
2. `#mainCanvas` (2D) — the tiling drawn with the ink class *skipped* (`'noInk'` pass).
3. `#inkCanvas` (WebGL, in front) — the field, kept only where the ink mask is opaque.

The mask is the tiling rendered a third time (`buildPalette(tiles, 'mask')`) with only the
ink class painted, on a transparent canvas; it is uploaded as `u_mask`, and the ink program
keeps the field where its alpha is > 0 and discards it elsewhere. So a field can recolour
ink but cannot move it. Two traps worth naming: sampling has to flip the mask's `y`
(`1.0 - gl_FragCoord.y / u_res`) because a 2D canvas numbers rows from the top while
`gl_FragCoord` numbers them from the bottom — without it every stroke lands inverted, which
is exactly what the first run showed; and the ink context is `premultipliedAlpha: true` on
purpose, because the program writes `col * coverage` and asking the compositor to divide it
back out produces halos.

**Relief is what makes a field visible in ink.** Each pixel is anchored to the ink's own
lightness, then allowed to move only *away* from the ground, by at most
`pigment × relief × (that pixel's distance to the ground)`, scaled by the field's own
brightness: a stroke deepens where the field is bright and keeps its own lightness where the
field is dark. A field can darken ink on a light ground or thicken a light stroke on a dark
ground; it can never pull ink toward the ground, which is the one move that makes ink
vanish. `atLightness(c, L)` scales a colour and then adds the remainder flat — scaling alone
cannot reach a requested lightness for a saturated colour, which an earlier version learned
the hard way by leaving the drift far below what relief promised.

**Measured** (`dev/_inkfieldprobe.js` → `dev/_inkfieldqa.py`; 18 rows: the ten fields at
defaults, four relief sweeps, `cells` over a preset palette, `veil` as an ink field over the
`marble` ground field, `mesh` at full relief over `lava`, the black/white preset, and plain
solid ink as the control):

| What is measured | Result | Threshold |
|---|---|---|
| Shape survives — field output alpha vs the app's own mask alpha | `0.000` | 0.02 |
| That mask vs the solid ink rendering | 0.015–0.023 | 0.03 |
| Ink lost / drawn twice / drawn where it should not be / whole-canvas ink | 0, 0, 0, 0 | 0.5 % |
| Lightness budget kept — pixels over `pigment × relief × own gap` | none reported | 1 % |
| Ink invisible against the layer underneath | 0–0.28 % | 1.5 % |
| Pigment 0 % really is a pure re-light (worst field, worst channel) | 0 | 2/255 |
| Relief sweep (mesh, pigment 100, relief 0/25/50/100): mean \|ink − ground\| lightness gap | 0.7 → 14.2 → 22.4 → 29.7 (worst 3.8 → 43.3 → 64.5 → 85.4) | must grow, and stay inside budget |
| At defaults (pigment 45, relief 25): mean gap, ten fields | 2.1–7.8 (worst 8.4–17.6) | — |
| Export vs preview after a real Save PNG press | 1.1–3.1 mean over ~30 000 px | 8 |
| Export ink contrast survives the resolution change | 1.00 | > 0.9 |
| Nothing repaints between press and file (before / after) | 0.0 / 0.0 | 1.0 |
| Ink canvas alone, preview size vs export size | 0.7–1.0 per px, ≤ 0.3 % large | 3 |

The negative pass is not decorative: the mesh row rendered at pigment 100 / relief 100 is
*judged* as the shipped 45 / 25 and does report `over 8.94 %` of pixels overspending, and
that row FAILS the gate if it ever passes clean.

**Field ink is mostly lightness.** At pigment 100 / relief 0 on a black ink the field
replaces the ink colour completely and the strokes still read black — read directly: ink
canvas `0,0,0` alpha 255 where the mask alpha is 255, while the main canvas paints ground
white at the same pixel. A colour with no lightness gives a hue nowhere to show. Relief is
the dial that reveals a field in dark ink, and the sweep above is the evidence.

**The file gets the ink too.** Measured through the button a person presses, at the export's
own resolution: `1920x1920 from 888x888 d1.7 (ink 1.9 / ground 1.4) surv 1.00 settle 0.0/0.0`,
with the ink layer compared on its own at `d0.7 big 0.3 % at 397,790 (dist 194)` — that
residual is one field sampled at two resolutions, not a compositing difference; shape and
contrast both survive. Capture needs a real `Blob` out of the stubbed `toBlob`: the app's own
export path rejects a fake one and never reaches the file name, which is how the file-name
check looked broken while the app was fine.

**Ink share keys:** `ik` (solid \| a field key), `ikf` field, `iksp` speed, `iksz` size,
`ikc` pigment, `ikr` relief — e.g. `#ik=veil&ikc=45&ikr=25`. A field name that does not exist
is resolved through `keyFor` inside `onChange`, so the picker, the render and the exported
file name agree: measured `…_ikmesh_k45r25_…` even when state is handed `not_a_field`.
Without that resolution the same picture exported under two names depending on which control
last moved.

**Ink defaults:** field off (solid ink), `mesh` when a field is asked for, speed 1, size 1,
pigment 45, relief 25. Ink stays solid by default on purpose: the ground is the loud one, and
the shipped default for ink is the smallest change that still shows what the dial does.

## The lattice a frame stands on

Reported by the user: choosing desktop 16:9 at density 1 gives tiles far smaller
than 1:1 at density 1. Measured on the live page before the fix: a 16:9 frame's
density-1 cell was 6.3% of its short edge, against 59% for a 1:1 frame's. The
cause is arithmetic, not the fit - the lattice was the frame's ratio reduced to
coprimes (16 x 9) and density scaled that grid, so the coarsest 16:9 picture is
144 cells across, and square tiles only tile a p:q rectangle in multiples of
p x q. Wide frames cannot start coarse on their own grid, because "coarse" means
fewer than one whole grid.

Two changes, both in `src/app.js`:

**`latticeBase()`** lets a frame stand on a coarser continued-fraction lattice
than its own grid - the coarsest convergent of its ratio with at most
`LATTICE_SHORT_MAX` (4) cells on the short edge, and only while its ratio deficit
is small enough for cover fit to absorb (2 x `WING_MARGIN` of a lattice unit).
16:9 lands on 7 x 4: a cell 23% of the short edge, 1.6% off 16:9. Frames whose
grid is already coarse enough - 1:1, 4:3, 5:4, 3:2, 2:1, and 21:9, which was
stored as 21x9 unreduced and is now 7x3 - keep their exact grid, so their
behaviour is untouched. `lattice()` calls `latticeAt` on that base, and
`latticeMaxT()` and Photo's `baseScale()` are both measured on the base lattice
rather than deriving limits from the exact ratio, which is what kept those caps
wrong for a coarse lattice.

**`latticeAt()`** scales the SHORT edge by the density step and re-derives the
long edge from the frame's ratio, rounded to whole cells. The first version
scaled both edges (p*t x q*t), which is exact for the frame's own grid and wrong
for a coarse stand-in: its ratio error is a fraction of the lattice, so it grew
with density - 16:9 on 7 x 4 is 1.6% off at x1, which is 0.11 of a cell, and 1.6
cells off at x9, past the 0.71 lattice units cover fit is allowed to trim. That
lattice was clipped from density 7 up, 9:16's from density 6 up, and the cap was
letting both ask for x18. Rounding the long edge per step bounds the error at
half a cell whatever the density, and pulls the lattice back towards the frame's
ratio as it gets finer: 7x4 (1.6% off) -> 21x12 -> 43x24 -> 64x36, exact at the
top. The coarsest setting is where the frame is bent most, and it is the setting
the `latticeBase` cut check is written for - it is not a free pass at every
density, which is what the first version assumed.

What makes a coarse lattice legal at all: cover fit may only cut the arc wings.
The bounds the renderer culls with are the lattice rect plus `WING_MARGIN` on
every side, so the window it looks through is always wider and taller than the
lattice, and the trim can only ever reach that overhang - no square of the grid is
lost. `src/engine.js` exports `WING_MARGIN` for that check; the three places that
had written `s/3 + s*0.02` by hand were the same number in disguise, and a fit
check cannot be written against a sum repeated in four places.

`'off'` and `'sur'` clip squares of the grid even when the frame stands on its own
exact grid - their overhang moves the centre the window is centred on, which is
what an offset surround *is*. The gate judges those two against the frame's own
grid at the same density step and forbids the coarse lattice from clipping more
than that, while the tilings that fill the lattice exactly (chk, grid, rand) are
judged absolutely: not one square clipped, at any density.

New gate `dev/_latticeqa.py` (+ `dev/_latticeprobe.js`): 120 live rows across all
12 formats x 5 generator tilings at density 1 and at each frame's own cap, 120
baseline rows from the frames' exact grids rebuilt in the probe from the engine,
and custom frames. It reads cell size as a fraction of the short edge, the window
against the lattice rect and against every tile square, the lattice against the
caps, the presets in lowest terms, that the coarse cap leaves the already-coarse
frames alone, that a lattice is never over half a cell off the frame's ratio, and
that Fill and Photo stand on the Generator's lattice. It also had to be shown that
the probe can pass its own baseline - a probe that cannot measure the exact grid
has nothing to compare a coarse one against.

Also in this pass: `latticeMaxT()` measures its cap on the base lattice rather
than the exact grid, and its tile-cap estimate is now checked by walking the step
back against the lattice this frame actually gets, because with the long edge
re-derived per step the estimate is a hint and not an answer - the lattice it
predicts and the lattice `latticeAt` builds are not the same rectangle.


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
- `src/style.css`, `index.html`, `build.js`, `dist/truchet.html` (~173 KB).
- `src/shaders.js` - the fields. Ten field bodies over one shared preamble, each a
  function `vec3 field(vec2 p, float t)`; two thin programs wrap the same bodies for the
  two jobs: `GROUND_MAIN` (`gl_FragColor = vec4(finish(col), 1.0)`, opaque, no mask) and
  `INK_MAIN` (samples `u_mask` with the `y` flip, keeps coverage where alpha > 0, anchors the
  ink's lightness, moves it away from the ground by at most `u_mix × u_relief × own gap`, and
  writes `vec4(col * coverage, coverage)`). `frameUV()` is what keeps a field global. Reads
  the palette as `u_a` (ink end) and `u_b` (ground end) plus `u_mix`, `u_scrim`, and for ink
  also `u_relief`, `u_speed`, `u_scale`, `u_mask`. `createGround(canvas, role)` takes
  `'ground'` or `'ink'`. `window.TruchetShaders` exports `createGround`, `keyFor`, `list` and
  `hexToRGB` - and nothing else, because a probe that reaches into the private field table
  finds holes a plain user could never cause, and those are not worth reporting as failures.
- `dev/_groundprobe.js` (the probe the gate runs: measures coverage, luminance, spread,
  determinism, motion, loop seam, fold, scrim, distance from the ink, the export, and the
  ink-coloured ground that the shipped fields are *not*) and `dev/_groundqa.py` (the gate:
  drives the real page, reopens the picture from the share link the first run wrote, then
  runs the probe a third time against a ground given the ink's own colour). All three
  runs have to come out right for the gate to pass.
  `dev/_groundshots.py` screenshots the fields through the app UI; `dev/shadertest.html`
  and `dev/_fold.html` are for eyes, not for gates; `dev/_defaults.py` is the palette/scrim
  sweep behind the opening defaults.
- `dev/_inkfieldprobe.js` and `dev/_inkfieldqa.py` - the ink field measurement and its gate.
  The probe compares, all at the same animation phase, three coverages (solid ink, the app's
  own mask, the field's output alpha), the lightness budget per pixel, camouflage against the
  layer actually underneath the ink, the pigment-0 anchor, and the export (preview before the
  press, file after, and the export-size ink layer on its own). It also restores every control
  it moved: a probe that leaves `Ink = field` behind reports the *probe's* leftovers as the
  app's own behaviour, which is exactly what a file-name check once appeared to find.
  `dev/_inkshots.py` frames an ink field at one parked instant for the eyes.
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
`dev/_photoqa.py`, `dev/_ressqa.py`, `dev/_groundqa.py`. A gate writes its own scratch
pages - `dev/_fillpage.html`, `dev/_fillshare.html`, `dev/_photopage.html`,
`dev/_resspike.html`, `dev/_groundpage.html` - and those are generated and gitignored,
not hand-kept.
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

**Line endings, read this before believing dist is stale.** `.gitattributes` pins text
files to LF and `build.js` writes the artifact with LF, so `dist/truchet.html` on disk and
the blob git holds for it are the same bytes. Before that pinning they were not:
`core.autocrlf=true` handed the working tree CRLF while the blobs stayed LF, and the file
measured 2,764 bytes larger on disk than in git - exactly one `\r` per line, same content -
which made a check comparing disk against `git show` call a healthy build broken. A
published build once matched a four-script block in `index.html` with a literal joined by
`\n`, so a fresh Windows checkout made the match fail silently and the build stopped with
"external references remain" while the shipped file was fine. Matching is tolerant now.

**Not deployed yet.** The fields — under the tiles and on the ink — are built and gated
locally; the Pages site still serves the last published build. `dist/truchet.html` is 172.5 KB
at the moment of writing (engine + shaders + app + photo + fill inlined). Publishing is the
user's call, not a step to assume. Before publishing, know that `dev/_ressqa.py` measured every
frame format × long edge × tab with both field controls in place, including an ink field over a
field ground: the export size list and the new controls have been seen together.

## Running the gates

Run all nine after any change to `src/`. Each exits non-zero on failure.

```bash
node build.js                     # regenerate dist/truchet.html

python dev/_inkqa.py              # ink fractions: engine table vs measured, 24 motifs
python dev/_tilesqa.py            # tile polygons browser-vs-oracle, pixel by pixel
python dev/_appqa.py --capture    # the 15 picker previews vs the oracle, self-shot
python dev/_fillqa.py             # Fill tab through the real app UI
python dev/_photoqa.py            # Photo tab through the real app UI
python dev/_ressqa.py             # every frame format x long edge x tab: no black stage
python dev/_latticeqa.py          # the lattice each frame stands on: cell size against the
                                  # short edge, the cover-fit window against the lattice rect
                                  # and against every tile square, at every density, against
                                  # each frame's own exact grid as the baseline
python dev/_groundqa.py           # the fields under the tiles: opening defaults, the share
                                  # link, Save PNG, and a negative pass whose whole job is
                                  # to prove these gates are capable of failing
python dev/_inkfieldqa.py         # the same fields painted onto the ink: shape preserved,
                                  # lightness budget kept, export named and matched
                                  # (--only=mesh measures one field)
```

`_inkqa.py` and `_inkfieldqa.py` are different gates: the first checks the Photo tab's motif
ink table (a motif's ink plus its inverted copy cover the cell), the second checks the fields
painted onto ink. Both field gates loop over `TruchetShaders.list`, so a field added to
`src/shaders.js` is gated automatically, and a field missing from it shows up as a hole in
the output rather than as a silent pass.

`_inkfieldqa.py` retries an attempt only when **no measurement reached the dump** — a canvas
that handed out no context, or a dump taken while the probe was still working (`running...`).
A failing measurement is not retried; it prints and fails, identically on every attempt. That
distinction matters: the ink gate is the heaviest of them (18 rows, two WebGL layers, four
1920×1920 exports), and under back-to-back Chrome instances it once reported a failure that
three clean runs did not reproduce. Run it alone before trusting a failure — and read which
row says why.

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
