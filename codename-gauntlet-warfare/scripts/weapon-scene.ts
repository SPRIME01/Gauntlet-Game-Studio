import * as T from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createM4A1Viewmodel } from "../src/assets/m4a1-viewmodel";

const params=new URLSearchParams(location.search),angle=Number(params.get("angle")??180)*Math.PI/180;
const silhouette=params.has("silhouette");
const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
renderer.setSize(1200,404);renderer.setClearColor(silhouette?0xffffff:0x303c43);
renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.3;
document.body.style.margin="0";document.body.append(renderer.domElement);
const scene=new T.Scene(),model=createM4A1Viewmodel();scene.add(model);
if(silhouette)model.traverse(o=>{if(o instanceof T.Mesh)o.material=new T.MeshBasicMaterial({color:0x222222});});
else {
 const pmrem=new T.PMREMGenerator(renderer),room=new RoomEnvironment();scene.environment=pmrem.fromScene(room,.04).texture;room.dispose();pmrem.dispose();
 scene.add(new T.HemisphereLight(0xc7d5e3,0x4d4437,2));
 const key=new T.DirectionalLight(0xffe2bc,4);key.position.set(-.5,1,1);scene.add(key);
 const rim=new T.DirectionalLight(0xa7d4ff,3);rim.position.set(.5,.5,-1);scene.add(rim);
}
// Match reference framing: 2048x689 landmarks span 1.024m x .3445m.
const cx=(1400-1024)/2000,cy=(200-344.5)/2000;
const camera=new T.OrthographicCamera(-.512,.512,.17225,-.17225,.01,10);
camera.position.set(cx+Math.sin(angle)*2,cy,Math.cos(angle)*2);camera.lookAt(cx,cy,0);
renderer.render(scene,camera);
let triangles=0;model.traverse(o=>{if(o instanceof T.Mesh)triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;});
Object.assign(window,{reviewReady:true,weaponReview:{triangles,drawCalls:renderer.info.render.calls,bounds:new T.Box3().setFromObject(model).getSize(new T.Vector3()).toArray()}});
