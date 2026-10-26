"""_mandqa.py -- verify the Mandala tab against a Python oracle.

The oracle re-implements the mandala model (build), the conformal log-polar
warp and the painter's algorithm in pure Python on top of dev/port.py (the
faithful port of Carlson's tile geometry), rasterises it scanline by scanline,
and compares the result pixel-for-pixel with a headless-Chrome screenshot of
dev/mandtest.html.

Canvas rasterisation is not reproducible exactly (anti-aliasing, round stroke
joins, arc tessellation), so disagreements are classified:

  edge  - the pixel disagrees, but a matching pixel exists within EDGE_R (4 px):
          a boundary band. Expected and tolerated.
  deep  - a solid region the two models genuinely disagree about

Pass criterion: no case may exceed DEEP_BUDGET deep pixels, and no deep run may
be wider or taller than RUN_LIMIT pixels.  Lone 1-4 px boundary residuals are
inherent to comparing a scanline rasteriser with canvas anti-aliasing; a real
geometric regression produces deep runs many pixels wide, which trips the gate.

Set MANDQA_EDGE_R to tighten or loosen the boundary tolerance when debugging.

Usage:
  python dev/_mandqa.py                 # standard test matrix
  python dev/_mandqa.py --img <rings> <sectors> <sym> <ringMode> <pool> <seed> [invert] [hub] [palette]
  python dev/_mandqa.py <rings> <sectors> <sym> <ringMode> <pool> <seed> [invert] [hub] [palette]
"""
import sys, os, re, math, subprocess
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
import port
from seedrand import mulberry32, seed_from_string
from zoom import read_png, write_png

DEG = math.pi / 180.0
MAX_SWEEP = 1.2 * DEG
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
TOL = 48            # per-channel tolerance when comparing canvas vs oracle
EDGE_R = int(os.environ.get('MANDQA_EDGE_R', '4'))   # radius within which a
# neighbouring matching pixel counts as an anti-aliased edge rather than a failure
DEEP_BUDGET = 60      # deep pixels allowed per case (canvas AA residuals)
RUN_LIMIT = 8         # a deep run wider than this is a real geometric mismatch
W = H = 500


def palettes():
    """Read the palette table straight out of the engine to stay in sync."""
    src = open(os.path.join(ROOT, 'src', 'engine.js'), encoding='utf-8').read()
    block = re.search(r'const PALETTES = \{(.*?)\n  \};', src, re.S).group(1)
    out = {}
    for key, c0, c1 in re.findall(r"(\w+):\s*\['(#[0-9a-fA-F]{6})',\s*'(#[0-9a-fA-F]{6})'\]", block):
        out[key] = [c0, c1]
    return out


PAL = palettes()


def hexrgb(h):
    h = h.lstrip('#')
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


PT = {n: port.coordinate(2, n) for n in range(1, 4 * 2 + 1)}
SETS = [list(c) for c in port.all_square2_connection_sets()]
NAME_OF = {v: k for k, v in port.TILE_NAME_MAPPING.items()}


def set_key(conns):
    return ','.join(sorted(f'{min(a, b)}-{max(a, b)}' for a, b in conns))


SET_INDEX = {set_key(c): i + 1 for i, c in enumerate(SETS)}
PKEY = {(f'{p[0]:.9f},{p[1]:.9f}'): n for n, p in PT.items()}


def mirror_set_x(idx):
    """Reflect a connection set in x (u -> 1-u), same as mandala.js mirrorSetX."""
    mapped = []
    for a, b in SETS[idx - 1]:
        pa, pb = PT[a], PT[b]
        qa = PKEY[f'{1 - pa[0]:.9f},{pa[1]:.9f}']
        qb = PKEY[f'{1 - pb[0]:.9f},{pb[1]:.9f}']
        mapped.append((min(qa, qb), max(qa, qb)))
    return SET_INDEX.get(set_key(mapped), idx)


def build(rings, sectors, sym, ring_mode, seed, pool_names):
    """Mirror of mandala.js build(): same seed salt, wedge size and draw order."""
    dth = 2 * math.pi / sectors
    radii = [1.0]
    if ring_mode == 'even':
        for i in range(1, rings + 1):
            radii.append(1.0 + i)
    else:
        g = math.exp(dth)
        for i in range(rings):
            radii.append(radii[i] * g)

    rot_k = 0
    if isinstance(sym, int) and sym > 1 and sectors % sym == 0:
        rot_k = sym
    mirror = (sym == 'mirror') and (sectors % 2 == 0)
    wedge_n = (sectors // rot_k) if rot_k else (sectors // 2 if mirror else sectors)

    salt = '\x01mandala:' + str(sectors) + ':' + str(rings)
    rnd = mulberry32(seed_from_string(str(seed) + salt))
    pool_idx = [port.TILE_NAME_MAPPING[n] for n in pool_names]

    cells = []
    for i in range(rings):
        half = [pool_idx[int(rnd() * len(pool_idx)) % len(pool_idx)]
                for _ in range(wedge_n)]
        ring = []
        for j in range(sectors):
            if mirror and j >= wedge_n:
                idx = mirror_set_x(half[sectors - 1 - j])
            elif rot_k:
                idx = half[j % wedge_n]
            else:
                idx = half[j]
            ring.append({'conn': idx, 'th0': j * dth,
                         'r0': radii[i], 'r1': radii[i + 1]})
        cells.append(ring)
    max_dr = max(radii[i + 1] - radii[i] for i in range(rings))
    return {'cells': cells, 'radii': radii, 'dth': dth, 'rings': rings,
            'maxDr': max_dr, 'rInner': radii[0], 'rOuter': radii[rings]}


def warp_poly(pts, cell, dth, cx, cy, s):
    """Replica of mandala.js warpStroke (conformal log-polar map)."""
    def project(u, v):
        r = cell['r0'] * (cell['r1'] / cell['r0']) ** v
        th = cell['th0'] + u * dth
        return (cx + s * r * math.cos(th), cy - s * r * math.sin(th))

    out = []
    for k, (u, v) in enumerate(pts):
        if k == 0:
            out.append(project(u, v))
            continue
        pu, pv = pts[k - 1]
        steps = max(1, math.ceil(abs((u - pu) * dth) / MAX_SWEEP))
        for t in range(1, steps + 1):
            out.append(project(pu + (u - pu) * t / steps, pv + (v - pv) * t / steps))
    return out


def spans(poly, yc):
    """Scanline crossings of a polygon, each paired with how far a stroke of
    unit half-width expands it along the scanline: a boundary crossing whose
    local slope is dx/dy moves horizontally by sqrt(1 + (dx/dy)^2) times the
    perpendicular offset (capped, because real strokes use round joins)."""
    out = []
    crossings = []
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        if y0 == y1:
            continue
        if (y0 <= yc < y1) or (y1 <= yc < y0):
            slope = (x1 - x0) / (y1 - y0)
            crossings.append((x0 + (yc - y0) * slope, min(6.0, math.hypot(1.0, slope))))
    crossings.sort()
    for (xa, ga), (xb, gb) in zip(crossings[0::2], crossings[1::2]):
        out.append((xa, xb, ga, gb))
    return out


def paint_list(model, pal_hex, invert, w, h, pad):
    """Flattened painter's list, in the order mandala.js draws: outer ring
    first, per cell the under-coloured circuits then the top circuits.
    Each entry carries its own stroke width (mandala.js strokes every circuit
    in its own colour to close hairline lenses; model the same dilation)."""
    rings = model['rings']
    dth = model['dth']
    radii = model['radii']
    r_outer = radii[rings]
    max_dr = max(radii[i + 1] - radii[i] for i in range(rings))
    fit_r = r_outer + max_dr / 3.0
    s = (min(w, h) / 2.0) * (1 - pad) / fit_r
    cx, cy = w / 2.0, h / 2.0
    pal = [hexrgb(c) for c in pal_hex]

    out = []
    for i in reversed(range(rings)):
        flip = invert and (i % 2 == 1)
        top, under = (pal[1], pal[0]) if flip else (pal[0], pal[1])
        for cell in model['cells'][i]:
            name = NAME_OF[cell['conn']]
            sw = max(0.6, s * ((cell['r0'] + cell['r1']) / 2) * dth * 0.045)
            white_circs, black_circs = port.tile_circuits(name, 2)
            polys = []
            for circs, color in ((white_circs, under), (black_circs, top)):
                group = []
                for circ in circs:
                    poly = warp_poly(port.arc_circuit_polygon(2, circ, step_deg=0.5),
                                     cell, dth, cx, cy, s)
                    xs = [p[0] for p in poly]
                    ys = [p[1] for p in poly]
                    group.append(((min(xs) - sw, min(ys) - sw,
                                   max(xs) + sw, max(ys) + sw), poly))
                polys.append((group, color, sw))
            out.append((i, cell['th0'], polys))
    return out, s, cx, cy


def hub_draw(model, hub, s, cx, cy, color):
    """Hub geometry as in mandala.js render(): disc radius rInner*s*0.55,
    outline ring at rInner*s with the same line width used for the hub ring."""
    r_hub = (model['rInner'] * s if hub == 'ring'
             else model['rInner'] * s * 0.55)
    lw = max(1.0, model['maxDr'] * s * 0.12)
    return (hub, r_hub, lw, color)


def raster(order, hubinfo, ground, w, h, cx, cy):
    """Scanline-fill the painter's list into an RGB byte array."""
    img = bytearray(w * h * 3)
    for x in range(w * h):
        i = x * 3
        img[i] = ground[0]
        img[i + 1] = ground[1]
        img[i + 2] = ground[2]

    flat = []
    for _, _, polys in order:
        for group, color, sw in polys:
            for bbox, poly in group:
                flat.append((bbox, poly, color, sw / 2.0))

    for y in range(h):
        yc = y + 0.5
        for bbox, poly, color, grow in flat:
            if bbox[1] > yc or bbox[3] < yc:
                continue
            for x0, x1, g0, g1 in spans(poly, yc):
                a = max(0, int(math.floor(x0 - 0.5 - grow * g0)))
                b = min(w - 1, int(math.ceil(x1 - 0.5 + grow * g1)))
                row = y * w * 3
                for x in range(a, b + 1):
                    i = row + x * 3
                    img[i] = color[0]
                    img[i + 1] = color[1]
                    img[i + 2] = color[2]

    kind, r_hub, lw, color = hubinfo
    if kind != 'none':
        for y in range(h):
            for x in range(w):
                d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
                hit = d <= r_hub if kind == 'disc' else abs(d - r_hub) <= lw / 2.0
                if hit:
                    i = (y * w + x) * 3
                    img[i], img[i + 1], img[i + 2] = color
    return img


def shoot(query, out_png, w, h):
    url = 'file:///' + os.path.join(ROOT, 'dev', 'mandtest.html').replace('\\', '/') + '#' + query
    out = os.path.abspath(out_png).replace('/', '\\')
    subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--no-sandbox',
                    '--hide-scrollbars', '--force-device-scale-factor=1',
                    f'--window-size={w},{h}', '--virtual-time-budget=4000',
                    '--screenshot=' + out, url], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def classify(img_a, img_b, w, h):
    """Count pixels where the two images disagree, split into edge-class
    (explained by a matching pixel within EDGE_R) and deep (real disagreement),
    and report run-length statistics for the deep set."""
    bad = bytearray(w * h)
    for y in range(h):
        row = y * w * 3
        for x in range(w):
            i = row + x * 3
            if (abs(img_a[i] - img_b[i]) > TOL or abs(img_a[i + 1] - img_b[i + 1]) > TOL
                    or abs(img_a[i + 2] - img_b[i + 2]) > TOL):
                bad[y * w + x] = 1

    def near_match(p, x, y):
        i = p * 3
        for dy in range(-EDGE_R, EDGE_R + 1):
            yy = y + dy
            if yy < 0 or yy >= h:
                continue
            for dx in range(-EDGE_R, EDGE_R + 1):
                xx = x + dx
                if xx < 0 or xx >= w:
                    continue
                k = yy * w + xx
                if bad[k]:
                    continue
                j = k * 3
                # the canvas value at p matches the oracle somewhere nearby, or
                # the oracle value at p matches the canvas somewhere nearby
                if (abs(img_a[j] - img_b[i]) <= TOL
                        or abs(img_a[i] - img_b[j]) <= TOL):
                    return True
        return False

    deep = edge = 0
    deepmap = bytearray(w * h)
    for p in range(w * h):
        if not bad[p]:
            continue
        x, y = p % w, p // w
        if near_match(p, x, y):
            edge += 1
        else:
            deep += 1
            deepmap[p] = 1

    runs, tallest = [], 0
    for y in range(h):
        run = 0
        for x in range(w):
            if deepmap[y * w + x]:
                run += 1
                vert = 0
                while vert < 16 and y + vert < h and deepmap[(y + vert) * w + x]:
                    vert += 1
                tallest = max(tallest, vert)
            elif run:
                runs.append(run)
                run = 0
        if run:
            runs.append(run)
    med = runs[len(runs) // 2] if runs else 0
    p95 = runs[int(len(runs) * 0.95)] if runs else 0
    widest = max(runs) if runs else 0
    return deep, edge, med, p95, widest, tallest, deepmap


def run_case(rings, sectors, sym, ring_mode, pool, seed, invert='1', hub='disc',
             pal_name='bw', dump=False):
    sym_v = sym if sym in ('free', 'mirror') else int(sym)
    pool_names = port.MOTIF_NAMES if pool == 'mix' else pool.split(',')
    model = build(rings, sectors, sym_v, ring_mode, seed, pool_names)
    pal_hex = PAL[pal_name]
    order, s, cx, cy = paint_list(model, pal_hex, invert == '1', W, H, 0.02)
    hubinfo = hub_draw(model, hub, s, cx, cy, hexrgb(pal_hex[0]))
    oracle = raster(order, hubinfo, hexrgb(pal_hex[1]), W, H, cx, cy)

    from urllib.parse import quote
    query = (f'rg={rings}&sc={sectors}&sy={sym}&rw={ring_mode}'
             f'&m={quote(pool, safe=",")}&sd={quote(seed)}&mi={invert}'
             f'&hb={hub}&p={pal_name}&W={W}&H={H}&pd=0.02')
    png = os.path.join(ROOT, 'dev', 'browse', 'mand_qa.png')
    shoot(query, png, W, H)
    w, h, browser = read_png(png)
    if (w, h) != (W, H):
        print(f'SCREENSHOT SIZE {w}x{h} != {W}x{H}')
        return 1, True

    deep, edge, med, p95, widest, tallest, deepmap = classify(oracle, browser, W, H)
    tag = f'r{rings} s{sectors} {sym} {ring_mode} pool={pool} hub={hub} pal={pal_name}'
    print(f'{tag:52s} deep={deep:5d}  edge={edge:6d}  runs med={med} p95={p95} max={widest} tall={tallest}')
    if deep > DEEP_BUDGET or widest > RUN_LIMIT or tallest > RUN_LIMIT:
        print(f'   ** OVER BUDGET (deep>{DEEP_BUDGET} or run>{RUN_LIMIT}) **')
        over = True
    else:
        over = False

    if dump:
        write_png(os.path.join(ROOT, 'dev', 'browse', 'mand_oracle.png'), W, H, oracle)
        write_png(os.path.join(ROOT, 'dev', 'browse', 'mand_browser.png'), W, H, bytearray(browser))
        diff = bytearray(W * H * 3)
        for p in range(W * H):
            i = p * 3
            diff[i] = 255 if oracle[i] > browser[i] else 0
            diff[i + 1] = 0
            diff[i + 2] = 255 if oracle[i] < browser[i] else 0
        write_png(os.path.join(ROOT, 'dev', 'browse', 'mand_diff.png'), W, H, diff)
        mask = bytearray(W * H * 3)
        for p in range(W * H):
            if deepmap[p]:
                mask[p * 3:p * 3 + 3] = b'\xff\xff\xff'
        write_png(os.path.join(ROOT, 'dev', 'browse', 'mand_deep.png'), W, H, mask)
        # cluster the deep pixels into 25x25 blocks to show where they live
        grid = {}
        for y in range(H):
            for x in range(W):
                if deepmap[y * W + x]:
                    k = (x // 25, y // 25)
                    grid[k] = grid.get(k, 0) + 1
        hot = sorted(grid.items(), key=lambda kv: -kv[1])[:8]
        print('   hot blocks (x,y):count ->',
              ', '.join(f'({k[0] * 25}-{k[0] * 25 + 25},{k[1] * 25}-{k[1] * 25 + 25}):{v}' for k, v in hot))
        print('   wrote dev/browse/mand_oracle.png, mand_browser.png, mand_diff.png, mand_deep.png')
    return deep, over


MATRIX = [
    (1, 8, 'free', 'auto', '/', 'k7x2m9'),
    (4, 24, 'mirror', 'auto', '/', 'k7x2m9'),
    (6, 16, '4', 'auto', 'fnw,tn', 'abc123'),
    (3, 40, 'free', 'even', 'mix', 'zq9'),
    (5, 12, 'mirror', 'even', 'tn,fnw,+', 'k7x2m9'),
    (4, 24, 'free', 'auto', 'mix', 'seed-77', '1', 'none', 'ink'),
]


def main():
    argv = sys.argv[1:]
    dump = False
    if argv and argv[0] == '--img':
        dump = True
        argv = argv[1:]
    if len(argv) >= 6:
        deep, over = run_case(int(argv[0]), int(argv[1]), argv[2], argv[3], argv[4], argv[5],
                              *(argv[6:9] or ['1', 'disc', 'bw']), dump=dump)
        sys.exit(1 if over else 0)
    bad_cases = 0
    total = 0
    for case in MATRIX:
        d, over = run_case(*case)
        total += d
        if over:
            bad_cases += 1
    print(f'TOTAL deep pixels: {total}  ({100.0 * total / (W * H * len(MATRIX)):.4f}% of compared pixels)')
    print('MANDALA QA', 'FAILED' if bad_cases else 'PASSED',
          f'(budget {DEEP_BUDGET} deep px/case, runs <= {RUN_LIMIT} px)')
    sys.exit(1 if bad_cases else 0)


if __name__ == '__main__':
    main()
