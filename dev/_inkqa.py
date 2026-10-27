#!/usr/bin/env python3
"""Verify (and, if needed, reprint) the engine's measured MOTIF_INK table.

MOTIF_INK is the fraction of a tile's own square the engine paints dark at even
depth over a light ground; the inverted coverage the Photo tab relies on is then
1 - ink. The Photo tab chooses motifs by these numbers, so they have to describe
what THIS engine actually composites rather than a model of it.

dev/inktest.html measures it in a real browser canvas: one tile rendered alone at
240x240, counting pixels inside the tile square (fitTransform fits a tile
including its wings, so counting the whole canvas understates everything). The
same harness renders each motif on a grey ground and counts what changed, which
measures how much of the square the tile paints at all - 0.98 to 0.99 for
Carlson's 24, whose circuits leave the corners alone - and it measures the
inverted tile's dark fraction directly. Both are gated here:

  ink + inverted == cover     the two colour classes partition the area the tile
                              actually paints, circuit against circuit
  cover close to 1            a tile leaves almost nothing of what is below it,
                              which is why per-tile tone works

  python dev/_inkqa.py            compare the table in src/engine.js with the
                                  measurement and report
  python dev/_inkqa.py --literal  also print a ready-to-paste JS literal
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
TOLERANCE = 0.006     # measurement counts 240x240 device pixels
COVER_TOLERANCE = 0.02


# Accepts either style of JS object body: quoted keys (possibly escaped) or
# bare identifier keys, one or several entries per line.
ENTRY = re.compile(
    r"""(?:'([^']+)'|"((?:[^"\\]|\\.)*)"|([A-Za-z_][A-Za-z0-9_]*))\s*:\s*([0-9.]+)""")


def parse_entries(body):
    out = {}
    for q_single, q_double, bare, value in ENTRY.findall(body):
        if q_single:
            key = unescape_js(q_single)
        elif q_double:
            key = unescape_js(q_double)
        else:
            key = bare
        out[key] = float(value)
    return out


def unescape_js(text):
    # Both JS quote styles escape a backslash as two backslashes and the quote
    # itself with a backslash. The tile named after a backslash depends on this.
    return text.replace("\\\\", "\x00").replace('\\"', '"').replace("'", "'") \
        .replace("\x00", "\\")


def measure():
    url = "file:///" + os.path.join(ROOT, "dev", "inktest.html").replace("\\", "/")
    cmd = [CHROME, "--headless=new", "--disable-gpu", "--no-sandbox",
           "--hide-scrollbars", "--window-size=900,1200",
           "--virtual-time-budget=8000", "--dump-dom", url]
    done = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                          errors="replace")
    dom = done.stdout or ""
    m = re.search(r"<pre id=\"out\"[^>]*>(.*?)</pre>", dom, re.S)
    if not m:
        print("no output from dev/inktest.html")
        print((done.stderr or "")[:1500])
        return None, None
    text = (m.group(1).replace("&lt;", "<").replace("&gt;", ">")
            .replace("&amp;", "&").replace("&quot;", '"'))
    body, _, rest = text.partition("INK_TABLE_START")
    print(body.rstrip())
    tables = {}
    for label in ("MOTIF_INK", "MOTIF_INK_ODD", "MOTIF_COVER", "MOTIF_COVER_ODD"):
        m = re.search(r"const " + label + r" = \{(.*?)\};", rest, re.S)
        if not m:
            print("measured table not found: " + label)
            return None
        tables[label] = parse_entries(m.group(1))
    return tables


def engine_table(name="MOTIF_INK"):
    src = io.open(os.path.join(ROOT, "src", "engine.js"), encoding="utf-8").read()
    m = re.search(r"const " + name + r" = \{(.*?)\};", src, re.S)
    return parse_entries(m.group(1)) if m else None


def compare(label, measured, table, fails):
    print("\n== %s in src/engine.js vs the renderer ==" % label)
    if table is None:
        fails.append("src/engine.js has no " + label + " table")
        print("  table absent")
        return
    for name, m in measured.items():
        t = table.get(name)
        if t is None:
            fails.append("%s missing from the table: %s" % (label, name))
            print("  %-5s measured %.4f   MISSING" % (name, m))
        elif abs(t - m) > TOLERANCE:
            fails.append("%s %s" % (label, name))
            print("  %-5s measured %.4f  table %.4f   off by %.4f"
                  % (name, m, t, abs(t - m)))
    for name in table:
        if name not in measured:
            fails.append("%s listed for a tile the harness does not measure: %s"
                         % (label, name))


def main():
    measured = measure()
    if not measured:
        return 1
    ink_m, inv_m, cover_m = (measured["MOTIF_INK"], measured["MOTIF_INK_ODD"],
                             measured["MOTIF_COVER"])
    table = engine_table()
    if table is None:
        print("src/engine.js has no MOTIF_INK table")
        return 1

    fails = []
    compare("MOTIF_INK", ink_m, table, fails)

    print("\n== the identities the Photo tab's tone model rests on ==")
    worst_gap = 0.0
    for name in ink_m:
        s = ink_m[name] + inv_m[name]
        c = cover_m[name]
        worst_gap = max(worst_gap, 1 - c)
        if abs(s - c) > TOLERANCE:
            fails.append("ink + inverted != cover for %s (%.4f vs %.4f)" % (name, s, c))
            print("  %-5s ink %.4f + inverted %.4f = %.4f, cover %.4f"
                  % (name, ink_m[name], inv_m[name], s, c))
        if c < 1 - COVER_TOLERANCE:
            fails.append("tile leaves too much of what is below it: %s (cover %.4f)"
                         % (name, c))
            print("  %-5s covers only %.4f of its square" % (name, c))
    if not fails:
        print("  ink + inverted == cover for all %d motifs" % len(ink_m))
        print("  every tile repaints at least %.1f%% of its square" %
              (100 * (1 - worst_gap)))

    print("\nmeasured motifs: %d   mismatches: %d" % (len(ink_m), len(fails)))
    for f in fails:
        print("  " + f)

    if "--literal" in sys.argv:
        print("\nready to paste into src/engine.js:")
        print("  const MOTIF_INK = {")
        for name in ink_m:
            print("    %s: %s," % (json.dumps(name), ink_m[name]))
        print("  };")

    print("\nINK QA " + ("PASSED" if not fails else "FAILED"))
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
