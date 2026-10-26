# Locate the gray grid lines in ref_multiscaletiles2.png, then compare the
# drawn black curves against our model's arc descriptors for the '/' tile,
# in math-yup display orientation. If model is right, 1/3-radius arc must
# hug the lower-left corner of the LEFT half tile, 2/3-radius hug upper-left.
import sys
sys.path.insert(0, 'dev')
import port
from zoom import read_png

W, H, rgb = read_png('ref_multiscaletiles2.png')
print('image', W, 'x', H)

def lum(x, y):
    i = (y * W + x) * 3
    return (rgb[i]*299 + rgb[i+1]*587 + rgb[i+2]*114)//1000

# find near-vertical gray columns (grid lines are light gray ~200ish)
def col_dark(y0, y1, x):
    return sum(1 for y in range(y0, y1) if lum(x, y) < 230)

cands = []
for x in range(2, W-2):
    c = col_dark(10, H-10, x)
    if c > 0.8*(H-20):
        cands.append(x)
print('vertical line candidate columns:', cands)

rows = []
for y in range(2, H-2):
    c = sum(1 for x in range(10, W-10) if lum(x, y) < 230)
    if c > 0.5*(W-20):
        rows.append(y)
print('row candidates:', rows[:50])
