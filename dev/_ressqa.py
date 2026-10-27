#!/usr/bin/env python3
"""Regression gate for the black-stage bug: every long-edge preset, on every
frame format, on every tab, driven through the page's own controls.

Passes only if no combination leaves the canvas with a zero-height backing
store or a NaN frame - the failure mode that drew nothing and logged nothing.
Run:  python dev/_ressqa.py
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
                      '<script src="_resspike.js"></script>\n'
                      '<script>window.addEventListener("load",function(){'
                      'var o=document.createElement("pre");'
                      'o.id="spikeout";'
                      'o.textContent=JSON.stringify(window.SPIKE(),null,1);'
                      'document.body.appendChild(o);});</script>')
    path = os.path.join(DEV, '_resspike.html')
    io.open(path, 'w', encoding='utf-8').write(src)
    return path


def main():
    page = harness()
    dom = subprocess.run(
        [CHROME, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
         '--force-device-scale-factor=1', '--window-size=1730,1010',
         '--virtual-time-budget=30000', '--dump-dom', 'file:///' + Path(page).as_posix()],
        capture_output=True).stdout.decode('utf-8', 'replace')
    m = re.search(r'<pre id="spikeout">(.*?)</pre>', dom, re.S)
    if not m:
        print('FAIL: probe produced no output (page scripts may not have loaded)')
        return 1
    out = json.loads(m.group(1).replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>'))
    if 'fatal' in out:
        print('FAIL: probe threw:', out['fatal'])
        return 1
    rows, problems = out['rows'], out['problems']
    bad = [r for r in rows
           if r.get('verdict') != 'ok'
           or 'NaN' in str(r.get('framePx', ''))
           or 'NaN' in str(r.get('resState', ''))]
    tabs = len({r['tab'] for r in rows})
    print('%d combinations across %d tabs' % (len(rows), tabs))
    if problems:
        print('page errors:', problems)
    for r in bad[:10]:
        print('  BROKEN %s %s @ %s: state res=%s frame=%s canvas=%s -> %s' % (
            r['tab'], r['fmt'], r['res'], r.get('resState'), r.get('framePx'),
            r.get('canvasAttr'), r.get('verdict') or r.get('step_failed')))
    print('broken: %d' % len(bad))
    ok = not bad and not problems
    print('\nRES QA %s' % ('PASSED' if ok else 'FAILED'))
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
