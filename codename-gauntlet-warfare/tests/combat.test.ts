import { expect, test } from "bun:test";
import { Actor, Combat, idleInput, Round, Weapon, type CombatPorts } from "../src/combat";
const ports = (): CombatPorts => ({ move: (p,d) => ({x:p.x+d.x,y:p.y,z:p.z+d.z}), shoot: () => null, visible: () => false, path: () => [] });
test("misses consume ammunition without awarding hits; cover prevents damage", () => {
  const c = new Combat(ports()); c.start(); c.step(.1, {...idleInput(),fire:true});
  expect(c.player.get(Weapon)!.magazine).toBe(29); expect(c.round.get(Round)!.hits).toBe(0);
  for(let i=0;i<100;i++) c.step(.1,idleInput());
  expect(c.player.get(Actor)!.health).toBe(100); c.dispose();
});
test("confirmed hits kill once, semi fire requires release, reload is timed", () => {
  const p=ports(); p.shoot=()=>({enemy:0,point:{x:0,y:1,z:0},normal:{x:0,y:0,z:1}});
  const c=new Combat(p); c.start(); c.toggleMode();
  for(let i=0;i<10;i++) c.step(.1,{...idleInput(),fire:true});
  expect(c.player.get(Weapon)!.magazine).toBe(29);
  for(let i=0;i<4;i++){c.step(.1,idleInput());c.step(.1,{...idleInput(),fire:true});}
  expect(c.round.get(Round)!.kills).toBe(1); expect(c.round.get(Round)!.hits).toBe(3);
  c.reload(); c.step(.1,idleInput()); expect(c.player.get(Weapon)!.magazine).toBe(25);
  for(let i=0;i<120;i++)c.step(1/60,idleInput());
  expect(c.player.get(Weapon)!.magazine).toBe(30); expect(c.player.get(Weapon)!.reserve).toBe(85); c.dispose();
});
test("sprint-to-fire delay and terminal timeout gate shooting",()=>{
 const c=new Combat(ports());c.start();c.step(.1,{...idleInput(),forward:1,sprint:true});
 c.step(.1,{...idleInput(),fire:true});expect(c.player.get(Weapon)!.magazine).toBe(30);
 c.step(.23,{...idleInput(),fire:true});expect(c.player.get(Weapon)!.magazine).toBe(29);
 for(let i=0;i<460;i++)c.step(.1,idleInput());expect(c.round.get(Round)!.phase).toBe("lost");
 c.step(.1,{...idleInput(),fire:true});expect(c.player.get(Weapon)!.magazine).toBe(29);c.dispose();
});
test("both confirmed kills win and terminal state cannot award additional shots",()=>{
 const p=ports();let target=0;
 p.shoot=()=>({enemy:target,point:{x:0,y:1,z:0},normal:{x:0,y:0,z:1}});
 const c=new Combat(p);c.start();
 for(target=0;target<2;target++)for(let shot=0;shot<3;shot++)c.step(.1,{...idleInput(),fire:true});
 expect(c.round.get(Round)!.phase).toBe("won");
 expect(c.round.get(Round)!.message).toBe("COMPOUND SECURED");
 expect(c.round.get(Round)!.kills).toBe(2);
 const terminal=structuredClone(c.snapshot());c.step(1,{...idleInput(),fire:true});
 expect(c.snapshot()).toEqual(terminal);c.dispose();
});
test("exposed player dies from enemy fire and a new round restores all combat state",()=>{
 const p=ports();p.visible=()=>true;
 const c=new Combat(p);c.start();
 for(let tick=0;tick<1200&&c.round.get(Round)!.phase==="playing";tick++)c.step(1/60,idleInput());
 expect(c.player.get(Actor)!.health).toBe(0);
 expect(c.round.get(Round)!.message).toBe("OPERATOR DOWN");
 expect(c.round.get(Round)!.phase).toBe("lost");
 const terminal=structuredClone(c.snapshot());c.step(1,{...idleInput(),fire:true});
 expect(c.snapshot()).toEqual(terminal);c.dispose();
 const next=new Combat(p);
 expect(next.player.get(Actor)!.health).toBe(100);
 expect(next.player.get(Weapon)!.magazine).toBe(30);
 expect(next.round.get(Round)!.elapsed).toBe(0);
 expect(next.enemies.every(e=>e.get(Actor)!.health===100)).toBe(true);
 next.dispose();
});
