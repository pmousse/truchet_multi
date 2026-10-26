/* Truchet Studio — Generator tab (Phase 1d)
 * Single faithful engine (src/engine.js); this file is UI only. */
(function () {
  'use strict';
  const T = window.Truchet;

  /* ================= state ================= */
  const DEFAULTS = {
    tiling: 'chk',      // chk | grid | rand | sur | off
    n: 6,               // chk / sur size
    rows: 4, cols: 4,   // grid
    offCols: 4, offRows: 2, // offset surround (m cols, n rows)
    splits: 12, maxd: 4,// random subdivision
    seed: 'k7x2m9',
    motif: '/',         // tile name or 'mix'
    pal: 'bw',          // palette key or 'custom'
    c1: '#101018', c2: '#3a6ea5', bg: '#f4efe6', // custom ramp
    pad: 2              // padding percent
  };
  let S = Object.assign({}, DEFAULTS);

  const HASH_KEYS = {
    tiling: 't', n: 'n', rows: 'rows', cols: 'cols',
    offCols: 'oc', offRows: 'or', splits: 'sp',
    maxd: 'md', seed: 'sd', motif: 'm', pal: 'p', c1: 'c1', c2: 'c2',
    bg: 'bg', pad: 'pd'
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

  /* ================= tiling + pickTile ================= */
  function buildTiling() {
    switch (S.tiling) {
      case 'chk': return T.checkerboardTiling(S.n);
      case 'grid': return T.gridTiling(S.rows, S.cols);
      case 'rand': {
        const rnd = T.mulberry32(T.seedFromString(S.seed));
        return T.randomSubdivision(rnd, S.splits, S.maxd);
      }
      case 'sur': return T.surroundTiling(S.n);
      case 'off': return T.offsetSurroundTiling(S.offCols, S.offRows);
    }
    return T.checkerboardTiling(4);
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
      map.set(t.x + ',' + t.y + ',' + t.s,
        1 + Math.floor(rnd() * T.TILE_NAMES.length));
    }
    return (depth, t) => map.get(t.x + ',' + t.y + ',' + t.s) || 8;
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
  function drawScene(c, tiles, w, h, cropAspect) {
    const cx = c.getContext('2d');
    cx.setTransform(1, 0, 0, 1, 0, 0);
    cx.fillStyle = (S.pal === 'custom') ? S.bg
      : (T.PALETTES[S.pal] || T.PALETTES.bw)[1];
    cx.fillRect(0, 0, w, h);
    if (cropAspect) {
      drawCropped(cx, tiles, w, h, cropAspect);
    } else {
      T.fitTransform(cx, tiles, w, h, S.pad / 100);
      T.renderTiling(cx, tiles, {
        pickTile: buildPicker(tiles),
        palette: buildPalette(tiles)
      });
    }
  }
  function boundsOf(tiles) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const t of tiles) {
      const m = t.s / 4;
      x0 = Math.min(x0, t.x - m); y0 = Math.min(y0, t.y - m);
      x1 = Math.max(x1, t.x + t.s + m); y1 = Math.max(y1, t.y + t.s + m);
    }
    const p = (S.pad / 100) * (x1 - x0);
    return [x0 - p, y0 - p, x1 + p, y1 + p];
  }
  /* Carlson CropSquareTiling: crop from the bounding square to aspect a. */
  function drawCropped(cx, tiles, w, h, aspect) {
    const [x0, y0, x1, y1] = boundsOf(tiles);
    const side = Math.max(x1 - x0, y1 - y0);
    const cxm = (x0 + x1) / 2, cym = (y0 + y1) / 2;
    let winW, winH;
    if (aspect >= 1) { winW = side; winH = side / aspect; }
    else { winH = side; winW = side * aspect; }
    const s = Math.min(w / winW, h / winH);
    const wx0 = cxm - winW / 2, wy0 = cym - winH / 2;
    cx.setTransform(s, 0, 0, -s, -s * wx0, h + s * wy0);
    T.renderTiling(cx, tiles, {
      pickTile: buildPicker(tiles),
      palette: buildPalette(tiles),
      bounds: [wx0, wy0, wx0 + winW, wy0 + winH]
    });
  }
  function renderMain() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth * dpr, h = canvas.clientHeight * dpr;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
    }
    drawScene(canvas, buildTiling(), w, h, null);
  }

  /* ================= export ================= */
  function sanitizeMotif(m) {
    return ({ '/': 'sl', '\\': 'bs', '|': 'vb', '+': 'pl',
      '.': 'd', '-': 'mi' })[m] || m;
  }
  function exportName(w, h) {
    const t = S.tiling;
    const sizePart = (t === 'chk' || t === 'sur') ? S.n
      : t === 'grid' ? S.rows + 'x' + S.cols
        : t === 'off' ? S.offCols + 'x' + S.offRows
          : S.splits + 'd' + S.maxd;
    const pal = S.pal === 'custom' ? 'ramp' : S.pal;
    const motif = S.motif === 'mix' ? 'mix' : sanitizeMotif(S.motif);
    return 'truchet_' + t + sizePart + '_' + S.seed + '_m' + motif +
      '_p' + pal + '_' + w + 'x' + h + '.png';
  }
  function exportPNG(w, h) {
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    drawScene(off, buildTiling(), w, h, w / h);
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
    tiling: 'selTiling', n: 'inN', rows: 'inRows', cols: 'inCols',
    offCols: 'inOffM', offRows: 'inOffN',
    splits: 'inSplits', maxd: 'inMaxd', seed: 'inSeed', pal: 'selPal',
    c1: 'inC1', c2: 'inC2', bg: 'inBg', pad: 'inPad'
  };
  function pushToInputs() {
    $('selTiling').value = S.tiling;
    $('inN').value = S.n; $('inRows').value = S.rows; $('inCols').value = S.cols;
    $('inOffM').value = S.offCols; $('inOffN').value = S.offRows;
    $('inSplits').value = S.splits; $('inMaxd').value = S.maxd;
    $('inSeed').value = S.seed; $('selPal').value = S.pal;
    $('inC1').value = S.c1; $('inC2').value = S.c2; $('inBg').value = S.bg;
    $('inPad').value = S.pad; $('outPad').textContent = S.pad + '%';
  }
  function refreshParamVisibility() {
    const show = (id, on) => $(id).style.display = on ? '' : 'none';
    show('rowN', S.tiling === 'chk' || S.tiling === 'sur');
    show('rowGrid', S.tiling === 'grid');
    show('rowRand', S.tiling === 'rand');
    show('rowOff', S.tiling === 'off');
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
  $('hideBtn').addEventListener('click', () => document.body.classList.add('panel-hidden'));
  $('showBtn').addEventListener('click', () => document.body.classList.remove('panel-hidden'));

  /* export controls */
  $('btnExport').addEventListener('click', () => {
    const res = +$('selRes').value;
    const aspect = +$('selAspect').value;
    let w, h;
    if (aspect === 1) { w = res; h = res; }
    else if (aspect > 1) { w = res; h = Math.round(res / aspect); }
    else { h = res; w = Math.round(res * aspect); }
    exportPNG(w, h);
  });

  /* motif picker: 24 previews + mix cell */
  const grid = $('motifGrid');
  function buildMotifGrid() {
    grid.innerHTML = '';
    const mix = document.createElement('canvas');
    mix.className = 'mix'; mix.title = 'mix (random per tile)';
    mix.dataset.motif = 'mix';
    grid.appendChild(mix);
    for (const name of T.TILE_NAMES) {
      const c = document.createElement('canvas');
      c.width = 88; c.height = 88;
      c.title = name; c.dataset.motif = name;
      const cx = c.getContext('2d');
      cx.fillStyle = '#fff'; cx.fillRect(0, 0, 88, 88);
      T.fitTransform(cx, [{ x: 0, y: 0, s: 1 }], 88, 88, 0.04);
      T.renderTiling(cx, [{ x: 0, y: 0, s: 1 }], {
        pickTile: () => T.connIdxByName(name),
        palette: T.PALETTES.bw
      });
      grid.appendChild(c);
    }
    grid.querySelectorAll('canvas').forEach((c) => {
      c.addEventListener('click', () => {
        S.motif = c.dataset.motif;
        onChange();
      });
    });
  }
  function updateMotifSel() {
    grid.querySelectorAll('canvas').forEach((c) => {
      c.classList.toggle('sel', c.dataset.motif === S.motif);
    });
  }

  /* ================= boot ================= */
  readHash();
  pushToInputs();
  buildMotifGrid();
  refreshParamVisibility();
  renderMain();
  updateMotifSel();
  window.addEventListener('resize', renderMain);
})();
