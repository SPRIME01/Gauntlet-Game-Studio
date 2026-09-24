import { createWorld, trait } from "koota";
import { blocks } from "./arena";

export interface Vec3 { x: number; y: number; z: number }
export const Actor = trait({ x: 0, y: 0, z: 0, health: 100, yaw: 0, pitch: 0 });
export const Weapon = trait({ magazine: 30, reserve: 90, cooldown: 0, reload: 0, automatic: true, shots: 0, recovery: 0 });
export const Round = trait({ elapsed: 0, kills: 0, hits: 0, phase: "ready", message: "CLEAR THE COMPOUND" });
export const Motion = trait({ ads: 0, crouch: 0, slide: 0, trigger: false, sprinting: false });
export const AI = trait({ cooldown: 1.2, repath: 0, path: () => [] as Vec3[], alert: false, peeking: false });
export interface Input { forward: number; strafe: number; sprint: boolean; crouch: boolean; ads: boolean; fire: boolean }
export interface Hit { enemy?: number; point: Vec3; normal: Vec3 }
export interface CombatPorts {
  move(position: Vec3, delta: Vec3): Vec3;
  shoot(origin: Vec3, direction: Vec3): Hit | null;
  visible(origin: Vec3, target: Vec3): boolean;
  path(start: Vec3, target: Vec3): Vec3[];
}
export const idleInput = (): Input => ({ forward: 0, strafe: 0, sprint: false, crouch: false, ads: false, fire: false });
export class Combat {
  readonly world = createWorld();
  readonly player = this.world.spawn(Actor({ x: 0, y: 1.65, z: 9 }), Weapon, Motion);
  readonly round = this.world.spawn(Round);
  readonly enemies = [this.world.spawn(Actor({ x: -5, y: 1.1, z: -8 }), AI), this.world.spawn(Actor({ x: 6, y: 1.1, z: -17 }), AI)];
  get ads(){return this.player.get(Motion)!.ads;} set ads(ads:number){this.player.set(Motion,{ads});}
  get crouch(){return this.player.get(Motion)!.crouch;} set crouch(crouch:number){this.player.set(Motion,{crouch});}
  get slide(){return this.player.get(Motion)!.slide;} set slide(slide:number){this.player.set(Motion,{slide});}
  private get trigger(){return this.player.get(Motion)!.trigger;} private set trigger(trigger:boolean){this.player.set(Motion,{trigger});}
  private get sprinting(){return this.player.get(Motion)!.sprinting;} private set sprinting(sprinting:boolean){this.player.set(Motion,{sprinting});}
  events: Array<{ type: "shot" | "impact" | "hit" | "kill" | "enemy-shot" | "reload"; point?: Vec3; normal?: Vec3; target?: Vec3; enemy?: number }> = [];
  constructor(readonly ports: CombatPorts) {}
  start() { this.round.set(Round, { phase: "playing" }); }
  look(dx: number, dy: number) {
    const p = this.player.get(Actor)!;
    this.player.set(Actor, { yaw: p.yaw - dx * .002, pitch: Math.max(-1.4, Math.min(1.4, p.pitch - dy * .002)) });
  }
  reload() {
    const w = this.player.get(Weapon)!;
    if (this.round.get(Round)!.phase === "playing" && w.magazine < 30 && w.reserve > 0 && w.reload === 0) {
      this.player.set(Weapon, { reload: 1.85 }); this.events.push({ type: "reload" });
    }
  }
  toggleMode() { this.player.set(Weapon, { automatic: !this.player.get(Weapon)!.automatic }); }
  step(dt: number, input: Input) {
    const round = this.round.get(Round)!;
    if (round.phase !== "playing") return;
    const p = { ...this.player.get(Actor)! }, w = { ...this.player.get(Weapon)! };
    w.cooldown = Math.max(0, w.cooldown - dt); w.recovery = Math.max(0, w.recovery - dt);
    if (w.reload > 0) {
      w.reload = Math.max(0, w.reload - dt);
      if (w.reload === 0) { const n = Math.min(30 - w.magazine, w.reserve); w.magazine += n; w.reserve -= n; }
    }
    const sprint = input.sprint && input.forward > 0 && !input.ads && !input.crouch;
    if (this.sprinting && !sprint) w.recovery = .22;
    if (input.crouch && this.sprinting) this.slide = .65;
    this.slide = Math.max(0, this.slide - dt);
    this.sprinting = sprint;
    this.ads += ((input.ads && !sprint ? 1 : 0) - this.ads) * Math.min(1, dt * 14);
    this.crouch += ((input.crouch || this.slide > 0 ? 1 : 0) - this.crouch) * Math.min(1, dt * 14);
    const speed = this.slide > 0 ? 7 : sprint ? 6 : input.crouch ? 1.8 : input.ads ? 2.2 : 3.6;
    const norm = Math.max(1, Math.hypot(input.forward, input.strafe));
    const f = this.slide > 0 ? 1 : input.forward / norm, s = input.strafe / norm;
    p.y = 1.65 - this.crouch * .55;
    const moved = this.ports.move(p, { x: (s * Math.cos(p.yaw) - f * Math.sin(p.yaw)) * speed * dt, y: 0, z: (-f * Math.cos(p.yaw) - s * Math.sin(p.yaw)) * speed * dt });
    p.x = moved.x; p.z = moved.z; p.y = 1.65 - this.crouch * .55;
    if (input.fire && (w.automatic || !this.trigger) && !sprint && w.recovery === 0 && w.reload === 0 && w.cooldown === 0 && w.magazine > 0) {
      w.magazine--; w.shots++; w.cooldown = .09;
      const direction = { x: -Math.sin(p.yaw) * Math.cos(p.pitch), y: Math.sin(p.pitch), z: -Math.cos(p.yaw) * Math.cos(p.pitch) };
      const hit = this.ports.shoot(p, direction);
      const endpoint = hit ? hit.point : { x: p.x + direction.x * 90, y: p.y + direction.y * 90, z: p.z + direction.z * 90 };
      this.events.push({ type: "shot", point: endpoint });
      if (hit) {
        this.events.push({ type: "impact", point: hit.point, normal: hit.normal });
        const enemy = hit.enemy === undefined ? undefined : this.enemies[hit.enemy];
        if (enemy && enemy.get(Actor)!.health > 0) {
          const health = Math.max(0, enemy.get(Actor)!.health - 34); enemy.set(Actor, { health });
          round.hits++; this.events.push({ type: "hit", enemy: hit.enemy });
          if (!health) { round.kills++; this.events.push({ type: "kill", enemy: hit.enemy }); round.message = "HOSTILE ELIMINATED"; }
        }
      }
      p.pitch = Math.min(1.4, p.pitch + .013 + (w.shots % 5) * .0015);
      p.yaw += Math.sin(w.shots * 1.7) * .005;
    }
    this.trigger = input.fire;
    this.enemies.forEach((enemy, i) => {
      const e = { ...enemy.get(Actor)! }, ai = enemy.get(AI)!; if (e.health <= 0) return;
      const visible = this.ports.visible(e, p), distance = Math.hypot(e.x - p.x, e.z - p.z);
      if (visible && distance < 32) ai.alert = true;
      if (!ai.alert) { enemy.set(AI,ai); return; }
      ai.repath -= dt; ai.cooldown -= dt;
      if (ai.repath <= 0) {
        const candidates=blocks.filter(b=>b.y>0&&b.h<3).flatMap(b=>[-1,1].map(side=>({x:b.x+side*(b.w/2+.7),y:1.1,z:b.z+(p.z>b.z?-1:1)*(b.d/2+.6)})));
        candidates.sort((a,b)=>Math.hypot(e.x-a.x,e.z-a.z)-Math.hypot(e.x-b.x,e.z-b.z));
        ai.peeking=!ai.peeking;
        for(const target of candidates){
          if(this.ports.visible(target,p)!==ai.peeking)continue;
          const path=this.ports.path(e,target);if(path.length){ai.path=path;break;}
        }
        ai.repath=ai.peeking?2:3;
      }
      const target = ai.path[0];
      if (target) {
        const dx = target.x - e.x, dz = target.z - e.z, length = Math.hypot(dx, dz);
        if (length < .15) ai.path.shift(); else { const step = Math.min(length, dt * 1.5); e.x += dx / length * step; e.z += dz / length * step; }
      }
      e.yaw = Math.atan2(p.x - e.x, p.z - e.z);
      if (this.ports.visible(e,p) && distance < 28 && ai.cooldown <= 0) {
        p.health = Math.max(0, p.health - 6); ai.cooldown = .95;
        this.events.push({ type: "enemy-shot", point: { x: e.x, y: 1.3, z: e.z }, target: { x: p.x, y: p.y, z: p.z } });
      }
      enemy.set(Actor, e); enemy.set(AI,ai);
    });
    round.elapsed += dt;
    if (p.health <= 0) { round.phase = "lost"; round.message = "OPERATOR DOWN"; }
    else if (round.kills === 2) { round.phase = "won"; round.message = "COMPOUND SECURED"; }
    else if (round.elapsed >= 45) { round.phase = "lost"; round.message = "TIME EXPIRED"; }
    this.player.set(Actor, p); this.player.set(Weapon, w); this.round.set(Round, round);
  }
  snapshot() { return { player: this.player.get(Actor), weapon: this.player.get(Weapon), round: this.round.get(Round), enemies: this.enemies.map(e => e.get(Actor)), ads: this.ads }; }
  dispose() { this.world.destroy(); }
}
