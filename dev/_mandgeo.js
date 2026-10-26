// Measures how far warped circuit points leak outside their own cell.
const T = require('../src/engine.js');
const M = require('../src/mandala.js');

function stats(poolNames, rings, sectors, ringMode) {
  const m = M.build({ rings, sectors, sym: 'free', ringMode, seed: 'k7x2m9', pool: poolNames });
  let vLo = 0, vHi = 0, rIn = 0, rOut = 0, uLo = 0, uHi = 0;
  for (const ring of m.cells) for (const c of ring) {
    const dr = c.r1 - c.r0;
    for (const { segs } of T.getTile(c.connIdx)) {
      for (const seg of segs) {
        for (const p of T.sampleArc(seg)) {
          vLo = Math.max(vLo, -Math.min(0, p[1]));
          vHi = Math.max(vHi, Math.max(0, p[1] - 1));
          uLo = Math.max(uLo, -Math.min(0, p[0]));
          uHi = Math.max(uHi, Math.max(0, p[0] - 1));
          const r = c.r0 + p[1] * dr;
          rIn = Math.max(rIn, (c.r0 - r) / dr);
          rOut = Math.max(rOut, (r - c.r1) / dr);
        }
      }
    }
  }
  const dr = m.radii[1] - m.radii[0];
  console.log('pool=' + poolNames.join('') + ' rings=' + rings +
    ' sectors=' + sectors + ' mode=' + ringMode + ' dr=' + dr.toFixed(3));
  console.log('  param-space excursion: v in [' + (-vLo).toFixed(3) + ', ' +
    (1 + vHi).toFixed(3) + ']  u in [' + (-uLo).toFixed(3) + ', ' + (1 + uHi).toFixed(3) + ']');
  console.log('  radius leak: ' + rIn.toFixed(2) + ' x dr inward, ' + rOut.toFixed(2) + ' x dr outward');
}

stats(['/'], 1, 8, 'auto');
stats(['/'], 1, 24, 'auto');
stats(T.MOTIF_NAMES, 1, 24, 'auto');
stats(T.MOTIF_NAMES, 5, 20, 'auto');
stats(['fnw'], 1, 20, 'auto');
stats(['+'], 1, 20, 'auto');
stats(['tn'], 1, 20, 'auto');
stats(['x.'], 1, 20, 'auto');
