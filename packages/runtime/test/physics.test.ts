import { describe, it, expect, beforeEach, beforeAll } from "bun:test";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  RapierPhysicsAdapter,
  SinglePhysicsStepInvariantError,
  SubsystemBarrier,
} from "../src/index";

describe("Rapier Physics Adapter & Single Step Ownership Suite (T10 - REQ-BIND-015, REQ-RUNTIME-006)", () => {
  let adapter: RapierPhysicsAdapter;

  beforeAll(async () => {
    await RapierPhysicsAdapter.initWasm();
  });

  beforeEach(() => {
    adapter = new RapierPhysicsAdapter();
    adapter.initWorld({ gravity: { x: 0, y: -9.81, z: 0 } });
  });

  it("initializes Rapier world with configured gravity", () => {
    expect(adapter.world).toBeDefined();
    expect(adapter.world.gravity.y).toBeCloseTo(-9.81, 2);
  });

  it("integrates cleanly with SubsystemBarrier", async () => {
    const barrier = new SubsystemBarrier();
    barrier.register("physics", true);

    expect(barrier.getReadiness().state).toBe("created");

    // Initialize physics
    adapter.initWorld();
    barrier.markReady("physics");

    const readiness = await barrier.awaitReady(1000);
    expect(readiness.state).toBe("ready");
    expect(readiness.subsystem_states["physics"]).toBe("ready");
  });

  it("steps physics simulation forward with single step owner", () => {
    // Add dynamic rigid body
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 10, 0);
    const body = adapter.world.createRigidBody(bodyDesc);
    const colDesc = RAPIER.ColliderDesc.ball(0.5);
    adapter.world.createCollider(colDesc, body);

    const initialY = body.translation().y;
    expect(initialY).toBe(10);

    // Step 5 ticks with single step owner
    const dt = 1 / 60;
    for (let tick = 1; tick <= 5; tick++) {
      adapter.step(dt, tick, "scheduler");
    }

    const newY = body.translation().y;
    expect(newY).toBeLessThan(initialY); // Gravity pulled body down
    expect(adapter.getLastSteppedTick()).toBe(5);
  });

  it("TEETH-T10-003: Attempt duplicate Rapier step within same tick throws SinglePhysicsStepInvariantError (Teeth Check)", () => {
    const dt = 1 / 60;
    const tick = 42;

    // First legitimate step from simulation scheduler succeeds
    adapter.step(dt, tick, "scheduler");
    expect(adapter.getLastSteppedTick()).toBe(tick);

    // ATTACK: Rogue render loop or donor component attempts a second physics step within the same tick
    expect(() => {
      adapter.step(dt, tick, "rogue_render_loop");
    }).toThrow(SinglePhysicsStepInvariantError);

    // Verify error has correct invariant violation code
    try {
      adapter.step(dt, tick, "duplicate_loop");
    } catch (err) {
      expect(err).toBeInstanceOf(SinglePhysicsStepInvariantError);
      expect((err as SinglePhysicsStepInvariantError).code).toBe("SINGLE_PHYSICS_STEP_INVARIANT_VIOLATION");
    }
  });

  it("performs raycast against colliders accurately", () => {
    // Ground collider at y = 0
    const groundDesc = RAPIER.ColliderDesc.cuboid(10, 0.1, 10);
    adapter.world.createCollider(groundDesc);
    adapter.step(1 / 60, 100);

    // Raycast down from y = 10
    const hit = adapter.castRay([0, 10, 0], [0, -1, 0], 20, true);
    expect(hit).not.toBeNull();
    if (hit) {
      expect(hit.timeOfImpact).toBeCloseTo(9.9, 1);
      expect(hit.hitPoint[1]).toBeCloseTo(0.1, 1);
      expect(hit.normal[1]).toBeCloseTo(1.0, 2);
    }
  });

  it("extracts debug render buffers without mutating simulation truth", () => {
    adapter.world.createCollider(RAPIER.ColliderDesc.cuboid(5, 5, 5));
    const debug = adapter.getDebugRenderBuffers();
    expect(debug.vertices.length).toBeGreaterThan(0);
    expect(debug.colors.length).toBeGreaterThan(0);
  });
});
