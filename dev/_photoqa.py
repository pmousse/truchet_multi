#!/usr/bin/env python3
"""QA for the Photo tab.

Builds a page out of the SHIPPED index.html (so the harness can never drift from
the real markup), appends dev/photoharness.js, runs it in headless Chrome, then
gates what the app reports:

  * the quadtree audit: no duplicate tiles, sizes are powers of two tied to
    depth, nothing outside the frame, depth levels contiguous, and -- the point
    of the whole frame feature -- the tiles cover the frame area exactly;
  * determinism: the same parameters build the same tiling;
  * the tile budget is respected;
  * tone fidelity: correlation between the coverage each tile achieves and the
    coverage the image asks for;
  * MOTIF_INK predicts what the renderer actually paints (checked in-browser
    against the engine's own fill);
  * the Generator/Photo tab switch round-trips to the same photo tiling.

The preview PNG is written next to the report so a human can look at it too.
"""
import io
import os
import re
import subprocess
import sys
import base64

# Chrome's dump contains box-drawing and dash characters; the default Windows
# console codec cannot represent them.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
GEN_PAGE = os.path.join(ROOT, "dev", "_photopage.html")
OUT_DIR = os.path.join(ROOT, "dev", "browse")

GATES = {
    "max_mean_err": 0.13,
    "min_corr": 0.85,
    "max_coverage_rel_err": 1e-6,
    "max_ink_mismatch": 0,
}


def build_page():
    html = io.open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
    # The harness wants a deterministic setup, so fix the hash before boot.
    # A shared link opens the Photo tab through the hash, so the harness sets the
    # hash the same way - before any of the app scripts run.
    hash_script = ('<script>location.hash = "#tb=photo&F=1:1&rs=1024&n=2&p=bw'
                   '&sd=harness&pd=2&m=mix";</script>')
    html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">' + hash_script, 1)
    html = html.replace('href="src/style.css"', 'href="../src/style.css"')
    html = html.replace('src="src/engine.js"', 'src="../src/engine.js"')
    html = html.replace('src="src/app.js"', 'src="../src/app.js"')
    html = html.replace('src="src/photo.js"', 'src="../src/photo.js"')
    # The harness reports into <pre id="out">, parked off-screen so it does not
    # cover the canvas in the screenshot taken from the same page.
    html = html.replace('</body>',
        '<pre id="out" style="position:fixed;left:-12000px;top:0;width:11000px'
        ';white-space:pre-wrap"></pre>\n'
        '<script src="photoharness.js"></script>\n</body>')
    assert 'href="../src/style.css"' in html and "photoharness.js" in html
    assert 'location.hash = "#tb=photo' in html, "hash injection failed"
    assert '<pre id="out"' in html
    io.open(GEN_PAGE, "w", encoding="utf-8", newline="\n").write(html)
    return GEN_PAGE


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
    print(body.rstrip())

    fails = []

    def gate(ok, msg):
        print(("  PASS  " if ok else "  FAIL  ") + msg)
        if not ok:
            fails.append(msg)

    if "PROBLEMS" in body or re.search(r"quadtree audit: (?!clean)", body):
        line = [l for l in body.splitlines() if l.startswith("quadtree audit")][0]
        gate(False, "quadtree audit clean  <-- " + line)
    else:
        gate(True, "quadtree audit clean (no duplicates, depths contiguous, "
                   "sizes match depth, nothing outside the frame)")

    m = re.search(r"coverage: ([\d.]+) of frame (\d+)", body)
    if m:
        area, frame = float(m.group(1)), int(m.group(2))
        rel = abs(area - frame) / frame
        gate(rel <= GATES["max_coverage_rel_err"],
             "tiling covers the frame exactly (%.6f / %d)" % (area, frame))

    gate("determinism: PASS" in body, "same parameters build the same tiling")
    gate("tab switch gen<->photo round trip: PASS" in body,
         "Generator <-> Photo tab switch is lossless")

    m = re.search(r"tiles: (\d+) \(second build (\d+), budget (\d+)\)", body)
    if m:
        n = int(m.group(1))
        gate(n <= int(m.group(3)), "tile count %d within budget %s" % (n, m.group(3)))

    m = re.search(r"meanErr ([\d.]+) worstErr ([\d.]+) correlation ([\d.]+)", body)
    if m:
        mean_err, worst_err, corr = (float(m.group(i)) for i in (1, 2, 3))
        gate(mean_err <= GATES["max_mean_err"],
             "mean tone error %.4f <= %.2f" % (mean_err, GATES["max_mean_err"]))
        gate(corr >= GATES["min_corr"],
             "tone correlation %.4f >= %.2f" % (corr, GATES["min_corr"]))

    m = re.search(r"MOTIF_INK mismatches: (\d+)", body)
    if m:
        gate(int(m.group(1)) <= GATES["max_ink_mismatch"],
             "MOTIF_INK matches the renderer on all 24 tiles (%d mismatch)"
             % int(m.group(1)))

    if png_part.strip():
        b64 = re.sub(r"\s+", "", png_part).split("<")[0]
        png = os.path.join(OUT_DIR, "photo_harness.png")
        with open(png, "wb") as fh:
            fh.write(base64.b64decode(b64))
        print("  saved preview -> " + png)

    # Console noise from the page itself is a real signal, not incidental.
    real_errors = [l for l in stderr.splitlines()
                   if "CONSOLE" in l and "Uncaught" in l]
    gate(not real_errors, "no uncaught errors in the page")
    for l in real_errors[:4]:
        print("    " + l)

    print("\nPHOTO QA " + ("PASSED" if not fails else "FAILED: " + "; ".join(fails)))
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
