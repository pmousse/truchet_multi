# Orientation test: compare a python-rasterized surround tiling ('/' motif)
# against Carlson's published figure ref_mstp.png by correlation over
# flips. Also renders the two candidates for eyeballing.
import sys, math
sys.path.insert(0, 'dev')
import port
from zoom import read_png

def render_surround(w, h, flip_canvas_y, padding=0.02):
    """Render SurroundTiling[4] '/' motif; if flip_canvas_y: math y-up
    (Carlson/Mathematica display convention), else port convention."""
    tilings = port.surround_tiling(4)
    tiles = [{'x': af[4], 'y': af[5], 's': af[0]} for _, af in tilings]
    minx = min(t['x'] - t['s'] / 4 for t in tiles)
    miny = min(t['y'] - t['s'] / 4 for t in tiles)
    maxx = max(t['x'] + t['s'] + t['s'] / 4 for t in tiles)
    maxy = max(t['y'] + t['s'] + t['s'] / 4 for t in tiles)
    bw, bh = maxx - minx, maxy - miny
    s = min(w / bw, h / bh)
    minx -= padding * bw; maxx += padding * bw
    miny -= padding * bh; maxy += padding * bh
    bw, bh = maxx - minx, maxy - miny
    s = min(w / bw, h / bh)
    tx = (w - bw * s) / 2 - minx * s
    if flip_canvas_y:
        ty = (h + bh * s) / 2 + miny * s
    else:
        ty = (h - bh * s) / 2 - miny * s
    cv = port.Canvas(w, h, (255, 255, 255))
    names = port.TILE_ORDER
    slash = names.index('/')
    order = sorted(tilings, key=lambda ta: port.tile_depth(ta[1]))
    for _, af in order:
        a, b, c, d, e, f = af
        odd = port.tile_depth(af) % 2 == 1
        white, black = port.tile_circuits(names[slash])
        if odd:
            white, black = black, white
        for grp, col in ((white, (255, 255, 255)), (black, (0, 0, 0))):
            for circ in grp:
                pts = port.arc_circuit_polygon(2, circ)
                out = []
                for (X, Y) in pts:
                    wx = a * X + c * Y + e
                    wy = b * X + d * Y + f
                    if flip_canvas_y:
                        out.append((tx + s * wx, ty - s * wy))
                    else:
                        out.append((tx + s * wx, ty + s * wy))
                cv.fill_poly(out, col)
    return cv


def lum(px, w, h):
    return [(px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) // 1000
            for i in range(0, w * h * 3, 3)]


def binarize(L, thr=128):
    return [1 if v > thr else 0 for v in L]


def downsample_bmp(bmp, W, H, w, h):
    out = bytearray(w * h)
    for y in range(h):
        for x in range(w):
            out[y * w + x] = bmp[(y * H // h) * W + x * W // w]
    return out


def correlate(a, b):
    n = len(a)
    sa = sum(a); sb = sum(b)
    num = sum(x * y for x, y in zip(a, b)) * n - sa * sb
    den = math.sqrt((sum(x * x for x in a) * n - sa * sa)
                    * (sum(y * y for y in b) * n - sb * sb))
    return num / den if den else 0.0


def main():
    W, H, ref_rgb = read_png('ref_mstp.png')
    ref = binarize(lum(ref_rgb, W, H))
    for name, flip in (('mathyup', True), ('portydown', False)):
        cv = render_surround(W, H, flip)
        mine = binarize(lum(cv.px, W, H))
        c_direct = correlate(mine, ref)
        c_flip = correlate(mine[::-1], ref)  # vertical mirror variant
        print(f'{name}: corr direct={c_direct:+.4f} corr vmirror={c_flip:+.4f}')
        out = f'or_test_{name}.png'
        from zoom import write_png
        write_png(out, W, H, bytes(cv.px))
        print(' wrote', out)

if __name__ == '__main__':
    main()
