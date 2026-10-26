"""_screenshot_match.py IMG -- match the MOTIF preview cells in a UI screenshot
against our engine's renders, testing BOTH fill rules.

Tells us whether the user's live page is drawing nonzero (fixed) or
even-odd (the old broken look) shapes.
"""
import sys, re
sys.path.insert(0, 'dev')
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
import port
from port import Canvas
from zoom import read_png, write_png

img = sys.argv[1] if len(sys.argv) > 1 else 'dev/motifs_zoom.jpg'
W0, H0, px = read_png(img)
print(img, W0, H0)


def lum(i):
    return (px[i] + px[i + 1] + px[i + 2]) // 3


# ---- find the preview cells: runs of near-white pixels on a dark UI ----
def is_white(x, y):
    return lum((y * W0 + x) * 3) > 200


# column scan in the middle band of the panel
ys = range(0, H0)
cols_white = [sum(1 for y in ys if is_white(x, y)) for x in range(W0)]
rows_white = [sum(1 for x in range(W0) if is_white(x, y)) for y in range(H0)]


def runs(arr, minv, minlen):
    out = []
    i = 0
    while i < len(arr):
        if arr[i] > minv:
            j = i
            while j < len(arr) and arr[j] > minv:
                j += 1
            if j - i >= minlen:
                out.append((i, j))
            i = j
        else:
            i += 1
    return out


colbands = runs(cols_white, 40, 60)
rowbands = runs(rows_white, 40, 60)
print('col bands:', colbands)
print('row bands:', rowbands)

cells = []
for (x0, x1) in colbands:
    for (y0, y1) in rowbands:
        cells.append((x0, y0, x1 - 1, y1 - 1))
print(len(cells), 'candidate cells')

M = 1 / 3 + 0.02
WORLD = 1 + 2 * M


def render_mask(name, rule, w, h):
    cv = Canvas(w, h, (255, 255, 255))
    sc = min(w, h) / WORLD
    offX = (w - WORLD * sc) / 2 + M * sc
    offY = (h + WORLD * sc) / 2 - M * sc
    white, black = port.tile_circuits(name)
    for grp, col in ((white, (255, 255, 255)), (black, (0, 0, 0))):
        for circ in grp:
            pts = port.arc_circuit_polygon(2, circ)
            cv.fill_poly([(offX + x * sc, offY - y * sc) for x, y in pts], col, rule=rule)
    return [1 if cv.px[(y * w + x) * 3] < 128 else 0 for y in range(h) for x in range(w)]


def cell_mask(box, S=64):
    x0, y0, x1, y1 = box
    m = []
    for sy in range(S):
        for sx in range(S):
            a0 = x0 + sx * (x1 - x0) // S
            a1 = x0 + (sx + 1) * (x1 - x0) // S
            b0 = y0 + sy * (y1 - y0) // S
            b1 = y0 + (sy + 1) * (y1 - y0) // S
            tot = n = 0
            for yy in range(b0, b1):
                for xx in range(a0, a1):
                    tot += lum((yy * W0 + xx) * 3)
                    n += 1
            m.append(1 if tot / max(n, 1) < 128 else 0)
    return m


def render_lowres(name, rule, S=64):
    """sample our vector render on the same SxS grid (area-averaged)"""
    R = 360
    cv = Canvas(R, R, (255, 255, 255))
    sc = R / WORLD
    offX = M * sc
    offY = WORLD * sc - M * sc
    white, black = port.tile_circuits(name)
    for grp, col in ((white, (255, 255, 255)), (black, (0, 0, 0))):
        for circ in grp:
            pts = port.arc_circuit_polygon(2, circ)
            cv.fill_poly([(offX + x * sc, offY - y * sc) for x, y in pts], col, rule=rule)
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


def diff(a, b):
    return sum(x != y for x, y in zip(a, b))


DISCRIMINATORS = {'yn', 'ye', 'ys', 'yw', 'anw', 'ase', 'ane', 'asw'}
cache = {(n, r): render_lowres(n, r) for n in port.TILE_ORDER for r in ('nonzero', 'evenodd')}
nz_tot = eo_tot = 0
print(f'{"cell":>6s} {"name":5s} {"nz":>5s} {"eo":>5s}  better   note')
for idx, box in enumerate(cells):
    cm = cell_mask(box)
    best = {}
    for rule in ('nonzero', 'evenodd'):
        scored = sorted((diff(cache[(n, rule)], cm), n) for n in port.TILE_ORDER)
        best[rule] = scored[0]
    dn, nn = best['nonzero']
    de, ne = best['evenodd']
    note = ''
    if nn in DISCRIMINATORS or ne in DISCRIMINATORS:
        note = 'discriminator'
        if dn < de:
            nz_tot += 1
        elif de < dn:
            eo_tot += 1
    print(f'{idx:6d} {nn:5s} {dn:5d} {de:5d}  '
          f'{"nonzero" if dn < de else ("evenodd" if de < dn else "tie")}'
          f'   {note} (eo name={ne})')
print(f'\ndiscriminator cells favouring NONZERO: {nz_tot}   favouring EVEN-ODD: {eo_tot}')
