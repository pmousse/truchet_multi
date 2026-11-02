#!/usr/bin/env python3
"""Still frames of the ink fields, arrived at the way a viewer arrives: the share hash.

Same arrangement as _groundshots.py, for the other layer. The runner only reports; the
hash decides the picture, and the report is checked against the hash afterwards - a
screenshot of a state the runner asked for but the app refused is worse than no
screenshot, because it looks like proof.

iksp=0 parks the ink loop at phase 0, so the sheet is reproducible. Motion is checked
numerically by _inkqa.py.

The report includes whether #inkCanvas is actually displayed: a field ink that never
reaches the screen is exactly the failure this sheet exists to catch.

Writes dev/browse/ink_<label>.png

Run:  python dev/_inkshots.py
"""
import io, json, os, re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEV = ROOT / 'dev'
BROWSE = DEV / 'browse'
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

# label, hash. Ground solid for most of these, so the ink is the only thing moving.
SHOTS = [
    ('solid',       '#ik=solid&gr=solid'),
    ('mesh_r00',    '#ik=shader&ikf=mesh&iksp=0&ikr=0&gr=solid'),
    ('mesh_r25',    '#ik=shader&ikf=mesh&iksp=0&ikr=25&gr=solid'),
    ('mesh_r50',    '#ik=shader&ikf=mesh&iksp=0&ikr=50&gr=solid'),
    ('mesh_c100',   '#ik=shader&ikf=mesh&iksp=0&ikc=100&ikr=25&gr=solid'),
    ('cells_r25',   '#ik=shader&ikf=cells&iksp=0&ikr=25&gr=solid'),
    ('veil_r25',    '#ik=shader&ikf=veil&iksp=0&ikr=25&gr=solid'),
    ('silk_r25',    '#ik=shader&ikf=silk&iksp=0&ikr=25&gr=solid'),
    ('ripple_c70',  '#ik=shader&ikf=ripple&iksp=0&ikc=70&ikr=40&gr=solid'),
    ('on_marble',   '#gr=shader&sh=marble&ss=0&ik=shader&ikf=mesh&iksp=0&ikr=25'),
    ('on_lava',     '#gr=shader&sh=lava&ss=0&ik=shader&ikf=veil&iksp=0&ikr=25'),
]

RUNNER = """<script>
window.addEventListener('load', function () {
  var A = window.TruchetApp, S = window.TruchetShaders;
  var r = document.getElementById('frame').getBoundingClientRect();
  var o = document.createElement('pre');
  o.id = 'shotrect';
  try {
  var st = A.state();
  var p = A.inkParts();
  o.textContent = JSON.stringify({
    x: r.x, y: r.y, w: r.width, h: r.height,
    ink: st.ink, inkShader: st.inkShader, inkPig: st.inkPig, inkRelief: st.inkRelief,
    ground: st.ground, shader: st.shader,
    inkShown: getComputedStyle(document.getElementById('inkCanvas')).display,
    inkSize: (!p || !p.gl) ? 'no field' : JSON.stringify(p.gl.maskSize),
    info: document.getElementById('inkInfo').textContent
  });
  } catch (e) { o.textContent = JSON.stringify({ runnerError: String(e && e.stack || e) }); }
  document.body.appendChild(o);
});
</script>"""


def page():
    src = io.open(ROOT / 'index.html', encoding='utf-8').read()
    src = src.replace('href="src/style.css"', 'href="../src/style.css"')
    for f in ('engine', 'shaders', 'app', 'photo', 'fill'):
        src = src.replace('<script src="src/%s.js"></script>' % f,
                          '<script src="../src/%s.js"></script>' % f)
    src = src.replace('<script src="../src/fill.js"></script>',
                      '<script src="../src/fill.js"></script>\n' + RUNNER)
    p = DEV / '_inkshot.html'
    io.open(p, 'w', encoding='utf-8').write(src)
    return p


def chrome(url, shot=None):
    base = [CHROME, '--headless=new', '--no-sandbox', '--hide-scrollbars',
            '--force-device-scale-factor=1', '--window-size=1300,950',
            '--virtual-time-budget=6000']
    subprocess.run(base + (['--screenshot=' + shot] if shot else ['--dump-dom']) + [url],
                   capture_output=True)
    dom = subprocess.run(base + ['--dump-dom', url], capture_output=True)
    dom = dom.stdout.decode('utf-8', 'replace')
    m = re.search(r'<pre id="shotrect">(.*?)</pre>', dom, re.S)
    if not m:
        return None
    return json.loads(m.group(1).replace('&amp;', '&').replace('&quot;', '"'))


def main():
    BROWSE.mkdir(exist_ok=True)
    url = 'file:///' + page().as_posix()

    first = chrome(url + SHOTS[0][1])
    if first is None:
        print('FAIL: the runner printed nothing (does #inkInfo / #inkCanvas exist?)')
        return 1
    box = (int(first['x']), int(first['y']),
           int(first['x'] + first['w']), int(first['y'] + first['h']))
    print('frame rect: %s' % (box,))

    zoom = str(DEV / 'zoom.py')
    raw = str(DEV / '_shot_raw_ink.png')
    bad = []
    for label, frag in SHOTS:
        want_shader = 'ik=shader' in frag
        info = chrome(url + frag, shot=raw)
        if info is None:
            print('FAIL: no report for %s' % label)
            return 1
        if info.get('runnerError'):
            print('FAIL: the runner threw for %s: %s' % (label, info['runnerError']))
            return 1
        if info['ink'] != ('shader' if want_shader else 'solid'):
            bad.append('%s: asked for ink %s, the picture has %s' % (label, 'shader' if want_shader else 'solid', info['ink']))
        if want_shader and info['inkShown'] == 'none':
            bad.append('%s: field ink asked for, #inkCanvas hidden - the field never reached the screen' % label)
        if want_shader and info['inkSize'] in ('none', 'no field', 'null'):
            bad.append('%s: the field was never given a mask (%s)' % (label, info['inkSize']))
        subprocess.run([sys.executable, zoom, raw,
                        str(BROWSE / ('ink_%s.png' % label)),
                        str(box[0]), str(box[1]), str(box[2] - box[0]),
                        str(box[3] - box[1]), '1'], capture_output=True)
        print('  %-11s %-22s ink canvas %s (%s)' % (label, info['info'][:22], info['inkSize'], info['inkShown']))
    if os.path.exists(raw):
        os.remove(raw)
    if bad:
        print('\nPROBLEMS:')
        for b in bad:
            print('  ' + b)
        return 1
    print('\nwrote %d frames to dev/browse/ink_<label>.png' % len(SHOTS))
    return 0


if __name__ == '__main__':
    sys.exit(main())
