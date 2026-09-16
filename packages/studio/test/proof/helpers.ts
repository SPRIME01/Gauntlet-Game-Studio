/**
 * Shared builders for the T20 proof-harness test suite (deterministic, browser-free).
 */

import type {
  EvidenceManifestDraft,
  ObservationRunDraft,
  ObservationEnvironment,
} from "@gauntlet/adapters";

export const REVISION_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const REVISION_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
export const FIXED_TS = "2026-09-15T12:00:00Z";

export function environment(overrides: Partial<ObservationEnvironment> = {}): ObservationEnvironment {
  return {
    browser: "chrome",
    browser_version: "test",
    headless: true,
    viewport: { width: 640, height: 360 },
    platform: "linux",
    quality_profile: "proof",
    executable_path: "/usr/bin/google-chrome",
    autoplay_bypass_flags: false,
    ...overrides,
  };
}

export function runDraft(opts: {
  id: string;
  revision: string;
  scenarioId?: string;
  channels?: Array<string | Record<string, unknown>>;
}): ObservationRunDraft {
  return {
    id: opts.id,
    project_revision: opts.revision,
    scenario_id: opts.scenarioId ?? "fixture-ok",
    environment: environment(),
    channels: opts.channels ?? [
      { channel: "state", source: "koota" },
      { channel: "pixels", captures: [] },
      { channel: "telemetry", console: [], page_errors: [], tick_after_steps: 3 },
      { channel: "network", responses: [], surface_read: { present: false } },
    ],
    seed: 1337,
    camera_views: ["main"],
    timestamp: FIXED_TS,
  };
}

export function manifestDraft(opts: {
  id: string;
  runId: string;
  revision: string;
  result?: "pass" | "fail" | "blocked" | "incomplete";
  artifactPaths: Array<{ path: string; sha256: string; size: number }>;
  requirementIds?: string[];
}): EvidenceManifestDraft {
  return {
    id: opts.id,
    run_id: opts.runId,
    project_revision: opts.revision,
    requirement_ids: opts.requirementIds ?? ["REQ-OUT-003", "REQ-GOAL-004"],
    artifacts: opts.artifactPaths.map((a, i) => ({
      id: `artifact-${i + 1}`,
      path: a.path,
      sha256: a.sha256,
      role: "state-snapshot",
      size_bytes: a.size,
    })),
    result: opts.result ?? "pass",
    created_at: FIXED_TS,
  };
}
