/* Gate probe for the lattice a frame starts on.

 * Square tiles cannot keep their size when the frame goes wide: 16:9 reduced to
 * coprime 16x9 means 144 cells at the coarsest density, a tile 11% of the short
 * edge where a 1:1 frame's single tile is the whole frame. The app answers by
 * letting a frame stand on a coarser continued-fraction lattice (latticeBase in
 * src/app.js) and re-deriving the long edge at every density (latticeAt). What
 * that buys has to keep paying, and this probe is the bill:

 *   1. A density-1 lattice cell is a real chunk of the frame on EVERY preset,
 *      not 100% on 1:1 and 11% on 16:9. Measured as one lattice unit in export
 *      pixels, as a fraction of the frame's short edge.
 *   2. A coarse lattice is slightly off the frame's ratio, and cover fit cuts
 *      the difference. That cut may only take arc-wing overhang: the window the
 *      renderer looks through must contain the WHOLE lattice rectangle at every
 *      density, and no square that lies inside the grid may be clipped. Measured
 *      against the same bounds the renderer culls with.
 *   3. 'sur' and 'off' place units that stick out past the lattice on purpose
 *      (that is what an offset surround is), so their squares outside the grid
 *      are counted separately: the rule is about squares INSIDE the grid, which
 *      is the only kind the lattice choice can be blamed for.
 *   4. The long edge is re-derived per density, so the lattice is never more
 *      than half a cell off the frame ratio at ANY density, and the coarsest
 *      setting is the worst it ever gets.
 *   5. The frame's own exact grid, rebuilt here from the engine, must satisfy
 *      the same rules - it is the baseline the coarse lattice is judged against,
 *      and a probe that cannot pass the baseline is a broken probe.

 * Also checks the caps, that the presets are reduced to lowest terms, that the
 * coarse cap leaves frames that never needed it alone, and that the Fill and
 * Photo tabs stand on the Generator's lattice.
 */
window.LATTICEPROBE = function () {
  const A = window.TruchetApp;
  const T = window.Truchet;
  const $ = (id) => document.getElementById(id);
  const set = (id, v) => {
    const e = $(id);
    if (!e) throw new Error('no element #' + id);
    e.value = String(v);
    e.dispatchEvent(new Event('input'));
  };
  const live = [], baseline = [], problems = [];
  window.addEventListener('error', (e) => problems.push(e.message));

  const WING = T.WING_MARGIN;
  const FORMATS = ['1:1', '16:9', '9:16', '21:9', '4:3', '3:4', '3:2', '2:3',
    '5:4', '4:5', '2:1', '1:2'];
  /* the frame's own reduced grid, which the coarse lattice stands in for */
  const EXACT = { '1:1': [1, 1], '16:9': [16, 9], '9:16': [9, 16], '21:9': [7, 3],
    '4:3': [4, 3], '3:4': [3, 4], '3:2': [3, 2], '2:3': [2, 3],
    '5:4': [5, 4], '4:5': [4, 5], '2:1': [2, 1], '1:2': [1, 2] };
  const TILINGS = ['chk', 'grid', 'rand', 'sur', 'off'];
  const MIN_CELL = 0.15;      // a lattice cell as a fraction of the short edge
  const SHORT_MAX = 4;        // LATTICE_SHORT_MAX, mirrored here so the gate is
                              // an outside check and not a restatement
  const SIDE_CAP = 64;        // MAX_LATTICE_SIDE
  const EPS = 1e-9;
  const S = A.state();

  /* The tiles one lattice emits, written out here rather than read from the app,
   * so the exact grid can be measured too - the app only ever draws the lattice
   * it chose. Same calls app.tilingFor makes. */
  function tilesOf(tiling, cols, rows) {
    switch (tiling) {
      case 'chk': return T.checkerboardTiling(cols, rows);
      case 'grid': return T.gridTiling(rows, cols);
      case 'rand': {
        const rnd = T.mulberry32(T.seedFromString(S.seed));
        const nSplit = Math.max(1, Math.round(S.splits * cols * rows / 10));
        return T.randomSubdivision(rnd, nSplit, S.maxd, T.gridTiling(rows, cols));
      }
      case 'sur': return T.surroundTiling(cols, rows);
      case 'off': return T.offsetSurroundTiling(rows, cols);   // (rows, cols)
    }
    return [];
  }

  /* The window drawScene looks through: bounds from the tiles, cover-scaled onto
   * the frame, centred on them. Bounds use the engine's own wing margin, so this
   * is the culling box the renderer actually uses, not an approximation. */
  function windowOf(tiles, fw, fh, pad) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const t of tiles) {
      const m = t.s * WING;
      x0 = Math.min(x0, t.x - m); y0 = Math.min(y0, t.y - m);
      x1 = Math.max(x1, t.x + t.s + m); y1 = Math.max(y1, t.y + t.s + m);
    }
    const p = (pad / 100) * (x1 - x0);
    x0 -= p; y0 -= p; x1 += p; y1 += p;
    const bw = x1 - x0, bh = y1 - y0;
    const s = Math.max(fw / bw, fh / bh);            // px per lattice unit
    const winW = fw / s, winH = fh / s;              // in lattice units
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    return { s, winW, winH, x0: cx - winW / 2, y0: cy - winH / 2,
      x1: cx + winW / 2, y1: cy + winH / 2, bw, bh };
  }

  /* cols x rows of `tiling` measured against the frame: what the frame's cover
   * fit does to that grid, cell by cell and tile by tile. */
  function measure(fmt, tiling, cols, rows, step, source) {
    const [fw, fh] = A.framePx();
    const tiles = source === 'app' ? A.buildTiling() : tilesOf(tiling, cols, rows);
    const win = windowOf(tiles, fw, fh, S.pad);
    let cutInside = 0, cutOutside = 0, outside = 0, inside = 0;
    for (const t of tiles) {
      const inGrid = t.x > -EPS && t.y > -EPS &&
        t.x + t.s < cols + EPS && t.y + t.s < rows + EPS;
      if (!inGrid) outside++; else inside++;
      const whole = t.x > win.x0 - EPS && t.x + t.s < win.x1 + EPS &&
        t.y > win.y0 - EPS && t.y + t.s < win.y1 + EPS;
      if (!whole) (inGrid ? cutInside++ : cutOutside++);
    }
    return {
      fmt, tiling, cols, rows, step, source, cells: tiles.length,
      base: A.latticeBase().join('x'),
      unitPx: +win.s.toFixed(2),
      cellFraction: +(win.s / Math.min(fw, fh)).toFixed(4),
      ratioErrPct: +(Math.abs(cols / rows - fw / fh) / (fw / fh) * 100).toFixed(3),
      cellError: +(Math.abs((fw >= fh ? cols - fw / fh * rows : rows - fh / fw * cols))).toFixed(4),
      rectCutX: +(cols - win.winW).toFixed(4),       // > 0: a whole column is clipped
      rectCutY: +(rows - win.winH).toFixed(4),
      rectWhole: win.winW >= cols - EPS && win.winH >= rows - EPS,
      cutInside, cutOutside, outside, inside,
    };
  }

  for (const fmt of FORMATS) {
    set('selFormat', fmt);
    set('selRes', '2048');
    const [ec, er] = EXACT[fmt];
    for (const tiling of TILINGS) {
      set('selTiling', tiling);
      set('inN', 1);
      const b = A.latticeBase(), maxT = A.latticeMaxT();
      live.push(measure(fmt, tiling, A.lattice().cols, A.lattice().rows, 1, 'app'));
      set('inN', maxT);
      live.push(measure(fmt, tiling, A.lattice().cols, A.lattice().rows, maxT, 'app'));
      /* the baseline: the frame's own exact grid at the SAME density steps, so
       * the coarse lattice is compared with what the frame would have done to
       * itself, not with a different scale of picture */
      const capStep = Math.floor(SIDE_CAP / Math.max(ec, er));
      for (const step of new Set([1, Math.min(maxT, capStep)])) {
        const cols = ec * step, rows = er * step;
        if (cols <= SIDE_CAP && rows <= SIDE_CAP) {
          baseline.push(measure(fmt, tiling, cols, rows, step, 'probe'));
        }
      }
    }
  }

  /* Frames that never needed coarsening must still stand on their exact grid. */
  const exactName = { '1:1': '1x1', '4:3': '4x3', '3:4': '3x4', '3:2': '3x2',
    '2:3': '2x3', '5:4': '5x4', '4:5': '4x5', '2:1': '2x1', '1:2': '1x2',
    '21:9': '7x3' };
  const untouched = ['1:1', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '2:1', '1:2', '21:9']
    .map((f) => {
      set('selFormat', f); set('selTiling', 'chk'); set('inN', '1');
      return { fmt: f, base: A.latticeBase().join('x'), want: exactName[f],
        ok: A.latticeBase().join('x') === exactName[f] };
    });

  /* Custom sizes: the coarse rule applies to arbitrary ratios too. */
  const customs = [];
  set('selFormat', 'custom');
  for (const [w, h] of [[1600, 1000], [1920, 1080], [1377, 919], [1600, 750], [2001, 999]]) {
    set('inFrameW', w); set('inFrameH', h);
    set('selTiling', 'chk'); set('inN', 1);
    const L = A.lattice();
    customs.push(measure('custom ' + w + 'x' + h, 'chk', L.cols, L.rows, 1, 'app'));
    set('inN', A.latticeMaxT());
    const L2 = A.lattice();
    customs.push(measure('custom ' + w + 'x' + h, 'chk', L2.cols, L2.rows, L2.t, 'app'));
  }

  /* Fill and Photo stand on the Generator's lattice: same frame, same step. */
  set('selFormat', '16:9'); set('selTiling', 'chk'); set('inN', '1');
  const gen = A.lattice();
  const tabs = [];
  for (const tab of ['fill', 'photo']) {
    A.setTab(tab);
    A.setBaseScale(1);
    const L = A.lattice();
    tabs.push({ tab, cols: L.cols, rows: L.rows,
      matches: L.cols === gen.cols && L.rows === gen.rows });
  }
  A.setTab('gen');

  return { live, baseline, untouched, customs, tabs, problems,
    wing: WING, minCell: MIN_CELL, shortMax: SHORT_MAX, sideCap: SIDE_CAP };
};
