/**
 * Channel check evaluation for Gauntlet verification (T20, REQ-GAUNTLET-003).
 *
 * "Verification MUST select the observation channels required by the claim: semantic
 * state for game truth, pixels for visible consequence, telemetry for runtime
 * consequence." Each channel is evaluated independently and honestly; verdicts are
 * combined by the settlement bridge — a passing channel NEVER masks a failing one.
 */

import type { FrozenExpectation, SemanticEntityExpectation } from "./expectation";
import type {
  ChannelEvidence,
  NetworkChannelEvidence,
  PerformanceChannelEvidence,
  PixelsChannelEvidence,
  StateChannelEvidence,
  TelemetryChannelEvidence,
} from "@gauntlet/adapters";
import { evaluatePerformanceEvidence, type AssetBudgetSummary } from "../quality/evaluate";
import type { ResolvedQualityProfile } from "../quality/profiles";

export interface CheckResult {
  code: string;
  pass: boolean;
  detail: string;
}

export interface ChannelVerdict {
  channel: "state" | "pixels" | "telemetry" | "network" | "performance";
  evaluated: boolean;
  pass: boolean;
  checks: CheckResult[];
}

/** Optional resolution inputs for channels that require studio-side oracles. */
export interface ChannelCheckOptions {
  /** Resolved game-project quality profile for performance claims (T21). */
  performance?: {
    profile: ResolvedQualityProfile;
    asset_summary?: AssetBudgetSummary | null;
  } | null;
}

type EntitySnapshot = {
  id: string;
  transform?: { position?: [number, number, number] };
  tags?: string[];
};

function snapshotEntities(snapshot: unknown): EntitySnapshot[] {
  if (snapshot && typeof snapshot === "object" && Array.isArray((snapshot as { entities?: unknown }).entities)) {
    return (snapshot as { entities: EntitySnapshot[] }).entities;
  }
  return [];
}

/** Semantic state checks — authoritative game truth, never inferred from pixels. */
export function checkStateChannel(
  expectation: FrozenExpectation,
  evidence: StateChannelEvidence
): ChannelVerdict {
  const checks: CheckResult[] = [];
  const entities = snapshotEntities(evidence.snapshot);
  const constraints: SemanticEntityExpectation[] = expectation.semantic?.entities ?? [];

  for (const expected of constraints) {
    const actual = entities.find((e) => e.id === expected.id);
    if (!actual) {
      checks.push({
        code: "SEMANTIC_ENTITY_MISSING",
        pass: false,
        detail: `authoritative entity '${expected.id}' is absent from the Koota-backed snapshot`,
      });
      continue;
    }
    if (expected.tags_include.length > 0) {
      const tags = actual.tags ?? [];
      const missing = expected.tags_include.filter((t) => !tags.includes(t));
      checks.push(
        missing.length === 0
          ? { code: "SEMANTIC_TAGS", pass: true, detail: `entity '${expected.id}' carries tags [${tags.join(", ")}]` }
          : {
              code: "SEMANTIC_TAGS_MISSING",
              pass: false,
              detail: `entity '${expected.id}' is missing required tags [${missing.join(", ")}]`,
            }
      );
    }
    if (expected.position_approx) {
      const pos = actual.transform?.position;
      if (!pos) {
        checks.push({
          code: "SEMANTIC_TRANSFORM_MISSING",
          pass: false,
          detail: `entity '${expected.id}' has no authoritative transform`,
        });
      } else {
        const dx = Math.abs(pos[0] - expected.position_approx.x);
        const dy = Math.abs(pos[1] - expected.position_approx.y);
        const dz = Math.abs(pos[2] - expected.position_approx.z);
        const within = dx <= expected.tolerance && dy <= expected.tolerance && dz <= expected.tolerance;
        checks.push(
          within
            ? {
                code: "SEMANTIC_POSITION",
                pass: true,
                detail: `entity '${expected.id}' at [${pos.join(", ")}] within tolerance ${expected.tolerance}`,
              }
            : {
                code: "SEMANTIC_POSITION_MISMATCH",
                pass: false,
                detail: `entity '${expected.id}' authoritative position [${pos.join(", ")}] violates expected ` +
                  `[${expected.position_approx.x}, ${expected.position_approx.y}, ${expected.position_approx.z}] ` +
                  `(deltas ${dx}, ${dy}, ${dz} > tolerance ${expected.tolerance})`,
              }
        );
      }
    }
  }
  return {
    channel: "state",
    evaluated: true,
    pass: checks.every((c) => c.pass),
    checks,
  };
}

/** Pixels checks — fresh rendered captures from named views (REQ-VERIFY-002). */
export function checkPixelsChannel(
  expectation: FrozenExpectation,
  evidence: PixelsChannelEvidence
): ChannelVerdict {
  const checks: CheckResult[] = [];
  for (const view of expectation.pixels?.views ?? ["main"]) {
    const capture = evidence.captures.find((c) => c.view === view);
    if (!capture) {
      checks.push({
        code: "PIXEL_CAPTURE_MISSING",
        pass: false,
        detail: `no fresh rendered capture for named view '${view}'`,
      });
      continue;
    }
    checks.push({
      code: "PIXEL_CAPTURE_PRESENT",
      pass: true,
      detail: `view '${view}' captured (${capture.bytes} bytes, sha256 ${capture.sha256.slice(0, 12)}…)`,
    });
    if (capture.width < (expectation.pixels?.min_width ?? 1) || capture.height < (expectation.pixels?.min_height ?? 1)) {
      checks.push({
        code: "PIXEL_CAPTURE_TOO_SMALL",
        pass: false,
        detail: `capture ${capture.width}x${capture.height} below declared minimum ` +
          `${expectation.pixels?.min_width}x${expectation.pixels?.min_height}`,
      });
    } else {
      checks.push({
        code: "PIXEL_CAPTURE_DIMENSIONS",
        pass: true,
        detail: `capture dimensions ${capture.width}x${capture.height} satisfy minimum`,
      });
    }
  }
  return {
    channel: "pixels",
    evaluated: true,
    pass: checks.every((c) => c.pass),
    checks,
  };
}

/** Telemetry checks — runtime consequence (console health + tick advance). */
export function checkTelemetryChannel(
  expectation: FrozenExpectation,
  evidence: TelemetryChannelEvidence
): ChannelVerdict {
  const checks: CheckResult[] = [];
  const consoleErrors = evidence.console.filter(
    (e) => e.type === "error" || e.type === "warning"
  ).length;
  const maxConsole = expectation.telemetry?.max_console_errors ?? 0;
  checks.push(
    consoleErrors <= maxConsole
      ? { code: "CONSOLE_HEALTHY", pass: true, detail: `${consoleErrors} console errors/warnings (max ${maxConsole})` }
      : {
          code: "CONSOLE_ERRORS",
          pass: false,
          detail: `${consoleErrors} console errors/warnings exceed max ${maxConsole}`,
        }
  );
  const maxPage = expectation.telemetry?.max_page_errors ?? 0;
  checks.push(
    evidence.page_errors.length <= maxPage
      ? { code: "PAGE_ERRORS_HEALTHY", pass: true, detail: `${evidence.page_errors.length} page errors (max ${maxPage})` }
      : {
          code: "PAGE_ERRORS",
          pass: false,
          detail: `${evidence.page_errors.length} uncaught page errors exceed max ${maxPage}`,
        }
  );
  const minTick = expectation.telemetry?.tick_advanced_min ?? 1;
  checks.push(
    evidence.tick_after_steps >= minTick
      ? {
          code: "TICK_ADVANCED",
          pass: true,
          detail: `authoritative tick reached ${evidence.tick_after_steps} (min ${minTick})`,
        }
      : {
          code: "TICK_STALLED",
          pass: false,
          detail: `authoritative tick ${evidence.tick_after_steps} did not reach ${minTick}`,
        }
  );
  return {
    channel: "telemetry",
    evaluated: true,
    pass: checks.every((c) => c.pass),
    checks,
  };
}

/** Network checks (where applicable) — observed responses plus surface diagnostics. */
export function checkNetworkChannel(
  expectation: FrozenExpectation,
  evidence: NetworkChannelEvidence
): ChannelVerdict {
  const checks: CheckResult[] = [];
  const minResponses = expectation.network?.min_responses ?? 1;
  checks.push(
    evidence.responses.length >= minResponses
      ? { code: "NETWORK_RESPONSES", pass: true, detail: `${evidence.responses.length} responses observed (min ${minResponses})` }
      : {
          code: "NETWORK_RESPONSES_MISSING",
          pass: false,
          detail: `only ${evidence.responses.length} responses observed (min ${minResponses})`,
        }
  );
  if (expectation.network?.require_all_ok !== false) {
    const failed = evidence.responses.filter((r) => !r.ok);
    checks.push(
      failed.length === 0
        ? { code: "NETWORK_ALL_OK", pass: true, detail: "all observed responses successful" }
        : {
            code: "NETWORK_RESPONSE_FAILED",
            pass: false,
            detail: `failed responses: ${failed.map((r) => `${r.url} -> ${r.status}`).join(", ")}`,
          }
    );
  }

  // T23 (additive): declared client-diagnostics constraints evaluated against the
  // captured surface network read. A missing surface read fails these checks — a
  // networked scenario whose diagnostics were never captured cannot settle.
  const surface = (evidence.surface_read ?? {}) as {
    client?: Record<string, unknown>;
    client_acting?: Record<string, unknown>;
  };
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

  const clientConstraint = expectation.network?.client;
  if (clientConstraint) {
    const diag = surface.client;
    if (!diag || typeof diag !== "object") {
      checks.push({
        code: "NETWORK_CLIENT_DIAGNOSTICS_MISSING",
        pass: false,
        detail: "declared client constraints present but the surface network read carries no client diagnostics",
      });
    } else {
      const state = String(diag.connection_state ?? "");
      checks.push(
        state === clientConstraint.connection_state
          ? { code: "NETWORK_CLIENT_STATE", pass: true, detail: `client connection_state=${state}` }
          : {
              code: "NETWORK_CLIENT_STATE",
              pass: false,
              detail: `client connection_state=${state} violates declared '${clientConstraint.connection_state}'`,
            }
      );
      const minAck = clientConstraint.min_last_acked_sequence;
      if (minAck !== undefined) {
        const acked = num(diag.last_acked_sequence) ?? -1;
        checks.push(
          acked >= minAck
            ? { code: "NETWORK_CLIENT_ACKS", pass: true, detail: `last_acked_sequence=${acked} (min ${minAck})` }
            : {
                code: "NETWORK_CLIENT_ACKS",
                pass: false,
                detail: `last_acked_sequence=${String(diag.last_acked_sequence)} below declared min ${minAck}`,
              }
        );
      }
      const minSnapshots = clientConstraint.min_snapshots_received;
      if (minSnapshots !== undefined) {
        const snapshots = num((diag.counters as Record<string, unknown> | undefined)?.snapshots_received) ?? -1;
        checks.push(
          snapshots >= minSnapshots
            ? { code: "NETWORK_CLIENT_SNAPSHOTS", pass: true, detail: `snapshots_received=${snapshots} (min ${minSnapshots})` }
            : {
                code: "NETWORK_CLIENT_SNAPSHOTS",
                pass: false,
                detail: `snapshots_received below declared min ${minSnapshots}`,
              }
        );
      }
      const minReconciliations = clientConstraint.min_reconciliations;
      if (minReconciliations !== undefined) {
        const reconciliations = num((diag.counters as Record<string, unknown> | undefined)?.reconciliations) ?? -1;
        checks.push(
          reconciliations >= minReconciliations
            ? { code: "NETWORK_CLIENT_RECONCILIATIONS", pass: true, detail: `reconciliations=${reconciliations} (min ${minReconciliations})` }
            : {
                code: "NETWORK_CLIENT_RECONCILIATIONS",
                pass: false,
                detail: `reconciliations below declared min ${minReconciliations}`,
              }
        );
      }
      if (clientConstraint.require_rtt_ms) {
        const rtt = num(diag.rtt_ms);
        checks.push(
          rtt !== null
            ? { code: "NETWORK_CLIENT_RTT", pass: true, detail: `rtt_ms=${rtt} measured` }
            : { code: "NETWORK_CLIENT_RTT", pass: false, detail: "no RTT was measured (declared require_rtt_ms)" }
        );
      }
    }
  }

  const actingConstraint = expectation.network?.acting_client;
  if (actingConstraint) {
    const diag = surface.client_acting;
    if (!diag || typeof diag !== "object") {
      checks.push({
        code: "NETWORK_ACTING_DIAGNOSTICS_MISSING",
        pass: false,
        detail: "declared acting-client constraints present but the surface network read carries no acting-client diagnostics",
      });
    } else {
      if (actingConstraint.require_latency_simulation) {
        const sim = diag.latency_simulation as Record<string, unknown> | null | undefined;
        checks.push(
          sim && typeof sim === "object"
            ? { code: "NETWORK_ACTING_IMPAIRMENT", pass: true, detail: `latency_simulation=${JSON.stringify(sim)}` }
            : {
                code: "NETWORK_ACTING_IMPAIRMENT",
                pass: false,
                detail: "declared latency-simulation exposure absent from the acting client diagnostics",
              }
        );
      }
      const minRtt = actingConstraint.min_rtt_ms;
      if (minRtt !== undefined) {
        const rtt = num(diag.rtt_ms);
        checks.push(
          rtt !== null && rtt >= minRtt
            ? { code: "NETWORK_ACTING_RTT", pass: true, detail: `acting rtt_ms=${rtt} >= ${minRtt}` }
            : {
                code: "NETWORK_ACTING_RTT",
                pass: false,
                detail: `acting rtt_ms=${String(diag.rtt_ms)} below declared floor ${minRtt} (impairment not exposed)`,
              }
        );
      }
    }
  }

  return {
    channel: "network",
    evaluated: true,
    pass: checks.every((c) => c.pass),
    checks,
  };
}

/**
 * Performance checks (T21, REQ-PERF-003/004, REQ-VERIFY-003): captured metrics are
 * evaluated against the DECLARED quality profile from the game project. Structural
 * budget violations and metric-rule violations fail here; hardware-target binding is
 * additionally guarded downstream (non-target renderer evidence is blocked, never
 * passed). An unresolved/undeclared profile is a failing check, never an implicit pass.
 */
export function checkPerformanceChannel(
  expectation: FrozenExpectation,
  evidence: PerformanceChannelEvidence,
  opts: ChannelCheckOptions
): ChannelVerdict {
  const profile = opts.performance?.profile;
  if (!profile) {
    return {
      channel: "performance",
      evaluated: true,
      pass: false,
      checks: [
        {
          code: "PERF_PROFILE_UNRESOLVED",
          pass: false,
          detail: "no declared quality profile was resolved from the game project for this claim; " +
            "undeclared profiles can never be used as gates (REQ-PERF-002, REQ-CONFIG-005)",
        },
      ],
    };
  }
  const evaluation = evaluatePerformanceEvidence(profile, evidence, opts.performance?.asset_summary ?? null);
  return {
    channel: "performance",
    evaluated: true,
    pass: evaluation.pass,
    checks: evaluation.checks.map((c) => ({ code: c.code, pass: c.pass, detail: c.detail })),
  };
}

/**
 * Evaluates every channel the expectation CLAIMS, using present evidence.
 * Absent required channels yield evaluated:false verdicts (settlement turns
 * those into incomplete/blocked, never into a pass).
 */
export function evaluateClaimedChannels(
  expectation: FrozenExpectation,
  channels: ChannelEvidence[],
  opts: ChannelCheckOptions = {}
): ChannelVerdict[] {
  const byChannel = new Map(channels.map((c) => [c.channel, c]));
  const verdicts: ChannelVerdict[] = [];
  if (expectation.claims.state) {
    const e = byChannel.get("state");
    verdicts.push(
      e && e.channel === "state"
        ? checkStateChannel(expectation, e)
        : { channel: "state", evaluated: false, pass: false, checks: [] }
    );
  }
  if (expectation.claims.pixels) {
    const e = byChannel.get("pixels");
    verdicts.push(
      e && e.channel === "pixels"
        ? checkPixelsChannel(expectation, e)
        : { channel: "pixels", evaluated: false, pass: false, checks: [] }
    );
  }
  if (expectation.claims.telemetry) {
    const e = byChannel.get("telemetry");
    verdicts.push(
      e && e.channel === "telemetry"
        ? checkTelemetryChannel(expectation, e)
        : { channel: "telemetry", evaluated: false, pass: false, checks: [] }
    );
  }
  if (expectation.claims.network) {
    const e = byChannel.get("network");
    verdicts.push(
      e && e.channel === "network"
        ? checkNetworkChannel(expectation, e)
        : { channel: "network", evaluated: false, pass: false, checks: [] }
    );
  }
  if (expectation.claims.performance) {
    const e = byChannel.get("performance");
    verdicts.push(
      e && e.channel === "performance"
        ? checkPerformanceChannel(expectation, e, opts)
        : { channel: "performance", evaluated: false, pass: false, checks: [] }
    );
  }
  return verdicts;
}
