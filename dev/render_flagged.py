import sys; sys.path.insert(0,'dev')
import port
from port import Canvas
from zoom import write_png
for name in ('yn','yw','ye','ys','anw','ane','asw','ts','tw','x.','p'):
    S=300
    cv=Canvas(S,S,(211,211,211))
    def wmap(X,Y): return ((X+0.5)/2*S,(1.5-Y)/2*S)
    white,black=port.tile_circuits(name)
    for grp,col in ((white,(255,255,255)),(black,(0,0,0))):
        for circ in grp:
            pts=port.arc_circuit_polygon(2,circ)
            cv.fill_poly([wmap(X,Y) for X,Y in pts], col)
    write_png(f'flag_{name}.png', S,S, bytes(cv.px))
# contact sheet
from zoom import read_png
names=('yn','yw','ye','ys','anw','ane','asw','ts','tw','x.','p')
S=300; s=1
out=bytearray(len(names)*S*S*3)
for i,n in enumerate(names):
    w2,h2,px2 = read_png(f'flag_{n}.png')
    for y in range(S):
        for x in range(S):
            o=(y*len(names)*S+i*S+x)*3; src=(y*w2+x)*3; out[o:o+3]=px2[src:src+3]
write_png('flag_sheet.png', len(names)*S, S, bytes(out))
