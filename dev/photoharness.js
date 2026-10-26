/* QA harness for the Photo tab (driven by dev/_photoqa.py).
 *
 * It runs the real tab through the real app shell on a synthetic test image,
 * then checks two different things:
 *
 *   structure   the quadtree is legal (no gaps, no overlaps, powers of two),
 *               the tiling is deterministic, and MOTIF_INK still matches what
 *               the renderer paints (dev/inktest.html is the source of truth).
 *   tone        the dark area actually painted inside a tile - read back out of
 *               the preview canvas, not from the model - is what the image asked
 *               for. This is what proves the inverted cells really get their own
 *               dark ground, and that choosing a parity lands the tone.
 *
 * A paste-ready digest of the tile list makes regressions obvious.
 */
(function () {
  'use strict';
  const out = [];
  const say = (s) => out.push(s);
  window.__PHOTO_FAILS = [];
  const fail = (s) => { window.__PHOTO_FAILS.push(s); say('FAIL: ' + s); };

  function run() {
    const T = window.Truchet;
    const app = window.TruchetApp;
    const ph = app.hooks && app.hooks.photo;
    if (!ph) { fail('photo tab did not register its hooks'); return finish(); }
    if (app.tab() !== 'photo') { fail('expected the photo tab to be active'); return finish(); }

    /* ---------- synthetic test image with structure to find ---------- */
    const W = 420, H = 340;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const cx = c.getContext('2d');
    cx.fillStyle = '#ffffff';
    cx.fillRect(0, 0, W, H);
    const g = cx.createRadialGradient(W * 0.42, H * 0.45, 10, W * 0.42, H * 0.45, W * 0.55);
    g.addColorStop(0, '#000000');
    g.addColorStop(0.55, '#6a6a6a');
    g.addColorStop(1, '#ffffff');
    cx.fillStyle = g;
    cx.fillRect(0, 0, W, H);
    cx.fillStyle = '#202020';
    for (let k = 0; k < 5; k++) {
      cx.fillRect(12 + k * 80, 20 + (k % 2) * 44, 30, 18);   // hard-edged bars
    }
    cx.fillStyle = '#c8c8c8';
    cx.beginPath();
    cx.arc(W * 0.78, H * 0.7, 60, 0, Math.PI * 2);
    cx.fill();
    cx.strokeStyle = '#000000';
    cx.lineWidth = 6;
    cx.beginPath();
    cx.moveTo(20, H - 30); cx.lineTo(W - 30, 40);
    cx.stroke();

    if (!ph.adopt(c, 'qa-synthetic.png')) fail('adopt() rejected a valid image');
    if (!ph.hasImage()) fail('no image after adopt()');
    app.setBaseScale(2);                 // two cells across, so subdivision is visible

    /* ---------- structure ---------- */
    const L = app.lattice();
    const tiles = app.buildTiling();
    if (!tiles || !tiles.length) { fail('the photo tab produced no tiles'); return finish(); }
    const aud = ph.audit(L);
    aud.problems.forEach(fail);
    say('lattice ' + L.cols + 'x' + L.rows + ' (t=' + L.t + '), tiles ' + aud.count +
      ', depths ' + aud.depths.join('/'));
    say('coverage ' + aud.area.toFixed(6) + ' of frame area ' + aud.frame);
    if (Math.abs(aud.area - aud.frame) > 1e-6 * aud.frame) fail('quadtree does not fill the frame');
    if (aud.depths.length < 2) say('note: only one subdivision level was used');

    /* Tile size is capped by the export frame, not the preview. */
    const [fw, fh] = app.framePx();
    const minPx = Math.min.apply(null, tiles.map((t) => t.s)) *
      Math.max(fw / L.cols, fh / L.rows);
    say('smallest tile ~' + minPx.toFixed(1) + ' px in the ' + fw + 'x' + fh + ' export');
    if (minPx < ph.minPx * 0.5) fail('tiles smaller than the min pixel size: ' + minPx.toFixed(1));
    if (tiles.length > app.maxLatticeTiles()) fail('tile budget exceeded: ' + tiles.length);

    /* ---------- tone, as actually painted ----------
     * Replicate the world->canvas mapping of drawScene, then count dark pixels
     * inside each sampled tile's own square. */
    const canvas = document.getElementById('mainCanvas');
    const rep = ph.report();
    if (!rep) { fail('report() returned nothing'); return finish(); }
    const dpr = window.devicePixelRatio || 1;
    if (Math.abs(dpr - 1) > 1e-9) { fail('expected devicePixelRatio 1 for fixed pixel sampling'); return finish(); }
    const world = worldBounds(tiles, app.state().pad);
    const [x0, y0, x1, y1] = world;
    const sScale = Math.max(canvas.width / (x1 - x0), canvas.height / (y1 - y0));
    const winW = canvas.width / sScale, winH = canvas.height / sScale;
    const wx0 = (x0 + x1) / 2 - winW / 2, wy0 = (y0 + y1) / 2 - winH / 2;
    say('preview canvas ' + canvas.width + 'x' + canvas.height);

    const st = app.state();
    const darkRgb = (T.PALETTES[st.pal] || T.PALETTES.bw)[0];
    const isDarkChannel = (v) => v < 128;    // the harness forces a dark/light palette
    if (!(parseInt(darkRgb.slice(1, 3), 16) < 128)) {
      fail('this check assumes the dark palette colour is below mid grey, got ' + darkRgb);
    }

    /* Sample across the size range, biggest first, so both coarse areas and fine
     * detail get checked. Wings from neighbouring tiles bleed into a square, so
     * the tolerance is loose for the smallest tiles. */
    const sorted = tiles.slice().sort((a, b) => b.s - a.s);
    const step = Math.max(1, Math.floor(sorted.length / 140));
    const picker = ph.pickerFor(tiles);
    let checked = 0, sumDev = 0, worstDev = 0, n = 0;
    const rows = [];
    for (let i = 0; i < sorted.length; i += step) {
      const t = sorted[i];
      const depth = T.tileDepth(t);
      const px0 = sScale * (t.x - wx0), px1 = sScale * (t.x + t.s - wx0);
      const pyTop = canvas.height - sScale * (t.y + t.s - wy0);
      const pyBot = canvas.height - sScale * (t.y - wy0);
      const ix0 = Math.ceil(px0), ix1 = Math.floor(px1);
      const iy0 = Math.ceil(pyTop), iy1 = Math.floor(pyBot);
      if (ix1 - ix0 < 6 || iy1 - iy0 < 6) continue;      // not enough pixels to average
      const data = canvas.getContext('2d').getImageData(ix0, iy0, ix1 - ix0, iy1 - iy0).data;
      let dark = 0, total = 0;
      for (let p = 0; p < data.length; p += 4) { if (isDarkChannel(data[p])) dark++; total++; }
      const painted = dark / total;
      const name = T.nameForConnIdx(picker(depth, t));
      const want = ph.wantDark(ph.stats(ph.tables(), ph.makeMap(ph.tables(), L),
        t.x, t.y, t.x + t.s, t.y + t.s).mean);
      const predicted = ph.darkOf(name, depth);
      const dev = Math.abs(painted - predicted);
      checked++;
      sumDev += dev; worstDev = Math.max(worstDev, dev); n++;
      rows.push({ want, painted, predicted, name, depth, s: t.s, paintedFrac: painted });
    }
    /* Correlation between the tone the image asks for and the tone actually
     * painted, over the sampled tiles. */
    let sumWant = 0, sumPainted = 0;
    for (const r of rows) { sumWant += r.want; sumPainted += r.painted; }
    const meanWant = sumWant / rows.length, meanPainted = sumPainted / rows.length;
    let sxy = 0, sxx = 0, syy = 0;
    for (const r of rows) {
      sxy += (r.want - meanWant) * (r.painted - meanPainted);
      sxx += (r.want - meanWant) * (r.want - meanWant);
      syy += (r.painted - meanPainted) * (r.painted - meanPainted);
    }
    const corr = (sxx > 0 && syy > 0) ? sxy / Math.sqrt(sxx * syy) : 0;
    const checkedRows = rows.length;
    say('');
    say('== tone, measured from the rendered preview ==');
    say('tiles sampled from the canvas: ' + checkedRows);
    say('mean tone asked for ' + meanWant.toFixed(4) + ', mean dark actually painted ' +
      meanPainted.toFixed(4) + '   (diff ' + Math.abs(meanWant - meanPainted).toFixed(4) + ')');
    say('correlation wanted vs painted: ' + corr.toFixed(4));
    say('mean |painted - predicted|: ' + (sumDev / checked).toFixed(4) +
      ', worst ' + worstDev.toFixed(4));
    say('tone bands from the selected motifs: light ' + rep.bands.lo.toFixed(3) +
      '-' + rep.bands.hi.toFixed(3) + ', dark ' + rep.bands.odd[0].toFixed(3) +
      '-' + rep.bands.odd[1].toFixed(3));
    say('depth asked ' + rep.depthAsked + ', depth used ' + rep.depthUsed +
      ', mean tone error ' + rep.meanErr.toFixed(4) + ', worst ' + rep.worstErr.toFixed(4));
    if (checked < 20) fail('too few tiles were large enough to measure on the preview');
    if (corr < 0.85) fail('tone correlation too low: ' + corr.toFixed(4));
    if (Math.abs(meanWant - meanPainted) > 0.12) {
      fail('overall tone is off: wanted ' + meanWant.toFixed(3) + ' painted ' + meanPainted.toFixed(3));
    }
    if (sumDev / checked > 0.09) fail('tiles do not paint the coverage the model claims');
    for (const band of rows.filter((r) => r.depth % 2 === 1).slice(0, 3)) {
      say('  inverted tile s=' + band.s.toFixed(3) + ' motif ' + band.name +
        ' wanted ' + band.want.toFixed(3) + ' painted ' + band.painted.toFixed(3));
    }
    for (const band of rows.filter((r) => r.depth % 2 === 0).slice(0, 3)) {
      say('  plain tile    s=' + band.s.toFixed(3) + ' motif ' + band.name +
        ' wanted ' + band.want.toFixed(3) + ' painted ' + band.painted.toFixed(3));
    }

    /* ---------- MOTIF_INK still describes the renderer ---------- */
    const eng = T.MOTIF_INK;
    let inkBad = 0;
    for (const name of T.TILE_NAMES) {
      if (typeof eng[name] !== 'number') { fail('MOTIF_INK has no entry for ' + name); inkBad++; }
    }
    say('MOTIF_INK covers all ' + T.TILE_NAMES.length + ' motifs');

    /* ---------- determinism ---------- */
    const digest = tiles.map((t) =>
      [t.x.toFixed(6), t.y.toFixed(6), t.s.toFixed(6), picker(T.tileDepth(t), t)].join(',')).join(';');
    let hash = 2166136261 >>> 0;
    for (let k = 0; k < digest.length; k++) {
      hash = ((hash ^ digest.charCodeAt(k)) * 16777619) >>> 0;
    }
    app.onChange();
    const again = app.buildTiling();
    const digest2 = again.map((t) =>
      [t.x.toFixed(6), t.y.toFixed(6), t.s.toFixed(6), picker(T.tileDepth(t), t)].join(',')).join(';');
    say('tile list digest 0x' + hash.toString(16) + '  redraw digest ' +
      (digest2 === digest ? 'MATCHES' : 'DIFFERS'));
    if (digest2 !== digest) fail('the same parameters produced a different tiling');
    say('determinism: ' + (digest2 === digest ? 'PASS' : 'FAIL'));

    /* ---------- every multi-scale control must change the picture ----------
     * Driven through the DOM on purpose. The read-outs are repainted from the
     * state object on every redraw, so a control with no listener still moves its
     * number while the pattern sits still - which is exactly how a wiring bug of
     * that kind hid here. Depth, smoothness and base scale have to move the tile
     * list; contrast and inversion have to move which motifs are picked. */
    function snapshot() {
      const ts = app.buildTiling();
      const pk = ph.pickerFor(ts);
      let tl = '', mo = '';
      for (const t of ts) {
        tl += t.x.toFixed(6) + ',' + t.y.toFixed(6) + ',' + t.s.toFixed(6) + ';';
        mo += pk(T.tileDepth(t), t) + ',';
      }
      return { tiles: tl, motifs: mo, n: ts.length };
    }
    function driveControl(id, value) {
      const el = document.getElementById(id);
      if (!el) { fail('control missing from the page: ' + id); return false; }
      const isCheck = el.type === 'checkbox';
      if (isCheck) el.checked = !!value; else el.value = String(value);
      el.dispatchEvent(new Event(isCheck ? 'change' : 'input'));
      return true;
    }
    const original = {
      inPdepth: ph.state().depth, inPflat: ph.state().flatness,
      inPcon: ph.state().contrast, chkPinvert: ph.state().invert,
      inBase: app.baseScale().value
    };
    const start = snapshot();
    const bsMax = app.baseScale().max;
    /* Depth is driven coarser, not finer: at this grid and export resolution the
     * default already sits at the geometric cap, so pushing it up legitimately
     * changes nothing (the detail box now limits itself to what is reachable). Driving
     * it to 1 must always collapse the subdivision, which proves the listener. */
    const cases = [
      ['inPdepth', 1, 'tiles'],
      ['inPflat', 25, 'tiles'],
      ['inBase', original.inBase === bsMax ? 1 : bsMax, 'tiles'],
      ['inPcon', 200, 'motifs'],
      ['chkPinvert', !original.chkPinvert, 'motifs']
    ];
    let controlsOk = true;
    for (const [id, value, what] of cases) {
      if (!driveControl(id, value)) { controlsOk = false; continue; }
      const now = snapshot();
      const moved = what === 'tiles' ? now.tiles !== start.tiles : now.motifs !== start.motifs;
      if (!moved) {
        fail('control ' + id + ' changed nothing: ' + what + ' digest identical');
        controlsOk = false;
      }
      say('control ' + id + ': ' + (moved ? 'moves the ' + what
        : 'DOES NOTHING (tiles ' + start.n + ' -> ' + now.n + ')'));
    }
    for (const [id, v] of Object.entries(original)) driveControl(id, v);
    /* Measured after restoring, otherwise it reflects whatever the base-scale test
     * left behind instead of the configuration the picture is built in. */
    say('depth box range advertised: ' +
      document.getElementById('inPdepth').max +
      ', geometric cap ' + ph.depthCap(app.lattice()));
    say('multi-scale controls: ' + (controlsOk ? 'PASS' : 'FAIL'));

    /* ---------- the image must stay out of the share link ---------- */
    const href = location.hash;
    if (/image|lum|sat|data:|blob:/i.test(href)) {
      fail('image data leaked into the share link: ' + href.slice(0, 120));
    }
    say('share link carries no image data: ' + (href.length > 1 ? href.slice(0, 96) : '(empty)'));

    /* ---------- tab round trip ---------- */
    const failsBefore = window.__PHOTO_FAILS.length;
    app.setTab('gen');
    const genTiles = app.buildTiling();
    if (!genTiles.length) fail('the Generator produced nothing while Photo was loaded');
    say('Generator still tiles with ' + genTiles.length + ' tiles while Photo is loaded');
    if (document.getElementById('photoParams').offsetParent !== null) {
      fail('photo params block still shown after switching to Generator');
    }
    /* ---------- the Generator's number boxes must work through the DOM too ------
     * Same class of bug as the Photo tab's dead controls, plus the traps specific
     * to number inputs: a value outside min/max, and a box cleared mid-typing
     * (+'' is 0, which would silently apply the minimum). */
    const G = app.state();
    const genOriginal = { n: G.n, pad: G.pad };
    const genSnap = () => app.buildTiling().map((t) =>
      t.x.toFixed(6) + ',' + t.y.toFixed(6) + ',' + t.s.toFixed(6)).join(';');
    let genOk = true;
    const genStart = genSnap();
    const nMax = +document.getElementById('inN').max;
    driveControl('inN', Math.min(8, nMax));
    if (genSnap() === genStart) {
      fail('Generator density changed nothing');
      genOk = false;
    }
    say('density inN: ' + (genSnap() !== genStart ? 'moves the tiles' : 'DOES NOTHING'));

    driveControl('inPad', 999);
    if (G.pad !== +document.getElementById('inPad').max) {
      fail('margin 999 was not clamped to the input max (state is ' + G.pad + ')');
      genOk = false;
    }
    say('margin out of range: clamped to ' + G.pad);

    driveControl('inPad', '');
    if (G.pad !== +document.getElementById('inPad').max) {
      fail('a cleared margin box changed the state to ' + G.pad);
      genOk = false;
    }
    say('cleared margin box: ignored, state stays ' + G.pad);

    driveControl('inN', genOriginal.n);
    driveControl('inPad', genOriginal.pad);
    say('generator controls: ' + (genOk ? 'PASS' : 'FAIL'));

    app.setTab('photo');
    if (!ph.hasImage()) fail('the photo image was lost when switching tabs');
    if (!app.buildTiling().length) fail('photo tiling lost when switching back');
    const roundTripOk = window.__PHOTO_FAILS.length === failsBefore;
    say('image and tiling survived a tab round trip');
    say('tab switch gen<->photo round trip: ' + (roundTripOk ? 'PASS' : 'FAIL'));

    finish();
  }

  /* Copy of app's worldBounds (it is private to the shell), same wing margin. */
  function worldBounds(tiles, padPct) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const t of tiles) {
      const m = t.s / 3 + t.s * 0.02;
      x0 = Math.min(x0, t.x - m); y0 = Math.min(y0, t.y - m);
      x1 = Math.max(x1, t.x + t.s + m); y1 = Math.max(y1, t.y + t.s + m);
    }
    const p = (padPct / 100) * (x1 - x0);
    return [x0 - p, y0 - p, x1 + p, y1 + p];
  }

  function finish() {
    document.getElementById('out').textContent = out.join('\n') +
      '\n\nPHOTO_HARNESS ' + (window.__PHOTO_FAILS.length ? 'FAILED' : 'PASSED') +
      '\n__PHOTO_JSON__' + JSON.stringify({ fails: window.__PHOTO_FAILS }) + '\n';
  }

  window.addEventListener('error', (e) => {
    window.__PHOTO_FAILS.push('uncaught: ' + (e.message || e));
    try { finish(); } catch (ignored) { }
  });
  try { run(); } catch (e) {
    window.__PHOTO_FAILS.push('harness threw: ' + (e && e.message ? e.message : e));
    say('' + (e && e.stack ? e.stack : e));
    finish();
  }
})();
