export interface Block { x:number; y:number; z:number; w:number; h:number; d:number; kind:"concrete"|"brick"|"container"|"sand" }
export const blocks: Block[] = [
 {x:0,y:-.3,z:-8,w:38,h:.6,d:54,kind:"concrete"},
 {x:-18,y:3,z:-8,w:1,h:6,d:54,kind:"concrete"}, {x:18,y:3,z:-8,w:1,h:6,d:54,kind:"concrete"},
 {x:0,y:3,z:-34,w:36,h:6,d:1,kind:"brick"}, {x:0,y:3,z:18,w:36,h:6,d:1,kind:"concrete"},
 {x:-6,y:.6,z:1,w:5,h:1.2,d:1,kind:"sand"}, {x:4,y:.65,z:-8,w:5,h:1.3,d:.8,kind:"concrete"},
 {x:-9,y:1.3,z:-12,w:3.5,h:2.6,d:7,kind:"container"}, {x:10,y:1.3,z:-22,w:3.5,h:2.6,d:7,kind:"container"},
 {x:-3,y:1.4,z:-21,w:7,h:2.8,d:.55,kind:"brick"}, {x:6,y:.55,z:4,w:3,h:1.1,d:1,kind:"sand"},
];
