/* dev/_groundprobe.js — QA probe for the animated ground.
 *
 * Two things have to be proven about a field, and neither is proven by looking
 * at one frame:
 *
 * 1. It is a *field*. Every pixel is painted (the ground is opaque, so a hole
 *    in it is a bug, not a look), it is neither crushed to black nor blown to
 *    white, and it is not a flat wash.
 *
 * 2. It *loops*. Bodies write motion as harmonics of u_time / u_loop, and the
 *    renderer folds the clock into [0, u_loop). That folding is only harmless
 *    if the body really repeats over that span - a raw `t` term means the clock
 *    pops every loop. The seam test compares the step across the wrap point
 *    with an ordinary step of the same size: a periodic field gives about the
 *    same number either way, a non-periodic one gives a jump.
 *
 * Then the app side: the ground choice has to reach the tile palette (the
 * "under" class turning into real transparency is the whole trick), reach the
 * canvas stack, and reach the share link.
 */
window.GROUNDQA = function (mode, over) {
  'use strict';
  const SH = window.TruchetShaders;
  const A = window.TruchetApp;
  const $ = (id) => document.getElementById(id);
  const rows = [], problems = [];
  window.addEventListener('error', (e) => problems.push(e.message));

  if (!SH) return { fatal: 'window.TruchetShaders is missing' };
  if (!A) return { fatal: 'window.TruchetApp is missing' };

  const W = 120, H = 80, SEED = 0.37;
  /* The palette the fields are judged against. The runner may ask for a ground
   * painted with the ink's own colour - something a person can do by hand, and the
   * camouflage case these gates exist to catch. */
  const ov = over || {};
  const INK = ov.ink || '#101018';
  const GROUND = ov.groundIsInk ? INK : (ov.ground || '#f4efe6');

  const rgb = (hex) => SH.hexToRGB(hex);              /* 0..1 */
  const lumOf = (v) => (0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]) * 255;
  const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];

  function flat(hex, w, h) {
    const [r, g, b] = rgb(hex);
    const d = new Uint8Array(w * h * 4);
    for (let i = 0; i < d.length; i += 4) {
      d[i] = r * 255; d[i + 1] = g * 255; d[i + 2] = b * 255; d[i + 3] = 255;
    }
    return d;
  }

  /* A WebGL canvas is read through a 2D one: getImageData is a 2D-canvas thing,
   * and the blit is exactly what the export path does anyway. */
  function blit(cv) {
    const c2 = document.createElement('canvas');
    c2.width = cv.width; c2.height = cv.height;
    const cx = c2.getContext('2d');
    cx.drawImage(cv, 0, 0);
    return cx.getImageData(0, 0, cv.width, cv.height).data;
  }

  function stats(d) {
    let n = 0, opaque = 0, mn = 1e9, mx = -1e9, sum = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 255) opaque++;
      const L = lum(d, i);
      if (L < mn) mn = L; if (L > mx) mx = L;
      sum += L; n++;
    }
    return { n, opaque, mean: sum / n, min: mn, max: mx, spread: mx - mn };
  }

  /* Mean absolute difference per channel: one number for "these two frames are
   * the same picture", in 0..255 units. */
  function mad(a, b) {
    let s = 0, n = 0;
    for (let i = 0; i < a.length; i += 4) {
      for (let k = 0; k < 3; k++) s += Math.abs(a[i + k] - b[i + k]);
      n += 3;
    }
    return s / n;
  }

  /* Pearson correlation of per-pixel luminance between two renders of the same
   * field: 1 if the second kept the first's lightness ordering, -1 if it turned
   * the field inside out. A fold needs this test. 'Every pixel came out a
   * palette colour' is also true of a fold that flips the field, and a ground
   * whose light currents came back dark is a broken ground however well
   * coloured it is. */
  function corr(a, b) {
    const n = Math.min(a.length, b.length) / 4;
    const la = new Float64Array(n), lb = new Float64Array(n);
    let ma = 0, mb = 0;
    for (let i = 0; i < n; i++) {
      la[i] = lum(a, i * 4); lb[i] = lum(b, i * 4); ma += la[i]; mb += lb[i];
    }
    ma /= n; mb /= n;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < n; i++) {
      const xa = la[i] - ma, xb = lb[i] - mb;
      num += xa * xb; da += xa * xa; db += xb * xb;
    }
    const den = Math.sqrt(da * db);
    return den > 0 ? num / den : 0;
  }

  /* Furthest a pixel sits from the line joining the two palette colours.
   * Palette ends arrive in 0..1 and pixels in 0..255; mixing the two units is
   * how this test reported a 140-unit leak on a fold that was exact. */
  function offRamp(d, pa, pb) {
    const a = [pa[0] * 255, pa[1] * 255, pa[2] * 255];
    const b = [pb[0] * 255, pb[1] * 255, pb[2] * 255];
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const dd = dx * dx + dy * dy + dz * dz;
    let worst = 0;
    for (let i = 0; i < d.length; i += 4) {
      let t = ((d[i] - a[0]) * dx + (d[i + 1] - a[1]) * dy + (d[i + 2] - a[2]) * dz) / dd;
      t = Math.min(1, Math.max(0, t));
      const e = Math.max(
        Math.abs(d[i] - (a[0] + t * dx)),
        Math.abs(d[i + 1] - (a[1] + t * dy)),
        Math.abs(d[i + 2] - (a[2] + t * dz)));
      if (e > worst) worst = e;
    }
    return worst;
  }

  if (mode === 'link') {
    /* Run 2: the same picture reached through the link run 1 wrote. */
    const s = A.state();
    const c = $('mainCanvas'), gc = $('groundCanvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let clear = 0, n = 0;
    for (let i = 0; i < d.length; i += 4 * 7) { n++; if (d[i + 3] === 0) clear++; }
    const exp = exportCheck();
    return {
      state: {
        ground: s.ground, shader: s.shader, shSpeed: s.shSpeed,
        shScale: s.shScale, shMix: s.shMix, scrim: s.scrim, tab: s.tab
      },
      canvas: { w: c.width, h: c.height, gcW: gc.width, gcH: gc.height,
                gcShown: gc.style.display, clearFrac: clear / n },
      export: exp,
      problems
    };
  }

  /* The Save PNG path, measured through the button a person actually presses.
   *
   * The claim being tested is the one the code makes in a comment: the file gets
   * the frame the preview was showing. Two measurements, both read off the canvas
   * handed to the encoder (the encoding itself is the browser's job and is not in
   * question here):
   *
   *   match  - pixel difference against a composite of the two live canvases,
   *            taken in the same task so the animation cannot have ticked between
   *            them. Only meaningful when the export is the size on screen.
   *   ground - how much of the file is a colour the tile layer could not have made
   *            on its own. A field must fill a good share of the file with those;
   *            a solid ground must not, because its colour is the tiles' own
   *            'under' class and there is nothing to distinguish it.
   *
   * The download itself is suppressed by stubbing the anchor's click, and both
   * stubs are put back. */
  function exportCheck() {
    const proto = HTMLCanvasElement.prototype, anchor = HTMLAnchorElement.prototype;
    const realBlob = proto.toBlob, realClick = anchor.click;
    let got = null, error = '';
    anchor.click = function () { };
    proto.toBlob = function (cb) {
      try {
        const cc = this.getContext('2d');
        got = { canvas: this, w: this.width, h: this.height,
                data: cc.getImageData(0, 0, this.width, this.height).data };
      } catch (e) { error = String(e && e.message || e); }
      return realBlob.call(this, function () { }, 'image/png');
    };
    try { $('btnExport').click(); } catch (e) { error = 'no export button: ' + e; }
    proto.toBlob = realBlob;
    anchor.click = realClick;
    if (!got) return { error: error || 'export handed nothing to the encoder' };

    const [fw, fh] = A.framePx();
    const out = { w: got.w, h: got.h, frameW: fw, frameH: fh };
    out.sizeOK = got.w === fw && got.h === fh;

    /* Colours the tile layer can produce on its own, read off the live tile canvas
     * rather than from the palette table, so antialiased edges are not counted as
     * ground. */
    const tiles = $('mainCanvas'), td = tiles.getContext('2d')
      .getImageData(0, 0, tiles.width, tiles.height).data;
    const seen = new Map();   /* a 32-level colour bucket -> one raw colour in it */
    for (let i = 0; i < td.length; i += 4) {
      if (td[i + 3] > 200) {
        const k = (td[i] >> 3) + ',' + (td[i + 1] >> 3) + ',' + (td[i + 2] >> 3);
        if (!seen.has(k)) seen.set(k, [td[i], td[i + 1], td[i + 2]]);
      }
    }
    /* A solid ground can only ever produce the tiles' own colours and that colour
     * blended into the ground colour - which is precisely what an antialiased tile
     * edge is. So the colours a solid file may contain are the tile colours and
     * each of them walked towards the ground colour in sixteen steps. Anything
     * outside that set can only have come from a field. Colours are compared in
     * 32-level buckets: a pixel one bucket away from a tile colour has no business
     * being counted as field. */
    const gnd = rgb(A.state().bg).map(v => Math.round(v * 255));
    const q = (r, g, b) => (r >> 3) + ',' + (g >> 3) + ',' + (b >> 3);
    const allowed = new Set();
    seen.forEach((c, k) => {
      allowed.add(k);
      for (let s = 1; s <= 16; s++) {
        const t = s / 16;
        allowed.add(q(c[0] + t * (gnd[0] - c[0]),
                      c[1] + t * (gnd[1] - c[1]),
                      c[2] + t * (gnd[2] - c[2])));
      }
    });
    let foreign = 0, counted = 0;
    for (let i = 0; i < got.data.length; i += 4) {
      counted++;
      const k = (got.data[i] >> 3) + ',' + (got.data[i + 1] >> 3) + ',' + (got.data[i + 2] >> 3);
      if (!allowed.has(k)) foreign++;
    }
    out.groundPct = 100 * foreign / counted;

    /* Compare against the frame the preview is showing, reduced to the preview's
     * size. The file is drawn at its own resolution rather than stretched, so the
     * one thing it can legitimately carry that a preview cannot is detail: the
     * tolerance is wide for a field and tight for a flat ground, and the luminance
     * correlation is what says the file is the same drawing rather than a similar
     * one. */
    const pw = tiles.width, ph = tiles.height;
    const off = document.createElement('canvas');
    off.width = pw; off.height = ph;
    const oc = off.getContext('2d');
    if (A.state().ground === 'shader') oc.drawImage($('groundCanvas'), 0, 0, pw, ph);
    else { oc.fillStyle = A.state().bg; oc.fillRect(0, 0, pw, ph); }
    oc.drawImage(tiles, 0, 0);
    const cd = oc.getImageData(0, 0, pw, ph).data;

    const red = document.createElement('canvas');
    red.width = pw; red.height = ph;
    red.getContext('2d').drawImage(got.canvas, 0, 0, pw, ph);
    const rd = red.getContext('2d').getImageData(0, 0, pw, ph).data;

    let sum = 0;
    for (let i = 0; i < cd.length; i += 4 * 3) {
      sum += Math.abs(cd[i] - rd[i]) + Math.abs(cd[i + 1] - rd[i + 1])
           + Math.abs(cd[i + 2] - rd[i + 2]);
    }
    out.match = sum / (cd.length / 12);
    out.corr = corr(cd, rd);
    return out;
  }

  /* ---------------- 1. each field, on its own ---------------- */
  for (const f of SH.list) {
    const r = { key: f.key, loop: f.loop };
    const cv = document.createElement('canvas');
    const g = SH.createGround(cv);
    if (!g || !g.ok) {
      r.verdict = 'NO GL';
      problems.push(f.key + ': ' + ((g && g.reason) || 'createGround returned nothing'));
      rows.push(r); continue;
    }
    const set = g.setShader(f.key);
    if (set !== true) {
      r.verdict = 'COMPILE FAILED';
      problems.push(f.key + ': ' + set.error);
      rows.push(r); continue;
    }
    r.keyReported = g.key;

    const opts = { scale: 1, mix: 0, scrim: 0, seed: SEED, a: rgb(INK), b: rgb(GROUND) };
    g.resize(W, H);
    const eps = f.loop / 300;                       // one ordinary frame step
    g.setParams(opts); g.render(0); const f0 = blit(cv);
    g.setParams(opts); g.render(0); const f0b = blit(cv);
    g.setParams(opts); g.render(eps); const fStep = blit(cv);
    g.setParams(opts); g.render(f.loop - eps); const fSeam = blit(cv);
    g.setParams(opts); g.render(f.loop / 3); const fThird = blit(cv);

    const st = stats(f0);
    r.opaquePct = 100 * st.opaque / st.n;
    r.mean = st.mean; r.spread = st.spread;
    r.determinism = mad(f0, f0b);
    r.step = mad(f0, fStep);
    r.seam = mad(f0, fSeam);
    r.motion = mad(f0, fThird);

    /* Everything below is measured at one phase - a third of the way through the
     * loop, where a field is neither at its opening frame nor at the seam -
     * including the render it is compared against. Comparing a phase-0 render
     * with a loop/3 render is how drift gets mistaken for a fold bug, and an
     * earlier run of this probe reported veil failing for exactly that reason.
     *
     * The fold is judged on what a fold is for: the field may only use the
     * picture's colours (offRamp), it must still be a spread of lightness and
     * not one flat tone of the palette (rampSpread), it must keep the field's
     * own lightness ordering because that ordering is the field's design
     * (corr: 1 preserves it, -1 would turn every light current in the ground
     * into a dark one), and it must not relight the frame as a whole (shift).
     *
     * 'def' is the state the panel actually opens with, and it is checked for the
     * thing the whole feature is for: the ground still has somewhere to sit that
     * the ink can be read against. The numbers come from the app's own DEFAULTS - a
     * gate that carries its own copy of the defaults stops measuring the product
     * and starts measuring itself. */
    const P = f.loop / 3;
    const baseThird = stats(fThird);

    const ramp = { scale: 1, mix: 1, scrim: 0, seed: SEED, a: rgb(INK), b: rgb(GROUND) };
    g.setParams(ramp); g.render(P);
    const mapped = blit(cv), ms = stats(mapped);
    r.offRamp = offRamp(mapped, rgb(INK), rgb(GROUND));
    r.rampSpread = ms.spread;
    r.corr = corr(fThird, mapped);
    r.shift = Math.abs(ms.mean - baseThird.mean);

    const full = { scale: 1, mix: 0, scrim: 1, seed: SEED, a: rgb(INK), b: rgb(GROUND) };
    g.setParams(full); g.render(P);
    r.toGround = mad(blit(cv), flat(GROUND, W, H));

    const half = { scale: 1, mix: 0, scrim: 0.5, seed: SEED, a: rgb(INK), b: rgb(GROUND) };
    g.setParams(half); g.render(P);
    const halfSt = stats(blit(cv));
    r.scrimMean = halfSt.mean; r.scrimSpread = halfSt.spread;

    const ADEF = A.DEFAULTS;
    const gndL = lumOf(rgb(GROUND)), inkL = lumOf(rgb(INK));
    const def = { scale: ADEF.shScale, mix: ADEF.shMix / 100, scrim: ADEF.scrim / 100,
                  seed: SEED, a: rgb(INK), b: rgb(GROUND) };
    g.setParams(def); g.render(P);
    const defSt = stats(blit(cv));
    r.defMean = defSt.mean; r.defSpread = defSt.spread;
    /* How far into the ink's own lightness the field reaches. A ground as dark as
     * the ink it carries eats the ink: the darkest field pixel is where a tile
     * vanishes into it, so this is judged on the extreme, not on the mean. */
    r.cross = inkL < gndL ? (inkL - defSt.min) : (defSt.max - inkL);
    /* Lightness is not the whole of legibility. A field can sit a hundred units
     * of luminance clear of the ink and still camouflage it by matching the ink's
     * hue - which is what the cells field did on the first look at a still frame:
     * its dark navy patches made the edge of a dark ink blob disappear. So the
     * distance to the ink as a colour is measured too: how close the nearest
     * field pixel gets, and how much of the frame gets that close. */
    const ik = rgb(INK), dd = blit(cv);
    let near = 0, nearest = 1e9;
    const lums = [];
    for (let i = 0; i < dd.length; i += 4) {
      const e = Math.max(Math.abs(dd[i] - ik[0] * 255),
                         Math.abs(dd[i + 1] - ik[1] * 255),
                         Math.abs(dd[i + 2] - ik[2] * 255));
      if (e < nearest) nearest = e;
      if (e < 40) near++;
      lums.push(lum(dd, i));
    }
    lums.sort((x, y) => x - y);
    /* The practical question is not the single darkest pixel but whether the ink
     * has room to be read: the darkest five percent of the ground has to sit a
     * clear step off the ink's own lightness, because that five percent is where
     * an ink tile actually sits. */
    r.inkMin = nearest;
    r.inkNearPct = 100 * near / (dd.length / 4);
    r.inkGap5 = inkL < gndL ? (lums[Math.floor(lums.length * 0.05)] - inkL)
                        : (inkL - lums[Math.floor(lums.length * 0.95)]);
    r.inkNear5 = 100 * (inkL < gndL
      ? lums.filter(v => v - inkL < 25).length / lums.length
      : lums.filter(v => inkL - v < 25).length / lums.length);

    const bad = [];
    if (r.opaquePct < 100) bad.push('painted ' + r.opaquePct.toFixed(1) + '% of the frame');
    if (st.mean < 25 || st.mean > 230) bad.push('mean luminance ' + st.mean.toFixed(0));
    if (st.spread < 12) bad.push('flat: spread ' + st.spread.toFixed(0));
    if (r.determinism > 0.5) bad.push('not deterministic (' + r.determinism + ')');
    if (r.motion < 3) bad.push('does not animate (' + r.motion.toFixed(2) + ' per third-loop)');
    if (r.seam > 3 * r.step + 4)
      bad.push('loop seam: ' + r.seam.toFixed(2) + ' vs an ordinary step of ' + r.step.toFixed(2));
    if (r.offRamp > 6) bad.push('palette fold leaks ' + r.offRamp.toFixed(1) + ' off the ramp');
    if (r.rampSpread < 12) bad.push('palette fold is flat (' + r.rampSpread.toFixed(0) + ')');
    if (r.corr < 0.9) bad.push("palette fold scrambles the field's lightness (corr " + r.corr.toFixed(2) + ')');
    if (r.shift > 45) bad.push('palette fold relights the frame by ' + r.shift.toFixed(0));
    if (r.toGround > 2) bad.push('scrim at 100% is not the ground colour (' + r.toGround.toFixed(2) + ')');
    const expect = 0.5 * baseThird.mean + 0.5 * gndL;
    if (Math.abs(halfSt.mean - expect) > 25) bad.push('scrim at 50% sits at luminance '
      + halfSt.mean.toFixed(0) + ', not half way from ' + baseThird.mean.toFixed(0)
      + ' to the ground colour (' + expect.toFixed(0) + ')');
    if (halfSt.spread >= baseThird.spread)
      bad.push('scrim did not quiet the field: ' + halfSt.spread.toFixed(0)
        + ' against an unscrimmed ' + baseThird.spread.toFixed(0));
    if (Math.abs(r.defMean - inkL) < 30)
      bad.push('at the opening defaults the ground sits ' + Math.abs(r.defMean - inkL).toFixed(0)
        + ' of luminance from the ink, which is not enough to read a pattern against');
    if (r.defSpread < 12)
      bad.push('at the opening defaults the ground is flat (' + r.defSpread.toFixed(0) + ')');
    if (r.cross > 5)
      bad.push('at the opening defaults the ground reaches ' + r.cross.toFixed(0)
        + " past the ink's own lightness, where tiles would vanish into it");
    if (r.inkNearPct > 2)
      bad.push('at the opening defaults ' + r.inkNearPct.toFixed(1) + '% of the ground sits '
        + 'within a hair of the ink as a colour (nearest ' + r.inkMin.toFixed(0)
        + '), which camouflages the ink\'s own edges');
    if (r.inkMin < 40)
      bad.push('the nearest ground colour is only ' + r.inkMin.toFixed(0)
        + ' away from the ink, so an ink tile can land on ground it cannot be read from');
    if (r.inkGap5 < 40)
      bad.push('the darkest five percent of the ground sits only ' + r.inkGap5.toFixed(0)
        + ' luminance off the ink, which is where ink tiles actually sit');
    r.verdict = bad.length ? 'FAIL: ' + bad.join('; ') : 'ok';
    if (bad.length) problems.push(f.key + ': ' + r.verdict);
    rows.push(r);
  }

  /* ---------------- 2. the ground through the real controls ---------------- */
  const c = $('mainCanvas'), gc = $('groundCanvas');
  const info = $('groundInfo');

  function canvasReport() {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let clear = 0, inked = 0, n = 0;
    for (let i = 0; i < d.length; i += 4 * 7) {
      n++;
      if (d[i + 3] === 0) clear++;
      else if (lum(d, i) < 90) inked++;
    }
    const corner = c.getContext('2d').getImageData(0, 0, 1, 1).data;
    return {
      w: c.width, h: c.height, gcW: gc.width, gcH: gc.height,
      gcShown: gc.style.display,
      clearFrac: clear / n, inkFrac: inked / n,
      corner: Array.prototype.join.call(corner, ',')
    };
  }

  const solid = { tiling: 'chk' };
  const before = canvasReport();
  const bgRGB = rgb(A.state().bg);
  const solidOK =
    before.clearFrac === 0 &&
    Math.abs(+before.corner.split(',')[0] - bgRGB[0] * 255) < 6 &&
    before.gcShown === 'none';
  rows.push({ key: 'app:solid', clearFrac: before.clearFrac, corner: before.corner,
              gcShown: before.gcShown, verdict: solidOK ? 'ok' : 'FAIL' });
  if (!solidOK) problems.push('solid ground: expected an opaque canvas filled with '
    + A.state().bg + ' and a hidden ground canvas, got ' + JSON.stringify(before));

  /* The file a solid ground produces: its background colour is the tiles' own
   * 'under' class, so the file holds no colour the tile layer could not have made.
   * If this measure ever shows a share of foreign colours, the export is inventing
   * something. */
  const exSolid = exportCheck();
  const solidExportOK = !exSolid.error && exSolid.sizeOK
    && exSolid.match < 6 && exSolid.corr > 0.99 && exSolid.groundPct < 1;
  rows.push(Object.assign({ key: 'app:export:solid', verdict: solidExportOK ? 'ok' : 'FAIL' }, exSolid));
  if (!solidExportOK) problems.push('export over a solid ground: ' + JSON.stringify(exSolid)
    + ' - expected the frame at ' + A.framePx().join('x')
    + ', the preview composite, and no colour the tiles did not make');

  const set = (id, v) => {
    const e = $(id);
    if (!e) throw new Error('no element #' + id);
    e.value = v; e.dispatchEvent(new Event('input'));
  };
  let linkOut = '';
  const opening = {};
  ['selTiling', 'selGround', 'selShader', 'inShSpeed', 'inShScale', 'inShMix', 'inScrim']
    .forEach((id) => { const e = $(id); if (e) opening[id] = e.value; });
  try {
    set('selTiling', 'chk');            // a fixed tiling, so the picture is comparable
    set('selGround', 'shader');
    set('selShader', 'ripple');
    set('inShSpeed', '2.5');
    set('inShScale', '1.5');
    set('inShMix', '70');
    set('inScrim', '30');
    const live = canvasReport();
    linkOut = location.hash.slice(1);
    const want = { gr: 'shader', sh: 'ripple', ss: '2.5', sc: '1.5', sm: '70', sr: '30' };
    const p = new URLSearchParams(linkOut);
    const miss = Object.keys(want).filter(k => p.get(k) !== want[k]);
    const stackOK = live.gcShown === 'block' && live.gcW === live.w && live.gcH === live.h;
    const ok = live.clearFrac > 0.05 && live.clearFrac < 0.99 && live.inkFrac > 0.01
      && stackOK && !miss.length && /ripple/.test(info.textContent);
    rows.push({
      key: 'app:shader', clearFrac: live.clearFrac, inkFrac: live.inkFrac,
      gcShown: live.gcShown, gcSize: live.gcW + 'x' + live.gcH,
      mainSize: live.w + 'x' + live.h, info: info.textContent.slice(0, 60),
      missingFromLink: miss.join(','), verdict: ok ? 'ok' : 'FAIL'
    });
    if (!ok) {
      if (live.clearFrac <= 0.05 || live.clearFrac >= 0.99)
        problems.push('shader ground: the tile canvas is ' + live.clearFrac
          + ' transparent, so the field cannot read through it');
      if (live.inkFrac <= 0.01) problems.push('shader ground: no ink painted');
      if (!stackOK) problems.push('shader ground: canvases not stacked: main '
        + live.w + 'x' + live.h + ' ground ' + live.gcW + 'x' + live.gcH
        + ' display ' + live.gcShown);
      if (miss.length) problems.push('share link is missing ' + miss.join(',') + ' in ' + linkOut);
      if (!/ripple/.test(info.textContent)) problems.push('read-out does not name the field: '
        + info.textContent);
    }
  } catch (e) { problems.push('app check threw: ' + (e && e.message)); }

  /* The same export over a field: the frame has to arrive at the file (match) and
   * a real share of the file has to be colours the tile layer cannot make on its
   * own, which is the only proof the field reached the pixels and not just the
   * preview. */
  const exField = exportCheck();
  const fieldExportOK = !exField.error && exField.sizeOK
    && exField.match < 20 && exField.corr > 0.98 && exField.groundPct > 10;
  rows.push(Object.assign({ key: 'app:export:field', verdict: fieldExportOK ? 'ok' : 'FAIL' }, exField));
  if (!fieldExportOK) problems.push('export over a field: ' + JSON.stringify({
    w: exField.w, h: exField.h, frame: exField.frameW + 'x' + exField.frameH,
    match: exField.match, corr: exField.corr, groundPct: exField.groundPct
  }) + ' - expected the frame at ' + A.framePx().join('x')
    + ', equal to the preview composite, and over 10% of the file in field colours');

  /* Leave the app as the probe found it. A probe that ends in a state it chose makes
   * the next measurement in the same page lie: the opening canvas check would see the
   * previous run's leftovers and report them as the app's own behaviour. */
  try {
    Object.keys(opening).forEach((id) => set(id, opening[id]));
  } catch (e) { problems.push('could not put the controls back: ' + (e && e.message)); }

  return { rows, problems, shareLink: linkOut, fieldCount: SH.list.length };
};
