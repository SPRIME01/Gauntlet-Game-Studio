import { describe, expect, it } from "bun:test";
import { SubsystemBarrier } from "../src/readiness";
import { RuntimeNotReadyError, SubsystemBootError } from "../src/errors";

describe("Runtime Readiness & Subsystem Barriers Suite (T07)", () => {
  it("initializes subsystem barrier in created state", () => {
    const barrier = new SubsystemBarrier();
    barrier.register("physics", true);
    barrier.register("navigation", true);

    const r = barrier.getReadiness();
    expect(r.state).toBe("created");
    expect(barrier.isReady()).toBe(false);
  });

  it("transitions to ready when all required subsystems mark ready", async () => {
    const barrier = new SubsystemBarrier();
    barrier.register("physics", true);
    barrier.register("navigation", true);

    barrier.markBooting("physics");
    barrier.markBooting("navigation");

    expect(barrier.getReadiness().state).toBe("booting");

    barrier.markReady("physics", 15);
    expect(barrier.isReady()).toBe(false);

    barrier.markReady("navigation", 25);
    expect(barrier.isReady()).toBe(true);

    const ready = await barrier.awaitReady();
    expect(ready.state).toBe("ready");
    expect(ready.ready_at).toBeDefined();
  });

  it("TEETH-T07-001: Rejects scenario start while subsystems are still booting or failed (Teeth Check)", async () => {
    const barrier = new SubsystemBarrier();
    barrier.register("physics", true);
    barrier.register("navigation", true);

    // Case 1: Physics still booting -> startScenario throws RuntimeNotReadyError
    barrier.markBooting("physics");
    barrier.markReady("navigation", 10);

    expect(() => {
      barrier.startScenario(() => "should_not_run");
    }).toThrow(RuntimeNotReadyError);

    // Case 2: Physics fails -> barrier rejects and startScenario throws
    barrier.markFailed("physics", "Rapier WASM failed to compile in target environment");
    expect(barrier.getReadiness().state).toBe("failed");
    expect(barrier.isReady()).toBe(false);

    expect(() => {
      barrier.startScenario(() => "should_not_run");
    }).toThrow(RuntimeNotReadyError);

    expect(barrier.awaitReady()).rejects.toThrow(SubsystemBootError);
  });

  it("allows optional subsystems to remain unready without blocking readiness", async () => {
    const barrier = new SubsystemBarrier();
    barrier.register("rendering", true);
    barrier.register("audio", false); // Optional

    barrier.markBooting("rendering");
    barrier.markReady("rendering", 10);

    // Audio is optional and not ready, but overall runtime is ready
    expect(barrier.isReady()).toBe(true);
    const r = await barrier.awaitReady();
    expect(r.state).toBe("ready");
  });
});
