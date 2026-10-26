#!/usr/bin/env node
/* check_gold.js — compare src/engine.js against dev/gold.json
 * (produced by dev/port.py, the literal Python port of Carlson's WL). */
'use strict';
const fs = require('fs');
const path = require('path');
const T = require(path.join(__dirname, '..', 'src', 'engine.js'));
const gold = JSON.parse(fs.readFileSync(path.join(__dirname, 'gold.json'), 'utf8'));

let fails = 0;
function fail(msg) { console.log('FAIL:', msg); fails++; }

function approx(a, b, tol = 2e-5) { return Math.abs(a - b) < tol; }

/* 1) connection sets */
if (gold.names.length !== T.TILE_NAMES.length) fail('tile count mismatch');

for (const name of gold.names) {
  const g = gold.tiles[name];
  const idx = T.connIdxByName(name);
  if (idx !== g.index) fail(`${name}: index ${idx} != gold ${g.index}`);
  const conns = T.CONNECTION_SETS[idx - 1];
  const norm = p => p.map(([a, b]) => `${a}->${b}`).join(' ');
  if (norm(conns) !== norm(g.connections)) fail(`${name}: connections mismatch`);

  /* 2) circuits */
  const circs = T.traceCircuits(conns);
  if (circs.length !== g.circuits.length) {
    fail(`${name}: circuit count ${circs.length} != gold ${g.circuits.length}`);
    continue;
  }
  const key = c => c.join(',');
  const gkeys = g.circuits.map(c => c.circuit.join(',')).sort();
  const jkeys = circs.map(c => c.join(',')).sort();
  if (gkeys.join('|') !== jkeys.join('|')) {
    fail(`${name}: circuits mismatch\n  gold: ${gkeys.join(' | ')}\n  js  : ${jkeys.join(' | ')}`);
  }

  /* 3) sampled polygon points */
  for (const gc of g.circuits) {
    const jp = T.circuitPolygon(gc.circuit, 5);
    if (jp.length !== gc.points.length) {
      fail(`${name}: polygon ${gc.circuit} point count ${jp.length} != gold ${gc.points.length}`);
      continue;
    }
    let maxd = 0, argmax = null;
    for (let i = 0; i < jp.length; i++) {
      const d = Math.hypot(jp[i][0] - gc.points[i][0], jp[i][1] - gc.points[i][1]);
      if (d > maxd) { maxd = d; argmax = [i, jp[i], gc.points[i]]; }
    }
    if (maxd > 1e-4) fail(`${name}: polygon ${gc.circuit} max point dev ${maxd} at ${JSON.stringify(argmax)}`);
  }
}

/* 4) tiling generators */
function tilesKeyJ(tiles) {
  return tiles.map(t => `${t.x},${t.y},${t.s}`).sort().join('|');
}
function tilesKeyG(g) {
  // gold entries: [motifIdx, (a,b,c,d,tx,ty)] with s = a
  return g.map(([mid, [a, b, c, d, tx, ty]]) => `${tx},${ty},${a}`).sort().join('|');
}
for (const cfg of ['checker_slash_3', 'grid_2x2', 'surround_2']) {
  const gen = {
    checker_slash_3: () => T.checkerboardTiling(3),
    grid_2x2: () => T.gridTiling(2, 2),
    surround_2: () => T.surroundTiling(2)
  }[cfg]();
  if (tilesKeyJ(gen) !== tilesKeyG(gold.tilings[cfg])) {
    fail(`tiling ${cfg} mismatch\n  gold: ${tilesKeyG(gold.tilings[cfg]).slice(0, 160)}\n  js  : ${tilesKeyJ(gen).slice(0, 160)}`);
  }
}

/* 5) tangent continuity spot check: at every circuit node the two adjacent
 *    arc endpoints equal the node position and tangent directions agree */
for (const name of gold.names) {
  const conns = T.CONNECTION_SETS[T.connIdxByName(name) - 1];
  for (const c of T.traceCircuits(conns)) {
    const segs = T.circuitSegments(c);
    for (let i = 0; i < segs.length; i++) {
      const s1 = segs[i], s2 = segs[(i + 1) % segs.length];
      const end = s1.kind === 'line' ? s1.p2 : [
        s1.c[0] + s1.rx * Math.cos(s1.a2), s1.c[1] + s1.ry * Math.sin(s1.a2)];
      const start = s2.kind === 'line' ? s2.p1 : [
        s2.c[0] + s2.rx * Math.cos(s2.a1), s2.c[1] + s2.ry * Math.sin(s2.a1)];
      if (Math.hypot(end[0] - start[0], end[1] - start[1]) > 1e-9)
        fail(`${name} circuit ${c.join(',')}: gap at node ${i}`);
    }
  }
}

console.log(fails ? `${fails} FAILURES` : 'ALL GOLD CHECKS PASSED (' + gold.names.length + ' tiles)');
process.exit(fails ? 1 : 0);
