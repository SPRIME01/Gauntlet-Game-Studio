/**
 * T21 performance settlement tests (deterministic, browser-free): the two
 * preregistered falsifiers (TEETH-T21-001 frame-time/draw-call regression with
 * unchanged pixels and semantics; TEETH-T21-002 average-only reporting while
 * declared percentiles exceed/are missing), the software-renderer guard
 * (hardware-target profiles block on non-target evidence; structural budgets stay
 * valid everywhere), relative-baseline CI validity, and undeclared-profile
 * rejection — all settled through the T20 Gauntlet settlement bridge (no fork).
 */

import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseFrozenExpectation, type FrozenExpectation } from "../../src/gauntlet/expectation";
import { settleExpectation } from "../../src/gauntlet/settle";
import { EvidenceStore } from "../../src/evidence/store";
import { bindQualityProfile, loadQualityProfiles, type ResolvedQualityProfile } from "../../src/quality";
import type { ChannelEvidence, PerformanceChannelEvidence } from "@gauntlet/adapters";

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

function healthyEvidence(profile: string, rendererClass: "hardware" | "software" = "hardware"): PerformanceChannelEvidence {
  return {
    channel: "performance",
    quality_profile: profile,
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
      // T21 hardening: memory is now captured and gated by max_memory_mb
      // (declared by the `target` profile). Healthy evidence reports it.
      memory_used_mb: 48,
      memory_heap_limit_mb: 4096,
    },
    unreported: [],
    renderer_class: rendererClass,
    read_via: ["renderer.stats()", "renderer.probe()"],
  };
}

function regressedEvidence(profile: string): PerformanceChannelEvidence {
  // TEETH-T21-001 injection: frame-time/draw-call regression, reported through the
  // same stable seam, while pixels and semantic state are UNCHANGED.
  return {
    channel: "performance",
    quality_profile: profile,
    present: true,
    metrics: {
      fps_avg: 24,
      frame_time_ms: { avg: 40.2, p50: 38.5, p95: 56.05, p99: 58, samples: 40 },
      draw_calls: 36,
      triangles: 420,
      textures: 3,
      resources: 7,
      readiness_ms: 120,
      console_errors: 0,
    },
    unreported: [],
    renderer_class: "hardware",
    read_via: ["renderer.stats()", "renderer.probe()"],
  };
}

function averageOnlyEvidence(profile: string): PerformanceChannelEvidence {
  // TEETH-T21-002 attack: healthy AVERAGE only; declared percentiles not reported.
  return {
    channel: "performance",
    quality_profile: profile,
    present: true,
    metrics: { fps_avg: 60, draw_calls: 18, triangles: 420, textures: 3, readiness_ms: 120, console_errors: 0 },
    unreported: ["frame_time_ms.p50", "frame_time_ms.p95", "frame_time_ms.p99"],
    renderer_class: "hardware",
    read_via: ["renderer.stats()", "renderer.probe()"],
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

function settleFor(expectation: FrozenExpectation, perf: PerformanceChannelEvidence, profile: ResolvedQualityProfile) {
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
  const channels: ChannelEvidence[] = [
    ...(expectation.claims.state ? [statePassEvidence()] : []),
    ...(expectation.claims.pixels ? [pixelsPassEvidence()] : []),
    ...(expectation.claims.telemetry ? [telemetryPassEvidence()] : []),
    perf,
  ];
  return settleExpectation({
    expectation,
    run,
    manifests: [manifest],
    channels,
    availability: { browser_proof_available: true },
    currentRevision: REVISION,
    performance: { profile },
    now: NOW,
  });
}

describe("Healthy performance settles under the declared test-budget profile", () => {
  it("settles a fresh, correlated, in-budget performance observation", () => {
    const expectation = loadExpectation("performance-fixture");
    const outcome = settleFor(expectation, healthyEvidence("test-budget"), TEST_BUDGET);
    expect(outcome.decision).toBe("settled");
    const perfVerdict = outcome.channel_verdicts.find((v) => v.channel === "performance")!;
    expect(perfVerdict.pass).toBe(true);
    // Evidence identity carries browser, viewport, quality profile, scenario, revision.
    expect(expectation.performance?.profile).toBe("test-budget");
    expect(outcome.budget_error).toBeUndefined();
  });
});

describe("TEETH-T21-001: frame-time/draw-call regression with unchanged pixels and semantics", () => {
  const expectation = loadExpectation("performance-fixture-regress");
  const outcome = settleFor(expectation, regressedEvidence("test-budget"), TEST_BUDGET);

  it("fails performance verification and the requirement stays unsettled", () => {
    expect(outcome.decision).toBe("failed");
    expect(outcome.record?.decision).toBe("failed");
    expect(outcome.record?.decision).not.toBe("settled");
  });

  it("records budget_error against the declared profile (never warnings-only)", () => {
    expect(outcome.blockage_class).toBe("runtime_consequence_deficit");
    expect(outcome.budget_error?.code).toBe("budget_error");
    expect(outcome.budget_error?.quality_profile).toBe("test-budget");
    const budgets = outcome.budget_error?.violations.map((v) => v.budget) ?? [];
    expect(budgets).toContain("structural_budgets.max_draw_calls");
    expect(budgets).toContain("hardware_budgets.max_frame_time_p95_ms");
    expect(budgets).toContain("hardware_budgets.max_frame_time_p99_ms");
    expect(outcome.reason).toContain("budget_error");
  });

  it("records the performance contradiction: pixels/state pass, budget violated", () => {
    const stateV = outcome.channel_verdicts.find((v) => v.channel === "state")!;
    const pixelsV = outcome.channel_verdicts.find((v) => v.channel === "pixels")!;
    expect(stateV.pass).toBe(true);
    expect(pixelsV.pass).toBe(true);
    expect(outcome.contradictions.some((c) => c.startsWith("performance_contradiction"))).toBe(true);
  });

  it("the failed settlement record persists append-only through the T20 store", () => {
    expect(outcome.record).not.toBeNull();
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "t21-settlement-"));
    const store = new EvidenceStore({ projectRoot: workDir });
    store.beginRun({
      id: "run-t21-tooth1-append",
      project_revision: REVISION,
      scenario_id: expectation.scenario_id,
      environment: {},
      channels: ["performance"],
      timestamp: NOW,
    });
    const stored = store.appendSettlement("run-t21-tooth1-append", outcome.record!);
    expect(stored.decision).toBe("failed");
    expect(() => store.appendSettlement("run-t21-tooth1-append", outcome.record!)).toThrow(); // immutable
  });
});

describe("TEETH-T21-002: average-only reporting while declared percentiles are missing", () => {
  const expectation = loadExpectation("performance-fixture-avg-only");
  const outcome = settleFor(expectation, averageOnlyEvidence("test-budget"), TEST_BUDGET);

  it("fails the profile gate according to the declared metric rules", () => {
    expect(outcome.decision).toBe("failed");
    expect(outcome.record?.decision).not.toBe("settled");
    const perfFailed = outcome.channel_verdicts
      .find((v) => v.channel === "performance")!
      .checks.filter((c) => !c.pass)
      .map((c) => c.code);
    expect(perfFailed).toContain("PERF_METRIC_RULE_MISSING_PERCENTILE");
    expect(perfFailed).toContain("PERF_AVERAGE_ONLY_REPORTING");
    // The healthy average alone NEVER produces a passing performance channel.
    expect(outcome.channel_verdicts.find((v) => v.channel === "performance")!.pass).toBe(false);
  });
});

describe("Software-renderer guard: non-target evidence can never settle hardware targets (REQ-PERF-003)", () => {
  const expectation = loadExpectation("performance-fixture-swiftshader");

  it("blocks a hardware-target profile on SwiftShader-class evidence (never settled, never failed-as-budget)", () => {
    const outcome = settleFor(expectation, healthyEvidence("target", "software"), TARGET);
    expect(outcome.decision).toBe("blocked");
    expect(outcome.blockage_class).toBe("hardware_target_unavailable");
    expect(outcome.record?.decision).toBe("blocked");
    expect(outcome.reason).toContain("must not masquerade as target-hardware evidence");
    // Structural budgets remain fully enforceable and PASSED here.
    const structural = outcome.channel_verdicts
      .find((v) => v.channel === "performance")!
      .checks.filter((c) => c.code === "PERF_DRAW_CALLS" || c.code === "PERF_TRIANGLES" || c.code === "PERF_TEXTURES");
    expect(structural.length).toBeGreaterThan(0);
    expect(structural.every((c) => c.pass)).toBe(true);
  });

  it("unknown renderer class cannot satisfy a hardware-target binding either", () => {
    const outcome = settleFor(expectation, healthyEvidence("target", "unknown"), TARGET);
    expect(outcome.decision).toBe("blocked");
    expect(outcome.blockage_class).toBe("hardware_target_unavailable");
  });

  it("structural violations under software rendering still FAIL (valid evidence everywhere)", () => {
    // Draw calls 300 violate the TARGET profile's structural budget (max 200) even
    // though the hardware-sensitive metrics are healthy: structural budgets are
    // valid evidence in any environment, so the outcome is failed, not blocked.
    const structuralRegression = healthyEvidence("target", "software");
    structuralRegression.metrics.draw_calls = 300;
    const outcome = settleFor(expectation, structuralRegression, TARGET);
    expect(outcome.decision).toBe("failed");
    expect(outcome.budget_error?.violations.map((v) => v.budget)).toContain("structural_budgets.max_draw_calls");
    // A hardware-sensitive regression under software rendering fails as well.
    const hardwareRegression = settleFor(expectation, regressedEvidence("target"), TARGET);
    expect(hardwareRegression.decision).toBe("failed");
    expect(hardwareRegression.budget_error?.violations.map((v) => v.budget)).toContain(
      "hardware_budgets.max_frame_time_p99_ms"
    );
  });

  it("relative-baseline CI profiles stay valid under software rendering (explicitly labeled, never hardware claims)", () => {
    const outcome = settleFor(expectation, healthyEvidence("test-budget", "software"), TEST_BUDGET);
    expect(outcome.decision).toBe("settled"); // test-budget binds to declared fixture-relative baselines
  });
});

describe("Undeclared/unresolved profiles can never gate acceptance", () => {
  it("fails performance verification when no declared profile was resolved", () => {
    const expectation = loadExpectation("performance-fixture");
    const outcome = settleExpectation({
      expectation,
      run: {
        id: "run-perf-undeclared",
        project_revision: REVISION,
        scenario_id: expectation.scenario_id,
        environment: {},
        channels: [],
        timestamp: NOW,
      },
      manifests: [
        {
          id: "run-perf-undeclared-manifest-01",
          run_id: "run-perf-undeclared",
          project_revision: REVISION,
          requirement_ids: [...expectation.requirement_ids],
          artifacts: [{ path: "artifacts/performance-metrics.json", sha256: "c".repeat(64), role: "performance-metrics" }],
          result: "pass",
          created_at: NOW,
        },
      ],
      channels: [statePassEvidence(), pixelsPassEvidence(), telemetryPassEvidence(), healthyEvidence("test-budget")],
      availability: { browser_proof_available: true },
      currentRevision: REVISION,
      performance: null, // profile NOT resolved from the game project
      now: NOW,
    });
    expect(outcome.decision).toBe("failed");
    const perfFailed = outcome.channel_verdicts
      .find((v) => v.channel === "performance")!
      .checks.filter((c) => !c.pass)
      .map((c) => c.code);
    expect(perfFailed).toContain("PERF_PROFILE_UNRESOLVED");
    expect(outcome.record?.decision).not.toBe("settled");
  });

  it("reports incomplete (never passed) when the performance channel was simply not captured", () => {
    const expectation = loadExpectation("performance-fixture");
    const outcome = settleExpectation({
      expectation,
      run: {
        id: "run-perf-missing-channel",
        project_revision: REVISION,
        scenario_id: expectation.scenario_id,
        environment: {},
        channels: [],
        timestamp: NOW,
      },
      manifests: [
        {
          id: "run-perf-missing-channel-manifest-01",
          run_id: "run-perf-missing-channel",
          project_revision: REVISION,
          requirement_ids: [...expectation.requirement_ids],
          artifacts: [{ path: "artifacts/state-snapshot.json", sha256: "d".repeat(64), role: "state-snapshot" }],
          result: "pass",
          created_at: NOW,
        },
      ],
      channels: [statePassEvidence(), pixelsPassEvidence(), telemetryPassEvidence()],
      availability: { browser_proof_available: true },
      currentRevision: REVISION,
      performance: { profile: TEST_BUDGET },
      now: NOW,
    });
    expect(outcome.decision).toBe("incomplete");
    expect(outcome.blockage_class).toBe("evidence_channel_missing");
  });
});
