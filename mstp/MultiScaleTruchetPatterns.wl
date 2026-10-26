(* ::Package:: *)

BeginPackage["MultiScaleTruchetPatterns`"];


SquareArcTile::usage = "SquareArcTile[name] gives the named tile. SquareArcTile[n, connections] gives primitives that render a square arc tile\
 with 'n' evenly-spaced connections per side and the specified connections. Example: SquareArcTile[2, {1->4, 2->3, 5->8, 6->7}].";


SquareRectilinearTile::usage = "SquareRectilinearTile[n, connections] gives primitives that render a square rectilinear tile\
 with 'n' evenly-spaced connections per side and the specified connections. Example: SquareRectilinearTile[2, {1->4, 2->3, 5->8, 6->7}].";


SquareTileNames::usage = "SquareTileNames[] gives a list of the names of square tiles.";


InvertMotif::usage = "InvertMotif[motif] swaps black and white in 'motif'";


TriangleArcTile::usage = "TriangleArcTile[name] gives the named triangle arc tile. Name can be \".w\", \".e\", \".s\", \"...\", and \"y\"";


CheckerboardTiling::usage = "CheckerboardTiling[n] gives an n\[Times]n checkerboard tiling.";


SurroundTiling::usage = "SurroundTiling[n] gives an n\[Times]n surround tiling.";


OffsetSurroundTiling::usage = "OffsetSurroundTiling[m, n] gives an m\[Times]n offset surround tiling.";


RandomSquareSubdivisionTiling::usage = "RandomSquareSubdivisionTiling[n, d] yields a tiling by subdividing the unit square 'n' times to a maximum depth of 'd'.";


RandomTriangleSubdivisionTiling::usage = "RandomTriangleSubdivisionTiling[n, d] yields a tiling by subdividing a triangle 'n' times to a maximum depth of 'd'.";


SquareSubdivisionFillTiling::usage = "SquareSubdivisionFillTiling[region, {ll, size}, depth] yields a subdivision tiling that fills 'region'. The subdivision starts with a square with lower left corner 'll' and side length 'size'. Subdivision continues to a depth of 'depth'.";


GridTiling::usage = "GridTiling[{r, c}] gives a tiling of unit squares with 'r' rows and 'c' columns.";


SnubSquareTiling::usage = "SnubSquareTiling[{r, c}] gives a snub square tiling with 'r' rows and 'c' columns of unit cells.";


(* ::Text:: *)
(*xxx add symmetric surround tilings*)


(* ::Text:: *)
(*xxx add frieze tiling*)


(* ::Text:: *)
(*xxx implement higher-level checkerboard tiling using fractal subdivision and transforms*)


ShowTiling::usage = "ShowTiling[tiling, tile, options] shows 'tiling' populated with 'tile'. Specify option \"Parity\"->1 to swap black an white.";


ComposeTilings::usage = "ComposeTilings[tiling, {tiling1, tiling2, ...}] gives the composition of 'tiling' with the tilings in the list. The effect is to produce a tiling where 'tiling_n' acts as the nth tile in 'tiling'.";


RecursiveSubdivisionTiling::usage = "RecursiveSubdivisionTiling[program, depth] recursively subdivides according to 'program' to the specified 'depth'. Example program {1 -> {{t1, t3}, {t2, t4}} -> 2, 2 -> {{t2, t4}, {t1, t3}} -> 1} starts in state '1', applies t1 and t3 to the result of the last subdivision step, adds t2 and t4, and goes to state '2', etc.";


TransformTiling::usage = "TransformTiling[tiling, tx] transforms 'tiling' by the homogenous transform matrix 'tx'";


CropSquareTiling::usage = "CropSquareTiling[tiling, {{xMin, yMin}, {xMax, yMax}}] selects tiles in 'tiling' that lie within the rectangle {{xMin, yMin}, {xMax, yMax}}";


Tsw::usage = "Tsw gives the homogeneous transformation matrix that maps the unit square to its sw quadrant";


Tse::usage = "Tse gives the homogeneous transformation matrix that maps the unit square to its se quadrant";


Tne::usage = "Tne gives the homogeneous transformation matrix that maps the unit square to its ne quadrant";


Tnw::usage = "Tnw gives the homogeneous transformation matrix that maps the unit square to its nw quadrant";


T12::usage = "T12 gives the homogeneous transformation matrix that maps the unit equilateral triangle to the half-size sub-triangle at the 12 o'clock position.";


T4::usage = "T4 gives the homogeneous transformation matrix that maps the unit equilateral triangle to the half-size sub-triangle at the 4 o'clock position.";


T8::usage = "T8 gives the homogeneous transformation matrix that maps the unit equilateral triangle to the half-size sub-triangle at the 8 o'clock position.";


Tc::usage = "Tc gives the homogeneous transformation matrix that maps the unit equilateral triangle to the half-size sub-triangle at the center position.";


Tsq90::usage = "Tsq90 gives the homogeneous transformation matrix that rotates the unit square by 90\[Degree].";


Tsq180::usage = "Tsq180 gives the homogeneous transformation matrix that rotates the unit square by 180\[Degree].";


Tsq270::usage = "Tsq270 gives the homogeneous transformation matrix that rotates the unit square by 270\[Degree].";


Tsqvr::usage = "Tsqvr gives the homogeneous transformation matrix that reflects the unit square about the vertical.";


Tsqhr::usage = "Tsqhr gives the homogeneous transformation matrix that reflects the unit square about the horizontal.";


ArcPoints::usage = "ArcPoints[c, r, a] gives points in 5\[Degree] increments on the arc described by Circle[c, r, a]";


Begin["`Private`"];


(* ::Section:: *)
(*Tiles*)


(* ::Subsection:: *)
(*Square Tiles*)


ArcPoints[c_, r_] :=
	ArcPoints[c, r, {0, 360}\[Degree]]


ArcPoints[c_,r_,{a1_,a2_}] :=
	ArcPoints[c, {r, r}, {a1, a2}]


ArcPoints[c_, {rx_, ry_}, {a1_, a2_}] :=
	With[{da = (a2-a1) / Abs[Round[(a2-a1)/(5\[Degree])]]},
		N[Table[c + {rx, ry} AngleVector[a], {a, a1, a2, da}]]
	]


ArcPoints[{p1:{x1_, y1_}, t1:{t1x_, t1y_}}, {p2:{x2_, y2_}, t2:{t2x_, t2y_}}] :=
	Block[{c, rx, ry, a1, a2}, 
		If[Abs[VectorAngle[t1, t2]]<$MachineEpsilon, Return[{p1, p2}]];
		c=If[Abs[VectorAngle[t1, t2] - \[Pi]] < $MachineEpsilon, 
			(p1 + p2) / 2,
			{x1 + (t1y (-t2x x1+t2x x2-t2y y1+t2y y2))/(t1y t2x-t1x t2y), y1-(t1x (-t2x x1+t2x x2-t2y y1+t2y y2))/(t1y t2x-t1x t2y)}
		];
		cw = Sign[t1x (y1-c[[2]])-(x1-c[[1]]) t1y]===1;
		rx = Norm[p1-c];
		ry = Norm[p2-c];
		a1 = ArcTan@@(p1-c);
		a2 = ArcTan@@(p2-c);
		If[cw && a1 < a2, a2 -= 2\[Pi]];
		If[!cw && a2 < a1, a1 -= 2\[Pi]];
		ArcPoints[c, {rx, ry}, {a1, a2}]
	]


RectilinearPoints[c_, r_] :=
	RectilinearPoints[c, r, {0, 360}\[Degree]]


RectilinearPoints[c_, r_, {a1_, a2_}] :=
	RectilinearPoints[c, {r, r}, {a1, a2}]


RectilinearPoints[c_, {rx_, ry_}, {a1_, a2_}] :=
	With[{da = (a2-a1) / Abs[Round[(a2-a1)/(90\[Degree])]]},
		N[Table[c + {rx, ry} AngleVector[a], {a, a1, a2, da}]]
	]


RectilinearPoints[{p1:{x1_, y1_}, t1:{t1x_, t1y_}}, {p2:{x2_, y2_}, t2:{t2x_, t2y_}}] :=
	Block[{c, rx, ry, a1, a2}, 
		If[Abs[VectorAngle[t1, t2]]<$MachineEpsilon, Return[{p1, p2}]];
		c=If[Abs[VectorAngle[t1, t2] - \[Pi]] < $MachineEpsilon, 
			(p1 + p2) / 2,
			{x1 + (t1y (-t2x x1+t2x x2-t2y y1+t2y y2))/(t1y t2x-t1x t2y), y1-(t1x (-t2x x1+t2x x2-t2y y1+t2y y2))/(t1y t2x-t1x t2y)}
		];
		cw = Sign[t1x (y1-c[[2]])-(x1-c[[1]]) t1y]===1;
		rx = Norm[p1-c];
		ry = Norm[p2-c];
		a1 = ArcTan@@(p1-c);
		a2 = ArcTan@@(p2-c);
		If[cw && a1 < a2, a2 -= 2\[Pi]];
		If[!cw && a2 < a1, a1 -= 2\[Pi]];
		RectilinearPoints[c, {rx, ry}, {a1, a2}]
	]


InternalTangent[pps_, n_Integer]:=
Switch[IntegerPart[(n-1)/pps],
0,{0,1},
1,{-1,0},
2,{0,-1},
3,{1,0}
]


Coordinate[pps_, n_Integer]:=
Switch[IntegerPart[(n-1)/pps],
0,{n/(pps+1),0},
1,{1,(n-pps)/(pps+1)},
2,{(2pps-n)/(pps+1)+1,1},
3,{0,(4pps-n+1)/(pps+1)}
]


ArcCircuitPolygon[pps_,circuit_]:=
Block[{switch=True,points,segments},
points={Coordinate[pps,#],InternalTangent[pps,#]If[switch=!switch,-1,1]}& /@ circuit;
segments=Partition[Append[points,First[points]],2,1];
Join@@ArcPoints@@@segments
]


RectilinearCircuitPolygon[pps_,circuit_]:=
Block[{switch=True,points,segments},
points={Coordinate[pps,#],InternalTangent[pps,#]If[switch=!switch,-1,1]}& /@ circuit;
segments=Partition[Append[points,First[points]],2,1];
Join@@RectilinearPoints@@@segments
]


SquareExternalConnections[pps_]:=
Rule@@@Transpose[{Range[4 pps],RotateLeft[Range[4 pps]]}]


SquareConnectionCircuits[pps_,connections_]:=
Block[{internalConnections=Rule@@@Join[connections,Reverse/@connections],externalConnections,allCircuits},
externalConnections=SquareExternalConnections[pps];
allCircuits=Block[{circuit={#,#/.internalConnections},internal=False},
While[Last[circuit]=!=First[circuit],
circuit=Append[circuit,Last[circuit]/.If[internal,internalConnections,externalConnections]];
internal=!internal
];
Most[circuit]
]& /@ Range[4 pps];
DeleteDuplicatesBy[allCircuits,Sort]
]


SquareArcTile[pps_, connections_] :=
	Block[{circuits},
		circuits = SquareConnectionCircuits[pps, CanonicalizeConnections[pps, connections]];
		whiteCircuits = Select[circuits, OddQ[First[#]]&];
		blackCircuits = Select[circuits, EvenQ[First[#]]&];
		{
			White,
			Polygon[ArcCircuitPolygon[pps, #]& /@ whiteCircuits],
			Black,
			Polygon[ArcCircuitPolygon[pps, #]& /@ blackCircuits]
		}
	]


SquareRectilinearTile[pps_, connections_] :=
	Block[{circuits},
		circuits = SquareConnectionCircuits[pps, CanonicalizeConnections[pps, connections]];
		whiteCircuits = Select[circuits, OddQ[First[#]]&];
		blackCircuits = Select[circuits, EvenQ[First[#]]&];
		{
			White,
			Polygon[RectilinearCircuitPolygon[pps, #]& /@ whiteCircuits],
			Black,
			Polygon[RectilinearCircuitPolygon[pps, #]& /@ blackCircuits]
		}
	]


CanonicalizeConnection[pps_, s_String] :=
	Block[{d, n},
		{d, n} = Characters[s];
		n = ToExpression[n];
		Switch[d,
		 "s", n,
		 "e", pps+ n,
		 "n", 2 pps + pps - n + 1,
		 "w", 3 pps + pps - n + 1
		]
	]


CanonicalizeConnections[pps_, connections_]:=
	List @@@ connections /. s_String :> CanonicalizeConnection[pps, s]


SquareTileNameMapping[]=
{"\\"->24,"/"->8,"-"->6,"|"->15,"+."->1,"x."->19,"+"->16,"fne"->3,"fsw"->23,"fnw"->2,"fse"->7,"tn"->5,"ts"->20,"te"->13,"tw"->21,"ys"->12,"ye"->9,"yn"->4,"yw"->17,"anw"->10,"ane"->18,"asw"->22,"ase"->14,"p"->11};


SquareTileNames[]=
First/@SquareTileNameMapping[];


Square2ConnectionDestinations[i_]:=
Mod[i+{1,3,5,7},8,1]


Square2ConnectionStep[c_]:=
Block[{used,left,p},
used=Flatten[List@@@c];
left=Complement[Range[8],used];
If[left==={},Return[{}]];
p=Min[left];
Append[c,#]&/@Thread[p->Complement[Square2ConnectionDestinations[p],used]]
]


AllSquare2ConnectionSets[]:=
Nest[Flatten[Square2ConnectionStep/@#,1]&,{{}},4]


AllSquare2ArcTiles[]=SquareArcTile[2,#]& /@ AllSquare2ConnectionSets[];


SquareArcTile[name_String]:=SquareArcTile[name]=
AllSquare2ArcTiles[][[name/.SquareTileNameMapping[]]]


AllSquare2RectilinearTiles[]=SquareRectilinearTile[2,#]& /@ AllSquare2ConnectionSets[];


SquareRectilinearTile[name_String]:=SquareRectilinearTile[name]=
AllSquare2RectilinearTiles[][[name/.SquareTileNameMapping[]]]


Triangular Tiles


TriangleArcTile[".e"] = {
Black,
Polygon[Join[
ArcPoints[{0,0},1/3.,{0,60}\[Degree]],
ArcPoints[{1,Sqrt[3]}/2/2,1/6.,{240,60}\[Degree]],
ArcPoints[{0,0},2/3.,{60,0}\[Degree]],
ArcPoints[{.5,0},1/6.,{360,180}\[Degree]]
]],
Polygon[Join[
ArcPoints[{1,0}+{-1,Sqrt[3]}/2/2,1/6.]
]],
White,
Polygon[ArcPoints[{0,0},1/3.]],
Polygon[Join[
ArcPoints[{1,Sqrt[3]}/2,1/3.,{240,-60}\[Degree]],
ArcPoints[{1,0}+{-1,Sqrt[3]}/2/2,1/6.,{120,300}\[Degree]],
ArcPoints[{1,0},1/3.,{120,-180}\[Degree]],
ArcPoints[{0,0},2/3.,{0,60}\[Degree]]
]]
};


TriangleArcTile[".w"] = TriangleArcTile[".e"]/. pt:{_?NumericQ,_?NumericQ}:>RotationTransform[120\[Degree],{1/2,1/(2 Sqrt[3])}][pt];


TriangleArcTile[".s"] = TriangleArcTile[".e"]/. pt:{_?NumericQ,_?NumericQ}:>RotationTransform[240\[Degree],{1/2,1/(2 Sqrt[3])}][pt];


TriangleArcTile["..."] = {
Black,
Polygon[{
ArcPoints[{1,0}+{-1,Sqrt[3]}/2/2,1/6.],
ArcPoints[{0,0}+{1,Sqrt[3]}/2/2,1/6.],
ArcPoints[{.5,0},1/6.]
}],
White,
Polygon[Join[
ArcPoints[{.5,0},1/6.,{0,180}\[Degree]],
ArcPoints[{0,0},1/3.,{360,60}\[Degree]],
ArcPoints[{0,0}+{1,Sqrt[3]}/2/2,1/6.,{-120,60}\[Degree]],
ArcPoints[{1,Sqrt[3]}/2,1/3.,{240,-60}\[Degree]],
ArcPoints[{1,0}+{-1,Sqrt[3]}/2/2,1/6.,{120,300}\[Degree]],
ArcPoints[{1,0},1/3.,{120,-180}\[Degree]]
]]
};


TriangleArcTile["y"] = {
Black,
Polygon[Join[
ArcPoints[{1,0}+{-1,Sqrt[3]}/2/2,1/6.,{-60,120}\[Degree]],
ArcPoints[{1,Sqrt[3]}/2,1/3.,{-60,-120}\[Degree]],
ArcPoints[{0,0}+{1,Sqrt[3]}/2/2,1/6.,{60,240}\[Degree]],
ArcPoints[{0,0},1/3.,{60,0}\[Degree]],
ArcPoints[{.5,0},1/6.,{180,360}\[Degree]],
ArcPoints[{1,0},1/3.,{180,120}\[Degree]]
]],
White,
Polygon[{
ArcPoints[{0,0},1/3.],
ArcPoints[{1,Sqrt[3]}/2,1/3.],
ArcPoints[{1,0},1/3.]
}]
};


(* ::Section:: *)
(*Tilings*)


(* ::Subsection:: *)
(*Predefined Transforms*)


Tsw = TransformationMatrix[TranslationTransform[{0, 0}/2.] @* ScalingTransform[{1, 1}/2.]];
Tse = TransformationMatrix[TranslationTransform[{0, 1}/2.] @* ScalingTransform[{1, 1}/2.]];
Tne = TransformationMatrix[TranslationTransform[{1, 1}/2.] @* ScalingTransform[{1, 1}/2.]];
Tnw = TransformationMatrix[TranslationTransform[{1, 0}/2.] @* ScalingTransform[{1, 1}/2.]];


T8 =TransformationMatrix[ScalingTransform[{1,1}/2,{0,0}]];
T4 = TransformationMatrix[TranslationTransform[{.5,0}] @* ScalingTransform[{1,1}/2,{0,0}]];
T12 = TransformationMatrix[TranslationTransform[AngleVector[60\[Degree]]/2] @* ScalingTransform[{1,1}/2,{0,0}]];
Tc = TransformationMatrix[TranslationTransform[(Sqrt[3]/2)AngleVector[30\[Degree]]] @* RotationTransform[180\[Degree],{0,0}] @* ScalingTransform[{1,1}/2,{0,0}]];


Tsq90 = TransformationMatrix[RotationTransform[90\[Degree],{.5,.5}]];
Tsq180 = TransformationMatrix[RotationTransform[180\[Degree],{.5,.5}]];
Tsq270 = TransformationMatrix[RotationTransform[270\[Degree],{.5,.5}]];
Tsqvr = TransformationMatrix[ScalingTransform[{-1,1},{.5,.5}]];
Tsqhr = TransformationMatrix[ScalingTransform[{1,-1},{.5,.5}]];


(* ::Subsection:: *)
(*Square Tilings*)


TransformTiling[tiling_,t_]:=
(#[[1]] -> t.#[[2]])& /@ tiling


CropSquareTiling[tiling_, {min:{xMin_, yMin_}, max:{xMax_, yMax_}}] :=
	Select[tiling, And @@ Thread[min <= Take[#[[2]].{.5, .5, 1}, 2] <= max]&]


(* ::Text:: *)
(*Convert a list of {lower-left-coord, size} pairs to a tiling data structure. *)


SquareTiling[squares_] :=
	Thread[1->((With[{ll = #[[1]], s = #[[2]]},
		TransformationMatrix[TranslationTransform[ll] @* ScalingTransform[s{1, 1}]]
	]&)/@squares)]


CheckerboardTiling[n_]:=
	SquareTiling[
		Join[
			Flatten[Table[If[EvenQ[i+j],{{i,j},1},Nothing],{i,0,n-1},{j,0,n-1}],1],
			Flatten[Table[If[OddQ[i+j], Sequence@@{
			{{i,j},1/2},
			{{i,j}+{0,1/2},1/2},
			{{i,j}+{1/2,0},1/2},
			{{i,j}+{1/2,1/2},1/2}
			},Nothing],{i,0,n-1},{j,0,n-1}],1]
		]
	]


SurroundTiling[n_]:=
	With[{unit=SquareTiling[
			Join[
				{{{1/2,1/2},1}},
				Table[{{i 1/2,0},1/2},{i,0,3}],
				Table[{{i 1/2,3/2},1/2},{i,0,3}],
				Table[{{0,i 1/2},1/2},{i,1,2}],
				Table[{{3/2,i 1/2},1/2},{i,1,2}]
			]
		]},
		DeleteDuplicates@(Join@@Flatten[Table[TransformTiling[unit,
			TransformationMatrix[TranslationTransform[3/2{i,j}]]
		],{i,0,n-1},{j,0,n-1}],1])
	]


OffsetSurroundTiling[m_,n_]:=
	With[{unit=SquareTiling[
			Join[
				{{{1/2,1/2},1}},
				Table[{{i 1/2,0},1/2},{i,0,3}],
				Table[{{i 1/2,3/2},1/2},{i,0,3}],
				Table[{{0,i 1/2},1/2},{i,1,2}],
				Table[{{3/2,i 1/2},1/2},{i,1,2}]
			]
		]},
		DeleteDuplicates@(Join@@Flatten[Table[TransformTiling[unit,
			TransformationMatrix[TranslationTransform[{3/2i,(3/2j+Mod[i,3]/2)}]]
		],{i,0,n-1},{j,0,m-1}],1])
	]


(* ::Input::Initialization:: *)
RandomSquareSubdivisionTiling[n_,d_:\[Infinity]]:=
Thread[1 -> Nest[
Block[{pos,t},
pos=RandomInteger[{1,Length[#]}];
While[TileDepth[#[[pos]]] >= d,pos=RandomInteger[{1,Length[#]}]];
t=#[[pos]];
ReplacePart[#,pos->Sequence@@(t.#&/@{{{1/2,0,0},{0,1/2,0},{0,0,1}},{{1/2,0,0},{0,1/2,1/2},{0,0,1}},{{1/2,0,1/2},{0,1/2,0},{0,0,1}},{{1/2,0,1/2},{0,1/2,1/2},{0,0,1}}})]
]&,{IdentityMatrix[3]},n]]


(* ::Input::Initialization:: *)
SquareSubdivisionFillTilingRecursive[reg_,{ll_,s_},d_]:=
Which[
RegionWithin[reg,Rectangle[ll-s/3{1,1},ll+s+s/3{1,1}]],{{ll,s}},
RegionDisjoint[reg,Rectangle[ll,ll+s]],{},
True,If[d==0,{(*{ll,s}*)},
Flatten[SquareSubdivisionFillTilingRecursive[reg,{#,s/2}, d-1]& /@ {
ll,ll+s/2{1,0},ll+s/2{0,1},ll+s/2{1,1}
},1]]
]


(* ::Input::Initialization:: *)
SquareSubdivisionFillTiling[reg_,{ll_,s_},d_]:=
SquareTiling@SquareSubdivisionFillTilingRecursive[reg,{ll,s},d]


GridTiling[{r_, c_}, bv_:{{1, 0}, {0, 1}}] :=
	Thread[1 -> Flatten[Table[TransformationMatrix[TranslationTransform[i bv[[1]] + j bv[[2]]]], {i, 0, c-1}, {j, 0, r-1}], 1]]


SubdivideSquare[{ll_, s_}] :=
	{
		{ll + (s/2){0, 0}, s/2},
		{ll + (s/2){0, 1}, s/2},
		{ll + (s/2){1, 0}, s/2},
		{ll + (s/2){1, 1}, s/2}
	}


ComposeTilings[t_, ts_] :=
	Flatten[With[{i = #[[1]], tx = #[[2]]},
		(#[[1]] -> tx.#[[2]])& /@ ts[[i]]
	]& /@ t, 1]


RecursiveSubdivisionTiling[program_, depth_]:=
	RecursiveSubdivisionTiling[program, depth, program[[1,1 ]], {1 -> IdentityMatrix[3]}];

RecursiveSubdivisionTiling[program_, 0, state_, tiling_] :=
	tiling;

RecursiveSubdivisionTiling[program_, depth_, state_, tiling_] :=
	Block[{otx, atx, newState},
		{{otx, atx}, newState} = List @@ (state /. program);
		RecursiveSubdivisionTiling[program, depth - 1, newState, 
			ComposeTilings[
				Join[Thread[1 -> otx], Thread[2 -> atx]],
				{tiling, {1 -> IdentityMatrix[3]}}
			]
		]
	]


(* ::Subsection:: *)
(*Triangular Tilings*)


(* ::Input::Initialization:: *)
RandomTriangleSubdivisionTiling[n_,d_:\[Infinity]]:=
Nest[
Block[{pos,t},
pos=RandomInteger[{1,Length[#]}];
While[TileDepth[#[[pos]]] >= d,pos=RandomInteger[{1,Length[#]}]];
t=#[[pos]];
ReplacePart[#,pos->Sequence@@(t.#&/@Evaluate[N@{
TransformationMatrix[TranslationTransform[{0,0}/2]@*ScalingTransform[1/2{1,1}]],
TransformationMatrix[TranslationTransform[{1,0}/2]@*ScalingTransform[1/2{1,1}]],
TransformationMatrix[TranslationTransform[{.5,Sqrt[3]/2}/2]@*ScalingTransform[1/2{1,1}]],
TransformationMatrix[TranslationTransform[{1,0}/2]@*RotationTransform[60\[Degree]]@*ScalingTransform[1/2{1,1}]]
}])]
]&,{IdentityMatrix[3]},n]


(* ::Subsection:: *)
(*Composite Tilings*)


SnubSquareTiling[{r_, c_}] :=
ComposeTilings[
GridTiling[{r, c},{({0,1}+AngleVector[120\[Degree]]),({1,0}+AngleVector[30\[Degree]])}],
{{1->IdentityMatrix[3],
1->TransformationMatrix[TranslationTransform[{1,1}] @* RotationTransform[30\[Degree],{0,0}]],
2->TransformationMatrix[RotationTransform[-90\[Degree],{1,0}]],
2->TransformationMatrix[TranslationTransform[{1,1}] @* RotationTransform[-30\[Degree],{0,0}]],
2->TransformationMatrix[TranslationTransform[{0,1}]],
2->TransformationMatrix[TranslationTransform[{1,0}] @* RotationTransform[180\[Degree],{0,0}]]
}}]


(* ::Section:: *)
(*Tiling Patterns*)


(* ::Subsection:: *)
(*Square Tiling Patterns*)


InvertMotif[motif_]:=
motif/.{Black->White,White->Black}


(* ::Input::Initialization:: *)
TileDepth[t_]:=
-Round[Log[2.,Sqrt[Det[t]]]]


TileParity[t_]:=
EvenQ[TileDepth[t]]


(* ::Input::Initialization:: *)
ToGraphicsTransform[m_]:={m[[1;;2,1;;2]],m[[1;;2,3]]}


SetAttributes[RenderTiling,HoldRest]


Options[RenderTiling]={"Parity"->0};


RenderTiling[tiling_, motifs_, OptionsPattern[]] :=
	{Antialiasing->True, With[{i = #[[1]], t = #[[2]]}, GeometricTransformation[GraphicsGroup[
		If[TileParity[t] && OptionValue["Parity"] === 0 || !TileParity[t] && OptionValue["Parity"] =!= 0, motifs[[i]], InvertMotif[motifs[[i]]]]
	], ToGraphicsTransform[t]]]& /@ SortBy[tiling, TileDepth[#[[2]]]&]}


SetAttributes[ShowTiling,HoldRest]


Options[ShowTiling]=Union[{"Parity"->0},Options[Graphics]];


ShowTiling[tiling_,motif_,opts:OptionsPattern[]]:=
Graphics[RenderTiling[tiling,motif,"Parity"->OptionValue["Parity"]],Sequence@@DeleteCases[{opts},HoldPattern["Parity"->_]]]


End[];


EndPackage[];


(* ::Subsection:: *)
(*Triangular Tiling Patterns*)
