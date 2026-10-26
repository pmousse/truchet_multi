"""_tilesqa.py -- verify the browser-rendered 24 tiles against the Python oracle.

1. parses dev/browse/capture_dom.txt (chrome --dump-dom of dev/capture.html)
2. decodes the 256px-per-tile sheet (fitTransform pad 0) saved by the live engine
3. renders the same polygons with the same mapping in Python (dev/port.py)
4. compares pixel-by-pixel, reporting deep-interior violations (holes/slits)

Usage: python dev/_tilesqa.py [name1 name2 ...]
"""
import sys, re, base64, json, subprocess
sys.path.insert(0, 'dev')
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
import port
from port import Canvas
from zoom import read_png, write_png

TAB = chr(9)


def parse_dom(path='dev/browse/capture_dom.txt'):
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
    only = sys.argv[1:]
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
    assert len(names) == cols * rows, (len(names), cols * rows)

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

        white, black = port.tile_circuits(name)
        cv = Canvas(S, S, (255, 255, 255))
        for grp, col in ((white, (255, 255, 255)), (black, (0, 0, 0))):
            for circ in grp:
                pts = port.arc_circuit_polygon(2, circ)
                cv.fill_poly([screen(p) for p in pts], col, rule='nonzero')
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
