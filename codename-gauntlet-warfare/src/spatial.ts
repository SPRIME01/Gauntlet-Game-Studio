import RAPIER from "@dimforge/rapier3d-compat";
import { init, NavMeshQuery, type NavMesh } from "recast-navigation";
import { generateSoloNavMesh } from "recast-navigation/generators";
import { BoxGeometry } from "three";
import { blocks } from "./arena";
import { Actor, type Combat, type CombatPorts, type Vec3 } from "./combat";

export class Spatial implements CombatPorts {
  world!: RAPIER.World; controller!: RAPIER.KinematicCharacterController;
  player!: RAPIER.Collider; enemies: RAPIER.Collider[]=[];
  nav!: NavMesh; query!: NavMeshQuery; tick=0;
  async init() {
    await Promise.all([RAPIER.init(),init()]);
    this.world=new RAPIER.World({x:0,y:-9.81,z:0});
    const vertices:number[]=[], indices:number[]=[];
    for(const b of blocks){
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(b.w/2,b.h/2,b.d/2).setTranslation(b.x,b.y,b.z));
      const g=new BoxGeometry(b.w,b.h,b.d).translate(b.x,b.y,b.z), offset=vertices.length/3;
      vertices.push(...g.attributes.position.array);indices.push(...Array.from(g.index!.array,n=>n+offset));g.dispose();
    }
    const result=generateSoloNavMesh(new Float32Array(vertices),new Uint32Array(indices),{cs:.2,ch:.1,walkableHeight:18,walkableClimb:3,walkableRadius:3});
    if(!result.success||!result.navMesh)throw new Error("Recast failed to build the compound navigation mesh");
    this.nav=result.navMesh;this.query=new NavMeshQuery(this.nav);
    this.player=this.world.createCollider(RAPIER.ColliderDesc.capsule(.45,.3).setTranslation(0,.8,9));
    this.controller=this.world.createCharacterController(.02);this.controller.setSlideEnabled(true);
    for(const x of [-5,6])this.enemies.push(this.world.createCollider(RAPIER.ColliderDesc.capsule(.55,.3).setTranslation(x,1.1,-8)));
    this.world.step();
  }
  move(p:Vec3,d:Vec3):Vec3 {
    const halfHeight=Math.max(.15,(p.y-.15)/2-.3), center=halfHeight+.32;
    this.player.setShape(new RAPIER.Capsule(halfHeight,.3));
    this.player.setTranslation({x:p.x,y:center,z:p.z});
    this.controller.computeColliderMovement(this.player,{...d,y:-.02},undefined,undefined,c=>!this.enemies.includes(c));
    const m=this.controller.computedMovement();const next={x:p.x+m.x,y:p.y,z:p.z+m.z};
    this.player.setTranslation({x:next.x,y:center,z:next.z});return next;
  }
  shoot(origin:Vec3,direction:Vec3) {
    const ray=new RAPIER.Ray(origin,direction);
    const hit=this.world.castRayAndGetNormal(ray,100,true,undefined,undefined,this.player);
    if(!hit)return null;
    const enemy=this.enemies.findIndex(c=>c.handle===hit.collider.handle);
    return {point:ray.pointAt(hit.timeOfImpact),normal:hit.normal,enemy:enemy<0?undefined:enemy};
  }
  visible(origin:Vec3,target:Vec3) {
    const dx=target.x-origin.x,dy=target.y-origin.y,dz=target.z-origin.z,length=Math.hypot(dx,dy,dz);
    if(length<.01)return true;
    const hit=this.world.castRay(new RAPIER.Ray(origin,{x:dx/length,y:dy/length,z:dz/length}),length,true,undefined,undefined,this.player,undefined,c=>!this.enemies.includes(c));
    return !hit;
  }
  path(start:Vec3,target:Vec3){const r=this.query.computePath({...start,y:.1},{...target,y:.1});return r.success?r.path.slice(1):[];}
  step(c:Combat,dt:number){
    c.enemies.forEach((e,i)=>{const p=e.get(Actor)!;this.enemies[i].setEnabled(p.health>0);this.enemies[i].setTranslation(p);});
    this.world.timestep=dt;this.world.step();this.tick++;
  }
  dispose(){this.query.destroy();this.nav.destroy();this.world.free();}
}
