#!/usr/bin/env python3
"""Regression gate for the shape a field paints (src/fill.js shapeImage,
src/app.js fitTransform + paintShapeImage, src/shaders.js shapeDist).

What it proves, in frame pixels:

  placement  the contour a field samples is where the cover fit puts it, at the
             preview size and at the sizes an export uses, on square, wide and
             tall frames, with both the contain and the cover fit;
  sign       a shape's hole reads as outside, and its band as inside, so a ring is
             not filled in by an unsigned distance;
  orientation the top of a triangle is its apex, not its base;
  reading    a contour field is brightest on the contour - brighter than the shape
             well inside it and brighter than what lies outside it;
  escape     ink an export painted did not leave the shape at the export's size;
  fallback   a frame with no shape at all still gets a contour (its own edge) and
             carries no shape left over from the frame before it;
  teeth      a contour measured against the wrong fit is caught, or the gate is
             measuring nothing.

Run:  python dev/_shapeqa.py
"""
import io, json, os, re, subprocess, sys
from pathlib import Path

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEV = os.path.join(ROOT, 'dev')
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'

RUNNER = """<script>
window.addEventListener('load', function(){
  var o = document.createElement('pre');
  o.id = 'shapeout';
  try { o.textContent = JSON.stringify(window.SHAPEQA()); }
  catch (e) { o.textContent = JSON.stringify({fatal: String(e && e.stack || e)}); }
  document.body.appendChild(o);
});</script>"""


def harness():
    """index.html, moved into dev/, with the probe and a runner bolted on."""
    src = io.open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
    src = src.replace('href="src/style.css"', 'href="../src/style.css"')
    for f in ('engine', 'shaders', 'app', 'photo', 'fill'):
        src = src.replace('<script src="src/%s.js"></script>' % f,
                          '<script src="../src/%s.js"></script>' % f)
    src = src.replace('<script src="../src/fill.js"></script>',
                      '<script src="../src/fill.js"></script>\n'
                      '<script src="_shapeprobe.js"></script>\n' + RUNNER)
    path = os.path.join(DEV, '_shapepage.html')
    io.open(path, 'w', encoding='utf-8').write(src)
    return path


def main():
    page = harness()
    dom = subprocess.run(
        [CHROME, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
         '--allow-file-access-from-files',
         '--force-device-scale-factor=1', '--window-size=1730,1010',
         '--virtual-time-budget=60000', '--dump-dom', 'file:///' + Path(page).as_posix()],
        capture_output=True).stdout.decode('utf-8', 'replace')
    m = re.search(r'<pre id="shapeout">(.*?)</pre>', dom, re.S)
    if not m:
        print('FAIL: probe produced no output (page scripts may not have loaded)')
        return 1
    out = json.loads(m.group(1).replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>'))
    if 'fatal' in out:
        print('FAIL: probe threw:', out['fatal'])
        return 1
    rows, lines, problems = out['rows'], out['lines'], out['problems']

    print('%-38s %-11s %-16s %5s %5s  %-9s %-7s %s'
          % ('measure', 'canvas', 'what', 'want', 'got', 'offset', 'tolerance', 'verdict'))
    for r in rows:
        print('%-38s %-11s %-16s %5s %5s  %-9s %-7s %s'
              % (r['label'][:38], '%dx%d' % (r['w'], r['h']), r['shape'][:16],
                 r['crossings'], r['got'], r['worst'], r['tol'], r['verdict']))
    for line in lines:
        print('   ' + line)
    if problems:
        print('\nPROBLEMS:')
        for p in problems:
            print('  ' + p)
    bad = [r for r in rows if r['verdict'] != 'ok']
    ok = not problems and not bad
    print('\nSHAPE QA %s' % ('PASSED' if ok else 'FAILED'))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
