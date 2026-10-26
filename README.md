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
| `dev/port.py` | literal Python port of Carlson's `MultiScaleTruchetPatterns.wl` — our **gold reference model**, validated against his published images. |
| `dev/gold.json` | reference data dumped from `port.py`: all 24 named tiles (connections, circuits, sampled polygon points) + tiling configurations. |
| `dev/check_gold.js` | fidelity test: compares `src/engine.js` against `dev/gold.json`. Run `node dev/check_gold.js`. |
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

`node dev/check_gold.js` currently reports **ALL GOLD CHECKS PASSED
(24 tiles)**: connection sets, circuit contents, sampled arc points
(max deviation < 1e-4), arc endpoint continuity, and tiling generators all
match the Python gold model, which itself matches Carlson's images.

## Status

- [x] Phase 1a: gold reference model (`port.py`) validated against Carlson's images
- [x] Phase 1b: engine rewritten as literal port; passes gold checks
- [ ] Phase 1c: Generator tab UI (seed control, tiling/motif pickers, export)
- [ ] Phase 2+: Fill / Photo / Composer / Mandala tabs

## Credit

All design and math credit to [Christopher Carlson](https://christophercarlson.com/);
see also his paper in *Bridges 2018*. This project is an independent
re-implementation for the browser.
