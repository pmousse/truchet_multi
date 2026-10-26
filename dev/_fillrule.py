"""_fillrule.py — decide the fill rule empirically.

1. For each of the 24 named tiles, render the tile's circuits twice in Python
   (dev/port.py): nonzero-winding vs even-odd, and count differing pixels.
   Tiles where the two rules differ are the only ones that can discriminate.
2. For those tiles, print the world-space self-overlap area too.
"""
import sys, math
sys.path.insert(0, 'dev')
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
import port
from port import Canvas

S = 300


def render(name, rule):
    cv = Canvas(S, S, (255, 255, 255))
    m = 1 / 3 + 0.02
    sc = S / (1 + 2 * m)
    offX = -(-m) * sc
    offY = (1 + 2 * m) * sc - (-m) * sc  # == (1.5-... ) just keep y flip
    # exact replica of engine.fitTransform, pad 0
    minX = minY = -m
    maxX = maxY = 1 + m
    bw = bh = maxX - minX
    sc = min(S / bw, S / bh)
    offX = (S - bw * sc) / 2 - minX * sc
    offY = (S + bh * sc) / 2 + minY * sc
    white, black = port.tile_circuits(name)
    for grp, col in ((white, (255, 255, 255)), (black, (0, 0, 0))):
        for circ in grp:
            pts = port.arc_circuit_polygon(2, circ)
            cv.fill_poly([(offX + x * sc, offY - y * sc) for x, y in pts],
                         col, rule=rule)
    return [1 if cv.px[(y * S + x) * 3] < 128 else 0 for y in range(S) for x in range(S)]


print(f'{"name":6s} {"nz-black":>8s} {"eo-black":>8s} {"diff":>6s}  self-overlapping?')
diff_names = []
for name in port.TILE_ORDER:
    a = render(name, 'nonzero')
    b = render(name, 'evenodd')
    d = sum(x != y for x, y in zip(a, b))
    if d:
        diff_names.append(name)
    print(f'{name:6s} {sum(a):8d} {sum(b):8d} {d:6d}  {"YES" if d else "-"}')
print()
print('tiles where the fill rule matters:', ', '.join(diff_names))
