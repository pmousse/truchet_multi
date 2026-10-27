#!/usr/bin/env python3
"""What a shape actually does inside a non-square frame.

The Fill tab offers 'whole shape inside the frame' and 'shape fills the frame
(cropped)'. Those words make a promise about aspect ratio, and an aspect promise
is exactly the kind of thing a square test frame hides. This prints the numbers:
the lattice, the bounding box of the tiles that were built, and how far that box
extends past the frame, for each fit on a wide and a tall frame.
"""
import io
import json
import os
import re
import subprocess
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PAGE = os.path.join(ROOT, "dev", "_fillaspect.html")

PROBE = """<script>setTimeout(function(){
var app=window.TruchetApp,fl=app.hooks.fill,out=document.getElementById('out');
if(!fl){out.textContent='NONE';return;}
var rep=[];
function snap(tag){
  var L=app.lattice(),ts=app.buildTiling();
  var x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
  ts.forEach(function(t){x0=Math.min(x0,t.x);y0=Math.min(y0,t.y);
    x1=Math.max(x1,t.x+t.s);y1=Math.max(y1,t.y+t.s);});
  var a=fl.audit(L);
  rep.push(tag+' lattice '+L.cols+'x'+L.rows+' tiles '+ts.length+
    ' bbox '+x0.toFixed(3)+'..'+x1.toFixed(3)+' by '+y0.toFixed(3)+'..'+y1.toFixed(3)+
    ' painted '+(1-a.missedFrac).toFixed(4)+' spill '+a.spillFrac.toFixed(4));
}
var st=app.state();
['contain','cover'].forEach(function(fit){
  fl.state().fit=fit; fl.state().tiles=null; app.onChange();
  snap('fit='+fit+' frame '+st.format);
});
out.textContent=rep.join('\\n');
},700);</script>"""


def build(frame, asks):
    html = io.open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
    h = "#tb=fill&F=%s&rs=1280&n=2&p=bw&sd=aspect&pd=2&%s" % (
        frame.replace(":", "%3A"), "&".join("%s=%s" % kv for kv in asks.items()))
    html = html.replace('<meta charset="utf-8">',
                        '<meta charset="utf-8"><script>location.hash = "%s";</script>' % h, 1)
    html = html.replace('href="src/style.css"', 'href="../src/style.css"')
    for f in ("engine.js", "app.js", "photo.js", "fill.js"):
        html = html.replace('src="src/%s"' % f, 'src="../src/%s"' % f)
    html = html.replace('</body>',
                        '<pre id="out" style="position:fixed;left:-12000px"></pre>\n'
                        + PROBE + '\n</body>')
    io.open(PAGE, "w", encoding="utf-8", newline="\n").write(html)
    return PAGE


def dom(page):
    cmd = [CHROME, "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
           "--force-device-scale-factor=1", "--window-size=1280,760",
           "--virtual-time-budget=9000", "--dump-dom", "file:///" + page.replace("\\", "/")]
    d = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    m = re.search(r"<pre id=\"out\"[^>]*>(.*?)</pre>", d.stdout or "", re.S)
    return (m.group(1).strip() if m else "(no output)")


def main():
    for frame in ("16:9", "9:16", "1:1"):
        for shape in ("circle", "star"):
            page = build(frame, {"fsh": shape, "fdp": 4, "fdi": 2, "fft": "contain"})
            text = dom(page)
            print("frame %s  shape %s" % (frame, shape))
            for line in text.splitlines():
                print("   " + line)
            try:
                json.loads("{}")
            except Exception:
                pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
