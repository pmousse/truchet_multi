import re
nb = open('mstp/MultiScaleTruchetPatternExamples.nb', encoding='utf-8', errors='replace').read()
BS = chr(92)
print('Grid count:', len(re.findall(r'Grid', nb)))
for m in re.finditer(r'Grid', nb):
    seg = nb[m.start():m.start()+15000]
    names = []
    for nm in re.finditer(r'SquareArcTile.{0,300}?\<(.*?)\>', seg, re.S):
        g = nm.group(1)
        while g.endswith(BS):
            g = g[:-1]
        names.append(g)
        if len(names) >= 30:
            break
    print('Grid at', m.start(), '->', len(names), names[:30])
