import * as T from "three";
import { BatchedParticleRenderer, ConstantColor, ConstantValue, ParticleSystem, RenderMode, Vector4 } from "three.quarks";
export class Effects {
 readonly batch=new BatchedParticleRenderer();
 private bursts:Array<{system:ParticleSystem;ttl:number}>=[];
 private casingGeometry=new T.CylinderGeometry(.018,.018,.075,6);
 private casingMaterial=new T.MeshStandardMaterial({color:0xb29950,metalness:.8,roughness:.4});
 private casings:Array<{mesh:T.Mesh;velocity:T.Vector3;ttl:number;bounces:number}>=[];
 // Tracers: one InstancedMesh for every live beam (single draw call).
 private tracerMesh=new T.InstancedMesh(new T.BoxGeometry(.012,.012,1),new T.MeshBasicMaterial({color:0xffd9a0,transparent:true,blending:T.AdditiveBlending,depthWrite:false}),16);
 private tracerTtl=new Array(16).fill(0);
 private nextTracer=0;
 private smokeSystems:ParticleSystem[]=[];
 constructor(readonly scene:T.Scene){
  scene.add(this.batch);
  this.tracerMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
  this.tracerMesh.frustumCulled=false;
  this.tracerMesh.count=16;
  const hide=new T.Matrix4().makeScale(0,0,0);
  for(let i=0;i<16;i++)this.tracerMesh.setMatrixAt(i,hide);
  scene.add(this.tracerMesh);
 }
 burst(position:T.Vector3,muzzle=false){
  if(this.bursts.length>=20)return;
  const system=new ParticleSystem({material:new T.MeshBasicMaterial({transparent:true,opacity:muzzle?.8:.25,depthWrite:false,blending:muzzle?T.AdditiveBlending:T.NormalBlending}),renderMode:RenderMode.BillBoard,looping:false,duration:.06,emissionBursts:[{time:0,count:new ConstantValue(muzzle?6:10),cycle:1,interval:.001,probability:1}],startLife:new ConstantValue(muzzle?.05:.3),startSpeed:new ConstantValue(muzzle?1.8:.7),startSize:new ConstantValue(muzzle?.07:.14),startRotation:new ConstantValue(0),startColor:new ConstantColor(new Vector4(muzzle?1:.55,muzzle?.72:.45,muzzle?.3:.32,1))});
  system.emitter.position.copy(position);this.scene.add(system.emitter);this.batch.addSystem(system);this.bursts.push({system,ttl:.5});
 }
 /** Slow looping dust smoke for atmosphere anchors (rubble, rooftops). */
 ambientSmoke(position:T.Vector3,scale=1){
  if(this.smokeSystems.length>=3)return;
  const system=new ParticleSystem({material:new T.MeshBasicMaterial({transparent:true,opacity:.1,depthWrite:false}),renderMode:RenderMode.BillBoard,looping:true,duration:5,emissionBursts:[],startLife:new ConstantValue(4.5),startSpeed:new ConstantValue(.3),startSize:new ConstantValue(.55*scale),startRotation:new ConstantValue(0),startColor:new ConstantColor(new Vector4(.62,.58,.5,.12))});
  system.emitter.position.copy(position);
  system.emitter.rotation.x=-Math.PI/2; // emit upward (+Z local now points up)
  this.scene.add(system.emitter);this.batch.addSystem(system);this.smokeSystems.push(system);
 }
 /** Beam from muzzle to endpoint; additive, fades in ~70ms. */
 tracer(from:T.Vector3,to:T.Vector3){
  const i=this.nextTracer++%16;
  const dir=new T.Vector3().subVectors(to,from);
  const length=dir.length();
  if(length<.5)return;
  const matrix=new T.Matrix4();
  matrix.lookAt(new T.Vector3(),dir.clone().normalize(),new T.Vector3(0,1,0));
  matrix.setPosition(new T.Vector3().addVectors(from,to).multiplyScalar(.5));
  matrix.scale(new T.Vector3(1,1,length));
  this.tracerMesh.setMatrixAt(i,matrix);
  this.tracerMesh.instanceMatrix.needsUpdate=true;
  this.tracerTtl[i]=.07;
 }
 eject(position:T.Vector3,yaw:number){
  if(this.casings.length>=24){const old=this.casings.shift()!;this.scene.remove(old.mesh);}
  const mesh=new T.Mesh(this.casingGeometry,this.casingMaterial);mesh.position.copy(position);this.scene.add(mesh);this.casings.push({mesh,velocity:new T.Vector3(Math.cos(yaw)*2,1.4,-Math.sin(yaw)*2),ttl:3,bounces:0});
 }
 update(dt:number){
  this.batch.update(dt);
  for(let i=this.bursts.length-1;i>=0;i--){const b=this.bursts[i];b.ttl-=dt;if(b.ttl<=0){this.batch.deleteSystem(b.system);this.scene.remove(b.system.emitter);const material=b.system.material;b.system.dispose();material.dispose();this.bursts.splice(i,1);}}
  for(let i=0;i<16;i++){
   if(this.tracerTtl[i]>0){
    this.tracerTtl[i]-=dt;
    if(this.tracerTtl[i]<=0){this.tracerMesh.setMatrixAt(i,new T.Matrix4().makeScale(0,0,0));this.tracerMesh.instanceMatrix.needsUpdate=true;}
   }
  }
  for(let i=this.casings.length-1;i>=0;i--){const c=this.casings[i];c.ttl-=dt;c.velocity.y-=9.8*dt;c.mesh.position.addScaledVector(c.velocity,dt);c.mesh.rotation.x+=dt*7;c.mesh.rotation.z+=dt*5;if(c.mesh.position.y<.04){c.mesh.position.y=.04;c.velocity.y=Math.abs(c.velocity.y)*.3;c.velocity.x*=.6;c.velocity.z*=.6;c.bounces++;}if(c.ttl<=0){this.scene.remove(c.mesh);this.casings.splice(i,1);}}
 }
}
