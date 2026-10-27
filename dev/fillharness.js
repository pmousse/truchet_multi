/* QA harness for the Fill tab (driven by dev/_fillqa.py).
 *
 * It runs the real tab through the real app shell and checks the two things a
 * shape fill can get wrong:
 *
 *   structure   the quadtree is legal (no duplicates, tile sizes tied to depth,
 *              nothing outside the frame, no tile sitting on empty space);
 *   fidelity    the shape is actually painted, and the tiles do not hang far
 *              outside its outline. Both are measured against the tab's own
 *              sampled mask, not against the tile list alone, because a legal
 *              quadtree can still be the wrong shape.
 *
 * Every preset is run, a custom mask is run, and every control is driven through
 * the DOM rather than the internal state - a control with no listener is
 * invisible on screen, since the read-outs are repainted from the tab's state.
 */
(function () {
  'use strict';
  const out = [];
  const say = (s) => out.push(s);
  window.__FILL_FAILS = [];
  const fail = (s) => { window.__FILL_FAILS.push(s); say('FAIL: ' + s); };

  function run() {
    const app = window.TruchetApp;
    const fl = app.hooks && app.hooks.fill;
    if (!fl) { fail('fill tab did not register its hooks'); return finish(); }
    if (app.tab() !== 'fill') { fail('expected the fill tab to be active'); return finish(); }

    /* ---------- every preset shape ---------- */
    const keys = Object.keys(fl.shapes).filter((k) => k !== 'custom');
    const sel = document.getElementById('selFshape');
    let worstSpill = 0, worstMissed = 0, maxTiles = 0;
    for (const key of keys) {
      sel.value = key;
      sel.dispatchEvent(new Event('change'));
      const tiles = app.buildTiling();
      if (!tiles.length) { fail('shape ' + key + ' produced no tiles'); continue; }
      const aud = fl.audit(app.lattice());
      aud.problems.slice(0, 4).forEach((p) => fail('shape ' + key + ': ' + p));
      worstSpill = Math.max(worstSpill, aud.spillFrac);
      worstMissed = Math.max(worstMissed, aud.missedFrac);
      maxTiles = Math.max(maxTiles, aud.count);
      if (aud.count > app.maxLatticeTiles())
        fail('shape ' + key + ' over the tile budget: ' + aud.count);
      say('shape ' + key + ': ' + aud.count + ' tiles, depths ' + aud.depths.join('/') +
        ', painted ' + (1 - aud.missedFrac).toFixed(3) + ' of the shape,' +
        ' spill ' + aud.spillFrac.toFixed(3));
    }
    sel.value = 'circle';
    sel.dispatchEvent(new Event('change'));

    /* ---------- a custom mask, drawn here and never uploaded ---------- */
    const W = 300, H = 300;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const cx = c.getContext('2d');
    cx.clearRect(0, 0, W, H);                    // transparent: alpha is the shape
    cx.fillStyle = '#000000';
    cx.beginPath();
    cx.arc(W * 0.5, H * 0.42, 110, 0, Math.PI * 2);
    cx.fill();
    cx.fillRect(W * 0.35, H * 0.55, W * 0.3, H * 0.4);
    cx.strokeStyle = '#000000';
    cx.lineWidth = 14;
    cx.beginPath();
    cx.moveTo(30, 270); cx.lineTo(270, 250);
    cx.stroke();
    if (!fl.adoptMask(c, 'qa-mask.png')) fail('adoptMask() rejected a valid mask');
    if (!fl.hasMask()) fail('no mask after adoptMask()');
    if (fl.state().shape !== 'custom') fail('adoptMask() did not switch the tab to custom');
    let maskTiles = app.buildTiling();
    if (!maskTiles.length) fail('the custom mask produced no tiles');
    let aud = fl.audit(app.lattice());
    aud.problems.slice(0, 4).forEach((p) => fail('custom mask: ' + p));
    say('custom mask: ' + aud.count + ' tiles, painted ' +
      (1 - aud.missedFrac).toFixed(3) + ' of the shape, spill ' + aud.spillFrac.toFixed(3));
    worstSpill = Math.max(worstSpill, aud.spillFrac);
    worstMissed = Math.max(worstMissed, aud.missedFrac);
    say('custom mask sampled from a ' + W + 'x' + H + ' drawing, read locally');

    /* back to a preset, so the control tests below are comparable */
    sel.value = 'circle';
    sel.dispatchEvent(new Event('change'));

    /* ---------- tile size respects the export frame, not the preview ---------- */
    const L = app.lattice();
    const tiles = app.buildTiling();
    const [fw, fh] = app.framePx();
    const minPx = Math.min.apply(null, tiles.map((t) => t.s)) *
      Math.max(fw / L.cols, fh / L.rows);
    say('lattice ' + L.cols + 'x' + L.rows + ', smallest tile ~' +
      minPx.toFixed(1) + ' px in the ' + fw + 'x' + fh + ' export');
    if (minPx < fl.minPx * 0.5) fail('tiles smaller than the min pixel size: ' + minPx.toFixed(1));

    /* ---------- the frame is what gets framed, not the tiles ---------- */
    const wb = fl.viewBounds(tiles);
    const margin = (app.state().pad / 100) * Math.max(L.cols, L.rows);
    const near = (a, b) => Math.abs(a - b) <= 1e-6;
    if (!(near(wb[0], -margin) && near(wb[1], -margin) &&
      near(wb[2], L.cols + margin) && near(wb[3], L.rows + margin))) {
      fail('the Fill tab framed its own tiles instead of the frame: ' + wb.join(','));
    } else {
      say('view bounds = the frame (' + L.cols + 'x' + L.rows + ') plus the margin, not the tiles');
    }

    /* ---------- determinism ---------- */
    const digest = (list) => list.map((t) =>
      t.x.toFixed(6) + ',' + t.y.toFixed(6) + ',' + t.s.toFixed(6)).join(';');
    const first = digest(app.buildTiling());
    const again = digest(app.buildTiling());
    say('tile list digest ' + (first === again ? 'MATCHES' : 'DIFFERS') +
      ' (' + tiles.length + ' tiles)');
    if (first !== again) fail('same parameters built two different tilings');

    /* ---------- drive every control through the DOM ---------- */
    const original = {
      shape: fl.state().shape, fit: fl.state().fit, depth: fl.state().depth,
      inner: fl.state().inner, soft: fl.state().soft, thresh: fl.state().thresh,
      base: app.baseScale().value
    };
    const drive = (id, value) => {
      const el = document.getElementById(id);
      if (!el) { fail('no #' + id + ' in the markup'); return false; }
      el.value = String(value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };
    const snap = () => digest(app.buildTiling());
    const start = snap();
    const bsMax = app.baseScale().max;
    let controlsOk = true;
    const cases = [
      ['inFdepth', 1, 'tiles'],
      ['inFinner', 0, 'tiles'],
      ['inFsoft', 25, 'tiles'],
      ['inFbase', original.base === bsMax ? 1 : bsMax, 'tiles'],
      ['selFfit', 'cover', 'tiles']
    ];
    for (const [id, value, what] of cases) {
      if (!drive(id, value)) { controlsOk = false; continue; }
      if (snap() === start) {
        fail('control ' + id + ' changed nothing: tile digest identical');
        controlsOk = false;
      } else {
        say('control ' + id + ': moves the tiles');
      }
    }
    const IDS = {
      shape: 'selFshape', fit: 'selFfit', depth: 'inFdepth', inner: 'inFinner',
      soft: 'inFsoft', thresh: 'inFthresh', base: 'inFbase'
    };
    /* A detail number above the geometric cap has to be KEPT as typed, with the
     * read-out naming the depth the build really used. Clamping it inside the box
     * would throw the number away and make that read-out impossible. */
    drive('inFbase', bsMax);
    drive('inFdepth', 8);
    const capNow = fl.depthCap(app.lattice());
    const readout = document.getElementById('outFdepth').textContent.trim();
    if (fl.state().depth !== 8) {
      fail('a detail ask above the cap was discarded instead of kept (state is ' +
        fl.state().depth + ')');
      controlsOk = false;
    }
    if (!/tiles stop/.test(readout)) {
      fail('the detail read-out stayed silent while the cap was in charge: "' + readout + '"');
      controlsOk = false;
    }
    say('detail 8 at base ' + bsMax + ': kept as typed, build used ' + capNow +
      ', read-out "' + readout + '"');

    /* Restore the coarsest control first: the depth cap follows the base scale,
     * and restoring detail while the cap still says 1 is the mistake this harness
     * used to make, not a bug in the app. */
    drive('inFbase', original.base);
    for (const [key, value] of Object.entries(original)) {
      if (key === 'base') continue;
      drive(IDS[key], value);
    }
    const st = fl.state();
    say('restored to shape ' + st.shape + ', fit ' + st.fit + ', depth ' + st.depth +
      ', inner ' + st.inner + ', soft ' + st.soft + ', base ' + app.baseScale().value +
      ': ' + app.buildTiling().length + ' tiles (started with ' + tiles.length + ')');
    if (snap() !== start) fail('restoring the controls did not return to the first tiling');
    say('depth box advertised up to ' + document.getElementById('inFdepth').max +
      ', geometric cap ' + fl.depthCap(app.lattice()));

    /* Number-box traps: out of range must clamp, and a box cleared mid-typing
     * must be ignored rather than applied as zero. */
    drive('inFinner', 999);
    if (fl.state().inner !== +document.getElementById('inFinner').max) {
      fail('interior detail 999 was not clamped (state is ' + fl.state().inner + ')');
      controlsOk = false;
    }
    say('interior detail out of range: clamped to ' + fl.state().inner);
    const beforeClear = fl.state().inner;
    drive('inFinner', '');
    if (fl.state().inner !== beforeClear) {
      fail('a cleared interior detail box changed the state to ' + fl.state().inner);
      controlsOk = false;
    }
    say('cleared interior detail box: ignored, state stays ' + fl.state().inner);
    drive('inFinner', original.inner);
    say('fill controls: ' + (controlsOk ? 'PASS' : 'FAIL'));

    /* ---------- the Fill ask rides in the link, the mask never does ---------- */
    const href = location.hash;
    if (/qa-mask|\.png|data:|blob:|lum/i.test(href)) {
      fail('a mask leaked into the share link: ' + href.slice(0, 140));
    } else {
      say('share link carries no mask, no file name, no image data');
    }
    const asks = ['fsh', 'fdp', 'fdi', 'fso', 'fth', 'fft']
      .filter((k) => new RegExp('[&;]' + k + '=').test(href));
    if (asks.length !== 6) {
      fail('the Fill ask did not ride in the share link (found ' +
        asks.join(',') + '): ' + href.slice(0, 140));
    } else {
      say('share link carries the Fill ask: ' +
        asks.map((k) => k + '=' + (href.match(new RegExp('[&;]' + k + '=([^&;]*)')) || [, '?'])[1]).join(' '));
    }

    /* ---------- tab round trip ---------- */
    const failsBefore = window.__FILL_FAILS.length;
    app.setTab('gen');
    const genTiles = app.buildTiling();
    if (!genTiles.length) fail('the Generator produced nothing while Fill was loaded');
    if (document.getElementById('fillParams').offsetParent !== null) {
      fail('fill params block still shown after switching to Generator');
    }
    app.setTab('photo');
    /* No image was loaded in this harness, so the Photo tab is legitimately not
     * ready: what must hold is that it says so cleanly and leaves the other
     * tabs' state alone, not that it produces tiles out of nothing. */
    const photo = app.hooks.photo;
    if (!photo) fail('the Photo tab has no hooks after registration');
    else if (photo.hasImage()) fail('the Photo tab reports an image that was never given to it');
    else say('Photo tab stays not-ready without an image, as designed');
    app.setTab('fill');
    if (!fl.hasMask()) fail('the custom mask was lost across a tab round trip');
    if (digest(app.buildTiling()) !== snap()) fail('the fill tiling changed across a tab round trip');
    say('tab round trip gen -> photo -> fill kept the mask and the same tiles');
    say('tab round trip: ' + (window.__FILL_FAILS.length === failsBefore ? 'PASS' : 'FAIL'));

    /* ---------- what "fit" promises in a frame that is not square ---------- */
    /* contain promises the whole shape, which only holds if the shape is scaled
     * equally on both axes; cover promises the shape fills the frame, which means
     * it is scaled to the LONG side and the frame cuts the rest. A square test
     * frame cannot tell these apart, so it tests both a wide and a tall one. */
    const fmt = document.getElementById('selFormat');
    const bboxOf = (list) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const t of list) {
        x0 = Math.min(x0, t.x); y0 = Math.min(y0, t.y);
        x1 = Math.max(x1, t.x + t.s); y1 = Math.max(y1, t.y + t.s);
      }
      return [x0, y0, x1, y1];
    };
    let aspectOk = true;
    const digest11 = snap();
    for (const frame of ['16:9', '9:16']) {
      drive('selFormat', frame);
      if (snap() === digest11) {
        fail('changing the frame to ' + frame + ' reused the previous tiling (stale cache)');
        aspectOk = false;
      }
      const L2 = app.lattice();
      const longSide = Math.max(L2.cols, L2.rows), shortSide = Math.min(L2.cols, L2.rows);
      for (const fit of ['contain', 'cover']) {
        drive('selFfit', fit);
        const half = fl.mapOf(L2).half;
        const bb = bboxOf(app.buildTiling());
        const aud = fl.audit(L2);
        const boxW = bb[2] - bb[0], boxH = bb[3] - bb[1];
        const wantHalf = (fit === 'contain') ? shortSide / 2 : longSide / 2;
        const notes = [];
        if (Math.abs(half - wantHalf) > 1e-9)
          notes.push('scale ' + half + ' expected ' + wantHalf);
        if (fit === 'contain') {
          if (Math.abs(boxW - boxH) > 1e-6) notes.push('not square: ' + boxW + 'x' + boxH);
          if (bb[0] < -1e-9 || bb[1] < -1e-9 || bb[2] > L2.cols + 1e-6 || bb[3] > L2.rows + 1e-6)
            notes.push('leaves the frame: ' + bb.join(','));
          if (Math.abs(Math.max(boxW, boxH) - shortSide) > 1e-6)
            notes.push('does not span the short side ' + shortSide);
        } else {
          if (Math.abs(bb[0]) > 1e-6 || Math.abs(bb[2] - L2.cols) > 1e-6)
            notes.push('does not span the long side ' + L2.cols + ': ' + bb.join(','));
          if (Math.abs(bb[1]) > 1e-6 || Math.abs(bb[3] - L2.rows) > 1e-6)
            notes.push('tiles hang outside the frame: ' + bb.join(','));
        }
        if (aud.missedFrac > 0.02) notes.push('unpainted shape ' + aud.missedFrac.toFixed(4));
        if (notes.length) {
          fail('fit ' + fit + ' at ' + frame + ' (' + L2.cols + 'x' + L2.rows + '): ' +
            notes.join('; '));
          aspectOk = false;
        }
        say('fit ' + fit + ' at ' + frame + ' (' + L2.cols + 'x' + L2.rows + '): box '
          .concat(boxW.toFixed(2)) + 'x' + boxH.toFixed(2) + ' of ' + L2.cols + 'x' + L2.rows +
          ', painted ' + (1 - aud.missedFrac).toFixed(4));
      }
      drive('selFfit', original.fit);
    }
    drive('selFormat', original.format || '1:1');
    if (snap() !== digest11) fail('returning to the first frame did not return to the first tiling');
    say('fill fit semantics: ' + (aspectOk ? 'PASS' : 'FAIL'));

    say('worst spill ' + worstSpill.toFixed(4) + ', worst unpainted ' + worstMissed.toFixed(4) +
      ', most tiles in one shape ' + maxTiles);
    finish();
  }

  function finish() {
    let b64 = '';
    try {
      /* Payload only: the 'data:image/png;base64,' prefix is not part of the
       * image, and a length check that counts it is a length check that lies. */
      b64 = document.getElementById('mainCanvas').toDataURL('image/png').split(',')[1] || '';
    } catch (e) { b64 = ''; }
    document.getElementById('out').textContent = out.join('\n') +
      '\n\nFILL_HARNESS ' + (window.__FILL_FAILS.length ? 'FAILED' : 'PASSED') +
      '\n__FILL_JSON__' + JSON.stringify({ fails: window.__FILL_FAILS }) + '\n' +
      (b64 ? 'PNG|' + b64.length + '|' + b64 + '\n' : '');
  }

  window.addEventListener('error', (e) => {
    window.__FILL_FAILS.push('uncaught: ' + (e.message || e));
    try { finish(); } catch (ignored) { }
  });
  setTimeout(() => { try { run(); } catch (e) {
    window.__FILL_FAILS.push('harness threw: ' + (e && e.message ? e.message : e));
    say('' + (e && e.stack ? e.stack : e));
    finish();
  } }, 300);
})();
