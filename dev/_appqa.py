"""_appqa.py — verify the app's motif preview grid (from a headless screenshot of
index.html) reproduces the Python oracle tiles, in grid order.

Usage: python dev/_appqa.py <screenshot.png> [x0 y0 x1 y1]
"""
import sys
sys.path.insert(0, 'dev')
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
import port
from port import Canvas
from zoom import read_png

img = sys.argv[1]
W0, H0, px = read_png(img)
X0, Y0, X1, Y1 = (int(v) for v in (sys.argv[2:6] if len(sys.argv) >= 6 else
                                   (0, 0, W0, H0)))


def lum(x, y):
    i = (y * W0 + x) * 3
    return (px[i] + px[i + 1] + px[i + 2]) // 3


# The panel background is dark and the preview cells are light, but a black
# shape inside a cell is dark too -- so flood the DARK background in from the
# region border; whatever is left unvisited belongs to a cell (its interior,
# holes included).
class Box:
    def __init__(self, x0, y0, x1, y1, n=0):
        self.x0, self.y0, self.x1, self.y1, self.n = x0, y0, x1, y1, n


RW, RH = X1 - X0, Y1 - Y0
bg = [[False] * RW for _ in range(RH)]
stack = []
for x in range(X0, X1):
    for y in (Y0, Y1 - 1):
        if lum(x, y) < 165 and not bg[y - Y0][x - X0]:
            bg[y - Y0][x - X0] = True
            stack.append((x, y))
for y in range(Y0, Y1):
    for x in (X0, X1 - 1):
        if lum(x, y) < 165 and not bg[y - Y0][x - X0]:
            bg[y - Y0][x - X0] = True
            stack.append((x, y))
while stack:
    x, y = stack.pop()
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nx, ny = x + dx, y + dy
        if X0 <= nx < X1 and Y0 <= ny < Y1 and not bg[ny - Y0][nx - X0] and lum(nx, ny) < 165:
            bg[ny - Y0][nx - X0] = True
            stack.append((nx, ny))
boxes = []
for sy in range(Y0, Y1):
    for sx in range(X0, X1):
        if bg[sy - Y0][sx - X0]:
            continue
        stack = [(sx, sy)]
        bg[sy - Y0][sx - X0] = True
        b = Box(sx, sy, sx, sy, 0)
        while stack:
            x, y = stack.pop()
            b.n += 1
            b.x0 = min(b.x0, x); b.x1 = max(b.x1, x)
            b.y0 = min(b.y0, y); b.y1 = max(b.y1, y)
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if X0 <= nx < X1 and Y0 <= ny < Y1 and not bg[ny - Y0][nx - X0]:
                    bg[ny - Y0][nx - X0] = True
                    stack.append((nx, ny))
        if b.n > 900:
            boxes.append(b)
cells = boxes
# row-major order: cluster rows by y center, then sort each row by x
rows = []
for c in sorted(cells, key=lambda c: (c.y0 + c.y1) / 2):
    cy = (c.y0 + c.y1) / 2
    for r in rows:
        if abs(r[0] - cy) < 25:
            r[1].append(c)
            r[0] = (r[0] * (len(r[1]) - 1) + cy) / len(r[1])
            break
    else:
        rows.append([cy, [c]])
cells = [c for r in rows for c in sorted(r[1], key=lambda c: c.x0)]
print(img, W0, H0, 'region', (X0, Y0, X1, Y1))
print(len(cells), 'preview cells, rows:', len(rows))
for c in cells:
    print('  cell bbox', c.x0, c.y0, c.x1, c.y1, 'area', c.n)

S = 56
M = 1 / 3 + 0.02
WORLD = 1 + 2 * M


def oracle_mask(name, pad=0.04):
    R = 420
    cv = Canvas(R, R, (255, 255, 255))
    p = WORLD * pad              # same padding the app preview uses
    W2 = WORLD + 2 * p
    sc = R / W2
    offX = (M + p) * sc
    offY = W2 * sc - (M + p) * sc
    white, black = port.tile_circuits(name)
    for grp, col in ((white, (255, 255, 255)), (black, (0, 0, 0))):
        for circ in grp:
            cv.fill_poly([(offX + x * sc, offY - y * sc) for x, y in
                          port.arc_circuit_polygon(2, circ)], col, rule='nonzero')
    out = []
    for sy in range(S):
        for sx in range(S):
            a0 = sx * R // S; a1 = (sx + 1) * R // S
            b0 = sy * R // S; b1 = (sy + 1) * R // S
            tot = n = 0
            for yy in range(b0, b1):
                for xx in range(a0, a1):
                    tot += 1 if cv.px[(yy * R + xx) * 3] < 128 else 0
                    n += 1
            out.append(1 if tot / max(n, 1) > 0.5 else 0)
    return out


def cell_mask(x0, x1, y0, y1):
    # sample the S x S grid at pixel centres (the cell is smaller than S,
    # so block-averaging would leave empty blocks)
    side = min(x1 - x0, y1 - y0) + 1
    m = []
    for sy in range(S):
        for sx in range(S):
            xx = x0 + int((sx + 0.5) * side / S)
            yy = y0 + int((sy + 0.5) * side / S)
            m.append(1 if lum(xx, yy) < 128 else 0)
    return m


oracle = {n: oracle_mask(n) for n in port.TILE_ORDER}
names = port.TILE_ORDER
bad = 0
for k, expect in enumerate(names):
    if k >= len(cells):
        print('missing cell for', expect)
        bad += 1
        continue
    c = cells[k]
    cm = cell_mask(c.x0 - 2, c.x1 + 2, c.y0 - 2, c.y1 + 2)
    scored = sorted((sum(a != b for a, b in zip(o, cm)), n)
                    for n, o in oracle.items())
    d, best = scored[0]
    pct = 100 * d / (S * S)
    if best != expect:
        bad += 1
    print(f'cell {k:2d} expect {expect:5s} got {best:5s} '
          f'mismatch={pct:4.1f}% {"OK" if best == expect else "<<< MISMATCH"}')
print('\nmismatches:', bad)
