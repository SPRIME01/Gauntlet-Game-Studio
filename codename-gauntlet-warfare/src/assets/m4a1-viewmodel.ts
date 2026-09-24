import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export const M4A1_VIEWMODEL_ASSET = {
  id: "m4a1-viewmodel", triangle_budget: 12000,
  sockets: ["socket-muzzle", "socket-optic", "socket-ejection"] as const,
  silhouette_similarity_target: .70,
};

// Reference landmarks become geometry in metres, never shipped pixel textures.
// Hidden-side geometry and thickness are inferred.
const point = (x:number,y:number) => new T.Vector2((1400-x)/2000,(200-y)/2000);

  // Procedural micro-detail: brushed-metal streaks and polymer stipple give the
  // viewmodel real surface response in ADS close-ups without any external asset.
  function detailTexture(base:string,style:"brushed"|"stipple"):{map:T.CanvasTexture;roughnessMap:T.CanvasTexture}{
    const canvas=document.createElement("canvas");canvas.width=canvas.height=128;
    const c=canvas.getContext("2d")!;
    c.fillStyle=base;c.fillRect(0,0,128,128);
    const rough=document.createElement("canvas");rough.width=rough.height=128;
    const rc=rough.getContext("2d")!;
    rc.fillStyle="#8a8a8a";rc.fillRect(0,0,128,128);
    let seed=77;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
    if(style==="brushed"){
      for(let i=0;i<240;i++){
        const y=random()*128,w=1+random()*1.5,v=random()>.5;
        c.fillStyle=v?"rgba(255,255,255,.05)":"rgba(0,0,0,.07)";
        c.fillRect(0,y,128,w);
        rc.fillStyle=v?"rgba(255,255,255,.16)":"rgba(0,0,0,.18)";
        rc.fillRect(0,y,128,w);
      }
      for(let i=0;i<10;i++){ // wear scratches
        const x=random()*128,y=random()*128,l=6+random()*22;
        c.strokeStyle="rgba(210,215,220,.16)";c.lineWidth=.8;
        c.beginPath();c.moveTo(x,y);c.lineTo(x+l,y+(random()-.5)*8);c.stroke();
      }
    }else{
      for(let i=0;i<1600;i++){
        const x=random()*128,y=random()*128,r=random()*1.1;
        c.fillStyle=random()>.5?"rgba(255,255,255,.05)":"rgba(0,0,0,.06)";
        c.beginPath();c.arc(x,y,r,0,7);c.fill();
        rc.fillStyle=random()>.5?"rgba(255,255,255,.1)":"rgba(0,0,0,.1)";
        rc.beginPath();rc.arc(x,y,r,0,7);rc.fill();
      }
    }
    const map=new T.CanvasTexture(canvas);map.colorSpace=T.SRGBColorSpace;
    const roughnessMap=new T.CanvasTexture(rough);
    return {map,roughnessMap};
  }

export function createM4A1Viewmodel(batch=false): T.Group {
  const gun=new T.Group();gun.name="m4a1-viewmodel";
  // Detail textures require DOM canvas; headless callers get flat materials.
  const hasDom=typeof document!=="undefined";
  const brushedMetal=hasDom?detailTexture("#34383b","brushed"):null;
  const stipple=hasDom?detailTexture("#252a28","stipple"):null;
  const magazineDetail=hasDom?detailTexture("#4d5256","brushed"):null;
  const metal=new T.MeshStandardMaterial({color:0x3d4245,metalness:.62,roughness:.42,map:brushedMetal?.map??null,roughnessMap:brushedMetal?.roughnessMap??null});metal.envMapIntensity=.95;
  const polymer=new T.MeshStandardMaterial({color:0x2c312f,metalness:0,roughness:.8,map:stipple?.map??null,roughnessMap:stipple?.roughnessMap??null});polymer.envMapIntensity=.8;
  const magazine=new T.MeshStandardMaterial({color:0x565b60,metalness:.55,roughness:.5,map:magazineDetail?.map??null,roughnessMap:magazineDetail?.roughnessMap??null});magazine.envMapIntensity=.9;
  const recess=new T.MeshStandardMaterial({color:0x101415,metalness:.2,roughness:.83});
  const edge=new T.MeshStandardMaterial({color:0x60666a,metalness:.85,roughness:.3});
  const buckets=new Map<T.Material,T.BufferGeometry[]>();
  function add(name:string,g:T.BufferGeometry,m:T.Material) {
    const mesh=new T.Mesh(g,m);mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true;gun.add(mesh);return mesh;
  }
  function detail(g:T.BufferGeometry,m:T.Material) {
    const list=buckets.get(m)??[];list.push(g);buckets.set(m,list);
  }
  function profile(name:string,outline:number[][],thickness:number,m:T.Material,holes:number[][][]=[]) {
    const shape=new T.Shape(outline.map(([x,y])=>point(x,y)));
    for(const hole of holes)shape.holes.push(new T.Path(hole.map(([x,y])=>point(x,y))));
    const g=new T.ExtrudeGeometry(shape,{depth:thickness,bevelEnabled:true,bevelThickness:.0008,bevelSize:.0008,bevelSegments:1,steps:1,curveSegments:8});
    g.translate(0,0,-thickness/2);return add(name,g,m);
  }
  function box(x:number,y:number,w:number,h:number,d:number,m:T.Material,z=0) {
    const p=point(x,y),g=new T.BoxGeometry(w/2000,h/2000,d);g.translate(p.x,p.y,z);detail(g,m);
  }
  function barrel(name:string,x1:number,x2:number,y:number,r1:number,r2:number,m:T.Material) {
    const a=point(x1,y),b=point(x2,y),g=new T.CylinderGeometry(r1/2000,r2/2000,Math.abs(a.x-b.x),12);
    g.rotateZ(Math.PI/2);g.translate((a.x+b.x)/2,a.y,0);return add(name,g,m);
  }
  profile("upper-receiver",[[1070,122],[1370,122],[1390,112],[1525,122],[1565,150],[1568,236],[1535,264],[1090,264],[1070,240]],.047,metal);
  profile("lower-receiver",[[1090,235],[1540,235],[1535,282],[1482,308],[1450,401],[1390,403],[1410,323],[1300,323],[1282,375],[1100,382]],.041,metal,
    [[[1304,323],[1400,323],[1410,340],[1400,377],[1378,394],[1290,389],[1288,354]]]);
  profile("trigger-guard",[[1280,305],[1425,306],[1432,338],[1417,387],[1396,405],[1275,399]],.015,metal,
    [[[1301,323],[1404,323],[1413,341],[1402,377],[1388,392],[1295,389],[1287,359]]]);
  profile("trigger",[[1373,321],[1385,324],[1382,348],[1370,375],[1361,381],[1370,352]],.009,metal);
  profile("pistol-grip",[[1460,294],[1517,290],[1532,372],[1630,534],[1635,555],[1513,576],[1490,554],[1501,543],[1424,402]],.036,polymer);
  profile("curved-magazine",[[1101,362],[1285,362],[1281,402],[1264,481],[1240,561],[1204,670],[1058,633],[1085,553],[1100,469]],.029,magazine);
  profile("magazine-floor",[[1056,625],[1206,663],[1201,678],[1051,640]],.033,magazine);
  profile("handguard",[[602,131],[640,127],[1012,127],[1022,148],[1014,261],[644,274],[614,260],[604,220]],.055,polymer);
  barrel("delta-ring",1020,1070,197,37,36,metal);
  barrel("barrel",162,599,197,18,15,metal);
  barrel("barrel-step",310,373,197,20,20,metal);
  barrel("barrel-collar",92,174,197,25,24,metal);
  barrel("flash-hider",26,100,197,25,24,metal);
  barrel("muzzle-bore",23,28,197,14,14,recess);
  profile("front-sight",[[468,145],[473,35],[482,20],[499,20],[599,145],[588,158],[572,144],[555,80],[515,67],[507,80],[506,142]],.012,metal);
  profile("front-sight-base",[[451,153],[478,139],[581,146],[605,173],[598,234],[468,247],[450,220]],.027,metal,
    [[[464,165],[477,162],[477,223],[465,228]]]);
  profile("foregrip",[[636,261],[733,258],[731,276],[711,292],[713,525],[704,545],[665,550],[651,535],[649,298],[635,280]],.039,polymer);
  barrel("buffer-tube",1550,1810,195,24,24,metal);
  profile("adjustable-stock",[[1598,156],[1949,157],[1996,149],[2016,161],[2022,198],[2007,322],[1990,449],[1970,468],[1941,457],[1926,414],[1887,385],[1796,368],[1738,333],[1681,329],[1685,268],[1600,260]],.044,polymer,
    [[[1720,275],[1942,273],[1939,283],[1720,286]],[[1836,335],[1934,330],[1925,390]]]);
  profile("stock-buttpad",[[1997,151],[2018,161],[2027,197],[1995,455],[1980,476],[1965,468],[1980,427],[2004,191]],.049,recess);
  profile("rear-sight-base",[[1384,81],[1430,70],[1473,88],[1508,99],[1514,129],[1390,132],[1376,113]],.032,metal);
  const sight=new T.Mesh(new T.TorusGeometry(.008,.002,6,12),metal);sight.name="rear-aperture";
  sight.rotation.y=Math.PI/2;sight.position.set(point(1443,0).x,.08,0);gun.add(sight);
  // Red-dot optic on socket-optic: mount, tube and an emissive reticle dot that
  // anchors the eye in ADS. Kept top-level so batching merges the metal parts.
  const mountX=point(1400,65).x;
  // The top rail surface sits at y=.042; the mount clamps to it so the tube
  // reads as part of the weapon. The reticle faces the camera (-X) and is
  // double-sided so it stays visible from every angle.
  const opticBody=new T.Mesh(new T.BoxGeometry(.07,.024,.03),metal);opticBody.name="optic-body";opticBody.position.set(mountX,.054,0);
  // Open-ended: ADS looks THROUGH the tube at the reticle, never into a cap.
  const opticTube=new T.Mesh(new T.CylinderGeometry(.019,.019,.055,12,1,true),metal);opticTube.name="optic-tube";
  opticTube.rotation.z=Math.PI/2;opticTube.position.set(mountX,.081,0);
  const opticRing=new T.Mesh(new T.TorusGeometry(.017,.003,8,16),metal);opticRing.name="optic-ring";
  opticRing.rotation.y=Math.PI/2;opticRing.position.set(mountX+.026,.081,0);
  const reticle=new T.Mesh(new T.CircleGeometry(.004,12),new T.MeshBasicMaterial({color:0xff2222,side:T.DoubleSide,toneMapped:false}));reticle.name="optic-reticle";
  reticle.rotation.y=-Math.PI/2;reticle.position.set(mountX+.018,.081,0);
  gun.add(opticBody,opticTube,opticRing,reticle);
  box(1443,40,12,34,.01,metal);
  for(let x=620;x<1010;x+=27)box(x,200,8,103,.058,polymer);
  for(let x=612;x<1520;x+=28)if(x<=1015||x>=1070)box(x,122,18,13,.025,metal);
  for(let y=455;y<536;y+=15)box(680,y,63,5,.042,recess);
  for(const z of [-.0225,.0225]) {
    for(let x=1650;x<1970;x+=56)box(x,220,40,5,.001,recess,z);
    for(const [x,y] of [[1130,275],[1230,275],[1450,255],[1480,115],[651,144]]) {
      const p=point(x,y),g=new T.CylinderGeometry(.0025,.0025,.003,8);
      g.rotateX(Math.PI/2);g.translate(p.x,p.y,z);detail(g,edge);
    }
    for(let x=1120;x<=1216;x+=32) {
      const p=point(x,513),g=new T.BoxGeometry(.003,.088,.0015);
      g.rotateZ(.19);g.translate(p.x,p.y,z*.68);detail(g,edge);
    }
    box(1210,233,210,3,.001,recess,z);box(1310,297,41,8,.006,metal,z);
  }
  let detailBatch=0;
  for(const [material,geometries] of buckets) {
    const normalized=geometries.map(g=>g.toNonIndexed());
    add("detail-batch-"+detailBatch++,mergeGeometries(normalized),material);
    geometries.forEach(g=>g.dispose());normalized.forEach(g=>g.dispose());
  }
  for(const [name,x,y,z] of [
    ["socket-muzzle",23,197,0],["socket-optic",1400,65,0],["socket-ejection",1210,200,-.027],
  ] as const) {
    const socket=new T.Object3D(),p=point(x,y);socket.name=name;socket.position.set(p.x,p.y,z);gun.add(socket);
  }
  gun.userData.provenance="project-owned manual procedural model; reference-only landmark study";
  if(batch) {
    gun.updateMatrixWorld(true);
    const groups=new Map<T.Material,T.BufferGeometry[]>();
    for(const object of [...gun.children])if(object instanceof T.Mesh) {
      const geometry=(object.geometry.index?object.geometry.toNonIndexed():object.geometry.clone()).applyMatrix4(object.matrixWorld);
      const list=groups.get(object.material)??[];list.push(geometry);groups.set(object.material,list);
      object.geometry.dispose();gun.remove(object);
    }
    let index=0;
    for(const [material,geometries] of groups){add("runtime-material-"+index++,mergeGeometries(geometries),material);geometries.forEach(g=>g.dispose());}
  }
  return gun;
}
