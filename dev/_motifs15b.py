"""_motifs15.py — identify which of our 24 tiles appear in Carlson's motifs.png,
in his grid order.

Method: cluster Carlson's ink into 15 cells.  For each candidate (name,
rotation) fit the tile square size/origin from the ink bounding box (known
exactly from the oracle geometry), then score the overlap between his cell and
the oracle render in that fitted window.  Report the best name per cell.

Usage: python dev/_motifs15.py [image.png] [cols] [rows]
"""
import sys
sys.path.insert(0, 'dev')
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
import port
from port import Canvas
from zoom import read_png

img = sys.argv[1] if len(sys.argv) > 1 else 'dev/carlson_motifs.png'
NCOL = int(sys.argv[2]) if len(sys.argv) > 2 else 5
NROW = int(sys.argv[3]) if len(sys.argv) > 3 else 3
W0, H0, px = read_png(img)
print(img, W0, H0)


def lum(x, y):
    i = (y * W0 + x) * 3
    return (px[i] + px[i + 1] + px[i + 2]) // 3


dark = [[1 if lum(x, y) < 128 else 0 for x in range(W0)] for y in range(H0)]
ink = [row[:] for row in dark]

# connected components -> groups -> cells
comps = []
for y in range(H0):
    for x in range(W0):
        if not dark[y][x]:
            continue
        st = [(x, y)]; dark[y][x] = 0
        b = [x, y, x, y, 0]
        while st:
            cx, cy = st.pop()
            b[4] += 1
            b[0] = min(b[0], cx); b[1] = min(b[1], cy)
            b[2] = max(b[2], cx); b[3] = max(b[3], cy)
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    nx, ny = cx + dx, cy + dy
                    if 0 <= nx < W0 and 0 <= ny < H0 and dark[ny][nx]:
                        dark[ny][nx] = 0
                        st.append((nx, ny))
        if b[4] >= 40:
            comps.append(b)
print('ink components:', len(comps))


def near(a, b, tol=25):
    return not (b[0] > a[2] + tol or b[2] < a[0] - tol or
                b[1] > a[3] + tol or b[3] < a[1] - tol)


groups = [[c] for c in comps]
changed = True
while changed:
    changed = False
    out = []
    for g in groups:
        hit = None
        for o in out:
            if any(near(c, d) for c in g for d in o):
                hit = o; break
        if hit:
            hit.extend(g); changed = True
        else:
            out.append(g)
    groups = out
cells = []
for g in groups:
    x0 = min(c[0] for c in g); x1 = max(c[2] for c in g)
    y0 = min(c[1] for c in g); y1 = max(c[3] for c in g)
    area = sum(c[4] for c in g)
    if x1 - x0 < 75 and y1 - y0 < 75:
        cells.append((x0, y0, x1, y1, area))
cells.sort(key=lambda c: (c[1] // 45, c[0]))
print('cells found:', len(cells))

# ---------- oracle: big render per name/rotation ----------
LO, HI = -0.5, 1.5                      # world window of the big render
R = 800
SC = R / (HI - LO)


def rot_pt(x, y, r):
    if r == 1: return (1 - y, x)
    if r == 2: return (1 - x, 1 - y)
    if r == 3: return (y, 1 - x)
    return (x, y)


def oracle(name, rot):
    cv = Canvas(R, R, (255, 255, 255))
    white, black = port.tile_circuits(name)
    for circ in black:
        pts = [(rot_pt(x, y, rot)) for x, y in port.arc_circuit_polygon(2, circ)]
        cv.fill_poly([((x - LO) * SC, (HI - y) * SC) for x, y in pts],
                     (0, 0, 0), rule='nonzero')
    xs = []; ys = []; n = 0
    for j in range(R):
        base = j * R * 3
        for i in range(R):
            if cv.px[base + i * 3] < 128:
                xs.append(i); ys.append(j); n += 1
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    return dict(cv=cv,
                wx0=(x0 / SC) + LO, wx1=(x1 / SC) + LO,
                wy0=HI - (y1 / SC), wy1=HI - (y0 / SC),
                area=n)


ORA = {(n, r): oracle(n, r) for n in port.TILE_ORDER for r in range(4)}

S = 48


def cell_score(c, name, rot):
    o = ORA[(name, rot)]
    bw = c[2] - c[0] + 1.0; bh = c[3] - c[1] + 1.0
    # oracle bbox expressed in square-relative coords with y pointing DOWN
    ow = o['wx1'] - o['wx0']
    oh = o['wy1'] - o['wy0']
    oy0 = 1 - o['wy1']          # top edge offset
    cands = [bw / ow, bh / oh, (bw / ow + bh / oh) / 2]
    best = (0.0, None)
    for side in cands:
        if not (15 <= side <= 90):
            continue
        for fitx in (c[0] - o['wx0'] * side, c[2] + 1 - o['wx1'] * side):
            for fity in (c[1] - oy0 * side, c[3] + 1 - (1 - o['wy0']) * side):
                span = 4 * side / 3.0 + side / 3.0
                inter = un = 0
                for sy in range(S):
                    iy = fity - side / 3.0 + (sy + 0.5) * span / S
                    yworld = 1 - (iy - fity) / side
                    oy = int((HI - yworld) * SC)
                    iy_i = int(round(iy))
                    if oy < 0 or oy >= R:
                        continue
                    for sx in range(S):
                        ix = fitx - side / 3.0 + (sx + 0.5) * span / S
                        xworld = (ix - fitx) / side
                        ox = int((xworld - LO) * SC)
                        if ox < 0 or ox >= R:
                            continue
                        a = 1 if o['cv'].px[(oy * R + ox) * 3] < 128 else 0
                        ii = int(round(ix))
                        b = 1 if (0 <= ii < W0 and 0 <= iy_i < H0 and ink[iy_i][ii]) else 0
                        if a and b: inter += 1
                        if a or b: un += 1
                sc = inter / max(1, un)
                if sc > best[0]:
                    best = (sc, (side, fitx, fity))
    return best


print()
print('pos  name   rot     IoU   fitted square (side @ origin)')
picked = []
for row in range(NROW):
    for col in range(NCOL):
        if row * NCOL + col >= len(cells):
            break
        c = cells[row * NCOL + col]
        best = max(((cell_score(c, n, r), n, r) for n in port.TILE_ORDER
                    for r in range(4)), key=lambda t: t[0][0])
        (sc, fit), n, r = best
        picked.append((n, r))
        print(f'{len(picked)-1:3d}  {n:5s} {r*90:4d}deg  {sc:5.3f}   '
              f'side={fit[0]:.1f} origin=({fit[1]:.1f},{fit[2]:.1f})  cell bbox {c[:4]}')

names = [n for n, _ in picked]
uniq = sorted(set(names), key=names.index)
print()
print('distinct:', len(uniq), uniq)
print('not in his grid:', [n for n in port.TILE_ORDER if n not in names])
