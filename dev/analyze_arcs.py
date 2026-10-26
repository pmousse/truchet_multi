#!/usr/bin/env python3
"""analyze_arcs.py - measure how Carlson's curves meet the tile edges in
ref_multiscaletiles2.png. For every point where a dark curve touches a gray
grid line, fit the local direction of the curve and report the angle relative
to the grid line normal (perpendicular crossing => ~0deg, tangent contact => ~90deg).
"""
import sys
sys.path.insert(0, 'dev')
from zoom import read_png
import math

path = sys.argv[1] if len(sys.argv) > 1 else 'ref_multiscaletiles2.png'
W, H, rgb = read_png(path)
print(f'image {W}x{H}')


def px(x, y):
    i = (y * W + x) * 3
    return rgb[i], rgb[i + 1], rgb[i + 2]


def lum(x, y):
    r, g, b = px(x, y)
    return 0.299 * r + 0.587 * g + 0.114 * b


def dark(x, y):
    if x < 0 or y < 0 or x >= W or y >= H:
        return False
    return lum(x, y) < 100


def grid_lines():
    # grid lines are light gray; image background is near-white.
    # A grid column: many pixels of luminance in gray range and low saturation.
    cols, rows = [], []
    for x in range(W):
        cnt = 0
        for y in range(H):
            r, g, b = px(x, y)
            l = 0.299 * r + 0.587 * g + 0.114 * b
            mx, mn = max(r, g, b), min(r, g, b)
            if 140 < l < 235 and mx - mn < 40:
                cnt += 1
        if cnt > H * 0.5:
            cols.append(x)
    for y in range(H):
        cnt = 0
        for x in range(W):
            r, g, b = px(x, y)
            l = 0.299 * r + 0.587 * g + 0.114 * b
            mx, mn = max(r, g, b), min(r, g, b)
            if 140 < l < 235 and mx - mn < 40:
                cnt += 1
        if cnt > W * 0.5:
            rows.append(y)
    return cols, rows


cols, rows = grid_lines()
print('grid cols:', cols)
print('grid rows:', rows)

# cluster consecutive
def cluster(a):
    out = []
    for v in a:
        if out and v - out[-1][-1] <= 2:
            out[-1].append(v)
        else:
            out.append([v])
    return [sum(g) / len(g) for g in out]

gc, gr = cluster(cols), cluster(rows)
print('clustered cols:', gc)
print('clustered rows:', gr)

# find junctions: dark pixels adjacent to a grid line (within 2px band)
def junctions_on_vertical(xg):
    band = [x for x in range(int(xg) - 2, int(xg) + 3)]
    ys = []
    for y in range(2, H - 2):
        if any(dark(x, y) for x in band):
            ys.append(y)
    # cluster ys
    out = []
    for y in ys:
        if out and y - out[-1][-1] <= 3:
            out[-1].append(y)
        else:
            out.append([y])
    return [int(sum(g) / len(g)) for g in out if len(g) >= 2]

def junctions_on_horizontal(yg):
    band = [y for y in range(int(yg) - 2, int(yg) + 3)]
    xs = []
    for x in range(2, W - 2):
        if any(dark(x, y) for y in band):
            xs.append(x)
    out = []
    for x in xs:
        if out and x - out[-1][-1] <= 3:
            out[-1].append(x)
        else:
            out.append([x])
    return [int(sum(g) / len(g)) for g in out if len(g) >= 2]

def local_direction(x0, y0, R=9):
    """PCA of dark pixels in a disk, weighted toward the junction: returns angle"""
    pts = []
    for dy in range(-R, R + 1):
        for dx in range(-R, R + 1):
            if dark(x0 + dx, y0 + dy):
                w = max(0.0, R - math.hypot(dx, dy)) + 1
                pts.append((dx, dy, w))
    if len(pts) < 5:
        return None, 0
    sw = sum(w for _, _, w in pts)
    mx = sum(dx * w for dx, _, w in pts) / sw
    my = sum(dy * w for dx, _, w in pts) / sw
    # centered second moments
    sxx = sum((dx - mx) ** 2 * w for dx, dy, w in pts)
    syy = sum((dy - my) ** 2 * w for dx, dy, w in pts)
    sxy = sum((dx - mx) * (dy - my) * w for dx, dy, w in pts)
    # principal axis
    th = 0.5 * math.atan2(2 * sxy, sxx - syy)
    # disambiguate: which lobe is denser near the junction? use skewness-free PCA;
    # angle th is the direction of maximum spread = curve direction
    return math.degrees(th), len(pts)

print('\n--- junctions on vertical grid lines ---')
for xg in gc:
    for y in junctions_on_vertical(xg):
        ang, n = local_direction(int(xg), y)
        if ang is None:
            continue
        # ang: 90 deg => curve runs vertically => tangent to vertical line
        # ang: 0 deg => horizontal => crossing perpendicular
        print(f'x={xg:.1f} y={y}: curve dir {ang:.1f}deg (0=perp crossing, 90=tangent) npts={n}')

print('\n--- junctions on horizontal grid lines ---')
for yg in gr:
    for x in junctions_on_horizontal(yg):
        ang, n = local_direction(x, int(yg))
        if ang is None:
            continue
        print(f'x={x} y={yg:.1f}: curve dir {ang:.1f}deg (90=perp crossing, 0=tangent) npts={n}')
