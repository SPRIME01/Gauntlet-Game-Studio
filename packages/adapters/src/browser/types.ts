/**
 * Browser proof harness types (T20, REQ-BIND-010, REQ-GOAL-004, REQ-OUT-003).
 *
 * The harness is the deterministic Playwright proof binding for settlement-critical
 * browser verification. It drives scenarios ONLY through the stable T19 observability
 * contract methods (`__GAUNTLET_STUDIO_OBS__` v1) — never through transient DOM
 * selectors or provider-internal object names (REQ-OBS-004). agent-browser remains
 * exploratory/debugging-only and has no settlement role.
 *
 * Channel separation is structural: the harness OBSERVES state, pixels, telemetry,
 * and network evidence. It never judges frozen expectations — interpretation and
 * settlement live in @gauntlet/studio (evidence + gauntlet modules). Provider or
 * build success is never an input to any result produced here.
 */

import type { SemanticStateSnapshot } from "@gauntlet/runtime";

/** A named scenario to observe. Either a served `url` or inline deterministic `html`. */
export interface ScenarioDefinition {
  /** Lower-case scenario identifier (normalized identifier rule). */
  id: string;
  /** Absolute URL of an already-served game page. Takes precedence over `html`. */
  url?: string;
  /** Self-contained HTML of a deterministic fixture page served over loopback. */
  html?: string;
  /** Deterministic seed applied through the privileged control namespace. */
  seed?: number;
  /** Bounded fixed-steps to advance (via `control.step`) before capture. Default 3. */
  steps?: number;
  /** Named camera/view to select (via `control.setView`) before capture. Default "main". */
  view?: string;
  /** Viewport for the proof context. Default 640x360 (headless-safe). */
  viewport?: { width: number; height: number };
}

/** Environment identity recorded with every run (REQ-BIND-010). */
export interface ObservationEnvironment {
  browser: string;
  browser_version: string;
  headless: boolean;
  viewport: { width: number; height: number };
  platform: string;
  quality_profile: string;
  executable_path: string;
  /** Explicit invariant: no autoplay-policy bypass flags are ever used. */
  autoplay_bypass_flags: false;
  renderer_identity?: Record<string, unknown>;
}

/** Semantic state channel evidence, read via the stable surface only. */
export interface StateChannelEvidence {
  channel: "state";
  /** Provenance marker: read through the Koota-backed stable method. */
  source: "koota";
  snapshot: SemanticStateSnapshot;
  tick: Record<string, unknown>;
  /** Stable observability method paths used for this read (audit trail). */
  read_via: string[];
}

export interface PixelCapture {
  view: string;
  /** Artifact path relative to the run directory. */
  artifact: string;
  sha256: string;
  width: number;
  height: number;
  bytes: number;
}

/** Pixels channel evidence: fresh rendered captures from named views. */
export interface PixelsChannelEvidence {
  channel: "pixels";
  captures: PixelCapture[];
}

export interface ConsoleEntry {
  type: string;
  text: string;
}

/** Telemetry channel evidence: console/page diagnostics plus tick consequence. */
export interface TelemetryChannelEvidence {
  channel: "telemetry";
  console: ConsoleEntry[];
  page_errors: string[];
  tick_after_steps: number;
}

/** Network channel evidence (where applicable): observed responses + surface read. */
export interface NetworkChannelEvidence {
  channel: "network";
  responses: Array<{ url: string; status: number; ok: boolean }>;
  surface_read: Record<string, unknown>;
}

/** Renderer evidence class derived from the stable probe identity (REQ-PERF-003). */
export type RendererEvidenceClass = "hardware" | "software" | "unknown";

/** Frame-time distribution with declared percentiles (ms). */
export interface FrameTimeDistribution {
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  /** Number of finite samples the distribution was computed from. */
  samples: number;
}

/** Captured performance metrics (observation only; evaluation is studio-owned). */
export interface PerformanceMetrics {
  fps_avg?: number;
  frame_time_ms?: FrameTimeDistribution;
  draw_calls?: number;
  triangles?: number;
  textures?: number;
  resources?: number;
  readiness_ms?: number;
  console_errors?: number;
}

/**
 * Performance channel evidence (T21, REQ-VERIFY-003): metrics captured through the
 * stable T19 `renderer.stats()`/`renderer.probe()` seams, bound to the named quality
 * profile the capture was taken under. `present:false` records an unmeasurable
 * surface honestly — it can never evaluate as a pass.
 */
export interface PerformanceChannelEvidence {
  channel: "performance";
  quality_profile: string;
  present: boolean;
  reason?: string;
  metrics: PerformanceMetrics;
  /** Metrics the reporter failed to declare (average-only reporters, etc.). */
  unreported: string[];
  renderer_class: RendererEvidenceClass;
  /** Stable observability method paths used for this read (audit trail). */
  read_via: string[];
}

export type ChannelEvidence =
  | StateChannelEvidence
  | PixelsChannelEvidence
  | TelemetryChannelEvidence
  | NetworkChannelEvidence
  | PerformanceChannelEvidence
  | { channel: "none"; reason: string };

/** Draft ObservationRun (consumed/validated by the studio evidence store). */
export interface ObservationRunDraft {
  id: string;
  project_revision: string;
  scenario_id: string;
  environment: ObservationEnvironment;
  channels: Array<string | Record<string, unknown>>;
  seed?: number;
  camera_views?: string[];
  timestamp: string;
}

/** Hashed artifact record (ArtifactRef-compatible). */
export interface ArtifactRecord {
  id: string;
  path: string;
  sha256: string;
  role: string;
  size_bytes: number;
  mime_type?: string;
}

/** Draft EvidenceManifest (consumed/validated by the studio evidence store). */
export interface EvidenceManifestDraft {
  id: string;
  run_id: string;
  project_revision: string;
  requirement_ids: string[];
  artifacts: ArtifactRecord[];
  result: "pass" | "fail" | "blocked" | "incomplete";
  contradictions?: string[];
  created_at: string;
}

/**
 * Observation sink: receives captures for one run. The studio evidence store
 * implements the canonical sink (schema-enforced, immutable, artifacts/runs/<id>).
 * The harness default sink writes a plain run directory for standalone use.
 */
export interface ObservationSink {
  begin(run: ObservationRunDraft): void;
  writeArtifact(name: string, bytes: Uint8Array | string, role: string): ArtifactRecord;
  complete(manifest: EvidenceManifestDraft): void;
}

export type BrowserBlockageCode =
  | "PLAYWRIGHT_UNAVAILABLE"
  | "CHROME_UNAVAILABLE"
  | "SURFACE_CONTRACT_INVALID"
  | "SCENARIO_ERROR";

/** Typed scoped blockage: required browser proof could not run (RECOV-004). */
export interface RunBlockage {
  code: BrowserBlockageCode;
  message: string;
}

export interface ScenarioRunResult {
  status: "observed" | "blocked";
  blockage?: RunBlockage;
  run?: ObservationRunDraft;
  manifest?: EvidenceManifestDraft;
  channels: ChannelEvidence[];
  run_dir?: string;
}

/** Loader seam so Playwright unavailability can be simulated deterministically (TEETH-T20-003). */
export type PlaywrightLoader = () => Promise<typeof import("playwright")>;

export const DEFAULT_CHROME_PATH = "/usr/bin/google-chrome";
