import { describe, expect, it, beforeEach } from "bun:test";
import { SimulationScheduler } from "../src/scheduler";
import { ServerRuntime, assertHeadlessEnvironment } from "../src/server";
import { MultipleSchedulerError, DuplicateStepOwnerError, HeadlessDomLeakError } from "../src/errors";

describe("Simulation Scheduler & Headless Split Suite (T07)", () => {
  beforeEach(() => {
    SimulationScheduler.resetActiveScheduler();
  });

  it("advances simulation with fixed delta-time ticks", () => {
    const scheduler = new SimulationScheduler({ fixedDeltaTime: 1 / 60 });
    let steppedTicks = 0;

    scheduler.registerStepHandler((tick) => {
      steppedTicks++;
      expect(tick.dt).toBeCloseTo(1 / 60, 4);
    });

    // Advance 33.4ms -> exactly 2 ticks (16.67ms * 2 = 33.33ms)
    const steps = scheduler.advance(0.0334);
    expect(steps).toBe(2);
    expect(steppedTicks).toBe(2);
    expect(scheduler.getTick()).toBe(2);
  });

  it("TEETH-T07-002: Rejects multiple schedulers and duplicate step owners (Teeth Check)", () => {
    // 1. Create first scheduler
    const s1 = new SimulationScheduler();
    expect(s1).toBeDefined();

    // Attempt to create second scheduler -> throws MultipleSchedulerError
    expect(() => new SimulationScheduler()).toThrow(MultipleSchedulerError);

    // 2. Enforce exactly one step owner execution per tick
    s1.stepSingleTick(); // advance tick
    // Executing step owner for this tick
    expect(() => {
      s1.executeStepOwner("physics.rapier", () => {
        // step once
      });
    }).toThrow(DuplicateStepOwnerError); // already stepped this tick!
  });

  it("TEETH-T07-003: Headless server runs DOM-free and detects simulated DOM/canvas leaks (Teeth Check)", () => {
    // Clean headless environment
    expect(() => assertHeadlessEnvironment()).not.toThrow();

    const server = new ServerRuntime({ enablePhysics: true });
    expect(server.kernel.mode).toBe("headless");
    server.kernel.barrier.markBooting("physics");
    server.kernel.barrier.markReady("physics", 10);

    const tick = server.tick();
    expect(tick).toBe(1);

    // Simulate leaking a DOM global (e.g. window or document)
    (globalThis as any).window = {};
    try {
      expect(() => assertHeadlessEnvironment()).toThrow(HeadlessDomLeakError);
      expect(() => new ServerRuntime()).toThrow(HeadlessDomLeakError);
    } finally {
      delete (globalThis as any).window;
    }
  });
});
