import { describe, expect, it } from "bun:test";
import { defineBurstEffect, QuarksVfxProjection } from "../src/vfx";
import { GameWorld, Transform } from "@gauntlet/runtime";
import type { EffectSpawnIntent } from "../src/vfx";

const DT = 1 / 60;

const STANDARD_BURST = {
  particleCount: 50,
  duration: 5,
  startLife: 2,
  startSpeed: 1,
  startSize: 0.1,
  color: [1, 0.4, 0.1] as const,
};

function spawnIntent(overrides: Partial<EffectSpawnIntent> = {}): EffectSpawnIntent {
  return {
    effectId: "explosion.standard",
    entityId: "drone-1",
    position: [2, 1, -3],
    ...overrides,
  };
}

describe("three.quarks VFX effect projection (T17 - REQ-BIND-009)", () => {
  it("is fully headless: defines, spawns, and steps quarks effects with no DOM/WebGL/AudioContext", () => {
    expect(typeof document).toBe("undefined");
    expect(typeof (globalThis as any).AudioContext).toBe("undefined");

    const vfx = new QuarksVfxProjection();
    vfx.defineEffect("explosion.standard", defineBurstEffect(STANDARD_BURST));

    const spawned = vfx.spawnEffect(spawnIntent());
    expect(spawned).not.toBeNull();
    expect(spawned!.instanceId).toBe("vfx-explosion.standard-1");

    const step = vfx.update(DT);
    expect(step.activeInstances).toBe(1);
    expect(step.particleCount).toBeGreaterThan(0);
  });

  it("deterministic stepping: identical configs produce identical particle-count traces", () => {
    const runTrace = (): number[] => {
      const vfx = new QuarksVfxProjection();
      vfx.defineEffect("explosion.standard", defineBurstEffect(STANDARD_BURST));
      vfx.spawnEffect(spawnIntent());
      const trace: number[] = [];
      for (let i = 0; i < 30; i++) {
        trace.push(vfx.update(DT).particleCount);
      }
      vfx.dispose();
      return trace;
    };

    const a = runTrace();
    const b = runTrace();
    expect(a.length).toBe(30);
    expect(a[0]).toBeGreaterThan(0);
    expect(a).toEqual(b);
  });

  it("is an execution projection: direct emitter mutation never back-propagates into Koota", () => {
    const vfx = new QuarksVfxProjection();
    vfx.defineEffect("explosion.standard", defineBurstEffect(STANDARD_BURST));

    const world = new GameWorld();
    world.spawnEntity({ id: "drone-1", transform: { position: [2, 1, -3] } });

    const spawned = vfx.spawnEffect(spawnIntent({ entityId: "drone-1" }))!;
    expect(vfx.registry.get("drone-1")).toBe(spawned.emitter);

    // One-way sync restores the authoritative transform over any projection mutation.
    spawned.emitter.position.set(999, 999, 999);
    vfx.syncFromState(world);
    expect(spawned.emitter.position.x).toBeCloseTo(2, 5);
    expect(spawned.emitter.position.y).toBeCloseTo(1, 5);
    expect(spawned.emitter.position.z).toBeCloseTo(-3, 5);

    // Authoritative state was never touched by the projection mutation.
    const entity = world.getEntity("drone-1")!;
    expect(entity.get(Transform)!.position[0]).toBeCloseTo(2, 5);
    expect(entity.get(Transform)!.position[1]).toBeCloseTo(1, 5);
    // Release the Koota world id (global 16-world process cap).
    world.world.destroy();
  });

  it("destroy/recreate discipline: destroying the projection leaves the authoritative entity intact", () => {
    const vfx = new QuarksVfxProjection();
    vfx.defineEffect("explosion.standard", defineBurstEffect(STANDARD_BURST));

    const world = new GameWorld();
    world.spawnEntity({ id: "drone-1", transform: { position: [0, 0, 0] } });
    const spawned = vfx.spawnEffect(spawnIntent({ entityId: "drone-1" }))!;
    vfx.update(DT);

    expect(vfx.destroyEffect(spawned.instanceId)).toBe(true);
    expect(vfx.destroyEffect(spawned.instanceId)).toBe(false); // idempotent
    expect(vfx.registry.get("drone-1")).toBeUndefined();
    expect(vfx.getStats().active_instances).toBe(0);
    expect(world.hasEntity("drone-1")).toBe(true); // authority untouched

    // Recreatable at any time from authority.
    const recreated = vfx.spawnEffect(spawnIntent({ entityId: "drone-1", instanceId: "vfx-fixed-1" }))!;
    expect(recreated.instanceId).toBe("vfx-fixed-1");
    expect(vfx.registry.get("drone-1")).toBe(recreated.emitter);
    vfx.dispose();
    world.world.destroy();
  });

  it("unknown effect ids are suppressed and counted, never thrown (REQ-SAFE-007 discipline)", () => {
    const vfx = new QuarksVfxProjection();
    const result = vfx.spawnEffect({ effectId: "does.not.exist", position: [0, 0, 0] });
    expect(result).toBeNull();
    expect(vfx.getStats().suppressed_spawns).toBe(1);
    expect(vfx.getStats().active_instances).toBe(0);
  });

  it("effect lifecycle decays deterministically: short bursts fully expire under fixed steps", () => {
    const vfx = new QuarksVfxProjection();
    vfx.defineEffect(
      "explosion.short",
      defineBurstEffect({ ...STANDARD_BURST, startLife: 0.5, duration: 1 })
    );
    vfx.spawnEffect({ effectId: "explosion.short", entityId: "a", position: [0, 0, 0] });

    const stats = vfx.getStats();
    expect(stats.defined_effects).toBe(1);
    expect(stats.active_instances).toBe(1);
    expect(stats.particle_count).toBe(0); // burst fires on first update

    vfx.update(DT);
    expect(vfx.getStats().particle_count).toBeGreaterThan(0);

    // After 1.5s of simulated time every particle (0.5s life, spread burst emission)
    // has deterministically expired; the instance stays registered until explicitly
    // destroyed (projection ownership is explicit).
    for (let i = 1; i < 90; i++) vfx.update(DT);
    expect(vfx.getStats().particle_count).toBe(0);
    expect(vfx.getStats().active_instances).toBe(1);

    vfx.dispose();
    expect(vfx.update(DT).activeInstances).toBe(0);
  });
});
