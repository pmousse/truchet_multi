"""
Which palette % / scrim % should ship as the default?

Not a gate - a decision aid. The ground gate judges whatever the app's DEFAULTS say (it
reads them from the app rather than carrying a copy of its own), so this runs the same
measurement over candidate pairs, for all ten fields, on the real page, and prints what
each pair costs: how much colour is left in the ground, and how far the ground stays
from the ink. Pick a pair, write it into DEFAULTS in src/app.js and src/shaders.js, and
the gate then holds that choice to the same standard.

  python dev/_defaults.py "45/45 55/45 60/40 65/35 70/30"
"""
import io, os, re, subprocess, sys, json, html

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEV = os.path.join(ROOT, 'dev')
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

CANDIDATES = (sys.argv[1] if len(sys.argv) > 1
              else "45/45 55/45 60/40 65/35 70/30").split()


def page(mode_script):
    """index.html moved into dev/, with the probe and the sweep bolted on - the same
    arrangement _groundqa.py uses, so the sweep measures the real page."""
    src = io.open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
    src = src.replace('href="src/style.css"', 'href="../src/style.css"')
    for f in ('engine', 'shaders', 'app', 'photo', 'fill'):
        src = src.replace('<script src="src/%s.js"></script>' % f,
                          '<script src="../src/%s.js"></script>' % f)
    src = src.replace('<script src="../src/fill.js"></script>',
                      '<script src="../src/fill.js"></script>\n'
                      '<script src="_groundprobe.js"></script>\n' + mode_script)
    path = os.path.join(DEV, '_defaultspage.html')
    io.open(path, 'w', encoding='utf-8').write(src)
    return path


RUNNER = """<script>
window.addEventListener('load', function(){
  var o = document.createElement('pre'); o.id = 'groundout';
  var out = [];
  try {
    %s.forEach(function(p){
      var mix = +p.split('/')[0], scrim = +p.split('/')[1];
      /* The probe reads the opening defaults from the app, which is the point: a gate
       * with its own copy of the defaults measures itself instead of the product. */
      window.TruchetApp.DEFAULTS.shMix = mix;
      window.TruchetApp.DEFAULTS.scrim = scrim;
      var r = window.GROUNDQA('fields');
      out.push({ pair: p,
        rows: r.rows.filter(x => x.key.indexOf('app:') !== 0),
        problems: r.problems.filter(x => !/app check|export over|share link/.test(x)) });
    });
    o.textContent = JSON.stringify(out);
  } catch (e) { o.textContent = JSON.stringify({ fatal: String(e && e.stack || e) }); }
  document.body.appendChild(o);
});</script>"""


def run(url, budget):
    dom = subprocess.run(
        [CHROME, '--headless=new', '--no-sandbox', '--hide-scroll-bars',
         '--hide-scrollbars', '--force-device-scale-factor=1',
         '--window-size=1730,1010', '--enable-unsafe-swiftshader',
         '--virtual-time-budget=%d' % budget, '--dump-dom', url],
        capture_output=True, timeout=1800).stdout.decode('utf-8', 'replace')
    m = re.search(r'<pre id="groundout">(.*?)</pre>', dom, re.S)
    if not m:
        return None
    return json.loads(html.unescape(m.group(1)))


def main():
    p = page(RUNNER % json.dumps(CANDIDATES))
    url = 'file:///' + p.replace(os.sep, '/')
    data = run(url, 60000 * len(CANDIDATES))
    os.unlink(p)
    if data is None:
        print('the sweep produced no result')
        return 1
    if isinstance(data, dict) and data.get('fatal'):
        print('FATAL:', data['fatal'][:600])
        return 1
    print('%-14s %9s %8s %8s %8s   colour left in the ground, field by field'
          % ('palette/scrim', 'spread', 'nearest', 'inknear', 'inkgap'))
    worst = 1e9
    for d in data:
        rows = d['rows']
        rejected = [r['key'] for r in rows if r.get('verdict') == 'FAIL']
        print('%-14s %9.1f %8.0f %8.1f %8.1f   %s%s'
              % (d['pair'],
                 sum(r['defSpread'] for r in rows) / len(rows),
                 min(r.get('inkMin', 0) for r in rows),
                 max(r.get('inkNearPct', 0) for r in rows),
                 min(r.get('inkGap5', 0) for r in rows),
                 ' '.join('%.0f' % r['defSpread'] for r in rows),
                 ('   refused: ' + ','.join(rejected)) if rejected else ''))
        worst = min(worst, min(r.get('inkGap5', 0) for r in rows))
    for d in data:
        for pr in d['problems']:
            print('%s PROBLEM: %s' % (d['pair'], pr[:220]))
    return 0


if __name__ == '__main__':
    sys.exit(main())
