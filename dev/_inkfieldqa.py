#!/usr/bin/env python3
"""Regression gate for shader ink (the ink role in src/shaders.js plus the mask
plumbing in src/app.js).

Not to be confused with dev/_inkqa.py, which predates it and checks something
else entirely: the engine's measured MOTIF_INK fractions that the Photo tab's tone
model is built on. This one is the ink *field* gate, named after _groundqa.py.

One run, one page: the probe drives the shipped app through its own state and
onChange, so the tiles being measured are the tiles the product draws. For each
setting it photographs the picture twice - ink as a plain colour, ink as a field -
and compares the two: coverage of the strokes, what the field did to lightness,
whether the ink is still distinguishable from the ground, and what an export of
that state puts in the file.

The last case is the negative pass: relief 100% judged as if relief were 25%. It
has to FAIL, or the relief gates are decoration.

Run:  python dev/_inkfieldqa.py            all ten fields
      python dev/_inkfieldqa.py --only=mesh  one field, for a quick pass
"""
import io, json, os, re, subprocess, sys
from pathlib import Path

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEV = os.path.join(ROOT, 'dev')
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'

RUNNER = """<script>
window.addEventListener('load', function(){
  var o = document.createElement('pre');
  o.id = 'inkout';
  o.textContent = 'running...';
  document.body.appendChild(o);
  var m = /only=([a-z0-9]+)/.exec(location.search);
  Promise.resolve(window.INKFIELDQA(m ? { only: m[1] } : {})).then(function(t){ o.textContent = t; },
    function(e){ o.textContent = 'FATAL ' + (e && e.stack || e); });
});</script>"""


def page():
    """index.html moved into dev/, with the probe and a runner bolted on."""
    src = io.open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
    src = src.replace('href="src/style.css"', 'href="../src/style.css"')
    for f in ('engine', 'shaders', 'app', 'photo', 'fill'):
        src = src.replace('<script src="src/%s.js"></script>' % f,
                          '<script src="../src/%s.js"></script>' % f)
    src = src.replace('<script src="../src/fill.js"></script>',
                      '<script src="../src/fill.js"></script>\n'
                      '<script src="_inkfieldprobe.js"></script>\n' + RUNNER)
    path = os.path.join(DEV, '_inkfieldpage.html')
    io.open(path, 'w', encoding='utf-8').write(src)
    return path


def main():
    p = page()
    base = 'file:///' + Path(p).as_posix()
    only = [a for a in sys.argv[1:] if a.startswith('--only')]
    url = base + (('?' + only[0].replace('--only=', 'only=')) if only else '')

    def attempt():
        dom = subprocess.run(
            [CHROME, '--headless=new', '--no-sandbox', '--hide-scrollbars',
             '--force-device-scale-factor=1', '--window-size=1730,1010',
             '--virtual-time-budget=120000', '--dump-dom', url],
            capture_output=True).stdout.decode('utf-8', 'replace')
        m = re.search(r'<pre id="inkout">(.*?)</pre>', dom, re.S)
        if not m:
            return None
        return (m.group(1).replace('&amp;', '&').replace('&lt;', '<')
                .replace('&gt;', '>').replace('&quot;', '"').replace('&#39;', "'"))

    # These runners start Chrome instances back to back, and on a loaded machine a canvas
    # sometimes hands out no 2D or GL context. That is not a measurement, and the probe says
    # so out loud ("no field", "no export measured"). Retry that, but only that: a failing
    # measurement is printed once and fails the gate, the same way on every attempt.
    txt = None
    for n in (1, 2, 3):
        txt = attempt()
        if txt is None:
            print('attempt %d: the probe produced no output' % n)
            continue
        if 'INK FIELD QA PASSED' in txt:
            break
        starved = any(k in txt for k in ('no field', 'no export measured',
                                         'no preview measured', 'no field to compare')) \
            or txt.strip() == 'running...'
        if not starved:
            break
        print('attempt %d: no measurement reached the dump (empty canvas, or the probe was '
              'still working) - retrying' % n)

    if txt is None:
        print('FAIL: the probe produced no output (did the page scripts load?)')
        return 1
    print(txt)
    return 0 if 'INK FIELD QA PASSED' in txt else 1


if __name__ == '__main__':
    sys.exit(main())
