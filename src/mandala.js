/* mandala.js — radial ("mandala") Truchet on top of the Generator engine.
 *
 * A mandala is a set of concentric rings, each ring split into the same number
 * of sectors. Every cell is one of Carlson's connection tiles, but laid out in
 * polar space instead of a Cartesian grid: the tile's unit square is warped by
 *   r = r0 + v * (r1 - r0),   theta = th0 + u * dTheta
 * so the tile's S/N edges become the ring boundaries and its E/W edges become
 * the sector seams. Circuits are the engine's own (same connection sets, same
 * arc geometry, same circuit polygons) — only the final points are remapped,
 * which keeps seams continuous: two neighbouring cells map their shared edge
 * with the identical parametrization.
 *
 * Ring radii grow geometrically with factor exp(dTheta).  With the exponential
 * (log-polar) map below, each cell's radial and angular local scales are equal
 * (the map is conformal), so Carlson's near-tangent arc pairs stay near-tangent
 * instead of being pulled apart into white cracks.  Ring i's outer edge is
 * exactly ring i+1's inner edge, and both sides agree to first order there.
 */
(function () {
  const T = (typeof window !== 'undefined')
    ? window.Truchet
    : require('./engine.js');

  const DEG = Math.PI / 180;

  /* ---------- connection-set helpers ---------- */
  function setKey(conns) {
    return conns.map(([a, b]) => (a < b ? a + '-' + b : b + '-' + a))
      .sort().join(',');
  }
  const SET_INDEX = new Map();
  T.CONNECTION_SETS.forEach((c, i) => SET_INDEX.set(setKey(c), i + 1));

  const POINT_NODE = new Map();
  const pkey = (p) => p[0].toFixed(9) + ',' + p[1].toFixed(9);
  for (let n = 1; n <= T.NP; n++) POINT_NODE.set(pkey(T.PT[n]), n);

  /* Reflect a tile's connection set in x (u -> 1-u, i.e. flip the angular
   * direction of a cell). Every one of the 24 sets is a perfect matching of
   * the 4 odd against the 4 even boundary points, and a reflection maps odd
   * points to even ones, so the result is always one of the 24. */
  function mirrorSetX(connIdx) {
    const conns = T.CONNECTION_SETS[connIdx - 1];
    const mapped = conns.map(([a, b]) => {
      const pa = T.PT[a], pb = T.PT[b];
      const qa = POINT_NODE.get(pkey([1 - pa[0], pa[1]]));
      const qb = POINT_NODE.get(pkey([1 - pb[0], pb[1]]));
      return qa < qb ? [qa, qb] : [qb, qa];
    });
    const idx = SET_INDEX.get(setKey(mapped));
    return idx === undefined ? connIdx : idx;
  }

  /* ---------- model ---------- */
  // opts: rings, sectors, sym ('free'|'mirror'|number k), ringMode ('auto'|'even'),
  //       seed, pool (array of motif names)
  function build(opts) {
    const rings = Math.max(1, Math.round(opts.rings));
    const sectors = Math.max(3, Math.round(opts.sectors));
    const ringMode = opts.ringMode === 'even' ? 'even' : 'auto';
    const sym = opts.sym === undefined ? 'free' : opts.sym;
    const pool = (opts.pool && opts.pool.length) ? opts.pool : ['/'];
    const dth = 2 * Math.PI / sectors;

    // radii: ring i spans radii[i] .. radii[i+1]
    // 'auto' grows by exp(dTheta) so that the exponential warp below is
    // conformal and the rings tile with no gap; 'even' keeps uniform thickness
    // (conformal only for the first ring, stretched for the rest).
    const radii = [1];
    if (ringMode === 'auto') {
      const g = Math.exp(dth);
      for (let i = 0; i < rings; i++) radii.push(radii[i] * g);
    } else {
      for (let i = 1; i <= rings; i++) radii.push(1 + i);
    }
    let maxDr = 0;
    for (let i = 0; i < rings; i++) maxDr = Math.max(maxDr, radii[i + 1] - radii[i]);

    // rotational symmetry: k divides sectors -> only sectors/k cells are drawn
    let rotK = 0;
    if (typeof sym === 'number' && sym > 1 && sectors % sym === 0) rotK = sym;
    const mirror = sym === 'mirror' && sectors % 2 === 0;
    const wedge = rotK ? sectors / rotK : (mirror ? sectors / 2 : sectors);

    const rnd = T.mulberry32(T.seedFromString(
      String(opts.seed || '') + '\u0001mandala:' + sectors + ':' + rings));
    const ringsOut = [];
    for (let i = 0; i < rings; i++) {
      const half = [];
      for (let j = 0; j < wedge; j++) {
        half.push(T.connIdxByName(pool[Math.floor(rnd() * pool.length)]));
      }
      const cells = [];
      for (let j = 0; j < sectors; j++) {
        let idx;
        if (mirror && j >= wedge) idx = mirrorSetX(half[sectors - 1 - j]);
        else if (rotK) idx = half[j % wedge];
        else idx = half[j];
        cells.push({
          ring: i, sector: j, connIdx: idx,
          r0: radii[i], r1: radii[i + 1], th0: j * dth
        });
      }
      ringsOut.push(cells);
    }
    return {
      cells: ringsOut, rings, sectors, dth, radii, maxDr,
      rInner: radii[0], rOuter: radii[rings], rotK, mirror
    };
  }

  /* ---------- warped rendering ---------- */
  /* Parameter-space polyline -> polar polyline, subdivided so no single
   * segment sweeps more than MAX_SWEEP of angle (a straight parameter segment
   * is only a chord of its warped image).
   * `state` is shared across all segments of one circuit: only the very first
   * point gets a moveTo. Otherwise every segment becomes its own open subpath
   * and the circuit fills as a chain of thin slivers instead of a band. */
  const MAX_SWEEP = 1.2 * DEG;
  function warpStroke(ctx, pts, cell, dth, cx, cy, s, state) {
    const project = (x, y) => {
      // log-polar map: r = r0 * (r1/r0)^v, theta = th0 + u * dTheta.
      // Local scale is r*dTheta in both directions when r1 = r0 * exp(dTheta),
      // i.e. the map is a similarity at every point -> angles are preserved.
      const r = cell.r0 * Math.pow(cell.r1 / cell.r0, y);
      const th = cell.th0 + x * dth;
      return [cx + s * r * Math.cos(th), cy - s * r * Math.sin(th)];
    };
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k];
      if (!state.started) {                 // the circuit's single start point
        const q0 = project(p[0], p[1]);
        ctx.moveTo(q0[0], q0[1]);
        state.started = true;
        continue;
      }
      const prev = k > 0 ? pts[k - 1] : pts[pts.length - 1];
      const dthSeg = (p[0] - prev[0]) * dth;
      const steps = Math.max(1, Math.ceil(Math.abs(dthSeg) / MAX_SWEEP));
      for (let t = 1; t <= steps; t++) {
        const u = prev[0] + (p[0] - prev[0]) * t / steps;
        const v = prev[1] + (p[1] - prev[1]) * t / steps;
        const q = project(u, v);
        ctx.lineTo(q[0], q[1]);
      }
    }
  }

  /* A warped circuit is also stroked with a width proportional to the local
   * cell size.  Carlson's circuit polygons contain near-osculating arc pairs
   * (bands whose edges touch with matched curvature); the polar warp opens
   * those contacts into hairline lenses, which read as cracks.  Stroking the
   * same path in its own fill colour fattens the band just enough to close
   * them without changing the silhouette. */
  function cellStrokeWidth(cell, dth, s) {
    const rMid = (cell.r0 + cell.r1) / 2;
    return Math.max(0.6, s * rMid * dth * 0.045);
  }

  function drawCell(ctx, cell, dth, cx, cy, s, topColor, underColor) {
    const def = T.getTile(cell.connIdx);
    // Same pass order as the Generator: under-colored circuits first, then the
    // circuits that sit on top (Carlson's SquareArcTile order).
    for (const pass of [true, false]) {
      for (const { whiteFirst, segs } of def) {
        if (whiteFirst !== pass) continue;
        const color = pass ? underColor : topColor;
        ctx.beginPath();
        const state = { started: false };
        for (const seg of segs) {
          warpStroke(ctx, T.sampleArc(seg), cell, dth, cx, cy, s, state);
        }
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = cellStrokeWidth(cell, dth, s);
        ctx.strokeStyle = color;
        ctx.stroke();
      }
    }
  }

  /* opts: w, h, palette (array or fn(ringIndex)), invert (bool), hub
   * ('none'|'disc'|'ring'), pad (fraction of the diameter) */
  function render(ctx, model, opts) {
    const w = opts.w, h = opts.h;
    const pad = opts.pad || 0;
    const wing = model.maxDr / 3;                 // wings reach 1/3 of a cell
    const fitR = model.rOuter + wing;
    const s = (Math.min(w, h) / 2) * (1 - pad) / fitR;
    const cx = w / 2, cy = h / 2;

    // outer rings first: inner (smaller) cells overpaint their neighbours' wings
    for (let i = model.rings - 1; i >= 0; i--) {
      const pal = (typeof opts.palette === 'function')
        ? opts.palette(i) : opts.palette;
      const flip = !!opts.invert && (i % 2 === 1);
      for (const cell of model.cells[i]) {
        drawCell(ctx, cell, model.dth, cx, cy, s,
          flip ? pal[1] : pal[0], flip ? pal[0] : pal[1]);
      }
    }

    const hub = opts.hub || 'none';
    if (hub !== 'none') {
      const pal = (typeof opts.palette === 'function')
        ? opts.palette(0) : opts.palette;
      ctx.fillStyle = pal[0];
      ctx.beginPath();
      const rHub = hub === 'ring'
        ? model.rInner * s : model.rInner * s * 0.55;
      ctx.arc(cx, cy, rHub, 0, Math.PI * 2);
      if (hub === 'ring') {
        ctx.lineWidth = Math.max(1, model.maxDr * s * 0.12);
        ctx.strokeStyle = pal[0];
        ctx.stroke();
      } else {
        ctx.fill();
      }
    }
    return s;
  }

  const api = { build, render, mirrorSetX, setKey };
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window !== 'undefined') window.TruchetMandala = api;
})();
