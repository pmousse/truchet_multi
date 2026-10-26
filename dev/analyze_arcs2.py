#!/usr/bin/env python3
"""analyze_arcs2.py: measure tangent angles of Carlson's curves at edge junctions."""
import sys, math
sys.path.insert(0, 'dev')
from zoom import read_png

path = sys.argv[1] if len(sys.argv) > 1 else 'ref_multiscaletiles2.png'
W, H, rgb = read_png(path)


def lum(x, y):
    i = (y * W + x) * 3
    return .299 * rgb[i] + .587 * rgb[i + 1] + .114 * rgb[i + 2]


def dark(x, y):
    if x < 0 or y < 0 or x >= W or y >= H:
        return False
    return lum(x, y) < 210


def pca_dir(pts):
    n = len(pts)
    if n < 4:
        return None
    mx = sum(p[0] for p in pts) / n
    my = sum(p[1] for p in pts) / n
    sxx = sum((p[0] - mx) ** 2 for p in pts)
    syy = sum((p[1] - my) ** 2 for p in pts)
    sxy = sum((p[0] - mx) * (p[1] - my) for p in pts)
    return math.degrees(0.5 * math.atan2(2 * sxy, sxx - syy))


def curve_dir_near(x0, y0, side=None, R=7):
    """direction of dark curve pixels near junction; side: 'left','right','above','below'"""
    pts = []
    for dy in range(-R, R + 1):
        for dx in range(-R, R + 1):
            if not dark(x0 + dx, y0 + dy):
                continue
            if side == 'left' and dx > 1:
                continue
            if side == 'right' and dx < -1:
                continue
            if side == 'above' and dy > 1:
                continue
            if side == 'below' and dy < -1:
                continue
            d = math.hypot(dx, dy)
            if d > R:
                continue
            w = (R - d + 1)
            for _ in range(w):
                pts.append((dx, dy))
    return pca_dir(pts)


def find_dark_runs(fixed, rng, axis, band):
    """find junction clusters along a line; axis 'v' fixed=x scans y; 'h' fixed=y scans x"""
    hits = []
    for v in rng:
        if axis == 'v':
            hit = any(dark(fixed + b, v) for b in band)
        else:
            hit = any(dark(v, fixed + b) for b in band)
        if hit:
            hits.append(v)
    out = []
    for v in hits:
        if out and v - out[-1][-1] <= 3:
            out[-1].append(v)
        else:
            out.append([v])
    return [int(sum(g) / len(g) / len(g)) if False else int(sum(g) / len(g)) for g in out if len(g) >= 2]


X_TILE = 4.0       # left edge of big tile
XB = 131.5         # right edge of big tile
YB = 131.0         # bottom edge (image coords)
YT = 4.0
SIZE = 127.0
print('Big tile: x', X_TILE, '->', XB, ' y', YT, '->', YB)

print('\nJunctions on big-tile RIGHT edge (x=131.5), big-tile side vs small-tile side:')
for y in find_dark_runs(131, range(6, 130), 'v', [-2, -1, 0, 1, 2]):
    dl = curve_dir_near(130, y, side='left')
    dr = curve_dir_near(132, y, side='right')
    def note(a):
        if a is None:
            return 'n/a'
        a = (a + 90) % 180 - 90
        return f'{a:+.0f}deg {"PERP" if abs(abs(a)-90)<25 else ("TANGENT" if abs(a)<25 else "slant")}'
    frac = (131 - y) / SIZE
    print(f'  y={y} (math y/size={frac:.2f}) big-side dir: {note(dl)} | small-side: {note(dr)}')

print('\nJunctions on big-tile TOP edge (y=4):')
for x in find_dark_runs(4, range(6, 129), 'h', [-2, -1, 0, 1, 2]):
    da = curve_dir_near(x, 5, side='below')
    def note(a):
        if a is None:
            return 'n/a'
        a = (a + 90) % 180 - 90
        return f'{a:+.0f}deg {"PERP" if abs(abs(a)-90)<25 else ("TANGENT" if abs(a)<25 else "slant")}'
    print(f'  x={x} (x/size={(x-4)/SIZE:.2f}) tile-side: {note(da)}')

print('\nJunctions on big-tile BOTTOM edge (y=131):')
for x in find_dark_runs(131, range(6, 129), 'h', [-2, -1, 0, 1, 2]):
    da = curve_dir_near(x, 130, side='above')
    def note(a):
        if a is None:
            return 'n/a'
        a = (a + 90) % 180 - 90
        return f'{a:+.0f}deg {"PERP" if abs(abs(a)-90)<25 else ("TANGENT" if abs(a)<25 else "slant")}'
    print(f'  x={x} (x/size={(x-4)/SIZE:.2f}) tile-side: {note(da)}')

print('\nJunctions on big-tile LEFT edge (x=4):')
for y in find_dark_runs(4, range(6, 130), 'v', [-2, -1, 0, 1, 2]):
    da = curve_dir_near(5, y, side='right')
    def note(a):
        if a is None:
            return 'n/a'
        a = (a + 90) % 180 - 90
        return f'{a:+.0f}deg {"PERP" if abs(abs(a)-90)<25 else ("TANGENT" if abs(a)<25 else "slant")}'
    print(f'  y={y} (math y/size={(131-y)/SIZE:.2f}) tile-side: {note(da)}')
