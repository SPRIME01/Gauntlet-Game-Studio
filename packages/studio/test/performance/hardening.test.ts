/**
 * T21 HARDENING ROUND 1 tests (deterministic, browser-free) — resolves the two
 * advisory findings recorded in artifacts/plan/T21/confirmation.md ("Advisory
 * findings carried forward to T22") as mandated T22 prerequisites:
 *
 * 1. Declared hardware budgets imply report requirements: the EXACT T21-verifier
 *    vacating scenario (evidence omitting fps_avg with healthy percentiles under
 *    test-budget) now FAILS with the typed PERF_METRIC_UNREPORTED violation —
 *    evaluated at the budget layer AND settled through the T20 Gauntlet bridge.
 *    No original acceptance criterion is weakened; structural checks keep their
 *    existing semantics.
 * 2. Memory budgets are wired end to end at the deterministic evaluation level:
 *    `hardware_budgets.max_memory_mb` evaluates against captured
 *    `metrics.memory_used_mb` (exceeded -> budget_error; within-budget -> pass;
 *    entirely unreported while declared -> PERF_METRIC_UNREPORTED), and the
 *    Chrome `performance.memory` capture normalization is deterministic.
 */

import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseFrozenExpectation, type FrozenExpectation } from "../../src/gauntlet/expectation";
import { settleExpectation, type SettlementOutcome } from "../../src/gauntlet/settle";
import {
  bindQualityProfile,
  evaluatePerformanceEvidence,
  loadQualityProfiles,
  type ResolvedQualityProfile,
} from "../../src/quality";
import { BudgetError } from "@gauntlet/contracts";
import {
  capturePerformanceEvidence,
  normalizeJsHeapMemory,
  type ChannelEvidence,
  type PerformanceChannelEvidence,
} from "@gauntlet/adapters";

const REPO_ROOT = path.resolve(import.meta.dir, "..", "..", "..", "..");
const GAME_SPEC = path.join(REPO_ROOT, "examples", "blackwater-relay", ".agents", "specs", "game.spec.yaml");
const EXPECTATIONS_DIR = path.join(REPO_ROOT, "packages", "studio", "test", "performance", "expectations");
const REVISION = "rev-perf-fixture-a";
const NOW = "2026-09-15T12:00:00Z";

const PROFILES = loadQualityProfiles(GAME_SPEC);
const TEST_BUDGET: ResolvedQualityProfile = bindQualityProfile(PROFILES, "test-budget");
const TARGET: ResolvedQualityProfile = bindQualityProfile(PROFILES, "target");

function loadExpectation(id: string): FrozenExpectation {
  return parseFrozenExpectation(JSON.parse(fs.readFileSync(path.join(EXPECTATIONS_DIR, `${id}.json`), "utf-8")));
}

/** Healthy evidence whose fps_avg key is ENTIRELY ABSENT — the vacating shape. */
function noFpsEvidence(profile: string): PerformanceChannelEvidence {
  return {
    channel: "performance",
    quality_profile: profile,
    present: true,
    metrics: {
      // NO fps_avg — not zero, not unhealthy: omitted entirely.
      frame_time_ms: { avg: 16.9, p50: 16.7, p95: 18.1, p99: 19.8, samples: 40 }, // healthy percentiles
      draw_calls: 18,
      triangles: 420,
      textures: 3,
      resources: 7,
      readiness_ms: 120,
      console_errors: 0,
      memory_used_mb: 48,
      memory_heap_limit_mb: 4096,
    },
    unreported: ["fps_avg"],
    renderer_class: "hardware",
    read_via: ["renderer.stats()", "renderer.probe()"],
  };
}

function perfEvidence(overrides: Partial<PerformanceChannelEvidence> = {}): PerformanceChannelEvidence {
  return {
    channel: "performance",
    quality_profile: "target",
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

function statePassEvidence(): ChannelEvidence {
  return {
    channel: "state",
    source: "koota",
    snapshot: {
      version: 1,
      timestamp: 0,
      entities: [
        { id: "player", transform: { position: [3, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, tags: ["player"] },
        { id: "checkpoint-beacon", transform: { position: [3, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, tags: ["beacon"] },
      ],
    },
    tick: { tick: 3 },
    read_via: ["entities.snapshot()", "tick()"],
  } as unknown as ChannelEvidence;
}

function pixelsPassEvidence(): ChannelEvidence {
  return {
    channel: "pixels",
    captures: [
      { view: "main", artifact: "artifacts/screenshot-main.png", sha256: "a".repeat(64), width: 640, height: 360, bytes: 2048 },
    ],
  };
}

function telemetryPassEvidence(): ChannelEvidence {
  return { channel: "telemetry", console: [], page_errors: [], tick_after_steps: 3 };
}

function settleFor(expectation: FrozenExpectation, perf: PerformanceChannelEvidence, profile: ResolvedQualityProfile): SettlementOutcome {
  const run = {
    id: `run-${expectation.scenario_id}-${REVISION.slice(0, 12)}-20260915T120000Z`,
    project_revision: REVISION,
    scenario_id: expectation.scenario_id,
    environment: {
      browser: "chrome",
      browser_version: "test",
      headless: true,
      viewport: { width: 640, height: 360 },
      platform: "linux",
      quality_profile: profile.id,
      executable_path: "/usr/bin/google-chrome",
      autoplay_bypass_flags: false as const,
    },
    channels: [] as Array<string | Record<string, unknown>>,
    seed: 1337,
    timestamp: NOW,
  };
  const manifest = {
    id: `${run.id}-manifest-01`,
    run_id: run.id,
    project_revision: REVISION,
    requirement_ids: [...expectation.requirement_ids],
    artifacts: [
      { path: "artifacts/performance-metrics.json", sha256: "b".repeat(64), role: "performance-metrics", size_bytes: 64 },
    ],
    result: "pass" as const,
    created_at: NOW,
  };
  return settleExpectation({
    expectation,
    run,
    manifests: [manifest],
    channels: [statePassEvidence(), pixelsPassEvidence(), telemetryPassEvidence(), perf],
    availability: { browser_proof_available: true },
    currentRevision: REVISION,
    performance: { profile },
    now: NOW,
  });
}

describe("TEETH-T22-H1: the exact T21-verifier vacating scenario now fails (advisory finding 1)", () => {
  it("evaluation layer: fps_avg omitted with healthy percentiles FAILS under test-budget (never pass:true)", () => {
    // The EXACT scenario the T21 verifier demonstrated: test-budget profile, healthy
    // percentiles, fps_avg entirely unreported -> previously pass:true, now fails.
    const evaluation = evaluatePerformanceEvidence(TEST_BUDGET, noFpsEvidence("test-budget"));
    expect(evaluation.pass).toBe(false);
    const failed = evaluation.checks.filter((c) => !c.pass);
    // The typed unreported-metric violation names the vacated declared budget.
    expect(failed.map((c) => c.code)).toContain("PERF_METRIC_UNREPORTED");
    const unreported = failed.find((c) => c.code === "PERF_METRIC_UNREPORTED")!;
    expect(unreported.detail).toContain("hardware_budgets.min_fps_avg");
    expect(unreported.budget_class).toBe("structural");
    // Healthy percentiles do NOT trigger the average-only or missing-percentile rules;
    // the omission itself is what now fails.
    expect(failed.map((c) => c.code)).not.toContain("PERF_METRIC_RULE_MISSING_PERCENTILE");
    expect(failed.map((c) => c.code)).not.toContain("PERF_AVERAGE_ONLY_REPORTING");
    // Every other declared check still passes; ONLY the report requirement failed.
    const passedCodes = evaluation.checks.filter((c) => c.pass).map((c) => c.code);
    expect(passedCodes).toContain("PERF_FRAME_TIME_P95");
    expect(passedCodes).toContain("PERF_DRAW_CALLS");
    expect(evaluation.structural_failed).toBe(true);
    expect(evaluation.hardware_failed).toBe(false);
  });

  it("settlement layer: the vacating evidence settles FAILED through the T20 bridge, never settled", () => {
    const expectation = loadExpectation("performance-fixture");
    const outcome = settleFor(expectation, noFpsEvidence("test-budget"), TEST_BUDGET);
    expect(outcome.decision).toBe("failed");
    expect(outcome.record?.decision).toBe("failed");
    expect(outcome.record?.decision).not.toBe("settled");
    expect(outcome.blockage_class).toBe("runtime_consequence_deficit");
    const perfFailed = outcome.channel_verdicts
      .find((v) => v.channel === "performance")!
      .checks.filter((c) => !c.pass)
      .map((c) => c.code);
    expect(perfFailed).toContain("PERF_METRIC_UNREPORTED");
    // Pixels and state still pass — they cannot mask the vacated budget.
    expect(outcome.channel_verdicts.find((v) => v.channel === "state")!.pass).toBe(true);
    expect(outcome.channel_verdicts.find((v) => v.channel === "pixels")!.pass).toBe(true);
    expect(outcome.reason).toContain("PERF_METRIC_UNREPORTED");
  });

  it("fully-reported healthy evidence still settles under test-budget (no over-blocking)", () => {
    const expectation = loadExpectation("performance-fixture");
    const healthy = noFpsEvidence("test-budget");
    healthy.metrics.fps_avg = 60;
    healthy.unreported = [];
    const outcome = settleFor(expectation, healthy, TEST_BUDGET);
    expect(outcome.decision).toBe("settled");
  });

  it("unreported readiness_ms under a declared max_load_ms fails the same way (rule is uniform)", () => {
    const evidence = perfEvidence({ quality_profile: "target" });
    delete (evidence.metrics as Record<string, unknown>).readiness_ms;
    evidence.unreported = ["readiness_ms"];
    const evaluation = evaluatePerformanceEvidence(TARGET, evidence);
    const failed = evaluation.checks.filter((c) => !c.pass);
    expect(failed.map((c) => c.code)).toContain("PERF_METRIC_UNREPORTED");
    expect(failed.find((c) => c.code === "PERF_METRIC_UNREPORTED")!.detail).toContain("hardware_budgets.max_load_ms");
  });
});

describe("TEETH-T22-H2: memory budgets are wired end to end (advisory finding 2, evaluation layer)", () => {
  it("memory above the declared max_memory_mb fails with a typed budget_error violation", () => {
    const evidence = perfEvidence({ metrics: { ...perfEvidence().metrics, memory_used_mb: 300 } });
    const evaluation = evaluatePerformanceEvidence(TARGET, evidence);
    expect(evaluation.pass).toBe(false);
    expect(evaluation.hardware_failed).toBe(true);
    const memoryCheck = evaluation.checks.find((c) => c.code === "PERF_MEMORY")!;
    expect(memoryCheck.pass).toBe(false);
    expect(memoryCheck.detail).toContain("256"); // declared target-profile budget
    const budgets = evaluation.violations.map((v) => v.budget);
    expect(budgets).toContain("hardware_budgets.max_memory_mb");
    expect(evaluation.budget_error).toBeInstanceOf(BudgetError);
    expect(evaluation.budget_error!.details.violations.map((v) => v.budget)).toContain(
      "hardware_budgets.max_memory_mb"
    );
  });

  it("settlement layer: memory-budget exceedance settles FAILED with budget_error against the profile", () => {
    const expectation = loadExpectation("performance-fixture-swiftshader"); // binds the `target` profile
    const evidence = perfEvidence({ metrics: { ...perfEvidence().metrics, memory_used_mb: 300 } });
    const outcome = settleFor(expectation, evidence, TARGET);
    expect(outcome.decision).toBe("failed");
    expect(outcome.budget_error?.code).toBe("budget_error");
    expect(outcome.budget_error?.quality_profile).toBe("target");
    expect(outcome.budget_error?.violations.map((v) => v.budget)).toContain("hardware_budgets.max_memory_mb");
    expect(outcome.reason).toContain("budget_error");
  });

  it("memory within the declared budget passes", () => {
    const evaluation = evaluatePerformanceEvidence(
      TARGET,
      perfEvidence({ metrics: { ...perfEvidence().metrics, memory_used_mb: 128, memory_heap_limit_mb: 4096 } })
    );
    expect(evaluation.checks.find((c) => c.code === "PERF_MEMORY")!.pass).toBe(true);
    expect(evaluation.pass).toBe(true);
  });

  it("memory exactly AT the declared budget passes (<= boundary)", () => {
    const evaluation = evaluatePerformanceEvidence(
      TARGET,
      perfEvidence({ metrics: { ...perfEvidence().metrics, memory_used_mb: 256 } })
    );
    expect(evaluation.checks.find((c) => c.code === "PERF_MEMORY")!.pass).toBe(true);
  });

  it("memory entirely unreported while max_memory_mb is declared fails PERF_METRIC_UNREPORTED (never silently passes)", () => {
    const evidence = perfEvidence();
    delete (evidence.metrics as Record<string, unknown>).memory_used_mb;
    evidence.unreported = ["memory_used_mb"];
    const evaluation = evaluatePerformanceEvidence(TARGET, evidence);
    expect(evaluation.pass).toBe(false);
    const failed = evaluation.checks.filter((c) => !c.pass);
    expect(failed.map((c) => c.code)).toContain("PERF_METRIC_UNREPORTED");
    expect(failed.find((c) => c.code === "PERF_METRIC_UNREPORTED")!.detail).toContain("hardware_budgets.max_memory_mb");
  });

  it("profiles that declare no max_memory_mb emit no memory check at all (test-budget)", () => {
    const withMemory = evaluatePerformanceEvidence(
      TEST_BUDGET,
      perfEvidence({ quality_profile: "test-budget", metrics: { ...perfEvidence().metrics, memory_used_mb: 9000 } })
    );
    expect(withMemory.checks.map((c) => c.code)).not.toContain("PERF_MEMORY");
    expect(withMemory.pass).toBe(true); // undeclared => ungated, never invented
  });
});

describe("Chrome performance.memory capture normalization (deterministic, browser-free)", () => {
  it("converts raw JS-heap bytes to MB", () => {
    const heap = normalizeJsHeapMemory({ usedJSHeapSize: 52 * 1024 * 1024, jsHeapSizeLimit: 4 * 1024 * 1024 * 1024 });
    expect(heap).not.toBeNull();
    expect(heap!.used_mb).toBe(52);
    expect(heap!.limit_mb).toBe(4096);
  });

  it("returns null for absent/invalid readings and tolerates a missing limit", () => {
    expect(normalizeJsHeapMemory(null)).toBeNull();
    expect(normalizeJsHeapMemory(undefined)).toBeNull();
    expect(normalizeJsHeapMemory({} as { usedJSHeapSize?: unknown })).toBeNull();
    expect(normalizeJsHeapMemory({ usedJSHeapSize: Number.NaN })).toBeNull();
    expect(normalizeJsHeapMemory({ usedJSHeapSize: -1 })).toBeNull();
    expect(normalizeJsHeapMemory({ usedJSHeapSize: "x" as unknown as number })).toBeNull();
    const noLimit = normalizeJsHeapMemory({ usedJSHeapSize: 1024 * 1024 });
    expect(noLimit!.used_mb).toBe(1);
    expect(noLimit!.limit_mb).toBeUndefined();
  });

  it("capture: Chrome page-seam memory flows into the evidence when stats omit it", () => {
    const evidence = capturePerformanceEvidence({
      quality_profile: "target",
      rendererStats: { fps_avg: 60, draw_calls: 18 },
      rendererIdentity: { unmasked_renderer: "ANGLE (Deterministic Fixture GL, HardwareClass)" },
      console_errors: 0,
      memory: { usedJSHeapSize: 48 * 1024 * 1024, jsHeapSizeLimit: 4 * 1024 * 1024 * 1024 },
    });
    expect(evidence.present).toBe(true);
    expect(evidence.metrics.memory_used_mb).toBe(48);
    expect(evidence.metrics.memory_heap_limit_mb).toBe(4096);
    expect(evidence.unreported).not.toContain("memory_used_mb");
  });

  it("capture: stable-seam stats memory takes precedence over the page-seam reading", () => {
    const evidence = capturePerformanceEvidence({
      quality_profile: "target",
      rendererStats: { fps_avg: 60, memory_used_mb: 31.5, memory_heap_limit_mb: 2048 },
      rendererIdentity: { unmasked_renderer: "ANGLE (Deterministic Fixture GL, HardwareClass)" },
      console_errors: 0,
      memory: { usedJSHeapSize: 99 * 1024 * 1024, jsHeapSizeLimit: 4096 * 1024 * 1024 },
    });
    expect(evidence.metrics.memory_used_mb).toBe(31.5);
    expect(evidence.metrics.memory_heap_limit_mb).toBe(2048);
  });

  it("capture: no memory source records memory_used_mb in unreported (never fabricated)", () => {
    const evidence = capturePerformanceEvidence({
      quality_profile: "target",
      rendererStats: { fps_avg: 60 },
      rendererIdentity: { unmasked_renderer: "ANGLE (Deterministic Fixture GL, HardwareClass)" },
      console_errors: 0,
      memory: null,
    });
    expect(evidence.metrics.memory_used_mb).toBeUndefined();
    expect(evidence.unreported).toContain("memory_used_mb");
  });

  it("capture: present:false surfaces list memory among unreported metrics", () => {
    const evidence = capturePerformanceEvidence({
      quality_profile: "target",
      rendererStats: null,
      rendererStatsReason: "renderer stats not available",
      console_errors: 0,
    });
    expect(evidence.present).toBe(false);
    expect(evidence.unreported).toContain("memory_used_mb");
  });
});
