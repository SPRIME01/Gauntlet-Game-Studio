import * as T from "three";
import { Combat, Actor, Weapon, Round, Motion, idleInput } from "./combat";
import { Spatial } from "./spatial";
import { buildEnvironment, combatant, animateCombatant, type CombatantRig, type WorldAnimations } from "./environment";
import { createM4A1Viewmodel } from "./assets/m4a1-viewmodel";
import { CombatAudio } from "./audio";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { Effects } from "./effects";
import { CSM } from "three/addons/csm/CSM.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

// Late-afternoon desert sky: warm sun low over the ridge, hazy horizon, cool zenith.
const SUN_DIRECTION = new T.Vector3(18, 32, 15).normalize();
function skyMaterial(): T.ShaderMaterial {
 return new T.ShaderMaterial({
  side: T.BackSide, depthWrite: false, fog: false,
  uniforms: {
   sunDir: { value: SUN_DIRECTION.clone() },
   // Display-authored: OutputPass tone mapping compresses light values, so the
   // gradient is tuned to survive ACES (deep blue zenith, warm hazy horizon).
   horizon: { value: new T.Vector3(.78, .64, .45) },
   zenith: { value: new T.Vector3(.16, .33, .55) },
   sunColor: { value: new T.Vector3(1.0, .93, .78) },
  },
  vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `varying vec3 vDir; uniform vec3 sunDir; uniform vec3 horizon; uniform vec3 zenith; uniform vec3 sunColor;
   void main(){
    float h = clamp(vDir.y, 0.0, 1.0);
    vec3 sky = mix(horizon, zenith, pow(h, 0.5));
    float sun = pow(max(dot(vDir, sunDir), 0.0), 1400.0) * 6.0 + pow(max(dot(vDir, sunDir), 0.0), 14.0) * 0.32;
    gl_FragColor = vec4(sky + sunColor * sun, 1.0);
   }`,
 });
}

async function boot(){
 const status=document.getElementById("status")!,start=document.getElementById("start") as HTMLButtonElement;
 const canvas=document.getElementById("game") as HTMLCanvasElement;
 const renderer=new T.WebGLRenderer({canvas,antialias:false,powerPreference:"high-performance"});let renderScale=1;renderer.setPixelRatio(renderScale);renderer.info.autoReset=false;
 renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;
 renderer.shadowMap.autoUpdate=false;
 const scene=new T.Scene();
 // Sky dome doubles as the image-based light source: PMREM of the same gradient
 // gives warm-sun / cool-sky bounce on every PBR material in the compound.
 const dome=new T.Mesh(new T.SphereGeometry(150,32,16),skyMaterial());
 scene.add(dome);
 {
  const skyScene=new T.Scene();skyScene.add(new T.Mesh(dome.geometry,skyMaterial()));
  const pmrem=new T.PMREMGenerator(renderer);
  scene.environment=pmrem.fromScene(skyScene,0.04).texture;
  scene.environmentIntensity=.55;
  pmrem.dispose();
 }
 scene.fog=new T.FogExp2(0xcfc0a2,.0085);
 scene.add(new T.HemisphereLight(0xc4dcf0,0x61523d,.7));
 buildEnvironment(scene).then(world=>{worldAnimations=world;});
 let worldAnimations:WorldAnimations|null=null;
 const camera=new T.PerspectiveCamera(72,1,.035,320);camera.rotation.order="YXZ";scene.add(camera);
 const gun=createM4A1Viewmodel(true);gun.rotation.y=Math.PI/2;camera.add(gun);
 // A camera-mounted viewmodel must not cast a floating weapon shadow into the world.
 gun.traverse(object=>{if(object instanceof T.Mesh)object.castShadow=false;});
 const flash=new T.Mesh(new T.ConeGeometry(.05,.16,5),new T.MeshBasicMaterial({color:0xffdc91,transparent:true,opacity:.85,depthWrite:false,blending:T.AdditiveBlending}));flash.rotation.z=-Math.PI/2;flash.position.x=.08;gun.getObjectByName("socket-muzzle")!.add(flash);flash.visible=false;
 const muzzleLight=new T.PointLight(0xffc873,0,8,2);scene.add(muzzleLight);
 const rigs:CombatantRig[]=[combatant(),combatant()];
 const enemies=rigs.map(r=>r.group);enemies.forEach(e=>scene.add(e));
 const effects=new Effects(scene);
 effects.ambientSmoke(new T.Vector3(-17.2,0.4,-13),1.4);
 effects.ambientSmoke(new T.Vector3(16.8,0.4,-30),1.1);
 const shadows=new CSM({camera,parent:scene,cascades:2,maxFar:65,shadowMapSize:512,lightDirection:SUN_DIRECTION.clone().multiplyScalar(-1),lightIntensity:3.0,lightNear:.1,lightFar:150,lightMargin:45});
 for(const light of shadows.lights){light.color.set(0xffe1b1);light.shadow.normalBias=.035;}
 const shadowMaterials=new Set<T.Material>();
 scene.traverse(object=>{if(object instanceof T.Mesh){for(const material of Array.isArray(object.material)?object.material:[object.material])if(material instanceof T.MeshStandardMaterial&&!shadowMaterials.has(material)){shadows.setupMaterial(material);shadowMaterials.add(material);}}});
 // Rendering policy split by renderer class (structural vs hardware-sensitive
 // quality, per T21): hardware GPUs always render the MSAA HDR composer chain
 // (OutputPass applies tone mapping + sRGB); SwiftShader-class software
 // renderers keep the direct path outside ADS, where an always-on MSAA composer
 // would dilute simulation time past the fixed-step cap.
 const rendererString=String(renderer.getContext().getParameter(renderer.getContext().RENDERER));
 const softwareRenderer=/SwiftShader|llvmpipe|SoftPipe/i.test(rendererString);
 const composer=new EffectComposer(renderer,new T.WebGLRenderTarget(2,2,{samples:softwareRenderer?0:4,type:T.HalfFloatType}));
 composer.addPass(new RenderPass(scene,camera));
 const depthOfField=new BokehPass(scene,camera,{focus:.65,aperture:.0001,maxblur:.004});
 composer.addPass(depthOfField);composer.addPass(new OutputPass());
 const spatial=new Spatial();status.textContent="Preparing compound…";await spatial.init();let combat=new Combat(spatial);const audio=new CombatAudio();
 const input=idleInput(),keys=new Set<string>();let active=false,hitTime=0,flashTime=0,recoil=0,last=0,accumulator=0,stepDistance=0,sprintBoost=0,crouchPulse=0,crouchToggle=false;
 const impactMaterial=new T.MeshBasicMaterial({color:0x343128,side:T.DoubleSide,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2});
 const impacts=Array.from({length:32},()=>{const m=new T.Mesh(new T.CircleGeometry(.045,8),impactMaterial);m.visible=false;scene.add(m);return m;});let impactIndex=0;
 const frames:number[]=[];let drawCalls=0,triangles=0,maxDrawCalls=0,maxTriangles=0,qualityFrames=0;
 const health=document.getElementById("health")!,ammo=document.getElementById("ammo")!,mode=document.getElementById("mode")!,timer=document.getElementById("timer")!,message=document.getElementById("message")!,crosshair=document.getElementById("crosshair")!,overlay=document.getElementById("overlay")!;
 const compassStrip=document.getElementById("compassStrip")!;
 // Compass ruler: cardinal letters every 45 degrees, ticks every 15, three
 // wraps wide so any heading always has neighbors on screen.
 {
  const cardinals:Record<number,string>={0:"N",45:"NE",90:"E",135:"SE",180:"S",225:"SW",270:"W",315:"NW"};
  let html="";
  for(let deg=-180;deg<=540;deg+=15){
   const label=cardinals[((deg%360)+360)%360];
   html+=label?`<span class="card" style="left:${deg*3}px">${label}</span>`:`<span style="left:${deg*3}px">|</span>`;
  }
  compassStrip.innerHTML=html;
 }
 start.disabled=false;status.textContent="Two hostiles. Clear the compound.";
 start.onclick=async()=>{await audio.unlock();if(combat.round.get(Round)!.phase!=="playing"){combat.dispose();combat=new Combat(spatial);spatial.step(combat,1/60);combat.start();
  for(const rig of rigs){rig.deathT=-1;rig.flinchT=0;rig.group.visible=true;rig.group.rotation.x=0;rig.group.position.y=0;}
  for(let i=0;i<rigPrev.length;i++)rigPrev[i]={x:combat.enemies[i].get(Actor)!.x,z:combat.enemies[i].get(Actor)!.z};
 }
 await canvas.requestPointerLock();};
 document.addEventListener("pointerlockchange",()=>{active=document.pointerLockElement===canvas;overlay.hidden=active;keys.clear();input.fire=false;input.ads=false;accumulator=0;});
 document.addEventListener("mousemove",e=>{if(active)combat.look(e.movementX,e.movementY);});
 document.addEventListener("keydown",e=>{if(!active)return;if(e.code==="Escape"){document.exitPointerLock();return;}if(["Space","ControlLeft","KeyW","KeyS","KeyA","KeyD"].includes(e.code))e.preventDefault();keys.add(e.code);
  if(!e.repeat&&e.code==="KeyR")combat.reload();
  if(!e.repeat&&e.code==="KeyB")combat.toggleMode();
  if(!e.repeat&&e.code==="KeyC"){
   const moving=keys.has("KeyW")&&(input.sprint||keys.has("ShiftLeft"));
   if(moving){input.crouch=true;crouchPulse=.12;} // tap while running: slide
   else crouchToggle=!crouchToggle;               // tap while walking: toggle crouch
  }
 });
 document.addEventListener("keyup",e=>keys.delete(e.code));document.addEventListener("mousedown",e=>{if(active){if(e.button===0)input.fire=true;if(e.button===2)input.ads=true;}});
 document.addEventListener("mouseup",e=>{if(e.button===0)input.fire=false;if(e.button===2)input.ads=false;});canvas.addEventListener("contextmenu",e=>e.preventDefault());window.addEventListener("blur",()=>{keys.clear();input.fire=false;input.ads=false;if(document.pointerLockElement)document.exitPointerLock();});
 function resize(){renderer.setSize(innerWidth,innerHeight,false);composer.setPixelRatio(renderScale);composer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();shadows.updateFrustums();}addEventListener("resize",resize);resize();
 Object.defineProperty(window,"__GAUNTLET_WARFARE__",{value:Object.freeze({snapshot:()=>structuredClone(combat.snapshot()),telemetry:()=>({drawCalls,triangles,maxDrawCalls,maxTriangles,renderScale,frames:[...frames],physicsTicks:spatial.tick,renderer:renderer.getContext().getParameter(renderer.getContext().RENDERER)})})});
 const rigSpeeds=rigs.map(()=>0);
 const rigPrev=rigs.map(r=>({x:r.group.position.x,z:r.group.position.z}));
 function frame(now:number){
  const rawDt=(now-(last||now))/1000,dt=Math.min(.25,rawDt);last=now;if(rawDt>0){frames.push(rawDt*1000);if(frames.length>600)frames.shift();}
  // Software renderers need aggressive resolution scaling: frame times beyond the
// 250ms fixed-step cap dilate simulation time. Floor .45 keeps the game playable
// where .65 let frame cost outrun real time; hardware never reaches this path.
if(++qualityFrames%30===0&&frames.length>=30){const mean=frames.slice(-30).reduce((a,b)=>a+b,0)/30;if(mean>26&&renderScale>.45){renderScale=Math.max(.45,renderScale-.15);renderer.setPixelRatio(renderScale);resize();}}
  if(crouchPulse>0){crouchPulse-=dt;if(crouchPulse<=0&&!crouchToggle&&!keys.has("ControlLeft"))input.crouch=false;}
  if(active){accumulator+=dt;input.forward=Number(keys.has("KeyW"))-Number(keys.has("KeyS"));input.strafe=Number(keys.has("KeyD"))-Number(keys.has("KeyA"));input.sprint=keys.has("ShiftLeft");input.crouch=crouchToggle||keys.has("ControlLeft")||crouchPulse>0;while(accumulator>=1/60){combat.step(1/60,input);spatial.step(combat,1/60);accumulator-=1/60;}}
  const p=combat.player.get(Actor)!,w=combat.player.get(Weapon)!,motion=combat.player.get(Motion)!,r=combat.round.get(Round)!;
  camera.position.set(p.x,p.y,p.z);camera.rotation.set(p.pitch,p.yaw,0);camera.updateMatrixWorld(true);
  const muzzleWorld=gun.getObjectByName("socket-muzzle")!.getWorldPosition(new T.Vector3());
  for(const e of combat.events){
   if(e.type==="shot"){
    effects.tracer(muzzleWorld,e.point?new T.Vector3(e.point.x,e.point.y,e.point.z):muzzleWorld.clone().add(new T.Vector3(0,0,-40)));
    effects.burst(muzzleWorld,true);effects.eject(muzzleWorld.clone(),p.yaw);
    flashTime=.04;recoil=.06;audio.play("shot");
   }
   if(e.type==="enemy-shot"&&e.point&&e.target){
    const to=new T.Vector3(e.target.x,e.target.y-.2,e.target.z);
    // Flash and tracer start at the rifle muzzle, not the chest: push the origin
    // toward the target so the beam reads as coming down the sights.
    const from=new T.Vector3(e.point.x,e.point.y,e.point.z).add(to.clone().sub(new T.Vector3(e.point.x,e.point.y,e.point.z)).normalize().multiplyScalar(.5));
    effects.burst(from,true);effects.tracer(from,to);audio.play("shot",e.point);
   }
   if(e.type==="impact"&&e.point)effects.burst(new T.Vector3(e.point.x,e.point.y,e.point.z));
   if(e.type==="hit"&&e.enemy!==undefined&&rigs[e.enemy]){rigs[e.enemy].flinchT=.2;hitTime=.15;}
   if(e.type==="kill"&&e.enemy!==undefined&&rigs[e.enemy]){rigs[e.enemy].deathT=0;}
   if(e.type==="reload")audio.play("reload");
  }
  combat.events.length=0;
  effects.update(dt);
  if(flashTime>0){muzzleLight.position.copy(muzzleWorld);muzzleLight.intensity=flashTime/.04*24;}else muzzleLight.intensity=0;
  flashTime-=dt;
  camera.position.set(p.x,p.y,p.z);camera.rotation.set(p.pitch,p.yaw,Math.sin(now*.031)*recoil*.04);
  const sprinting=active&&motion.sprinting&&(input.forward>0);
  sprintBoost+=((sprinting?7:0)-sprintBoost)*Math.min(1,dt*8);
  camera.fov=72-combat.ads*19+sprintBoost;camera.updateProjectionMatrix();audio.listener(p);
  const moving=active&&(input.forward||input.strafe),bob=moving?Math.sin(now*.012)*.018:Math.sin(now*.0017)*.002;
  recoil*=Math.exp(-dt*18);gun.position.set(.26*(1-combat.ads),-.23+combat.ads*.15+bob-(w.reload>0?Math.sin(w.reload/1.85*Math.PI)*.22:0),-.42+recoil);gun.rotation.z=w.reload>0?Math.sin(w.reload/1.85*Math.PI)*-.45:0;
  flash.visible=flashTime>0;
  rigs.forEach((rig,i)=>{
   const e=combat.enemies[i].get(Actor)!;
   const speed=Math.hypot(e.x-rigPrev[i].x,e.z-rigPrev[i].z)/Math.max(dt,.001);
   rigSpeeds[i]+= (speed-rigSpeeds[i])*Math.min(1,dt*10);
   rigPrev[i]={x:e.x,z:e.z};
   rig.group.position.set(e.x,0,e.z);
   rig.group.rotation.y=e.yaw;
   animateCombatant(rig,rig.deathT>=0?0:rigSpeeds[i],dt);
  });
  worldAnimations?.update(now/1000);
  ammo.textContent=String(w.magazine).padStart(2,"0");document.getElementById("reserve")!.textContent=String(w.reserve);health.style.width=`${p.health}%`;mode.textContent=w.reload>0?"RELOADING":w.automatic?"AUTO":"SEMI";timer.textContent=`00:${String(Math.max(0,Math.ceil(45-r.elapsed))).padStart(2,"0")}`;message.textContent=r.message;
  crosshair.style.opacity=combat.ads>.8&&hitTime<=0?"0":"1";crosshair.style.transform=`translate(-50%,-50%) scale(${1+(moving?.35:0)+recoil*5})`;crosshair.classList.toggle("hit",hitTime>0);hitTime-=dt;document.getElementById("damage")!.style.opacity=String((1-p.health/100)*.65);
  const headingDeg=(((-p.yaw*180/Math.PI)%360)+360)%360;
  compassStrip.style.transform=`translateX(${-headingDeg*3}px)`;
  if(active&&r.phase!=="playing"){document.exitPointerLock();status.textContent=r.message;start.textContent="REDEPLOY";}
  camera.updateMatrixWorld(true);shadows.updateFrustums();shadows.update();
  depthOfField.enabled=combat.ads>.01;(depthOfField.uniforms as Record<string,T.IUniform>).aperture.value=.0001*combat.ads;
  renderer.shadowMap.needsUpdate=true;renderer.info.reset();
 if(softwareRenderer&&!depthOfField.enabled)renderer.render(scene,camera);else composer.render(dt);
 drawCalls=renderer.info.render.calls;triangles=renderer.info.render.triangles;maxDrawCalls=Math.max(maxDrawCalls,drawCalls);maxTriangles=Math.max(maxTriangles,triangles);requestAnimationFrame(frame);
 }requestAnimationFrame(frame);
}
boot().catch(e=>{document.getElementById("status")!.textContent=`Unable to start: ${e.message}`;console.error(e);});
