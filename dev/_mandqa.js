// Structural checks for the Mandala tab model (src/mandala.js).
const T = require('../src/engine.js');
const M = require('../src/mandala.js');
let fails = 0;
const ck = (cond, msg) => { if (!cond) { fails++; console.log('FAIL ' + msg); } };

// 1. mirrorSetX: valid, involutive, and the mirrored set is a real reflection
const names = T.TILE_NAMES;
for (let i = 1; i <= 24; i++) {
  const mi = M.mirrorSetX(i);
  ck(mi >= 1 && mi <= 24, `mirrorSetX(${i}) -> ${mi} out of range`);
  ck(M.mirrorSetX(mi) === i, `mirror not involutive for ${names[i-1]} -> ${names[mi-1]}`);
  // geometric check: mirrored connection pairs equal the reflected point pairs
  const pts = (idx) => T.CONNECTION_SETS[idx-1].map(([a,b]) => [T.PT[a], T.PT[b]]);
  const key = (pairs) => pairs.map(([p,q]) => [p.map(v=>v.toFixed(6)).join(','), q.map(v=>v.toFixed(6)).join(',')].sort().join('|')).sort().join(';');
  const refl = pts(i).map(([p,q]) => [[1-p[0], p[1]], [1-q[0], q[1]]]);
  ck(key(refl) === key(pts(mi)), `mirror geometry mismatch ${names[i-1]} -> ${names[mi-1]}`);
}

// 2. cell counts, sectors per ring, indices in range, seam sharing
for (const sym of ['free', 'mirror', 2, 3, 4, 6]) {
  for (const sectors of [6, 8, 12, 16, 20, 24]) {
    const m = M.build({ rings: 5, sectors, sym, ringMode: 'auto', seed: 'k7x2m9', pool: T.MOTIF_NAMES });
    ck(m.cells.length === 5, 'ring count');
    m.cells.forEach((ring, i) => {
      ck(ring.length === sectors, `ring ${i} cell count`);
      ring.forEach((c, j) => {
        ck(c.connIdx >= 1 && c.connIdx <= 24, 'connIdx range');
        ck(c.r0 === m.radii[i] && c.r1 === m.radii[i+1], 'ring radii');
        ck(Math.abs(c.th0 - j * m.dth) < 1e-12, 'sector angle');
        // neighbour seam continuity: shared boundary parametrization
        // neighbour seam continuity: the E edge of one cell is the W edge
        // of the next (mod 2pi), at identical radii -> identical warped line
        const nx = ring[(j + 1) % sectors];
        const wrap = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const d = Math.abs(wrap(c.th0 + m.dth) - wrap(nx.th0));
        ck(Math.min(d, 2 * Math.PI - d) < 1e-9, 'seam angle');
        ck(c.r0 === nx.r0 && c.r1 === nx.r1, 'seam radii');
      });
    });
  }
}

// 3. bilateral symmetry: cell j and cell sectors-1-j are mirrored partners
{
  const sectors = 12;
  const m = M.build({ rings: 3, sectors, sym: 'mirror', ringMode: 'auto', seed: 'abc', pool: T.MOTIF_NAMES });
  m.cells.forEach((ring) => {
    for (let j = 0; j < sectors; j++) {
      const a = ring[j].connIdx, b = ring[sectors - 1 - j].connIdx;
      ck(M.mirrorSetX(a) === b, `mirror pair ${j}/${sectors-1-j}: ${names[a-1]} vs ${names[b-1]}`);
    }
  });
}

// 4. rotational symmetry: period sectors/k repeats exactly
{
  const sectors = 12, k = 4;
  const m = M.build({ rings: 3, sectors, sym: k, ringMode: 'even', seed: 'abc', pool: T.MOTIF_NAMES });
  m.cells.forEach((ring) => {
    for (let j = 0; j < sectors; j++)
      ck(ring[j].connIdx === ring[j % (sectors / k)].connIdx,
        `rot period mismatch at sector ${j}`);
    const distinct = new Set(ring.map(c => c.connIdx)).size;
    ck(distinct <= sectors / k, 'rot wedge distinct count');
  });
}

// 5. determinism + pool restriction
{
  const a = M.build({ rings: 4, sectors: 16, sym: 'free', ringMode: 'auto', seed: 'same', pool: ['fnw', 'tn'] });
  const b = M.build({ rings: 4, sectors: 16, sym: 'free', ringMode: 'auto', seed: 'same', pool: ['fnw', 'tn'] });
  ck(JSON.stringify(a.cells.map(r => r.map(c => c.connIdx))) ===
     JSON.stringify(b.cells.map(r => r.map(c => c.connIdx))), 'determinism');
  const allowed = new Set(['fnw', 'tn'].map(n => T.connIdxByName(n)));
  a.cells.forEach(r => r.forEach(c => ck(allowed.has(c.connIdx), 'pool restriction')));
  const c = M.build({ rings: 4, sectors: 16, sym: 'free', ringMode: 'auto', seed: 'other', pool: ['fnw', 'tn'] });
  ck(JSON.stringify(a.cells.map(r => r.map(x => x.connIdx))) !==
     JSON.stringify(c.cells.map(r => r.map(x => x.connIdx))), 'seed sensitivity');
}

// 6. radii: the log-polar warp is conformal when rings grow by exp(dTheta)
{
  const sectors = 24, dth = 2 * Math.PI / sectors;
  const g = M.build({ rings: 6, sectors, sym: 'free', ringMode: 'auto', seed: 's', pool: ['/'] });
  for (let i = 0; i < 6; i++) {
    ck(Math.abs(g.radii[i+1] / g.radii[i] - Math.exp(dth)) < 1e-12, 'geometric ratio exp(dTheta)');
    // conformal cell: radial local scale r*ln(r1/r0) equals angular scale r*dTheta
    ck(Math.abs(Math.log(g.radii[i+1] / g.radii[i]) - dth) < 1e-12, 'conformal cell');
  }
  const e = M.build({ rings: 6, sectors, sym: 'free', ringMode: 'even', seed: 's', pool: ['/'] });
  for (let i = 0; i < 6; i++) ck(Math.abs((e.radii[i+1] - e.radii[i]) - 1) < 1e-12, 'uniform thickness');
}

console.log(fails ? `${fails} MANDALA CHECK(S) FAILED` : 'ALL MANDALA CHECKS PASSED');
process.exit(fails ? 1 : 0);
