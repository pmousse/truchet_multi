/* Truchet Studio — Generator tab (Phase 1d)
 * Single faithful engine (src/engine.js); this file is UI only. */
(function () {
  'use strict';
  const T = window.Truchet;

  /* ================= state ================= */
  const DEFAULTS = {
    tiling: 'chk',      // chk | grid | rand | sur | off
    n: 4,               // density step: 1 = the frame's base lattice, ×2 doubles it
    splits: 12, maxd: 4,// random subdivision
    seed: 'k7x2m9',
    motifs: ['/'],      // selection set: motif names, 'mix', or several of both
    pal: 'bw',          // palette key or 'custom'
    c1: '#101018', c2: '#3a6ea5', bg: '#f4efe6', // custom ramp
    pad: 2,             // margin percent
    format: '1:1',      // frame format key, or 'custom'
    res: 2048,          // long edge in px when a preset format is used
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
   * frame ratio is reduced to p:q and the lattice is (p*t) by (q*t). */
  const FRAME_FORMATS = {
    '1:1': [1, 1],
    '16:9': [16, 9], '9:16': [9, 16],
    '21:9': [21, 9],
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

  const HASH_KEYS = {
    tiling: 't', n: 'n', splits: 'sp',
    maxd: 'md', seed: 'sd', motifs: 'm', pal: 'p', c1: 'c1', c2: 'c2',
    bg: 'bg', pad: 'pd', format: 'F', res: 'rs', fw: 'fw', fh: 'fh', tab: 'tb'
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
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  function gcd(a, b) {
    a = Math.abs(a); b = Math.abs(b);
    while (b) { const t = b; b = a % b; a = t; }
    return a || 1;
  }
  /* Reduce w:h to integer p:q; if that needs sides bigger than 'limit', fall
   * back to the best continued-fraction convergent within the limit. */
  function reduceRatio(w, h, limit) {
    const g = gcd(w, h), p0 = w / g, q0 = h / g;
    if (Number.isInteger(p0) && Number.isInteger(q0) && Math.max(p0, q0) <= limit) {
      return [p0, q0];
    }
    let a = w, b = h, hh0 = 0, hh1 = 1, kk0 = 1, kk1 = 0, best = [1, 1];
    for (let it = 0; it < 40 && b > 1e-9; it++) {
      const ai = Math.floor(a / b);
      const hh2 = ai * hh1 + hh0, kk2 = ai * kk1 + kk0;
      if (Math.max(hh2, kk2) > limit) break;
      best = [hh2, kk2];
      hh0 = hh1; hh1 = hh2; kk0 = kk1; kk1 = kk2;
      const r = a - ai * b; a = b; b = r;
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
  function latticeOf(p, q, t) { return { cols: p * t, rows: q * t, t }; }
  let maxTCache = { key: '', val: 1 };
  function latticeMaxT() {              // highest density step within the caps
    const [p, q] = frameRatio();
    const randPart = (S.tiling === 'rand') ? ':' + S.splits + ':' + S.maxd : '';
    const key = S.tiling + ':' + p + ':' + q + randPart;
    if (maxTCache.key === key) return maxTCache.val;
    /* The side cap is pure geometry. The tile cap needs this tiling's own
     * expansion factor - how many tiles one cell produces - measured on the
     * base lattice instead of assumed, then verified against the real tiling
     * because the expansion is not exactly constant. */
    const bySide = Math.max(1, Math.floor(MAX_LATTICE_SIDE / Math.max(p, q)));
    const ratio = Math.max(1, tilingFor(latticeOf(p, q, 1)).length / (p * q));
    let t = Math.max(1, Math.min(MAX_DENSITY_STEP, bySide,
      Math.floor(Math.sqrt(MAX_LATTICE_TILES / (ratio * p * q)))));
    let count = tilingFor(latticeOf(p, q, t)).length;
    if (count > MAX_LATTICE_TILES) {
      t = Math.max(1, Math.floor(t * Math.sqrt(MAX_LATTICE_TILES / count)));
      while (t > 1) {
        count = tilingFor(latticeOf(p, q, t)).length;
        if (count <= MAX_LATTICE_TILES) break;
        t--;
      }
    }
    maxTCache = { key, val: t };
    return t;
  }
  function lattice() {                 // tiling units: cols x rows covering the frame
    const [p, q] = frameRatio();
    /* Square tiles only tile a p:q rectangle in multiples of (p, q), so the
     * control is that multiplier itself — every step of it changes the grid. */
    const t = clamp(Math.round(S.n) || 1, 1, latticeMaxT());
    return { cols: p * t, rows: q * t, t };
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
  function buildPalette(tiles) {
    if (S.pal !== 'custom') return T.PALETTES[S.pal] || T.PALETTES.bw;
    let maxD = 0;
    for (const t of tiles) maxD = Math.max(maxD, T.tileDepth(t));
    maxD = Math.max(1, maxD);
    return (depth) => [T.lerpColor(S.c1, S.c2, depth / maxD), S.bg];
  }

  /* ================= main view ================= */
  const canvas = document.getElementById('mainCanvas');
  const ctx = canvas.getContext('2d');
  let lastDpr = 0;
  function worldBounds(tiles) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const t of tiles) {
      const m = t.s / 3 + t.s * 0.02;   // wings reach exactly s/3 (as in fitTransform)
      x0 = Math.min(x0, t.x - m); y0 = Math.min(y0, t.y - m);
      x1 = Math.max(x1, t.x + t.s + m); y1 = Math.max(y1, t.y + t.s + m);
    }
    const p = (S.pad / 100) * (x1 - x0);
    return [x0 - p, y0 - p, x1 + p, y1 + p];
  }
  function drawScene(c, tiles, w, h) {
    const cx = c.getContext('2d');
    cx.setTransform(1, 0, 0, 1, 0, 0);
    cx.fillStyle = (S.pal === 'custom') ? S.bg
      : (T.PALETTES[S.pal] || T.PALETTES.bw)[1];
    cx.fillRect(0, 0, w, h);
    if (!tiles.length) return;   // ground only; there is nothing to fit
    /* The lattice already carries the frame's ratio, so this scales with no
     * clipping in the normal case; 'cover' only matters when an odd custom
     * size had to be approximated by the nearest lattice (sub-1% sliver). */
    const [x0, y0, x1, y1] = (tabDef().viewBounds || worldBounds)(tiles);
    const bw = x1 - x0, bh = y1 - y0;
    /* Degenerate bounds would flow into s = -0 and then into setTransform, and a
     * zero-or-NaN matrix makes every later draw do nothing without an error - the
     * silent black stage. Show it instead of hiding it. */
    if (!(bw > 0 && bh > 0) || !Number.isFinite(bw) || !Number.isFinite(bh)) {
      showError('This tab produced no drawable geometry.');
      const info = document.getElementById('frameInfo');
      if (info) info.textContent = 'nothing to draw';
      return;
    }
    clearError();
    const s = Math.max(w / bw, h / bh);
    const winW = w / s, winH = h / s;
    const wx0 = (x0 + x1) / 2 - winW / 2, wy0 = (y0 + y1) / 2 - winH / 2;
    cx.setTransform(s, 0, 0, -s, -s * wx0, h + s * wy0);
    T.renderTiling(cx, tiles, {
      pickTile: (tabDef().picker || buildPicker)(tiles),
      palette: buildPalette(tiles),
      bounds: [wx0, wy0, wx0 + winW, wy0 + winH]
    });
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
    if (!def.ready()) {
      /* Nothing to draw yet (Photo with no image chosen): paint just the
       * ground, so the stage still shows the frame and its real colour. */
      const cx = canvas.getContext('2d');
      cx.setTransform(1, 0, 0, 1, 0, 0);
      cx.fillStyle = (S.pal === 'custom') ? S.bg
        : (T.PALETTES[S.pal] || T.PALETTES.bw)[1];
      cx.fillRect(0, 0, w, h);
      const info = document.getElementById('frameInfo');
      if (info) info.textContent = def.emptyMessage;
      if (def.onRedraw) def.onRedraw();
      return;
    }
    const tiles = buildTiling();
    drawScene(canvas, tiles, w, h);
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
  function motifPart(isMix, pool) {
    return isMix ? 'mix' : pool.map(sanitizeMotif).join('-');
  }
  function exportName(w, h) {
    const L = lattice();
    const sizePart = L.cols + 'x' + L.rows;
    const pal = S.pal === 'custom' ? 'ramp' : S.pal;
    const pool = motifPool();
    const isMix = pool.length === T.MOTIF_NAMES.length &&
      pool.every((m, i) => m === T.MOTIF_NAMES[i]);
    const motif = isMix ? 'mix' : pool.map(sanitizeMotif).join('-');
    /* 'chk/grid/rand/sur/off' only describe the Generator's lattice; a tab that
     * builds its pictures another way supplies its own word. */
    const mode = tabDef().mode ? tabDef().mode() : S.tiling;
    return (tabDef().prefix || 'truchet_') + mode + sizePart + '_' + S.seed +
      '_m' + motif + '_p' + pal + '_' + w + 'x' + h + '.png';
  }
  function exportPNG() {
    const [w, h] = framePx();
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    drawScene(off, buildTiling(), w, h);
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
    c1: 'inC1', c2: 'inC2', bg: 'inBg', pad: 'inPad'
  };
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
    writeHash(); refreshParamVisibility(); renderMain(); updateMotifSel();
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
    const maxT = Math.max(1, Math.min(latticeMaxT(), Math.floor(
      Math.sqrt(MAX_LATTICE_TILES / (frameRatio()[0] * frameRatio()[1])))));
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
  pushToInputs();
  buildMotifGrid();
  refreshParamVisibility();
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
    hashGet,                       // one raw ask from the link, for a tab's own keys
    state: () => S,
    frameRatio, framePx, lattice, latticeMaxT,
    maxLatticeTiles: () => MAX_LATTICE_TILES,
    motifPool,
    buildTiling: buildTiling,           // dev harnesses: the tab shell's tiling path
    tab: () => S.tab,
    setTab, setBaseScale, baseScale,
    showError, clearError, onChange
  };
})();
