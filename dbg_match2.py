import sys; sys.path.insert(0,'dev')
import port
from port import Canvas
from dev.zoom import read_png
w,h,px = read_png('ref_motifs_big.png')
cols,rows=5,3; cw,ch=w//cols,h//rows
def sample(fn_w, step):
    return (fn_w + step - 1)//step
SCW, SCH = sample(cw,3), sample(ch,3)   # 29,29
cells=[]
for r in range(rows):
    for c in range(cols):
        x0,y0=c*cw,r*ch
        cell=[ (lambda i:(px[i]+px[i+1]+px[i+2])//3 )(((y0+yy)*w+x0+xx)*3)
               for yy in range(0,ch,3) for xx in range(0,cw,3) ]
        cells.append(cell)
S2=99
def render(name):
    cv=Canvas(S2,S2,(211,211,211))
    def wmap(X,Y): return ((X+0.5)/2*S2,(1.5-Y)/2*S2)
    white,black=port.tile_circuits(name)
    for grp,col in ((white,(255,255,255)),(black,(0,0,0))):
        for circ in grp:
            pts=port.arc_circuit_polygon(2,circ)
            cv.fill_poly([wmap(X,Y) for X,Y in pts], col)
    return [ (lambda i:(cv.px[i]+cv.px[i+1]+cv.px[i+2])//3)(yy*S2*3 and (yy*3)*S2+xx*3) for yy in range(0,S2,3) for xx in range(0,S2,3) ]
def resample(src,sw,sh,dw,dh):
    return [src[(y*sh//dh)*sw + x*sw//dw] for y in range(dh) for x in range(dw)]
grid_n = S2//3
for ci,cell in enumerate(cells):
    best=[]
    for name in port.TILE_ORDER:
        ours=resample(render(name),grid_n,grid_n,SCW,SCH)
        mad=sum(abs(a-b) for a,b in zip(ours,cell))/len(cell)
        best.append((round(mad,1),name))
    best.sort()
    r,c=divmod(ci,cols)
    print(f'r{r+1}c{c+1}: best={best[0]}  second={best[1]}  worst={best[-1]}')
