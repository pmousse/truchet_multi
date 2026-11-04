/* A probe of the shape's contour, and of what a shader field does with it.
 *
 * Placement first.  A shape's outline is turned into a signed distance grid by
 * the Fill tab's chamfer pass, painted into a canvas by the very cover-fit matrix
 * the tiling is drawn through, and read back here along rays from the shape's
 * centre.  The crossing found is compared with the crossing the shape's own
 * definition says where it is, in pixels, through that same matrix.  A shape
 * painted through any other matrix would show up as an offset along every ray,
 * which the last check in this file makes sure the measurement would catch.
 *
 * A crossing near the edge of a canvas is not comparable: the outline may be off
 * the canvas altogether, and the coverage ramps across the outline over a couple
 * of grid cells, which is about as much as the tolerance allows.  So a ray is
 * only judged where it can reach, and the shapes are measured on frames that keep
 * them inside - 'whole shape inside the frame' on a wide frame, where a contour
 * sits comfortably away from every edge.
 *
 * Then use.  The "contour" field is asked for as ground and as ink, and the pixels
 * it paints are read where the outline is, well inside it, and well outside it, so
 * the gate can tell the field follows the shape rather than the frame.  For ink
 * there is a rule from the relief pass: light on ink may only travel away from the
 * ground, so ink outside the outline must not be brighter than ink inside it, and
 * the outline has to show up in some channel even where lightness is flat.
 *
 * And ink off the contour is allowed, up to a point: a quadtree fill draws a mixed
 * cell whole, so a rim of ink one finest-cell wide, plus the wings an arc tile
 * throws out to s/3, is how the tiling has always met a shape.  What is measured on
 * an export is that nothing inked lies further from the contour than that rim -
 * which is what a shape delivered at the wrong size would break.
 *
 * Run it through dev/_shapeqa.py, which prints the measurements and fails on a
 * contour in the wrong place, a field that ignores the shape, ink that strays past
 * the rim, or a shape that arrives at an export at the wrong size.
 */
(function () {
  'use strict';

  const A = window.TruchetApp;
  const TR = window.Truchet;
  const RAYS = 48;
  const fmt = (v, n) => Number(v).toFixed(n === undefined ? 2 : n);

  function pixels(src) {
    if (!src) return null;
    const scratch = document.createElement('canvas');
    scratch.width = src.width; scratch.height = src.height;
    const ctx = scratch.getContext('2d');
    ctx.drawImage(src, 0, 0);
    const d = ctx.getImageData(0, 0, scratch.width, scratch.height).data;
    return { w: scratch.width, h: scratch.height, d };
  }

  const at = (px, x, y) => 4 * (y * px.w + x);
  const cov = (px, x, y) => px.d[at(px, x, y)] / 255;               /* coverage   */
  const sdist = (px, x, y) => 2 * (px.d[at(px, x, y) + 1] / 255 - 0.5);   /* signed distance */
  const luma = (px, x, y) => (0.299 * px.d[at(px, x, y)] + 0.587 * px.d[at(px, x, y) + 1]
    + 0.114 * px.d[at(px, x, y) + 2]) / 255;

  function median(values) {
    if (!values.length) return null;
    const s = values.slice().sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  function run() {
    const lines = [];
    const rows = [];
    const problems = [];
    const bad = (m) => problems.push(m);
    const say = (line) => lines.push(line);

    function drive(id, value) {
      const el = document.getElementById(id);
      if (!el) { bad('no control ' + id); return false; }
      el.value = value;
      /* Selects answer to 'change', the number dials to 'input'; a harness that
       * fires only one of them silently changes nothing. */
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    function testFor(key) {
      const def = A.hooks.fill.shapes[key];
      return def && def.test ? def.test : null;
    }

    /* The shape's own outline along a ray: distances from the shape's centre, in
     * pixels through the given fit, at every place the inside test changes side. */
    function crossings(test, half, fit, ux, uy) {
      const out = [];
      const span = 1.6, steps = 1600;
      let prev = test(0, 0) > 0, prevT = 0;
      for (let i = 1; i <= steps; i++) {
        const t = span * i / steps;
        const now = test(ux * t, uy * t) > 0;
        if (now !== prev) out.push(half * fit.s * (prevT + t) / 2);
        prev = now; prevT = t;
      }
      return out;
    }

    /* How far a ray from (ox,oy) in direction (ux,uy) gets before leaving a canvas
     * of w x h.  v runs up the shape; a canvas row runs down. */
    function reach(w, h, ox, oy, ux, uy) {
      const cands = [Infinity];
      if (ux > 1e-6) cands.push((w - 1 - ox) / ux);
      if (ux < -1e-6) cands.push((0 - ox) / ux);
      if (uy > 1e-6) cands.push((h - 1 - oy) / -uy);
      if (uy < -1e-6) cands.push((oy - 0) / -uy);
      return Math.max(0, Math.min.apply(null, cands));
    }

    /* Crossings read off a painted shape canvas.  Coverage is sampled two
     * sub-samples per grid cell, so along the outline it sits on values like 0.5
     * itself; a test against 0.5 would flap and invent crossings.  A crossing is
     * placed between the last pixel firmly on one side of the ramp and the first
     * firmly on the other. */
    function measured(px, ox, oy, ux, uy, maxD) {
      const out = [];
      let firm = null, firmD = 0;
      for (let d = 1; d <= maxD; d += 1) {
        const x = Math.round(ox + ux * d), y = Math.round(oy - uy * d);
        if (x < 0 || y < 0 || x >= px.w || y >= px.h) break;
        const c = cov(px, x, y);
        const st = c >= 0.75 ? 1 : (c <= 0.25 ? 0 : null);
        if (st === null) continue;
        if (firm !== null && st !== firm) out.push((firmD + d) / 2);
        firm = st; firmD = d;
      }
      return out;
    }

    /* How far from the contour ink is allowed to be: a mixed quadtree cell is drawn
     * whole, so a rim as wide as the finest tile, plus the wings a tile's arcs
     * throw out, is what the tiling has always put past a shape's edge.  Reported
     * in lattice units, which is the unit the tiling and the shape share. */
    /* `gridN` is how many samples the mask is measured on along a side, so one
     * distance unit - one side of that grid - is 2 * half lattice units wide. */
    function rimAllow(tiles, half, gridN) {
      let small = Infinity;
      for (const t of tiles) if (t.s < small) small = t.s;
      if (!isFinite(small)) return null;
      return small * (1 + TR.WING_MARGIN) + 2 * half / gridN;
    }

    function offContour(half, shapePx, inkPx, w, h) {
      let worst = 0, inked = 0, outside = 0;
      for (let y = 1; y < h; y += 4) for (let x = 1; x < w; x += 4) {
        const d = sdist(shapePx, x, y);
        if (d > -0.005) continue;                 /* inside, or on the rim itself */
        outside++;
        if (cov(inkPx, x, y) > 0.5) {
          inked++;
          /* distance unit is one side of the mask grid = 2 * half lattice units */
          const lattice = -d * 2 * half;
          if (lattice > worst) worst = lattice;
        }
      }
      return { worst, inked, outside };
    }

    /* ---------- placement ---------- */
    A.setTab('fill');
    drive('selGround', 'solid');
    drive('selInk', 'solid');

    const cases = [
      { label: '1:1 square frame, whole shape inside', format: '1:1', fit: 'contain', w: 888, h: 888 },
      { label: '16:9 frame, whole shape inside', format: '16:9', fit: 'contain', w: 1920, h: 1080 },
      { label: '9:16 frame, whole shape inside', format: '9:16', fit: 'contain', w: 1080, h: 1920 },
      { label: '16:9 frame, shape cropped by the frame', format: '16:9', fit: 'cover', w: 1920, h: 1080 }
    ];
    let unreachable = 0, thin = [];
    for (const c of cases) {
      drive('selFormat', c.format);
      drive('selFfit', c.fit);
      drive('inFbase', '1');
      for (const shapeKey of ['circle', 'square', 'triangle', 'ring', 'cross', 'star']) {
        drive('selFshape', shapeKey);
        const tiles = A.buildTiling();
        const sh = A.hooks.fill.shapeImage();
        const fit = A.fitTransform(tiles, c.w, c.h);
        const painted = A.shapeAt(c.w, c.h);
        if (!sh || !fit || !painted) { bad(c.label + ' / ' + shapeKey + ': no shape or no fit came back'); continue; }
        const p = pixels(painted);
        const test = testFor(shapeKey);
        if (!test) { bad(shapeKey + ': the shape offers no inside test to measure against'); continue; }
        const half = (sh.x1 - sh.x0) / 2;
        const cx = (sh.x0 + sh.x1) / 2, cy = (sh.y0 + sh.y1) / 2;
        const ox = fit.s * (cx - fit.wx0), oy = c.h - fit.s * (cy - fit.wy0);
        /* The ramp across the outline is about a mask cell wide on either side; a
         * crossing is only judged when the outline is comfortably inside the canvas. */
        const tol = 2.5 + 2 * half * fit.s / sh.img.width;
        let worst = 0, offAt = null, missAt = null, mismatches = 0, wantN = 0, gotN = 0, outOfReach = 0;
        for (let k = 0; k < RAYS; k++) {
          const a = k / RAYS * 2 * Math.PI, ux = Math.cos(a), uy = Math.sin(a);
          const maxD = reach(p.w, p.h, ox, oy, ux, uy);
          const all = crossings(test, half, fit, ux, uy);
          const want = all.filter((d) => d <= maxD - tol);
          outOfReach += all.length - want.length;
          const got = measured(p, ox, oy, ux, uy, maxD - tol).filter((d) => d <= maxD - tol);
          wantN += want.length; gotN += got.length;
          if (want.length !== got.length) {
            mismatches++;
            if (missAt === null) missAt = 'ray ' + k + ': expected ' + want.length + ', found ' + got.length;
            continue;
          }
          for (let i = 0; i < want.length; i++) {
            const off = Math.abs(got[i] - want[i]);
            if (off > worst) { worst = off; offAt = 'ray ' + k + ' crossing ' + (i + 1) + ' off by ' + off.toFixed(1) + ' px'; }
          }
        }
        const verdict = (mismatches === 0 && worst <= tol && wantN >= 8) ? 'ok' : 'FAIL';
        if (verdict === 'FAIL') {
          bad(c.label + ' / ' + shapeKey + ': ' + (mismatches
            ? missAt + ' (on ' + mismatches + ' of ' + RAYS + ' rays)'
            : (wantN < 8 ? 'only ' + wantN + ' crossings were in reach to compare' : offAt))
            + ', tolerance ' + fmt(tol, 1) + ' px');
        }
        rows.push({ label: 'contour of ' + shapeKey + ' (' + c.label + ')', w: p.w, h: p.h,
          shape: c.fit, crossings: wantN, got: gotN, worst: Number(worst.toFixed(1)),
          tol: Number(tol.toFixed(1)), verdict });
        if (wantN < 12) thin.push(c.label + ' / ' + shapeKey);
        unreachable += outOfReach;
      }
    }

    if (unreachable) say(unreachable + ' crossings in all lie outside the canvas at these fits and were not measured'
      + (thin.length ? '; the fewest left to compare were in ' + thin.join(', ') : '') + '.');

    /* Sign: a shape's hole is outside it, and the unit the shader reads distances
     * in is one side of the mask grid, not one shape radius. */
    drive('selFormat', '1:1');
    drive('selFfit', 'contain');
    drive('selFshape', 'ring');
    {
      const tiles = A.buildTiling();
      const fit = A.fitTransform(tiles, 888, 888);
      const sh = A.hooks.fill.shapeImage();
      const p = pixels(A.shapeAt(888, 888));
      if (!sh || !fit || !p) bad('the ring has nothing to measure');
      else {
        const half = (sh.x1 - sh.x0) / 2;
        const mid = [fit.s * ((sh.x0 + sh.x1) / 2 - fit.wx0), 888 - fit.s * ((sh.y0 + sh.y1) / 2 - fit.wy0)];
        const jx = Math.round(mid[0]), jy = Math.round(mid[1]);
        const holeCov = cov(p, jx, jy), holeDist = sdist(p, jx, jy);
        const bandAt = 0.78 * half * fit.s;
        const bx = Math.round(mid[0] + bandAt);
        const bandCov = cov(p, bx, jy), bandDist = sdist(p, bx, jy);
        say('ring hole: coverage ' + fmt(holeCov) + ', signed distance ' + fmt(holeDist, 3)
          + '; ring band at 0.78: coverage ' + fmt(bandCov) + ', signed distance ' + fmt(bandDist, 3)
          + ' (the distance unit is one side of the mask grid, which is the shape short side)');
        const profile = [];
        for (let f = 0.1; f <= 1.3; f += 0.1) {
          const sx = Math.round(mid[0] + f * half * fit.s);
          if (sx < 0 || sx >= p.w) break;
          profile.push(fmt(f, 1) + ': cov ' + fmt(cov(p, sx, jy)) + ' dist ' + fmt(sdist(p, sx, jy), 3));
        }
        say('ring profile outward from its centre: ' + profile.join(' | '));
        if (holeCov > 0.1) bad('a ring hole reads as filled (coverage ' + fmt(holeCov) + ')');
        if (holeDist > 0) bad('a ring hole reads as inside (signed distance ' + fmt(holeDist, 3) + ')');
        if (bandCov < 0.9) bad('the ring band is not filled at 0.78 of its radius (coverage ' + fmt(bandCov) + ')');
        if (bandDist < 0) bad('the ring band reads as outside (signed distance ' + fmt(bandDist, 3) + ')');
        rows.push({ label: 'sign: hole outside, band inside', w: 888, h: 888, shape: 'ring',
          crossings: 1, got: 1, worst: Number(bandDist.toFixed(3)), tol: 0,
          verdict: (holeCov > 0.1 || holeDist > 0 || bandCov < 0.9 || bandDist < 0) ? 'FAIL' : 'ok' });
      }
    }

    /* Which way a shape stands: a triangle is wider near its base than near its
     * apex, and the outline painted for a field has to agree. */
    drive('selFshape', 'triangle');
    {
      const fit = A.fitTransform(A.buildTiling(), 888, 888);
      const sh = A.hooks.fill.shapeImage();
      const p = pixels(A.shapeAt(888, 888));
      if (!sh || !fit || !p) bad('the triangle has nothing to measure');
      else {
        const half = (sh.x1 - sh.x0) / 2;
        const midY = 888 - fit.s * ((sh.y0 + sh.y1) / 2 - fit.wy0);
        const span = (v) => {
          const row = Math.round(midY - v * half * fit.s);
          if (row < 0 || row >= p.h) return -1;
          let n = 0;
          for (let x = 0; x < p.w; x++) if (cov(p, x, row) > 0.5) n++;
          return n;
        };
        const high = span(0.55), low = span(-0.35);
        say('triangle width near its top ' + high + ' px, near its base ' + low + ' px');
        const verdict = low > 1.5 * high ? 'ok' : 'FAIL';
        if (verdict === 'FAIL') bad('a triangle comes out widest near its apex, not its base (' + high + ' px above, ' + low + ' px below)');
        rows.push({ label: 'orientation: apex up', w: 888, h: 888, shape: 'triangle',
          crossings: high, got: low, worst: 0, tol: 0, verdict });
      }
    }

    /* ---------- use: the contour field, read at the preview ---------- */
    drive('selGround', 'shader');
    drive('selShader', 'contour');
    drive('selInk', 'shader');
    drive('selInkShader', 'contour');

    function fieldRow(label, shapeKey, asInk) {
      drive('selFshape', shapeKey);
      A.shapeAt(888, 888);                       // make sure the preview shape exists
      const sp = pixels(A.shapeParts().canvas);
      const sh = A.hooks.fill.shapeImage();
      const cv = document.getElementById(asInk ? 'inkCanvas' : 'groundCanvas');
      if (!sp || !cv || !sh) { bad(label + ': nothing to read'); return; }
      const f = pixels(cv);
      if (!f) { bad(label + ': nothing to read'); return; }
      if (sp.w !== f.w || sp.h !== f.h) {
        bad(label + ': the shape canvas is ' + sp.w + 'x' + sp.h + ' but the field is ' + f.w + 'x' + f.h);
        return;
      }
      /* One distance unit is one side of the mask grid, which is 2 * half lattice
       * units; the field's own band is asked for in lattice units, so the three
       * sample classes are cut in lattice units too - inside the band it gathers in,
       * half a lattice unit away on either side of the outline. */
      const unit = sh.x1 - sh.x0;              // the shape's short side, in lattice units
      let dMin = 1, dMax = -1, covMean = 0, covN = 0;
      for (let y = 1; y < sp.h; y += 5) for (let x = 1; x < sp.w; x += 5) {
        const d = sdist(sp, x, y); if (d < dMin) dMin = d; if (d > dMax) dMax = d;
        covMean += cov(sp, x, y); covN++;
      }
      /* The field's rim is asked for as a fraction of the shape's own side, so the
       * classes are cut in that unit too: inside the rim, and far enough into the
       * shape and clear out of it to be plainly off the outline. How far out the
       * frame even reaches is bounded, so the deep cuts are taken against what this
       * shape offers rather than guessed. */
      const bandCut = 0.035 * unit;             // inside half the field's rim (its rim is 0.07)
      const deepIn = Math.max(0.05 * unit, 0.75 * dMax);
      const deepOut = -Math.max(0.05 * unit, -0.75 * dMin);
      say(label + ' diagnostic: shape ' + sp.w + 'x' + sp.h + ' over a side of ' + fmt(unit, 2)
        + ' lattice units, signed distance ' + fmt(dMin, 3) + ' to ' + fmt(dMax, 3)
        + ', mean coverage ' + fmt(covMean / covN) + '; classes at ' + fmt(bandCut, 3)
        + ' on the outline, ' + fmt(deepIn, 3) + ' inside, ' + fmt(deepOut, 3) + ' outside');
      const onBand = [], onIn = [], onOut = [];
      const colBand = [0, 0, 0], colIn = [0, 0, 0];
      let nBand = 0, nIn = 0, nOut = 0;
      for (let y = 2; y < sp.h - 2; y += 2) for (let x = 2; x < sp.w - 2; x += 2) {
        const d = sdist(sp, x, y), L = luma(f, x, y);
        if (Math.abs(d) < bandCut) {
          onBand.push(L);
          for (let ch = 0; ch < 3; ch++) colBand[ch] += f.d[at(f, x, y) + ch];
          nBand++;
        } else if (d > deepIn) {
          onIn.push(L);
          for (let ch = 0; ch < 3; ch++) colIn[ch] += f.d[at(f, x, y) + ch];
          nIn++;
        } else if (d < deepOut) {
          onOut.push(L);
          nOut++;
        }
      }
      if (deepIn <= 2 * bandCut || -deepOut <= 2 * bandCut) {
        bad(label + ': this shape is too slight to tell the outline from the middle (deepest inside ' + fmt(dMax, 3)
          + ', deepest outside ' + fmt(-dMin, 3) + ', against a rim ' + fmt(bandCut, 3) + ' wide)');
        return;
      }
      if (nBand < 40 || nIn < 40 || nOut < 40) {
        bad(label + ': not enough to compare (on the contour ' + nBand + ', inside ' + nIn + ', outside ' + nOut + ')');
        return;
      }
      say(label + ': samples ' + nBand + ' on the outline (within ' + fmt(bandCut, 3)
        + ' of the shape side), ' + nIn + ' deep inside and ' + nOut + ' deep outside');
      const b = median(onBand), i0 = median(onIn), o = median(onOut);
      const shift = Math.max.apply(null, [0, 1, 2].map((ch) => Math.abs(colBand[ch] / nBand - colIn[ch] / nIn)));
      say(label + ': on the contour ' + fmt(b, 3) + ', well inside ' + fmt(i0, 3) + ', well outside '
        + fmt(o, 3) + ' over ' + nBand + '/' + nIn + '/' + nOut + ' samples; colour shift off the contour '
        + fmt(shift / 255, 3));
      let verdict = 'ok';
      if (asInk) {
        /* Light on ink may only move away from the ground, so what lies outside the
         * outline may not be brighter than the outline itself; and since lightness
         * is spent, the contour has to survive in hue to be an ask at all. */
        if (o > b + 0.015) verdict = 'FAIL';
        if (shift / 255 < 0.02) verdict = 'FAIL';
        if (verdict === 'FAIL') bad(label + ': ink off its own outline: outside ' + fmt(o, 3)
          + ' vs contour ' + fmt(b, 3) + ', colour shift ' + fmt(shift / 255, 3));
      } else {
        if (b < i0 + 0.03 || b < o + 0.03) verdict = 'FAIL';
        if (verdict === 'FAIL') bad(label + ': the ground contour is not the brightest line there: '
          + fmt(b, 3) + ' against inside ' + fmt(i0, 3) + ' and outside ' + fmt(o, 3));
      }
      rows.push({ label, w: sp.w, h: sp.h, shape: shapeKey, crossings: nBand, got: nIn,
        worst: Number(b.toFixed(3)), tol: 0.03, verdict });
    }

    fieldRow('contour as ground, circle', 'circle', false);
    fieldRow('contour as ground, ring', 'ring', false);
    fieldRow('contour as ink, ring', 'ring', true);
    fieldRow('contour as ink, star', 'star', true);

    /* ---------- the rim ink is allowed to make, at an export's size ---------- */
    {
      const shapeKey = 'ring';
      drive('selFormat', '16:9');
      drive('selFfit', 'contain');
      drive('inFbase', '1');
      drive('selFshape', shapeKey);
      const tiles = A.buildTiling();
      const got = A.inkFieldAt(1920, 1080);
      const told = A.inkParts().clockGl ? A.inkParts().clockGl.shapeSize : null;
      if (!got || !got.mask) { bad('no export-sized ink to read'); return finish(); }
      const mask = pixels(got.mask), field = pixels(got.field), sp = pixels(A.shapeAt(1920, 1080));
      if (!sp) { bad('no export-sized shape to read'); return finish(); }
      const sh = A.hooks.fill.shapeImage();
      const half = (sh.x1 - sh.x0) / 2;
      const allow = rimAllow(tiles, half, sh.img.width);
      const off = offContour(tiles, half, sp, mask, mask.w, mask.h);
      const allowPx = allow * A.fitTransform(tiles, 1920, 1080).s;
      const worstPx = off.worst * A.fitTransform(tiles, 1920, 1080).s;
      say('export 1920x1080 off a ring: ' + off.inked + ' inked samples outside the contour, the deepest '
        + fmt(worstPx, 1) + ' px off it, where a cell plus its wings is ' + fmt(allowPx, 1) + ' px;'
        + ' the field was told about a shape of ' + JSON.stringify(told));
      let verdict = 'ok';
      if (!told || told[0] !== 1920 || told[1] !== 1080) verdict = 'FAIL';
      if (off.worst > allow * 1.35) verdict = 'FAIL';
      if (verdict === 'FAIL') bad('ink strays past the rim an export is allowed to make off a ring: '
        + fmt(worstPx, 1) + ' px against ' + fmt(allowPx, 1) + ' px allowed'
        + (told ? '' : ' (and the field was never told about a shape at all)'));
      rows.push({ label: 'ink rim at export size', w: 1920, h: 1080, shape: String(told),
        crossings: off.outside, got: off.inked, worst: Number(worstPx.toFixed(1)),
        tol: Number(allowPx.toFixed(1)), verdict });
    }

    /* A frame standing on no shape still has an outline - its own edge - and a
     * field must not be left holding a shape carried over from the tab before it. */
    A.setTab('gen');
    drive('selFormat', '16:9');
    drive('inN', '1');
    drive('selGround', 'shader');
    drive('selShader', 'contour');
    {
      const told = A.groundParts().gl ? A.groundParts().gl.shapeSize : 'no field';
      if (told) bad('the generator tab handed a field a shape it never asked for: ' + JSON.stringify(told));
      const g = pixels(document.getElementById('groundCanvas'));
      if (!g) bad('no ground field to read on the generator tab');
      else {
        /* shapeDist()'s stand-in measures the frame's own edge in fractions of the
         * frame's short side; the probe works in the same unit so the two agree. */
        const m = Math.min(g.w, g.h);
        const dist = (x, y) => Math.min(0.5 * (g.w / m) - Math.abs((x + 0.5 - g.w / 2) / m),
                                        0.5 - Math.abs((y + 0.5 - g.h / 2) / m));
        let nearSum = 0, nearN = 0, farSum = 0, farN = 0;
        for (let y = 1; y < g.h; y += 3) for (let x = 1; x < g.w; x += 3) {
          const d = dist(x, y), L = luma(g, x, y);
          if (d < 0.02) { nearSum += L; nearN++; } else if (d > 0.3) { farSum += L; farN++; }
        }
        const nearL = nearN ? nearSum / nearN : 0, farL = farN ? farSum / farN : 0;
        const verdict = (!told && nearL > farL + 0.03) ? 'ok' : 'FAIL';
        if (verdict === 'FAIL') bad('a frame standing on no shape does not treat its own edge as a contour: edge '
          + fmt(nearL, 3) + ' against middle ' + fmt(farL, 3));
        say('no shape asked for: the field reads the frame edge at ' + fmt(nearL, 3) + ' and the middle at '
          + fmt(farL, 3) + ' over ' + nearN + '/' + farN + ' samples');
        rows.push({ label: 'no shape: the frame edge stands in', w: g.w, h: g.h, shape: 'edge vs middle',
          crossings: nearN, got: farN, worst: Number(nearL.toFixed(3)), tol: 0.03, verdict });
      }
    }

    /* And the measurement has to have teeth: a shape placed through a fit that is
     * not the tiling's own has to be caught by the numbers above. */
    {
      A.setTab('fill');
      drive('selFormat', '1:1');
      drive('selFfit', 'contain');
      drive('inFbase', '1');
      drive('selFshape', 'square');
      const tiles = A.buildTiling();
      const sh = A.hooks.fill.shapeImage();
      const good = A.fitTransform(tiles, 888, 888);
      const other = A.fitTransform(tiles, 1700, 1700);
      if (!sh || !good || !other) bad('the teeth test has nothing to measure');
      else {
        const half = (sh.x1 - sh.x0) / 2;
        const test = testFor('square');
        let worst = 0;
        for (let k = 0; k < 12; k++) {
          const a = k / 12 * 2 * Math.PI, ux = Math.cos(a), uy = Math.sin(a);
          const want = crossings(test, half, good, ux, uy)[0];
          const got = crossings(test, half, other, ux, uy)[0];
          if (want === undefined || got === undefined) continue;
          worst = Math.max(worst, Math.abs(got - want));
        }
        const verdict = worst >= 20 ? 'ok' : 'FAIL';
        if (verdict === 'FAIL') bad('the measurement did not notice a shape placed through the wrong fit ('
          + fmt(worst, 1) + ' px), so it is measuring nothing');
        else say('negative pass: a shape placed by the wrong fit measures ' + fmt(worst, 0) + ' px off');
        rows.push({ label: 'negative pass: wrong fit caught', w: 888, h: 888, shape: 'square',
          crossings: 12, got: 12, worst: Number(worst.toFixed(1)), tol: 0, verdict });
      }
    }

    return finish();

    function finish() {
      if (document.getElementById('err') && document.getElementById('err').textContent) {
        bad('the page shows an error: ' + document.getElementById('err').textContent);
      }
      return { rows, lines, problems };
    }
  }

  window.SHAPEQA = function () {
    try { return run(); } catch (e) {
      return { rows: [], lines: [], problems: ['probe threw: ' + (e && e.stack || e)] };
    }
  };
})();
