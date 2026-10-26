# Truchet Studio

A faithful browser implementation of Christopher Carlson's **Multi-Scale
Truchet Patterns**
(<https://christophercarlson.com/portfolio/multi-scale-truchet-patterns/>),
built as a single-page app with several "apps" (tabs) on one shared
rendering engine.

## Layout

| path | what |
|---|---|
| `src/engine.js` | the rendering engine: connection sets, circuit tracing, exact arc geometry, tilings, palettes, canvas rendering. Plain JS, no dependencies (works as `<script>` and as a Node module for tests). |
| `src/app.js`, `src/style.css`, `index.html` | the **Generator tab** app (dev layout, loads `src/` files). |
| `build.js` → `dist/truchet.html` | **the single-file build**: everything inlined, zero external references. Open it directly anywhere. |
| `dev/port.py` | literal Python port of Carlson's `MultiScaleTruchetPatterns.wl` — our **gold reference model**, validated against his published images. |
| `dev/gold.json` | reference data dumped from `port.py`: all 24 named tiles (connections, circuits, sampled polygon points) + tiling configurations. |
| `dev/check_gold.js` | fidelity test: compares `src/engine.js` against `dev/gold.json`. Run `node dev/check_gold.js`. |
| `dev/diff_canvas.py` | pixel-diffs browser screenshots against offline Python re-renders of the identical tilings (verifies the canvas pipeline end-to-end; see below). |
| `dev/seedrand.py` | exact Python mirrors of the engine's `mulberry32`/`seedFromString`/subdivision/motif-assignment (JS↔Python seed reproducibility). |
| `dev/render_refs.py` | regenerates `ref2_*.png` reference renders in Carlson's display orientation (math y-up). |
| `dev/density_ramp.json` | sampled black-area fraction of each of the 24 tiles (drives the photo-density ramp). |
| `dev/test.html` | browser test bench (renders engine output to canvas; compare with the reference PNGs). |
| `dev/zoom.py` | stdlib-only PNG crop/upscale helper for inspecting reference images. |
| `mstp/` | Carlson's original Wolfram language source (downloaded for reference). |
| `ref_*.png` | Carlson's published images used as visual references. |

## Fidelity model

The engine is a direct transcription of Carlson's pipeline:

- 8 connection points per tile (1/3 & 2/3 positions), 24 connection sets in
  his exact enumeration order with his names (`/ \ - | +. x. + fne … p`).
- Circuits traced exactly as `SquareConnectionCircuits` (alternating
  internal/external walk, first-occurrence dedup, representative starts at
  the circuit's minimum point).
- Circuit color = parity of the circuit's minimum point; white circuits
  drawn under, black on top.
- Arc geometry exactly as `ArcPoints`: center = intersection of the two
  *tangent lines*; `rx = |p1-c|`, `ry = |p2-c|`; polar sweep with direction
  from `Sign[cross(t1, p1-c)]`. Many segments are **3/4 arcs (270°)**
  wrapping tile corners — this is what produces Carlson's signature
  corner discs and edge wings. Wings are *not* a separate primitive; they
  emerge from these wrapping arcs and from adjacent tiles' arcs pairing up
  across shared edges. Tangent signs alternate along each circuit
  (`ArcCircuitPolygon`).
- Multi-scale: tiles at dyadic sizes; **odd-depth tiles draw the inverted
  motif**; draw order big-first so smaller tiles' wings overpaint bigger
  ones (Carlson's stated convention).
- Even-odd polygon fill (matches the gold rasterizer).
- Display orientation: **math y-up** (Carlson's `Graphics` convention),
  achieved in canvas via `translate(…, …); scale(s, -s)`.
- Canvas draw order per tile: all white circuits first, then all black
  (identical to `SquareArcTile` in the WL source).

`node dev/check_gold.js` currently reports **ALL GOLD CHECKS PASSED
(24 tiles)**: connection sets, circuit contents, sampled arc points
(max deviation < 1e-4), arc endpoint continuity, and tiling generators all
match the Python gold model, which itself matches Carlson's images.

### Orientation & end-to-end verification (closed 2026-02)

1. **Semantic check against Carlson's annotated figure**
   (`ref_multiscaletiles2.png`): the `1/3` and `2/3` radius labels sit
   exactly on the arcs our model generates for tile `/` — the ⅓ arc centered
   at the big tile's SE corner (touching the bottom edge at local ⅔ and the
   seam at local ⅓, matching measured pixel positions) and the ⅔ arc
   centered at `(1/3, 2/3)` from the tangent-alternation rule. This pins
   both the arc geometry and the math-y-up display orientation.
2. **Name mapping authority**: tile names/indices match WL
   `SquareTileNameMapping` (`\`→24, `/`→8, … , `p`→11) — engine order is
   identical.
3. **Browser pixel diffs** (`dev/diff_canvas.py`): screenshots of
   `dev/test.html` re-rendered offline through the independent Python model
   (identical tilings, fit transform, draw order): checkerboard 4 → 0.8 %,
   surround 3 → 1.1 %, random subdivision seed `k7x2m9` → 0.65 % differing
   pixels (antialiasing only). The Python replica of the seed pipeline
   (`dev/seedrand.py`) reproduces JS output exactly (37/37 tiles, 0 motif
   diffs).
4. `ref2_checker_slash.png` / `ref2_surround3.png` (Python-rendered, math
   y-up) visually match Carlson's published tiling figures, including the
   self-similar surround structure and the ⅓-width bands with corner dots.

## Status

- [x] Phase 1a: gold reference model (`port.py`) validated against Carlson's images
- [x] Phase 1b: engine rewritten as literal port; passes gold checks
- [x] Phase 1c: rendering pipeline fixed (polyline arc fills, draw order,
  math-y-up orientation) and verified end-to-end against browser screenshots
- [x] Phase 1d: Generator tab UI (seed, tilings, 24-motif picker, palettes,
  custom depth ramp, crop-based export, shareable URL hash)
- [ ] Phase 2+: Fill / Photo / Composer / Mandala tabs

## Using the Generator

Open `index.html` (dev) or `dist/truchet.html` (single file, run `node build.js`
after changes). Everything lives in the URL hash — "copy link" shares the
exact pattern + seed. PNG export crops from the bounding square (Carlson's
`CropSquareTiling`) for portrait/landscape sizes; export filenames encode
seed and params instead of a watermark, e.g.
`truchet_chk6_k7x2m9_m-sl_pink_2048x2048.png`.

## Credit

All design and math credit to [Christopher Carlson](https://christophercarlson.com/);
see also his paper in *Bridges 2018*. This project is an independent
re-implementation for the browser.
