/* dev/_inkfieldprobe.js - measurement only. Drives the real app (state + onChange, so
 * the tiles are built and drawn by the shipped code) and compares a picture whose
 * ink is a plain colour with the same picture whose ink is painted by a field.
 *
 * What "the same picture" has to mean, in the order the gates ask it:
 *
 *   coverage   - the field must paint ink exactly where the engine put ink, and
 *                nowhere else. A field ink that adds or removes coverage has drawn
 *                a different truchet pattern, whatever it looks like. The estimate
 *                compares the *fractional* coverage read out of the solid render
 *                with the mask alpha the field was given, so antialiased stroke
 *                edges count rather than being rounded away.
 *   anchor     - at pigment 0% the field ink must come back the ink colour the
 *                palette chose, to within 8-bit noise. If that is off, the mask and
 *                the canvas are not the same rectangle and nothing after it means
 *                anything.
 *   relief     - a stroke's lightness may not move further toward the ground than
 *                relief% of the ink-to-ground gap. Lightness is what the pattern is
 *                read from; this is the number that keeps the shape readable.
 *   legible    - distance from the ground colour in RGB, not luminance: a field hue
 *                can match the ground's lightness and still camouflage.
 *   export     - the PNG carries the ink the preview showed, at the export's size.
 *
 * The negative pass asks the gates to judge an unconstrained field (relief 100,
 * pigment 100, judged as if relief were still 25): the relief and legibility gates
 * must fire. A gate that can never fire measures nothing.
 */
window.INKFIELDQA = async function (over) {
  over = over || {};
  const A = window.TruchetApp, T = window.Truchet;
  const D = A.DEFAULTS;
  const S = A.state();
  const main = document.getElementById('mainCanvas');
  const inkEl = document.getElementById('inkCanvas');
  const err = document.getElementById('err');
  const out = [];
  let fails = 0;
  const scratch = document.createElement('canvas');

  function fail(msg) { fails++; out.push('FAIL ' + msg); }
  function hex(c) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(c || '').trim());
    if (!m) return [255, 255, 255];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function inkRGB() {
    if (S.pal === 'custom') return [hex(S.c1), hex(S.c2)];
    const p = T.PALETTES[S.pal] || T.PALETTES.bw;
    return [hex(p[0]), hex(p[0])];
  }
  function groundRGB() {
    if (S.pal === 'custom') return hex(S.bg);
    const p = T.PALETTES[S.pal] || T.PALETTES.bw;
    return hex(p[1]);
  }
  function lum(r, g, b) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
  function dist(a, b) {
    const d0 = a[0] - b[0], d1 = a[1] - b[1], d2 = a[2] - b[2];
    return Math.sqrt(d0 * d0 + d1 * d1 + d2 * d2);
  }
  function snap(el) {                  // a private copy of one canvas, at its own size
    const c = document.createElement('canvas');
    c.width = el.width; c.height = el.height;
    c.getContext('2d').drawImage(el, 0, 0);
    return c;
  }
  function read(el) {
    const c = snap(el);
    return { w: c.width, h: c.height, d: c.getContext('2d').getImageData(0, 0, c.width, c.height).data };
  }
  /* What is actually behind the ink: the ground field, then the tile layer with its
   * ink class left out. Reading only the tile layer would call a black background
   * "the ground" and report dark ink on a dark field as camouflage wherever there
   * is no field at all. */
  function underData(W, H, gs, ms) {
    const gc = gs || document.getElementById('groundCanvas');
    const mc = ms || main;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x2 = c.getContext('2d');
    if (gc && gc.width) x2.drawImage(gc, 0, 0, W, H);
    x2.drawImage(mc, 0, 0, W, H);
    return c.getContext('2d').getImageData(0, 0, W, H).data;
  }
  function setup(cfg) {
    Object.assign(S, D, { pal: 'custom', c1: '#141728', c2: '#a9b0c4', bg: '#f2efe6',
      tab: 'gen', ground: 'solid', ink: 'solid', seed: 0.31, n: 12, tiling: 'chk' }, cfg);
    A.onChange();
  }
  function stat(list) {
    if (!list.length) return { n: 0, mean: 0, max: 0 };
    list.sort((a, b) => a - b);
    return { n: list.length, mean: list.reduce((s, v) => s + v, 0) / list.length,
      max: list[list.length - 1] };
  }

  /* One picture. A solid-ink picture gets a coverage map read out of its colours;
   * a field-ink picture gets the mask alpha and the colours the field chose. The
   * two are only ever compared as the same seed, the same frame and the same tile
   * canvas size - setup() pins all three. */
  function picture(cfg) {
    setup(cfg);
    const W = main.width, H = main.height, g = groundRGB(), inks = inkRGB();
    const a = read(main);
    const cov = new Float32Array(W * H), inkOf = new Array(W * H);
    let inkPixels = 0;
    for (let i = 0, p = 0; i < W * H; i++, p += 4) {
      const px = [a.d[p], a.d[p + 1], a.d[p + 2]];
      const dg = dist(px, g);
      const di = Math.min(dist(px, inks[0]), dist(px, inks[1]));
      /* A pixel the engine antialiased is a blend of the ground and one ink colour:
       * px = (1-k)·ground + k·ink. Then dg = k·span and di = (1-k)·span, so k comes
       * from the ratio alone and no span has to be guessed. */
      cov[i] = dg + di > 0 ? dg / (dg + di) : 0;
      if (cov[i] > 0.02) { inkPixels++; inkOf[i] = px; }
    }
    const res = { W: W, H: H, g: g, cov: cov, inkOf: inkOf, inkPixels: inkPixels,
      mask: null, field: null, fieldMask: null, double: 0, appMask: null, appRGB: null,
      under: underData(W, H) };
    if (S.ink === 'shader') {
      const parts = A.inkParts();
      const mk = parts && parts.mask;
      if (mk && (mk.width !== W || mk.height !== H)) {
        fail('the ink mask is ' + mk.width + 'x' + mk.height +
          ' while the tile canvas is ' + W + 'x' + H + ' - the field is being poured into a mask of a different size');
      }
      if (mk) {
        const mc = snap(mk);
        const md = mc.getContext('2d').getImageData(0, 0, W, H).data;
        res.appMask = new Float32Array(W * H);
        res.appRGB = md;               /* the ink as the engine drew it, colour included */
        for (let i = 0; i < W * H; i++) res.appMask[i] = md[i * 4 + 3] / 255;
      }
      const f = read(inkEl);
      if (f.w !== W || f.h !== H) {
        fail('ink canvas is ' + f.w + 'x' + f.h + ' while mainCanvas is ' + W + 'x' + H +
          ' - not the same rectangle, so the mask cannot line up with the strokes');
        return res;
      }
      res.field = f;
      res.mask = f.d;
      res.appData = res.appData || null;
      const m = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) m[i] = f.d[i * 4 + 3] / 255;
      res.fieldMask = m;
      /* With field ink the strokes must be painted exactly once - the tile canvas
       * has to have left its ink class out, not painted it under the field. */
      let dbl = 0;
      for (let i = 0, p = 0; i < W * H; i++, p += 4) {
        if (a.d[p + 3] > 8 && dist([a.d[p], a.d[p + 1], a.d[p + 2]], g) > 24) dbl++;
      }
      res.double = dbl;
    }
    return res;
  }

  async function gate(label, cfg, judge, deliberate) {
    if (over.only && label.indexOf(over.only) < 0) return null;
    const x = picture(Object.assign({}, cfg, { ink: 'solid' }));
    const y = picture(Object.assign({}, cfg, { ink: 'shader' }));
    if (!y.field) { fail(label + ': nothing to read from the ink canvas'); return null; }
    const W = x.W, H = x.H, n = W * H;
    const doublePct = 100 * y.double / n;

    /* Two different promises, measured separately.
     *
     * shape  - the alpha the field produced against the alpha of the mask it was
     *          poured into. Both are exact canvas readings, so a difference here is
     *          the field moving a stroke, and nothing else can excuse it.
     * fidelity - the alpha of that mask against the ink coverage read out of the
     *          solid picture. This is the one that can only be trusted when the
     *          ground is a flat colour, because the estimate solves for coverage by
     *          splitting the distance to a known ground and a known ink. */
    let agree = 0, disagree = 0, lost = 0, extra = 0;
    let shapeSum = 0, shapeN = 0, worst = 0;
    let maskSum = 0, maskN = 0;
    const solidGround = cfg.ground !== 'shader';
    for (let i = 0; i < n; i++) {
      const c = x.cov[i], mk = y.appMask ? y.appMask[i] : 0, m = y.fieldMask[i];
      if (mk > 0.5 || m > 0.5) {
        if ((mk > 0.5) === (m > 0.5)) agree++; else disagree++;
        if (mk > 0.5 && m <= 0.5) lost++;      // a stroke the field never painted
        if (m > 0.5 && mk <= 0.5) extra++;     // ink the field invented
      }
      if (mk > 0.02 || m > 0.02) {
        const e = Math.abs(mk - m);
        shapeSum += e; shapeN++;
        if (e > worst) worst = e;
      }
      if (y.appMask && solidGround && (c > 0.02 || mk > 0.02)) {
        maskSum += Math.abs(c - mk); maskN++;
      }
    }
    const shapeMatch = shapeN ? shapeSum / shapeN : 0;
    const maskMatch = maskN ? maskSum / maskN : -1;

    /* Per-pixel promises, measured only where the ink is fully covered. An
     * antialiased edge is a compositing question and the shape gates already cover
     * it; a lightness budget can only be judged where there is ink to spend it on.
     *
     * The bound is not a constant: it is a share of this pixel's own lightness gap
     * between its ink and the ground it sits on, because that is the distance the
     * relief dial is defined against. A pixel of dark ink on a light ground may be
     * moved far; a pixel of mid ink on a mid ground has almost nothing to spend. */
    const pig = (+cfg.inkPig || 0) / 100, relief = (+cfg.inkRelief || 0) / 100;
    /* Judged by the dials the row claims, which for a deliberate negative row are
     * not the dials it was rendered with. */
    const jd = judge || { pig: pig, relief: relief };
    const gndL = lum(x.g[0], x.g[1], x.g[2]);
    const drift = [], overRun = [], camo = [], hueMoved = [];
    let pigErr = 0, pigN = 0, full = 0;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      if (!(y.appMask && y.appMask[i] > 0.98)) continue;
      full++;
      const src = [y.appRGB[p], y.appRGB[p + 1], y.appRGB[p + 2]];   // the ink as designed
      const got = [y.mask[p], y.mask[p + 1], y.mask[p + 2]];         // coverage is 1 here
      const under = [y.under[p], y.under[p + 1], y.under[p + 2]];    // what is really behind it
      const d = Math.abs(lum(got[0], got[1], got[2]) - lum(src[0], src[1], src[2]));
      const bound = jd.pig * jd.relief * Math.abs(lum(src[0], src[1], src[2]) - gndL) + 3;
      drift.push(d);
      overRun.push(Math.max(0, d - bound));
      if (dist(got, under) < 40) camo.push(1);                        // invisible against this ground
      if (dist(got, src) > 12) hueMoved.push(1);
      if (pig === 0) { pigErr += dist(got, src); pigN++; }
    }
    const dS = stat(drift), oS = stat(overRun);
    const camoPct = 100 * camo.length / Math.max(1, full);
    const pigMean = pigN ? pigErr / pigN : -1;
    const ex = (cfg.tab === undefined || cfg.tab === 'gen') ? await exportCheck(cfg) : null;

    const verdict = [];
    if (doublePct > 0.5) verdict.push(doublePct.toFixed(2) + '% of the tile canvas is still ink - painted twice');
    const disPct = 100 * disagree / Math.max(1, agree + disagree);
    if (disPct > 1) verdict.push('the field painted a different shape than the ink it was given, in ' + disPct.toFixed(2) + '% of ink pixels (' + lost + ' lost, ' + extra + ' invented)');
    if (shapeMatch > 0.02) verdict.push('field coverage differs from the mask by ' + shapeMatch.toFixed(3) + ' on average');
    if (worst > 0.25) verdict.push('worst single-pixel coverage error ' + worst.toFixed(3));
    if (maskMatch > 0.03) verdict.push('the mask differs from the ink the engine drew by ' + maskMatch.toFixed(3));
    if (pig === 0 && pigMean > 1.5)
      verdict.push('pigment 0% must be the plain ink colour, came back ' + pigMean.toFixed(2) + ' away');
    if (ex && (ex.settle > 1 || ex.redraw > 1))
      verdict.push('the picture moved while it was being measured (' + ex.settle.toFixed(1)
        + ' before the press, ' + ex.redraw.toFixed(1) + ' after it)');
    if (ex && ex.diff > 20) verdict.push('export is ' + ex.diff.toFixed(1) + ' away from the preview');
    if (ex && ex.surv < 0.9) verdict.push('the exported file lost the ink against its own ground, keeping ' + (100 * ex.surv).toFixed(0) + '% of its contrast');
    /* A row is judged only when it is a shipped configuration, and then by the relief
     * it claims. A sweep is a measurement, not a promise: judging a relief-60 render
     * by a relief-60 allowance proves nothing about whether the allowance means
     * anything, which is why the negative pass below judges a relief-100 render by
     * the shipped 25. */
    if (judge) {
      if (oS.mean > 1) verdict.push('lightness budget overspent by ' + oS.mean.toFixed(1) + ' on average, ' + oS.max.toFixed(1) + ' at the worst pixel');
      if (camoPct > 0.5) verdict.push(camoPct.toFixed(2) + '% of the ink is within 40 RGB of what is behind it');
      if (pig < judge.pig) verdict.push('judged with pigment ' + (100 * judge.pig) + '% against a render at ' + (100 * pig) + '%');
    }

    out.push([label.padEnd(26), 'shape ' + shapeMatch.toFixed(3),
      'mask ' + (maskMatch < 0 ? ' -  ' : maskMatch.toFixed(3)), 'worst ' + worst.toFixed(3),
      'lost ' + String(lost).padStart(4), 'extra ' + String(extra).padStart(4),
      'dbl ' + doublePct.toFixed(1) + '%',
      'full ' + String(full).padStart(6),
      'drift ' + dS.mean.toFixed(1) + '/' + dS.max.toFixed(1),
      'over ' + oS.mean.toFixed(1) + '/' + oS.max.toFixed(1),
      'camo ' + camoPct.toFixed(2).padStart(5) + '%',
      'hue ' + (100 * hueMoved.length / Math.max(1, drift.length)).toFixed(0).padStart(3) + '%',
      'pig0 ' + (pigMean < 0 ? '  -  ' : pigMean.toFixed(2)),
      ex ? ('export ' + ex.size + ' from ' + ex.pvSize + ' d' + ex.diff.toFixed(1)
        + ' (ink ' + ex.diffInk.toFixed(1) + ' / ground ' + ex.diffGround.toFixed(1) + ')'
        + ' surv ' + ex.surv.toFixed(2) + ' fileInk ' + ex.inkPct.toFixed(1) + '%'
        + ' settle ' + ex.settle.toFixed(1) + '/' + ex.redraw.toFixed(1)
        + ' name ' + ex.name
        + (ex.lay ? (ex.lay.n ? ' layer d' + ex.lay.d.toFixed(1) + ' big' + ex.lay.big.toFixed(1)
          + '% at ' + ex.lay.wx + ',' + ex.lay.wy + '(' + ex.lay.wd.toFixed(0) + ')'
          : ' layer ' + ex.lay.size + ' unreadable') : ' layer -')) : 'export -',
      verdict.length ? 'FAIL: ' + verdict.join(' | ') : 'ok'].join('  '));
    /* A deliberate negative row is meant to fail; a row that fails to fail is the
     * failure. */
    if (deliberate) { if (!verdict.length) fails++; }
    else if (verdict.length) fails++;
    return { drift: dS.mean, driftMax: dS.max, overMean: oS.mean, overMax: oS.max,
      camo: camoPct, shape: shapeMatch, full: full };
  }

  /* Export compared at one size: the preview is asked for a 1920 square frame, the
   * file arrives at 1920, so no resampling stands between the two pictures.
   *
   * The clocks are stopped for this measurement. The animation loop is still running
   * while the button is pressed, so a preview caught at one phase and a file drawn
   * at the next disagree by the motion itself - which is real motion, not an export
   * bug, and an earlier run of this gate reported exactly that as a 215-unit ground
   * difference. What is being tested here is whether the export path composites the
   * same picture the preview shows. */
  /* The export has to be compared against a preview the app has actually finished
   * drawing, or a difference measured against the file is the app's own timing and
   * not the export path's. Two animation frames is the app's chance to catch up with
   * the state the probe just asked for; both readings of the preview are kept so a
   * picture that changes *after* the press is visible in the numbers too. */
  const frame = () => new Promise((r) =>
    requestAnimationFrame(() => requestAnimationFrame(r)));

  async function exportCheck(cfg) {
    setup(Object.assign({}, cfg, { ink: 'shader', fw: 1920, fh: 1920, res: 1920,
      shSpeed: 0, inkSpeed: 0 }));
    await frame();
    const W = main.width, H = main.height;
    /* One reading of the preview as the user would see it: ground layer, tile layer,
     * ink layer, composited in the order the page stacks them. */
    function shot() {
      const pg = snap(document.getElementById('groundCanvas'));
      const pm = snap(main), pf = snap(inkEl);
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const x2 = c.getContext('2d');
      x2.drawImage(pg, 0, 0, W, H);
      x2.drawImage(pm, 0, 0, W, H);
      x2.drawImage(pf, 0, 0, W, H);
      return { pf: pf, ud: underData(W, H, pg, pm),
        d: x2.getImageData(0, 0, W, H).data };
    }
    const s0 = shot();
    const g = groundRGB();
    const blob = [null], name = [null];
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { name[0] = this.download; };
    const realToBlob = HTMLCanvasElement.prototype.toBlob;
    /* A real Blob, because the app hands it to URL.createObjectURL, which rejects
     * anything else: a fake blob makes the export stop before it names the file, and
     * the probe would report a missing name that the app never failed to produce. */
    HTMLCanvasElement.prototype.toBlob = function (cb) {
      blob[0] = this;
      cb(new Blob([new Uint8Array(8)], { type: 'image/png' }));
    };
    const fileNameEl = document.getElementById('fileName');
    /* Before and after the button: if the export-sized field-ink canvas fills up
     * during the click, the render worked and the composite is what failed. */
    function clockAlpha() {
      const ck = A.inkParts() && A.inkParts().clock;
      if (!ck || !ck.width) return { size: 'none', a: 0 };
      const cd2 = snap(ck).getContext('2d').getImageData(0, 0, ck.width, ck.height).data;
      let a = 0, n2 = 0;
      for (let p = 3; p < cd2.length; p += 4) { a += cd2[p]; n2++; }
      return { size: ck.width + 'x' + ck.height, a: a / Math.max(1, n2) / 255 };
    }
    const before = clockAlpha();
    /* Read again at the moment of the press. The preview is what the export has to
     * match, and the preview is only the export's equal once the app has finished
     * drawing it - if these two readings disagree, the picture was still settling
     * and any difference measured against the file is the app's own timing, not the
     * export path's. */
    const s = shot();
    let settle = 0, nPx = s0.d.length / 4;
    for (let p = 0; p < s0.d.length; p += 4)
      settle += (Math.abs(s0.d[p] - s.d[p]) + Math.abs(s0.d[p + 1] - s.d[p + 1])
        + Math.abs(s0.d[p + 2] - s.d[p + 2])) / 3;
    settle /= Math.max(1, nPx);
    try { document.getElementById('btnExport').click(); } catch (e) { fail('export threw ' + e); }
    HTMLAnchorElement.prototype.click = realClick;
    HTMLCanvasElement.prototype.toBlob = realToBlob;
    /* The name the page itself reports, which is what the download would carry. */
    name[0] = fileNameEl.textContent || name[0];
    const after1 = shot();
    let redraw = 0, nR = after1.d.length / 4;
    for (let p = 0; p < after1.d.length; p += 4)
      redraw += (Math.abs(after1.d[p] - s.d[p]) + Math.abs(after1.d[p + 1] - s.d[p + 1])
        + Math.abs(after1.d[p + 2] - s.d[p + 2])) / 3;
    redraw /= Math.max(1, nR);
    if (!blob[0]) {
      /* Not an ink problem: this build has no export button wired to off.toBlob, so
       * there is no file to measure. Say what is missing instead of pretending the
       * export disagreed. */
      out.push('  export: not measurable on this page (no #btnExport / off.toBlob path)');
      S.res = D.res; S.fw = D.fw; S.fh = D.fh;
      document.getElementById('selRes').value = String(D.res);
      A.onChange();
      return null;
    }
    const after = clockAlpha();
    const big = blob[0];
    const parts = A.inkParts() || {};
    const diag = { clock: 'clock ' + after.size + ' a' + after.a.toFixed(3)
      + ' (before a' + before.a.toFixed(3) + ')', gl: !!(parts.clockGl) };
    if (parts.mask) {
      const mk = snap(parts.mask);
      const md2 = mk.getContext('2d').getImageData(0, 0, mk.width, mk.height).data;
      let a = 0, n2 = 0;
      for (let p = 3; p < md2.length; p += 4) { a += md2[p]; n2++; }
      diag.mask = mk.width + 'x' + mk.height + ' alphaMean ' + (a / n2 / 255).toFixed(3);
    } else diag.mask = 'no mask canvas';
    const cc = document.createElement('canvas');
    cc.width = W; cc.height = H;
    const c2 = cc.getContext('2d');
    c2.drawImage(big, 0, 0, W, H);
    const cd = c2.getImageData(0, 0, W, H).data;
    const pd = s.d;
    /* What is behind the ink in the preview - the ground, field or flat - read at the
     * same size as the file, so "did the ink survive" is a question about two
     * pictures of the same frame and not about two different frames. */
    const ud = s.ud;
    const mkc = document.createElement('canvas');
    mkc.width = W; mkc.height = H;
    const mctx = mkc.getContext('2d');
    if (parts.mask && parts.mask.width) mctx.drawImage(parts.mask, 0, 0, W, H);
    const mkd = mctx.getImageData(0, 0, W, H).data;
    /* The ink layer by itself, both renderings brought to the preview's size and
     * compared only where both are covered. The composite can look fine while the
     * field render is wrong, because the ground underneath hides a small layer
     * difference; this is the reading that cannot be hidden. */
    let lay = null;
    if (parts.clock && parts.clock.width) {
      scratch.width = W; scratch.height = H;
      const s2c = scratch.getContext('2d');
      s2c.drawImage(snap(parts.clock), 0, 0, W, H);
      const ad = s2c.getImageData(0, 0, W, H).data;
      const pd2 = read(inkEl);
      const fd = pd2.w === W && pd2.h === H ? pd2.d : null;
      if (fd) {
        let s3 = 0, n3 = 0, big = 0, wx = 0, wy = 0, wd = 0;
        for (let i = 0, p = 0; i < W * H; i++, p += 4) {
          if (ad[p + 3] < 128 || fd[p + 3] < 128) continue;
          const d3 = dist([ad[p], ad[p + 1], ad[p + 2]], [fd[p], fd[p + 1], fd[p + 2]]);
          s3 += d3; n3++; if (d3 > 60) big++;
          if (d3 > wd) { wd = d3; wx = i % W; wy = (i / W) | 0; }
        }
        lay = { d: n3 ? s3 / n3 : 0, n: n3, big: n3 ? 100 * big / n3 : 0,
          wx: wx, wy: wy, wd: wd,
          size: parts.clock.width + 'x' + parts.clock.height };
      } else lay = { size: parts.clock.width + 'x' + parts.clock.height, n: 0 };
    }
    let sum = 0, dG = 0, nG = 0, dI = 0, nI = 0, keptF = 0, keptP = 0;
    for (let i = 0, p = 0; i < W * H; i++, p += 4) {
      const pv = [pd[p], pd[p + 1], pd[p + 2]], fv = [cd[p], cd[p + 1], cd[p + 2]];
      const d = dist(pv, fv);
      sum += d;
      const a = mkd[p + 3] / 255;
      if (a > 0.5) { dI += d; nI++; } else { dG += d; nG++; }
      if (a > 0.98) {
        keptF += dist(fv, [ud[p], ud[p + 1], ud[p + 2]]);
        keptP += dist(pv, [ud[p], ud[p + 1], ud[p + 2]]);
      }
    }
    let vocab = 0, prevVocab = 0, nInk = 0;
    const inkRGBs = inkRGB();
    for (let p = 0; p < cd.length; p += 4) {
      const c3 = [cd[p], cd[p + 1], cd[p + 2]];
      if (dist(c3, g) > 24) vocab++;
      let di = 1e9;
      inkRGBs.forEach((e) => { const d = dist(c3, e); if (d < di) di = d; });
      if (di < 8) nInk++;
    }
    for (let p = 0; p < pd.length; p += 4) {
      if (dist([pd[p], pd[p + 1], pd[p + 2]], g) > 24) prevVocab++;
    }
    return { diff: sum / (W * H), size: big.width + 'x' + big.height,
      pvSize: W + 'x' + H, settle: settle, redraw: redraw, lay: lay,
      diffInk: nI ? dI / nI : 0, diffGround: nG ? dG / nG : 0,
      surv: keptP ? keptF / keptP : 0,
      vocab: 100 * vocab / (big.width * big.height),
      inkPct: 100 * nInk / (big.width * big.height),
      prevVocab: 100 * prevVocab / (W * H), name: name[0], diag: diag };
  }

  /* A 16x16 map of three things that are supposed to be the same shape: the ink
   * coverage read out of the solid picture, the alpha of the mask the app built, and
   * the alpha of the field ink it produced. Printed side by side, a flip, a shift or
   * an inversion is visible as a picture rather than argued from numbers. */
  function diagnose(cfg) {
    const y = picture(Object.assign({}, cfg, { ink: 'shader' }));
    const x = picture(Object.assign({}, cfg, { ink: 'solid' }));
    if (!y.fieldMask) { out.push('(no field ink to map)'); return; }
    const W = x.W, H = x.H, N = 16;
    const grid = (get) => {
      const rows = [];
      for (let r = 0; r < N; r++) {
        let line = '';
        for (let c = 0; c < N; c++) {
          let s = 0, n = 0;
          for (let yy = Math.floor(r * H / N); yy < Math.floor((r + 1) * H / N); yy++)
            for (let xx = Math.floor(c * W / N); xx < Math.floor((c + 1) * W / N); xx++) {
              s += get(yy * W + xx); n++;
            }
          const v = n ? s / n : 0;
          line += v < 0.25 ? '.' : v < 0.6 ? ':' : '#';
        }
        rows.push(line);
      }
      return rows;
    };
    const a = grid((i) => x.cov[i]);
    const b = grid((i) => y.appMask ? y.appMask[i] : 0);
    const c = grid((i) => y.fieldMask[i]);
    out.push('  ink from the solid picture   app mask alpha        field ink alpha');
    for (let r = 0; r < N; r++) out.push('  ' + a[r] + '    ' + b[r] + '    ' + c[r]);
  }

  const base = { inkShader: 'mesh', inkPig: 45, inkRelief: 25, inkSpeed: 0 };
  const J = (c) => ({ pig: (+c.inkPig || 0) / 100, relief: (+c.inkRelief || 0) / 100 });
  out.push('== the same shape, three times: solid ink, app mask, field ink ==');
  diagnose(base);
  out.push('== field ink, custom ramp, solid ground: every field ==');
  for (const f of window.TruchetShaders.list) {
    const cfg = Object.assign({}, base, { inkShader: f.key });
    await gate((f.key + '          ').slice(0, 6) + ' pig45 r25', cfg, J(cfg));
  }
  out.push('== pigment 0%: the field must put nothing in the ink ==');
  const zero = Object.assign({}, base, { inkPig: 0 });
  await gate('mesh   pig0  r25', zero, J(zero));
  out.push('== relief swept, pigment 100% - measured, not judged ==');
  await gate('mesh   pig100 r0  ', Object.assign({}, base, { inkPig: 100, inkRelief: 0 }));
  await gate('mesh   pig100 r60 ', Object.assign({}, base, { inkPig: 100, inkRelief: 60 }));
  await gate('mesh   pig100 r100', Object.assign({}, base, { inkPig: 100, inkRelief: 100 }));
  out.push('== preset palettes (one ink colour) ==');
  const bw = Object.assign({}, base, { pal: 'bw' });
  const wb = Object.assign({}, base, { pal: 'wb' });
  await gate('bw palette marble', bw, J(bw));
  await gate('wb palette marble', wb, J(wb));
  out.push('== both fields at once ==');
  const both = Object.assign({}, base, {
    ground: 'shader', shader: 'aurora', scrim: 45, shMix: 45 });
  await gate('aurora ground + mesh ink', both, J(both));

  /* A link can name a field that does not exist - a mistyped key, a key from a
   * newer build opened in an older page. What must not happen is the app half
   * believing it: a picker showing one field while the canvas draws another, or a
   * file named for a field nobody drew. The name resolves, once, everywhere. */
  out.push('== a field name the app does not know ==');
  setup(Object.assign({}, base, { ink: 'shader', inkShader: 'not_a_field' }));
  const st = A.state();
  const known = window.TruchetShaders.list.some((f) => f.key === st.inkShader);
  const bogusShown = document.getElementById('selInkShader').value;
  const ex2 = await exportCheck(Object.assign({}, base, { ink: 'shader', inkShader: 'not_a_field' }));
  if (!known) fail('the state kept a field name that does not exist: ' + st.inkShader);
  if (bogusShown !== st.inkShader)
    fail('the picker shows ' + bogusShown + ' while the state says ' + st.inkShader);
  if (!ex2 || !ex2.name || ex2.name.indexOf(st.inkShader) < 0)
    fail('the exported file is named ' + (ex2 && ex2.name) + ', which does not name ' + st.inkShader);
  if (ex2 && ex2.diff > 20)
    fail('the export of a resolved field is ' + ex2.diff.toFixed(1) + ' away from what the page shows');
  out.push('  inkShader "not_a_field" resolves to ' + st.inkShader
    + ', the picker shows ' + bogusShown + ', the file is named ' + (ex2 && ex2.name)
    + ' (the page says "' + document.getElementById('fileName').textContent + '")'
    + ', export ' + (ex2 ? ex2.diff.toFixed(1) : '-') + ' away from the preview');
  setup(Object.assign({}, base, { ground: 'shader', shader: 'not_a_field' }));
  const sg = document.getElementById('selShader').value;
  if (!window.TruchetShaders.list.some((f) => f.key === A.state().shader)
    || sg !== A.state().shader)
    fail('the ground picked ' + sg + ' for a name that does not exist');
  out.push('  shader "not_a_field" resolves to ' + sg);
  /* The same export with a name that does exist, measured the same way, so a
   * missing name here is known to be about the resolution and not about the way
   * this probe presses the button. */
  const ex3 = await exportCheck(Object.assign({}, base, { ink: 'shader', inkShader: 'mesh' }));
  out.push('  the same export with the name written out: ' + (ex3 && ex3.name));
  if (!ex3 || !ex3.name || ex3.name.indexOf('ikmesh') < 0)
    fail('a plain mesh ink export is named ' + (ex3 && ex3.name));

  out.push('== negative pass: relief 100% judged by the shipped 25%, must FAIL ==');
  const bad = await gate('mesh   pig100 r100 BAD', Object.assign({}, base,
    { inkPig: 100, inkRelief: 100 }), { pig: 0.45, relief: 0.25 }, true);
  const fired = over.only ? true : !!(bad && (bad.overMean > 1 || bad.camo > 0.5));
  out.push(over.only ? 'negative pass skipped (measuring one row only)'
    : (fired ? 'ok: the lightness budget gate fired on a render that overspent it'
      : 'FAIL: nothing moved, so the relief gates prove nothing'));
  if (!fired && !over.only) fails++;

  out.push('== failure surfaced in the UI: ' + (err.textContent || 'none') + ' ==');
  out.push(fails ? 'INK FIELD QA FAILED (' + fails + ')' : 'INK FIELD QA PASSED');
  return out.join('\n');
};
