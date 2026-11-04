"""_latticeqa.py — the lattice a frame starts on, measured on the real page.

Square tiles cannot keep their size when the frame goes wide: 16:9 reduced to
coprime 16x9 is 144 cells at the coarsest density, a tile 11% of the short edge
where a 1:1 frame's single tile is the whole frame. The app lets a frame stand on
a coarser continued-fraction lattice (latticeBase) and re-derives the long edge
at every density (latticeAt). This gate is the bill for that bargain:

  * a density-1 lattice cell is at least 15% of the frame's short edge, on every
    preset and every generator tiling - the coarsest setting means a comparable
    picture everywhere, which is what the density control is for;
  * the cover-fit trim that a coarse ratio costs may only take arc-wing overhang:
    the window the renderer looks through must contain the whole lattice
    rectangle, and no tile square inside the grid may be clipped, at EVERY
    density up to the cap the app allows;
  * the long edge is re-derived per density, so a lattice is never more than half
    a cell off the frame's ratio however fine it gets;
  * the coarse cap must leave frames that never needed it on their exact grid
    (1:1, 4:3, 5:4, 3:2, 2:1 and 21:9, which is 7:3 reduced), and every lattice
    stays inside the side and tile caps;
  * Fill and Photo stand on the Generator's lattice, not their own;
  * the frame's own exact grid, rebuilt in the probe from the engine, passes the
    same tests - a probe that cannot pass the baseline is not measuring anything.

Run:  python dev/_latticeqa.py
"""
import io, json, os, re, subprocess, sys
from pathlib import Path

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEV = os.path.join(ROOT, 'dev')
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'


def harness():
    """index.html, moved into dev/ and given the probe appended."""
    src = io.open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
    src = src.replace('href="src/style.css"', 'href="../src/style.css"')
    for f in ('engine', 'app', 'photo', 'fill'):
        src = src.replace('<script src="src/%s.js"></script>' % f,
                          '<script src="../src/%s.js"></script>' % f)
    src = src.replace('<script src="../src/fill.js"></script>',
                      '<script src="../src/fill.js"></script>\n'
                      '<script src="_latticeprobe.js"></script>\n'
                      '<script>window.addEventListener("load",function(){'
                      'var o=document.createElement("pre");'
                      'o.id="latticeout";'
                      'try{o.textContent=JSON.stringify(window.LATTICEPROBE(),null,1);}'
                      'catch(e){o.textContent=JSON.stringify({fatal:String(e&&e.stack||e)});}'
                      'document.body.appendChild(o);});</script>')
    path = os.path.join(DEV, '_latticepage.html')
    io.open(path, 'w', encoding='utf-8').write(src)
    return path


def label(r):
    return '%s/%s n=%s %dx%d' % (r['fmt'], r['tiling'], r['step'], r['cols'], r['rows'])


def main():
    page = harness()
    dom = subprocess.run(
        [CHROME, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
         '--force-device-scale-factor=1', '--window-size=1730,1010',
         '--virtual-time-budget=60000', '--dump-dom', 'file:///' + Path(page).as_posix()],
        capture_output=True).stdout.decode('utf-8', 'replace')
    m = re.search(r'<pre id="latticeout">(.*?)</pre>', dom, re.S)
    if not m:
        print('FAIL: probe produced no output (page scripts may not have loaded)')
        return 1
    out = json.loads(m.group(1).replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>'))
    if 'fatal' in out:
        print('FAIL: probe threw:', out['fatal'])
        return 1
    live, baseline, customs, tabs = out['live'], out['baseline'], out['customs'], out['tabs']
    fails = []
    if out.get('problems'):
        fails += ['page error: ' + p for p in out['problems']]

    # a live row is 'plain' when every one of its tiles lies inside the grid;
    # for those the lattice-level rule is absolute, no square may be clipped
    plain = lambda r: r['outside'] == 0

    def check(rows, what):
        bad = [r for r in rows if not r['rectWhole']]
        if bad:
            fails.append('%s: cover fit clipped a cell of the grid (not just wing): %s '
                         '-> off by %s cells' % (what, ', '.join(label(r) for r in bad),
                                                 ', '.join('%s/%s' % (r['rectCutX'], r['rectCutY']) for r in bad)))
        bad = [r for r in rows if plain(r) and r['cutInside']]
        if bad:
            fails.append('%s: tile squares inside the grid were cut: %s' % (
                what, ', '.join('%s (%d)' % (label(r), r['cutInside']) for r in bad)))
        bad = [r for r in rows if r['cellError'] > 0.5 + 1e-6]
        if bad:
            fails.append('%s: lattice is more than half a cell off the frame ratio: %s' % (
                what, ', '.join('%s (%.3f cells)' % (label(r), r['cellError']) for r in bad)))
        bad = [r for r in rows if r['cols'] > out['sideCap'] or r['rows'] > out['sideCap']]
        if bad:
            fails.append('%s: lattice side over %d: %s' % (
                what, out['sideCap'], ', '.join(label(r) for r in bad)))

    check(live, 'app lattice')
    check(customs, 'custom frame')
    check(baseline, 'exact-grid baseline')

    # Tilings whose tiles hang outside the grid on purpose - an offset surround is
    # defined by that overhang - clip squares of the grid even when the frame
    # stands on its own exact grid. For those the rule is that the coarse lattice
    # must not clip MORE of the grid than the frame's own grid clips at the same
    # density step: the lattice may not add to a crop the tiling was always making.
    base_by = {(r['fmt'], r['tiling'], r['step']): r for r in baseline}
    worse = []
    for r in live:
        if plain(r) or r['cutInside'] == 0:
            continue
        b = base_by.get((r['fmt'], r['tiling'], r['step']))
        if b is None:
            continue
        if r['cutInside'] > b['cutInside']:
            worse.append('%s: %s/%s n=%s %dx%d clips %d inside-grid squares where the '
                         'frame\'s own %dx%d grid clips %d' % (
                             'coarse lattice', r['fmt'], r['tiling'], r['step'],
                             r['cols'], r['rows'], r['cutInside'], b['cols'], b['rows'],
                             b['cutInside']))
    fails += worse

    d1 = [r for r in live if r['step'] == 1]
    thin = [r for r in d1 if plain(r) and r['cellFraction'] < out['minCell']]
    if thin:
        fails.append('density-1 cell under %d%% of the short edge: %s' % (
            out['minCell'] * 100,
            ', '.join('%s/%s %.1f%%' % (r['fmt'], r['tiling'], r['cellFraction'] * 100) for r in thin)))
    smaller = []
    for r in d1:
        if not plain(r):
            b = base_by.get((r['fmt'], r['tiling'], 1))
            if b and r['cellFraction'] < b['cellFraction']:
                smaller.append('%s/%s %.1f%% vs its own grid %.1f%%' % (
                    r['fmt'], r['tiling'], r['cellFraction'] * 100, b['cellFraction'] * 100))
    if smaller:
        fails.append('coarse lattice gives a smaller cell than the frame\'s own grid at '
                     'the same density: ' + ', '.join(smaller))
    fine = [r for r in d1 if min(r['cols'], r['rows']) > out['shortMax']]
    if fine:
        fails.append('density-1 grid finer than the coarse cap allows (short edge > %d): %s' % (
            out['shortMax'], ', '.join(label(r) for r in fine)))
    for u in out['untouched']:
        if not u['ok']:
            fails.append('%s no longer stands on its exact grid: %s instead of %s' % (
                u['fmt'], u['base'], u['want']))
    for t in tabs:
        if not t['matches']:
            fails.append('%s tab uses lattice %dx%d, not the frame\'s' % (
                t['tab'], t['cols'], t['rows']))

    print('wing margin %.4f lattice units per side; a cut may take up to %.4f per axis\n'
          % (out['wing'], 2 * out['wing']))
    print('%-11s %-6s %-4s %-10s %-9s %-8s %-9s %-7s %s' % (
        'frame', 'tiling', 'n', 'lattice', 'cell px', 'cell %', 'ratio err', 'cells', 'off-by-cells'))
    for r in live:
        print('%-11s %-6s %-4s %-10s %-9.1f %-8.1f %-9.3f %-7d %.3f%s' % (
            r['fmt'], r['tiling'], r['step'], '%dx%d' % (r['cols'], r['rows']),
            r['unitPx'], r['cellFraction'] * 100, r['ratioErrPct'], r['cells'], r['cellError'],
            '' if r['source'] == 'app' else ' [' + r['source'] + ']'))
    print('\nbaseline (the frame\'s own grid, rebuilt in the probe):')
    for r in baseline:
        if r['tiling'] in ('sur', 'off') or r['fmt'] in ('16:9', '9:16', '21:9'):
            print('  %-11s %-5s n=%-3s %-9s squares outside the grid %4d, cut inside %d, cut outside %d' % (
                r['fmt'], r['tiling'], r['step'], '%dx%d' % (r['cols'], r['rows']),
                r['outside'], r['cutInside'], r['cutOutside']))
    print('\noverhang of the coarse lattice (tiles whose square lies outside the grid):')
    for r in live:
        if r['outside']:
            print('  %-11s %-5s n=%-3s %-9s outside %4d, cut by the frame %d, inside-grid cuts %d' % (
                r['fmt'], r['tiling'], r['step'], '%dx%d' % (r['cols'], r['rows']),
                r['outside'], r['cutOutside'], r['cutInside']))
    print('\ncustom frames:')
    for r in customs:
        print('  %-22s %-9s cell %5.1f%% of short edge, ratio err %5.2f%%, off by %.3f cells' % (
            r['fmt'], '%dx%d' % (r['cols'], r['rows']), r['cellFraction'] * 100,
            r['ratioErrPct'], r['cellError']))
    print('\nrows measured: %d app, %d custom, %d baseline' % (len(live), len(customs), len(baseline)))

    for f in fails:
        print('FAIL: ' + f)
    ok = not fails
    print('\nLATTICE QA %s' % ('PASSED' if ok else 'FAILED'))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
