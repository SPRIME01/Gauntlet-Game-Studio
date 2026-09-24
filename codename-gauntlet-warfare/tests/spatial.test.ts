import { expect,test } from "bun:test";
import { Spatial } from "../src/spatial";
import { Combat, Actor, Round, idleInput } from "../src/combat";
test("real Rapier occlusion and Recast paths use arena geometry",async()=>{
 const s=new Spatial();await s.init();
 expect(s.visible({x:0,y:1,z:5},{x:0,y:1,z:-5})).toBe(true);
 expect(s.visible({x:4,y:1,z:-5},{x:4,y:1,z:-11})).toBe(false);
 const hit=s.shoot({x:4,y:1,z:-5},{x:0,y:0,z:-1});expect(hit).not.toBeNull();expect(hit!.enemy).toBeUndefined();
 const path=s.path({x:0,y:0,z:9},{x:0,y:0,z:-15});expect(path.length).toBeGreaterThan(0);
 let p={x:4,y:1.65,z:-5};for(let i=0;i<120;i++){p=s.move(p,{x:0,y:0,z:-.05});s.world.step();}
 expect(p.z).toBeGreaterThan(-7.4);s.dispose();
});
test("Rapier hits resolve to Koota enemies and restart synchronizes their positions",async()=>{
 const s=new Spatial();await s.init();const c=new Combat(s);s.step(c,1/60);c.start();
 expect(s.enemies[1].translation().z).toBe(-17);
 const e=c.enemies[0].get(Actor)!,p=c.player.get(Actor)!;
 const yaw=Math.atan2(-(e.x-p.x),-(e.z-p.z)),pitch=Math.atan2(e.y-p.y,Math.hypot(e.x-p.x,e.z-p.z));
 for(let i=0;i<3;i++){c.player.set(Actor,{yaw,pitch});c.step(.1,{...idleInput(),fire:true});s.step(c,.1);}
 expect(c.round.get(Round)!.kills).toBe(1);expect(c.enemies[0].get(Actor)!.health).toBe(0);
 c.dispose();const next=new Combat(s);s.step(next,1/60);expect(s.enemies[0].isEnabled()).toBe(true);expect(s.enemies[0].translation().z).toBe(-8);next.dispose();s.dispose();
});
test("sandbag cover blocks below its canonical top and clears rays above it",async()=>{
 const s=new Spatial();await s.init();
 try{
  expect(s.visible({x:-6,y:1.19,z:3},{x:-6,y:1.19,z:-1})).toBe(false);
  expect(s.visible({x:-6,y:1.21,z:3},{x:-6,y:1.21,z:-1})).toBe(true);
 }finally{s.dispose();}
});
