/**
 * Blackwater Relay — authoritative semantic entities (T22).
 *
 * All gameplay state lives in the runtime GameWorld (Koota). Stable entity ids correlate
 * semantic entities with their render/physics/navigation projections (REQ-RUNTIME-002).
 * Semantic progression is expressed through authoritative transforms + tags ONLY — never
 * through render, physics, or navigation objects (REQ-RUNTIME-001).
 */

import type { SpawnEntityOptions } from "@gauntlet/runtime";
import { GATE_GEOMETRY, LAYOUT, OBSTACLE_GEOMETRY } from "./config";

export const IDS = {
  rover: "bw-rover",
  gate: "bw-relay-gate",
  cell: "bw-power-cell",
  transceiver: "bw-field-transceiver",
  drone: "bw-service-drone",
  beacon: "bw-beacon",
  obstacle: "bw-patrol-obstacle",
} as const;

/** All semantic entity ids this game can spawn (scenario hooks rebuild this set). */
export const ALL_ENTITY_IDS: string[] = Object.values(IDS);

/** Anchor: XZ position plus the canonical-height offset applied at spawn time. */
export interface Anchor {
  x: number;
  z: number;
  y_offset: number;
}

/** Resolve (x, y, z) from an anchor through the canonical height sampler. */
export type HeightSampler = (x: number, z: number) => number;

export function anchorPosition(anchor: Anchor, sample: HeightSampler): [number, number, number] {
  return [anchor.x, sample(anchor.x, anchor.z) + anchor.y_offset, anchor.z];
}

function base(id: string, position: [number, number, number], tags: SpawnEntityOptions["tags"]) {
  return {
    id,
    transform: { position },
    tags,
  } as const;
}

export function roverSpawnOptions(sample: HeightSampler): SpawnEntityOptions {
  return {
    ...base(IDS.rover, anchorPosition(LAYOUT.rover_spawn, sample), ["player", "vehicle"]),
    velocity: { linear: [0, 0, 0], angular: [0, 0, 0] },
    renderHandle: { handleId: "render-rover" },
    physicsHandle: { handleId: "physics-rover", bodyType: "dynamic", mass: 220 },
  };
}

export function gateSpawnOptions(sample: HeightSampler, closedY: number): SpawnEntityOptions {
  const [x, , z] = anchorPosition(LAYOUT.relay_gate, sample);
  return {
    id: IDS.gate,
    transform: { position: [x, closedY, z] },
    tags: ["obstacle"],
    renderHandle: { handleId: "render-gate" },
    physicsHandle: { handleId: "physics-gate", bodyType: "kinematicPositionBased" },
  };
}

export function cellSpawnOptions(sample: HeightSampler): SpawnEntityOptions {
  return {
    ...base(IDS.cell, anchorPosition(LAYOUT.power_cell, sample), ["item"]),
    renderHandle: { handleId: "render-cell" },
    assetBinding: { assetId: "bw-power-cell" },
  };
}

export function transceiverSpawnOptions(sample: HeightSampler): SpawnEntityOptions {
  return {
    ...base(IDS.transceiver, anchorPosition(LAYOUT.transceiver, sample), ["item"]),
    renderHandle: { handleId: "render-transceiver" },
    assetBinding: { assetId: "field-transceiver" },
  };
}

export function droneSpawnOptions(sample: HeightSampler): SpawnEntityOptions {
  const a = LAYOUT.drone_patrol_a;
  const y = sample(a.x, a.z) + 2.0;
  return {
    id: IDS.drone,
    transform: { position: [a.x, y, a.z] },
    tags: ["enemy"],
    renderHandle: { handleId: "render-drone" },
    navHandle: { handleId: "nav-drone", radius: 0.6, height: 2.0, speed: 12.0 },
    assetBinding: { assetId: "service-drone" },
  };
}

export function beaconSpawnOptions(sample: HeightSampler): SpawnEntityOptions {
  return {
    ...base(IDS.beacon, anchorPosition(LAYOUT.beacon_stowed, sample), ["item"]),
    renderHandle: { handleId: "render-beacon" },
  };
}

export function obstacleSpawnOptions(sample: HeightSampler): SpawnEntityOptions {
  return {
    ...base(IDS.obstacle, anchorPosition(LAYOUT.patrol_obstacle, sample), ["obstacle"]),
    renderHandle: { handleId: "render-obstacle" },
    physicsHandle: { handleId: "physics-obstacle", bodyType: "fixed" },
  };
}

/** Gate collider half-extents (re-exported for the physics projection module). */
export const GATE_HALF_EXTENTS = GATE_GEOMETRY.half_extents;
export const OBSTACLE_HALF_EXTENTS = OBSTACLE_GEOMETRY.half_extents;
