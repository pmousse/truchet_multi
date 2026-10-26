/* Photo tab for Truchet Studio.
 *
 * Renders an image as a multi-scale Truchet pattern with the same engine as the
 * Generator tab, using Carlson's two ideas and nothing invented:
 *
 *   1. a quadtree that subdivides where the image actually changes, so tile size
 *      follows the scale of the features (his multi-scale construction), and
 *   2. per-tile motif choice, here driven by tone: each motif covers a known
 *      fraction of its square (T.MOTIF_INK, measured from this engine's own
 *      rendering), so a tile is given the motif whose coverage the image is
 *      asking for at that spot.
 *
 * Tone needs two bands, and a tiling on one ground provides exactly two, in
 * Carlson's own terms: a tile at even depth covers MOTIF_INK of its square in
 * the dark colour, a tile at odd depth is the same motif with its colours swapped
 * (his InvertMotif) and covers 1 - MOTIF_INK. Both halves are measured from this
 * engine's rendering, not derived, and the measurement also shows that the two
 * circuit colour classes partition the square - between them they cover 0.99 of
 * it - so a tile repaints its own square instead of overlaying what was drawn
 * below it, which is what makes per-tile tone control possible at all. Measured
 * ink runs 0.17 to 0.65 plain and 0.35 to 0.83 inverted, a wide range but not the
 * whole greyscale: contrast is preserved, the extremes are not, because the model
 * has nothing darker or lighter to give.
 * The quadtree therefore chooses *which parity* a cell lands on as well as how
 * far it subdivides, and a cell's tone is clamped into the range the chosen
 * motifs can actually reach: tones inside it are kept exactly, and only the
 * extremes are given up.
 *
 * The image never leaves the page: it is decoded locally, reduced to a small
 * luminance grid with summed area tables, and nothing about it goes into the
 * share link. That is why a Photo link reopens asking for the image again.
 *
 * Loaded after src/app.js, which exposes the tab shell on window.TruchetApp.
 */
(function () {
  'use strict';
  const TR = window.Truchet;
  const app = window.TruchetApp;
  if (!TR || !app) {
    app && app.showError('photo tab: app shell missing');
    return;
  }

  const PHOTO_SAMPLE_EDGE = 720;   // long edge of the luminance sampling grid
  const PHOTO_MIN_PX = 12;         // never subdivide below this in the export
  const PHOTO_MAX_DEPTH = 8;       // hard ceiling: a cell can shrink to 1/256
  const PHOTO_TONE_DITHER = 2;     // splits allowed purely to get the tone right
  const INK_JITTER = 0.05;         // tone slack that still counts as a match

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /* Photo-only state, deliberately outside app's state so it cannot leak into
   * the share link. */
  const P = {
    contrast: 100,        // %   (100 = neutral)
    depth: 5,             // quadtree subdivision steps, further limited by tile size
    flatness: 6,          // % local std that counts as "uniform, stop here"
    invert: false,        // treat dark as light
    base: 2,              // base lattice multiplier (app's S.n, mirrored here)
    name: '',
    image: null,          // {w,h,lum,contrast,sat,sat2}
    tiles: null, sig: '', map: null, depthUsed: 0
  };

  /* ---------- loading ---------- */
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
      app.showError('could not read that image: ' + (e && e.message ? e.message : e));
      return false;
    }
    return adopt(img, file.name);
  }

  /* Reduce the image to a small luminance grid, once. Alpha is composited onto
   * white so a transparent PNG reads the way it looks on screen; Rec.709 luma
   * because that is what human brightness actually is. */
  function adopt(img, name) {
    const iw = img.width || img.naturalWidth, ih = img.height || img.naturalHeight;
    if (!iw || !ih) { app.showError('that file has no pixel size'); return false; }
    const k = Math.min(1, PHOTO_SAMPLE_EDGE / Math.max(iw, ih));
    const w = Math.max(1, Math.round(iw * k)), h = Math.max(1, Math.round(ih * k));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.fillStyle = '#ffffff';
    cx.fillRect(0, 0, w, h);
    cx.drawImage(img, 0, 0, w, h);
    const d = cx.getImageData(0, 0, w, h).data;
    const lum = new Float64Array(w * h);
    for (let p = 0, i = 0; i < d.length; i += 4, p++) {
      lum[p] = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    }
    P.image = { w, h, lum, contrast: NaN, sat: null, sat2: null };
    P.name = String(name || 'image').replace(/^.*[\\/]/, '');
    P.tiles = null; P.sig = ''; P.map = null;
    app.clearError();
    app.onChange();
    syncLabel();
    return true;
  }

  /* Summed area tables of luminance and luminance squared, so a quadtree query
   * costs four array reads rather than a walk over the pixels in the cell.
   * Contrast is folded in here rather than at sampling time: moving the contrast
   * slider rebuilds the tables without decoding the image again. */
  function tables() {
    const im = P.image;
    if (!im) return null;
    const k = clamp(P.contrast, 10, 300) / 100;
    if (im.contrast === k && im.sat) return im;
    const w = im.w, h = im.h, lum = im.lum, W = w + 1;
    const sat = new Float64Array(W * (h + 1));
    const sat2 = new Float64Array(W * (h + 1));
    for (let y = 0; y < h; y++) {
      let rowSum = 0, rowSum2 = 0;
      const src = y * w, dst = (y + 1) * W;
      for (let x = 0; x < w; x++) {
        const v = clamp((lum[src + x] - 0.5) * k + 0.5, 0, 1);
        rowSum += v; rowSum2 += v * v;
        sat[dst + x + 1] = sat[dst - W + x + 1] + rowSum;
        sat2[dst + x + 1] = sat2[dst - W + x + 1] + rowSum2;
      }
    }
    im.contrast = k; im.sat = sat; im.sat2 = sat2;
    P.tiles = null; P.sig = '';       // the tone statistics just changed
    return im;
  }

  /* Mean and standard deviation of the tone over a rectangle given in lattice
   * units. Image rows run downward while the tiling's y runs upward, which is
   * the one place the two coordinate systems meet. */
  function stats(im, map, x0, y0, x1, y1) {
    const cL = clamp(Math.floor(map.px(x0)), 0, im.w);
    const cR = clamp(Math.ceil(map.px(x1)), 0, im.w);
    const ra = clamp(Math.floor(map.py(y1)), 0, im.h);
    const rb = clamp(Math.ceil(map.py(y0)), 0, im.h);
    const rTop = Math.min(ra, rb), rBot = Math.max(ra, rb);
    const area = (cR - cL) * (rBot - rTop);
    if (area <= 0) return { mean: 1, std: 0 };
    const W = im.w + 1;
    const a = rBot * W + cR, b = rTop * W + cR, c = rBot * W + cL, d = rTop * W + cL;
    const s1 = im.sat[a] - im.sat[b] - im.sat[c] + im.sat[d];
    const s2 = im.sat2[a] - im.sat2[b] - im.sat2[c] + im.sat2[d];
    const mean = s1 / area;
    return { mean, std: Math.sqrt(Math.max(0, s2 / area - mean * mean)) };
  }

  /* Cover-fit the sampled image onto the lattice rectangle: the frame is filled
   * completely and the SOURCE is cropped, which is the opposite of cutting a
   * window out of the pattern (Carlson's CropSquareTiling) and is what the frame
   * presets are for. */
  function makeMap(im, L) {
    const s = (im.w / im.h > L.cols / L.rows) ? L.rows / im.h : L.cols / im.w;
    const ox = (L.cols - im.w * s) / 2, oy = (L.rows - im.h * s) / 2;
    return {
      s, ox, oy,
      px: (wx) => (wx - ox) / s,
      py: (wy) => im.h - (wy - oy) / s
    };
  }

  /* ---------- tone bands ----------
   * Which dark coverage the selected motifs can actually produce, per parity,
   * read from the measured ink table (engine.js documents how it was measured).
   * Inverted coverage is 1 - ink: the two circuit classes partition the square,
   * an identity inktest.html verifies rather than assumes. */
  function bands() {
    const pool = app.motifPool();
    let lo = Infinity, hi = -Infinity;
    for (const m of pool) {
      const v = TR.MOTIF_INK[m];
      if (typeof v === 'number') { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    }
    if (!(lo <= hi)) { lo = hi = 0.5; }
    return { lo, hi, even: [lo, hi], odd: [1 - hi, 1 - lo] };
  }
  const darkOf = (motif, depth) =>
    (depth % 2 === 1) ? 1 - TR.MOTIF_INK[motif] : TR.MOTIF_INK[motif];
  const bandError = (want, depth, b) => {
    const iv = (depth % 2 === 1) ? b.odd : b.even;
    return want < iv[0] ? iv[0] - want : (want > iv[1] ? want - iv[1] : 0);
  };
  /* What the image is asking for, as dark coverage of a tile, brought into the
   * band the selected motifs can reach. Clamping rather than stretching: the
   * band covers most of the range a black-and-white picture asks for, so the
   * honest thing is to keep tones that fit exactly and give up only the extremes
   * - stretching every tone to fill the band would distort the whole picture to
   * rescue its darkest and lightest few percent. */
  function ask(meanLuma, b) {
    const want = P.invert ? meanLuma : 1 - meanLuma;
    return clamp(want, b.lo, b.hi);
  }
  const wantDark = (mean) => P.invert ? mean : 1 - mean;

  /* Mean and spread of the ask over the whole sampled image, reported so the
   * clamping above can be read against the picture. */
  function imageTone(im) {
    const W = im.w + 1, w = im.w, h = im.h;
    const a = h * W + w;
    const s1 = im.sat[a], s2 = im.sat2[a], area = w * h;
    const mean = s1 / area;
    const std = Math.sqrt(Math.max(0, s2 / area - mean * mean));
    return { mean, std, lo: clamp(mean - 2 * std, 0, 1), hi: clamp(mean + 2 * std, 0, 1) };
  }

  /* Depth is capped by how large a lattice cell actually is in export pixels: a
   * motif smaller than ~12 px is mush, so the quadtree stops before it gets
   * there. The cap uses the EXPORT size, not the preview size, so the structure
   * on screen is the structure in the file. */
  /* How deep the quadtree MAY go here: a cell is never split below
   * PHOTO_MIN_PX device pixels in the export, and that geometric limit is
   * separate from the number the user asked for, because the detail slider needs
   * to advertise only the range that can still do something. */
  function depthCap(L) {
    const [fw, fh] = app.framePx();
    const pxPerUnit = Math.max(fw / L.cols, fh / L.rows);
    const bySize = Math.floor(Math.log2(Math.max(1, pxPerUnit / PHOTO_MIN_PX)));
    return clamp(bySize, 0, PHOTO_MAX_DEPTH);
  }
  function maxDepth(L) {
    return clamp(Math.min(P.depth, depthCap(L)), 0, PHOTO_MAX_DEPTH);
  }

  /* The tiling. Two rules decide whether a cell splits:
   *
   *   detail  - the tone still varies inside the cell more than 'smoothness'
   *             allows, so split to follow the image;
   *   tone    - staying here would put the cell on a parity whose coverage band
   *             is further from the tone than the parity one level down, so
   *             split to land on the right band. This is bounded by
   *             PHOTO_TONE_DITHER so that a mid-tone area becomes a halftone mix
   *             rather than exploding into the deepest tiles everywhere.
   *
   * Engine contract: 'in' = lay one tile here and stop, 'edge' = split. */
  function build(L) {
    const im = tables();
    if (!im) return [];
    const st = app.state();
    const asked = maxDepth(L);
    const sig = [
      'photo', L.cols, L.rows, asked, P.flatness, P.contrast, P.invert ? 1 : 0,
      app.motifPool().join(','), im.w + 'x' + im.h, P.name, st.format, st.res
    ].join('|');
    if (P.sig === sig && P.tiles) return P.tiles;

    const map = makeMap(im, L);
    const flat = clamp(P.flatness, 0, 40) / 100;
    const b = bands();
    const tone = imageTone(im);

    let maxD = asked, tiles;
    for (;;) {
      const region = (x0, y0, x1, y1) => {
        const d = Math.round(-Math.log2(x1 - x0));      // cell depth, 0 at a lattice cell
        if (d >= maxD) return 'in';
        const s = stats(im, map, x0, y0, x1, y1);
        if (s.std > flat) return 'edge';
        const want = ask(s.mean, b);
        if (d < PHOTO_TONE_DITHER && bandError(want, d, b) > bandError(want, d + 1, b)) {
          return 'edge';                                  // flip parity for the tone
        }
        return 'in';
      };
      tiles = [];
      for (let j = 0; j < L.rows; j++) {
        for (let i = 0; i < L.cols; i++) {
          for (const t of TR.fillTiling(region, i, j, 1, maxD)) tiles.push(t);
        }
      }
      if (tiles.length <= app.maxLatticeTiles() || maxD <= 0) break;
      maxD--;               // over budget: coarsen the whole tiling one level
    }
    P.sig = sig; P.tiles = tiles; P.map = map; P.depthUsed = maxD;
    P.bands = b; P.tone = tone;
    return tiles;
  }

  /* Motif choice: among the motifs the user selected, take those whose coverage
   * AT THIS CELL'S PARITY is within a small slack of the best match and pick one
   * at random. Exact matching alone bands, because several tones map to the same
   * motif. Tiles are visited in a fixed order, so the pattern is stable across
   * redraws and for a given seed - same convention as the Generator's pool. */
  function pickerFor(tiles) {
    const im = tables();
    if (!im || !P.map) return () => TR.connIdxByName('/');
    const pool = app.motifPool();
    const b = P.bands || bands();
    const tone = P.tone || imageTone(im);
    const rnd = TR.mulberry32(TR.seedFromString(
      app.state().seed + '\u0001photo:' + pool.join(',')));
    const key = (t) => t.x + ',' + t.y + ',' + t.s;
    const map = new Map();
    const sorted = tiles.slice().sort(
      (a, b2) => (a.x - b2.x) || (a.y - b2.y) || (a.s - b2.s));
    for (const t of sorted) {
      const depth = TR.tileDepth(t);
      const want = ask(stats(im, P.map, t.x, t.y, t.x + t.s, t.y + t.s).mean, b);
      let best = Infinity;
      for (const m of pool) best = Math.min(best, Math.abs(darkOf(m, depth) - want));
      const near = pool.filter((m) => Math.abs(darkOf(m, depth) - want) <= best + INK_JITTER);
      map.set(key(t), TR.connIdxByName(near[Math.floor(rnd() * near.length) % near.length]));
    }
    const fallback = TR.connIdxByName(pool[0]);
    return (depth, t) => {
      const v = map.get(key(t));
      return (v === undefined) ? fallback : v;
    };
  }

  /* Tone diagnostics for the QA harness: what each tile covers versus what the
   * image asked for, plus the correlation between the two. 'want' is the raw ask
   * and 'target' the ask after the stretch, so a harness can measure fidelity
   * against the picture itself and consistency against the model. */
  function report() {
    const im = tables();
    if (!im || !P.tiles || !P.map) return null;
    const b = P.bands || bands();
    const tone = P.tone || imageTone(im);
    const rows = [];
    for (const t of P.tiles) {
      const s = stats(im, P.map, t.x, t.y, t.x + t.s, t.y + t.s);
      const raw = wantDark(s.mean);
      const want = ask(s.mean, b);
      const depth = TR.tileDepth(t);
      let motif = pool0(), bestErr = Infinity;
      for (const m of app.motifPool()) {
        const err = Math.abs(darkOf(m, depth) - want);
        if (err < bestErr) { bestErr = err; motif = m; }
      }
      rows.push({
        x: t.x, y: t.y, s: t.s, depth, motif, want, raw,
        have: darkOf(motif, depth), err: bestErr, std: s.std,
        bandError: bandError(want, depth, b)
      });
    }
    const n = rows.length;
    if (!n) return null;
    let sumErr = 0, worst = 0, sumBand = 0, mx = 0, my = 0, mraw = 0;
    for (const r of rows) {
      sumErr += r.err; worst = Math.max(worst, r.err); sumBand += r.bandError;
      mx += r.want; my += r.have; mraw += r.raw;
    }
    mx /= n; my /= n; mraw /= n;
    /* Two correlations: against the stretched ask (does the tab do what it says)
     * and against the picture's own tone (does the result read as the picture). */
    let sxy = 0, sxx = 0, syy = 0, sxyRaw = 0, sxxRaw = 0;
    for (const r of rows) {
      sxy += (r.want - mx) * (r.have - my);
      sxx += (r.want - mx) * (r.want - mx);
      syy += (r.have - my) * (r.have - my);
      sxyRaw += (r.raw - mraw) * (r.have - my);
      sxxRaw += (r.raw - mraw) * (r.raw - mraw);
    }
    const corr = (sxx > 0 && syy > 0) ? sxy / Math.sqrt(sxx * syy) : 0;
    const corrRaw = (sxxRaw > 0 && syy > 0) ? sxyRaw / Math.sqrt(sxxRaw * syy) : 0;
    const sizes = {};
    for (const r of rows) sizes[r.s.toFixed(6)] = (sizes[r.s.toFixed(6)] || 0) + 1;
    return {
      tiles: n, depthUsed: P.depthUsed, depthAsked: maxDepth(app.lattice()),
      meanErr: sumErr / n, meanBandErr: sumBand / n, worstErr: worst,
      corr, corrRaw, wantMean: mx, rawMean: mraw, haveMean: my,
      bands: b, tone: tone, sizeHistogram: sizes,
      sample: rows.slice(0, 6)
    };
  }
  function pool0() { const p = app.motifPool(); return p[0] || '/'; }

  /* Quadtree legality, checked on the tile list itself: sizes are powers of two
   * that never shrink by more than half in one step, no duplicates, everything
   * inside the lattice, and the tiles cover the frame exactly (the sum of their
   * areas is the frame area) - which is the whole point of the frame work. */
  function audit(L) {
    const tiles = P.tiles || [];
    const problems = [];
    let area = 0;
    const seen = new Set();
    const levels = new Set();
    for (const t of tiles) {
      const k = t.x + ',' + t.y + ',' + t.s;
      if (seen.has(k)) problems.push('duplicate tile ' + k);
      seen.add(k);
      const d = TR.tileDepth(t);
      levels.add(d);
      if (!isFinite(d) || Math.abs(t.s - Math.pow(2, -d)) > 1e-9)
        problems.push('tile size/depth mismatch ' + k);
      if (t.x < -1e-9 || t.y < -1e-9 ||
        t.x + t.s > L.cols + 1e-9 || t.y + t.s > L.rows + 1e-9)
        problems.push('tile outside the frame ' + k);
      area += t.s * t.s;
    }
    const frame = L.cols * L.rows;
    if (Math.abs(area - frame) > 1e-6 * frame)
      problems.push('coverage gap: tiles cover ' + area.toFixed(6) + ' of ' + frame);
    const ds = Array.from(levels).sort((a, b) => a - b);
    for (let i = 1; i < ds.length; i++) {
      if (ds[i] - ds[i - 1] > 1) problems.push('depth jump ' + ds[i - 1] + ' -> ' + ds[i]);
    }
    return { problems, area, frame, depths: ds, count: tiles.length };
  }

  function fileNameStub() {
    const base = String(P.name || '').replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9]+/g, '');
    return base.slice(0, 24) || 'photo';
  }

  /* ---------- panel wiring (this file owns the Photo controls) ---------- */
  function wireUI() {
    const $ = (id) => document.getElementById(id);
    const bindRange = (id, key, outId, suffix) => {
      const el = $(id);
      if (!el) return;
      el.value = String(P[key]);
      const out = $(outId);
      const paint = () => { if (out) out.textContent = P[key] + (suffix || ''); };
      el.addEventListener('input', () => { P[key] = +el.value; paint(); app.onChange(); });
      paint();
    };
    /* These four are the whole multi-scale control surface, so they are wired
     * here explicitly and dev/photoharness.js checks that each one changes the
     * result. A missing listener is otherwise invisible on screen: syncLabel
     * repaints the read-outs from P, so the numbers move while the pattern sits
     * still - which is exactly the bug this wiring used to have. */
    bindRange('inPdepth', 'depth', 'outPdepth');
    bindRange('inPflat', 'flatness', 'outPflat');
    bindRange('inPcon', 'contrast', 'outPcon');
    const base = $('inBase');
    if (base) {
      base.value = String(app.baseScale().value);
      base.addEventListener('input', () => app.setBaseScale(+base.value));
    }

    const inv = $('chkPinvert');
    if (inv) {
      inv.checked = P.invert;
      inv.addEventListener('change', () => { P.invert = inv.checked; app.onChange(); });
    }
    const file = $('inPhoto');
    if (file) {
      file.addEventListener('change', () => {
        const f = file.files && file.files[0];
        if (f) loadFile(f);
      });
    }
    const pick = $('btnPhotoPick');
    if (pick && file) pick.addEventListener('click', () => file.click());

    /* Dropping the image on the canvas is the common case; hunting for the file
     * input in the panel is not. Pasting from the clipboard works too. */
    const stage = $('stage');
    if (stage) {
      stage.addEventListener('dragover', (e) => { e.preventDefault(); });
      stage.addEventListener('drop', (e) => {
        e.preventDefault();
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f && /^image\//.test(f.type)) loadFile(f);
      });
    }
    document.addEventListener('paste', (e) => {
      if (app.tab() !== 'photo') return;
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

  /* Called on every redraw so the readouts match what is on screen: the sampled
   * image, the tone bands the current motif selection can reach, and the depth
   * the quadtree actually used. */
  function syncLabel() {
    const el = document.getElementById('photoName');
    if (el && P.image) {
      const b = bands();
      el.textContent = P.name + ' \u2014 ' + P.image.w + '\u00d7' + P.image.h +
        ' sampled \u00b7 reachable tone ' + b.lo.toFixed(2) + '\u2013' + b.hi.toFixed(2) +
        ' (plain ' + b.even[0].toFixed(2) + '\u2013' + b.even[1].toFixed(2) +
        ', inverted ' + b.odd[0].toFixed(2) + '\u2013' + b.odd[1].toFixed(2) + ')';
    } else if (el) {
      el.textContent = '';
    }
    const out = document.getElementById('outPdepth');
    if (out) {
      /* Depth is capped by physics, not by the slider: this grid at this export
       * resolution cannot subdivide past depthCap levels without tiles dropping
       * under PHOTO_MIN_PX device pixels, and the tile budget can coarsen it
       * further. Both are reported, and the slider is limited to what is
       * reachable, so the range never runs into a stretch that does nothing. */
      const cap = depthCap(app.lattice());
      const el = document.getElementById('inPdepth');
      if (el) el.max = String(Math.max(1, cap));
      const used = Math.max(0, P.depthUsed);
      let text = P.depth + ' levels';
      if (cap < P.depth) text += ' \u2192 ' + cap + ' (capped: tiles stop at ' + PHOTO_MIN_PX + ' px)';
      else if (used && used < cap) text += ' \u2192 ' + used + ' (tile budget)';
      out.textContent = text;
    }
    const outFlat = document.getElementById('outPflat');
    if (outFlat) outFlat.textContent = P.flatness + '%';
    const outCon = document.getElementById('outPcon');
    if (outCon) outCon.textContent = P.contrast + '%';
    const base = document.getElementById('inBase');
    if (base) {
      const bs = app.baseScale();
      base.max = String(bs.max);
      base.value = String(clamp(P.base, 1, bs.max));
      const lbl = document.getElementById('outBase');
      if (lbl) lbl.textContent = '\u00d7' + app.lattice().t;
    }
  }

  app.registerTab('photo', {
    label: 'Photo',
    params: 'photoParams',
    prefix: 'truchetphoto_',
    motifs: true,
    ready: () => !!P.image,
    emptyMessage: 'photo tab: choose, drop or paste an image \u2014 it is read locally and never uploaded',
    tiles: build,
    picker: pickerFor,
    onShow: wireUI,
    onRedraw: syncLabel
  });

  /* Hooks for the QA harness (dev/_photoqa.py drives a synthetic image through
   * exactly this code path, not a copy of it). */
  app.hooks.photo = {
    loadFile, adopt, build, pickerFor, report, audit, tables, stats,
    makeMap, maxDepth, depthCap, bands, darkOf, bandError, wantDark, ask, imageTone,
    fileNameStub, wireUI, syncLabel,
    hasImage: () => !!P.image,
    state: () => P,
    sampleEdge: PHOTO_SAMPLE_EDGE, minPx: PHOTO_MIN_PX,
    maxDepthLimit: PHOTO_MAX_DEPTH, toneDither: PHOTO_TONE_DITHER
  };
})();
