import sys; sys.path.insert(0,'dev')
import port
from dev.zoom import write_png
from port import Canvas
S2=198
cv=Canvas(S2,S2,(211,211,211))
def wmap(X,Y): return ((X+0.5)/2*S2,(1.5-Y)/2*S2)
name = chr(92)
white,black=port.tile_circuits(name)
print('white circuits:', white and [c for c in white] if isinstance(white,list) else type(white))
for grp,col in ((white,(255,255,255)),(black,(0,0,0))):
    for circ in grp:
        pts=port.arc_circuit_polygon(2,circ)
        cv.fill_poly([wmap(X,Y) for X,Y in pts], col)
write_png('dbg_backslash.png', S2,S2, bytes(cv.px))
dark=sum(1 for i in range(0,len(cv.px),3) if cv.px[i]<50)
print('dark px:', dark, '/', S2*S2)
