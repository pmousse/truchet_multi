#!/usr/bin/env python3
"""Regression gate for the animated shader ground (src/shaders.js + the app's
ground plumbing).

Run 1 drives every field in isolation - coverage, luminance, motion, the loop
seam, the palette fold - and then switches the real app to a shader ground
through its own controls, checking that the tile canvas goes genuinely
transparent, that the two canvases stay stacked, and that the settings land in
the share link. Run 2 reopens the page from that link and checks the state and
the canvas stack come back, so the ground is proven shareable rather than
assumed to be.

Run:  python dev/_groundqa.py
"""
import io, json, os, re, subprocess, sys
from pathlib import Path

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEV = os.path.join(ROOT, 'dev')
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'


def page(mode_script):
    """index.html moved into dev/, with the probe and a runner bolted on."""
    src = io.open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
    src = src.replace('href="src/style.css"', 'href="../src/style.css"')
    for f in ('engine', 'shaders', 'app', 'photo', 'fill'):
        src = src.replace('<script src="src/%s.js"></script>' % f,
                          '<script src="../src/%s.js"></script>' % f)
    src = src.replace('<script src="../src/fill.js"></script>',
                      '<script src="../src/fill.js"></script>\n'
                      '<script src="_groundprobe.js"></script>\n' + mode_script)
    path = os.path.join(DEV, '_groundpage.html')
    io.open(path, 'w', encoding='utf-8').write(src)
    return path


RUNNER = """<script>
window.addEventListener('load', function(){
  var o = document.createElement('pre');
  o.id = 'groundout';
  try {
    var mode = location.hash.indexOf('gr=') >= 0 ? 'link' : 'fields';
    /* The negative pass asks the probe to judge the fields against a ground that
     * has the ink's own colour. A gate that can never fire measures nothing. */
    o.textContent = JSON.stringify(window.GROUNDQA(mode,
      { groundIsInk: location.hash.indexOf('bad=1') >= 0 }));
  } catch (e) { o.textContent = JSON.stringify({fatal: String(e && e.stack || e)}); }
  document.body.appendChild(o);
});</script>"""


def run(url):
    dom = subprocess.run(
        [CHROME, '--headless=new', '--no-sandbox', '--hide-scrollbars',
         '--force-device-scale-factor=1', '--window-size=1730,1010',
         '--virtual-time-budget=40000', '--dump-dom', url],
        capture_output=True).stdout.decode('utf-8', 'replace')
    m = re.search(r'<pre id="groundout">(.*?)</pre>', dom, re.S)
    if not m:
        return None
    txt = (m.group(1).replace('&amp;', '&').replace('&lt;', '<')
           .replace('&gt;', '>').replace('&quot;', '"'))
    return json.loads(txt)


def fmt(v):
    if isinstance(v, float):
        return ('%.2f' % v)
    return str(v)


def main():
    p = page(RUNNER)
    url = 'file:///' + Path(p).as_posix()

    out1 = run(url)
    if out1 is None:
        print('FAIL: probe produced no output (did the page scripts load?)')
        return 1
    if 'fatal' in out1:
        print('FAIL: probe threw:\n' + out1['fatal'])
        return 1

    rows, problems = out1['rows'], out1['problems']
    print('fields probed: %d' % out1['fieldCount'])
    print('%-14s %5s %6s %6s %6s %7s %7s %7s %9s %6s %6s %5s %7s %9s %6s %8s %8s %7s  %s'
          % ('field', 'loop', 'mean', 'spread', 'motion', 'step', 'seam',
             'offramp', 'rampspread', 'corr', 'shift', 'defmean', 'defspread',
             'scrimq', 'inkmin', 'inknear', 'inkgap5', 'cover', 'verdict'))
    for r in rows:
        if r.get('key', '').startswith('app:'):
            print('%-14s %s' % (r['key'], r['verdict']))
            if r['key'] == 'app:shader':
                print('   tile canvas transparent %.3f, ink %.3f, ground canvas %s %s '
                      'under main %s, read-out %r'
                      % (r['clearFrac'], r['inkFrac'], r['gcShown'], r['gcSize'],
                         r['mainSize'], r['info']))
            if r['key'].startswith('app:export'):
                print('   file %sx%s for frame %sx%s, mean pixel difference against the '
                      'preview %.2f, luminance correlation %.4f, %.1f%% of the file in '
                      'colours the tiles did not make'
                      % (r.get('w'), r.get('h'), r.get('frameW'), r.get('frameH'),
                         r.get('match', -1), r.get('corr', -1), r.get('groundPct', -1)))
            continue
        print('%-14s %5s %6s %6s %6s %7s %7s %7s %9s %6s %6s %5s %7s %9s %6s %8s %8s %7s  %s'
              % (r['key'], fmt(r['loop']), fmt(r['mean']), fmt(r['spread']),
                 fmt(r['motion']), fmt(r['step']), fmt(r['seam']),
                 fmt(r['offRamp']), fmt(r['rampSpread']), fmt(r['corr']),
                 fmt(r['shift']), fmt(r['defMean']), fmt(r['defSpread']),
                 fmt(r['scrimSpread']), fmt(r['inkMin']), fmt(r['inkNearPct']),
                 fmt(r['inkGap5']), fmt(r['opaquePct']), r['verdict']))

    # Run 2: the link run 1 wrote has to bring the same ground back.
    link = out1.get('shareLink') or ''
    if 'gr=shader' not in link:
        print('\nFAIL: run 1 wrote no shader-ground link: %r' % link)
        return 1
    out2 = run(url + '#' + link)
    if out2 is None or 'fatal' in (out2 or {}):
        print('FAIL: link run produced no output')
        return 1
    got = out2['state']
    want = {'ground': 'shader', 'shader': 'ripple', 'shSpeed': 2.5,
            'shScale': 1.5, 'shMix': 70, 'scrim': 30}
    bad = {k: got[k] for k, v in want.items() if got[k] != v}
    print('\nlink reopened: %s' % json.dumps(got))
    if bad:
        problems.append('link did not restore %s (got %s)' % (bad, json.dumps(got)))
    cs = out2['canvas']
    if cs['gcShown'] != 'block' or cs['gcW'] != cs['w'] or cs['gcH'] != cs['h']:
        problems.append('link reopened with the ground canvas %s %sx%s under main %sx%s'
                        % (cs['gcShown'], cs['gcW'], cs['gcH'], cs['w'], cs['h']))
    if not (0.05 < cs['clearFrac'] < 0.99):
        problems.append('link reopened with the tile canvas %s transparent'
                        % cs['clearFrac'])
    print('canvas: main %sx%s ground %s %sx%s, tile canvas %.3f transparent'
          % (cs['w'], cs['h'], cs['gcShown'], cs['gcW'], cs['gcH'], cs['clearFrac']))

    if problems:
        print('\nPROBLEMS:')
        for pr in problems:
            print('  ' + pr)
        return 1

    # Negative pass: a ground painted the ink's own colour must be turned down, or
    # the legibility gates are decoration.
    neg = run(url + '#bad=1&tab=gen&mode=single')
    if neg is None:
        print('FAIL: the negative pass produced no output')
        return 1
    if not neg['problems']:
        print('FAIL: camouflage gate asleep - a ground given the ink\'s own colour passed anyway')
        return 1
    print('negative pass: a ground given the ink\'s own colour was turned down '
          '(%d field%s, e.g. %s)' % (len(neg['problems']),
                                     '' if len(neg['problems']) == 1 else 's',
                                     neg['problems'][0]))

    print('\nGROUND QA PASSED')
    return 0


if __name__ == '__main__':
    sys.exit(main())
