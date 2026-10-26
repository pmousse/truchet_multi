import re
lines = open('mstp/MultiScaleTruchetPatternExamples.nb', encoding='utf-8', errors='replace').read().split('\n')

STRRE = re.compile(r'"((?:[^"\\]|\\.)*)"')

def toks(seg):
    out = []
    for l in seg:
        if 'RowBox' not in l:
            continue
        for m in STRRE.finditer(l):
            out.append(m.group(1))
    return ' '.join(out)

for start, end in [(205,235),(285,330),(355,415),(460,500),(512,545),(2315,2340),(2440,2545)]:
    print('--- %d-%d ---' % (start, end))
    t = re.sub(r'\s+', ' ', toks(lines[start-1:end]))
    print(t[:1000])
    print()
