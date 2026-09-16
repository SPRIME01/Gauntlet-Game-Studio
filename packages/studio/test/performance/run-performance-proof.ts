#!/usr/bin/env bun
/**
 * T21 browser gate legs: end-to-end performance settlement against REAL system
 * Chrome (/usr/bin/google-chrome, headless by default, NO autoplay-policy bypass
 * flags), using the T20 harness and settlement bridge (no fork) and the game-project
 * quality profiles from examples/blackwater-relay/.agents/specs/game.spec.yaml.
 *
 * Legs (preregistered in .agents/preregistrations/gauntlet-game-studio-plan-T21.prereg.yaml):
 *   A. performance-fixture under the declared test-budget profile -> settled.
 *   B. TEETH-T21-001 end-to-end: performance-fixture-regress reports a deliberate
 *      frame-time (p95/p99) + draw-call regression through the stable renderer.stats()
 *      seam while its pixels are BYTE-IDENTICAL to leg A and semantic state unchanged
 *      -> performance verification FAILS (budget_error), requirement stays unsettled.
 *   C. TEETH-T21-002 end-to-end: performance-fixture-avg-only reports only a healthy
 *      average FPS with no frame-time percentiles -> profile gate fails per the
 *      declared metric rules.
 *   D. Software-renderer guard: performance-fixture-swiftshader under the hardware-
 *      target `target` profile -> blocked (hardware_target_unavailable, never
 *      settled/passed) while structural budgets stay enforceable; the same evidence
 *      under the relative-baseline test-budget profile settles, explicitly labeled.
 *   E. T21-HARDENING (confirmation advisory 1): performance-fixture-no-fps reports
 *      HEALTHY percentiles but omits fps_avg entirely — the exact T21-verifier
 *      vacating shape -> the profile gate now FAILS with PERF_METRIC_UNREPORTED
 *      (declared budgets imply report requirements), never silently passes.
 *
 * T21-HARDENING (confirmation advisory 2): the harness captures Chrome
 * `performance.memory` (usedJSHeapSize/jsHeapSizeLimit) through the page-evaluation
 * seam; leg A asserts the JS-heap memory fields are present in the captured
 * performance evidence.
 *
 * Exit codes: 0 = all preregistered legs behaved as specified; 1 = hard failure;
 * 2 = scoped environmental blockage (browser proof impossible here; documented,
 * never faked).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  PERFORMANCE_OK_SCENARIO_ID,
  PERFORMANCE_REGRESS_SCENARIO_ID,
  PERFORMANCE_AVG_ONLY_SCENARIO_ID,
  PERFORMANCE_SWIFTSHADER_SCENARIO_ID,
  PERFORMANCE_NO_FPS_SCENARIO_ID,
  buildFixtureScenario,
  runScenario,
  type ChannelEvidence,
  type PerformanceChannelEvidence,
  type PixelsChannelEvidence,
} from "@gauntlet/adapters";
import {
  EvidenceStore,
  resolveProjectRevision,
  bindQualityProfile,
  loadQualityProfiles,
  parseFrozenExpectation,
  settleExpectation,
  type FrozenExpectation,
  type ResolvedQualityProfile,
  type SettlementOutcome,
} from "@gauntlet/studio";

const REPO_ROOT = path.resolve(import.meta.dir, "..", "..", "..", "..");
const CHROME_PATH = "/usr/bin/google-chrome";
const GAME_SPEC = path.join(REPO_ROOT, "examples", "blackwater-relay", ".agents", "specs", "game.spec.yaml");
const EXPECTATIONS_DIR = path.join(REPO_ROOT, "packages", "studio", "test", "performance", "expectations");

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function block(message: string): never {
  console.error(`BLOCKED (scoped): ${message}`);
  process.exit(2);
}

function loadExpectation(id: string): FrozenExpectation {
  const file = path.join(EXPECTATIONS_DIR, `${id}.json`);
  if (!fs.existsSync(file)) fail(`frozen expectation file missing: ${file}`);
  return parseFrozenExpectation(JSON.parse(fs.readFileSync(file, "utf-8")));
}

function profile(id: string): ResolvedQualityProfile {
  return bindQualityProfile(loadQualityProfiles(GAME_SPEC), id);
}

function perfOf(channels: ChannelEvidence[]): PerformanceChannelEvidence {
  const e = channels.find((c) => c.channel === "performance") as PerformanceChannelEvidence | undefined;
  if (!e) fail("performance channel evidence missing from observation");
  return e;
}

function pixelsSha(channels: ChannelEvidence[]): string {
  const e = channels.find((c) => c.channel === "pixels") as PixelsChannelEvidence | undefined;
  if (!e || e.captures.length === 0) fail("pixels channel evidence missing from observation");
  return e.captures[0].sha256;
}

async function runGateLegs(): Promise<void> {
  console.log("=== T21 performance proof gate (system Chrome, deterministic) ===");
  if (!fs.existsSync(CHROME_PATH)) {
    block(
      `system Chrome not found at ${CHROME_PATH}; required browser proof is environmentally ` +
        "impossible on this host — scoped blockage, never a fake pass"
    );
  }
  const revision = resolveProjectRevision(REPO_ROOT);
  console.log(`project revision: ${revision}`);
  console.log(`quality profiles: ${GAME_SPEC} (game-project owned, REQ-CONFIG-005)`);
  const store = new EvidenceStore({ projectRoot: REPO_ROOT });
  fs.mkdirSync(path.join(REPO_ROOT, "artifacts", "runs"), { recursive: true });
  const headless = !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
  console.log(`mode: ${headless ? "headless" : "headed"}; no autoplay-policy bypass flags used`);

  const runOpts = (scenarioId: string, requirementIds: string[], profileId: string) => ({
    scenario: buildFixtureScenario(scenarioId, { seed: 1337, steps: 3, view: "main" }),
    projectRevision: revision,
    requirementIds,
    sink: store.createRunWriter(),
    chromeExecutablePath: CHROME_PATH,
    headless,
    timeoutMs: 45000,
    qualityProfile: profileId,
  });

  const settleFor = (
    expectation: FrozenExpectation,
    observed: Awaited<ReturnType<typeof runScenario>>,
    resolved: ResolvedQualityProfile
  ): SettlementOutcome => {
    if (!observed.run) fail("observation produced no run; cannot settle");
    return settleExpectation({
      expectation,
      run: JSON.parse(JSON.stringify(observed.run)),
      manifests: observed.manifest ? [JSON.parse(JSON.stringify(observed.manifest))] : [],
      channels: observed.channels ?? [],
      availability: { browser_proof_available: observed.status === "observed", unavailable_reason: observed.blockage?.message },
      currentRevision: revision,
      performance: { profile: resolved },
      now: observed.run.timestamp,
    });
  };

  // ---- Leg A: healthy performance fixture settles under test-budget ----
  const okExpectation = loadExpectation(PERFORMANCE_OK_SCENARIO_ID);
  const okObserved = await runScenario(
    runOpts(PERFORMANCE_OK_SCENARIO_ID, [...okExpectation.requirement_ids], "test-budget")
  );
  if (okObserved.status !== "observed") block(`leg A observation failed: ${JSON.stringify(okObserved.blockage)}`);
  const okPerf = perfOf(okObserved.channels);
  if (!okPerf.present) fail("leg A: performance evidence reported present:false");
  // T21-HARDENING (advisory finding 2): JS-heap memory capture must be wired. Real
  // Chrome exposes performance.memory; the captured evidence carries the memory
  // fields. Presence is asserted here (values are host-dependent, not deterministic).
  if (typeof okPerf.metrics.memory_used_mb !== "number" || !(okPerf.metrics.memory_used_mb > 0)) {
    fail(
      "leg A: memory_used_mb missing from captured performance evidence — Chrome " +
        "performance.memory capture is not wired through the page-evaluation seam"
    );
  }
  if (typeof okPerf.metrics.memory_heap_limit_mb !== "number") {
    fail("leg A: memory_heap_limit_mb missing from captured performance evidence");
  }
  console.log(
    `LEG A observed run ${okObserved.run!.id}; metrics: draw_calls=${okPerf.metrics.draw_calls} ` +
      `p95=${okPerf.metrics.frame_time_ms?.p95}ms p99=${okPerf.metrics.frame_time_ms?.p99}ms ` +
      `fps=${okPerf.metrics.fps_avg} renderer=${okPerf.renderer_class} ` +
      `memory_used_mb=${okPerf.metrics.memory_used_mb!.toFixed(1)} memory_heap_limit_mb=${okPerf.metrics.memory_heap_limit_mb!.toFixed(0)}`
  );
  const okSettlement = settleFor(okExpectation, okObserved, profile("test-budget"));
  if (okSettlement.decision !== "settled") {
    fail(`leg A expected 'settled', got '${okSettlement.decision}': ${okSettlement.reason}`);
  }
  store.appendSettlement(okObserved.run!.id, okSettlement.record!);
  console.log("LEG A PASS: healthy fixture settles under the declared test-budget profile");

  // ---- Leg B: TEETH-T21-001 end-to-end (regressed budget, identical pixels/semantics) ----
  const regressExpectation = loadExpectation(PERFORMANCE_REGRESS_SCENARIO_ID);
  const regressObserved = await runScenario(
    runOpts(PERFORMANCE_REGRESS_SCENARIO_ID, [...regressExpectation.requirement_ids], "test-budget")
  );
  if (regressObserved.status !== "observed") block(`leg B observation failed: ${JSON.stringify(regressObserved.blockage)}`);
  const regressPerf = perfOf(regressObserved.channels);
  const okSha = pixelsSha(okObserved.channels);
  const regressSha = pixelsSha(regressObserved.channels);
  const identical = okSha === regressSha;
  console.log(
    `LEG B pixels: regress capture sha256 ${regressSha.slice(0, 12)}… (byte-identical to healthy run: ${identical ? "yes" : "NO"})`
  );
  if (!identical) fail("TEETH-T21-001 precondition broken: regression fixture changed the rendered pixels");
  const regressSettlement = settleFor(regressExpectation, regressObserved, profile("test-budget"));
  if (regressSettlement.decision !== "failed") {
    fail(
      `TEETH-T21-001 BIT FAILED: overall verification was '${regressSettlement.decision}', must be 'failed' — ` +
        "a budget violation cannot be masked by unchanged pixels and semantics"
    );
  }
  if (regressSettlement.budget_error?.code !== "budget_error") {
    fail("TEETH-T21-001: settlement did not record budget_error against the declared profile");
  }
  const stateV = regressSettlement.channel_verdicts.find((v) => v.channel === "state");
  const pixelsV = regressSettlement.channel_verdicts.find((v) => v.channel === "pixels");
  if (!stateV?.pass || !pixelsV?.pass) {
    fail("TEETH-T21-001: state and pixels channels should PASS (only the budget regressed)");
  }
  if (!regressSettlement.contradictions.some((c) => c.startsWith("performance_contradiction"))) {
    fail("TEETH-T21-001: performance contradiction was not recorded");
  }
  store.appendSettlement(regressObserved.run!.id, regressSettlement.record!);
  console.log(
    `TEETH-T21-001 PASS: deliberate frame-time/draw-call regression with identical pixels and semantics -> ` +
      `'${regressSettlement.decision}' (budget_error: profile '${regressSettlement.budget_error.quality_profile}', ` +
      `${regressSettlement.budget_error.violations.length} violation(s)); requirement stays unsettled`
  );

  // ---- Leg C: TEETH-T21-002 end-to-end (average-only reporting) ----
  const avgExpectation = loadExpectation(PERFORMANCE_AVG_ONLY_SCENARIO_ID);
  const avgObserved = await runScenario(
    runOpts(PERFORMANCE_AVG_ONLY_SCENARIO_ID, [...avgExpectation.requirement_ids], "test-budget")
  );
  if (avgObserved.status !== "observed") block(`leg C observation failed: ${JSON.stringify(avgObserved.blockage)}`);
  const avgPerf = perfOf(avgObserved.channels);
  console.log(
    `LEG C metrics: fps_avg=${avgPerf.metrics.fps_avg} (healthy), frame_time percentiles unreported=${JSON.stringify(avgPerf.unreported)}`
  );
  const avgSettlement = settleFor(avgExpectation, avgObserved, profile("test-budget"));
  if (avgSettlement.decision !== "failed") {
    fail(`TEETH-T21-002 BIT FAILED: overall verification was '${avgSettlement.decision}', must be 'failed'`);
  }
  const perfFailedCodes = avgSettlement.channel_verdicts
    .find((v) => v.channel === "performance")!
    .checks.filter((c) => !c.pass)
    .map((c) => c.code);
  if (!perfFailedCodes.includes("PERF_METRIC_RULE_MISSING_PERCENTILE") || !perfFailedCodes.includes("PERF_AVERAGE_ONLY_REPORTING")) {
    fail(`TEETH-T21-002: profile gate did not fail per declared metric rules (codes: ${perfFailedCodes.join(", ")})`);
  }
  store.appendSettlement(avgObserved.run!.id, avgSettlement.record!);
  console.log(
    "TEETH-T21-002 PASS: average-only reporting (healthy fps_avg, missing declared percentiles) -> profile gate failed per declared metric rules"
  );

  // ---- Leg D: software-renderer guard (hardware-target blocked; relative baseline labeled) ----
  const swExpectation = loadExpectation(PERFORMANCE_SWIFTSHADER_SCENARIO_ID);
  const swObserved = await runScenario(
    runOpts(PERFORMANCE_SWIFTSHADER_SCENARIO_ID, [...swExpectation.requirement_ids], "target")
  );
  if (swObserved.status !== "observed") block(`leg D observation failed: ${JSON.stringify(swObserved.blockage)}`);
  const swPerf = perfOf(swObserved.channels);
  if (swPerf.renderer_class !== "software") {
    fail(`leg D: SwiftShader fixture identity must classify software, got '${swPerf.renderer_class}'`);
  }
  const swSettlement = settleFor(swExpectation, swObserved, profile("target"));
  if (swSettlement.decision !== "blocked" || swSettlement.blockage_class !== "hardware_target_unavailable") {
    fail(
      `software-renderer guard FAILED: hardware-target profile under SwiftShader must be 'blocked'/hardware_target_unavailable, ` +
        `got '${swSettlement.decision}'/${swSettlement.blockage_class}`
    );
  }
  store.appendSettlement(swObserved.run!.id, swSettlement.record!);
  console.log(
    "SOFTWARE GUARD PASS: hardware-target 'target' profile under SwiftShader-class evidence -> blocked, never settled/passed"
  );

  // The same healthy metrics under the relative-baseline CI profile settle — explicitly
  // labeled fixture-relative evidence, never a hardware claim.
  const swRelativeExpectation = loadExpectation(PERFORMANCE_SWIFTSHADER_SCENARIO_ID);
  const swRelative = settleFor(swRelativeExpectation, swObserved, profile("test-budget"));
  if (swRelative.decision !== "settled") {
    fail(`relative-baseline CI profile should settle on declared fixture-relative semantics, got '${swRelative.decision}'`);
  }
  console.log(
    "RELATIVE BASELINE PASS: test-budget profile (structural+relative-baseline) settles the same software-rendered evidence, explicitly NOT a hardware claim"
  );

  // ---- Leg E: T21-HARDENING end-to-end (fps_avg omitted entirely — the vacating shape) ----
  const noFpsExpectation = loadExpectation(PERFORMANCE_NO_FPS_SCENARIO_ID);
  const noFpsObserved = await runScenario(
    runOpts(PERFORMANCE_NO_FPS_SCENARIO_ID, [...noFpsExpectation.requirement_ids], "test-budget")
  );
  if (noFpsObserved.status !== "observed") block(`leg E observation failed: ${JSON.stringify(noFpsObserved.blockage)}`);
  const noFpsPerf = perfOf(noFpsObserved.channels);
  if (noFpsPerf.metrics.fps_avg !== undefined) {
    fail("leg E precondition broken: no-fps fixture must NOT report fps_avg");
  }
  console.log(
    `LEG E metrics: fps_avg UNREPORTED, percentiles p95=${noFpsPerf.metrics.frame_time_ms?.p95}ms ` +
      `p99=${noFpsPerf.metrics.frame_time_ms?.p99}ms (healthy) — the exact T21-verifier vacating shape`
  );
  const noFpsSettlement = settleFor(noFpsExpectation, noFpsObserved, profile("test-budget"));
  if (noFpsSettlement.decision !== "failed") {
    fail(
      `T21-HARDENING BIT FAILED: omitting fps_avg under a declared min_fps_avg budget evaluated as ` +
        `'${noFpsSettlement.decision}', must be 'failed' — a declared hardware budget implies a ` +
        "report requirement and can never be vacated by omission"
    );
  }
  const noFpsFailedCodes = noFpsSettlement.channel_verdicts
    .find((v) => v.channel === "performance")!
    .checks.filter((c) => !c.pass)
    .map((c) => c.code);
  if (!noFpsFailedCodes.includes("PERF_METRIC_UNREPORTED")) {
    fail(`T21-HARDENING: vacating scenario did not fail with PERF_METRIC_UNREPORTED (codes: ${noFpsFailedCodes.join(", ")})`);
  }
  store.appendSettlement(noFpsObserved.run!.id, noFpsSettlement.record!);
  console.log(
    "T21-HARDENING PASS: fps_avg omitted with healthy percentiles under test-budget -> failed with PERF_METRIC_UNREPORTED " +
      "(declared budgets imply report requirements; the prior silent pass cannot recur)"
  );

  console.log("SUCCESS: all T21 performance proof legs behaved as preregistered.");
}

runGateLegs().catch((err) => {
  fail(`unexpected runner error: ${err instanceof Error ? err.stack : String(err)}`);
});
