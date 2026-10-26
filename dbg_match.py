import sys; sys.path.insert(0,'dev')
import port
from dev.zoom import read_png
w,h,px = read_png('ref_motifs_big.png')
print('img', w,h)
cols,rows=5,3; cw,ch=w//cols,h//rows
x0,y0=0,0
cell=[]
for yy in range(0,ch,3):
    for xx in range(0,cw,3):
        i=((y0+yy)*w+x0+xx)*3
        cell.append((px[i]+px[i+1]+px[i+2])//3)
print('cell len', len(cell), 'mean', sum(cell)/len(cell))
import collections
hist=collections.Counter(cell)
print('common values:', hist.most_common(6))
S2=99
def render(name):
    from port import Canvas
    cv=Canvas(S2,S2,(211,211,211))
    def wmap(X,Y): return ((X+0.5)/2*S2,(1.5-Y)/2*S2)
    white,black=port.tile_circuits(name)
    for grp,col in ((white,(255,255,255)),(black,(0,0,0))):
        for circ in grp:
            pts=port.arc_circuit_polygon(2,circ)
            cv.fill_poly([wmap(X,Y) for X,Y in pts], col)
    g=[]
    for yy in range(0,S2,3):
        for xx in range(0,S2,3):
            i=(yy*S2+xx)*3; g.append((cv.px[i]+cv.px[i+1]+cv.px[i+2])//3)
    return g
def resample(src,sw,sh,dw,dh):
    return [src[(y*sh//dh)*sw + x*sw//dw] for y in range(dh) for x in range(dw)]
name=chr(92)
ours=resample(render(name),33,33,len(cell)//(ch//3),ch//3)
mad=sum(abs(a-b) for a,b in zip(ours,cell))/len(cell)
print('cell1 vs backslash MAD:', mad)
