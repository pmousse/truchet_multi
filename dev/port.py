#!/usr/bin/env python3
"""
port.py - literal Python port of Christopher Carlson's MultiScaleTruchetPatterns.wl
(arc pipeline, circuit tracing, named tiles, tilings) used as the fidelity
reference implementation. Rendered with a pure-Python scanline rasterizer.

This is the geometry the JS engine must match.
"""
import math
import zlib
import struct

EPS = 2.220446049250313e-16  # $MachineEpsilon


# ---------- complex math helpers (Mathematica ArcTan@@ and VectorAngle analogs) ----------

def arc_tan2(x, y):
    return math.atan2(y, x)  # ArcTan@@{x,y} == ArcTan[x,y]


def vector_angle(t1, t2):
    d = t1[0] * t2[0] + t1[1] * t2[1]
    n1 = math.hypot(*t1)
    n2 = math.hypot(*t2)
    c = max(-1.0, min(1.0, d / (n1 * n2)))
    return math.acos(c)


# ---------- Coordinate / InternalTangent ----------

def coordinate(pps, n):
    side = (n - 1) // pps
    if side == 0:
        return (n / (pps + 1), 0.0)
    elif side == 1:
        return (1.0, (n - pps) / (pps + 1))
    elif side == 2:
        return ((2 * pps - n) / (pps + 1) + 1, 1.0)
    else:
        return (0.0, (4 * pps - n + 1) / (pps + 1))


def internal_tangent(pps, n):
    side = (n - 1) // pps
    return [(0, 1), (-1, 0), (0, -1), (1, 0)][side]


# ---------- ArcPoints (literal transcription of Carlson's ArcPoints) ----------

def arc_points_sampled(c, rx, ry, a1, a2, step_deg=5.0):
    """With[{da=(a2-a1)/Abs[Round[(a2-a1)/(5 Degree)]]}, Table[c+{rx,ry} AngleVector[a],{a,a1,a2,da}]]"""
    da = (a2 - a1) / abs(round((a2 - a1) / math.radians(step_deg)) or 1)
    pts = []
    a = a1
    nsteps = int(round((a2 - a1) / da))
    for i in range(nsteps + 1):
        aa = a1 + da * i
        pts.append((c[0] + rx * math.cos(aa), c[1] + ry * math.sin(aa)))
    return pts


def arc_points(p1, t1, p2, t2):
    """ArcPoints[{p1,t1},{p2,t2}] literal port. Returns list of points."""
    va = vector_angle(t1, t2)
    if abs(va) < EPS:
        return [p1, p2]
    if abs(va - math.pi) < EPS:
        c = ((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2)
    else:
        x1, y1 = p1
        x2, y2 = p2
        t1x, t1y = t1
        t2x, t2y = t2
        inner = -t2x * x1 + t2x * x2 - t2y * y1 + t2y * y2
        denom = t1y * t2x - t1x * t2y
        c = (x1 + t1y * inner / denom, y1 - t1x * inner / denom)
    cw = (t1[0] * (p1[1] - c[1]) - (p1[0] - c[0]) * t1[1]) > 0  # Sign[...]===1
    rx = math.hypot(p1[0] - c[0], p1[1] - c[1])
    ry = math.hypot(p2[0] - c[0], p2[1] - c[1])
    a1 = arc_tan2(p1[0] - c[0], p1[1] - c[1])
    a2 = arc_tan2(p2[0] - c[0], p2[1] - c[1])
    if cw and a1 < a2:
        a2 -= 2 * math.pi
    if (not cw) and a2 < a1:
        a1 -= 2 * math.pi
    return arc_points_sampled(c, rx, ry, a1, a2)


def arc_circuit_polygon(pps, circuit):
    """ArcCircuitPolygon literal: alternating tangent sign, closed loop."""
    pts_desc = []
    switch = True
    for k in circuit:
        p = coordinate(pps, k)
        t = internal_tangent(pps, k)
        switch = not switch
        sign = -1 if switch else 1
        pts_desc.append((p, (t[0] * sign, t[1] * sign)))
    closed = pts_desc + [pts_desc[0]]
    out = []
    for i in range(len(pts_desc)):
        (p1, t1), (p2, t2) = closed[i], closed[i + 1]
        seg = arc_points(p1, t1, p2, t2)
        # Join@@ : concatenate; avoid duplicating shared endpoints
        if out and seg:
            out.extend(seg[1:])
        else:
            out.extend(seg)
    return out


# ---------- circuits ----------

def square_external_connections(pps):
    r = list(range(1, 4 * pps + 1))
    rot = r[1:] + r[:1]
    return list(zip(r, rot))


def square_connection_circuits(pps, connections):
    internal = {}
    for a, b in connections:
        internal[a] = b
        internal[b] = a
    external = dict(square_external_connections(pps))
    all_circuits = []
    for start in range(1, 4 * pps + 1):
        circuit = [start, internal[start]]
        internal_step = False
        while circuit[-1] != circuit[0]:
            nxt = (internal if internal_step else external)[circuit[-1]]
            circuit.append(nxt)
            internal_step = not internal_step
        all_circuits.append(circuit[:-1])
    seen = set()
    out = []
    for c in all_circuits:
        key = tuple(sorted(c))
        if key not in seen:
            seen.add(key)
            out.append(c)
    return out


# ---------- named tiles: exact enumeration of AllSquare2ConnectionSets ----------

def square2_connection_destinations(i):
    return [(i + d - 1) % 8 + 1 for d in (1, 3, 5, 7)]


def square2_connection_step(c):
    used = set()
    for a, b in c:
        used.add(a)
        used.add(b)
    left = [p for p in range(1, 9) if p not in used]
    if not left:
        return []
    p = min(left)
    opts = [d for d in square2_connection_destinations(p) if d not in used]
    return [c + [(p, o)] for o in opts]


def all_square2_connection_sets():
    sets = [[]]
    for _ in range(4):
        nxt = []
        for s in sets:
            nxt.extend(square2_connection_step(s))
        sets = nxt
    return sets


TILE_NAME_MAPPING = {
    "\\": 24, "/": 8, "-": 6, "|": 15, "+.": 1, "x.": 19, "+": 16,
    "fne": 3, "fsw": 23, "fnw": 2, "fse": 7, "tn": 5, "ts": 20, "te": 13,
    "tw": 21, "ys": 12, "ye": 9, "yn": 4, "yw": 17, "anw": 10, "ane": 18,
    "asw": 22, "ase": 14, "p": 11,
}

TILE_ORDER = sorted(TILE_NAME_MAPPING, key=lambda k: TILE_NAME_MAPPING[k])


def tile_connections(name):
    return all_square2_connection_sets()[TILE_NAME_MAPPING[name] - 1]


def tile_circuits(name, pps=2):
    conns = tile_connections(name)
    circuits = square_connection_circuits(pps, conns)
    white = [c for c in circuits if c[0] % 2 == 1]
    black = [c for c in circuits if c[0] % 2 == 0]
    return white, black


# ---------- tilings ----------

def tile_depth(m):
    # m = (a,b,c,d) affine 2x2 part; det = a*d - b*c ; depth = -log2(sqrt(det))
    a, b, c, d = m[:4]
    det = a * d - b * c
    return -round(math.log2(math.sqrt(abs(det))))


def transform_tiling(tiling, t):
    # tiling entries: (motifIndex, affine (a,b,c,d,tx,ty))
    return [(mid, matmul(t, af)) for mid, af in tiling]


def matmul(t, m):
    a1, b1, c1, d1, tx1, ty1 = t
    a2, b2, c2, d2, tx2, ty2 = m
    return (
        a1 * a2 + b1 * c2,
        a1 * b2 + b1 * d2,
        c1 * a2 + d1 * c2,
        c1 * b2 + d1 * d2,
        a1 * tx2 + b1 * ty2 + tx1,
        c1 * tx2 + d1 * ty2 + ty1,
    )


def square_tiling(squares):
    out = []
    for (ll, s) in squares:
        out.append((1, (s, 0, 0, s, ll[0], ll[1])))
    return out


def checkerboard_tiling(n):
    sq = []
    for i in range(n):
        for j in range(n):
            if (i + j) % 2 == 0:
                sq.append(((i, j), 1))
            else:
                sq.append(((i, j), 0.5))
                sq.append(((i, j + 0.5), 0.5))
                sq.append(((i + 0.5, j), 0.5))
                sq.append(((i + 0.5, j + 0.5), 0.5))
    return square_tiling(sq)


def grid_tiling(rows, cols):
    sq = []
    for i in range(rows):
        for j in range(cols):
            sq.append(((i, j), 1))
    return square_tiling(sq)


def compose_tilings(t, ts_list):
    out = []
    for mid, af in t:
        for m2, af2 in ts_list[mid - 1]:
            out.append((m2, matmul(af, af2)))
    return out


def surround_tiling(n):
    unit = square_tiling(
        [((0.5, 0.5), 1)]
        + [((i * 0.5, 0), 0.5) for i in range(4)]
        + [((i * 0.5, 1.5), 0.5) for i in range(4)]
        + [((0, i * 0.5), 0.5) for i in (1, 2)]
        + [((1.5, i * 0.5), 0.5) for i in (1, 2)]
    )
    tiles = []
    seen = set()
    for i in range(n):
        for j in range(n):
            tr = (1, 0, 0, 1, 1.5 * i, 1.5 * j)
            for mid, af in transform_tiling(unit, tr):
                key = (mid, tuple(round(v, 9) for v in af))
                if key not in seen:
                    seen.add(key)
                    tiles.append((mid, af))
    return tiles


def random_square_subdivision_tiling(n, rnd, d=float('inf')):
    tiling = [(1, (1, 0, 0, 1, 0, 0))]
    QUADS = [
        (0.5, 0, 0, 0.5, 0, 0),
        (0.5, 0, 0, 0.5, 0, 0.5),
        (0.5, 0, 0, 0.5, 0.5, 0),
        (0.5, 0, 0, 0.5, 0.5, 0.5),
    ]
    for _ in range(n):
        while True:
            pos = rnd.randrange(len(tiling))
            if tile_depth(tiling[pos][1]) < d:
                break
        t = tiling[pos][1]
        new = [(1, matmul(t, q)) for q in QUADS]
        tiling = tiling[:pos] + new + tiling[pos + 1:]
    return tiling


# ---------- rasterizer ----------

class Canvas:
    def __init__(self, w, h, bg=(255, 255, 255)):
        self.w, self.h = w, h
        self.px = bytearray(w * h * 3)
        for y in range(h):
            for x in range(w):
                i = (y * w + x) * 3
                self.px[i:i + 3] = bytes(bg)

    def fill_poly(self, pts, color, xform=None, rule='nonzero'):
        """Nonzero-winding (default) or even-odd scanline fill. World coords."""
        if len(pts) < 3:
            return
        tx = []
        miny = 1e18
        maxy = -1e18
        for (x, y) in pts:
            if xform:
                a, b, c, d, e, f = xform
                X = a * x + c * y + e
                Y = b * x + d * y + f
            else:
                X, Y = x, y
            tx.append((X, Y))
            if Y < miny:
                miny = Y
            if Y > maxy:
                maxy = Y
        y0 = max(0, int(math.floor(miny)) - 1)
        y1 = min(self.h - 1, int(math.ceil(maxy)) + 1)
        n = len(tx)
        for py in range(y0, y1 + 1):
            yc = py + 0.5
            xs = []
            # collect signed crossings: +1 when edge crosses upward (y increasing),
            # -1 when downward. Scanline pixel coordinates are screen-y (already
            # flipped by the transform), so "upward" here is in transformed space.
            xs = []
            for i in range(n):
                x1_, y1_ = tx[i]
                x2_, y2_ = tx[(i + 1) % n]
                if (y1_ <= yc < y2_):
                    t = (yc - y1_) / (y2_ - y1_)
                    xs.append((x1_ + t * (x2_ - x1_), 1))
                elif (y2_ <= yc < y1_):
                    t = (yc - y1_) / (y2_ - y1_)
                    xs.append((x1_ + t * (x2_ - x1_), -1))
            xs.sort(key=lambda p: p[0])
            winding = 0
            run_start = None
            for k in range(len(xs)):
                x_prev, dir_prev = xs[k]
                if k + 1 < len(xs):
                    x_next, _ = xs[k + 1]
                else:
                    x_next = None
                winding += dir_prev
                if rule == 'nonzero':
                    inside = winding != 0
                else:
                    inside = (winding & 1) == 1
                if inside and run_start is None:
                    run_start = x_prev
                elif not inside and run_start is not None:
                    xa = max(0, int(math.ceil(run_start - 0.5)))
                    xb = min(self.w - 1, int(math.floor(x_prev - 0.5)))
                    for pxx in range(xa, xb + 1):
                        idx = (py * self.w + pxx) * 3
                        self.px[idx:idx + 3] = bytes(color)
                    run_start = None

    def to_png(self, path):
        raw = bytearray()
        for y in range(self.h):
            raw.append(0)
            raw += self.px[y * self.w * 3:(y + 1) * self.w * 3]

        def chunk(typ, payload):
            c = struct.pack('>I', len(payload)) + typ + payload
            return c + struct.pack('>I', zlib.crc32(typ + payload) & 0xffffffff)

        ihdr = struct.pack('>IIBBBBB', self.w, self.h, 8, 2, 0, 0, 0)
        data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(bytes(raw), 6)) + chunk(b'IEND', b'')
        open(path, 'wb').write(data)


BLACK = (0, 0, 0)
WHITE = (255, 255, 255)


def render_circuits(canvas, white_circs, black_circs, pps=2, world=1.0, origin=(0, 0)):
    """draw a tile's circuits (white first, then black) in tile space."""
    for circ in white_circs:
        pts = arc_circuit_polygon(pps, circ)
        canvas.fill_poly(pts, WHITE)
    for circ in black_circs:
        pts = arc_circuit_polygon(pps, circ)
        canvas.fill_poly(pts, BLACK)


def render_tiling(canvas, tiling, motif_name, pix_per_unit, bg_origin=(0, 0), invert=False):
    """Sort tiles by depth ascending; invert circuit colors on odd depth."""
    order = sorted(tiling, key=lambda t: tile_depth(t[1]))
    for mid, af in order:
        odd = tile_depth(af) % 2 == 1
        w, b = tile_circuits(motif_name)
        if odd != invert:
            w, b = b, w
        scale = pix_per_unit
        a, b_, c, d, e, f = af
        xform = (a * scale, b_ * scale, c * scale, d * scale,
                 e * scale - bg_origin[0] * scale, f * scale - bg_origin[1] * scale)
        for circ in w:
            canvas.fill_poly(arc_circuit_polygon(2, circ), WHITE, xform)
        for circ in b:
            canvas.fill_poly(arc_circuit_polygon(2, circ), BLACK, xform)


# ---------- CLI demo renders ----------


def render_all_tiles_grid(path, cell=200, cols=4, cell_pad=8):
    names = TILE_ORDER
    rows = (len(names) + cols - 1) // cols
    label_h = 26
    tile_h = cell + label_h
    margin = 14
    W = cols * (cell + cell_pad) + cell_pad + 2 * margin
    H = rows * (tile_h + cell_pad) + cell_pad + 2 * margin
    cv = Canvas(W, H, bg=(255, 255, 255))
    for k, name in enumerate(names):
        cx = k % cols
        cy = k // cols
        x0 = margin + cx * (cell + cell_pad)
        y0 = margin + label_h + cy * (tile_h + cell_pad)
        xf = (cell, 0, 0, -cell, x0, y0 + cell)
        w, b = tile_circuits(name)
        for circ in w:
            cv.fill_poly(arc_circuit_polygon(2, circ), WHITE, xf)
        for circ in b:
            cv.fill_poly(arc_circuit_polygon(2, circ), BLACK, xf)
        # thin gray border around the unit tile (like Carlson's figures)
        _rect_outline(cv, x0, y0, x0 + cell, y0 + cell, (170, 170, 170))
    cv.to_png(path)
    print('wrote', path, f'{W}x{H}', f'{len(names)} tiles')


def _rect_outline(cv, x0, y0, x1, y1, color):
    for x in range(int(x0), int(x1) + 1):
        for y in (int(y0), int(y1)):
            if 0 <= x < cv.w and 0 <= y < cv.h:
                i = (y * cv.w + x) * 3
                cv.px[i:i + 3] = bytes(color)
    for y in range(int(y0), int(y1) + 1):
        for x in (int(x0), int(x1)):
            if 0 <= x < cv.w and 0 <= y < cv.h:
                i = (y * cv.w + x) * 3
                cv.px[i:i + 3] = bytes(color)


def render_checkerboard(name, n, size, path):
    t = checkerboard_tiling(n)
    cv = Canvas(size, size, bg=(255, 255, 255))
    render_tiling(cv, t, name, size / (n + 0.0), bg_origin=(0, 0))
    cv.to_png(path)
    print('wrote', path)


def render_single_tile(name, size, path, bg=(211, 211, 211)):
    cv = Canvas(size, size, bg=bg)
    xf = (size, 0, 0, -size, 0, size)
    w, b = tile_circuits(name)
    for circ in w:
        cv.fill_poly(arc_circuit_polygon(2, circ), WHITE, xf)
    for circ in b:
        cv.fill_poly(arc_circuit_polygon(2, circ), BLACK, xf)
    cv.to_png(path)
    print('wrote', path)


if __name__ == '__main__':
    import sys
    mode = sys.argv[1] if len(sys.argv) > 1 else 'grid'
    if mode == 'grid':
        render_all_tiles_grid('ref_render_tiles.png')
    elif mode == 'single':
        render_single_tile(sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 428, f'ref_render_{sys.argv[2].replace(".", "")}.png')
    elif mode == 'check':
        render_checkerboard(sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), f'ref_render_checker_{sys.argv[2].replace(".", "")}.png')
