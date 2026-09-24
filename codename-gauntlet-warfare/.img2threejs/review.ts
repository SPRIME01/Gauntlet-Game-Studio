import * as T from "three";
import { createM4A1Model } from "./m4a1-blockout";
const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1200,404);renderer.setClearColor(0xffffff);document.body.style.margin="0";document.body.append(renderer.domElement);
const scene=new T.Scene();const model=createM4A1Model({textureSize:128});scene.add(model);
// Neutral silhouette pass deliberately strips all maps, per blockout review contract.
model.traverse(o=>{if(o instanceof T.Mesh)o.material=new T.MeshBasicMaterial({color:0x222222});});
const camera=new T.OrthographicCamera(-.445,.445,.1498,-.1498,.01,10);const angle=Number(new URLSearchParams(location.search).get("angle")??0)*Math.PI/180;
camera.position.set(.11+Math.sin(angle)*2,-.07,Math.cos(angle)*2);camera.lookAt(.11,-.07,0);
renderer.render(scene,camera);(window as any).reviewReady=true;
