/* ============================================================
 * Truchet Studio — multi-scale Truchet engine
 * Literal JavaScript port of Christopher Carlson's
 * MultiScaleTruchetPatterns.wl  (Mathematica source read directly;
 * cross-validated against dev/port.py, our Python reference model).
 * https://christophercarlson.com/portfolio/multi-scale-truchet-patterns/
 * ============================================================ */
'use strict';

const Truchet = (function () {
  /* ---------- constants ---------- */
  const PPS = 2;                 // connections per side
  const NP = 8;                  // total connection points

  // Connection points 1..8 counter-clockwise, math coords (y-up), unit tile:
  // S:1,2  E:3,4  N:6,5 (right->left numbering is 6 then 5)  W:7,8
  function coordinate(n) {
    const side = Math.floor((n - 1) / PPS);
    if (side === 0) return [n / (PPS + 1), 0];
    if (side === 1) return [1, (n - PPS) / (PPS + 1)];
    if (side === 2) return [(2 * PPS - n) / (PPS + 1) + 1, 1];
    return [0, (4 * PPS - n + 1) / (PPS + 1)];
  }
  const PT = {};
  for (let n = 1; n <= NP; n++) PT[n] = coordinate(n);
  const SIDE = {};
  for (let n = 1; n <= NP; n++) SIDE[n] = Math.floor((n - 1) / PPS);
  const INWARD = [[0, 1], [-1, 0], [0, -1], [1, 0]];  // InternalTangent per side

  /* ---------- PRNG ---------- */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function seedFromString(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return h >>> 0;
  }
  function randSeed(random) {
    let s = '';
    for (let i = 0; i < 6; i++) s += Math.floor(random() * 36).toString(36);
    return s;
  }

  /* ---------- connection-set enumeration ----------
   * Reproduces Carlson's AllSquare2ConnectionSets exactly: Nest 4 times
   * over a LIST of partial sets -> the 24 perfect matchings, in his order,
   * so named tiles ("/", "fne", "x."...) index identically.
   */
  function destinations(i) {
    const out = [];
    for (const k of [1, 3, 5, 7]) out.push(((i + k - 1) % 8) + 1);
    return out;
  }
  function stepSet(c) {
    const used = new Set(c.flat());
    const left = [];
    for (let p = 1; p <= 8; p++) if (!used.has(p)) left.push(p);
    if (!left.length) return [];
    const p = Math.min(...left);
    const cand = destinations(p).filter(d => !used.has(d));
    return cand.map(d => c.concat([[p, d]]));
  }
  const CONNECTION_SETS = (function () {
    let level = [[]];
    for (let k = 0; k < 4; k++) {
      const next = [];
      for (const s of level) next.push(...stepSet(s));
      level = next;
    }
    return level;
  })();

  // Carlson's SquareTileNameMapping (index into CONNECTION_SETS)
  const NAMED_TILES = {
    '+.': 1, 'fnw': 2, 'fne': 3, 'yn': 4, 'tn': 5, '-': 6, 'fse': 7,
    '/': 8, 'ye': 9, 'anw': 10, 'p': 11, 'ys': 12, 'te': 13, 'ase': 14,
    '|': 15, '+': 16, 'yw': 17, 'ane': 18, 'x.': 19, 'ts': 20, 'tw': 21,
    'asw': 22, 'fsw': 23, '\\': 24
  };
  const TILE_NAME = {};
  for (const [name, idx] of Object.entries(NAMED_TILES)) TILE_NAME[idx] = name;
  const TILE_NAMES = Object.keys(NAMED_TILES).sort(
    (a, b) => NAMED_TILES[a] - NAMED_TILES[b]);

  /* The 15 tiles Carlson actually shows in his motifs figure, in his grid
   * order (verified against motifs.png: every cell matches one of these at
   * IoU 0.80-0.90 with a single fitted square size of 37.5px on an 87x90
   * pitch).  The other nine names in SquareTileNameMapping -- the four
   * rotation variants of the Y tile (yn ye ys yw), the four rotation variants
   * of the anchor tile (anw ane ase asw) and 'p' -- are real tiles in his
   * code but are not part of that showcase, so the UI does not offer them.
   */
  const MOTIF_NAMES = [
    '\\', '/', '-', '|', '+.', 'x.', '+',
    'fnw', 'fne', 'fse', 'fsw',
    'tn', 'te', 'ts', 'tw'
  ];



  /* Fraction of a tile's square covered by its dark circuits, measured from this
   * engine's own geometry (dev/_inkqa.py rasterizes each tile and counts sample
   * points inside its circuits -- the same polygons renderTiling composites).
   * The Photo tab uses it to choose the motif whose tone matches a region of an
   * image; verified against the browser's own fill in dev/_inkqa2.py. */
  /* Ink: the fraction of the tile's own square this engine paints DARK for a
   * motif at even depth over a light ground, and 1 - ink at odd depth where the
   * two circuit colour classes swap (Carlson's InvertMotif swaps a motif's
   * colours; SquareArcTile is circuits only and fills no ground).
   *
   * Measured, not modelled. dev/inktest.html renders each motif alone at 240x240
   * and counts pixels INSIDE THE TILE SQUARE: fitTransform fits a tile including
   * its wings, so counting the whole canvas understates every fraction - an early
   * version of this harness did exactly that and every number in this table was
   * too small by roughly the canvas-to-square area ratio.
   *
   * The same harness also renders each motif on a grey ground and counts what
   * changed, which measures how much of the square the tile paints at all. For
   * Carlson's 24 that is 0.98 to 0.99, at either parity. A tile's ink and its
   * inverted ink add up to that coverage - the two colour classes partition the
   * area the tile paints - so inverted coverage is 1 - ink to
   * within the 1-2% an arc tile leaves untouched; and a tile in a multi-scale
   * tiling effectively repaints its own square rather than overlaying what was
   * drawn below it, so per-tile tone control is real. dev/_inkqa.py re-runs the
   * measurement and gates this table against it.
   */
  const MOTIF_INK = {
    '+.': 0.1729,
    fnw: 0.3489, fne: 0.3491, fse: 0.3490, fsw: 0.3489,
    yn: 0.4030, ye: 0.3973, ys: 0.4029, yw: 0.3969,
    p: 0.4101,
    '-': 0.4292, '|': 0.4151,
    '/': 0.5250, '\\': 0.5252,
    tn: 0.5417, te: 0.5347, ts: 0.5417, tw: 0.5347,
    '+': 0.5588,
    anw: 0.5629, ane: 0.5629, ase: 0.5629, asw: 0.5631,
    'x.': 0.6543
      };

  /* ---------- circuits (Carlson's SquareConnectionCircuits) ----------
   * Walk from every starting point 1..8: first step internal, then
   * alternate external k->k+1 (cyclic) and internal. Keep the FIRST
   * trace for each circuit (identified by its sorted point set); that
   * representative starts at the circuit's minimum point.
   * Color: First[] odd -> white (drawn under), even -> black (on top),
   * exactly as Carlson's OddQ[First[#]] Select.
   */
  function traceCircuits(connections) {
    const internal = new Map();
    for (const [a, b] of connections) { internal.set(a, b); internal.set(b, a); }
    const external = new Map();
    for (let k = 1; k <= NP; k++) external.set(k, (k % NP) + 1);
    const all = [];
    for (let s = 1; s <= NP; s++) {
      const circuit = [s, internal.get(s)];
      let internalStep = false;
      while (circuit[circuit.length - 1] !== circuit[0]) {
        const last = circuit[circuit.length - 1];
        circuit.push((internalStep ? internal : external).get(last));
        internalStep = !internalStep;
      }
      all.push(circuit.slice(0, -1));          // Most[circuit]
    }
    const seen = new Set();
    const out = [];
    for (const c of all) {
      const key = c.slice().sort((a, b) => a - b).join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
    }
    return out;
  }

  /* ---------- arc geometry (literal ArcPoints port) ----------
   * Given node descriptors (p1,t1),(p2,t2):
   *   parallel tangents     -> straight segment
   *   antiparallel          -> semicircle centered at midpoint
   *   otherwise             -> elliptical arc centered at the intersection
   *     of the two tangent LINES, rx=|p1-c| (x semi-axis), ry=|p2-c|
   *     (y semi-axis), sampled from polar angle a1 to a2 with sweep
   *     direction set by Sign[cross(t1, p1-c)].
   * Returns canvas-drawable descriptors: {kind:'line'|'ellipse', ...}.
   */
  function vectorAngle(t1, t2) {
    const d = t1[0] * t2[0] + t1[1] * t2[1];
    const n1 = Math.hypot(t1[0], t1[1]), n2 = Math.hypot(t2[0], t2[1]);
    return Math.acos(Math.max(-1, Math.min(1, d / (n1 * n2))));
  }
  function arcFromDescriptors(p1, t1, p2, t2) {
    const va = vectorAngle(t1, t2);
    const EPS = 2.220446049250313e-16;
    if (Math.abs(va) < EPS) return { kind: 'line', p1, p2 };
    let c;
    if (Math.abs(va - Math.PI) < EPS) {
      c = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
    } else {
      const [x1, y1] = p1, [x2, y2] = p2, [t1x, t1y] = t1, [t2x, t2y] = t2;
      const inner = -t2x * x1 + t2x * x2 - t2y * y1 + t2y * y2;
      const den = t1y * t2x - t1x * t2y;
      c = [x1 + t1y * inner / den, y1 - t1x * inner / den];
    }
    const cw = (t1[0] * (p1[1] - c[1]) - (p1[0] - c[0]) * t1[1]) > 0;
    const rx = Math.hypot(p1[0] - c[0], p1[1] - c[1]);   // x semi-axis
    const ry = Math.hypot(p2[0] - c[0], p2[1] - c[1]);   // y semi-axis
    let a1 = Math.atan2(p1[1] - c[1], p1[0] - c[0]);
    let a2 = Math.atan2(p2[1] - c[1], p2[0] - c[0]);
    if (cw && a1 < a2) a2 -= 2 * Math.PI;
    if (!cw && a2 < a1) a1 -= 2 * Math.PI;
    return { kind: 'ellipse', c, rx, ry, a1, a2, cw };
  }

  /* Sample an arc descriptor to a polyline (exact parametrization
   * P(a) = c + (rx cos a, ry sin a)).  Sub-degree steps: visually
   * indistinguishable from the true conic, and immune to canvas
   * arc-direction semantics ambiguity. */
  function sampleArc(s, stepRad = Math.PI / 360) { // 0.5 deg
    if (s.kind === 'line') return [s.p1, s.p2];
    const n = Math.max(6, Math.ceil(Math.abs(s.a2 - s.a1) / stepRad));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = s.a1 + (s.a2 - s.a1) * i / n;
      pts.push([s.c[0] + s.rx * Math.cos(a), s.c[1] + s.ry * Math.sin(a)]);
    }
    return pts;
  }

  /* ---------- circuit -> closed polygon (ArcCircuitPolygon) ----------
   * Alternate tangent signs along the circuit; first node gets +internal.
   */
  function circuitSegments(circuit) {
    const nodes = circuit.map((k, i) => {
      const p = coordinate(k);
      const t = INWARD[SIDE[k]];
      const sgn = (i % 2 === 0) ? 1 : -1;
      return [p, [t[0] * sgn, t[1] * sgn]];
    });
    const segs = [];
    for (let i = 0; i < nodes.length; i++) {
      const [p1, t1] = nodes[i];
      const [p2, t2] = nodes[(i + 1) % nodes.length];
      segs.push(arcFromDescriptors(p1, t1, p2, t2));
    }
    return segs;
  }

  /* ---------- shared numeric helper ----------
   * One clamp for the whole project: the tabs each used to carry a private
   * copy of this identical line. */
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /* ---------- tile cache ---------- */
  const tileCache = new Map();
  function buildCircuitPaths(tile) {
    /* Tessellate every circuit ONCE, in unit-tile space, and keep it as a
     * Path2D. A frame then costs fill() calls instead of re-running the arc
     * sampling for every tile: the same 15 motifs repeat thousands of times,
     * so this is pure repetition. One Path2D per circuit (not one merged
     * path) on purpose: Carlson's renderer composites same-colour circuits
     * opaquely, and a merged nonzero path would cancel oppositely-wound
     * overlaps into white slits. Path2D honours the current transform, so
     * each tile just sets translate/scale and fills the cached shapes. */
    if (typeof Path2D === 'undefined') return null;   // Node (tests) -> traceTilePolygons falls back
    const paths = { under: [], top: [] };
    for (const pass of [true, false]) {
      for (const { whiteFirst, segs } of tile) {
        if (whiteFirst !== pass) continue;
        const p = new Path2D();
        let started = false;
        for (const s of segs) {
          const pts = sampleArc(s);
          for (let i = started ? 1 : 0; i < pts.length; i++) {
            if (!started) { p.moveTo(pts[i][0], pts[i][1]); started = true; }
            else p.lineTo(pts[i][0], pts[i][1]);
          }
        }
        p.closePath();
        (pass ? paths.under : paths.top).push(p);
      }
    }
    return paths;
  }
  function getTile(connIdx) {
    if (tileCache.has(connIdx)) return tileCache.get(connIdx);
    const circuits = traceCircuits(CONNECTION_SETS[connIdx - 1]);
    // draw order: white (odd-min) first = under, then black on top
    circuits.sort((a, b) => (b[0] % 2) - (a[0] % 2));
    const tile = circuits.map(c => ({
      circuit: c,
      whiteFirst: (c[0] % 2) === 1,
      segs: circuitSegments(c)
    }));
    tile.paths = buildCircuitPaths(tile);
    tileCache.set(connIdx, tile);
    return tile;
  }
  function connIdxByName(name) {
    return NAMED_TILES[name];
  }
  function nameForConnIdx(idx) {
    return TILE_NAME[idx] || ('#' + idx);
  }

  /* ---------- tilings ----------
   * Tiling = list of {x, y, s} (axis-aligned square tiles, math coords).
   * Depth = -log2(s). Odd depth inverts the motif (TileParity rule).
   */
  function tileDepth(t) {
    return Math.round(-Math.log2(Math.abs(t.s)));
  }
  function makeTile(x, y, s) { return { x, y, s }; }

  /* RandomSquareSubdivisionTiling[n, d] */
  /* RandomSquareSubdivisionTiling[n, d]: pick a random tile, split it into
   * four. seedTiles lets the same process run over a rectangular lattice of
   * unit squares (needed to fill a non-square frame without cropping). */
  function randomSubdivision(random, n, maxDepth = Infinity, seedTiles) {
    let tiles = (seedTiles && seedTiles.length) ? seedTiles.slice()
      : [makeTile(0, 0, 1)];
    for (let k = 0; k < n; k++) {
      const cands = [];
      tiles.forEach((t, i) => { if (tileDepth(t) < maxDepth) cands.push(i); });
      if (!cands.length) break;
      const i = cands[Math.floor(random() * cands.length)];
      const t = tiles[i], s = t.s / 2;
      tiles.splice(i, 1,
        makeTile(t.x, t.y, s), makeTile(t.x + s, t.y, s),
        makeTile(t.x, t.y + s, s), makeTile(t.x + s, t.y + s, s));
    }
    return tiles;
  }

  function gridTiling(rows, cols) {
    const out = [];
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) out.push(makeTile(i, j, 1));
    return out;
  }

  /* CheckerboardTiling[n] — n columns by m rows (m defaults to n). */
  function checkerboardTiling(nx, ny) {
    const cols = nx, rows = (ny === undefined ? nx : ny);
    const out = [];
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++) {
        if ((i + j) % 2 === 0) out.push(makeTile(i, j, 1));
        else {
          out.push(makeTile(i, j, 0.5), makeTile(i, j + 0.5, 0.5),
            makeTile(i + 0.5, j, 0.5), makeTile(i + 0.5, j + 0.5, 0.5));
        }
      }
    return out;
  }

  /* SurroundTiling / OffsetSurroundTiling (1.5-periodic unit: one big
   * central tile + 8 half tiles; coincident tiles dedup) */
  function surroundUnit() {
    const out = [makeTile(0.5, 0.5, 1)];
    for (let i = 0; i <= 3; i++) out.push(makeTile(i * 0.5, 0, 0.5));
    for (let i = 0; i <= 3; i++) out.push(makeTile(i * 0.5, 1.5, 0.5));
    for (let i = 1; i <= 2; i++) out.push(makeTile(0, i * 0.5, 0.5));
    for (let i = 1; i <= 2; i++) out.push(makeTile(1.5, i * 0.5, 0.5));
    return out;
  }
  function dedupTiles(tiles) {
    const seen = new Set(); const out = [];
    for (const t of tiles) {
      const key = t.x.toFixed(9) + ',' + t.y.toFixed(9) + ',' + t.s;
      if (seen.has(key)) continue;
      seen.add(key); out.push(t);
    }
    return out;
  }
  function surroundTiling(nx, ny) {
    const cols = nx, rows = (ny === undefined ? nx : ny);
    const unit = surroundUnit(), out = [];
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++)
        for (const t of unit) out.push(makeTile(t.x + 1.5 * i, t.y + 1.5 * j, t.s));
    return dedupTiles(out);
  }
  function offsetSurroundTiling(m, n) {
    const unit = surroundUnit(), out = [];
    for (let i = 0; i < n; i++)
      for (let j = 0; j < m; j++)
        for (const t of unit)
          out.push(makeTile(t.x + 1.5 * i, t.y + 1.5 * j + (i % 3) / 2, t.s));
    return dedupTiles(out);
  }

  /* FillTiling (quadtree region fill; generalizes to photo predicates) */
  function fillTiling(region, llx, lly, size, maxDepth) {
    const out = [];
    (function rec(x, y, s, d) {
      const state = region(x, y, x + s, y + s);
      if (state === 'out') return;
      if (state === 'in') { out.push(makeTile(x, y, s)); return; }
      if (d >= maxDepth) { out.push(makeTile(x, y, s)); return; }
      const h = s / 2;
      rec(x, y, h, d + 1); rec(x + h, y, h, d + 1);
      rec(x, y + h, h, d + 1); rec(x + h, y + h, h, d + 1);
    })(llx, lly, size, 0);
    return out;
  }

  /* ---------- palettes ---------- */
  const PALETTES = {
    bw: ['#000000', '#ffffff'],
    wb: ['#ffffff', '#000000'],
    ink: ['#101018', '#f4efe6'],
    night: ['#05070f', '#d8c9a3'],
    oxide: ['#7b1f13', '#f7e9d0'],
    teal: ['#0f3b34', '#efe7d2'],
    ultramarine: ['#141b52', '#f0ead6'],
    forest: ['#123524', '#e8e3c9'],
    slate_ramp: ['#22242a', '#e4e4dc'],
    rainbow_ramp: ['#d90429', '#efefeb']
  };
  function parseColor(str) {
    const s = str.replace('#', '');
    const full = s.length === 3 ? s.split('').map(c => c + c).join('') : s;
    return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
  }
  function lerpColor(a, b, t) {
    const ca = parseColor(a), cb = parseColor(b);
    const m = ca.map((v, i) => Math.round(v + (cb[i] - v) * t));
    return 'rgb(' + m.join(',') + ')';
  }

  /* ---------- rendering ----------
   * renderTiling draws tiles biggest-first (small overpaint big), and
   * inverts the motif's colors at odd depth (TileParity rule).
   * pickTile(depth, tile) -> connection-set index (1..24)
   * palette: [color0(even-min circuits, drawn on top), color1(odd-min, under)]
   */
  function traceTilePolygons(ctx, tileDef, colTop, colUnder) {
    // Carlson's draw order: ALL white circuits first (under), then ALL
    // black circuits (on top) -- see SquareArcTile in the WL source.
    if (tileDef.paths) {                     // cached unit-space Path2D shapes
      for (const pass of [true, false]) {
        ctx.fillStyle = pass ? colUnder : colTop;
        for (const p of (pass ? tileDef.paths.under : tileDef.paths.top)) {
          // Nonzero winding fill (canvas default), matching Carlson's opaque
          // polygon composition; even-odd would open white slits.
          ctx.fill(p);
        }
      }
      return;
    }
    for (const pass of [true, false]) {
      for (const { whiteFirst, segs } of tileDef) {
        if (whiteFirst !== pass) continue;
        ctx.fillStyle = pass ? colUnder : colTop;
        ctx.beginPath();
        let started = false;
        for (const s of segs) {
          const pts = sampleArc(s);
          for (let i = started ? 1 : 0; i < pts.length; i++) {
            if (!started) { ctx.moveTo(pts[i][0], pts[i][1]); started = true; }
            else ctx.lineTo(pts[i][0], pts[i][1]);
          }
        }
        ctx.closePath();
        // Nonzero winding fill. Carlson's renderer composites same-color
        // polygons opaquely; even-odd would leave white slits where a
        // circuit's lens arms overlap (x., yn, ts, tw, asw, anw, ane, yw).
        ctx.fill();
      }
    }
  }

  function renderTiling(ctx, tiles, opts) {
    const { pickTile, palette, bounds } = opts;
    const order = tiles.slice().sort((a, b) => tileDepth(a) - tileDepth(b)); // big first
    for (const t of order) {
      if (bounds) {
        const m = t.s / 3 + t.s * 0.02; // wings reach exactly s/3
        if (t.x + t.s + m < bounds[0] || t.x - m > bounds[2] ||
          t.y + t.s + m < bounds[1] || t.y - m > bounds[3]) continue;
      }
      const depth = tileDepth(t);
      const pal = (typeof palette === 'function') ? palette(depth) : palette;
      const connIdx = pickTile(depth, t);
      const def = getTile(connIdx);
      const invert = depth % 2 === 1;
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.scale(t.s, t.s);
      traceTilePolygons(ctx, def,
        invert ? pal[1] : pal[0],   // color drawn on top (black circuits)
        invert ? pal[0] : pal[1]);  // under color (white circuits)
      ctx.restore();
    }
  }

  /* Fit a tiling to a canvas viewport (engine keeps math y-up coords). */
  function fitTransform(ctx, tiles, w, h, padding = 0) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const t of tiles) {
      const m = t.s / 3 + t.s * 0.02; // wings reach exactly s/3 beyond the tile square
      minX = Math.min(minX, t.x - m); minY = Math.min(minY, t.y - m);
      maxX = Math.max(maxX, t.x + t.s + m); maxY = Math.max(maxY, t.y + t.s + m);
    }
    if (padding) { const p = (maxX - minX) * padding; minX -= p; maxX += p; minY -= p; maxY += p; }
    const bw = maxX - minX, bh = maxY - minY;
    /* No tiles (or bounds that never got set) leave these at Infinity / -Infinity,
     * which turns bw into NaN and s into NaN - and a NaN transform silences every
     * later draw without raising anything. Report "nothing to fit" as 0 instead of
     * corrupting the context. */
    if (!(bw > 0 && bh > 0) || !Number.isFinite(bw) || !Number.isFinite(bh)) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      return 0;
    }
    const s = Math.min(w / bw, h / bh);
    if (!Number.isFinite(s) || s <= 0) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      return 0;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate((w - bw * s) / 2 - minX * s, (h + bh * s) / 2 + minY * s);
    ctx.scale(s, -s);
    return s;
  }

  return {
    /* Only what something outside this file actually calls. The arc plumbing
     * (points, connection sets, circuit tracing, the tile cache, colour
     * parsing) is used from inside the engine and stays private. */
    clamp, coordinate,
    TILE_NAMES, MOTIF_NAMES, MOTIF_INK, NAMED_TILES,
    connIdxByName, nameForConnIdx,
    mulberry32, seedFromString, randSeed,
    tileDepth,
    randomSubdivision, gridTiling, checkerboardTiling, surroundTiling,
    offsetSurroundTiling, fillTiling,
    renderTiling, fitTransform, PALETTES, lerpColor
  };
})();
if (typeof module !== 'undefined') module.exports = Truchet;
if (typeof window !== 'undefined') window.Truchet = Truchet;
