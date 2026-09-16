import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import {
  GauntletKernel,
  RapierPhysicsAdapter,
  RecastNavigationAdapter,
  SpatialQueryAccelerator,
  SimulationScheduler,
  OBSERVABILITY_CONTRACT_NAME,
  OBSERVABILITY_CONTRACT_VERSION,
  ObservabilityProductionViolationError,
  createObservabilityBridge,
  inspectProductionSurface,
  assertProductionSurfaceSafety,
  validateObservabilityContract,
  type ObservabilityBridge,
  type ObservabilitySurface,
  type ProductionObservabilitySurface,
} from "../src/index";
import { Transform } from "../src/state/traits";
import { connectFixture, disposeFixture, type ConnectedFixture } from "./network/helpers";

describe("Observability Bridge & Production Gating Suite (T19 - REQ-OUT-004, REQ-OBS-001..005, REQ-SEC-005)", () => {
  let kernel: GauntletKernel;
  let target: Record<string, unknown>;
  let bridge: ObservabilityBridge;
  let surface: ObservabilitySurface;
  let adapter: RapierPhysicsAdapter;
  let seedHandlerSeeds: number[] = [];
  let scenarioRebuilds = 0;

  const ERROR_BUFFER_SIZE = 8;
  const HERO_SPAWN: [number, number, number] = [3, 0, -2];

  beforeAll(async () => {
    // Exactly one active scheduler per runtime; other suites may have left one.
    SimulationScheduler.resetActiveScheduler();

    kernel = new GauntletKernel({ mode: "local-authoritative" });
    kernel.barrier.register("physics", true);
    kernel.barrier.markBooting("physics");
    kernel.barrier.markReady("physics", 5);

    target = {};
    bridge = createObservabilityBridge({
      mode: "test",
      kernel,
      target,
      errorBufferSize: ERROR_BUFFER_SIZE,
      maxStepTicks: 240,
      renderCapture: { preserveDrawingBuffer: false },
    });
    surface = target[OBSERVABILITY_CONTRACT_NAME] as ObservabilitySurface;

    // Game-owned scenario hook: the bridge invokes it; Koota is rebuilt through
    // the authoritative GameWorld API only.
    bridge.registerScenario("hero-scenario", ({ world }) => {
      scenarioRebuilds++;
      for (const id of world.getEntityIds()) world.despawnEntity(id);
      world.spawnEntity({
        id: "hero",
        transform: { position: HERO_SPAWN },
        tags: ["player"],
      });
    });

    bridge.registerView("chase", {
      name: "chase",
      position: [0, 5, 10],
      target: [0, 0, 0],
      fov: 60,
    });
    bridge.registerView("overhead", () => ({
      name: "overhead",
      position: [0, 50, 0.001],
      target: [0, 0, 0],
    }));

    bridge.setRendererProbe(() => ({
      identity: { renderer: "WebGL2-probe", vendor: "gauntlet-test" },
      capabilities: { maxTextureSize: 4096, webgl2: true },
    }));
    bridge.setRendererStats(() => ({ fps: 60, draw_calls: 42 }));
    bridge.setSeedHandler((seed) => seedHandlerSeeds.push(seed));

    await RapierPhysicsAdapter.initWasm();
    adapter = new RapierPhysicsAdapter();
    adapter.initWorld({ gravity: { x: 0, y: -9.81, z: 0 } });
    bridge.attachPhysics(adapter);

    // Boot the authoritative scenario through the game world directly.
    kernel.gameWorld.spawnEntity({
      id: "hero",
      transform: { position: HERO_SPAWN },
      tags: ["player"],
    });
  });

  afterAll(() => {
    bridge.dispose();
    kernel.dispose();
    SimulationScheduler.resetActiveScheduler();
  });

  // -------------------------------------------------------------------------
  // REQ-OBS-001 / REQ-OBS-002: stable versioned surface
  // -------------------------------------------------------------------------

  it("mounts the explicitly versioned __GAUNTLET_STUDIO_OBS__ v1 contract with stable readiness reads (REQ-OBS-001, REQ-OBS-002)", () => {
    expect(OBSERVABILITY_CONTRACT_NAME).toBe("__GAUNTLET_STUDIO_OBS__");
    expect(OBSERVABILITY_CONTRACT_VERSION).toBe(1);

    const mounted = target[OBSERVABILITY_CONTRACT_NAME] as ObservabilitySurface;
    expect(mounted).toBeDefined();

    expect(mounted.contract.name).toBe("__GAUNTLET_STUDIO_OBS__");
    expect(mounted.contract.version).toBe(1);
    expect(mounted.contract.mode).toBe("test");
    expect(mounted.contract.privileged_control).toBe(true);

    // Deterministic readiness reads (state + per-subsystem states).
    expect(mounted.ready()).toBe(true);
    const readiness = mounted.readiness();
    expect(readiness.state).toBe("ready");
    expect(readiness.subsystem_states["physics"]).toBe("ready");

    const tick = mounted.tick();
    expect(tick.tick).toBe(0);
    expect(tick.fixed_delta_time).toBeCloseTo(1 / 60, 5);
    expect(tick.paused).toBe(true);

    const validation = validateObservabilityContract(mounted, {
      mode: "test",
      expectControl: true,
    });
    expect(validation.ok).toBe(true);
  });

  it("reads semantic state through stable Koota-backed methods, correlated to the authoritative world (REQ-OBS-004)", () => {
    expect(surface.entities.list()).toContain("hero");

    const read = surface.entities.get("hero");
    expect(read.source).toBe("koota");
    expect(read.state).not.toBeNull();
    expect(read.state?.transform?.position).toEqual(HERO_SPAWN);
    expect(read.state?.tags).toEqual(["player"]);

    // Correlation: the surface snapshot is exactly the authoritative snapshot.
    const viaSurface = surface.entities.snapshot();
    const viaAuthority = kernel.gameWorld.takeSemanticSnapshot();
    expect(viaSurface.entities).toEqual(viaAuthority.entities);

    // Unknown id returns a well-formed negative read, never a throw.
    const missing = surface.entities.get("does-not-exist");
    expect(missing).toEqual({ id: "does-not-exist", source: "koota", state: null });

    // Reads are projections: mutating a returned read must not touch Koota.
    read.state!.transform!.position[0] = 99999;
    const reread = surface.entities.get("hero");
    expect(reread.state?.transform?.position[0]).toBe(HERO_SPAWN[0]);
  });

  it("TEETH-T19-001: transient DOM/provider-only access fails the contract — the stable observability method is missing (REQ-OBS-004)", () => {
    // Regression A: a "surface" that only offers DOM-selector access.
    const domOnly = {
      contract: { ...surface.contract, mode: "test" },
      document: {
        querySelector(selector: string) {
          return { selector, found: true };
        },
      },
    };
    const domResult = validateObservabilityContract(domOnly, {
      mode: "test",
      expectControl: true,
    });
    expect(domResult.ok).toBe(false);
    expect(domResult.violations).toContain("missing stable method 'ready()'");
    expect(domResult.violations).toContain("missing stable method 'entities.get()'");

    // Regression B: the real surface with the stable semantic read removed.
    const regressed: Record<string, unknown> = { ...surface };
    regressed.entities = { ...surface.entities };
    delete (regressed.entities as Record<string, unknown>).get;
    const regressedResult = validateObservabilityContract(regressed, {
      mode: "test",
      expectControl: true,
    });
    expect(regressedResult.ok).toBe(false);
    expect(regressedResult.violations).toContain("missing stable method 'entities.get()'");

    // Regression C: a stable method that secretly couples to provider internals
    // and throws must be caught behaviorally, not just structurally.
    const throwing: Record<string, unknown> = { ...surface };
    throwing.entities = {
      ...surface.entities,
      get: () => {
        throw new Error("Cannot read properties of undefined (reading 'object3D')");
      },
    };
    const throwingResult = validateObservabilityContract(throwing, {
      mode: "test",
      expectControl: true,
    });
    expect(throwingResult.ok).toBe(false);
    expect(
      throwingResult.violations.some((v) => v.startsWith("stable method 'entities.get()' threw:"))
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // REQ-OBS-002: deterministic control namespace (privileged, dev/test only)
  // -------------------------------------------------------------------------

  it("provides pause/resume and bounded fixed-step control through the privileged namespace (REQ-OBS-002)", () => {
    const control = surface.control;
    expect(control).toBeDefined();

    // Step bounded fixed ticks: exactly N authoritative ticks.
    control.resume();
    expect(surface.tick().paused).toBe(false);
    control.pause();
    expect(surface.tick().paused).toBe(true);
    const before = surface.tick().tick;
    const stepped = control.step(3);
    expect(stepped).toBe(3);
    expect(surface.tick().tick).toBe(before + 3);

    // Bounded: out-of-range step counts are rejected, never silently clamped.
    expect(() => control.step(0)).toThrow(RangeError);
    expect(() => control.step(-1)).toThrow(RangeError);
    expect(() => control.step(241)).toThrow(RangeError);
    expect(control.maxStepTicks()).toBe(240);
    expect(control.step(240)).toBe(240);
    expect(surface.tick().tick).toBe(before + 243);
    control.resume();
  });

  it("provides seed control with game-owned reseed notification (REQ-OBS-002)", () => {
    expect(surface.control.seed()).toBeNull();
    surface.control.setSeed(1337);
    expect(surface.control.seed()).toBe(1337);
    expect(seedHandlerSeeds).toEqual([1337]);
    expect(() => surface.control.setSeed(Number.NaN)).toThrow(TypeError);
  });

  it("provides controlled scenario reset hooks while Koota stays authoritative (REQ-OBS-002)", () => {
    const control = surface.control;
    expect(control.listScenarios()).toEqual(["hero-scenario"]);

    // Despawn via the authoritative API; the reset hook rebuilds through it.
    expect(kernel.gameWorld.despawnEntity("hero")).toBe(true);
    expect(surface.entities.list()).not.toContain("hero");

    control.resetScenario();
    expect(scenarioRebuilds).toBe(1);
    expect(surface.entities.list()).toContain("hero");
    expect(surface.entities.get("hero").state?.transform?.position).toEqual(HERO_SPAWN);

    // Unknown scenarios are rejected; mutations stay controlled and named.
    expect(() => control.resetScenario("not-registered")).toThrow(/not registered/);
  });

  it("provides named camera/view access (REQ-OBS-002)", () => {
    expect(surface.views.list()).toEqual(["chase", "overhead"]);

    const chase = surface.views.get("chase");
    expect(chase).toEqual({ name: "chase", position: [0, 5, 10], target: [0, 0, 0], fov: 60 });
    expect(surface.views.get("nope")).toBeNull();

    expect(surface.control.setView("overhead")).toBe(true);
    expect(surface.views.current()?.name).toBe("overhead");
    expect(surface.control.setView("nope")).toBe(false);
  });

  it("exposes a bounded error log buffer, renderer probe/stats, and capture-only preserveDrawingBuffer config (REQ-OBS-002)", () => {
    bridge.recordError(new TypeError("probe-failure"), "renderer");
    bridge.recordError("plain string failure");
    const recent = surface.errors.recent();
    expect(recent.length).toBe(2);
    expect(recent[0].message).toBe("TypeError: probe-failure");
    expect(recent[0].context).toBe("renderer");
    expect(recent[1].message).toBe("plain string failure");

    // Ring bound: oldest entries fall off; capacity never grows unbounded.
    for (let i = 0; i < 20; i++) bridge.recordError(`overflow-${i}`);
    const bounded = surface.errors.recent();
    expect(bounded.length).toBe(ERROR_BUFFER_SIZE);
    expect(bounded[bounded.length - 1].message).toBe("overflow-19");

    const probe = surface.renderer.probe();
    expect(probe.present).toBe(true);
    expect(probe.identity).toEqual({ renderer: "WebGL2-probe", vendor: "gauntlet-test" });
    expect(probe.capabilities).toEqual({ maxTextureSize: 4096, webgl2: true });

    const stats = surface.renderer.stats();
    expect(stats.present).toBe(true);
    expect(stats.stats).toEqual({ fps: 60, draw_calls: 42 });

    const capture = surface.renderer.capture();
    expect(capture).toEqual({ preserveDrawingBuffer: false, purpose: "capture-only" });
  });

  // -------------------------------------------------------------------------
  // REQ-OBS-003: physics/navigation inspection when those systems are present
  // -------------------------------------------------------------------------

  it("exposes physics and navigation inspection reads (REQ-OBS-003)", () => {
    const physicsRead = surface.physics.read();
    expect(physicsRead.present).toBe(true);
    expect(physicsRead.last_stepped_tick).toBe(-1); // world initialized, never stepped

    adapter.step(1 / 60, 1, "scheduler");
    expect(surface.physics.read().last_stepped_tick).toBe(1);

    // The main bridge has no navigation/spatial attached: honest negative reads.
    expect(surface.navigation.read()).toEqual({ present: false, reason: "not_registered" });
    expect(surface.spatial.read()).toEqual({ present: false, reason: "not_registered" });

    // An isolated bridge over the SAME kernel proves the unattached shape.
    const isolatedTarget: Record<string, unknown> = {};
    const isolated = createObservabilityBridge({ mode: "test", kernel, target: isolatedTarget });
    const isolatedSurface = isolatedTarget[OBSERVABILITY_CONTRACT_NAME] as ObservabilitySurface;
    expect(isolatedSurface.physics.read()).toEqual({
      present: false,
      reason: "not_registered",
    });

    isolated.attachNavigation(new RecastNavigationAdapter());
    isolated.attachSpatial(new SpatialQueryAccelerator());
    const nav = isolatedSurface.navigation.read();
    expect(nav.present).toBe(true);
    expect(nav.diagnostics?.hasNavMesh).toBe(false);
    expect(nav.diagnostics?.agentCount).toBe(0);
    expect(isolatedSurface.spatial.read().present).toBe(true);
    isolated.dispose();
  });

  // -------------------------------------------------------------------------
  // T12 integration: network diagnostics as read-only surface data
  // -------------------------------------------------------------------------

  it("integrates network readiness/disconnect/latency diagnostics as read-only surface data (REQ-OBS-002, T12 reuse)", async () => {
    let fixture: ConnectedFixture | null = null;
    try {
      fixture = await connectFixture();
      bridge.attachNetwork({
        client: fixture.client,
        server: fixture.server,
        characteristics: fixture.clientTransport.characteristics,
      });

      const net = surface.network.read();
      expect(net.present).toBe(true);
      expect(net.client?.connection_state).toBe("connected");
      expect(net.client?.counters.commands_processed).toBe(0);
      expect(net.transport?.name).toBe("in-memory-loopback");
      expect(net.transport?.reliable).toBe(true);
      expect(net.server?.listening).toBe(true);

      // Explicit disconnect becomes observable through the surface (read-only).
      const rttBefore = surface.network.read().client?.rtt_ms ?? null;
      expect(rttBefore).toBeNull(); // no RTT sample yet: honest null, not a fake zero
      fixture.client.close();
      expect(surface.network.read().client?.connection_state).toBe("closed");

      // Reads never mutate network state: consecutive reads are identical.
      const first = surface.network.read();
      const second = surface.network.read();
      expect(second.client?.counters).toEqual(first.client?.counters);
      expect(second.transport?.name).toBe(first.transport?.name);
    } finally {
      if (fixture) disposeFixture(fixture);
    }
  });

  // -------------------------------------------------------------------------
  // REQ-OUT-004 / REQ-OBS-005 / REQ-SEC-005: production gating (TEETH-T19-002)
  // -------------------------------------------------------------------------

  it("TEETH-T19-002: production mode installs NO privileged mutation hooks and the inspection fails simulated regressions (REQ-OUT-004, REQ-OBS-005, REQ-SEC-005)", () => {
    const prodTarget: Record<string, unknown> = {};
    const prodBridge = createObservabilityBridge({
      mode: "production",
      kernel,
      target: prodTarget,
      renderCapture: { preserveDrawingBuffer: false },
    });
    expect(prodBridge.mode).toBe("production");
    const prodSurface = prodTarget[OBSERVABILITY_CONTRACT_NAME] as ProductionObservabilitySurface;

    // No control namespace exists at all — not null, absent.
    expect("control" in prodSurface).toBe(false);
    expect(prodSurface.contract.mode).toBe("production");
    expect(prodSurface.contract.readonly).toBe(true);
    expect(prodSurface.contract.privileged_control).toBe(false);

    // The mounted property is non-writable/non-configurable: the surface
    // cannot be silently replaced or removed at runtime.
    const descriptor = Object.getOwnPropertyDescriptor(prodTarget, OBSERVABILITY_CONTRACT_NAME);
    expect(descriptor?.writable).toBe(false);
    expect(descriptor?.configurable).toBe(false);

    // Production keeps the production-relevant READS.
    expect(prodSurface.ready()).toBe(true);
    expect(prodSurface.entities.get("hero").state?.transform?.position).toEqual(HERO_SPAWN);

    // Production surface passes both the contract validator and the
    // privileged-mutation inspector.
    const contractOk = validateObservabilityContract(prodSurface, { mode: "production" });
    expect(contractOk.ok).toBe(true);
    const inspection = inspectProductionSurface(prodSurface);
    expect(inspection.ok).toBe(true);
    expect(inspection.methodsInspected).toBeGreaterThan(0);

    // Simulated regression A: the dev/test surface inspected as production
    // MUST fail — its privileged control namespace is a violation.
    const regressionA = inspectProductionSurface(surface);
    expect(regressionA.ok).toBe(false);
    expect(regressionA.violations.some((v) => v.includes("'control' namespace"))).toBe(true);
    expect(regressionA.violations.some((v) => v.includes("'control.pause'"))).toBe(true);
    expect(regressionA.violations.some((v) => v.includes("'control.resetScenario'"))).toBe(true);

    // Simulated regression B: a single injected mutation API MUST fail.
    const injected: Record<string, unknown> = { ...(prodSurface as Record<string, unknown>) };
    injected.pause = () => undefined;
    const regressionB = inspectProductionSurface(injected);
    expect(regressionB.ok).toBe(false);
    expect(regressionB.violations.some((v) => v.includes("'pause'"))).toBe(true);

    // Throwing assertion form behaves identically.
    expect(() => assertProductionSurfaceSafety(prodSurface)).not.toThrow();
    expect(() => assertProductionSurfaceSafety(surface)).toThrow(
      ObservabilityProductionViolationError
    );

    // Production surfaces are permanent: dispose is refused.
    expect(() => prodBridge.dispose()).toThrow(/permanent/);
  });

  it("the observability bridge never becomes a second semantic authority", () => {
    // Scenario/mutation flows leave Koota exactly as authoritative as before:
    // the surface reads and the authoritative world agree bit-for-bit.
    const authority = kernel.gameWorld.takeSemanticSnapshot();
    const projection = surface.entities.snapshot();
    expect(projection.entities).toEqual(authority.entities);

    // Direct gameWorld mutation (the ONLY authority) is what the surface shows.
    kernel.gameWorld.getEntity("hero")?.set(Transform, {
      position: [7, 8, 9],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
    });
    expect(surface.entities.get("hero").state?.transform?.position).toEqual([7, 8, 9]);
    kernel.gameWorld.getEntity("hero")?.set(Transform, {
      position: HERO_SPAWN,
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
    });

    // No provider/DOM objects leak through any surface read.
    expect(() => kernel.gameWorld.assertNoProviderObjectsInState()).not.toThrow();
    expect(JSON.stringify(surface.entities.snapshot()).includes("Object3D")).toBe(false);
  });
});
