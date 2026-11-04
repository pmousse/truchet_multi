/* Truchet Studio — Generator tab (Phase 1d)
 * Single faithful engine (src/engine.js); this file is UI only. */
(function () {
  'use strict';
  const T = window.Truchet;
  const SH = window.TruchetShaders;

  /* ================= state ================= */
  /* The starting picture is the one the app was last tested with, so opening
   * the page with no hash reproduces that result exactly and every control
   * reads the value it was built from. Seed is fixed on purpose: the "new"
   * button rolls another one whenever a different pattern is wanted.
   *
   * fw/fh are the Custom-frame size and are inert while format is a preset
   * (the frame then comes from res); they are kept ready so switching the
   * format to Custom gives 16:9 at these dimensions immediately. */
  const DEFAULTS = {
    tiling: 'rand',     // chk | grid | rand | sur | off
    n: 4,               // density step: 1 = the frame's base lattice, ×2 doubles it
    splits: 16, maxd: 3,// random subdivision
    seed: 'xsg3yj',
    motifs: ['/', '\\'],// selection set: motif names, 'mix', or several of both
    pal: 'custom',      // palette key or 'custom'
    c1: '#101018', c2: '#3a6ea5', bg: '#f4efe6', // custom ramp
    ground: 'solid',    // 'solid' paints the ground colour; 'shader' runs a field
    shader: 'mesh',     // TruchetShaders key
    shSpeed: 1, shScale: 1,
    shMix: 45,          // % of the field folded onto the picture's own ramp
    scrim: 45,          // % of the ground colour laid back over the field
    ink: 'solid',       // 'solid' paints the ink colour; 'shader' paints ink with a field
    inkShader: 'mesh',  // TruchetShaders key, the same fields as the ground
    inkSpeed: 1, inkScale: 1,
    inkPig: 45,         // % of the ink's own colour replaced by the field's hue
    inkRelief: 25,      // % of the way to the ground a pixel of ink is allowed to drift
    pad: 0,             // margin percent
    format: '1:1',      // frame format key, or 'custom'
    res: 3840,          // long edge in px when a preset format is used (the 4K step)
    fw: 3840, fh: 2160, // explicit frame size when format === 'custom'
    tab: 'gen'          // 'gen' | 'photo' (other tabs register themselves)
  };
  let S = Object.assign({}, DEFAULTS);

  /* ================= tab shell =================
   * A tab can own its params block, its motif picker, its export-name prefix,
   * its own way of producing tiles, and (optionally) a ground painted under the
   * tiles. Generator lives here; Photo lives in src/photo.js and registers
   * itself through window.TruchetApp, which keeps that tab's state out of the
   * share link entirely.
   *
   *   def.ready()          gate: false -> the canvas shows emptyMessage only
   *   def.tiles(lattice)   produce the tile list for a lattice
   *   def.picker(tiles)    (depth, tile) -> connection index
   *   def.params, def.prefix, def.motifs, def.emptyMessage, def.onShow
   *   def.onRedraw()       called after every redraw, for the tab's own readouts
   *   def.viewBounds(tiles) optional framing override: a tab that draws a shape
   *                        inside the frame frames the FRAME, because framing its
   *                        own tiles would scale the shape up until it filled the
   *                        frame and stopped being that shape at that size
   *   def.mode()           optional word for exported file names (otherwise the
   *                        tiling name, which only describes the Generator)
   */
  const TABS = {
    gen: {
      label: 'Generator', params: 'genParams', prefix: 'truchet_',
      motifs: true, ready: () => true, emptyMessage: ''
    }
  };
  function registerTab(key, def) {
    TABS[key] = Object.assign(
      { label: key, params: null, prefix: 'truchet_', motifs: true,
        ready: () => true, emptyMessage: '', onShow: null, tiles: null,
        picker: null }, def);
    const btn = document.querySelector('#tabs button[data-tab="' + key + '"]');
    if (btn) {
      btn.disabled = false;
      btn.title = '';
      btn.addEventListener('click', () => setTab(key));
    }
    /* Registration happens after boot: index.html loads app.js first, so boot's
     * refreshParamVisibility has only the Generator in TABS and leaves a later
     * tab's params block in its default visible state - the Photo and Fill
     * controls then sit under the Generator tab and push everything below the
     * Motif picker out of the panel. Hide a registering tab's block now unless
     * it is the tab actually showing. */
    if (def.params && def.params !== 'genParams') {
      const el = document.getElementById(def.params);
      if (el) el.style.display = (S.tab === key) ? '' : 'none';
    }
    /* A shared link can open straight into a tab whose script has only just
     * registered; re-apply so panel and canvas match the hash. */
    if (S.tab === key) applyTab();
  }
  function tabDef() { return TABS[S.tab] || TABS.gen; }
  function applyTab() {
    const def = tabDef();
    for (const b of document.querySelectorAll('#tabs button[data-tab]'))
      b.classList.toggle('active', b.dataset.tab === S.tab);
    document.title = 'Truchet Studio \u2014 ' + def.label;
    if (def.onShow) def.onShow();
    refreshParamVisibility();
    renderMain();
    updateMotifSel();
  }
  function setTab(key) {
    if (!TABS[key]) return;
    S.tab = key;
    /* The tab is part of the shared state, so the link has to follow it - otherwise
     * "copy link" hands over the tab you were on *before* this one. */
    writeHash();
    applyTab();
  }
  function showError(msg) {
    const el = document.getElementById('err');
    if (el) { el.textContent = msg; el.className = 'show'; }
  }
  function clearError() {
    const el = document.getElementById('err');
    if (el) { el.textContent = ''; el.className = ''; }
  }

  /* Framing model: a frame is a target pixel size (desktop wallpaper, square
   * social post, phone wallpaper...).  The tiling is generated FOR that frame:
   * a rectangular lattice of square tiles covering it completely, rather than
   * Carlson's CropSquareTiling cutting a non-square window out of a square.
   * Square tiles can only cover a rectangle whose ratio is rational, so the
   * frame ratio is reduced to p:q and the lattice is (p*t) by (q*t).  A coarser
   * lattice may stand in for p x q when the frame is wide enough that its own
   * grid would make every tile tiny - see latticeBase. */
  /* Pairs are kept reduced to lowest terms, because a coprime p x q IS the
   * coarsest square lattice that covers the frame exactly. 21:9 is 7:3: left as
   * 21 x 9 it meant a grid three times finer than the frame can carry, tiles
   * three times smaller, and two thirds of the density steps cut off. */
  const FRAME_FORMATS = {
    '1:1': [1, 1],
    '16:9': [16, 9], '9:16': [9, 16],
    '21:9': [7, 3],
    '4:3': [4, 3], '3:4': [3, 4],
    '3:2': [3, 2], '2:3': [2, 3],
    '5:4': [5, 4], '4:5': [4, 5],
    '2:1': [2, 1], '1:2': [1, 2]
  };
  const MAX_LATTICE_SIDE = 64;   // cap when reducing an arbitrary custom ratio
  /* Tiles actually DRAWN, not lattice cells: a checkerboard cell yields ~2.5
   * tiles on average and a surround unit ~6, so counting cells understates the
   * real cost by 2.5x-6x. Measured on this machine with the cached Path2D
   * shapes: 5760 tiles = ~0.67 s per 4K export paint and ~0.66 s per 1280x720
   * preview redraw; 14125 tiles = ~1.7 s and ~1.5 s. 8000 keeps the dense
   * checkerboard case available while capping the surround tilings. */
  const MAX_LATTICE_TILES = 8000;
  /* Absolute ceiling on the density multiplier, independent of frame: it exists
   * so the density box has a sane top end (at x32 a 1:1 frame is 32x32 cells and a
   * tile is still ~64 px at 2048 px, i.e. a motif rather than noise). The tile
   * cap above is what actually binds for wide frames. */
  const MAX_DENSITY_STEP = 32;
  /* How coarse the density-1 lattice is allowed to be, counted in cells across
   * the frame's SHORT edge. See latticeBase. */
  const LATTICE_SHORT_MAX = 4;

  const HASH_KEYS = {
    tiling: 't', n: 'n', splits: 'sp',
    maxd: 'md', seed: 'sd', motifs: 'm', pal: 'p', c1: 'c1', c2: 'c2',
    bg: 'bg', pad: 'pd', format: 'F', res: 'rs', fw: 'fw', fh: 'fh', tab: 'tb',
    /* A shader ground is shareable: the field is a pure function of time, the
     * frame's size, the seed and these four numbers, so a link reopens on the
     * same field at the same phase — only the clock under it keeps running. */
    ground: 'gr', shader: 'sh', shSpeed: 'ss', shScale: 'sc', shMix: 'sm',
    scrim: 'sr',
    /* The same argument for ink: a field-ink picture is a function of the tiling,
     * the frame, the seed, the ink the engine drew and these five numbers. */
    ink: 'ik', inkShader: 'ikf', inkSpeed: 'iksp', inkScale: 'iksz',
    inkPig: 'ikc', inkRelief: 'ikr'
  };
  function writeHash() {
    const p = new URLSearchParams();
    for (const [k, h] of Object.entries(HASH_KEYS)) {
      p.set(h, Array.isArray(S[k]) ? S[k].join(',') : S[k]);
    }
    /* A tab may add its own shareable asks. The Generator's live in S; the Fill
     * tab's live in the tab, and a tab whose input cannot be shared (Photo's
     * image) shares nothing and simply reopens asking for it. */
    const share = tabDef().share;
    if (share) {
      for (const [k, v] of Object.entries(share() || {})) p.set(k, v);
    }
    location.hash = p.toString();
  }
  function readHash() {
    // A literal '+' in a hash decodes as a space, which would silently kill the
    // '+' motif (writeHash percent-encodes it, typed or old links do not).
    const p = new URLSearchParams(location.hash.slice(1).replace(/\+/g, '%2B'));
    for (const [k, h] of Object.entries(HASH_KEYS)) {
      if (p.has(h)) {
        const v = p.get(h);
        if (Array.isArray(DEFAULTS[k])) S[k] = v.split(',').filter(Boolean);
        else if (typeof DEFAULTS[k] === 'boolean') S[k] = (v === '1' || v === 'true');
        else S[k] = (k in DEFAULTS && typeof DEFAULTS[k] === 'number') ? +v : v;
      }
    }
  }
  /* One raw ask from the link, for a tab's own keys. Null when absent, so a tab
   * can tell "not in the link" from "in the link as zero". */
  function hashGet(key) {
    const p = new URLSearchParams(location.hash.slice(1).replace(/\+/g, '%2B'));
    return p.has(key) ? p.get(key) : null;
  }

  /* ================= frame geometry ================= */
  const clamp = T.clamp;                     // one implementation, in the engine
  function gcd(a, b) {
    a = Math.abs(a); b = Math.abs(b);
    while (b) { const t = b; b = a % b; a = t; }
    return a || 1;
  }
  /* Continued-fraction convergents of w:h — the integer ratios that approximate
   * it best at each size, running coarsest ([1,1]) to exact, every one already
   * in lowest terms. A square lattice can only lie on a rational ratio, and a
   * convergent is the coarsest grid that still lands near it, which is exactly
   * what a frame needs when its own p x q is finer than the picture wants. */
  function convergents(w, h) {
    const out = [];
    let a = w, b = h, hh0 = 0, hh1 = 1, kk0 = 1, kk1 = 0;
    for (let it = 0; it < 40 && b > 1e-9; it++) {
      const ai = Math.floor(a / b);
      const hh2 = ai * hh1 + hh0, kk2 = ai * kk1 + kk0;
      out.push([hh2, kk2]);
      hh0 = hh1; hh1 = hh2; kk0 = kk1; kk1 = kk2;
      const r = a - ai * b; a = b; b = r;
    }
    return out;
  }
  /* Reduce w:h to integer p:q; if that needs sides bigger than 'limit', fall
   * back to the best continued-fraction convergent within the limit. */
  function reduceRatio(w, h, limit) {
    const g = gcd(w, h), p0 = w / g, q0 = h / g;
    if (Number.isInteger(p0) && Number.isInteger(q0) && Math.max(p0, q0) <= limit) {
      return [p0, q0];
    }
    let best = [1, 1];
    for (const [c, r] of convergents(w, h)) {
      if (Math.max(c, r) > limit) break;      // convergents only ever grow
      best = [c, r];
    }
    return best;
  }
  function framePx() {                 // exact pixel size of preview and export
    if (S.format === 'custom') {
      return [clamp(Math.round(S.fw), 32, 8192), clamp(Math.round(S.fh), 32, 8192)];
    }
    /* Presets: the long edge is exactly the chosen resolution (1K / 2K / 4K),
     * the short edge is the frame ratio applied to it. Any sub-pixel ratio
     * residue is absorbed by cover scaling in drawScene. */
    const [p, q] = FRAME_FORMATS[S.format] || [1, 1];
    const res = clamp(Math.round(S.res), 64, 8192);
    return p >= q
      ? [res, Math.max(1, Math.round(res * q / p))]
      : [Math.max(1, Math.round(res * p / q)), res];
  }
  function frameRatio() {              // frame ratio as integers p:q
    if (S.format === 'custom') {
      const [w, h] = framePx();
      return reduceRatio(w, h, MAX_LATTICE_SIDE);
    }
    return FRAME_FORMATS[S.format] || [1, 1];
  }
  /* The lattice density 1 stands on, which for a wide frame is NOT its own p x q.
   *
   * Square tiles can only cover a p:q frame in multiples of p x q, so the frame's
   * reduced grid is the FINEST lattice that fits it exactly — and on a wide frame
   * that grid is far finer than the picture someone means when they ask for the
   * coarsest setting. 16:9 at density 1 used to open on 16 x 9 = 144 cells: a
   * tile 1/9 of the short edge, against a 1:1 frame whose single tile is the
   * whole frame. The same number meant pictures that were never comparable.
   *
   * So a frame starts on the finest convergent of its ratio that stays under
   * LATTICE_SHORT_MAX cells across the short edge. The ratio residue that costs
   * is absorbed by cover fit, and a candidate is only allowed while the frame's
   * window still contains the whole lattice rectangle — the cut may only take
   * arc-wing overhang (WING_MARGIN of a lattice unit per side, engine.js) and
   * never a tile square. 16:9 lands on 7 x 4: 1.6% off the ratio, cover fit
   * trims 0.37 of a cell in all when 2.87 cells' worth of wing sticks out, the
   * tiles are four times bigger, and there are nine density steps instead of
   * four.
   *
   * The frame's exact grid is always within the cap for every preset, so a
   * frame whose short edge is already coarse enough — 1:1, 4:3, 5:4, 3:2, 2:1,
   * 7:3 — is untouched. A custom ratio so strange that even its coarsest safe
   * convergent is over the cap keeps its exact grid rather than distorting the
   * frame further.
   *
   * What the coarse grid costs is a fraction of the frame's ratio, so it is
   * paid on the SHORT edge only: latticeAt re-derives the long edge at every
   * density instead of scaling both edges together, which is what holds that
   * fraction under half a cell however fine the lattice gets. */
  function latticeBase() {
    const [p, q] = frameRatio();
    const arF = p / q, W = T.WING_MARGIN;
    /* Cover fit scales the lattice bounds (the lattice rect plus each side's
     * wing overhang) up to the frame and centres the window on them. Whichever
     * axis binds is whole by construction; the other is short by
     * |cols - rows*arF| lattice units, and the slack it can lose is the wing
     * overhang of the binding axis — 2*W on a short-axis cut, 2*arF*W converted
     * across when the wide axis is the one that binds. Past that the window
     * stops containing a tile square and the crop starts eating the tiling. */
    let best = null;
    for (const [c, r] of convergents(p, q)) {
      if (Math.min(c, r) > LATTICE_SHORT_MAX) break;     // convergents only grow
      const deficit = c - arF * r;          // +: lattice too wide, -: too tall
      if (deficit > 2 * arF * W + 1e-9) continue;
      if (-deficit > 2 * W + 1e-9) continue;
      if (!best || c * r > best[0] * best[1]) best = [c, r];
    }
    return best || [p, q];
  }
  /* The base lattice at density step t: the SHORT edge scales by t, the long
   * edge is re-derived from the frame's ratio and rounded to whole cells.
   *
   * Scaling both edges (p*t x q*t) keeps a lattice similar to its frame, which
   * is exact for the frame's own grid and wrong for a coarse stand-in: the
   * ratio error is then a fraction of the lattice, so it grows with density
   * until it is the size of a cell — 16:9 on 7 x 4 is 1.6% off at x1, which is
   * 0.11 of a cell, and 1.6 cells at x9. Cover fit can absorb the wing overhang
   * (2 * WING_MARGIN of a lattice unit) and no more, so past about x6 that
   * lattice began cutting through the outer row of tile squares.
   *
   * Rounding the long edge per step bounds that error by half a cell at every
   * density, and it pulls the lattice back towards the frame's ratio as it gets
   * finer: 16:9 runs 7x4 (1.6% off) -> 21x12 -> 43x24 -> 64x36, which is 16:9
   * exactly. The coarsest setting is where the frame is bent most, and it is
   * the setting the cut check in latticeBase is written for. */
  function latticeAt(bc, br, t) {
    const [p, q] = frameRatio();
    const arF = p / q;
    if (arF >= 1) {                       // wide frame: short edge is the rows
      const rows = br * t;
      return { cols: Math.max(rows, Math.round(arF * rows)), rows, t };
    }
    const cols = bc * t;                  // tall frame: short edge is the columns
    return { cols, rows: Math.max(cols, Math.round(cols / arF)), t };
  }
  function tilingFor(L) {         // tiles a given lattice actually emits
    switch (S.tiling) {
      case 'chk': return T.checkerboardTiling(L.cols, L.rows);
      case 'grid': return T.gridTiling(L.rows, L.cols);
      case 'rand': {
        /* Same process as RandomSquareSubdivisionTiling, but seeded from the
         * frame lattice so the whole rectangle gets subdivided; 'splits' is
         * normalized per 10 tiles so density does not depend on frame size. */
        const rnd = T.mulberry32(T.seedFromString(S.seed));
        const nSplit = Math.max(1, Math.round(S.splits * L.cols * L.rows / 10));
        return T.randomSubdivision(rnd, nSplit, S.maxd, T.gridTiling(L.rows, L.cols));
      }
      case 'sur': return T.surroundTiling(L.cols, L.rows);
      case 'off': return T.offsetSurroundTiling(L.rows, L.cols);  // (rows, cols)
    }
    return T.checkerboardTiling(4, 4);
  }
  let maxTCache = { key: '', val: 1 };
  function latticeMaxT() {              // highest density step within the caps
    const [bc, br] = latticeBase();
    const [p, q] = frameRatio();
    const randPart = (S.tiling === 'rand') ? ':' + S.splits + ':' + S.maxd : '';
    const key = S.tiling + ':' + bc + ':' + br + ':' + p + ':' + q + randPart;
    if (maxTCache.key === key) return maxTCache.val;
    /* The side cap is pure geometry. The tile cap needs this tiling's own
     * expansion factor - how many tiles one cell produces - measured on the
     * base lattice instead of assumed, then verified against the real tiling
     * because the expansion is not exactly constant. The estimate is only an
     * estimate, so the step it suggests is walked back until the lattice this
     * frame actually gets is inside both caps. */
    const longBase = Math.max(bc, br), shortBase = Math.min(bc, br);
    const bySide = Math.max(1, Math.floor(MAX_LATTICE_SIDE / longBase));
    const ratio = Math.max(1, tilingFor(latticeAt(bc, br, 1)).length / (bc * br));
    let t = Math.max(1, Math.min(MAX_DENSITY_STEP, bySide,
      Math.floor(Math.sqrt(MAX_LATTICE_TILES / (ratio * bc * br)))));
    for (; t > 1; t--) {
      const L = latticeAt(bc, br, t);
      if (L.cols > MAX_LATTICE_SIDE || L.rows > MAX_LATTICE_SIDE) continue;
      if (tilingFor(L).length <= MAX_LATTICE_TILES) break;
    }
    maxTCache = { key, val: Math.max(1, t) };
    return Math.max(1, t);
  }
  function lattice() {                 // tiling units: cols x rows covering the frame
    /* Square tiles only tile a frame's rectangle in multiples of its own grid
     * (or of the coarser lattice standing in for it, see latticeBase), so the
     * density control is that multiplier - and the long edge is re-derived at
     * each step, see latticeAt. */
    const [bc, br] = latticeBase();
    const t = clamp(Math.round(S.n) || 1, 1, latticeMaxT());
    return latticeAt(bc, br, t);
  }

  /* ================= tiling + pickTile ================= */
  function buildTiling() {
    const def = tabDef();
    return def.tiles ? def.tiles(lattice()) : tilingFor(lattice());
  }
  /* The motif cells form a pool: one cell = that motif everywhere, several
   * cells (ctrl+click) = one of them chosen at random per tile, exactly like
   * 'mix' but restricted to the chosen subset. 'mix' means every motif there
   * is - the count is read from the engine rather than written here, so the
   * wording stays true when a family is added. */
  function motifPool() {
    const sel = (S.motifs || []).filter(
      (m) => m === 'mix' || T.MOTIF_NAMES.includes(m));
    if (!sel.length) return ['/'];
    if (sel.includes('mix')) return T.MOTIF_NAMES.slice();
    return sel;
  }
  function buildPicker(tiles) {
    const pool = motifPool();
    if (pool.length === 1) {
      const idx = T.connIdxByName(pool[0]) || T.connIdxByName('/');
      return () => idx;
    }
    /* stable per-tile assignment: sorted coords + a PRNG stream salted by the
     * pool, so the layout is reproducible for a seed and changes when the
     * selection changes */
    const full = pool.length === T.MOTIF_NAMES.length;
    const salt = full ? '\u0001mix' : '\u0001pool:' + pool.join(',');
    const rnd = T.mulberry32(T.seedFromString(S.seed + salt));
    const map = new Map();
    const sorted = tiles.slice().sort(
      (a, b) => (a.x - b.x) || (a.y - b.y) || (a.s - b.s));
    for (const t of sorted) {
      const name = pool[Math.floor(rnd() * pool.length)];
      map.set(t.x + ',' + t.y + ',' + t.s, T.NAMED_TILES[name]);
    }
    return (depth, t) => map.get(t.x + ',' + t.y + ',' + t.s) ||
      T.connIdxByName('/');
  }
  /* The two colours a tile paints with, per depth: [circuits drawn on top,
   * circuits drawn under]. The engine composites a tile as two opaque colour
   * classes that together cover 0.98-0.99 of its square, so the second entry IS
   * the ground seen inside the tile — which is the handle a shader ground needs.
   * With a field running, the under class turns fully transparent: the tile stops
   * repainting its own square, the field behind it shows through, and only the
   * ink class is painted. Nothing about the tile list reaches the field, so it
   * stays one continuous picture rather than one gradient per cell. */
  const CLEAR = 'rgba(0,0,0,0)';
  function shaderOn() {
    return S.ground === 'shader' && !!groundGl && !groundFailed;
  }
  function paletteColors() {            // [ink, ground] as #hex, whichever palette
    if (S.pal === 'custom') return [S.c1, S.bg];
    const p = T.PALETTES[S.pal] || T.PALETTES.bw;
    return [p[0], p[1]];
  }
  function buildPalette(tiles, pass) {
    /* Which of the two circuit classes a pass is allowed to paint. Normally both.
     * A field ground hides the under class so the field shows through; a field ink
     * needs two passes over the same geometry - one that paints only the ink class
     * (that render becomes the mask the field is poured into) and one that paints
     * everything but the ink class (the canvas the field sits on). */
    const clear = (pass === 'mask') || shaderOn();
    const clearInk = pass === 'noInk';
    if (S.pal !== 'custom') {
      const p = T.PALETTES[S.pal] || T.PALETTES.bw;
      return [clearInk ? CLEAR : p[0], clear ? CLEAR : p[1]];
    }
    let maxD = 0;
    for (const t of tiles) maxD = Math.max(maxD, T.tileDepth(t));
    maxD = Math.max(1, maxD);
    return (depth) => [
      clearInk ? CLEAR : T.lerpColor(S.c1, S.c2, depth / maxD),
      clear ? CLEAR : S.bg
    ];
  }

  /* ================= animated ground =================
   * Two canvases, not one: a canvas has either a 2D or a WebGL context, so the
   * field cannot be drawn into the tile canvas. #groundCanvas carries the GL
   * field, #mainCanvas carries the tiles over it with its light class left
   * transparent (see buildPalette), and the two are sized identically so the
   * stack is exact. */
  const groundCanvas = document.getElementById('groundCanvas');
  let groundGl = null;
  let groundFailed = false;
  const groundClock = document.createElement('canvas');   // export-sized field
  let groundClockGl = null;             // its GL partner, made once on demand
  let groundPhase = 0, groundLast = 0, groundRAF = 0;

  /* The seed drives the field too: the same seed gives the same blob positions
   * and the same palette offsets, so a link's ground is as much its own as its
   * tiling is, and 'new seed' moves both together. */
  const fieldSeed = () =>
    (T.seedFromString(S.seed) % 100003) / 100003;

  function ensureGroundGL(canvasEl) {
    if (!SH || !SH.createGround) { groundFailed = true; return null; }
    const g = SH.createGround(canvasEl);
    if (!g || !g.ok) {
      groundFailed = true;
      showError((g && g.reason) || 'Could not start the shader ground.');
      return null;
    }
    return g;
  }
  /* The colour the frame's background is made of. Under a shader ground the
   * palette's second entry is transparent - it is the class the field shows
   * through - so the ground colour has to be asked for from the frame, not read
   * out of the tile palette. */
  function fieldGroundColor() {
    if (S.pal === 'custom') return S.bg;
    const p = T.PALETTES[S.pal] || T.PALETTES.bw;
    return p[1];
  }

  function pushParams(g) {
    if (!g) return;
    const [ink] = paletteColors();
    g.setParams({
      scale: clamp(+S.shScale || 1, 0.2, 6),
      mix: clamp(+S.shMix || 0, 0, 100) / 100,
      scrim: clamp(+S.scrim || 0, 0, 100) / 100,
      a: SH.hexToRGB(ink), b: SH.hexToRGB(fieldGroundColor()),
      seed: fieldSeed()
    });
    /* Set the program last: setParams must land on whatever shader ends up
     * current, and setShader recompiles the program uniforms belong to. */
    if (g.key !== S.shader) {
      const r = g.setShader(SH.keyFor(S.shader));
      if (r !== true) {
        groundFailed = true;
        showError('Shader failed to compile: ' + r.error);
      } else if (groundFailed) {
        groundFailed = false; clearError();
      }
    }
  }
  /* Called from onChange, i.e. whenever anything in the state moved. */
  function syncGround() {
    if (S.ground !== 'shader') { groundFailed = false; return; }
    if (!groundGl && !groundFailed) groundGl = ensureGroundGL(groundCanvas);
    pushParams(groundGl);
  }

  /* ================= ink painted by a field =================
   * The ink is the shape, so the field is not allowed to draw any of it. The
   * engine draws the tiles into inkMask exactly as it always did - same lattice,
   * same transform, same circuits, same wing rules, same per-depth ink colour - and
   * only the *colour* of that render is replaced: #inkCanvas is the same field the
   * ground can use, told to paint only where the mask has ink, and to keep the
   * ink's own lightness (see INK_MAIN in src/shaders.js). #mainCanvas then draws
   * the picture with its ink class left out, and the field canvas sits over it.
   *
   * Two canvases rather than repainting the tiles every frame: re-rendering the
   * geometry at 60 Hz to animate an ink colour is the expensive way to do something
   * a texture upload already did once, and it would put the shape at the mercy of a
   * second drawing path. The mask is uploaded when the picture changes, not when the
   * clock ticks. */
  const inkCanvas = document.getElementById('inkCanvas');
  const inkMask = document.createElement('canvas');
  let inkGl = null, inkFailed = false;
  let inkPhase = 0;
  const inkClock = document.createElement('canvas');    // export-sized ink field
  const inkClockMask = document.createElement('canvas');
  let inkClockGl = null;

  function inkOn() { return S.ink === 'shader' && !!inkGl && !inkFailed; }

  function ensureInkGL(canvasEl) {
    if (!SH || !SH.createGround) { inkFailed = true; return null; }
    const g = SH.createGround(canvasEl, 'ink');
    if (!g || !g.ok) {
      inkFailed = true;
      showError((g && g.reason) || 'Could not start the shader ink.');
      return null;
    }
    return g;
  }

  function pushInkParams(g) {
    if (!g) return;
    const [ink, ground] = paletteColors();
    g.setParams({
      scale: clamp(+S.inkScale || 1, 0.2, 6),
      mix: clamp(+S.inkPig || 0, 0, 100) / 100,
      relief: clamp(+S.inkRelief || 0, 0, 100) / 100,
      /* u_b is the ground the ink has to be read against, because relief is
       * measured as a share of that gap. u_a is unused by the ink program - the ink's
       * colour arrives per pixel through the mask, including the way it drifts along
       * the custom ramp by depth, which a uniform cannot carry. */
      a: SH.hexToRGB(ink), b: SH.hexToRGB(ground),
      seed: fieldSeed()
    });
    if (g.key !== S.inkShader) {
      const r = g.setShader(SH.keyFor(S.inkShader));
      if (r !== true) {
        inkFailed = true;
        showError('Ink field failed to compile: ' + r.error);
      } else if (inkFailed) { inkFailed = false; clearError(); }
    }
  }

  function syncInk() {
    if (S.ink !== 'shader') { inkFailed = false; return; }
    if (!inkGl && !inkFailed) inkGl = ensureInkGL(inkCanvas);
    pushInkParams(inkGl);
  }

  /* The ink as the engine draws it: same geometry, ink class only, nothing behind
   * it. Its rgb is the ink colour chosen and its alpha is where the ink lands. */
  function paintInkMask(target, maskCanvas, w, h, tiles) {
    maskCanvas.width = w; maskCanvas.height = h;
    drawScene(maskCanvas, tiles, w, h, null, 'mask');
    const r = target.setMask(maskCanvas);
    if (r !== true) { inkFailed = true; showError('Ink field: ' + r.error); return false; }
    return true;
  }

  /* One frame of field-ink over the tile canvas. Returns true when the ink class
   * was left out of #mainCanvas, which is what tells drawScene not to paint it. */
  function paintInk(w, h, tiles) {
    if (!inkOn()) { inkCanvas.style.display = 'none'; return false; }
    if (!tiles || !tiles.length) { inkCanvas.style.display = 'none'; return false; }
    inkCanvas.style.display = 'block';
    inkCanvas.style.width = canvas.style.width;
    inkCanvas.style.height = canvas.style.height;
    inkGl.resize(w, h);
    if (!paintInkMask(inkGl, inkMask, w, h, tiles)) { inkCanvas.style.display = 'none'; return false; }
    if (!reportShape(inkGl.setShape(paintShapeImage(shapeCanvas, w, h, tiles)), 'ink')) {
      inkFailed = true; inkCanvas.style.display = 'none'; return false;
    }
    if (!inkGl.render(inkPhase)) { inkCanvas.style.display = 'none'; return false; }
    startGroundLoop();
    return true;
  }

  /* The field-ink at export size, mask and all: the file has to carry the same ink
   * the preview shows, at the export's own pixel size rather than as an upscaled
   * copy of the preview. */
  function inkFieldSnapshot(w, h) {
    if (!inkOn()) return null;
    if (!inkClockGl) {
      inkClockGl = ensureInkGL(inkClock);
      if (!inkClockGl) return null;
    }
    pushInkParams(inkClockGl);
    inkClockGl.resize(w, h);
    if (!paintInkMask(inkClockGl, inkClockMask, w, h, buildTiling())) return null;
    if (!reportShape(inkClockGl.setShape(paintShapeImage(shapeClock, w, h, buildTiling())), 'ink')) return null;
    if (!inkClockGl.render(inkPhase)) return null;
    return inkClock;
  }

  /* ================= the shape a field paints =================
   * Only the Fill tab has a shape, but both fields can be told about one: the
   * contour a shader lights up has to be the same contour the quadtree
   * subdivided, and the only way to guarantee that is to paint the shape through
   * the very transform the tiles were drawn with - fitTransform - instead of
   * deriving a position for it a second time somewhere else. A fit computed
   * twice is a contour painted in the wrong place, and that is exactly the kind
   * of bug nobody notices until the rim is off by a tile.
   *
   * Two channels, both already computed once per mask in src/fill.js: r is how
   * covered a point is, g is the signed distance to the contour with 128 exactly
   * on it. The image is drawn into a canvas the size of the frame it belongs to,
   * so the shader samples it the same way it samples the ink mask - no mapping
   * uniforms, and nothing in the shader can get the aspect or the crop wrong.
   *
   * One canvas per size is painted once per render and read by both fields: the
   * ground and the ink are told about the same shape, at the same size, from the
   * same tiles. */
  const shapeCanvas = document.createElement('canvas');
  const shapeClock = document.createElement('canvas');   // the export's own size
  let shapeLast = null;                                   // {target, w, h, tiles, out}

  function paintShapeImage(target, w, h, tiles) {
    if (shapeLast && shapeLast.target === target && shapeLast.w === w &&
        shapeLast.h === h && shapeLast.tiles === tiles) return shapeLast.out;
    const def = tabDef();
    let out = null;
    const fit = def.shapeImage ? fitTransform(tiles, w, h) : null;
    if (fit) {
      const sh = def.shapeImage();
      if (sh && sh.img && sh.x1 > sh.x0 && sh.y1 > sh.y0) {
        target.width = w; target.height = h;
        const cx = target.getContext('2d');
        cx.setTransform(1, 0, 0, 1, 0, 0);
        cx.clearRect(0, 0, w, h);
        /* Smoothing on: the distance is a chamfer transform of a 512 grid, so a
         * resampled rim is still a smooth ramp rather than a staircase of the
         * sampling grid showing through the field. */
        cx.imageSmoothingEnabled = true;
        cx.imageSmoothingQuality = 'high';
        cx.setTransform(fit.s, 0, 0, -fit.s, -fit.s * fit.wx0, h + fit.s * fit.wy0);
        cx.translate(sh.x0, sh.y1);        // the box's top-left, in lattice space
        cx.scale(1, -1);                   // image row 0 is that box's top edge
        cx.drawImage(sh.img, 0, 0, sh.x1 - sh.x0, sh.y1 - sh.y0);
        cx.setTransform(1, 0, 0, 1, 0, 0);
        out = target;
      }
    }
    shapeLast = { target, w, h, tiles, out };
    return out;
  }

  /* A shape that never arrived and a shape given at the wrong size look the same
   * on screen - the field merely stops following the contour - so the mismatch
   * says so instead of being absorbed. */
  function reportShape(res, which) {
    if (res === true) return true;
    showError((which === 'ink' ? 'Ink field: ' : 'Ground field: ') + res.error);
    return false;
  }
  /* The field's clock advances by dt * speed rather than wall-time * speed: a
   * phase accumulator means moving the speed slider changes how fast the field
   * runs from here without jumping it to another frame. */
  function groundStep(dt) {
    groundPhase += dt * clamp(+S.shSpeed || 0, 0, 4);
    inkPhase += dt * clamp(+S.inkSpeed || 0, 0, 4);
  }
  function stopGroundLoop() {
    if (groundRAF) cancelAnimationFrame(groundRAF);
    groundRAF = 0;
  }
  function startGroundLoop() {
    if (groundRAF) return;
    groundLast = 0;
    const frame = (ts) => {
      /* An animating canvas behind an invisible tab is pure GPU burn: the loop
       * sleeps while the page is backgrounded and resumes where it left off. */
      if (document.hidden) { groundRAF = requestAnimationFrame(frame); groundLast = 0; return; }
      if (!shaderOn() && !inkOn()) { groundRAF = 0; return; }
      const dt = groundLast ? Math.min(0.1, (ts - groundLast) / 1000) : 0;
      groundLast = ts;
      groundStep(dt);
      if (shaderOn()) {
        groundGl.resize(canvas.width, canvas.height);
        groundGl.render(groundPhase);
      }
      /* The ink canvas is not resized here: a resize would drop the mask it was
       * given, and the mask only changes when the picture does - which is paintInk's
       * job, on redraw, not the clock's. */
      if (inkOn()) inkGl.render(inkPhase);
      groundRAF = requestAnimationFrame(frame);
    };
    groundRAF = requestAnimationFrame(frame);
  }
  /* Paint one frame of the field on its own canvas under the tile canvas.
   * Returns whether the ground is a field, so drawScene knows not to paint a
   * flat ground rect over the canvas that is already showing one.
   *
   * The tiles are asked for, not assumed: a field that lights up a shape's
   * contour can only be told where the contour is in the same pixels the tiles
   * were drawn into (see paintShapeImage). A ground with no tiles to be told - a
   * tab that is not ready yet - falls back to the frame's own edge, which is a
   * shape too. */
  function paintGround(w, h, tiles) {
    if (!shaderOn()) {
      groundCanvas.style.display = 'none';
      /* The same animation loop drives both fields, so it only stops when
       * neither of them is moving. */
      if (!inkOn()) stopGroundLoop();
      return false;
    }
    groundCanvas.style.display = 'block';
    groundCanvas.style.width = canvas.style.width;
    groundCanvas.style.height = canvas.style.height;
    groundGl.resize(w, h);
    reportShape(groundGl.setShape(paintShapeImage(shapeCanvas, w, h, tiles)), 'ground');
    groundGl.render(groundPhase);
    startGroundLoop();
    return true;
  }
  /* The field alone, at export size, for compositing into the exported PNG.
   * u_res is the canvas itself, so a 3840x2160 export gets the same field the
   * preview shows — the same world units per pixel, not a stretched copy. */
  function fieldSnapshot(w, h) {
    if (!shaderOn()) return null;
    if (!groundClockGl) {
      groundClock.width = w; groundClock.height = h;
      groundClockGl = ensureGroundGL(groundClock);
      if (!groundClockGl) return null;
    }
    if (groundClock.width !== w || groundClock.height !== h) {
      groundClock.width = w; groundClock.height = h;
    }
    groundClockGl.setShader(SH.keyFor(S.shader));
    pushParams(groundClockGl);
    groundClockGl.resize(w, h);
    reportShape(groundClockGl.setShape(paintShapeImage(shapeClock, w, h, buildTiling())), 'ground');
    groundClockGl.render(groundPhase);
    return groundClock;
  }

  /* ================= main view ================= */
  const canvas = document.getElementById('mainCanvas');
  const ctx = canvas.getContext('2d');
  let lastDpr = 0;
  function worldBounds(tiles) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const t of tiles) {
      const m = t.s * T.WING_MARGIN;   // wings reach exactly s/3 (as in fitTransform)
      x0 = Math.min(x0, t.x - m); y0 = Math.min(y0, t.y - m);
      x1 = Math.max(x1, t.x + t.s + m); y1 = Math.max(y1, t.y + t.s + m);
    }
    const p = (S.pad / 100) * (x1 - x0);
    return [x0 - p, y0 - p, x1 + p, y1 + p];
  }
  /**
   * The window the tiles are drawn into, in world units: cover fit, so the
   * bounds are scaled to cover the frame and the excess is trimmed evenly off
   * both sides. Those bounds are the tile rect plus the arc wings that hang off
   * its edges, so the window is always wider and taller than the lattice itself
   * and the trim can only ever reach that wing overhang - no square of the grid
   * is cut, whatever lattice the frame stands on.
   *
   * One function because three things have to land on the same pixels as the
   * tiles - the ground field, the ink mask and the shape a field paints - and a
   * fit derived twice is a contour painted in the wrong place. Returns null for
   * a tab with nothing to fit and for degenerate bounds.
   */
  function fitTransform(tiles, w, h) {
    if (!tiles || !tiles.length) return null;
    const [x0, y0, x1, y1] = (tabDef().viewBounds || worldBounds)(tiles);
    const bw = x1 - x0, bh = y1 - y0;
    /* Degenerate bounds would flow into s = -0 and then into setTransform, and a
     * zero-or-NaN matrix makes every later draw do nothing without an error - the
     * silent black stage. Show it instead of hiding it. */
    if (!(bw > 0 && bh > 0) || !Number.isFinite(bw) || !Number.isFinite(bh)) return null;
    if (!(w > 0 && h > 0)) return null;
    const s = Math.max(w / bw, h / bh);
    const winW = w / s, winH = h / s;
    return {
      s, winW, winH,
      wx0: (x0 + x1) / 2 - winW / 2,
      wy0: (y0 + y1) / 2 - winH / 2
    };
  }

  /* What lies under the tiles, for one pass of drawScene:
   *   null            no field: the ground is one flat rect, as it always was
   *   'under'         a field is on the canvas below this one: paint nothing, and
   *                   keep the tile canvas transparent where no ink lands so that
   *                   field reads through the ink instead of being copied under it
   *   a canvas        a field handed over as an image, for the export pass
   */
  function drawScene(c, tiles, w, h, ground, pass) {
    const cx = c.getContext('2d');
    cx.setTransform(1, 0, 0, 1, 0, 0);
    cx.globalAlpha = 1;
    cx.clearRect(0, 0, w, h);
    if (pass === 'mask') { /* the ink mask must be transparent wherever there is no ink,
                            * so nothing goes behind it: not a ground, not even a colour */ }
    else if (ground === 'under') { /* the ground canvas below carries it */ }
    else if (ground) cx.drawImage(ground, 0, 0, w, h);
    else { cx.fillStyle = paletteColors()[1]; cx.fillRect(0, 0, w, h); }
    /* The scrim is not applied here: it is part of the ground, folded into the
     * field by the shader's own tail, so the preview and the export carry the
     * same ground once instead of an overlay applied through whichever path
     * happened to draw the frame. */
    if (!tiles.length) return;   // ground only; there is nothing to fit
    const fit = fitTransform(tiles, w, h);
    if (!fit) {
      showError('This tab produced no drawable geometry.');
      const info = document.getElementById('frameInfo');
      if (info) info.textContent = 'nothing to draw';
      return;
    }
    clearError();
    cx.setTransform(fit.s, 0, 0, -fit.s, -fit.s * fit.wx0, h + fit.s * fit.wy0);
    T.renderTiling(cx, tiles, {
      pickTile: (tabDef().picker || buildPicker)(tiles),
      palette: buildPalette(tiles, pass),
      bounds: [fit.wx0, fit.wy0, fit.wx0 + fit.winW, fit.wy0 + fit.winH]
    });
    /* Leave the context as it was found. A caller that draws a full-frame overlay
     * onto this canvas after the fact - the export compositing the ink field - would
     * otherwise draw through the lattice transform without meaning to. */
    cx.setTransform(1, 0, 0, 1, 0, 0);
  }
  function updateFrameInfo(tiles) {
    const el = document.getElementById('frameInfo');
    if (!el) return;
    const L = lattice(), [fw, fh] = framePx();
    const unit = (S.tiling === 'sur' || S.tiling === 'off') ? 'units' : 'cells';
    const step = L.t > 1 ? ' · ×' + L.t : '';
    const drawn = (tiles && tiles.length) || buildTiling().length;
    el.textContent = `${L.cols} × ${L.rows} ${unit}${step} · ${drawn} tiles · ${fw} × ${fh} px`;
  }
  function renderMain() {
    const dpr = window.devicePixelRatio || 1;
    const [fw, fh] = framePx();
    const ar = fw / fh;
    /* A frame that is not two finite, positive numbers used to reach the canvas
     * as a NaN height: Math.round(NaN * dpr) is NaN, and assigning NaN to
     * canvas.height coerces to 0 - a backing store that can hold nothing while
     * the CSS box still looked right, so the stage went black and the console
     * stayed silent. Refuse the size, say so, and keep the last good one. */
    if (!Number.isFinite(ar) || ar <= 0) {
      showError('Frame size is not a usable number - fix the frame fields.');
      const cx = canvas.getContext('2d');
      if (canvas.width && canvas.height) cx.clearRect(0, 0, canvas.width, canvas.height);
      const info = document.getElementById('frameInfo');
      if (info) info.textContent = 'frame: unresolved';
      return;
    }
    clearError();
    /* Preview = the export frame, scaled to fit the visible stage, so what you
     * see is what the PNG will be (same lattice, same crop-free fill). */
    const stage = document.getElementById('stage');
    const availW = Math.max(60, stage.clientWidth - 24);
    const availH = Math.max(60, stage.clientHeight - 24);
    let cw = availW, ch = cw / ar;
    if (ch > availH) { ch = availH; cw = ch * ar; }
    canvas.style.width = cw.toFixed(1) + 'px';
    canvas.style.height = ch.toFixed(1) + 'px';
    const w = Math.round(cw * dpr), h = Math.round(ch * dpr);
    if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
      canvas.width = w; canvas.height = h;
    }
    if (dpr !== lastDpr) {   // browser zoom changes devicePixelRatio
      lastDpr = dpr;
      paintPreviews();
    }
    const def = tabDef();
    /* The ground is painted first and independently: it is a full-frame field
     * that does not care what the tiling is, and a tab that is not ready yet
     * (Photo with no image chosen) still gets the ground it will have once it
     * is. The empty-stage branches below therefore keep the same ground. */
    const field = paintGround(w, h, def.ready() ? buildTiling() : []) ? 'under' : null;
    if (!def.ready()) {
      /* Nothing to draw yet (Photo with no image chosen): paint just the
       * ground, so the stage still shows the frame and its real colour. */
      drawScene(canvas, [], w, h, field);
      const info = document.getElementById('frameInfo');
      if (info) info.textContent = def.emptyMessage;
      if (def.onRedraw) def.onRedraw();
      return;
    }
    const tiles = buildTiling();
    /* The ink class is left out of this canvas only when the field canvas is really
     * going to paint it. A field ink that failed to compile must fall back to the
     * plain ink, not quietly draw a picture with no strokes on it. */
    const inkField = paintInk(w, h, tiles);
    drawScene(canvas, tiles, w, h, field, inkField ? 'noInk' : undefined);
    updateFrameInfo(tiles);
    if (def.onRedraw) def.onRedraw();   // a tab reports its own state here
  }

  /* ================= export ================= */
  function sanitizeMotif(m) {
    /* Filenames: motif names travel in the export name, and a name holding a
     * path separator would silently make a subdirectory (or be rejected). */
    return ({ '/': 'sl', '\\': 'bs', '|': 'vb', '+': 'pl',
      '.': 'd', '-': 'mi' })[m] || m;
  }
  function exportName(w, h) {
    const L = lattice();
    const sizePart = L.cols + 'x' + L.rows;
    const pal = S.pal === 'custom' ? 'ramp' : S.pal;
    /* A shader ground is part of the picture, so the file name says which field
     * the PNG carries: two links that differ only in their ground would
     * otherwise export files with identical names. */
    const groundPart = shaderOn() ? '_sh' + SH.keyFor(S.shader) + '_p' + pal : '_p' + pal;
    /* Field ink changes the colour of every stroke, so a file name that only named
     * the palette would let two different pictures land on the same name. */
    const inkPart = inkOn() ? '_ik' + SH.keyFor(S.inkShader) + '_k' + S.inkPig + 'r' + S.inkRelief : '';
    const pool = motifPool();
    const isMix = pool.length === T.MOTIF_NAMES.length &&
      pool.every((m, i) => m === T.MOTIF_NAMES[i]);
    const motif = isMix ? 'mix' : pool.map(sanitizeMotif).join('-');
    /* 'chk/grid/rand/sur/off' only describe the Generator's lattice; a tab that
     * builds its pictures another way supplies its own word. */
    const mode = tabDef().mode ? tabDef().mode() : S.tiling;
    return (tabDef().prefix || 'truchet_') + mode + sizePart + '_' + S.seed +
      '_m' + motif + groundPart + inkPart + '_' + w + 'x' + h + '.png';
  }
  function exportPNG() {
    const [w, h] = framePx();
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    /* The export carries the frame of the field that is on screen right now:
     * what the preview shows is what the file gets, at the export's own pixel
     * size rather than an upscaled copy of the preview. */
    const field = fieldSnapshot(w, h);
    const inkField = inkFieldSnapshot(w, h);
    drawScene(off, buildTiling(), w, h, field, inkField ? 'noInk' : undefined);
    /* over the ground and the tiles, in the same order the page stacks them.
     * drawScene leaves the context carrying the lattice's own transform - scaled and
     * flipped - so compositing a full-frame canvas after it has to put the identity
     * back first. Drawing the ink field through that transform put it entirely off
     * the canvas: a file with the ground in it and the ink nowhere. */
    if (inkField) {
      const oc = off.getContext('2d');
      oc.setTransform(1, 0, 0, 1, 0, 0);
      oc.drawImage(inkField, 0, 0);
    }
    const name = exportName(w, h);
    off.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }, 'image/png');
    document.getElementById('fileName').textContent = name;
  }

  /* ================= UI wiring ================= */
  const $ = (id) => document.getElementById(id);
  const FIELDS = {
    tiling: 'selTiling', n: 'inN', format: 'selFormat',
    fw: 'inFrameW', fh: 'inFrameH', res: 'selRes',
    splits: 'inSplits', maxd: 'inMaxd', seed: 'inSeed', pal: 'selPal',
    c1: 'inC1', c2: 'inC2', bg: 'inBg', pad: 'inPad',
    ground: 'selGround', shader: 'selShader',
    shSpeed: 'inShSpeed', shScale: 'inShScale', shMix: 'inShMix',
    scrim: 'inScrim',
    ink: 'selInk', inkShader: 'selInkShader',
    inkSpeed: 'inInkSpeed', inkScale: 'inInkScale',
    inkPig: 'inInkPig', inkRelief: 'inInkRelief'
  };
  /* The field lists are built from the ground module rather than written here, so
   * adding a field to src/shaders.js puts it in both pickers on its own: the same
   * bodies serve the ground and the ink, and a list kept twice would drift. */
  function buildShaderPicker() {
    for (const [sel, current] of [['selShader', S.shader], ['selInkShader', S.inkShader]]) {
      const el = $(sel);
      if (!el || !SH) continue;
      el.innerHTML = '';
      for (const s of SH.list) {
        const o = document.createElement('option');
        o.value = s.key; o.textContent = s.label; o.title = s.label;
        el.appendChild(o);
      }
      el.value = SH.keyFor(current);
    }
  }
  function pushToInputs() {
    $('selTiling').value = S.tiling;
    $('inN').value = S.n;              // its read-out lives in refreshParamVisibility
    $('selFormat').value = S.format;
    $('inFrameW').value = S.fw; $('inFrameH').value = S.fh;
    $('selRes').value = String(S.res);
    $('inSplits').value = S.splits; $('inMaxd').value = S.maxd;
    $('inSeed').value = S.seed; $('selPal').value = S.pal;
    $('inC1').value = S.c1; $('inC2').value = S.c2; $('inBg').value = S.bg;
    $('inPad').value = S.pad;
    $('selGround').value = S.ground;
    /* A field name the app does not know - a mistyped share link, a key left over
     * from an older build - is resolved in the state, not only in the picker, so the
     * picker, the picture on screen, the link written back out and the export name
     * all end up naming the same field instead of each picking its own. */
    $('selShader').value = S.shader = SH ? SH.keyFor(S.shader) : S.shader;
    $('inShSpeed').value = S.shSpeed; $('inShScale').value = S.shScale;
    $('inShMix').value = S.shMix; $('inScrim').value = S.scrim;
    $('selInk').value = S.ink;
    $('selInkShader').value = S.inkShader = SH ? SH.keyFor(S.inkShader) : S.inkShader;
    $('inInkSpeed').value = S.inkSpeed; $('inInkScale').value = S.inkScale;
    $('inInkPig').value = S.inkPig; $('inInkRelief').value = S.inkRelief;
  }
  function refreshParamVisibility() {
    const show = (id, on) => $(id).style.display = on ? '' : 'none';
    const def = tabDef();
    /* Each tab owns its params block; Frame / Color / Output are shared. */
    show('genParams', def.params === 'genParams');
    for (const [key, t] of Object.entries(TABS)) {
      if (t.params && t.params !== 'genParams') show(t.params, key === S.tab);
    }
    show('motifSect', def.motifs !== false);
    show('rowFrameSize', S.format === 'custom');
    show('rowRes', S.format !== 'custom');
    $('lblRes').textContent = 'long edge';
    show('rowRand', def.params === 'genParams' && S.tiling === 'rand');
    show('rowCustomPal', S.pal === 'custom');
    const field = S.ground === 'shader';
    show('rowShader', field);
    show('rowShade', field);
    const gi = $('groundInfo');
    if (gi) {
      gi.textContent = field
        ? (groundFailed
          ? 'shader ground unavailable \u2014 the flat ground colour is being used instead'
          : (SH ? SH.keyFor(S.shader) : S.shader) + ' \u00b7 speed ' + S.shSpeed +
            ' \u00b7 scale ' + S.shScale + ' \u00b7 palette ' + S.shMix +
            '% \u00b7 scrim ' + S.scrim + '%')
        : '';
    }
    const painted = S.ink === 'shader';
    show('rowInkShader', painted);
    show('rowInkShade', painted);
    const ii = $('inkInfo');
    if (ii) {
      ii.textContent = painted
        ? (inkFailed
          ? 'ink field unavailable \u2014 the plain ink colour is being used instead'
          : (SH ? SH.keyFor(S.inkShader) : S.inkShader) + ' \u00b7 speed ' + S.inkSpeed +
            ' \u00b7 scale ' + S.inkScale + ' \u00b7 pigment ' + S.inkPig +
            '% \u00b7 relief ' + S.inkRelief + '%')
        : '';
    }
    /* The density range depends on the frame: a 1:1 frame can carry far more
     * tiles than a 21:9 one before the tile caps bite. Clamping here keeps the
     * control honest instead of silently saturating. */
    const maxT = latticeMaxT();
    $('inN').max = String(maxT);
    const typed = Math.round(S.n) || 1;
    S.n = clamp(typed, 1, maxT);
    $('inN').value = S.n;
    /* Say something only when the cap has overridden what was typed. */
    $('outN').textContent = (typed !== S.n)
      ? '\u2192 ' + S.n + ' (capped by frame and tile budget)' : '';
  }
  function initTabs() {
    /* Tabs not yet registered (Photo registers itself after app.js) stay as they
     * are in the markup: disabled placeholders. registerTab() enables its own. */
    for (const b of document.querySelectorAll('#tabs button[data-tab]')) {
      if (!TABS[b.dataset.tab]) continue;
      b.disabled = false;
      b.classList.toggle('active', b.dataset.tab === S.tab);
      b.addEventListener('click', () => setTab(b.dataset.tab));
    }
  }
  function onChange() {
    /* Resolve a field name the app does not know before anything else reads the
     * state: the hash that gets written back out, the two pickers, the render, the
     * export and its file name all end up naming the same field. */
    if (SH) { S.shader = SH.keyFor(S.shader); S.inkShader = SH.keyFor(S.inkShader); }
    writeHash(); refreshParamVisibility(); syncGround(); syncInk(); renderMain();
    updateMotifSel();
  }
  for (const [k, id] of Object.entries(FIELDS)) {
    $(id).addEventListener('input', () => {
      const el = $(id);
      const raw = el.value;
      if (typeof DEFAULTS[k] === 'number') {
        /* A number box has no track to lean on, so the element's own min/max are
         * what bounds the state. A cleared or half-typed box ("", "-", "1e") is not
         * a change yet and is ignored - note that +'' is 0, so an empty box would
         * otherwise silently apply the minimum on the way to the number wanted. */
        if (el.validity && el.validity.badInput) return;
        if (!raw.trim()) return;
        const v = +raw;
        if (!Number.isFinite(v)) return;
        /* Bounds come from the element, and only where it has any. A number box
         * reads an absent attribute as ''; a <select> - the long-edge preset is
         * one - has no min/max property at all, so its value is undefined, and
         * +undefined is NaN: clamping a good value between NaN bounds silently
         * wrote NaN into the state, which reached the canvas as a zero-height
         * backing store - a black stage that logs nothing at all.
         * A select bounds its own values through framePx's clamp instead. */
        const bound = (attr) => {
          if (attr === '' || attr === undefined || attr === null) return null;
          const b = +attr;
          return Number.isFinite(b) ? b : null;
        };
        const lo = bound(el.min), hi = bound(el.max);
        S[k] = clamp(v, lo === null ? -Infinity : lo, hi === null ? Infinity : hi);
      } else {
        S[k] = raw;
      }
      onChange();
    });
  }
  $('btnNewSeed').addEventListener('click', () => {
    S.seed = T.randSeed(Math.random);
    pushToInputs(); onChange();
  });
  $('btnCopyLink').addEventListener('click', () => {
    writeHash();
    navigator.clipboard.writeText(location.href);
    $('btnCopyLink').textContent = 'copied!';
    setTimeout(() => $('btnCopyLink').textContent = 'copy link', 1200);
  });
  $('hideBtn').addEventListener('click', () => {
    document.body.classList.add('panel-hidden');
    renderMain(); setTimeout(renderMain, 300);   // stage widens as the panel slides out
  });
  $('showBtn').addEventListener('click', () => {
    document.body.classList.remove('panel-hidden');
    renderMain(); setTimeout(renderMain, 300);
  });

  /* export controls */
  $('btnExport').addEventListener('click', () => exportPNG());

  /* base lattice for the Photo tab: same lattice the Generator uses, clamped to
   * what the frame can carry before the quadtree even starts subdividing */
  function baseScale() {
    const [bc, br] = latticeBase();
    const maxT = Math.max(1, Math.min(latticeMaxT(), Math.floor(
      Math.sqrt(MAX_LATTICE_TILES / (bc * br)))));
    const v = clamp(Math.round(S.n) || 1, 1, maxT);
    return { value: v, max: maxT };
  }
  function setBaseScale(v) { S.n = +v || 1; onChange(); }

  /* motif picker: Carlson's 15 tiles from his motifs figure, and a mix cell
   * on top */
  const grid = $('motifGrid');
  let previewCanvases = [];
  function buildMotifGrid() {
    grid.innerHTML = '';
    const mix = document.createElement('canvas');
    mix.className = 'mix';
    mix.title = 'mix — random from all ' + T.MOTIF_NAMES.length +
      ' (ctrl+click to combine with others)';
    mix.dataset.motif = 'mix';
    grid.appendChild(mix);
    previewCanvases = [mix];
    for (const name of T.MOTIF_NAMES) {
      const c = document.createElement('canvas');
      c.title = name; c.dataset.motif = name;
      grid.appendChild(c);
      previewCanvases.push(c);
    }
    paintPreviews();
    previewCanvases.forEach((c) => {
      c.addEventListener('click', (ev) => {
        const name = c.dataset.motif;
        const additive = ev.ctrlKey || ev.metaKey || ev.shiftKey;
        if (!additive) {
          S.motifs = [name];                 // plain click: this motif only
        } else {
          const i = S.motifs.indexOf(name);  // ctrl/cmd/shift+click: toggle in pool
          if (i >= 0) S.motifs.splice(i, 1);
          else S.motifs.push(name);
          if (!S.motifs.length) S.motifs = [name];  // the pool is never empty
        }
        onChange();
      });
    });
  }
  /* Previews are drawn at the device pixel ratio so the shapes stay crisp
   * (a fixed 88px backing store gets resampled by the browser and the
   * thin arc junctions then look ragged / "broken"). */
  function paintPreviews() {
    const dpr = window.devicePixelRatio || 1;
    for (const c of previewCanvases) {
      const css = c.clientWidth || 88;
      const px = Math.max(24, Math.round(css * dpr));
      if (c.width !== px || c.height !== px) { c.width = px; c.height = px; }
      const cx = c.getContext('2d');
      const name = c.dataset.motif;
      cx.setTransform(1, 0, 0, 1, 0, 0);
      if (name === 'mix') {
        cx.fillStyle = '#23242c'; cx.fillRect(0, 0, px, px);
        cx.fillStyle = '#8b8fa3';
        cx.font = Math.round(px * 0.16) + 'px ui-monospace, Consolas, monospace';
        cx.textAlign = 'center'; cx.textBaseline = 'middle';
        cx.fillText('mix', px / 2, px / 2);
        continue;
      }
      cx.fillStyle = '#fff'; cx.fillRect(0, 0, px, px);
      T.fitTransform(cx, [{ x: 0, y: 0, s: 1 }], px, px, 0.04);
      T.renderTiling(cx, [{ x: 0, y: 0, s: 1 }], {
        pickTile: () => T.connIdxByName(name),
        palette: T.PALETTES.bw
      });
    }
  }
  function updateMotifSel() {
    grid.querySelectorAll('canvas').forEach((c) => {
      const on = S.motifs.includes(c.dataset.motif);
      c.classList.toggle('sel', on);
      c.classList.toggle('multi', on && S.motifs.length > 1);
    });
    const el = $('motifInfo');
    if (!el) return;
    if (S.motifs.length > 1) {
      el.textContent = `random pool of ${S.motifs.length}: ${S.motifs.join('  ')}`;
    } else if (S.motifs[0] === 'mix') {
      el.textContent = 'mix — random from all ' + T.MOTIF_NAMES.length +
        ', one per tile';
    } else {
      el.textContent = `one motif everywhere: ${S.motifs[0]}`;
    }
  }

  /* ================= boot ================= */
  readHash();
  initTabs();
  // tiles outside Carlson's 15 (old links) fall back to the default motif
  S.motifs = (S.motifs || []).filter(
    (m) => m === 'mix' || T.MOTIF_NAMES.includes(m));
  if (!S.motifs.length) S.motifs = ['/'];
  buildShaderPicker();     // before pushToInputs: the value must exist as an option
  pushToInputs();
  buildMotifGrid();
  refreshParamVisibility();
  syncGround();
  syncInk();
  renderMain();
  updateMotifSel();
  let rAF = 0;
  window.addEventListener('resize', () => {
    renderMain();
    cancelAnimationFrame(rAF);
    rAF = requestAnimationFrame(paintPreviews);
  });
  window.TruchetApp = {
    hooks: {},                       // tabs fill these in: hooks.photo = {...}
    registerTab,
    DEFAULTS,                        // the opening state. A gate that judges the
                                     // defaults has to read the ones the product
                                     // ships, not carry a copy of its own
    hashGet,                       // one raw ask from the link, for a tab's own keys
    state: () => S,
    frameRatio, framePx, lattice, latticeMaxT, latticeBase,
    maxLatticeTiles: () => MAX_LATTICE_TILES,
    motifPool,
    buildTiling: buildTiling,           // dev harnesses: the tab shell's tiling path
    tab: () => S.tab,
    setTab, setBaseScale, baseScale,
    showError, clearError, onChange,
    /* The ink mask is the one thing a gate cannot rebuild from the outside: it is
     * what the app drew for the field to be poured into, at the size the app drew
     * it at. A gate that wants to prove the shape survived has to be able to look
     * at it, the same way it looks at buildTiling(). */
    inkParts: () => ({ gl: inkGl, mask: inkMask, clock: inkClock, clockGl: inkClockGl,
      phase: inkPhase, failed: inkFailed }),
    /* The same look at the ground side, so a gate can ask what the ground was
     * told instead of inferring it from what the stage showed. */
    groundParts: () => ({ gl: groundGl, clock: groundClock, clockGl: groundClockGl,
      canvas: groundCanvas, phase: groundPhase, failed: groundFailed }),
    /* The shape the fields were told about, and the fit that placed it: a gate can
     * only prove a contour landed where the tiling put it by asking the app for
     * both, the way it already asks for the ink mask. */
    shapeParts: () => ({ canvas: shapeCanvas, clock: shapeClock }),
    /* The shape and the ink mask painted at a size the export would use, the way
     * the export paints them. A gate can only prove a contour survives an export
     * by asking for it at the export's size and measuring where it came out. */
    shapeAt: (w, h) => paintShapeImage(shapeClock, w, h, buildTiling()),
    /* inkFieldAt: render the ink once more at an exact pixel size and hand back
     * both the field's output and the mask it sits on, which is where the tiles
     * themselves put their ink. */
    inkFieldAt: (w, h) => (inkFieldSnapshot(w, h)
      ? { field: inkClock, mask: inkClockMask } : null),
    fitTransform,
  };
})();
