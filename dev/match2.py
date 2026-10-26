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

def render_tile(name, w, h, s, yup, ox, oy):
    _, black = port.tile_circuits(name)
    cv = port.Canvas(w, h, (0, 0, 0))
    cx, cy = w/2 + ox*w, h/2 + oy*h
    for circ in black:
        pts = port.arc_circuit_polygon(2, circ)
        out = [(cx + (X-0.5)*s*w, (cy - (Y-0.5)*s*h) if yup else (cy + (Y-0.5)*s*h))
               for (X, Y) in pts]
        cv.fill_poly(out, (255, 255, 255))
    return bytearray(1 if cv.px[i*3] > 127 else 0 for i in range(w*h))

def iou(a, b):
    inter = sum(1 for x, y in zip(a, b) if x and y)
    union = sum(1 for x, y in zip(a, b) if x or y)
    return inter/union if union else 0.0

SCALES = [0.34, 0.38, 0.42, 0.45, 0.5, 0.54, 0.58, 0.62, 0.66, 0.7]
OFFS = [(0,0), (0.04,0), (-0.04,0), (0,0.04), (0,-0.04), (0.08,0), (-0.08,0), (0,0.08), (0,-0.08)]
names = port.TILE_ORDER
for r in range(ROWS):
    for c in range(COLS):
        bits, w, h = cell_bits(c, r)
        best = []
        for name in names:
            for yup in (True, False):
                for s in SCALES:
                    for ox, oy in OFFS:
                        q = iou(bits, render_tile(name, w, h, s, yup, ox, oy))
                        best.append((q, name, 'yup' if yup else 'ydown', s, ox, oy))
        best.sort(reverse=True)
        top = best[:3]
        print(f'cell ({r},{c}): ' + '  '.join(f'{n}/{o}/s{s}/o{o1},{o2}:{q:.2f}' for q, n, o, s, o1, o2 in top))
