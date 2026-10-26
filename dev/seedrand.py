# Exact JS mirrors of mulberry32 / seedFromString, randomSubdivision,
# and the stable motif assignment used in dev/test.html.
import sys, math
sys.path.insert(0, 'dev')

MASK = 0xFFFFFFFF

def mulberry32(seed):
    a = seed & MASK
    def rnd():
        nonlocal a
        a = (a + 0x6D2B79F5) & MASK
        t = a
        t = ((t ^ (t >> 15)) * (t | 1)) & MASK
        t = (t ^ ((t + ((t ^ (t >> 7)) * (t | 61)) & MASK) & MASK)) & MASK
        return ((t ^ (t >> 14)) & MASK) / 4294967296.0
    return rnd

def seed_from_string(s):
    h = 1779033703 ^ len(s)
    for ch in s:
        h = ((h ^ ord(ch)) * 3432918353) & MASK
        h = ((h << 13) | (h >> 19)) & MASK
    return h

def tile_depth(s):
    return round(-math.log2(s))

def random_subdivision(rnd, n, max_depth=4):
    tiles = [{'x': 0.0, 'y': 0.0, 's': 1.0}]
    for _ in range(n):
        cands = [i for i, t in enumerate(tiles) if tile_depth(t['s']) < max_depth]
        if not cands:
            break
        i = cands[int(rnd() * len(cands))]
        t = tiles[i]
        s = t['s'] / 2
        tiles.pop(i)
        tiles.extend([{'x': t['x'], 'y': t['y'], 's': s},
                      {'x': t['x'] + s, 'y': t['y'], 's': s},
                      {'x': t['x'], 'y': t['y'] + s, 's': s},
                      {'x': t['x'] + s, 'y': t['y'] + s, 's': s}])
    return tiles

def assign_motifs(tiles, seed_str):
    rnd = mulberry32(seed_from_string(seed_str))
    assign = {}
    for t in sorted(tiles, key=lambda t: (t['x'], t['y'], t['s'])):
        assign[(t['x'], t['y'], t['s'])] = 1 + int(rnd() * 24)
    return assign
