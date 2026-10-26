# Diff the browser screenshots (dev/téléchargement*.png) against an
# offline Python re-render of the exact same tilings + fit transform that
# the JS engine applies. Verifies canvas rendering == gold model.
import sys, math
sys.path.insert(0, 'dev')
import port
from zoom import read_png

PPU_TARGET = 760  # canvas size in screenshots


def fit_transform(*args):
    return None  # unused; js_fit below replicates engine exactly


def js_fit(tiles, w, h, padding=0.02):
    # replicate src/engine.js fitTransform (tiles are {x,y,s})
    s0 = 1
    minx = min(t['x'] for t in tiles)
    miny = min(t['y'] for t in tiles)
    maxx = max(t['x'] + t['s'] for t in tiles)
    maxy = max(t['y'] + t['s'] for t in tiles)
    for t in tiles:
        m = t['s'] / 4
        minx = min(minx, t['x'] - m); maxx = max(maxx, t['x'] + t['s'] + m)
        miny = min(miny, t['y'] - m); maxy = max(maxy, t['y'] + t['s'] + m)
    bw = maxx - minx; bh = maxy - miny
    s = min(w / bw, h / bh)
    minx -= padding * bw; maxx += padding * bw
    miny -= padding * bh; maxy += padding * bh
    bw = maxx - minx; bh = maxy - miny
    s = min(w / bw, h / bh)
    tx = (w - bw * s) / 2 - minx * s
    ty = (h + bh * s) / 2 + miny * s
    # canvas px = (tx + s*X, ty - s*Y)
    return tx, ty, s


def render_emulated(canvas_tilings, motif_idx, w, h, depthinvert=True):
    """Reproduce renderTiling with port's validated polygon pipeline,
    but rasterized in canvas pixel space (y flipped)."""
    from port import Canvas
    tiles = [{'x': af[4], 'y': af[5], 's': af[0]} for mid, af in canvas_tilings]
    tx, ty, s = js_fit(tiles, w, h)
    cv = Canvas(w, h, (255, 255, 255))

    def depth(t):
        return round(-math.log2(t['s']))

    order = sorted(canvas_tilings, key=lambda ta: depth({'s': ta[1][0]}))
    names = port.TILE_ORDER
    for mid, af in order:
        a, b, c, d, e, f = af
        t = {'x': af[4], 'y': af[5], 's': af[0]}
        odd = depth(t) % 2 == 1
        if callable(motif_idx):
            name = motif_idx(t)
        else:
            name = names[motif_idx - 1]
        white, black = port.tile_circuits(name)
        if odd:
            white, black = black, white
        for grp, col in ((white, (255, 255, 255)), (black, (0, 0, 0))):
            for circ in grp:
                pts = port.arc_circuit_polygon(2, circ)
                out = []
                for (X, Y) in pts:
                    # tile-local -> world via af, then canvas px
                    wx = a * X + c * Y + e
                    wy = b * X + d * Y + f
                    out.append((tx + s * wx, ty - s * wy))
                cv.fill_poly(out, col)
    return cv, (tx, ty, s)


def diff(a_px, b_px, w, h, tol=90):
    bad = 0
    for i in range(w * h * 3):
        if abs(a_px[i] - b_px[i]) > tol:
            bad += 1
    return bad / (w * h * 3)


def main(png, tilings, motif_idx):
    from zoom import read_png
    W, H, ref = read_png(png)
    print(f'{png}: {W}x{H}')
    if (W, H) != (760, 760):
        print('unexpected size'); return
    cv, _ = render_emulated(tilings, motif_idx, 760, 760)
    print('pixel mismatch fraction:', f'{diff(cv.px, ref, 760, 760):.4f}')


if __name__ == '__main__':
    which = sys.argv[1]
    if which == 'check':
        main('dev/téléchargement (1).png', port.checkerboard_tiling(4),
             port.TILE_ORDER.index('/') + 1)
    elif which == 'surround':
        main('dev/téléchargement (3).png', port.surround_tiling(3),
             port.TILE_ORDER.index('/') + 1)
    elif which == 'rand':
        from seedrand import (mulberry32, seed_from_string, assign_motifs,
                              tile_depth)
        def subdiv(rnd, n, max_depth):
            tiles = [{'x': 0.0, 'y': 0.0, 's': 1.0}]
            for _ in range(n):
                cands = [i for i, t in enumerate(tiles)
                         if tile_depth(t['s']) < max_depth]
                if not cands:
                    break
                i = cands[int(rnd() * len(cands))]
                t = tiles.pop(i)
                s = t['s'] / 2
                tiles[i:i] = [{'x': t['x'], 'y': t['y'], 's': s},
                              {'x': t['x'] + s, 'y': t['y'], 's': s},
                              {'x': t['x'], 'y': t['y'] + s, 's': s},
                              {'x': t['x'] + s, 'y': t['y'] + s, 's': s}]
            return tiles
        tiles = subdiv(mulberry32(seed_from_string('k7x2m9')), 12, 10 ** 9)
        asg = assign_motifs(tiles, 'k7x2m9')
        names2 = port.TILE_ORDER
        ct = [(1, (t['s'], 0, 0, t['s'], t['x'], t['y'])) for t in tiles]
        def motif(t):
            return names2[asg[(t['x'], t['y'], t['s'])] - 1]
        main('dev/téléchargement (2).png', ct, motif)
