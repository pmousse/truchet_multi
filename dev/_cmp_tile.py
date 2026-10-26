"""_cmp_tile.py NAME -- side-by-side: chrome render | python oracle | diff mask.

Uses dev/browse/sheet256.png (chrome canvas dump) and dev/port.py with the
exact same fitTransform mapping, so differences are real geometry/fill bugs.
"""
import sys, os
sys.path.insert(0, 'dev')
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
import port
from port import Canvas
from zoom import read_png, write_png
from _tilesqa import parse_dom, fit_single, save_b64

S, cols = 256, 6
name = sys.argv[1] if len(sys.argv) > 1 else '+.'
names = port.TILE_ORDER
k = names.index(name)

entries = parse_dom()
save_b64(entries, 'sheet256', 'dev/browse/sheet256.png')
W, H, px = read_png('dev/browse/sheet256.png')


def lum(i):
    return (px[i] + px[i + 1] + px[i + 2]) // 3


cx0, cy0 = (k % cols) * S, (k // cols) * S
sc, offX, offY = fit_single(S)


def screen(p):
    return (offX + p[0] * sc, offY - p[1] * sc)


white, black = port.tile_circuits(name)
cv = Canvas(S, S, (255, 255, 255))
for grp, col in ((white, (255, 255, 255)), (black, (0, 0, 0))):
    for circ in grp:
        pts = port.arc_circuit_polygon(2, circ)
        cv.fill_poly([screen(p) for p in pts], col, rule='nonzero')

out = bytearray(S * S * 3 * 3)  # chrome | oracle | diff


def put(bx, x, y, rgb):
    i = ((y * S * 3 + bx * S + x)) * 3
    out[i:i + 3] = bytes(rgb)


n_mism = 0
for y in range(S):
    for x in range(S):
        ch = lum(((cy0 + y) * W + cx0 + x) * 3)
        orc = cv.px[(y * S + x) * 3]
        put(0, x, y, (ch, ch, ch))
        put(1, x, y, (orc, orc, orc))
        bad = abs(ch - orc) > 70
        if bad:
            n_mism += 1
        put(2, x, y, (255, 0, 0) if bad else (min(255, ch), min(255, orc), 0))

write_png('dev/browse/cmp_%s.png' % name.replace('.', '_').replace('\\', 'bs'),
          S * 3, S, bytes(out))
print(f'{name}: chrome cell vs oracle -> {n_mism} differing px ({100*n_mism/(S*S):.2f}%)')
print('wrote dev/browse/cmp_*.png  [chrome | oracle | red=diff]')
