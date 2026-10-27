/* Fill tab for Truchet Studio.
 *
 * Fills a SHAPE with the same multi-scale engine, instead of filling a frame or
 * an image. The construction is the quadtree from the Photo tab, with a different
 * question asked of each cell: not "what tone is the image asking for here" but
 * "how much of this cell lies inside the shape".
 *
 *   coverage 0            -> 'out'   : the quadtree stops, nothing is drawn here
 *   coverage partial      -> 'edge'  : split, to follow the outline more closely
 *   coverage full inside  -> 'in'    : lay one tile and stop
 *
 * which is Carlson's multi-scale idea applied to an outline: a cell splits while
 * something is still unresolved inside it, so the boundary comes out as a band of
 * fine tiles and the interior stays coarse. Two controls say how deep each of
 * those two rules is allowed to go, because they are genuinely different
 * questions - how finely the edge is traced, and how much the filled interior is
 * subdivided. A partial cell that runs out of depth lays one tile across the
 * boundary rather than leaving a gap: that is the honest end of a quadtree, and
 * the QA measures how much of such a tile falls outside the shape.
 *
 * Motif choice is the Generator's: the selected pool (one motif, or several
 * chosen at random per tile with the seed). Fill decides WHERE tiles go and how
 * big they are; which circuit fills them stays the same control as everywhere
 * else in the app.
 *
 * The frame is the canvas here, so the tab also supplies its own view bounds:
 * the whole lattice rectangle rather than the bounds of the tiles it produced.
 * Otherwise a small shape would be scaled up to fill the frame and stop being a
 * shape at the size the frame implies.
 *
 * A custom mask is decoded locally and never enters the share link, exactly as in
 * the Photo tab: a Fill link with a custom mask reopens asking for it again.
 *
 * Loaded after src/app.js, which exposes the tab shell on window.TruchetApp.
 */
(function () {
  'use strict';
  const TR = window.Truchet;
  const app = window.TruchetApp;
  if (!TR || !app) {
    app && app.showError('fill tab: app shell missing');
    return;
  }

  const FILL_MASK_EDGE = 512;     // the shape is sampled once, on this square grid
  /* Subdivision here is a *count of halvings from one lattice cell*, so a cell at
   * depth d is 2^-d lattice units wide, i.e. pxPerUnit / 2^d device pixels in the
   * export - which is what depthCap solves for. A lattice cell is the size of the
   * pattern's coarsest motif: at base scale 1 a 16:9 frame is 16 cells across, so
   * a 1280 px export starts at 80 px cells and can halve four times before the
   * motifs get smaller than the ~4 px they read as at arm's length. A limit tuned
   * for a square frame starves a wide one into a flat texture, which is the whole
   * point of the tab; the number has to be set at the fine end of what an image
   * can hold, not the comfortable end. */
  const FILL_MIN_PX = 4;          // never subdivide a cell below this in the export
  const FILL_MAX_DEPTH = 8;       // hard ceiling: a cell can shrink to 1/256
  const COVER_EPS = 1e-9;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  const F = {
    shape: 'circle',      // a preset key, or 'custom' (an uploaded mask)
    fit: 'contain',       // contain: whole shape inside the frame; cover: shape cropped to fill it
    base: 1,              // base lattice multiplier (app's S.n, mirrored here)
    depth: 5,             // how deep the OUTLINE may be traced
    inner: 2,             // how deep a fully-inside area is subdivided (0 = one coarse tile)
    soft: 0,              // % of a cell that may be missing and still count as inside
    thresh: 50,           // % opacity/darkness a custom mask pixel needs to count
    name: '',
    mask: null,           // {w,h,cov,sat} in shape space, sampled once
    tiles: null, sig: '', map: null, edgeUsed: 0, innerUsed: 0, area: 0
  };

  /* ================= the shapes =================
   * Every preset is an implicit test on shape space (u,v) in [-1,1]^2 with v
   * pointing UP, the same direction the tiling's y runs in. Radius 1 is the
   * shape's own extent; how big that is on the frame is the 'fit' control. */
  function polygonTest(pts) {
    return (u, v) => {
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > v) !== (yj > v) &&
          u < (xj - xi) * (v - yi) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    };
  }
  function starPoints(outer, inner, n) {
    const pts = [];
    for (let k = 0; k < n * 2; k++) {
      const a = Math.PI / 2 + k * Math.PI / n;      // start pointing up
      const r = (k % 2 === 0) ? outer : inner;
      pts.push([r * Math.cos(a), r * Math.sin(a)]);
    }
    return pts;
  }
  /* The classic heart curve (u^2 + v^2 - 1)^3 = u^2 v^3, nudged and scaled so it
   * sits inside the unit square it gets sampled onto. */
  function heartTest(u, v) {
    const y = 1.28 * v - 0.12;
    const a = u * u + y * y - 1;
    return a * a * a - u * u * y * y * y <= 0;
  }
  const SHAPES = {
    circle: { label: 'circle', test: (u, v) => u * u + v * v <= 1 },
    squircle: { label: 'rounded square', test: (u, v) =>
      Math.pow(Math.abs(u) / 0.92, 6) + Math.pow(Math.abs(v) / 0.92, 6) <= 1 },
    square: { label: 'square', test: (u, v) => Math.abs(u) <= 0.86 && Math.abs(v) <= 0.86 },
    diamond: { label: 'diamond', test: (u, v) => Math.abs(u) + Math.abs(v) <= 1 },
    triangle: { label: 'triangle', test: polygonTest([[0, 1], [0.92, -0.62], [-0.92, -0.62]]) },
    star: { label: 'star', test: polygonTest(starPoints(1, 0.45, 5)) },
    hexagon: { label: 'hexagon', test: polygonTest(
      [0, 1, 2, 3, 4, 5].map((k) => {
        const a = Math.PI / 2 + k * Math.PI / 3;
        return [Math.cos(a), Math.sin(a)];
      })) },
    heart: { label: 'heart', test: heartTest },
    cross: { label: 'cross', test: (u, v) =>
      (Math.abs(u) <= 0.34 && Math.abs(v) <= 0.9) ||
      (Math.abs(v) <= 0.34 && Math.abs(u) <= 0.9) },
    ring: { label: 'ring', test: (u, v) => {
      const r = Math.hypot(u, v);
      return r <= 1 && r >= 0.56;
    } },
    custom: { label: 'custom mask\u2026', test: null }
  };

  /* ================= mask sampling =================
   * A preset and an uploaded mask end up as the same object, so there is one
   * quadtree query to write rather than two. The grid is always square because
   * shape space is square; an image is contain-fitted into it and the letterbox
   * stays coverage 0, which is the same 'nothing here' the presets have outside
   * their outline. */
  function buildPresetMask(key) {
    const def = SHAPES[key] || SHAPES.circle;
    const W = FILL_MASK_EDGE, cov = new Float64Array(W * W);
    /* Two samples per axis, so a boundary pixel gets a fractional coverage
     * rather than a coin flip - that is what makes the staircase follow the
     * outline instead of stuttering on it. */
    const SUB = 2;
    const px = 2 / W, py = 2 / W;                      // one grid cell in shape space
    for (let row = 0; row < W; row++) {
      const vc = 1 - (row + 0.5) * py;                 // cell centre; row 0 is v = +1
      for (let x = 0; x < W; x++) {
        const uc = (x + 0.5) * px - 1;
        let hits = 0;
        for (let sy = 0; sy < SUB; sy++) {
          const vv = vc + (sy + 0.5) * py / SUB - py / 2;
          for (let sx = 0; sx < SUB; sx++) {
            const uu = uc + (sx + 0.5) * px / SUB - px / 2;
            if (def.test(uu, vv)) hits++;
          }
        }
        cov[row * W + x] = hits / (SUB * SUB);
      }
    }
    return { w: W, h: W, cov, sat: null, source: 'preset:' + key };
  }

  /* Summed area table of the coverage, so a cell query costs four reads. */
  function ensureSat(mask) {
    if (mask.sat) return mask;
    const w = mask.w, h = mask.h, W = w + 1;
    const sat = new Float64Array(W * (h + 1));
    for (let y = 0; y < h; y++) {
      let rowSum = 0;
      const src = y * w, dst = (y + 1) * W;
      for (let x = 0; x < w; x++) {
        rowSum += mask.cov[src + x];
        sat[dst + x + 1] = sat[dst - W + x + 1] + rowSum;
      }
    }
    mask.sat = sat;
    return mask;
  }

  async function loadFile(file) {
    if (!file) return false;
    let img = null;
    try {
      if (window.createImageBitmap) {
        img = await createImageBitmap(file);
      } else {
        img = await new Promise((resolve, reject) => {
          const url = URL.createObjectURL(file);
          const im = new Image();
          im.onload = () => { URL.revokeObjectURL(url); resolve(im); };
          im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
          im.src = url;
        });
      }
    } catch (e) {
      app.showError('could not read that mask: ' + (e && e.message ? e.message : e));
      return false;
    }
    return adoptMask(img, file.name);
  }

  /* A mask is a SHAPE, not a picture: transparency is the natural way to express
   * one, so if the file has an alpha channel that is what is read. An opaque
   * image is read by tone instead - dark ink is the shape, because that is how a
   * logo or a scan of a cut-out looks. The threshold box decides how much ink
   * counts. */
  function adoptMask(img, name) {
    const iw = img.width || img.naturalWidth, ih = img.height || img.naturalHeight;
    if (!iw || !ih) { app.showError('that file has no pixel size'); return false; }
    const k = Math.min(1, FILL_MASK_EDGE / Math.max(iw, ih));
    const w = Math.max(1, Math.round(iw * k)), h = Math.max(1, Math.round(ih * k));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.clearRect(0, 0, w, h);
    cx.drawImage(img, 0, 0, w, h);
    const d = cx.getImageData(0, 0, w, h).data;
    let anyAlpha = false;
    for (let i = 3; i < d.length; i += 4) { if (d[i] < 250) { anyAlpha = true; break; } }
    const raw = new Float64Array(w * h);
    for (let p = 0, i = 0; p < raw.length; p++, i += 4) {
      raw[p] = anyAlpha
        ? d[i + 3] / 255
        : 1 - (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    }
    /* Fit the image into square shape space without distorting it. */
    const W = FILL_MASK_EDGE, H = FILL_MASK_EDGE;
    const s = Math.min(W / w, H / h);
    const dw = w * s, dh = h * s;
    const ox = (W - dw) / 2, oy = (H - dh) / 2;
    const cov = new Float64Array(W * H);
    const t = clamp(F.thresh, 1, 99) / 100;
    for (let y = 0; y < H; y++) {
      const sy = Math.floor(clamp((y - oy) / s, 0, h - 1));
      for (let x = 0; x < W; x++) {
        const sx = Math.floor(clamp((x - ox) / s, 0, w - 1));
        cov[y * H + x] = raw[sy * w + sx] >= t ? 1 : 0;
      }
    }
    F.mask = { w: W, h: H, cov, sat: null, source: 'mask' };
    F.shape = 'custom';
    F.name = String(name || 'mask').replace(/^.*[\\/]/, '');
    F.tiles = null; F.sig = '';
    app.clearError();
    app.onChange();
    syncLabel();
    return true;
  }

  function currentMask() {
    if (F.shape === 'custom') return F.mask;
    if (!F.mask || F.mask.source !== 'preset:' + F.shape) F.mask = buildPresetMask(F.shape);
    return ensureSat(F.mask);
  }

  /* ================= shape space -> lattice =================
   * The lattice is cols x rows covering the frame. 'contain' makes radius 1 the
   * shorter half of the frame, so the whole shape is visible; 'cover' makes it
   * the longer half, so the shape fills the frame and its edges are cut. */
  function mapOf(L) {
    const half = (F.fit === 'cover') ? Math.max(L.cols, L.rows) / 2
      : Math.min(L.cols, L.rows) / 2;
    const cx = L.cols / 2, cy = L.rows / 2;
    const m = F.shape === 'custom' ? (F.mask || { w: FILL_MASK_EDGE, h: FILL_MASK_EDGE }) : null;
    const W = (m && m.w) || FILL_MASK_EDGE, H = (m && m.h) || FILL_MASK_EDGE;
    return {
      half, cx, cy, W, H,
      px: (x) => (x - cx) / half * (W / 2) + W / 2,     // lattice x -> mask column
      py: (y) => H / 2 - (y - cy) / half * (H / 2)      // lattice y (up) -> mask row
    };
  }

  /* Fraction of a lattice rectangle that lies inside the shape. Part of the
   * rectangle may fall outside the sampled area; that part contributes nothing,
   * which is correct - it is outside the shape. */
  function coverOf(map, m, x0, y0, x1, y1) {
    const area = (x1 - x0) * (y1 - y0);
    if (area <= 0) return 0;
    let c0 = Math.max(0, Math.floor(map.px(x0)));
    let c1 = Math.min(m.w, Math.ceil(map.px(x1)));
    let rA = Math.max(0, Math.floor(map.py(y1)));        // y1 is the higher edge
    let rB = Math.min(m.h, Math.ceil(map.py(y0)));
    if (c1 <= c0 || rB <= rA) return 0;
    const W = m.w + 1;
    const sum = m.sat[rB * W + c1] - m.sat[rA * W + c1] -
      m.sat[rB * W + c0] + m.sat[rA * W + c0];
    const pxArea = (2 * map.half / m.w) * (2 * map.half / m.h);
    return clamp(sum * pxArea / area, 0, 1);
  }

  /* Area of the shape that falls INSIDE the frame, in lattice units, by walking
   * the sampled grid and skipping samples that land outside it - 'cover' can
   * push a shape past the edges, and that part is genuinely not in the picture.
   * A plain summed-area query cannot say this, because the unsampled area outside
   * the shape is not the same thing as the area outside the frame. */
  function frameShapeArea(map, m, L) {
    const pxArea = (2 * map.half / m.w) * (2 * map.half / m.h);
    let a = 0;
    for (let row = 0; row < m.h; row++) {
      const ly = map.cy + (m.h / 2 - row - 0.5) * (2 * map.half / m.h);
      if (ly < 0 || ly > L.rows) continue;
      const base = row * m.w;
      for (let x = 0; x < m.w; x++) {
        const lx = map.cx + (x + 0.5 - m.w / 2) * (2 * map.half / m.w);
        if (lx < 0 || lx > L.cols) continue;
        a += m.cov[base + x] * pxArea;
      }
    }
    return a;
  }

  /* ================= depth ================= */
  function depthCap(L) {
    const [fw, fh] = app.framePx();
    const pxPerUnit = Math.max(fw / L.cols, fh / L.rows);
    return clamp(Math.floor(Math.log2(Math.max(1, pxPerUnit / FILL_MIN_PX))), 0, FILL_MAX_DEPTH);
  }
  function edgeDepth(L) { return clamp(Math.min(F.depth, depthCap(L)), 0, FILL_MAX_DEPTH); }
  function innerDepth(L) { return clamp(Math.min(F.inner, depthCap(L)), 0, FILL_MAX_DEPTH); }

  /* ================= the tiling ================= */
  function build(L) {
    const m = currentMask();
    if (!m) return [];
    ensureSat(m);
    const asked = edgeDepth(L), askedInner = innerDepth(L);
    const st = app.state();
    const sig = [
      'fill', L.cols, L.rows, F.shape, F.fit, asked, askedInner, F.soft, F.thresh,
      app.motifPool().join(','), st.format, st.res,
      F.shape === 'custom' ? F.name : ''
    ].join('|');
    if (F.sig === sig && F.tiles) return F.tiles;

    const map = mapOf(L);
    const soft = clamp(F.soft, 0, 45) / 100;
    const loT = soft, hiT = 1 - soft;

    let edge = asked, inner = askedInner, tiles;
    for (;;) {
      const maxD = Math.max(edge, inner);
      const region = (x0, y0, x1, y1) => {
        const d = Math.round(-Math.log2(x1 - x0));       // cell depth, 0 at a lattice cell
        const cov = coverOf(map, m, x0, y0, x1, y1);
        if (cov <= loT + COVER_EPS) return 'out';
        if (cov >= hiT - COVER_EPS) return (d < inner) ? 'edge' : 'in';
        return (d >= edge) ? 'in' : 'edge';              // straddling the outline
      };
      tiles = [];
      for (let j = 0; j < L.rows; j++) {
        for (let i = 0; i < L.cols; i++) {
          for (const t of TR.fillTiling(region, i, j, 1, maxD)) tiles.push(t);
        }
      }
      if (tiles.length <= app.maxLatticeTiles() || (edge <= 0 && inner <= 0)) break;
      /* Over budget: give up outline precision first, then interior detail. */
      if (edge > 0) edge--; else inner--;
    }
    const area = frameShapeArea(map, m, L);
    F.sig = sig; F.tiles = tiles; F.map = map; F.mask = m;
    F.edgeUsed = edge; F.innerUsed = inner; F.area = area;
    return tiles;
  }

  /* The Fill tab frames the FRAME, not the tiles it produced. */
  function viewBounds(tiles) {
    const L = app.lattice();
    const pad = (clamp(app.state().pad, 0, 20) / 100) * Math.max(L.cols, L.rows);
    return [-pad, -pad, L.cols + pad, L.rows + pad];
  }

  /* Quadtree legality and fidelity to the shape, measured on the tile list:
   * no duplicates, size consistent with depth, everything inside the frame, and
   * the two errors a shape fill can actually make - tiles hanging outside the
   * outline, and shape area left unpainted. */
  function audit(L) {
    const tiles = F.tiles || [];
    const m = F.mask, map = F.map;
    const problems = [];
    if (!m || !map) return { problems: ['no mask or mapping'], count: 0, depths: [] };
    ensureSat(m);
    const seen = new Set();
    const depths = new Set();
    let tilesArea = 0, insideArea = 0;
    for (const t of tiles) {
      const k = t.x + ',' + t.y + ',' + t.s;
      if (seen.has(k)) problems.push('duplicate tile ' + k);
      seen.add(k);
      const d = TR.tileDepth(t);
      depths.add(d);
      if (!isFinite(d) || Math.abs(t.s - Math.pow(2, -d)) > 1e-9)
        problems.push('tile size/depth mismatch ' + k);
      if (t.x < -1e-9 || t.y < -1e-9 ||
        t.x + t.s > L.cols + 1e-9 || t.y + t.s > L.rows + 1e-9)
        problems.push('tile outside the frame ' + k);
      const cov = coverOf(map, m, t.x, t.y, t.x + t.s, t.y + t.s);
      if (cov <= 1e-6) problems.push('tile with no shape under it ' + k);
      tilesArea += t.s * t.s;
      insideArea += cov * t.s * t.s;
    }
    /* Unpainted shape area: walk the mask grid and ask whether a covered point
     * landed in a tile. Tiles are disjoint, so a point-in-tile test against a
     * spatial hash of the tile list is exact enough for the area estimate. */
    const occupied = new Set();
    for (const t of tiles) {
      const d0 = TR.tileDepth(t);
      for (let d = 0; d <= d0; d++) {
        const span = Math.pow(2, -d);
        const i0 = Math.floor(t.x / span), i1 = Math.floor((t.x + t.s - 1e-12) / span);
        const j0 = Math.floor(t.y / span), j1 = Math.floor((t.y + t.s - 1e-12) / span);
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) occupied.add(d + ':' + i + ':' + j);
        }
      }
    }
    const pxArea = (2 * map.half / m.w) * (2 * map.half / m.h);
    let paintedShape = 0, shapeTotal = 0;
    for (let row = 0; row < m.h; row++) {
      const ly = map.cy + (map.H / 2 - row - 0.5) * (2 * map.half / m.h);
      for (let x = 0; x < m.w; x++) {
        const cov = m.cov[row * m.w + x];
        if (cov <= 0) continue;
        const lx = map.cx + (x + 0.5 - map.W / 2) * (2 * map.half / m.w);
        if (lx < 0 || ly < 0 || lx > L.cols || ly > L.rows) continue;   // outside the frame
        shapeTotal += cov * pxArea;
        let hit = false;
        for (let d = 0; d <= FILL_MAX_DEPTH && !hit; d++) {
          const key = d + ':' + Math.floor(lx / Math.pow(2, -d)) + ':' + Math.floor(ly / Math.pow(2, -d));
          if (occupied.has(key)) hit = true;
        }
        if (hit) paintedShape += cov * pxArea;
      }
    }
    const spill = tilesArea > 0 ? 1 - insideArea / tilesArea : 0;
    const missed = shapeTotal > 0 ? 1 - paintedShape / shapeTotal : 0;
    return {
      problems, count: tiles.length, area: tilesArea, shapeArea: shapeTotal,
      insideArea, spillFrac: spill, missedFrac: missed,
      depths: Array.from(depths).sort((a, b) => a - b),
      edgeUsed: F.edgeUsed, innerUsed: F.innerUsed
    };
  }

  function fileNameStub() {
    if (F.shape === 'custom') {
      const base = String(F.name || '').replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9]+/g, '');
      return 'fill' + (base.slice(0, 20) || 'mask');
    }
    return 'fill' + F.shape;
  }

  /* ---------- panel wiring ---------- */
  function wireUI() {
    const $ = (id) => document.getElementById(id);
    const bindNumber = (id, key) => {
      const el = $(id);
      if (!el) return;
      el.value = String(F[key]);
      el.addEventListener('input', () => {
        if (el.validity && el.validity.badInput) return;   // "-", "1e": mid-typing
        if (!el.value.trim()) return;                       // cleared: +'' is 0
        const v = +el.value;
        if (!Number.isFinite(v)) return;
        F[key] = clamp(v, +el.min, +el.max);
        app.onChange();
      });
    };
    bindNumber('inFdepth', 'depth');
    bindNumber('inFinner', 'inner');
    bindNumber('inFsoft', 'soft');
    bindNumber('inFthresh', 'thresh');

    const sel = $('selFshape');
    if (sel) {
      sel.value = F.shape;
      sel.addEventListener('change', () => {
        F.shape = sel.value;
        if (F.shape !== 'custom') { F.mask = null; }      // rebuild from the preset
        F.tiles = null; F.sig = '';
        app.onChange();
      });
    }
    const fit = $('selFfit');
    if (fit) {
      fit.value = F.fit;
      fit.addEventListener('change', () => { F.fit = fit.value; F.tiles = null; F.sig = ''; app.onChange(); });
    }
    const base = $('inFbase');
    if (base) {
      base.value = String(app.baseScale().value);
      base.addEventListener('input', () => app.setBaseScale(+base.value));
    }
    const file = $('inFmask');
    if (file) file.addEventListener('change', () => {
      const f = file.files && file.files[0];
      if (f) loadFile(f);
    });
    const pick = $('btnFPick');
    if (pick && file) pick.addEventListener('click', () => file.click());

    const stage = $('stage');
    if (stage) {
      stage.addEventListener('dragover', (e) => { e.preventDefault(); });
      stage.addEventListener('drop', (e) => {
        e.preventDefault();
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (app.tab() !== 'fill') return;
        if (f && /^image\//.test(f.type)) loadFile(f);
      });
    }
    document.addEventListener('paste', (e) => {
      if (app.tab() !== 'fill') return;
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const it of items) {
        if (it.type && /^image\//.test(it.type)) {
          const f = it.getAsFile();
          if (f) { e.preventDefault(); loadFile(f); }
          return;
        }
      }
    });
  }

  function syncLabel() {
    const $ = (id) => document.getElementById(id);
    const L = app.lattice();
    const cap = depthCap(L);
    const out = $('outFdepth');
    /* The boxes keep what was typed and the build applies the geometric cap, so a
     * number is not thrown away just because the base scale was temporarily too
     * dense for it - and the read-out is what says so. Clamping inside the box
     * instead would silently eat the value AND make the read-out impossible. */
    if (out) {
      out.textContent = (cap < F.depth)
        ? '\u2192 ' + cap + ' (tiles stop at ' + FILL_MIN_PX + ' px in the export)'
        : (F.edgeUsed && F.edgeUsed < cap && F.edgeUsed < F.depth)
          ? '\u2192 ' + F.edgeUsed + ' (tile budget)' : '';
    }
    const outIn = $('outFinner');
    if (outIn) {
      outIn.textContent = (cap < F.inner)
        ? '\u2192 ' + cap + ' (tiles stop at ' + FILL_MIN_PX + ' px in the export)' : '';
    }
    const rowMask = $('rowFMask');
    if (rowMask) rowMask.style.display = (F.shape === 'custom') ? '' : 'none';
    const lbl = $('fillInfo');
    if (!lbl) return;
    if (F.shape === 'custom' && !F.mask) {
      lbl.textContent = 'custom mask: choose, drop or paste one \u2014 read locally, never uploaded, not part of a share link';
      return;
    }
    const name = F.shape === 'custom' ? (F.name || 'custom mask')
      : (SHAPES[F.shape] ? SHAPES[F.shape].label : F.shape);
    const pct = F.area > 0 ? (100 * F.area / (L.cols * L.rows)) : 0;
    lbl.textContent = name + ' \u00b7 ' + F.fit + ' \u00b7 shape covers ' + pct.toFixed(1) +
      '% of the frame \u00b7 outline to depth ' + F.edgeUsed + ', interior to depth ' + F.innerUsed;
  }

  /* ================= the Fill ask in the share link =================
   * A Generator picture is fully described by the shared state, so a link
   * describes it exactly. Here the picture is a shape plus a few depths, and
   * those are worth carrying - what must never travel is a mask the other person
   * does not have, so a link that asked for one reopens asking for it. */
  function readShare() {
    if (!app.hashGet) return;
    const num = (key, lo, hi, fallback) => {
      const raw = app.hashGet(key);
      if (raw === null || !raw.trim()) return fallback;
      const v = Number(raw);
      return Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
    };
    const shape = app.hashGet('fsh');
    if (shape && SHAPES[shape]) F.shape = shape;
    const fit = app.hashGet('fft');
    if (fit === 'contain' || fit === 'cover') F.fit = fit;
    F.depth = num('fdp', 1, FILL_MAX_DEPTH, F.depth);
    F.inner = num('fdi', 0, FILL_MAX_DEPTH, F.inner);
    F.soft = num('fso', 0, 45, F.soft);
    F.thresh = num('fth', 1, 99, F.thresh);
  }
  function share() {
    return {
      fsh: F.shape, fft: F.fit, fdp: F.depth, fdi: F.inner,
      fso: F.soft, fth: F.thresh
    };
  }

  readShare();   /* before registering: that call re-applies the active tab */

  app.registerTab('fill', {
    label: 'Fill',
    params: 'fillParams',
    prefix: 'truchetfill_',
    motifs: true,
    ready: () => F.shape !== 'custom' || !!F.mask,
    emptyMessage: 'fill tab: choose a preset shape, or pick \u201ccustom mask\u2026\u201d and drop an image on the canvas',
    mode: () => (F.shape === 'custom' ? 'fillmask' : 'fill' + F.shape),
    tiles: build,
    viewBounds: viewBounds,
    onShow: wireUI,
    onRedraw: syncLabel,
    share: share
  });

  /* Hooks for the QA harness (dev/_fillqa.py drives this same code, not a copy). */
  app.hooks.fill = {
    loadFile, adoptMask, build, audit, viewBounds, currentMask, ensureSat,
    coverOf, mapOf, frameShapeArea, depthCap, edgeDepth, innerDepth, wireUI, syncLabel,
    fileNameStub, hasMask: () => !!F.mask, state: () => F, shapes: SHAPES,
    share, readShare,
    maskEdge: FILL_MASK_EDGE, minPx: FILL_MIN_PX, maxDepthLimit: FILL_MAX_DEPTH
  };
})();
