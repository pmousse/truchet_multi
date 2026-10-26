"""_fillrule2.py — match Carlson's published motif cells (ref_motifs.png) against
our 24 tiles rendered with BOTH fill rules, using IoU on the black-shape mask.

If a cell's best match flips from one rule to the other, the published figure
settles the fill-rule question.
"""
import sys
sys.path.insert(0, 'dev')
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
import port
from port import Canvas
from zoom import read_png

PNG = 'ref_motifs.png'
W0, H0, px = read_png(PNG)


def lum(i):
    return (px[i] + px[i + 1] + px[i + 2]) // 3


def gray(i):
    v = lum(i)
    return 150 < v < 245


# ---- locate the 5x3 grid of gray squares ----
COLS, ROWS = 5, 3
cw, ch = W0 // COLS, H0 // ROWS
cells = []
for r in range(ROWS):
    for c in range(COLS):
        x0, y0 = c * cw, r * ch
        x1, y1 = x0 + cw, y0 + ch
        minx, miny, maxx, maxy = 10**9, 10**9, -1, -1
        for y in range(y0, y1):
            for x in range(x0, x1):
                if gray((y * W0 + x) * 3):
                    minx = min(minx, x); maxx = max(maxx, x)
                    miny = min(miny, y); maxy = max(maxy, y)
        cells.append((minx, miny, maxx, maxy))
print('cell boxes:', cells[:3], '...')

MARGIN = 1 / 3 + 0.02          # wings reach 1/3 beyond the unit square
WORLD = 1 + 2 * MARGIN         # drawing window = {-MARGIN..1+MARGIN}


def cell_mask(box):
    minx, miny, maxx, maxy = box
    w, h = maxx - minx + 1, maxy - miny + 1
    m = []
    for y in range(h):
        for x in range(w):
            m.append(1 if lum(((miny + y) * W0 + minx + x) * 3) < 100 else 0)
    return w, h, m


def render_mask(name, rule, w, h):
    cv = Canvas(w, h, (255, 255, 255))
    sc = min(w, h) / WORLD
    offX = (w - WORLD * sc) / 2 + MARGIN * sc
    offY = (h + WORLD * sc) / 2 - MARGIN * sc
    white, black = port.tile_circuits(name)
    for grp, col in ((white, (255, 255, 255)), (black, (0, 0, 0))):
        for circ in grp:
            pts = port.arc_circuit_polygon(2, circ)
            cv.fill_poly([(offX + x * sc, offY - y * sc) for x, y in pts],
                         col, rule=rule)
    return [1 if cv.px[(y * w + x) * 3] < 128 else 0 for y in range(h) for x in range(w)]


def iou(a, b):
    inter = sum(x & y for x, y in zip(a, b))
    union = sum(x | y for x, y in zip(a, b))
    return inter / union if union else 1.0


for idx, box in enumerate(cells):
    w, h, cm = cell_mask(box)
    res = {}
    for rule in ('nonzero', 'evenodd'):
        scored = sorted(((iou(render_mask(n, rule, w, h), cm), n)
                         for n in port.TILE_ORDER), reverse=True)
        res[rule] = scored[:3]
    r, h_, h2 = box[1] // ch, (idx % COLS), box[1] // ch
    nZ, dZ = res['nonzero'][0][1], res['nonzero'][0][0]
    nE, dE = res['evenodd'][0][1], res['evenodd'][0][0]
    flag = '  <== RULE DIFFERS' if nZ != nE else ''
    print(f'r{box[1]//ch+1}c{idx%COLS+1}: nonzero -> {nZ:5s} IoU={dZ:.3f} | '
          f'evenodd -> {nE:5s} IoU={dE:.3f}{flag}')
    print('        nz next:', ', '.join(f'{n}({s:.3f})' for s, n in res['nonzero'][1:3]))
    print('        eo next:', ', '.join(f'{n}({s:.3f})' for s, n in res['evenodd'][1:3]))
