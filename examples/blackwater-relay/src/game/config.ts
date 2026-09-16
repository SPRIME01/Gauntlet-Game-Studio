/**
 * Blackwater Relay — frozen game configuration (T22).
 *
 * These constants are the gameplay projection of the frozen named-scenario contract in
 * .agents/specs/game.spec.yaml (frozen BEFORE implementation/evidence). Coordinates are
 * world XZ positions; every world Y is resolved at runtime from the canonical
 * TerrainHeightfield sampler — never stored here (REQ-TERRAIN-001/002).
 *
 * Networking is DISABLED (REQ-RUNTIME-009): `network.enabled` is false and the
 * single-player build contains no transport construction path at all. The flag exists
 * only so the declaration is inspectable configuration, not dead code.
 */

export const GAME_TITLE = "Blackwater Relay";

/** Canonical terrain contract — MUST match the committed 3dviz composition reference. */
export const TERRAIN = {
  generator: "sinusoidal-octaves",
  seed: 20260915,
  rows: 129,
  columns: 129,
  size_x: 512,
  size_z: 512,
  /** Coarser nav cells than the runtime default: 512m island at walkable fidelity.
   * walkableClimb 2 keeps the terraced heightfield voxels connected across the
   * 4m terrain grid slope steps (climb 0.5 fragments the navmesh into islands). */
  nav_cell_size: 1.0,
  nav_cell_height: 1.0,
  nav_agent_radius: 0.6,
  nav_walkable_climb: 2.0,
} as const;

/** Fixed authoritative simulation policy (REQ-RUNTIME-007). */
export const SIMULATION = {
  fixed_delta_time: 1 / 60,
  max_sub_steps: 5,
  /** Rover cruise speed (world units / second) under drive throttle. */
  rover_speed: 6.5,
  /** Service-drone crowd speed. Navmesh corridors run longer than straight lines,
   * so the patrol budget assumes mesh-following distance, not Euclidean. */
  drone_speed: 12.0,
  /** Hover altitude of the drone above the navmesh surface. */
  drone_hover_height: 2.0,
  /** Distance at which the rover attaches to the power cell. */
  pickup_radius: 2.0,
  /** Distance at which a carried cell is delivered to the transceiver. */
  delivery_radius: 2.5,
  /** Distance at which the rover may activate the beacon at the tower. */
  beacon_radius: 4.0,
  /** Gate raise animation duration in authoritative ticks. */
  gate_raise_ticks: 30,
  /** Beacon mount animation duration in authoritative ticks. */
  beacon_mount_ticks: 24,
} as const;

/** Scenario layout anchors (XZ only; Y always canonical-sampled). */
export const LAYOUT = {
  rover_spawn: { x: 0, z: 0, y_offset: 0.5 },
  power_cell: { x: 4, z: 2, y_offset: 0.75 },
  transceiver: { x: 10, z: 4, y_offset: 0 },
  cell_delivery: { x: 10, z: 4, y_offset: 1.6 },
  relay_gate: { x: 14, z: 4, y_offset: 2.0 },
  gate_pass_target: { x: 16.5, z: 4 },
  relay_tower: { x: 8, z: -12, y_offset: 0 },
  beacon_stowed: { x: 8, z: -9.5, y_offset: 1.0 },
  beacon_mount: { x: 8, z: -12, y_offset: 14.0 },
  drone_patrol_a: { x: -7, z: -3 },
  drone_patrol_b: { x: 7, z: -3 },
  drone_detour: { x: 0, z: 3.5 },
  patrol_obstacle: { x: 0, z: -3, y_offset: 1.3 },
  active_play_target: { x: 12, z: 0 },
} as const;

/** Relay gate collider geometry (half-extents; gate plane spans Z across the path). */
export const GATE_GEOMETRY = {
  half_extents: [0.6, 2.0, 3.0] as [number, number, number],
} as const;

/** Patrol obstacle collider geometry (half-extents). */
export const OBSTACLE_GEOMETRY = {
  half_extents: [1.2, 1.3, 1.2] as [number, number, number],
} as const;

/**
 * Single-player declaration (game.spec.yaml `single_player`). The single-player build
 * contains no code path that constructs a multiplayer server, transport, or client; the
 * flag is declaration surface for teeth TEETH-T22-001, which proves the suite is
 * functional with networking disabled (it always is, in this game).
 */
export const NETWORK = {
  enabled: false,
  declaration: "single-player-only",
} as const;

/**
 * T23 OPTIONAL multiplayer mode constants (game.spec.yaml `multiplayer`, frozen BEFORE
 * implementation/evidence). Consumed ONLY by the dedicated network entries
 * (src/server.ts, src/net/*) — never by the single-player build path.
 */
export const MULTIPLAYER = {
  relevance_radius: 40,
  player_spawn: [0, 0, 0] as [number, number, number],
  /** Acting-client command speed (== the protocol clamp). */
  acting_move_speed: 50,
  /** Observer-client command speed. */
  observer_move_speed: 6,
  /** Latency impairment applied by the net client to the acting transport
   *  (multiplayer-latency only; see src/net/net-page.ts). */
  latency_fixed_ms: 40,
  latency_jitter_ms: 40,
  latency_loss: 0,
  /** Server->client liveness ping cadence (RTT measurement; REQ-NET-006). */
  ping_interval_ms: 500,
  /** Explicit client timeout (REQ-NET-009). */
  client_timeout_ms: 8000,
} as const;

/** Observability surface mode for this build (dev/test carry the privileged control). */
export function observabilityMode(): "development" | "test" | "production" {
  if (typeof window === "undefined") return "test";
  const requested = new URLSearchParams(window.location.search).get("obsMode");
  if (requested === "production" || requested === "test" || requested === "development") {
    return requested;
  }
  return "development";
}

/**
 * Semantic fixture switch for TEETH-T22-003 ONLY. When set to "corrupt-gate", the gate's
 * RENDER projection animates open while the authoritative Koota gate transform stays
 * closed — the exact "visible animation preserved, semantic transition corrupted"
 * variant the falsification check requires. Never set in normal builds.
 */
export function semanticFixtureVariant(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("bwSemanticFixture");
}
