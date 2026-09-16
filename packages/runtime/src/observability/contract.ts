/**
 * Observability contract v1 for Gauntlet Runtime.
 * Implements REQ-OBS-001..005, REQ-OUT-004, REQ-SEC-005.
 *
 * Stable, explicitly versioned surface mounted by the runtime on its browser
 * global target as `window.__GAUNTLET_STUDIO_OBS__` (the explicitly-versioned
 * equivalent of `window.__GAME_STUDIO__` per REQ-OBS-001). Every surface
 * declares `{ name: "__GAUNTLET_STUDIO_OBS__", version: 1, mode }`.
 *
 * Invariants:
 * - Settlement-critical consumers (Playwright, Gauntlet) read ONLY through the
 *   stable methods of this surface; never through transient DOM selectors or
 *   provider-internal object names (REQ-OBS-004).
 * - Koota (GameWorld) remains the sole semantic authority; this surface is a
 *   read/projection and controlled-invocation layer, never a second authority.
 * - All controlled scenario mutations live under the single privileged
 *   `control` namespace. Production mode NEVER installs it (REQ-OUT-004,
 *   REQ-OBS-005, REQ-SEC-005).
 */

/** Stable contract name mounted on the runtime global target. */
export const OBSERVABILITY_CONTRACT_NAME = "__GAUNTLET_STUDIO_OBS__";

/** Monotonic contract version; breaking changes increment it. */
export const OBSERVABILITY_CONTRACT_VERSION = 1;

export type ObservabilityMode = "development" | "test" | "production";

export interface ObservabilityContractHeader {
  name: typeof OBSERVABILITY_CONTRACT_NAME;
  version: number;
  mode: ObservabilityMode;
  /** True when the surface carries no privileged mutation namespace. */
  readonly: boolean;
  /** True when the privileged `control` namespace is installed. */
  privileged_control: boolean;
}

// ---------------------------------------------------------------------------
// Read models (production-relevant, always safe to expose)
// ---------------------------------------------------------------------------

/** Semantic entity read correlated directly against Koota (never DOM). */
export interface ObservabilityEntityRead {
  id: string;
  /** Provenance marker: this read came from the Koota authoritative world. */
  source: "koota";
  state: import("../state/traits").SerializedEntityState | null;
}

export interface ObservabilityErrorEntry {
  at: string;
  message: string;
  context?: string;
}

export interface ObservabilityRendererProbe {
  present: boolean;
  reason?: string;
  identity?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
}

export interface ObservabilityRendererStats {
  present: boolean;
  reason?: string;
  stats?: Record<string, number>;
}

export interface ObservabilityRenderCaptureConfig {
  /** Capture-only preserveDrawingBuffer configuration; never enabled by default. */
  preserveDrawingBuffer: boolean;
  purpose: "capture-only";
}

export interface ObservabilityPhysicsRead {
  present: boolean;
  reason?: string;
  last_stepped_tick?: number;
}

export interface ObservabilityNavigationRead {
  present: boolean;
  reason?: string;
  diagnostics?: import("../navigation/recast").NavigationDiagnostics;
}

export interface ObservabilitySpatialRead {
  present: boolean;
  reason?: string;
  diagnostics?: import("../spatial/bvh").SpatialDiagnostics;
}

export interface ObservabilityNetworkRead {
  present: boolean;
  reason?: string;
  client?: import("../network/diagnostics").NetworkClientDiagnostics;
  server?: import("../network/diagnostics").NetworkServerDiagnostics;
  /** Material transport characteristics (REQ-BIND-013), wiring-provided. */
  transport?: import("../network/types").TransportCharacteristics;
}

export interface ObservabilityCameraView {
  name: string;
  position: [number, number, number];
  target: [number, number, number];
  fov?: number;
}

export interface ObservabilityTickRead {
  tick: number;
  time: number;
  running: boolean;
  paused: boolean;
  fixed_delta_time: number;
  alpha: number;
}

// ---------------------------------------------------------------------------
// Privileged control namespace (development/test ONLY; never production)
// ---------------------------------------------------------------------------

export interface ObservabilityControlNamespace {
  pause(): void;
  resume(): void;
  isPaused(): boolean;
  /** Bounded fixed-step: advances exactly `ticks` authoritative ticks (1..max). */
  step(ticks?: number): number;
  maxStepTicks(): number;
  /** Sets the scenario seed and notifies the game-owned reseed handler. */
  setSeed(seed: number): void;
  seed(): number | null;
  /** Selects the current named camera/view. */
  setView(name: string): boolean;
  listScenarios(): string[];
  /** Invokes the game-owned scenario hook to rebuild state (default if unnamed). */
  resetScenario(name?: string): void;
  clearErrors(): void;
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

/**
 * Full development/test surface: reads + privileged `control` namespace.
 */
export interface ObservabilitySurface {
  contract: ObservabilityContractHeader;
  ready(): boolean;
  readiness(): import("@gauntlet/contracts").RuntimeReadiness;
  tick(): ObservabilityTickRead;
  entities: {
    list(): string[];
    get(id: string): ObservabilityEntityRead;
    snapshot(): import("../state/traits").SemanticStateSnapshot;
  };
  errors: {
    recent(): ObservabilityErrorEntry[];
  };
  renderer: {
    probe(): ObservabilityRendererProbe;
    stats(): ObservabilityRendererStats;
    capture(): ObservabilityRenderCaptureConfig;
  };
  physics: { read(): ObservabilityPhysicsRead };
  navigation: { read(): ObservabilityNavigationRead };
  spatial: { read(): ObservabilitySpatialRead };
  network: { read(): ObservabilityNetworkRead };
  views: {
    list(): string[];
    get(name: string): ObservabilityCameraView | null;
    current(): ObservabilityCameraView | null;
  };
  /** PRIVILEGED scenario mutation namespace — absent in production. */
  control: ObservabilityControlNamespace;
}

/**
 * Production surface: reads only. No `control` key exists at all, and no
 * method mutates semantic or simulation state (REQ-OUT-004, REQ-OBS-005,
 * REQ-SEC-005).
 */
export interface ProductionObservabilitySurface {
  contract: ObservabilityContractHeader;
  ready(): boolean;
  readiness(): import("@gauntlet/contracts").RuntimeReadiness;
  tick(): ObservabilityTickRead;
  entities: {
    list(): string[];
    get(id: string): ObservabilityEntityRead;
    snapshot(): import("../state/traits").SemanticStateSnapshot;
  };
  errors: {
    recent(): ObservabilityErrorEntry[];
  };
  renderer: {
    probe(): ObservabilityRendererProbe;
    stats(): ObservabilityRendererStats;
    capture(): ObservabilityRenderCaptureConfig;
  };
  physics: { read(): ObservabilityPhysicsRead };
  navigation: { read(): ObservabilityNavigationRead };
  spatial: { read(): ObservabilitySpatialRead };
  network: { read(): ObservabilityNetworkRead };
  views: {
    list(): string[];
    get(name: string): ObservabilityCameraView | null;
    current(): ObservabilityCameraView | null;
  };
}
