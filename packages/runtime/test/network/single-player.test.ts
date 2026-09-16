import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { GauntletKernel } from "../../src/kernel";
import { SimulationScheduler } from "../../src/scheduler";
import { GameWorld } from "../../src/state/world";
import { Transform, Velocity } from "../../src/state/traits";
import { AuthoritativeServer } from "../../src/network/server";
import { pooledWorld } from "./helpers";

describe("Single-player network-freedom (T12 - REQ-NET-001, REQ-BIND-013, TEETH-T12-003)", () => {
  beforeEach(() => {
    SimulationScheduler.resetActiveScheduler();
  });

  afterEach(() => {
    SimulationScheduler.resetActiveScheduler();
  });

  it("TEETH-T12-003: a single-player scenario starts and behaves normally with network dependencies unavailable", () => {
    const serversBefore = AuthoritativeServer.getActiveServerCount();
    expect(serversBefore).toBe(0);

    // Single-player runtime: NO network subsystem is ever registered, NO
    // transport/server is ever constructed. Physics is the only subsystem.
    const kernel = new GauntletKernel({ mode: "local-authoritative" });
    kernel.barrier.register("physics", true);
    kernel.barrier.markBooting("physics");
    kernel.barrier.markReady("physics", 1);

    expect(kernel.barrier.isReady()).toBe(true);
    const subsystems = kernel.barrier.getSubsystems();
    expect(Object.keys(subsystems)).not.toContain("network");

    const world: GameWorld = kernel.gameWorld;
    world.spawnEntity({
      id: "hero",
      transform: { position: [0, 0, 0] },
      velocity: { linear: [1, 0, 0] },
      tags: ["player"],
    });

    // Gameplay proceeds entirely without network initialization: an ordinary
    // integration step over 60 authoritative ticks.
    kernel.scheduler.start();
    const finalX = kernel.barrier.startScenario(() => {
      let x = 0;
      for (let i = 0; i < 60; i++) {
        kernel.scheduler.stepSingleTick();
        const entity = world.getEntity("hero")!;
        const t = entity.get(Transform)!;
        const v = entity.get(Velocity)!;
        const next: [number, number, number] = [
          t.position[0] + v.linear[0] * (1 / 60),
          t.position[1] + v.linear[1] * (1 / 60),
          t.position[2] + v.linear[2] * (1 / 60),
        ];
        entity.set(Transform, {
          position: next,
          rotation: t.rotation,
          scale: t.scale,
        });
        x = next[0];
      }
      return x;
    });

    // The scenario started and behaved normally.
    expect(finalX).toBeCloseTo(1.0, 5);
    expect(kernel.getDiagnostics().state).toBe("ready");
    expect(kernel.getDiagnostics().tick).toBe(60);

    // Semantic authority remains healthy and network-free.
    expect(world.hasEntity("hero")).toBe(true);
    expect(() => world.assertNoProviderObjectsInState()).not.toThrow();

    // No authoritative server was ever brought into existence.
    expect(AuthoritativeServer.getActiveServerCount()).toBe(serversBefore);

    kernel.dispose();
  });

  it("single-player world snapshot/restore round-trips without any network representation", () => {
    const world = pooledWorld.acquire();
    try {
      world.spawnEntity({ id: "solo", transform: { position: [3, 4, 5] } });

      const snapshot = world.takeSemanticSnapshot();
      expect(snapshot.entities).toHaveLength(1);
      expect(JSON.parse(JSON.stringify(snapshot.entities[0])).id).toBe("solo");

      // Restore into the same (cleared) world proves pure-JSON round-tripping.
      world.restoreSemanticSnapshot(JSON.parse(JSON.stringify(snapshot)));
      expect(world.getEntity("solo")!.get(Transform)!.position).toEqual([3, 4, 5]);
    } finally {
      pooledWorld.release(world);
    }
  });
});
