/* Truchet Studio — Generator tab (Phase 1d)
 * Single faithful engine (src/engine.js); this file is UI only. */
(function () {
  'use strict';
  const T = window.Truchet;

  /* ================= state ================= */
  const DEFAULTS = {
    tiling: 'chk',      // chk | grid | rand | sur | off
    n: 6,               // tiles (or surround units) along the SHORT side of the frame
    splits: 12, maxd: 4,// random subdivision
    seed: 'k7x2m9',
    motif: '/',         // tile name or 'mix'
    pal: 'bw',          // palette key or 'custom'
    c1: '#101018', c2: '#3a6ea5', bg: '#f4efe6', // custom ramp
    pad: 2,             // margin percent
    format: '1:1',      // frame format key, or 'custom'
    res: 2048,          // long edge in px when a preset format is used
    fw: 3840, fh: 2160  // explicit frame size when format === 'custom'
  };
  let S = Object.assign({}, DEFAULTS);

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
  const MAX_LATTICE_SIDE = 40;   // cap when reducing an arbitrary custom ratio
  const MAX_LATTICE_TILES = 5000;

  const HASH_KEYS = {
    tiling: 't', n: 'n', splits: 'sp',
    maxd: 'md', seed: 'sd', motif: 'm', pal: 'p', c1: 'c1', c2: 'c2',
    bg: 'bg', pad: 'pd', format: 'F', res: 'rs', fw: 'fw', fh: 'fh'
  };
  function writeHash() {
    const p = new URLSearchParams();
    for (const [k, h] of Object.entries(HASH_KEYS)) p.set(h, S[k]);
    location.hash = p.toString();
  }
  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    for (const [k, h] of Object.entries(HASH_KEYS)) {
      if (p.has(h)) {
        const v = p.get(h);
        S[k] = (k in DEFAULTS && typeof DEFAULTS[k] === 'number') ? +v : v;
      }
    }
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
  function lattice() {                 // tiling units: cols x rows covering the frame
    const [p, q] = frameRatio();
    let t = Math.max(1, Math.round(S.n / Math.min(p, q)));
    while (t > 1 && p * t * q * t > MAX_LATTICE_TILES) t--;
    return { cols: p * t, rows: q * t };
  }

  /* ================= tiling + pickTile ================= */
  function buildTiling() {
    const L = lattice();
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
  function buildPicker(tiles) {
    if (S.motif !== 'mix') {
      const idx = T.connIdxByName(S.motif) || T.connIdxByName('/');
      return () => idx;
    }
    // stable per-tile mix: sorted coords + fresh PRNG stream
    const rnd = T.mulberry32(T.seedFromString(S.seed + '\u0001mix'));
    const map = new Map();
    const sorted = tiles.slice().sort(
      (a, b) => (a.x - b.x) || (a.y - b.y) || (a.s - b.s));
    for (const t of sorted) {
      const name = T.MOTIF_NAMES[Math.floor(rnd() * T.MOTIF_NAMES.length)];
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
    /* The lattice already carries the frame's ratio, so this scales with no
     * clipping in the normal case; 'cover' only matters when an odd custom
     * size had to be approximated by the nearest lattice (sub-1% sliver). */
    const [x0, y0, x1, y1] = worldBounds(tiles);
    const bw = x1 - x0, bh = y1 - y0;
    const s = Math.max(w / bw, h / bh);
    const winW = w / s, winH = h / s;
    const wx0 = (x0 + x1) / 2 - winW / 2, wy0 = (y0 + y1) / 2 - winH / 2;
    cx.setTransform(s, 0, 0, -s, -s * wx0, h + s * wy0);
    T.renderTiling(cx, tiles, {
      pickTile: buildPicker(tiles),
      palette: buildPalette(tiles),
      bounds: [wx0, wy0, wx0 + winW, wy0 + winH]
    });
  }
  function updateFrameInfo() {
    const L = lattice(), [fw, fh] = framePx();
    const el = document.getElementById('frameInfo');
    if (!el) return;
    const unit = (S.tiling === 'sur' || S.tiling === 'off') ? 'units' : 'tiles';
    el.textContent = `${L.cols} × ${L.rows} ${unit} · ${fw} × ${fh} px`;
  }
  function renderMain() {
    const dpr = window.devicePixelRatio || 1;
    const [fw, fh] = framePx();
    const ar = fw / fh;
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
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
    }
    if (dpr !== lastDpr) {   // browser zoom changes devicePixelRatio
      lastDpr = dpr;
      paintPreviews();
    }
    drawScene(canvas, buildTiling(), w, h);
    updateFrameInfo();
  }

  /* ================= export ================= */
  function sanitizeMotif(m) {
    return ({ '/': 'sl', '\\': 'bs', '|': 'vb', '+': 'pl',
      '.': 'd', '-': 'mi' })[m] || m;
  }
  function exportName(w, h) {
    const L = lattice();
    const sizePart = L.cols + 'x' + L.rows;
    const pal = S.pal === 'custom' ? 'ramp' : S.pal;
    const motif = S.motif === 'mix' ? 'mix' : sanitizeMotif(S.motif);
    return 'truchet_' + S.tiling + sizePart + '_' + S.seed + '_m' + motif +
      '_p' + pal + '_' + w + 'x' + h + '.png';
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
    $('inN').value = S.n;
    $('selFormat').value = S.format;
    $('inFrameW').value = S.fw; $('inFrameH').value = S.fh;
    $('selRes').value = String(S.res);
    $('inSplits').value = S.splits; $('inMaxd').value = S.maxd;
    $('inSeed').value = S.seed; $('selPal').value = S.pal;
    $('inC1').value = S.c1; $('inC2').value = S.c2; $('inBg').value = S.bg;
    $('inPad').value = S.pad; $('outPad').textContent = S.pad + '%';
  }
  function refreshParamVisibility() {
    const show = (id, on) => $(id).style.display = on ? '' : 'none';
    show('rowN', true);
    show('rowFrameSize', S.format === 'custom');
    show('rowRes', S.format !== 'custom');
    show('rowRand', S.tiling === 'rand');
    show('rowCustomPal', S.pal === 'custom');
  }
  function onChange() {
    writeHash(); refreshParamVisibility(); renderMain(); updateMotifSel();
  }
  for (const [k, id] of Object.entries(FIELDS)) {
    $(id).addEventListener('input', () => {
      const v = $(id).value;
      S[k] = (typeof DEFAULTS[k] === 'number') ? +v : v;
      if (k === 'pad') $('outPad').textContent = S.pad + '%';
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

  /* motif picker: the 15 tiles from Carlson's motifs figure, plus a mix cell */
  const grid = $('motifGrid');
  let previewCanvases = [];
  function buildMotifGrid() {
    grid.innerHTML = '';
    const mix = document.createElement('canvas');
    mix.className = 'mix'; mix.title = 'mix (random per tile)';
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
      c.addEventListener('click', () => {
        S.motif = c.dataset.motif;
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
      c.classList.toggle('sel', c.dataset.motif === S.motif);
    });
  }

  /* ================= boot ================= */
  readHash();
  // tiles outside Carlson's 15 (old links) fall back to the default motif
  if (S.motif !== 'mix' && T.MOTIF_NAMES.indexOf(S.motif) < 0) S.motif = '/';
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
})();
