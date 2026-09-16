/**
 * Blackwater Relay — game core assembly (T22).
 *
 * Composes the first-party runtime capabilities into one playable consequence:
 * canonical terrain (world.terrain), Rapier physics (world.physics), Recast navigation
 * + crowd (world.navigation), BVH spatial queries (world.spatial), Koota authoritative
 * state, the six frozen named scenarios, and the versioned observability surface.
 *
 * This module is headless-safe: importing and running it requires NO DOM, NO WebGL, and
 * NO AudioContext (REQ-AUDIO-002). Browser-only projections (renderer, HUD, Tone audio,
 * Quarks VFX, drone GLB animation) attach in the browser boot module.
 *
 * Authority boundaries (redesign_trigger guards):
 * - Koota is the sole semantic authority; every system reads/writes Koota only.
 * - Terrain derives ONLY from the canonical heightfield; render/physics/nav projections
 *   are derived from it (REQ-TERRAIN-002), never the reverse.
 * - Networking is never constructed (single_player declaration, REQ-RUNTIME-009): the
 *   "network" subsystem is intentionally absent from the readiness barrier.
 */

import * as THREE from "three";
import type { RuntimeReadiness, TerrainHeightfield } from "@gauntlet/contracts";
import {
  GauntletKernel,
  NullAudioBackend,
  RapierPhysicsAdapter,
  RecastNavigationAdapter,
  SpatialQueryAccelerator,
  Transform,
  createObservabilityBridge,
  createTerrainNavigationGeometry,
  generateProceduralHeightfield,
  registerAudioSubsystem,
  sampleCanonicalHeight,
  type ObservabilityBridge,
} from "@gauntlet/runtime";
import { LAYOUT, SIMULATION, TERRAIN } from "./config";
import {
  ALL_ENTITY_IDS,
  IDS,
  anchorPosition,
  beaconSpawnOptions,
  cellSpawnOptions,
  droneSpawnOptions,
  gateSpawnOptions,
  obstacleSpawnOptions,
  roverSpawnOptions,
  transceiverSpawnOptions,
} from "./state";
import { createGateBody, createObstacleBody, createRoverBody, removeBody } from "./physics";
import {
  createGameContext,
  gateClosedY,
  gateOpenY,
  stepGame,
  type GameContext,
  type ScenarioProgram,
} from "./systems";

export const SCENARIO_IDS = [
  "boot",
  "active-play",
  "transceiver-interaction",
  "patrol-obstacle",
  "beacon-activation",
  "performance-flythrough",
] as const;

export type ScenarioId = (typeof SCENARIO_IDS)[number];

export const DEFAULT_SCENARIO: ScenarioId = "boot";

/** Per-scenario authoritative initial program (frozen in game.spec.yaml). */
export const SCENARIO_PROGRAMS: Record<ScenarioId, ScenarioProgram> = {
  boot: { rover: "idle", cell: "free", gate: "closed", obstacle: false, dronePatrol: true },
  "active-play": { rover: "active-play", cell: "free", gate: "closed", obstacle: false, dronePatrol: true },
  "transceiver-interaction": { rover: "cell-delivery", cell: "free", gate: "closed", obstacle: false, dronePatrol: true },
  "patrol-obstacle": { rover: "idle", cell: "free", gate: "closed", obstacle: true, dronePatrol: true },
  "beacon-activation": { rover: "beacon-run", cell: "delivered", gate: "open", obstacle: false, dronePatrol: true },
  "performance-flythrough": { rover: "idle", cell: "free", gate: "closed", obstacle: false, dronePatrol: true },
};

/** Mutable camera pose shared with the observability view provider (browser updates it). */
export interface ViewState {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

export interface GameCore {
  kernel: GauntletKernel;
  context: GameContext;
  bridge: ObservabilityBridge;
  /** The mounted surface, typed as the full dev/test surface (control present). */
  surface: import("@gauntlet/runtime").ObservabilitySurface;
  audioBackend: NullAudioBackend;
  viewState: ViewState;
  readiness: () => RuntimeReadiness;
  resetScenario: (name: string) => void;
  dispose: () => void;
}

export interface BootGameCoreOptions {
  mode: "development" | "test" | "production";
  /** Isolated mount target for the observability surface (tests); default globalThis. */
  target?: Record<string, unknown>;
  /** TEETH-T22-003 fixture: corrupt the gate's semantic transition. */
  fixtureCorruptGate?: boolean;
}

function buildObstacleMesh(center: [number, number, number]): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(2.4, 2.6, 2.4);
  const material = new THREE.MeshStandardMaterial({ color: 0x8a5a3c, roughness: 0.9 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "bw-patrol-obstacle";
  mesh.position.set(center[0], center[1], center[2]);
  return mesh;
}

/**
 * Boots the game core: readiness barrier over terrain/physics/navigation/spatial,
 * Koota world, the single step owner, the scenario registry, and the observability
 * surface. Resolves when every required subsystem is ready (REQ-RUNTIME-005).
 */
export async function bootGameCore(options: BootGameCoreOptions): Promise<GameCore> {
  const kernel = new GauntletKernel({
    mode: "local-authoritative",
    schedulerOptions: { fixedDeltaTime: SIMULATION.fixed_delta_time, maxSubSteps: SIMULATION.max_sub_steps },
  });
  const barrier = kernel.barrier;
  const sample = (x: number, z: number): number => sampleCanonicalHeight(heightfield, x, z);

  // Register the full required subsystem set BEFORE any readiness progress: the
  // barrier settles the moment every required subsystem is ready, so late
  // registration would throw after settlement. The "network" subsystem is
  // deliberately absent — single-player declaration (REQ-RUNTIME-009).
  barrier.register("terrain", true);
  barrier.register("physics", true);
  barrier.register("navigation", true);
  barrier.register("spatial", true);
  // Headless-safe audio (Null backend); the browser boot swaps in the Tone backend.
  const audioBackend = new NullAudioBackend();
  registerAudioSubsystem(barrier, audioBackend, { required: false });

  // ---- Canonical terrain (world.terrain authority) -------------------------
  barrier.markBooting("terrain");
  const heightfield: TerrainHeightfield = generateProceduralHeightfield({
    rows: TERRAIN.rows,
    columns: TERRAIN.columns,
    size_x: TERRAIN.size_x,
    size_z: TERRAIN.size_z,
    seed: TERRAIN.seed,
  });
  barrier.markReady("terrain");

  // ---- Rapier physics projection (world.physics) ---------------------------
  barrier.markBooting("physics");
  await RapierPhysicsAdapter.initWasm();
  const physics = new RapierPhysicsAdapter();
  physics.initWorld({ gravity: { x: 0, y: -9.81, z: 0 } });
  physics.createTerrainCollider(heightfield);
  barrier.markReady("physics");

  // ---- Recast navigation projection (world.navigation) ---------------------
  await RecastNavigationAdapter.bootSubsystem(barrier);
  const navigation = new RecastNavigationAdapter();
  const navGeometry = createTerrainNavigationGeometry(heightfield);
  const navOk = navigation.buildNavMeshFromTerrain(navGeometry, {
    cs: TERRAIN.nav_cell_size,
    ch: TERRAIN.nav_cell_height,
    walkableRadius: TERRAIN.nav_agent_radius,
    walkableClimb: TERRAIN.nav_walkable_climb,
  });
  if (!navOk) {
    throw new Error("Blackwater Relay: Recast navmesh failed to build from the canonical terrain");
  }
  navigation.initCrowd(16, TERRAIN.nav_agent_radius);

  // ---- BVH spatial acceleration (world.spatial) ----------------------------
  barrier.markBooting("spatial");
  const spatial = new SpatialQueryAccelerator();
  barrier.markReady("spatial");

  // NOTE: the "network" subsystem is deliberately never registered — single-player
  // declaration (game.spec.yaml single_player); REQ-RUNTIME-009.

  // ---- Game context + the single step owner --------------------------------
  const context = createGameContext({
    kernel,
    physics,
    navigation,
    spatial,
    heightfield,
    fixtureCorruptGate: options.fixtureCorruptGate ?? false,
  });
  kernel.scheduler.registerStepHandler((tickInfo) => stepGame(context, tickInfo));

  // ---- Observability surface (versioned __GAUNTLET_STUDIO_OBS__ v1) --------
  const viewState: ViewState = {
    position: [0, sample(0, 0) + 24, 40],
    target: [0, sample(0, 0), 0],
    fov: 60,
  };
  const bridge = createObservabilityBridge({
    mode: options.mode,
    kernel,
    ...(options.target ? { target: options.target } : {}),
    maxStepTicks: 240,
    // Capture-only configuration stays false: Playwright captures the composited
    // frame, and preserveDrawingBuffer would force per-frame readbacks that stall
    // the GL driver and spam console warnings in software rendering.
    renderCapture: { preserveDrawingBuffer: false },
  });
  bridge.attachPhysics(physics);
  bridge.attachNavigation(navigation);
  bridge.attachSpatial(spatial);

  // ---- Scenario registry (the frozen named scenarios) ----------------------
  function resetScenario(name: string): void {
    const program = SCENARIO_PROGRAMS[name as ScenarioId];
    if (!program) {
      throw new Error(`Unknown Blackwater Relay scenario '${name}'; declared: ${SCENARIO_IDS.join(", ")}`);
    }
    context.events.length = 0;

    // Tear down all semantic entities, bodies, and the crowd agent.
    for (const id of ALL_ENTITY_IDS) {
      context.kernel.gameWorld.despawnEntity(id);
    }
    removeBody(physics, context.bodies.rover);
    removeBody(physics, context.bodies.gate);
    removeBody(physics, context.bodies.obstacle);
    context.bodies = { rover: null, gate: null, obstacle: null };
    if (context.droneAgent) {
      navigation.removeAgentForEntity(IDS.drone);
      context.droneAgent = null;
    }

    // Reset authoritative controller state.
    context.scenarioId = name;
    context.program = { ...program };
    context.attach = program.cell === "delivered" ? "delivered" : "none";
    context.gatePhase = program.gate;
    context.gateRaiseStartTick = -1;
    context.beaconPhase = "stowed";
    context.beaconMountStartTick = -1;
    context.patrolQueue = [];
    context.patrolRerouted = false;
    context.patrolLastGotoKey = null;
    context.driveTarget = null;
    context.obstacleMeshes = [];

    // Spawn the semantic entity set (the same six everywhere; obstacle is additive).
    context.kernel.gameWorld.spawnEntity(roverSpawnOptions(context.sample));
    const closedY = gateClosedY(context.sample);
    const openY = gateOpenY(context.sample);
    context.kernel.gameWorld.spawnEntity(
      gateSpawnOptions(context.sample, program.gate === "open" ? openY : closedY)
    );
    context.kernel.gameWorld.spawnEntity(cellSpawnOptions(context.sample));
    context.kernel.gameWorld.spawnEntity(transceiverSpawnOptions(context.sample));
    context.kernel.gameWorld.spawnEntity(droneSpawnOptions(context.sample));
    context.kernel.gameWorld.spawnEntity(beaconSpawnOptions(context.sample));
    if (program.obstacle) {
      context.kernel.gameWorld.spawnEntity(obstacleSpawnOptions(context.sample));
    }

    if (program.cell === "delivered") {
      // Precondition state: the cell already rests at the transceiver delivery anchor.
      const delivery = anchorPosition(LAYOUT.cell_delivery, context.sample);
      const cellEntity = context.kernel.gameWorld.getEntity(IDS.cell);
      cellEntity?.set(Transform, {
        position: delivery,
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
      });
    }

    // Physics projections.
    context.bodies.rover = createRoverBody(physics, anchorPosition(LAYOUT.rover_spawn, context.sample));
    context.bodies.gate = createGateBody(physics, [
      LAYOUT.relay_gate.x,
      program.gate === "open" ? openY : closedY,
      LAYOUT.relay_gate.z,
    ]);

    // Patrol obstacle (scenario-additive): physics body + BVH verification mesh.
    if (program.obstacle) {
      const center = anchorPosition(LAYOUT.patrol_obstacle, context.sample);
      context.bodies.obstacle = createObstacleBody(physics, center);
      const mesh = buildObstacleMesh(center);
      // The BVH/raycast path reads matrixWorld: bake the authored placement now
      // (the mesh is a verification projection, never added to a live scene).
      spatial.buildBVH(mesh.geometry);
      mesh.updateMatrixWorld(true);
      context.obstacleMeshes.push(mesh);
    }

    // Navigation crowd agent for the service drone (patrol projection).
    const a = LAYOUT.drone_patrol_a;
    context.droneAgent = navigation.addAgentForEntity(
      IDS.drone,
      { x: a.x, y: context.sample(a.x, a.z), z: a.z },
      { maxSpeed: SIMULATION.drone_speed, maxAcceleration: 30 }
    );
  }

  for (const id of SCENARIO_IDS) {
    bridge.registerScenario(id, () => resetScenario(id), { default: id === DEFAULT_SCENARIO });
  }
  bridge.registerView("main", () => ({
    name: "main",
    position: [...viewState.position] as [number, number, number],
    target: [...viewState.target] as [number, number, number],
    fov: viewState.fov,
  }));

  // Deterministic initial state once every required subsystem is registered.
  resetScenario(DEFAULT_SCENARIO);

  return {
    kernel,
    context,
    bridge,
    surface: bridge.surface as import("@gauntlet/runtime").ObservabilitySurface,
    audioBackend,
    viewState,
    readiness: () => barrier.getReadiness(),
    resetScenario,
    dispose: () => {
      navigation.dispose();
      kernel.dispose();
    },
  };
}
