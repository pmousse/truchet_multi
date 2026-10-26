# Regenerate reference renders in Carlson's display orientation (math y-up)
# using the validated port pipeline + canvas-style fit transform.
import sys, math
sys.path.insert(0, 'dev')
import port
from zoom import write_png

def js_fit(tiles, w, h, padding=0.02):
    minx = min(t['x'] for t in tiles); miny = min(t['y'] for t in tiles)
    maxx = max(t['x'] + t['s'] for t in tiles); maxy = max(t['y'] + t['s'] for t in tiles)
    for t in tiles:
        m = t['s'] / 4
        minx = min(minx, t['x'] - m); maxx = max(maxx, t['x'] + t['s'] + m)
        miny = min(miny, t['y'] - m); maxy = max(maxy, t['y'] + t['s'] + m)
    bw = maxx - minx; bh = maxy - miny
    minx -= padding * bw; maxx += padding * bw
    miny -= padding * bh; maxy += padding * bh
    bw = maxx - minx; bh = maxy - miny
    s = min(w / bw, h / bh)
    tx = (w - bw * s) / 2 - minx * s
    ty = (h + bh * s) / 2 + miny * s
    return tx, ty, s

def render(tilings, name, w, h, path):
    tiles = [{'x': af[4], 'y': af[5], 's': af[0]} for _, af in tilings]
    tx, ty, s = js_fit(tiles, w, h)
    cv = port.Canvas(w, h, (255, 255, 255))
    order = sorted(tilings, key=lambda ta: port.tile_depth(ta[1]))
    for _, af in order:
        a, b, c, d, e, f = af
        odd = port.tile_depth(af) % 2 == 1
        white, black = port.tile_circuits(name)
        if odd:
            white, black = black, white
        for grp, col in ((white, (255, 255, 255)), (black, (0, 0, 0))):
            for circ in grp:
                pts = port.arc_circuit_polygon(2, circ)
                out = [(tx + s * (a * X + c * Y + e), ty - s * (b * X + d * Y + f))
                       for (X, Y) in pts]
                cv.fill_poly(out, col)
    write_png(path, w, h, bytes(cv.px))
    print('wrote', path)

render(port.checkerboard_tiling(4), '/', 760, 760, 'ref2_checker_slash.png')
render(port.surround_tiling(3), '/', 760, 760, 'ref2_surround3.png')
render(port.checkerboard_tiling(4), 'fne', 760, 760, 'ref2_checker_fne.png')
# single-tile strip (math y-up), in SquareTileNames order
order = list(port.TILE_NAME_MAPPING.keys())
W, Hc, cols = 24 * 80, 3 * 90, 8
cv = port.Canvas(cols * 90, 3 * 90, (210, 210, 210))
for k, nm in enumerate(order):
    col, row = k % cols, k // cols
    _, black = port.tile_circuits(nm)
    cx = col * 90 + 45; cy = row * 90 + 45
    # white tile square background (white circuits = background regions)
    cv.fill_poly([(cx - 37, cy - 37), (cx + 37, cy - 37),
                  (cx + 37, cy + 37), (cx - 37, cy + 37)], (255, 255, 255))
    for circ in black:
        pts = port.arc_circuit_polygon(2, circ)
        out = [(cx + (X - .5) * 74, cy - (Y - .5) * 74) for (X, Y) in pts]
        cv.fill_poly(out, (0, 0, 0))
write_png('ref2_tiles_grid.png', cols * 90, 3 * 90, bytes(cv.px))
print('wrote ref2_tiles_grid.png')
