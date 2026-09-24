import type { CapabilityResult } from "@gauntlet/contracts";

/**
 * T15 (REQ-BIND-005): types for the `world.environment.compose` agent-skill handoff
 * (pinned 3dviz-pro-max skill content) and its deterministic result verification.
 *
 * Authority boundary (AGENTS.md §5/§6): 3dviz/agent output is never authority over
 * terrain, navigation, or the runtime. Composition output normalizes into placement,
 * socket, collider, and scatter metadata that integrate WITH the canonical
 * TerrainHeightfield (world.terrain) and runtime Recast navigation (world.navigation).
 */

export const WORLD_ENVIRONMENT_COMPOSE_CAPABILITY = "world.environment.compose";
export const THREEVIZ_SKILL_ID = "3dviz";
export const THREEVIZ_PROVIDER = "agent-skill.3dviz";
export const WORLD_COMPOSITION_RESULT_SCHEMA = "gauntlet.world.composition.result";
export const THREEVIZ_SKILL_ENTRYPOINT_REF = "vendor/skills/3dviz-pro-max/SKILL.md";

/** The only accepted terrain stance for a composition output: reference, never supply. */
export type TerrainAuthorityRef = {
  mode: "canonical_heightfield_reference";
  capability: "world.terrain";
  generator: string;
  seed: number;
  rows: number;
  columns: number;
  size_x: number;
  size_z: number;
};

/** Navigation is always derived downstream by the navigation capability from accepted geometry. */
export type NavigationDerivationRef = {
  mode: "runtime_derived";
  capability: "world.navigation";
  source: string;
};

/** One composed world kit placement. XZ intent only; height resolves from the canonical sampler. */
export interface WorldKitPlacement {
  kit_id: string;
  asset_id: string;
  role: string;
  position: {
    x: number;
    z: number;
    terrain_socked: boolean;
    offset_y: number;
  };
  rotation_y: number;
  scale: number;
}

/** A named attach point that resolves against the canonical heightfield at runtime. */
export interface SocketBinding {
  socket_id: string;
  attaches_to: string;
  terrain_socked: boolean;
  height_source: "canonical_heightfield";
  offset_y: number;
}

/** Collider intent consumed by physics/navigation projections; never a physics authority itself. */
export interface ColliderSpec {
  collider_id: string;
  attached_to: string;
  shape: "box" | "cylinder" | "mesh-exact";
  blocks_navigation: boolean;
}

/** Deterministic scatter layer metadata (seeded, bounded). */
export interface ScatterLayer {
  layer_id: string;
  asset_id: string;
  placement: "terrain-projected";
  placement_seed: number;
  max_instances: number;
}

/** Lighting/atmosphere execution-projection spec; never authoritative game state. */
export interface LightingAtmosphereSpec {
  preset: string;
  asset_ids: string[];
}

/** Normalized runtime/project form of an accepted world-composition handoff output. */
export interface NormalizedWorldComposition {
  composition_id: string;
  capability: typeof WORLD_ENVIRONMENT_COMPOSE_CAPABILITY;
  skill_id: typeof THREEVIZ_SKILL_ID;
  terrain_authority: TerrainAuthorityRef;
  navigation_derivation: NavigationDerivationRef;
  kits: WorldKitPlacement[];
  sockets: SocketBinding[];
  colliders: ColliderSpec[];
  scatter: ScatterLayer[];
  lighting_atmosphere: LightingAtmosphereSpec;
}

/** Raw 3dviz agent output as authored by the coding agent exercising the pinned skill content. */
export interface WorldCompositionAgentOutput {
  composition_id: string;
  requested_route?: string;
  output_kind?: string;
  terrain_authority: TerrainAuthorityRef;
  navigation_derivation?: NavigationDerivationRef;
  kits: Array<Partial<WorldKitPlacement>>;
  sockets?: Array<Partial<SocketBinding>>;
  colliders?: Array<Partial<ColliderSpec>>;
  scatter?: Array<Partial<ScatterLayer>>;
  lighting_atmosphere?: Partial<LightingAtmosphereSpec>;
}

/** AgentHandoff lifecycle record committed alongside the accepted output. */
export interface WorldCompositionHandoffRecord {
  request_id: string;
  skill_id: string;
  instructions_ref: string;
  expected_outputs: string[];
  acceptance: string[];
}

/**
 * Committed accepted-result file (.studio/results/world.yaml): the full handoff
 * lifecycle (request -> routed handoff -> accepted output -> CapabilityResult)
 * in one deterministic, model-credential-free record.
 */
export interface WorldCompositionResultDocument {
  schema: string;
  schema_version: string;
  capability: string;
  request_ref: string;
  handoff: WorldCompositionHandoffRecord;
  accepted_output: {
    authored_by: string;
    composed_with: {
      terrain: string;
      navigation: string;
    };
    composition: NormalizedWorldComposition;
  };
  result: CapabilityResult;
}

export interface WorldVerificationCheck {
  code: string;
  pass: boolean;
  detail: string;
}

export interface WorldVerificationReport {
  valid: boolean;
  capability: string;
  checks: WorldVerificationCheck[];
  summary: {
    passed: number;
    failed: number;
  };
}

export interface VerifyWorldCompositionOptions {
  /**
   * Project root used to resolve the Asset Registry manifest (assets/manifest.json).
   * Defaults to three directory levels above the result file (<root>/.studio/results/<file>).
   */
  projectRoot?: string;
  /** Studio repository root used to resolve the pinned vendor-skill instructions. */
  repoRoot?: string;
}
