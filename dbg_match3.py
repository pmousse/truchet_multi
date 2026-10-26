import sys; sys.path.insert(0,'dev')
import port
from port import Canvas
from dev.zoom import read_png
w,h,px = read_png('ref_motifs_big.png')
cols,rows=5,3; cw,ch=w//cols,h//rows
SS=40  # sample grid per cell
def cell_bin(r,c):
    x0,y0=c*cw,r*ch
    out=[]
    for sy in range(SS):
        for sx in range(SS):
            # area-average the block
            bx0=x0+sx*cw//SS; bx1=x0+(sx+1)*cw//SS
            by0=y0+sy*ch//SS; by1=y0+(sy+1)*ch//SS
            tot=0;n=0
            for yy in range(by0,by1):
                for xx in range(bx0,bx1):
                    i=(yy*w+xx)*3; tot+=(px[i]+px[i+1]+px[i+2])//3;n+=1
            out.append(1 if tot/max(n,1)<128 else 0)
    return out
S2=396   # high-res render, supersample for area-average
def render_bin(name):
    cv=Canvas(S2,S2,(211,211,211))
    def wmap(X,Y): return ((X+0.5)/2*S2,(1.5-Y)/2*S2)
    white,black=port.tile_circuits(name)
    for grp,col in ((white,(255,255,255)),(black,(0,0,0))):
        for circ in grp:
            pts=port.arc_circuit_polygon(2,circ)
            cv.fill_poly([wmap(X,Y) for X,Y in pts], col)
    out=[]
    for sy in range(SS):
        for sx in range(SS):
            bx0=sx*S2//SS; bx1=(sx+1)*S2//SS
            by0=sy*S2//SS; by1=(sy+1)*S2//SS
            tot=0;n=0
            for yy in range(by0,by1):
                for xx in range(bx0,bx1):
                    i=(yy*S2+xx)*3; tot+=1 if cv.px[i]<128 else 0;n+=1
            out.append(1 if tot/max(n,1)>0.5 else 0)
    return out
renders={name:render_bin(name) for name in port.TILE_ORDER}
for r in range(rows):
    for c in range(cols):
        cell=cell_bin(r,c)
        best=sorted((sum(a!=b for a,b in zip(ours,cell)), name) for name,ours in renders.items())
        diffs,bestn=best[0]
        print(f'r{r+1}c{c+1}: {bestn:5s} diff={diffs:4d}/{SS*SS}  next={best[1][1]}({best[1][0]})')
