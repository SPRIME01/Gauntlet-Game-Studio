/**
 * Performance budget evaluation against declared quality profiles (T21,
 * REQ-PERF-001..004, REQ-VERIFY-003, REQ-PERF-004).
 *
 * Pure, deterministic, browser-free evaluation of captured performance evidence
 * against ONE declared quality profile. Violations yield typed budget_error records —
 * never warnings. Structural budget failures are valid evidence in ANY environment;
 * hardware-sensitive acceptance additionally requires the profile's evidence class to
 * be satisfiable by the observed renderer class.
 *
 * Declared budgets imply report requirements (T21 hardening round 1, resolving the
 * advisory findings in artifacts/plan/T21/confirmation.md): when a profile declares a
 * hardware-sensitive budget on a metric and the evidence contains NO value for that
 * metric, the check FAILS with a typed `PERF_METRIC_UNREPORTED` violation — a declared
 * budget can never be silently vacated by omitting the measurement (the T21 verifier
 * demonstrated `fps_avg` omitted with healthy percentiles evaluating pass:true).
 * Structural checks keep their existing semantics. JS-heap memory
 * (`memory_used_mb`, captured through the T20 harness page-evaluation seam / stable
 * renderer stats seam) is evaluated against `hardware_budgets.max_memory_mb` when
 * declared.
 *
 * This module EVALUATES; it never settles. Settlement mapping (failed/blocked) lives
 * in the T20 Gauntlet settlement bridge, which consumes these verdicts.
 */

import { BudgetError, type BudgetViolation } from "@gauntlet/contracts";
import type { PerformanceChannelEvidence } from "@gauntlet/adapters";
import type { ResolvedQualityProfile } from "./profiles";

// ---------------------------------------------------------------------------
// Evaluation verdicts
// ---------------------------------------------------------------------------

export type PerfBudgetClass = "structural" | "hardware-sensitive";

export interface PerfCheck {
  code: string;
  pass: boolean;
  detail: string;
  budget_class: PerfBudgetClass;
}

export interface AssetBudgetSummary {
  /** Scene-total accepted asset bytes (from T13 registry data where available). */
  total_bytes?: number;
  /** Assets that are NOT production-acceptable (rejected/blocked budget-gate failures). */
  not_acceptable: number;
}

export interface PerformanceEvaluation {
  pass: boolean;
  checks: PerfCheck[];
  violations: BudgetViolation[];
  /** At least one structural budget failed (valid evidence everywhere). */
  structural_failed: boolean;
  /** At least one hardware-sensitive budget failed. */
  hardware_failed: boolean;
  /**
   * True when the claimed profile is hardware-target but this evidence CANNOT settle
   * it (software/unknown renderer). Non-target evidence is blocked, never passed.
   */
  non_target: boolean;
  budget_error: BudgetError | null;
}

/** Verdict check codes that belong to the deterministic/structural class. */
const STRUCTURAL_CHECK_CODES = new Set([
  "PERF_SURFACE_ABSENT",
  "PERF_DRAW_CALLS",
  "PERF_TRIANGLES",
  "PERF_TEXTURES",
  "PERF_RESOURCES",
  "PERF_CONSOLE_ERRORS",
  "PERF_ASSET_BYTES",
  "PERF_ASSET_REGISTRY",
  "PERF_METRIC_RULE_MISSING_PERCENTILE",
  "PERF_AVERAGE_ONLY_REPORTING",
  // T21 hardening: an unreported declared metric is deterministically detectable
  // (the value is present in the evidence or it is not) in ANY environment.
  "PERF_METRIC_UNREPORTED",
]);

export function isStructuralPerfCode(code: string): boolean {
  return STRUCTURAL_CHECK_CODES.has(code);
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

function violation(
  budget: string,
  limit: number,
  measured: number,
  scope = "performance.renderer_stats"
): BudgetViolation {
  return { budget, limit, measured, scope };
}

function buildBudgetError(profile: ResolvedQualityProfile, violations: BudgetViolation[]): BudgetError {
  return new BudgetError(
    `quality profile '${profile.id}' budget violated: ` +
      violations.map((v) => `${v.budget} limit ${v.limit}, measured ${v.measured}`).join("; "),
    {
      quality_profile: profile.id,
      violations,
      recoverability:
        "reduce the measured draw calls/triangles/textures/errors/bytes or amend the game-project profile through its own governance; visual quality alone cannot recover a budget violation (REQ-PERF-004)",
    }
  );
}

/**
 * Evaluates captured performance evidence against ONE declared quality profile.
 * Deterministic and browser-free. The profile must already be resolved from the game
 * project (see loadQualityProfiles/resolveQualityProfile).
 */
export function evaluatePerformanceEvidence(
  profile: ResolvedQualityProfile,
  evidence: PerformanceChannelEvidence,
  assetSummary?: AssetBudgetSummary | null
): PerformanceEvaluation {
  const checks: PerfCheck[] = [];
  const violations: BudgetViolation[] = [];
  const metrics = evidence.metrics ?? {};

  if (evidence.present === false) {
    checks.push({
      code: "PERF_SURFACE_ABSENT",
      pass: false,
      detail: `renderer stats were not observable through the stable surface${evidence.reason ? `: ${evidence.reason}` : ""}; performance evidence cannot be produced here`,
      budget_class: "structural",
    });
    return {
      pass: false,
      checks,
      violations,
      structural_failed: true,
      hardware_failed: false,
      non_target: false,
      budget_error: null,
    };
  }

  // ---- Declared metric rules FIRST (tooth 2): a reporter that surfaces only a
  // healthy average while omitting the declared percentiles fails the profile gate.
  const dist = metrics.frame_time_ms ?? null;
  for (const percentile of profile.metric_rules.frame_time_percentiles) {
    const reported = dist ? dist[percentile] : undefined;
    if (typeof reported !== "number") {
      checks.push({
        code: "PERF_METRIC_RULE_MISSING_PERCENTILE",
        pass: false,
        detail: `profile '${profile.id}' declares frame-time ${percentile} as a gating metric, but the evidence does not report it ` +
          `(average-only reporting is rejected per declared metric rules)`,
        budget_class: "structural",
      });
    }
  }
  if (
    profile.metric_rules.average_only_rejected &&
    typeof metrics.fps_avg === "number" &&
    (!dist || typeof dist.p95 !== "number" || typeof dist.p99 !== "number")
  ) {
    checks.push({
      code: "PERF_AVERAGE_ONLY_REPORTING",
      pass: false,
      detail: `evidence reports only summary averages (fps_avg ${metrics.fps_avg}); profile '${profile.id}' declares average-only reporting rejected — the frame-time distribution must be measured`,
      budget_class: "structural",
    });
  }

  // ---- Structural budgets (deterministic; valid evidence in ANY environment).
  const structural: Array<{ code: string; key: keyof typeof profile.structural_budgets; label: string; measured: number | undefined }> = [
    { code: "PERF_DRAW_CALLS", key: "max_draw_calls", label: "draw calls", measured: metrics.draw_calls },
    { code: "PERF_TRIANGLES", key: "max_triangles", label: "triangles", measured: metrics.triangles },
    { code: "PERF_TEXTURES", key: "max_textures", label: "textures", measured: metrics.textures },
    { code: "PERF_RESOURCES", key: "max_resources", label: "resources", measured: metrics.resources },
    { code: "PERF_CONSOLE_ERRORS", key: "max_console_errors", label: "console errors", measured: metrics.console_errors },
  ];
  for (const item of structural) {
    const limit = profile.structural_budgets[item.key];
    if (limit === undefined) continue; // profile does not gate this metric
    if (typeof item.measured !== "number") {
      checks.push({
        code: item.code,
        pass: false,
        detail: `profile '${profile.id}' gates ${item.label} but the evidence did not report it`,
        budget_class: "structural",
      });
      continue;
    }
    const pass = item.measured <= limit;
    checks.push({
      code: item.code,
      pass,
      detail: `${item.label} ${item.measured} vs budget ${limit} (${profile.id})`,
      budget_class: "structural",
    });
    if (!pass) violations.push(violation(`structural_budgets.${String(item.key)}`, limit, item.measured));
  }

  if (profile.structural_budgets.max_asset_bytes !== undefined) {
    const limit = profile.structural_budgets.max_asset_bytes;
    const measured = assetSummary?.total_bytes;
    if (typeof measured !== "number") {
      checks.push({
        code: "PERF_ASSET_BYTES",
        pass: false,
        detail: `profile '${profile.id}' gates asset bytes but no Asset Registry summary was provided`,
        budget_class: "structural",
      });
    } else {
      const pass = measured <= limit;
      checks.push({
        code: "PERF_ASSET_BYTES",
        pass,
        detail: `asset bytes ${measured} vs budget ${limit} (${profile.id})`,
        budget_class: "structural",
      });
      if (!pass) violations.push(violation("structural_budgets.max_asset_bytes", limit, measured, "performance.asset_registry"));
    }
  }

  // T13 integration: scene/asset budget failure in the registry itself blocks
  // acceptance under the profile — never a warning-only path (REQ-PERF-004).
  if (assetSummary && assetSummary.not_acceptable > 0) {
    checks.push({
      code: "PERF_ASSET_REGISTRY",
      pass: false,
      detail: `Asset Registry reports ${assetSummary.not_acceptable} non-production-acceptable asset(s); scene budgets cannot pass while registry budget failures are unresolved`,
      budget_class: "structural",
    });
    violations.push(
      violation("asset_registry.not_acceptable", 0, assetSummary.not_acceptable, "performance.asset_registry")
    );
  }

  // ---- Hardware-sensitive guard: hardware-target profiles can never be settled by
  // non-target (software/unknown renderer) evidence (REQ-PERF-003).
  const rendererAllowsHardware = evidence.renderer_class === "hardware";
  const nonTarget = profile.evidence_class === "hardware-target" && !rendererAllowsHardware;
  if (nonTarget) {
    checks.push({
      code: "PERF_NON_TARGET_RENDERER",
      pass: false,
      detail: `renderer class '${evidence.renderer_class}' cannot satisfy profile '${profile.id}' ` +
        `(hardware-target, environment binding '${profile.environment_binding}'); software-rendered ` +
        "evidence is non-target and can never masquerade as desktop/mobile target-hardware evidence",
      budget_class: "hardware-sensitive",
    });
  }

  // ---- Hardware-sensitive budgets (frame-time percentiles, FPS, load timing, memory).
  const hardware: Array<{ code: string; limit: number | undefined; measured: number | undefined; label: string; compare: "max" | "min"; budget: string }> = [
    { code: "PERF_FPS_AVG", limit: profile.hardware_budgets.min_fps_avg, measured: metrics.fps_avg, label: "average FPS", compare: "min", budget: "hardware_budgets.min_fps_avg" },
    { code: "PERF_FRAME_TIME_P50", limit: profile.hardware_budgets.max_frame_time_p50_ms, measured: dist?.p50, label: "frame time p50", compare: "max", budget: "hardware_budgets.max_frame_time_p50_ms" },
    { code: "PERF_FRAME_TIME_P95", limit: profile.hardware_budgets.max_frame_time_p95_ms, measured: dist?.p95, label: "frame time p95", compare: "max", budget: "hardware_budgets.max_frame_time_p95_ms" },
    { code: "PERF_FRAME_TIME_P99", limit: profile.hardware_budgets.max_frame_time_p99_ms, measured: dist?.p99, label: "frame time p99", compare: "max", budget: "hardware_budgets.max_frame_time_p99_ms" },
    { code: "PERF_LOAD_TIME", limit: profile.hardware_budgets.max_load_ms, measured: metrics.readiness_ms, label: "readiness/load time", compare: "max", budget: "hardware_budgets.max_load_ms" },
    { code: "PERF_MEMORY", limit: profile.hardware_budgets.max_memory_mb, measured: metrics.memory_used_mb, label: "JS heap memory used", compare: "max", budget: "hardware_budgets.max_memory_mb" },
  ];
  for (const item of hardware) {
    if (item.limit === undefined) continue; // profile does not gate this metric
    if (typeof item.measured !== "number") {
      // T21 hardening (advisory finding 1): a declared hardware budget implies a
      // report requirement. Evidence that omits the metric entirely FAILS the
      // profile gate with a typed violation — it can never silently vacate the
      // declared budget (the T21 verifier demonstrated fps_avg omitted with healthy
      // percentiles evaluating pass:true). Classified structural/deterministic:
      // whether the evidence reports the value is provable in ANY environment.
      checks.push({
        code: "PERF_METRIC_UNREPORTED",
        pass: false,
        detail: `profile '${profile.id}' declares ${item.budget} (${item.compare} ${item.limit}) but the evidence reports no ${item.label} value; ` +
          "a declared hardware budget implies a report requirement and cannot be vacated by omitting the measurement",
        budget_class: "structural",
      });
      continue;
    }
    const pass = item.compare === "max" ? item.measured <= item.limit : item.measured >= item.limit;
    const binding =
      profile.evidence_class === "hardware-target"
        ? `hardware-target binding '${profile.environment_binding}'`
        : `declared relative baseline '${profile.hardware_budgets.relative_baseline?.baseline_ref ?? "undeclared"}'`;
    checks.push({
      code: item.code,
      pass,
      detail: `${item.label} ${item.measured} vs ${item.compare} ${item.limit} under ${binding}`,
      budget_class: "hardware-sensitive",
    });
    if (!pass) violations.push(violation(item.budget, item.limit, item.measured));
  }

  // Failure-class flags are computed AFTER every check is pushed: the unreported-
  // declared-metric checks (PERF_METRIC_UNREPORTED) are structural-class but arise
  // from the hardware budget loop, so structural_failed must observe them too.
  const structuralFailed = checks.some((c) => c.budget_class === "structural" && !c.pass);
  const hardwareChecks = checks.filter((c) => c.budget_class === "hardware-sensitive" && c.code !== "PERF_NON_TARGET_RENDERER");
  const hardwareFailed = hardwareChecks.some((c) => !c.pass);

  return {
    pass: checks.every((c) => c.pass),
    checks,
    violations,
    structural_failed: structuralFailed,
    hardware_failed: hardwareFailed,
    non_target: nonTarget,
    budget_error: violations.length > 0 ? buildBudgetError(profile, violations) : null,
  };
}
