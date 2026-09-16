/**
 * T21 quality-profile and performance-budget evaluation tests (deterministic,
 * browser-free): declared-before-use profile gating (REQ-PERF-002, REQ-CONFIG-005),
 * deterministic frame-time distribution percentiles, the software-renderer guard
 * classification (REQ-PERF-003), structural budget enforcement with typed
 * budget_error (REQ-PERF-004), declared metric rules against average-only reporting
 * (TEETH-T21-002 evaluation layer), the T13 Asset Registry integration, and the T19
 * stable-seam performance capture.
 */

import { describe, it, expect } from "bun:test";
import * as path from "node:path";
import {
  loadQualityProfiles,
  bindQualityProfile,
  resolveQualityProfile,
  QualityProfileError,
  evaluatePerformanceEvidence,
  type ResolvedQualityProfile,
} from "../../src/quality";
import { BudgetError } from "@gauntlet/contracts";
import {
  capturePerformanceEvidence,
  computeFrameTimeDistribution,
  classifyRendererIdentity,
  percentileSorted,
} from "@gauntlet/adapters";
import type { PerformanceChannelEvidence } from "@gauntlet/adapters";

const REPO_ROOT = path.resolve(import.meta.dir, "..", "..", "..", "..");
const GAME_SPEC = path.join(REPO_ROOT, "examples", "blackwater-relay", ".agents", "specs", "game.spec.yaml");

function perfEvidence(overrides: Partial<PerformanceChannelEvidence> = {}): PerformanceChannelEvidence {
  return {
    channel: "performance",
    quality_profile: "test-budget",
    present: true,
    metrics: {
      fps_avg: 60,
      frame_time_ms: { avg: 16.9, p50: 16.7, p95: 18.1, p99: 19.8, samples: 40 },
      draw_calls: 18,
      triangles: 420,
      textures: 3,
      resources: 7,
      readiness_ms: 120,
      console_errors: 0,
    },
    unreported: [],
    renderer_class: "hardware",
    read_via: ["renderer.stats()", "renderer.probe()"],
    ...overrides,
  };
}

describe("Quality profiles are declared before use as gates (REQ-PERF-002, REQ-CONFIG-005)", () => {
  it("loads the Blackwater reference-game profiles with game-owned numbers", () => {
    const profiles = loadQualityProfiles(GAME_SPEC);
    expect(Object.keys(profiles).sort()).toEqual(["target", "test-budget"]);
    // target: the absolute desktop-target hardware budget (declared, T22-settled).
    expect(profiles.target.evidence_class).toBe("hardware-target");
    expect(profiles.target.environment_binding).toBe("desktop-chrome-hardware");
    expect(profiles.target.structural_budgets.max_draw_calls).toBe(200);
    expect(profiles.target.hardware_budgets.target_fps).toBe(60);
    // test-budget: deterministic CI profile bound to an explicit relative baseline.
    expect(profiles["test-budget"].evidence_class).toBe("structural+relative-baseline");
    expect(profiles["test-budget"].hardware_budgets.relative_baseline?.baseline_ref).toBe(
      "performance-fixture-v1"
    );
    expect(profiles["test-budget"].structural_budgets.max_draw_calls).toBe(24);
  });

  it("binds a declared profile to its id for gate use", () => {
    const bound = bindQualityProfile(loadQualityProfiles(GAME_SPEC), "test-budget");
    expect(bound.id).toBe("test-budget");
    expect(bound.metric_rules.frame_time_percentiles).toEqual(["p50", "p95", "p99"]);
    expect(bound.metric_rules.average_only_rejected).toBe(true);
  });

  it("rejects UNDECLARED profiles as gates (typed failure, never an implicit pass)", () => {
    const profiles = loadQualityProfiles(GAME_SPEC);
    expect(() => resolveQualityProfile(profiles, "ultra-quality-9000")).toThrow(QualityProfileError);
    expect(() => bindQualityProfile(profiles, "ultra-quality-9000")).toThrow(/PROFILE_NOT_DECLARED|not declared/);
  });

  it("rejects a game spec without declared profiles", () => {
    const specPath = path.join(REPO_ROOT, "packages", "studio", "test", "performance", "fixtures", "game-spec-no-profiles.yaml");
    expect(() => loadQualityProfiles(specPath)).toThrow(QualityProfileError);
  });
});

describe("Deterministic frame-time distribution (never average-only)", () => {
  it("computes nearest-rank p50/p95/p99 deterministically", () => {
    const samples = Array.from({ length: 40 }, (_, i) => 15.2 + (19.8 - 15.2) * (i / 39));
    const dist = computeFrameTimeDistribution(samples)!;
    expect(dist.samples).toBe(40);
    expect(dist.p50).toBeCloseTo(15.2 + 4.6 * (19 / 39), 6);
    expect(dist.p95).toBeCloseTo(15.2 + 4.6 * (37 / 39), 6);
    expect(dist.p99).toBe(19.8);
    // Repeated computation is identical (deterministic).
    const again = computeFrameTimeDistribution(samples)!;
    expect(again).toEqual(dist);
  });

  it("keeps only finite non-negative samples and returns null when none remain", () => {
    expect(computeFrameTimeDistribution([1, Number.NaN, -3, 2, "x" as unknown as number])?.samples).toBe(2);
    expect(computeFrameTimeDistribution([Number.NaN])).toBeNull();
    expect(computeFrameTimeDistribution([])).toBeNull();
  });

  it("uses nearest-rank percentile semantics", () => {
    const sorted = [10, 20, 30, 40];
    expect(percentileSorted(sorted, 0.5)).toBe(20); // ceil(2)-1 = 1
    expect(percentileSorted(sorted, 0.95)).toBe(40); // ceil(3.8)-1 = 3
  });
});

describe("Software-renderer guard classification (REQ-PERF-003)", () => {
  it("classifies SwiftShader/llvmpipe-class identities as software (non-target)", () => {
    expect(classifyRendererIdentity({ unmasked_renderer: "SwiftShader 5.0" })).toBe("software");
    expect(classifyRendererIdentity({ unmasked_renderer: "llvmpipe (LLVM 15.0)" })).toBe("software");
    expect(classifyRendererIdentity({ GL_RENDERER: "softpipe" })).toBe("software");
    expect(classifyRendererIdentity({ renderer: "Software Rasterizer" })).toBe("software");
  });

  it("classifies hardware identities as hardware and absent identities as unknown", () => {
    expect(classifyRendererIdentity({ unmasked_renderer: "ANGLE (NVIDIA GeForce RTX)" })).toBe("hardware");
    expect(classifyRendererIdentity({ unmasked_renderer: "Apple M2" })).toBe("hardware");
    expect(classifyRendererIdentity(undefined)).toBe("unknown");
    expect(classifyRendererIdentity({})).toBe("unknown");
  });
});

describe("Structural budgets are enforced browser-free with typed budget_error (REQ-PERF-003/004)", () => {
  const profiles = loadQualityProfiles(GAME_SPEC);
  const testBudget: ResolvedQualityProfile = bindQualityProfile(profiles, "test-budget");

  it("passes healthy evidence against the declared test-budget structural budgets", () => {
    const evaluation = evaluatePerformanceEvidence(testBudget, perfEvidence());
    expect(evaluation.pass).toBe(true);
    expect(evaluation.violations).toEqual([]);
    expect(evaluation.budget_error).toBeNull();
    expect(evaluation.non_target).toBe(false);
  });

  it("fails draw-call/triangle regressions as budget_error, never warnings", () => {
    const evaluation = evaluatePerformanceEvidence(
      testBudget,
      perfEvidence({
        metrics: {
          fps_avg: 24,
          frame_time_ms: { avg: 40, p50: 38.5, p95: 56.05, p99: 58, samples: 40 },
          draw_calls: 36,
          triangles: 420,
          textures: 3,
          resources: 7,
          readiness_ms: 120,
          console_errors: 0,
        },
      })
    );
    expect(evaluation.pass).toBe(false);
    expect(evaluation.structural_failed).toBe(true);
    expect(evaluation.hardware_failed).toBe(true);
    const codes = evaluation.checks.filter((c) => !c.pass).map((c) => c.code);
    expect(codes).toContain("PERF_DRAW_CALLS");
    expect(codes).toContain("PERF_FPS_AVG");
    expect(codes).toContain("PERF_FRAME_TIME_P95");
    expect(codes).toContain("PERF_FRAME_TIME_P99");
    expect(evaluation.budget_error).toBeInstanceOf(BudgetError);
    expect(evaluation.budget_error?.code).toBe("budget_error");
    expect(evaluation.budget_error?.details.quality_profile).toBe("test-budget");
    const budgets = evaluation.budget_error!.details.violations.map((v) => v.budget);
    expect(budgets).toContain("structural_budgets.max_draw_calls");
    expect(evaluation.budget_error!.details.recoverability.length).toBeGreaterThan(0);
  });

  it("fails scene budgets when the T13 Asset Registry has non-acceptable assets", () => {
    const evaluation = evaluatePerformanceEvidence(testBudget, perfEvidence(), {
      not_acceptable: 1,
    });
    expect(evaluation.structural_failed).toBe(true);
    expect(evaluation.checks.find((c) => c.code === "PERF_ASSET_REGISTRY")?.pass).toBe(false);
  });

  it("enforces declared asset-byte budgets against registry totals", () => {
    const profile: ResolvedQualityProfile = {
      ...testBudget,
      id: "bytes-gated",
      structural_budgets: { ...testBudget.structural_budgets, max_asset_bytes: 1000 },
    };
    const over = evaluatePerformanceEvidence(profile, perfEvidence(), {
      total_bytes: 2000,
      not_acceptable: 0,
    });
    expect(over.checks.find((c) => c.code === "PERF_ASSET_BYTES")?.pass).toBe(false);
    const under = evaluatePerformanceEvidence(profile, perfEvidence(), {
      total_bytes: 500,
      not_acceptable: 0,
    });
    expect(under.checks.find((c) => c.code === "PERF_ASSET_BYTES")?.pass).toBe(true);
    const unmeasured = evaluatePerformanceEvidence(profile, perfEvidence(), { not_acceptable: 0 });
    expect(unmeasured.checks.find((c) => c.code === "PERF_ASSET_BYTES")?.pass).toBe(false);
  });

  it("treats an unmeasurable surface honestly (present:false never passes)", () => {
    const evaluation = evaluatePerformanceEvidence(
      testBudget,
      perfEvidence({ present: false, reason: "renderer stats not available", metrics: {} })
    );
    expect(evaluation.pass).toBe(false);
    expect(evaluation.checks[0].code).toBe("PERF_SURFACE_ABSENT");
  });
});

describe("Declared metric rules reject average-only reporting (TEETH-T21-002 evaluation layer)", () => {
  const testBudget = bindQualityProfile(loadQualityProfiles(GAME_SPEC), "test-budget");

  it("fails when declared percentiles are not reported even with a healthy average", () => {
    const evaluation = evaluatePerformanceEvidence(
      testBudget,
      perfEvidence({
        metrics: {
          fps_avg: 60, // HEALTHY average — and it still must not pass
          draw_calls: 18,
          triangles: 420,
          textures: 3,
          resources: 7,
          readiness_ms: 120,
          console_errors: 0,
        },
        unreported: ["frame_time_ms.p50", "frame_time_ms.p95", "frame_time_ms.p99"],
      })
    );
    expect(evaluation.pass).toBe(false);
    const failedCodes = evaluation.checks.filter((c) => !c.pass).map((c) => c.code);
    expect(failedCodes).toContain("PERF_METRIC_RULE_MISSING_PERCENTILE");
    expect(failedCodes).toContain("PERF_AVERAGE_ONLY_REPORTING");
    expect(failedCodes).not.toContain("PERF_DRAW_CALLS"); // structural budgets still pass
  });

  it("passes when the full declared distribution is reported within budgets", () => {
    const evaluation = evaluatePerformanceEvidence(testBudget, perfEvidence());
    const failedCodes = evaluation.checks.filter((c) => !c.pass).map((c) => c.code);
    expect(failedCodes).not.toContain("PERF_METRIC_RULE_MISSING_PERCENTILE");
    expect(failedCodes).not.toContain("PERF_AVERAGE_ONLY_REPORTING");
  });
});

describe("Performance capture through the T19 stable seams (observation only)", () => {
  it("maps stable renderer.stats()/probe() reads into performance evidence", () => {
    const samples = Array.from({ length: 40 }, (_, i) => 15.2 + (19.8 - 15.2) * (i / 39));
    const evidence = capturePerformanceEvidence({
      quality_profile: "test-budget",
      rendererStats: {
        draw_calls: 18,
        triangles: 420,
        textures: 3,
        resources: 7,
        fps_avg: 60,
        readiness_ms: 120,
        frame_time_samples_ms: samples,
        frame_time_sample_count: 40,
      },
      rendererIdentity: { unmasked_renderer: "ANGLE (Deterministic Fixture GL, HardwareClass)" },
      console_errors: 0,
    });
    expect(evidence.present).toBe(true);
    expect(evidence.renderer_class).toBe("hardware");
    expect(evidence.metrics.draw_calls).toBe(18);
    expect(evidence.metrics.frame_time_ms?.p99).toBeCloseTo(19.8, 6);
    expect(evidence.metrics.console_errors).toBe(0);
    expect(evidence.read_via).toEqual(["renderer.stats()", "renderer.probe()"]);
  });

  it("records present:false when the surface cannot report stats (never fabricated)", () => {
    const evidence = capturePerformanceEvidence({
      quality_profile: "target",
      rendererStats: null,
      rendererStatsReason: "fixture: no renderer stats",
      console_errors: 0,
    });
    expect(evidence.present).toBe(false);
    expect(evidence.unreported).toContain("frame_time_ms.p95");
  });

  it("marks SwiftShader-class probe identities as software at capture time", () => {
    const evidence = capturePerformanceEvidence({
      quality_profile: "target",
      rendererStats: { fps_avg: 60, frame_time_p50_ms: 16, frame_time_p95_ms: 18, frame_time_p99_ms: 20 },
      rendererIdentity: { unmasked_renderer: "SwiftShader (SoftwareGL)" },
      console_errors: 0,
    });
    expect(evidence.renderer_class).toBe("software");
    expect(evidence.metrics.frame_time_ms?.p95).toBe(18); // explicit declared percentiles accepted
  });
});
