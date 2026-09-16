/**
 * Blackwater Relay — accepted world-environment composition (T15, REQ-BIND-005).
 *
 * This module is the committed runtime projection of the accepted
 * `world.environment.compose` AgentHandoff (.studio/results/world.yaml), authored by the
 * coding agent exercising the pinned 3dviz-pro-max skill content with zero model
 * invocations.
 *
 * Authority boundary (AGENTS.md §5/§6):
 * - Terrain elevation authority stays with the canonical TerrainHeightfield (world.terrain).
 *   This module NEVER stores elevation data; every ground/socket height is resolved at
 *   runtime through an injected canonical height sampler.
 * - Navigation authority stays with runtime Recast (world.navigation); navmesh data is
 *   derived downstream from the canonical terrain plus these collider specs — never shipped
 *   here.
 * - Specific depicted objects are never reconstructed through composition; every kit
 *   references a settled record in assets/manifest.json.
 */

export interface WorldTerrainReference {
  generator: string;
  seed: number;
  rows: number;
  columns: number;
  size_x: number;
  size_z: number;
}

export interface WorldKitPlacement {
  kit_id: string;
  asset_id: string;
  role: string;
  position: {
    x: number;
    z: number;
    terrain_socked: true;
    offset_y: number;
  };
  rotation_y: number;
  scale: number;
}

export interface WorldSocketBinding {
  socket_id: string;
  attaches_to: string;
  terrain_socked: true;
  height_source: "canonical_heightfield";
  offset_y: number;
}

export interface WorldColliderSpec {
  collider_id: string;
  attached_to: string;
  shape: "box" | "cylinder" | "mesh-exact";
  blocks_navigation: boolean;
}

export interface WorldScatterLayer {
  layer_id: string;
  asset_id: string;
  placement: "terrain-projected";
  placement_seed: number;
  max_instances: number;
}

export interface WorldLightingAtmosphere {
  preset: string;
  asset_ids: string[];
}

/** Injected canonical heightfield sampler (see packages/runtime terrain authority). */
export type CanonicalHeightSampler = (worldX: number, worldZ: number) => number;

export interface ResolvedWorldTransform {
  id: string;
  asset_id: string;
  position: { x: number; y: number; z: number };
  rotation_y: number;
  scale: number;
}

/** Canonical terrain this composition integrates WITH (referenced, never replaced). */
export const WORLD_TERRAIN_REFERENCE: WorldTerrainReference = {
  generator: "sinusoidal-octaves",
  seed: 20260915,
  rows: 129,
  columns: 129,
  size_x: 512,
  size_z: 512,
};

export const WORLD_COMPOSITION_ID = "bw-relay-env-001";

/** Composed world kits: architecture and structures, XZ intent only (heights resolved at runtime). */
export const WORLD_KITS: WorldKitPlacement[] = [
  {
    kit_id: "kit-place-relay-tower",
    asset_id: "kit-relay-tower",
    role: "relay_tower",
    position: { x: 8, z: -12, terrain_socked: true, offset_y: 0 },
    rotation_y: 0,
    scale: 1,
  },
  {
    kit_id: "kit-place-dock-planks",
    asset_id: "kit-dock-planks",
    role: "dock",
    position: { x: 176, z: 0, terrain_socked: true, offset_y: 0.4 },
    rotation_y: 0,
    scale: 1,
  },
  {
    kit_id: "kit-place-maintainer-hut",
    asset_id: "kit-maintainer-hut",
    role: "maintainer_hut",
    position: { x: -36, z: 24, terrain_socked: true, offset_y: 0 },
    rotation_y: 0.6,
    scale: 1,
  },
];

/** Sockets resolve strictly from the canonical heightfield (never composition-owned elevation). */
export const WORLD_SOCKETS: WorldSocketBinding[] = [
  {
    socket_id: "socket-beacon-mount",
    attaches_to: "kit-place-relay-tower",
    terrain_socked: true,
    height_source: "canonical_heightfield",
    offset_y: 14,
  },
  {
    socket_id: "socket-dock-lantern",
    attaches_to: "kit-place-dock-planks",
    terrain_socked: true,
    height_source: "canonical_heightfield",
    offset_y: 1.2,
  },
  {
    socket_id: "socket-hut-antenna",
    attaches_to: "kit-place-maintainer-hut",
    terrain_socked: true,
    height_source: "canonical_heightfield",
    offset_y: 3.2,
  },
];

/** Collider intent consumed by physics/navigation projections downstream (never a physics authority). */
export const WORLD_COLLIDERS: WorldColliderSpec[] = [
  {
    collider_id: "collider-relay-tower",
    attached_to: "kit-place-relay-tower",
    shape: "cylinder",
    blocks_navigation: true,
  },
  {
    collider_id: "collider-maintainer-hut",
    attached_to: "kit-place-maintainer-hut",
    shape: "box",
    blocks_navigation: true,
  },
  {
    collider_id: "collider-dock-planks",
    attached_to: "kit-place-dock-planks",
    shape: "box",
    blocks_navigation: false,
  },
];

/** Deterministic vegetation scatter (seeded, instance-bounded, terrain-projected). */
export const WORLD_SCATTER: WorldScatterLayer[] = [
  {
    layer_id: "scatter-scrub-north-shore",
    asset_id: "veg-shoreline-scrub",
    placement: "terrain-projected",
    placement_seed: 20260916,
    max_instances: 350,
  },
  {
    layer_id: "scatter-scrub-south-shore",
    asset_id: "veg-shoreline-scrub",
    placement: "terrain-projected",
    placement_seed: 20260917,
    max_instances: 250,
  },
];

/** Storm-dusk lighting/atmosphere execution projections (never authoritative game state). */
export const WORLD_LIGHTING_ATMOSPHERE: WorldLightingAtmosphere = {
  preset: "storm-dusk",
  asset_ids: ["skybox-storm-dusk"],
};

/**
 * Resolves kit anchor transforms by sampling the injected canonical heightfield.
 * Composition intent supplies XZ placement; the canonical terrain owns Y.
 */
export function resolveWorldKitAnchors(sampler: CanonicalHeightSampler): ResolvedWorldTransform[] {
  return WORLD_KITS.map((kit) => ({
    id: kit.kit_id,
    asset_id: kit.asset_id,
    position: {
      x: kit.position.x,
      y: sampler(kit.position.x, kit.position.z) + kit.position.offset_y,
      z: kit.position.z,
    },
    rotation_y: kit.rotation_y,
    scale: kit.scale,
  }));
}

/**
 * Resolves socket transforms by sampling the injected canonical heightfield.
 * height_source is always "canonical_heightfield" — sockets never carry absolute heights.
 */
export function resolveWorldSocketTransforms(sampler: CanonicalHeightSampler): ResolvedWorldTransform[] {
  const kitById = new Map(WORLD_KITS.map((k) => [k.kit_id, k]));
  return WORLD_SOCKETS.map((socket) => {
    const kit = kitById.get(socket.attaches_to);
    if (!kit) {
      throw new Error(`Socket '${socket.socket_id}' attaches to unknown kit '${socket.attaches_to}'`);
    }
    return {
      id: socket.socket_id,
      asset_id: kit.asset_id,
      position: {
        x: kit.position.x,
        y: sampler(kit.position.x, kit.position.z) + socket.offset_y,
        z: kit.position.z,
      },
      rotation_y: kit.rotation_y,
      scale: 1,
    };
  });
}

/** Composition summary for diagnostics/telemetry (no elevation data). */
export function describeWorldComposition(): {
  composition_id: string;
  capability: string;
  skill_id: string;
  terrain_reference: WorldTerrainReference;
  counts: { kits: number; sockets: number; colliders: number; scatter_layers: number };
  lighting_preset: string;
} {
  return {
    composition_id: WORLD_COMPOSITION_ID,
    capability: "world.environment.compose",
    skill_id: "3dviz",
    terrain_reference: WORLD_TERRAIN_REFERENCE,
    counts: {
      kits: WORLD_KITS.length,
      sockets: WORLD_SOCKETS.length,
      colliders: WORLD_COLLIDERS.length,
      scatter_layers: WORLD_SCATTER.length,
    },
    lighting_preset: WORLD_LIGHTING_ATMOSPHERE.preset,
  };
}
