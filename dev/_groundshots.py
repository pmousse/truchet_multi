#!/usr/bin/env python3
"""Still frames of every field, composited the way the app composites them:
ground canvas under a transparent tile canvas.

The picture is arrived at through the share hash - gr=shader&sh=<field>&ss=0 -
and not by poking the controls from a script. That is deliberate: the shell writes
the hash on load, its hashchange re-restore lands a tick after any load handler,
and a runner that set the controls was found having its changes reverted before
the shutter - ten screenshots of the same field to prove it. Driving the hash is
both the fix and the honest path, since it is how a viewer actually arrives.

ss=0 parks the loop at phase 0 so the sheet is reproducible. Motion is checked
numerically by _groundqa.py, which is the only honest way to check motion.

Writes dev/browse/ground_<field>.png.

Run:  python dev/_groundshots.py [mix scrim ...]
"""
import io, json, os, re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEV = ROOT / 'dev'
BROWSE = DEV / 'browse'
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'

RUNNER = """<script>
window.addEventListener('load', function () {
  var A = window.TruchetApp, S = window.TruchetShaders;
  /* This runner only reports. Everything about the picture is in the hash. */
  var r = document.getElementById('frame').getBoundingClientRect();
  var o = document.createElement('pre');
  o.id = 'shotrect';
  o.textContent = JSON.stringify({
    x: r.x, y: r.y, w: r.width, h: r.height,
    fields: S.list.map(function (f) { return f.key; }),
    active: A.state().shader, ground: A.state().ground,
    mix: A.state().shMix, scrim: A.state().scrim,
    speed: A.state().shSpeed, scale: A.state().shScale,
    info: document.getElementById('groundInfo').textContent
  });
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
    p = DEV / '_groundshot.html'
    io.open(p, 'w', encoding='utf-8').write(src)
    return p


def chrome(url, shot=None):
    cmd = [CHROME, '--headless=new', '--no-sandbox', '--hide-scrollbars',
           '--force-device-scale-factor=1', '--window-size=1300,950',
           '--virtual-time-budget=6000']
    cmd += ['--screenshot=' + shot] if shot else ['--dump-dom']
    subprocess.run(cmd + [url], capture_output=True)
    dom = subprocess.run([CHROME, '--headless=new', '--no-sandbox', '--hide-scrollbars',
                          '--force-device-scale-factor=1', '--window-size=1300,950',
                          '--virtual-time-budget=6000', '--dump-dom', url],
                         capture_output=True).stdout.decode('utf-8', 'replace')
    m = re.search(r'<pre id="shotrect">(.*?)</pre>', dom, re.S)
    if not m:
        return None
    return json.loads(m.group(1).replace('&amp;', '&').replace('&quot;', '"'))


def main():
    BROWSE.mkdir(exist_ok=True)
    url = 'file:///' + page().as_posix()
    args = sys.argv[1:]
    mix = int(args[0]) if args else 45
    scrim = int(args[1]) if len(args) > 1 else 45

    first = chrome(url + '#gr=shader&sh=mesh&ss=0&sm=%d&sr=%d' % (mix, scrim))
    if first is None:
        print('FAIL: the runner printed nothing (does #frame / #groundInfo exist?)')
        return 1
    box = (int(first['x']), int(first['y']),
           int(first['x'] + first['w']), int(first['y'] + first['h']))
    print('frame rect: %s' % (box,))
    print('fields offered: %s' % first['fields'])

    zoom = str(DEV / 'zoom.py')
    raw = str(DEV / '_shot_raw.png')
    bad = []
    for key in first['fields']:
        u = url + '#gr=shader&sh=%s&ss=0&sc=1&sm=%d&sr=%d' % (key, mix, scrim)
        info = chrome(u, shot=raw)
        if info is None:
            print('FAIL: no report for %s' % key)
            return 1
        if info['active'] != key or info['ground'] != 'shader':
            bad.append('%s: asked for the field, the picture has %r over a %r ground'
                       % (key, info['active'], info['ground']))
            continue
        subprocess.run([sys.executable, zoom, raw,
                        str(BROWSE / ('ground_%s.png' % key)),
                        str(box[0]), str(box[1]), str(box[2] - box[0]),
                        str(box[3] - box[1]), '1'], capture_output=True)
        print('  %-7s %s' % (key, info['info']))
    if os.path.exists(raw):
        os.remove(raw)
    if bad:
        print('\nPROBLEMS:')
        for b in bad:
            print('  ' + b)
        return 1
    print('\nwrote %d frames to dev/browse/ground_<field>.png' % len(first['fields']))
    return 0


if __name__ == '__main__':
    sys.exit(main())
