"""_tilesqa.py -- verify the browser-rendered tiles against the Python oracle.

1. parses dev/browse/capture_dom.txt (chrome --dump-dom of dev/capture.html)
2. decodes the 256px-per-tile sheet (fitTransform pad 0) saved by the live engine
3. renders the same motif with the same mapping in Python (dev/port.py) - the
   circuit fills the engine composites
4. compares pixel-by-pixel, reporting deep-interior violations (holes/slits)

The sheet holds every name in engine TILE_NAMES, six per row, so its row count -
and this comparison - follows the tile count rather than a fixed grid.

The dump is captured by this script when it is missing, so a fresh clone can run
it as-is. Force a fresh capture with --recapture.

Usage: python dev/_tilesqa.py [--recapture] [name1 name2 ...]
"""
import sys, re, base64, json, os, subprocess
from pathlib import Path
sys.path.insert(0, 'dev')
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
import port
from port import Canvas
from zoom import read_png, write_png

TAB = chr(9)

CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
DUMP = 'dev/browse/capture_dom.txt'


def capture_dump():
    """Dump dev/capture.html from the browser, so the gate needs no hand-run step.

    Two traps this avoids: a relative path silently produces an empty dump, and
    text=True makes Python decode the dump as cp1252 - the page contains bytes
    that codec cannot map, and the reader thread dies with no output at all.
    """
    if not Path(CHROME).exists():
        sys.exit('FATAL: Chrome not found at ' + CHROME)
    page = Path('dev/capture.html').resolve().as_uri()
    done = subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--no-sandbox',
                           '--hide-scrollbars', '--force-device-scale-factor=1',
                           '--window-size=1400,900', '--virtual-time-budget=9000',
                           '--dump-dom', page], capture_output=True)
    os.makedirs('dev/browse', exist_ok=True)
    open(DUMP, 'wb').write(done.stdout)
    print('captured %s (%d bytes from chrome --dump-dom)' % (DUMP, len(done.stdout)))


def parse_dom(path=DUMP):
    dom = open(path, encoding='utf-8-sig').read()
    entries = {}
    for line in dom.split('\n'):
        line = line.strip()
        if TAB not in line:
            continue
        name, b64 = line.split(TAB, 1)
        if '<pre id=' in name:
            name = name.split('>')[-1]
        b64 = ''.join(b64.split()).split('<')[0]
        if re.fullmatch(r'[A-Za-z0-9+/]+={0,3}', b64):
            entries[name] = b64
    return entries


def save_b64(entries, name, path):
    open(path, 'wb').write(base64.b64decode(entries[name]))


def fit_single(S, pad=0.0):
    """Exact replica of engine.fitTransform for one unit tile (x=0,y=0,s=1)."""
    m = 1 / 3 + 0.02
    minX = minY = -m - (1 + 2 * m) * pad
    maxX = maxY = 1 + m + (1 + 2 * m) * pad
    bw = bh = maxX - minX
    sc = min(S / bw, S / bh)
    offX = (S - bw * sc) / 2 - minX * sc
    offY = (S + bh * sc) / 2 + minY * sc
    return sc, offX, offY


def main():
    args = [a for a in sys.argv[1:] if a != '--recapture']
    if '--recapture' in sys.argv or not Path(DUMP).exists():
        capture_dump()
    only = args
    entries = parse_dom()
    print(f'{len(entries)} canvas entries')
    if 'sheet256' not in entries:
        sys.exit('FATAL: sheet256 missing in dump')
    save_b64(entries, 'sheet256', 'dev/browse/sheet256.png')
    W, H, px = read_png('dev/browse/sheet256.png')
    S, cols = 256, 6
    rows = H // S
    print(f'sheet {W}x{H}, grid {cols}x{rows}')

    names = json.loads(subprocess.check_output(
        ['node', '-e', 'console.log(JSON.stringify(require("./src/engine.js").TILE_NAMES))'],
        cwd='.').decode())
    # the capture page lays names out six per row and rounds the sheet up, so the
    # last row can be part-blank; the comparison walks names, not cells, so only
    # the sheet's capacity is checked here
    assert len(names) <= cols * rows, (len(names), cols * rows)

    sc, offX, offY = fit_single(S)

    def screen(p):
        return (offX + p[0] * sc, offY - p[1] * sc)

    def lum(i):
        return (px[i] + px[i + 1] + px[i + 2]) // 3

    report = []
    for k, name in enumerate(names):
        if only and name not in only:
            continue
        cx0, cy0 = (k % cols) * S, (k // cols) * S
        ch = []
        for y in range(S):
            base = ((cy0 + y) * W + cx0) * 3
            ch.append([1 if lum(base + x * 3) < 140 else 0 for x in range(S)])

        # the oracle paints the motif the way the engine does, by circuit fills
        cv = Canvas(S, S, (255, 255, 255))
        port.paint_motif(cv, name, screen, sc)
        py = [[1 if cv.px[(y * S + x) * 3] < 128 else 0 for x in range(S)]
              for y in range(S)]

        def core(mat, x, y, want, r=2):
            for dy in range(-r, r + 1):
                for dx in range(-r, r + 1):
                    xx, yy = x + dx, y + dy
                    if not (0 <= xx < S and 0 <= yy < S):
                        return False
                    if mat[yy][xx] != want:
                        return False
            return True

        holes = extra = mism = 0
        for y in range(1, S - 1):
            for x in range(1, S - 1):
                if py[y][x] != ch[y][x]:
                    mism += 1
                    if py[y][x] == 1 and core(py, x, y, 1) and lum(((cy0 + y) * W + cx0 + x) * 3) > 240:
                        holes += 1
                    if py[y][x] == 0 and core(py, x, y, 0) and lum(((cy0 + y) * W + cx0 + x) * 3) < 60:
                        extra += 1
        report.append((name, mism, holes, extra))

    print(f'{"name":6s} {"mism":>5s} {"holes":>6s} {"extra":>6s}')
    for name, mism, holes, extra in report:
        flag = '  <-- BAD' if (holes or extra) else ''
        print(f'{name:6s} {mism:5d} {holes:6d} {extra:6d}{flag}')
    print('TOTAL mismatches %d  deep holes %d  deep extra %d' % (
        sum(r[1] for r in report), sum(r[2] for r in report), sum(r[3] for r in report)))

    # side-by-side rows (ours / oracle) for visual QA
    for r0 in range(rows):
        out = bytearray(cols * S * S * 3)
        for y in range(S):
            src = ((r0 * S + y) * W) * 3
            out[y * cols * S * 3:(y + 1) * cols * S * 3] = px[src:src + cols * S * 3]
        write_png(f'dev/browse/row{r0}.png', cols * S, S, bytes(out))
    print('row sheets dev/browse/row0..%d.png written' % (rows - 1))


if __name__ == '__main__':
    main()
