/**
 * Blackwater Relay — authoritative simulation systems (T22).
 *
 * The single step pipeline assembled here is the ONLY step owner registered on the
 * runtime scheduler: exactly one Rapier step and one crowd step per authoritative tick
 * (REQ-RUNTIME-006). Every system reads and writes ONLY authoritative Koota state and
 * execution-projection handles; render/audio/VFX projections consume drained semantic
 * events one-way (REQ-GOAL-003, REQ-RUNTIME-001).
 *
 * Semantic progression is expressed exclusively through authoritative transforms:
 *   power cell  — free at its pad, carried (follows rover), delivered at the transceiver
 *   relay gate  — closed at terrain height, raised +4 world units when powered
 *   beacon      — stowed near the tower, mounted at socket-beacon-mount when activated
 */

import * as THREE from "three";
import type { TerrainHeightfield } from "@gauntlet/contracts";
import {
  Transform,
  type GauntletKernel,
  type RapierPhysicsAdapter,
  type RecastNavigationAdapter,
  type SpatialQueryAccelerator,
  sampleCanonicalHeight,
} from "@gauntlet/runtime";
import { GATE_GEOMETRY, LAYOUT, SIMULATION } from "./config";
import { IDS, anchorPosition, type HeightSampler } from "./state";
import { removeBody, type GameBodies } from "./physics";

// ---------------------------------------------------------------------------
// Scenario programs
// ---------------------------------------------------------------------------

export type RoverProgram = "idle" | "active-play" | "cell-delivery" | "beacon-run";

export interface ScenarioProgram {
  rover: RoverProgram;
  cell: "free" | "delivered";
  gate: "closed" | "open";
  obstacle: boolean;
  dronePatrol: boolean;
}

// ---------------------------------------------------------------------------
// Simulation context (authoritative game state + projection handles)
// ---------------------------------------------------------------------------

export type GameEventName =
  | "cell.picked"
  | "cell.delivered"
  | "gate.raising"
  | "beacon.mounting"
  | "patrol.rerouted";

export interface GameEvent {
  name: GameEventName;
  tick: number;
  entity: string;
  position: [number, number, number];
}

/** Obstacle description for patrol reroute checks (projection mesh + physics body). */
export interface PatrolObstacle {
  mesh: THREE.Mesh;
}

export interface GameContext {
  kernel: GauntletKernel;
  physics: RapierPhysicsAdapter;
  navigation: RecastNavigationAdapter;
  spatial: SpatialQueryAccelerator;
  readonly heightfield: TerrainHeightfield;
  readonly sample: HeightSampler;

  /** Currently reset scenario id (camera/HUD presentation reads this). */
  scenarioId: string;

  bodies: GameBodies;
  /** Crowd agent handle for the service drone (navigation projection). */
  droneAgent: unknown | null;

  program: ScenarioProgram;

  // Rover drive state
  driveTarget: { x: number; z: number } | null;

  // Interaction state (internal controller state; semantics remain transform-encoded)
  attach: "none" | "carried" | "delivered";
  gatePhase: "closed" | "raising" | "open";
  gateRaiseStartTick: number;
  gateClosedY: number;
  gateOpenY: number;
  beaconPhase: "stowed" | "mounting" | "mounted";
  beaconMountStartTick: number;
  beaconStowed: [number, number, number];
  beaconMount: [number, number, number];

  // Patrol state
  patrolQueue: Array<{ x: number; y: number; z: number }>;
  patrolRerouted: boolean;
  /** Key of the waypoint the crowd agent was last sent toward (goto de-duplication). */
  patrolLastGotoKey: string | null;

  /** Obstacle meshes used for BVH corridor verification (patrol scenario). */
  obstacleMeshes: THREE.Mesh[];

  /** Semantic transition events drained by projection consumers each tick. */
  events: GameEvent[];

  /**
   * TEETH-T22-003 fixture: when true, the gate's authoritative transition is corrupted —
   * gateSystem raises the RENDER projection only (browser wiring), Koota stays closed.
   */
  fixtureCorruptGate: boolean;
}

// ---------------------------------------------------------------------------
// Context lifecycle
// ---------------------------------------------------------------------------

export function gateClosedY(sample: HeightSampler): number {
  const p = anchorPosition(LAYOUT.relay_gate, sample);
  return p[1];
}

export function gateOpenY(sample: HeightSampler): number {
  const p = anchorPosition(LAYOUT.relay_gate, sample);
  return p[1] + 4.0;
}

export function beaconAnchors(sample: HeightSampler): { stowed: [number, number, number]; mount: [number, number, number] } {
  return {
    stowed: anchorPosition(LAYOUT.beacon_stowed, sample),
    mount: anchorPosition(LAYOUT.beacon_mount, sample),
  };
}

export function createGameContext(deps: {
  kernel: GameContext["kernel"];
  physics: GameContext["physics"];
  navigation: GameContext["navigation"];
  spatial: GameContext["spatial"];
  heightfield: TerrainHeightfield;
  fixtureCorruptGate?: boolean;
}): GameContext {
  const sample = (x: number, z: number) => sampleCanonicalHeight(deps.heightfield, x, z);
  const anchors = beaconAnchors(sample);
  return {
    kernel: deps.kernel,
    physics: deps.physics,
    navigation: deps.navigation,
    spatial: deps.spatial,
    heightfield: deps.heightfield,
    sample,
    scenarioId: "boot",
    bodies: { rover: null, gate: null, obstacle: null },
    droneAgent: null,
    program: { rover: "idle", cell: "free", gate: "closed", obstacle: false, dronePatrol: false },
    driveTarget: null,
    attach: "none",
    gatePhase: "closed",
    gateRaiseStartTick: -1,
    gateClosedY: gateClosedY(sample),
    gateOpenY: gateOpenY(sample),
    beaconPhase: "stowed",
    beaconMountStartTick: -1,
    beaconStowed: anchors.stowed,
    beaconMount: anchors.mount,
    patrolQueue: [],
    patrolRerouted: false,
    patrolLastGotoKey: null,
    obstacleMeshes: [],
    events: [],
    fixtureCorruptGate: deps.fixtureCorruptGate ?? false,
  };
}

// ---------------------------------------------------------------------------
// Entity read/write helpers (Koota only)
// ---------------------------------------------------------------------------

function positionOf(ctx: GameContext, id: string): [number, number, number] | null {
  const entity = ctx.kernel.gameWorld.getEntity(id);
  if (!entity) return null;
  const t = entity.get(Transform);
  return t ? [t.position[0], t.position[1], t.position[2]] : null;
}

function setPosition(ctx: GameContext, id: string, position: [number, number, number], yaw = 0): void {
  const entity = ctx.kernel.gameWorld.getEntity(id);
  if (!entity) return;
  entity.set(Transform, {
    position: [position[0], position[1], position[2]],
    rotation: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
    scale: [1, 1, 1],
  });
}

function dist2D(a: [number, number, number], b: { x: number; z: number }): number {
  const dx = a[0] - b.x;
  const dz = a[2] - b.z;
  return Math.hypot(dx, dz);
}

function pushEvent(ctx: GameContext, name: GameEventName, entity: string, position: [number, number, number]): void {
  ctx.events.push({ name, tick: ctx.kernel.scheduler.getTick(), entity, position: [...position] as [number, number, number] });
}

// ---------------------------------------------------------------------------
// Rover drive system (writes physics body velocities; reads program + Koota)
// ---------------------------------------------------------------------------

export function roverDriveSystem(ctx: GameContext, tick: number): void {
  const body = ctx.bodies.rover;
  if (!body) return;

  // Resolve the drive target from the scenario program phase machine.
  if (ctx.program.rover === "cell-delivery") {
    if (ctx.attach === "none") ctx.driveTarget = { x: LAYOUT.power_cell.x, z: LAYOUT.power_cell.z };
    else if (ctx.attach === "carried") ctx.driveTarget = { x: LAYOUT.cell_delivery.x, z: LAYOUT.cell_delivery.z };
    else ctx.driveTarget = { x: LAYOUT.gate_pass_target.x, z: LAYOUT.gate_pass_target.z };
  } else if (ctx.program.rover === "active-play") {
    ctx.driveTarget = { x: LAYOUT.active_play_target.x, z: LAYOUT.active_play_target.z };
  } else if (ctx.program.rover === "beacon-run") {
    ctx.driveTarget = { x: LAYOUT.relay_tower.x, z: LAYOUT.relay_tower.z - 2 };
  } else {
    ctx.driveTarget = null;
  }

  const pos = positionOf(ctx, IDS.rover);
  const target = ctx.driveTarget;
  if (!pos || !target) {
    const v = body.linvel();
    body.setLinvel({ x: 0, y: v.y, z: 0 }, true);
    return;
  }

  const dx = target.x - pos[0];
  const dz = target.z - pos[2];
  const distance = Math.hypot(dx, dz);
  if (distance <= 1.2) {
    const v = body.linvel();
    body.setLinvel({ x: 0, y: v.y, z: 0 }, true);
    return;
  }

  const speed = SIMULATION.rover_speed;
  const v = body.linvel();
  body.setLinvel({ x: (dx / distance) * speed, y: v.y, z: (dz / distance) * speed }, true);
  void tick;
}

/** Reads the stepped rover body pose back into the authoritative Koota transform. */
export function syncRoverToKoota(ctx: GameContext): void {
  const body = ctx.bodies.rover;
  const entity = ctx.kernel.gameWorld.getEntity(IDS.rover);
  if (!body || !entity) return;
  const p = body.translation();
  const v = body.linvel();
  const yaw = Math.hypot(v.x, v.z) > 0.3 ? Math.atan2(v.x, v.z) : 0;
  entity.set(Transform, {
    position: [p.x, p.y, p.z],
    rotation: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
    scale: [1, 1, 1],
  });
}

// ---------------------------------------------------------------------------
// Interaction system (power cell pickup / delivery / beacon activation)
// ---------------------------------------------------------------------------

export function interactionSystem(ctx: GameContext, tick: number): void {
  const rover = positionOf(ctx, IDS.rover);
  if (!rover) return;

  // -- Power cell pickup and delivery -------------------------------------
  const cell = positionOf(ctx, IDS.cell);
  if (cell && ctx.attach === "none") {
    if (dist2D(cell, { x: rover[0], z: rover[2] }) < SIMULATION.pickup_radius) {
      ctx.attach = "carried";
      pushEvent(ctx, "cell.picked", IDS.cell, cell);
    }
  }
  if (cell && ctx.attach === "carried") {
    const carried: [number, number, number] = [rover[0], rover[1] + 1.5, rover[2]];
    setPosition(ctx, IDS.cell, carried);
    const delivery = anchorPosition(LAYOUT.cell_delivery, ctx.sample);
    if (dist2D(rover, { x: delivery[0], z: delivery[2] }) < SIMULATION.delivery_radius) {
      ctx.attach = "delivered";
      setPosition(ctx, IDS.cell, delivery);
      pushEvent(ctx, "cell.delivered", IDS.cell, delivery);
      if (ctx.program.gate === "closed") {
        ctx.gatePhase = "raising";
        ctx.gateRaiseStartTick = tick;
        pushEvent(ctx, "gate.raising", IDS.gate, [delivery[0], ctx.gateClosedY, delivery[2]]);
      }
    }
  }

  // -- Beacon activation at the relay tower --------------------------------
  if (ctx.beaconPhase === "stowed" && ctx.gatePhase === "open" && ctx.attach === "delivered") {
    const tower = { x: LAYOUT.relay_tower.x, z: LAYOUT.relay_tower.z };
    if (dist2D(rover, tower) < SIMULATION.beacon_radius) {
      ctx.beaconPhase = "mounting";
      ctx.beaconMountStartTick = tick;
      pushEvent(ctx, "beacon.mounting", IDS.beacon, ctx.beaconStowed);
    }
  }
}

// ---------------------------------------------------------------------------
// Relay gate system (authoritative raise animation)
// ---------------------------------------------------------------------------

export function gateSystem(ctx: GameContext, tick: number): void {
  if (ctx.gatePhase !== "raising") return;
  const elapsed = tick - ctx.gateRaiseStartTick;
  const t = Math.min(1, Math.max(0, elapsed / SIMULATION.gate_raise_ticks));
  const y = ctx.gateClosedY + (ctx.gateOpenY - ctx.gateClosedY) * t;

  // TEETH-T22-003 fixture: the authoritative transition is corrupted. The Koota
  // transform and kinematic body stay CLOSED; only the browser render wiring animates
  // the gate projection directly (pixels lie; semantic evidence catches it).
  if (!ctx.fixtureCorruptGate) {
    setPosition(ctx, IDS.gate, [LAYOUT.relay_gate.x, y, LAYOUT.relay_gate.z]);
    const body = ctx.bodies.gate;
    if (body) {
      body.setNextKinematicTranslation({ x: LAYOUT.relay_gate.x, y, z: LAYOUT.relay_gate.z });
    }
  }
  if (t >= 1) {
    ctx.gatePhase = "open";
  }
}

// ---------------------------------------------------------------------------
// Beacon system (authoritative mount animation to socket-beacon-mount)
// ---------------------------------------------------------------------------

export function beaconSystem(ctx: GameContext, tick: number): void {
  if (ctx.beaconPhase !== "mounting") return;
  const elapsed = tick - ctx.beaconMountStartTick;
  const t = Math.min(1, Math.max(0, elapsed / SIMULATION.beacon_mount_ticks));
  const position: [number, number, number] = [
    ctx.beaconStowed[0] + (ctx.beaconMount[0] - ctx.beaconStowed[0]) * t,
    ctx.beaconStowed[1] + (ctx.beaconMount[1] - ctx.beaconStowed[1]) * t,
    ctx.beaconStowed[2] + (ctx.beaconMount[2] - ctx.beaconStowed[2]) * t,
  ];
  setPosition(ctx, IDS.beacon, position);
  if (t >= 1) {
    ctx.beaconPhase = "mounted";
  }
}

// ---------------------------------------------------------------------------
// Service drone patrol system (Recast navmesh + BVH corridor verification)
// ---------------------------------------------------------------------------

function verifyPatrolCorridor(
  ctx: GameContext,
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number }
): boolean {
  if (ctx.obstacleMeshes.length === 0) return true;
  const path = ctx.navigation.computePath(from, to);
  if (!path.success || path.path.length < 2) return true; // no corridor to invalidate
  const verification = ctx.navigation.verifyPathAgainstObstacles(path.path, ctx.spatial, ctx.obstacleMeshes);
  return verification.valid;
}

export function patrolSystem(ctx: GameContext, tick: number): void {
  if (!ctx.program.dronePatrol) return;
  const agent = ctx.droneAgent as {
    position(): { x: number; y: number; z: number };
    requestMoveTarget(t: { x: number; y: number; z: number }): boolean;
    requestMoveVelocity(v: { x: number; y: number; z: number }): boolean;
  } | null;
  if (!agent) return;

  // (Re)plan the patrol route when the queue is empty.
  if (ctx.patrolQueue.length === 0) {
    const drone = positionOf(ctx, IDS.drone);
    const start = drone ? { x: drone[0], y: drone[1], z: drone[2] } : {
      x: LAYOUT.drone_patrol_a.x,
      y: ctx.sample(LAYOUT.drone_patrol_a.x, LAYOUT.drone_patrol_a.z) + SIMULATION.drone_hover_height,
      z: LAYOUT.drone_patrol_a.z,
    };
    const b = {
      x: LAYOUT.drone_patrol_b.x,
      y: ctx.sample(LAYOUT.drone_patrol_b.x, LAYOUT.drone_patrol_b.z) + SIMULATION.drone_hover_height,
      z: LAYOUT.drone_patrol_b.z,
    };
    const queue: Array<{ x: number; y: number; z: number }> = [start];
    if (ctx.obstacleMeshes.length > 0 && !verifyPatrolCorridor(ctx, start, b)) {
      // Deterministic detour around the blocking obstacle.
      const detour = {
        x: LAYOUT.drone_detour.x,
        y: ctx.sample(LAYOUT.drone_detour.x, LAYOUT.drone_detour.z) + SIMULATION.drone_hover_height,
        z: LAYOUT.drone_detour.z,
      };
      queue.push(detour);
      if (!ctx.patrolRerouted) {
        ctx.patrolRerouted = true;
        pushEvent(ctx, "patrol.rerouted", IDS.drone, [detour.x, detour.y, detour.z]);
      }
    }
    queue.push(b);
    ctx.patrolQueue = queue;
  }

  const drone = positionOf(ctx, IDS.drone);
  if (!drone) return;

  const target = ctx.patrolQueue[0];
  const finalTarget = ctx.patrolQueue[ctx.patrolQueue.length - 1];
  const distFinal = Math.hypot(drone[0] - finalTarget.x, drone[2] - finalTarget.z);

  // Terminal leg: proportional velocity control converges to the final waypoint
  // (recast crowd agents orbit a move target forever without an arrive-stop, so
  // the controller owns the deterministic terminal approach and hold). The
  // threshold engages the controller for the whole final verified corridor leg.
  if (distFinal < 10.0) {
    if (distFinal < 0.4) {
      agent.requestMoveVelocity({ x: 0, y: 0, z: 0 });
    } else {
      const scale = Math.min(SIMULATION.drone_speed, distFinal * 3.0) / distFinal;
      agent.requestMoveVelocity({
        x: (finalTarget.x - drone[0]) * scale,
        y: 0,
        z: (finalTarget.z - drone[2]) * scale,
      });
    }
    void tick;
    return;
  }

  const targetKey = `${target.x.toFixed(3)},${target.z.toFixed(3)}`;
  const arrived = Math.hypot(drone[0] - target.x, drone[2] - target.z) < 0.8;

  if (arrived && ctx.patrolQueue.length > 1) {
    ctx.patrolQueue.shift();
    ctx.patrolLastGotoKey = null;
    return;
  }
  if (ctx.patrolLastGotoKey !== targetKey) {
    agent.requestMoveTarget(target);
    ctx.patrolLastGotoKey = targetKey;
  }
  void tick;
}

/** Reads the stepped crowd agent pose back into the authoritative Koota transform. */
export function syncDroneToKoota(ctx: GameContext): void {
  const agent = ctx.droneAgent as { position(): { x: number; y: number; z: number } } | null;
  const entity = ctx.kernel.gameWorld.getEntity(IDS.drone);
  if (!agent || !entity) return;
  const p = agent.position();
  entity.set(Transform, {
    position: [p.x, p.y + SIMULATION.drone_hover_height, p.z],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
  });
}

// ---------------------------------------------------------------------------
// The single authoritative step pipeline (the ONLY scheduler step owner)
// ---------------------------------------------------------------------------

export function stepGame(ctx: GameContext, tickInfo: { tick: number; dt: number }): void {
  const tick = tickInfo.tick;

  roverDriveSystem(ctx, tick);
  // Exactly one Rapier step per authoritative tick (REQ-RUNTIME-006).
  ctx.physics.step(tickInfo.dt, tick, "blackwater-relay-step-owner");
  syncRoverToKoota(ctx);

  interactionSystem(ctx, tick);
  gateSystem(ctx, tick);
  beaconSystem(ctx, tick);

  if (ctx.program.dronePatrol) {
    patrolSystem(ctx, tick);
    ctx.navigation.stepCrowd(tickInfo.dt);
    syncDroneToKoota(ctx);
  }
}
