#!/usr/bin/env python3
"""QA for the Fill tab.

Builds a page out of the SHIPPED index.html (so the harness can never drift from
the real markup), appends dev/fillharness.js, runs it in headless Chrome, then
gates what the tab reports about itself:

  * every preset shape produces a legal quadtree and actually paints the shape:
    the tab measures how much of the sampled shape ended up under a tile, and how
    much tile area fell outside the outline, against its own mask rather than
    against its own tile list;
  * a custom mask (drawn by the harness and fed through the tab's own adopt
    path) behaves the same way;
  * determinism, the tile budget, the minimum tile size in the export frame;
  * the tab frames the FRAME, not the tiles it produced - otherwise a small shape
    would be blown up to fill the canvas;
  * every control is driven through the DOM, including the two traps specific to
    number inputs (out of range, cleared mid-typing);
  * a mask never leaks into the share link, and a tab round trip keeps it.

The preview PNG is written next to the report so a human can look at it too.
"""
import io
import json
import os
import re
import subprocess
import sys
import base64

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
GEN_PAGE = os.path.join(ROOT, "dev", "_fillpage.html")
OUT_DIR = os.path.join(ROOT, "dev", "browse")

GATES = {
    "max_spill": 0.18,        # tile area lying outside the outline
    "min_painted": 0.82,      # shape area that ended up under a tile
    "min_tile_px": 3.5,       # smallest tile in the export, in device pixels
}


def build_page():
    html = io.open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
    hash_script = ('<script>location.hash = "#tb=fill&F=1:1&rs=1024&n=2&p=bw'
                   '&sd=harness&pd=2&m=mix";</script>')
    html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">' + hash_script, 1)
    html = html.replace('href="src/style.css"', 'href="../src/style.css"')
    for f in ("engine.js", "app.js", "photo.js", "fill.js"):
        html = html.replace('src="src/%s"' % f, 'src="../src/%s"' % f)
    html = html.replace('</body>',
        '<pre id="out" style="position:fixed;left:-12000px;top:0;width:11000px'
        ';white-space:pre-wrap"></pre>\n'
        '<script src="fillharness.js"></script>\n</body>')
    assert 'href="../src/style.css"' in html and "fillharness.js" in html
    assert 'location.hash = "#tb=fill' in html, "hash injection failed"
    assert 'src="../src/fill.js"' in html, "fill.js was not rewired"
    assert '<pre id="out"' in html
    io.open(GEN_PAGE, "w", encoding="utf-8", newline="\n").write(html)
    return GEN_PAGE


def build_share_page(fills, frame):
    """A page whose ONLY instruction is a share link: it must reopen the same Fill
    design by itself, with no harness driving it - which is what a person who
    pastes a link into a browser actually gets."""
    html = io.open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
    ask = "&".join("%s=%s" % (k, v) for k, v in fills.items())
    hash_script = ('<script>location.hash = "#tb=fill&F=%s&rs=1280&n=2&p=bw&sd=share&pd=2&%s";'
                   '</script>' % (frame.replace(":", "%3A"), ask))
    html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">' + hash_script, 1)
    html = html.replace('href="src/style.css"', 'href="../src/style.css"')
    for f in ("engine.js", "app.js", "photo.js", "fill.js"):
        html = html.replace('src="src/%s"' % f, 'src="../src/%s"' % f)
    probe = ("<script>setTimeout(function(){var app=window.TruchetApp,fl=app.hooks.fill;"
             "if(!fl){document.getElementById('out').textContent='SHARE none';return;}"
             "var s=fl.state();var b64='';try{b64=document.getElementById('mainCanvas')"
             ".toDataURL('image/png').split(',')[1]||'';}catch(e){}"
             "document.getElementById('out').textContent='SHARE '+JSON.stringify({"
             "tab:app.tab(),shape:s.shape,depth:s.depth,inner:s.inner,soft:s.soft,"
             "thresh:s.thresh,fit:s.fit,tiles:app.buildTiling().length,base:app.baseScale().value})"
             "+(b64?'\\nPNG|'+b64.length+'|'+b64:'');},600);</script>")
    html = html.replace('</body>',
        '<pre id="out" style="position:fixed;left:-12000px;top:0;width:11000px'
        ';white-space:pre-wrap"></pre>\n' + probe + '\n</body>')
    path = os.path.join(ROOT, "dev", "_fillshare.html")
    io.open(path, "w", encoding="utf-8", newline="\n").write(html)
    return path


def run_chrome(page):
    url = "file:///" + page.replace("\\", "/")
    cmd = [CHROME, "--headless=new", "--disable-gpu", "--no-sandbox",
           "--hide-scrollbars", "--force-device-scale-factor=1",
           "--window-size=1280,820", "--virtual-time-budget=9000",
           "--dump-dom", url]
    done = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                          errors="replace")
    dom = done.stdout or ""
    m = re.search(r"<pre id=\"out\"[^>]*>(.*?)</pre>", dom, re.S)
    if not m:
        print("no <pre id=out> in the DOM dump")
        print(dom[:2000])
        print("--- chrome stderr ---")
        print((done.stderr or "")[:2000])
        return None, ""
    text = (m.group(1).replace("&lt;", "<").replace("&gt;", ">")
            .replace("&amp;", "&").replace("&quot;", '"'))
    return text, (done.stderr or "")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    page = build_page()
    text, stderr = run_chrome(page)
    if text is None:
        return 1
    if text.startswith("HARNESS ERROR"):
        print(text[:3000])
        return 1

    body, _, png_part = text.partition("PNG|")
    body = re.sub(r"__FILL_JSON__.*", "", body)
    print(body.rstrip())

    fails = []

    def gate(ok, msg):
        print(("  PASS  " if ok else "  FAIL  ")+ msg)
        if not ok:
            fails.append(msg)

    gate("FILL_HARNESS PASSED" in body, "the harness reported no problems")
    gate(not re.search(r"^\s*FAIL:", body, re.M), "no FAIL lines in the report")

    shapes = re.findall(
        r"shape (\S+): (\d+) tiles, depths [\d/]+, painted ([\d.]+) of the shape,"
        r" spill ([\d.]+)", body)
    gate(len(shapes) >= 10, "all %d preset shapes ran" % len(shapes))
    for name, count, painted, spill in shapes:
        painted, spill, count = float(painted), float(spill), int(count)
        ok = painted >= GATES["min_painted"] and spill <= GATES["max_spill"]
        gate(ok, "shape %s: %d tiles, painted %.3f >= %.2f, spill %.3f <= %.2f"
             % (name, count, painted, GATES["min_painted"], spill, GATES["max_spill"]))

    m = re.search(r"custom mask: (\d+) tiles, painted ([\d.]+) of the shape, spill ([\d.]+)", body)
    if m:
        painted, spill = float(m.group(2)), float(m.group(3))
        gate(painted >= GATES["min_painted"] and spill <= GATES["max_spill"],
             "custom mask: %s tiles, painted %.3f, spill %.3f" % (m.group(1), painted, spill))
    else:
        gate(False, "the custom mask run is missing from the report")

    m = re.search(r"smallest tile ~([\d.]+) px", body)
    if m:
        px = float(m.group(1))
        gate(px >= GATES["min_tile_px"],
             "smallest tile %.1f px >= %.1f px in the export" % (px, GATES["min_tile_px"]))

    gate("view bounds = the frame" in body,
         "the canvas frames the frame, not the tiles it produced")
    gate("MATCHES" in body and "DIFFERS" not in body,
         "same parameters build the same tiling")
    gate("fill controls: PASS" in body,
         "every Fill control changes the picture when driven through the DOM")
    gate("tab round trip: PASS" in body,
         "gen -> photo -> fill keeps the mask and the same tiles")
    gate("no mask, no file name, no image data" in body, "a mask never enters the share link")
    gate("carries the Fill ask" in body,
         "the Fill design itself travels in the share link")
    gate("clamped to" in body and "ignored, state stays" in body,
         "number boxes clamp out-of-range values and ignore cleared boxes")

    m = re.search(r"PNG\|(\d+)\|", text)
    if m:
        n = int(m.group(1))
        b64 = re.sub(r"\s+", "", text[m.end():])[:n]
        gate(len(b64) == n, "preview data URL survived the DOM dump intact (%d chars)" % n)
        png = os.path.join(OUT_DIR, "fill_harness.png")
        with open(png, "wb") as fh:
            fh.write(base64.b64decode(b64))
        print("  saved preview -> " + png)
    else:
        gate(False, "the harness produced no preview PNG")

    # Second run: no harness, only a link. This is what a person actually gets
    # when they paste a shared Fill design into a browser.
    want = {"fsh": "star", "fdp": "3", "fdi": "1", "fso": "12", "fft": "cover"}
    share_page = build_share_page(want, "16:9")
    stext, _ = run_chrome(share_page)
    if stext and "SHARE {" in stext:
        blob = stext.split("SHARE ", 1)[1].split("\n")[0]
        try:
            got = json.loads(blob)
        except Exception as exc:
            gate(False, "the share probe reported nothing readable: %s" % exc)
            got = {}
        if got:
            checks = [("tab", "fill"), ("shape", "star"), ("depth", 3), ("inner", 1),
                      ("soft", 12.0), ("fit", "cover")]
            bad = [(k, got.get(k), v) for k, v in checks if got.get(k) != v]
            gate(not bad, "a pasted Fill link reopens the same design%s"
                 % ("" if not bad else ": " + ", ".join(
                     "%s got %r want %r" % b for b in bad)))
            gate(got.get("tiles", 0) > 0,
                 "the reopened design still produced %d tiles" % got.get("tiles", 0))
            print("    reopened: %s" % blob[:200])
        sm = re.search(r"PNG\|(\d+)\|", stext)
        if sm:
            n = int(sm.group(1))
            sb = re.sub(r"\s+", "", stext[sm.end():])[:n]
            if len(sb) == n:
                png = os.path.join(OUT_DIR, "fill_share_169.png")
                with open(png, "wb") as fh:
                    fh.write(base64.b64decode(sb))
                print("  saved reopened 16:9 preview -> " + png)
    else:
        gate(False, "the share-link run produced no report")

    gate("fill fit semantics: PASS" in body,
         "contain keeps the shape whole and square-scaling; cover fills the frame")
    cases = re.findall(r"fit (contain|cover) at (16:9|9:16) \((\d+)x(\d+)\): box "
                       r"([\d.]+)x([\d.]+) of (\d+)x(\d+), painted ([\d.]+)", body)
    gate(len(cases) == 4, "both fits were measured in a wide and a tall frame (%d cases)" % len(cases))
    for fit, frame, cols, rows, bw, bh, c2, r2, painted in cases:
        cols, rows, bw, bh = int(cols), int(rows), float(bw), float(bh)
        long_side, short_side = max(cols, rows), min(cols, rows)
        if fit == "contain":
            gate(abs(bw - bh) < 1e-4 and abs(max(bw, bh) - short_side) < 1e-4,
                 "contain at %s: %sx%s box is square and spans the short side %d" %
                 (frame, bw, bh, short_side))
        else:
            gate(abs(bw - long_side) < 1e-4 or abs(bh - long_side) < 1e-4,
                 "cover at %s: %sx%s box spans the long side %d" %
                 (frame, bw, bh, long_side))
            gate(abs(min(bw, bh) - short_side) < 1e-4,
                 "cover at %s: the frame cut the shape at the short side %d" %
                 (frame, short_side))
        gate(float(painted) >= 0.98,
             "fit %s at %s painted %s of the shape" % (fit, frame, painted))

    real_errors = [l for l in stderr.splitlines()
                   if "CONSOLE" in l and "Uncaught" in l]
    gate(not real_errors, "no uncaught errors in the page")
    for l in real_errors[:4]:
        print("    " + l)

    print("\nFILL QA " + ("PASSED" if not fails else "FAILED: " + "; ".join(fails)))
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
