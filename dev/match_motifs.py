# Compare Carlson's 15-motif figure against model renderings, scanning
# tile scale within each grid cell; tiles are cell-centered.
import sys
sys.path.insert(0, 'dev')
import port
from zoom import read_png

W, H, rgb = read_png('ref_motifs.png')
COLS, ROWS = 5, 3

def lum(i):
    return (rgb[i*3]*299 + rgb[i*3+1]*587 + rgb[i*3+2]*114)//1000

def cell_bits(c, r):
    x0, x1 = c*W//COLS, (c+1)*W//COLS
    y0, y1 = r*H//ROWS, (r+1)*H//ROWS
    w, h = x1-x0, y1-y0
    bits = bytearray(w*h)
    for y in range(h):
        for x in range(w):
            bits[y*w+x] = 1 if lum((y0+y)*W + x0+x) < 90 else 0
    return bits, w, h

def render_tile(name, w, h, s, yup):
    _, black = port.tile_circuits(name)
    cv = port.Canvas(w, h, (0, 0, 0))
    # tile square centered in cell at scale s*cell, tile-local (0,0) center
    cx, cy = w/2, h/2
    for circ in black:
        pts = port.arc_circuit_polygon(2, circ)
        out = []
        for (X, Y) in pts:
            u, v = X - 0.5, Y - 0.5
            out.append((cx + u*s*w, (cy - v*s*h) if yup else (cy + v*s*h)))
        cv.fill_poly(out, (255, 255, 255))
    return bytearray(1 if cv.px[i*3] > 127 else 0 for i in range(w*h))

def iou(a, b):
    inter = sum(1 for x, y in zip(a, b) if x and y)
    union = sum(1 for x, y in zip(a, b) if x or y)
    return inter/union if union else 0.0

SCALES = [0.45, 0.5, 0.55, 0.6, 0.65, 0.7]
names = port.TILE_ORDER
for r in range(ROWS):
    for c in range(COLS):
        bits, w, h = cell_bits(c, r)
        best = []
        for name in names:
            for yup in (True, False):
                for s in SCALES:
                    q = iou(bits, render_tile(name, w, h, s, yup))
                    best.append((q, name, 'yup' if yup else 'ydown', s))
        best.sort(reverse=True)
        top = best[:4]
        print(f'cell ({r},{c}): ' + '  '.join(f'{n}/{o}/s{ss}:{q:.2f}' for q, n, o, ss in top))
