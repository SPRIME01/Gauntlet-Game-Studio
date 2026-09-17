#!/usr/bin/env bun
/**
 * T24 gate: conformance:recovery (settles VAR-001..VAR-014, RECOV-001..RECOV-008
 * applicable cases; preregistration:
 * .agents/preregistrations/gauntlet-game-studio-plan-T24.prereg.yaml).
 *
 * Executes the spec's declared variation/recovery cases fresh by orchestrating the
 * EXISTING settled gates (tests + studio CLI) rather than duplicating their logic:
 * for each case the declared trigger is exercised, the declared behavior observed,
 * and a structured record (case id, spec id, action, expected, observed, verdict)
 * appended to artifacts/plan/T24/recovery-cases.jsonl (append-only — failed and
 * corrected rounds are both preserved).
 *
 * Every child process runs with model-credential env vars removed (TEETH-T24-002):
 * required deterministic conformance must remain executable without credentials.
 *
 * Exit 0 only when every executed case verdicts PASS (DELEGATED rows point at
 * conformance:clean-checkout and never silently drop a case).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..");
const evidenceDir = path.join(repoRoot, "artifacts", "plan", "T24");
const jsonlPath = path.join(evidenceDir, "recovery-cases.jsonl");

const MODEL_CREDENTIAL_VARS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "HUGGINGFACE_API_KEY",
  "HF_TOKEN",
  "REPLICATE_API_TOKEN",
  "GOOGLE_AI_API_KEY",
  "STABILITY_API_KEY",
  "MESHY_API_KEY",
  "TRIPO_API_KEY",
];

const runId = `t24-recovery-${new Date().toISOString().replace(/[-:.]/g, "").replace("T", "T")}`;
fs.mkdirSync(evidenceDir, { recursive: true });

/** Child env: model credentials removed everywhere (TEETH-T24-002). */
function strippedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !MODEL_CREDENTIAL_VARS.includes(k)) env[k] = v;
  }
  return env;
}

interface ProcResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

async function run(
  cmd: string[],
  opts: { cwd?: string; timeoutMs?: number } = {}
): Promise<ProcResult> {
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd ?? repoRoot,
    env: strippedEnv(),
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, opts.timeoutMs ?? 300_000);
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  return { code, stdout, stderr, timedOut };
}

/** Runs `bun test <targets>` and returns pass/fail counts parsed from output. */
async function runBunTest(targets: string[], timeoutMs = 300_000): Promise<ProcResult> {
  return run(["bun", "test", ...targets], { timeoutMs });
}

function parseTestCounts(r: ProcResult): { pass: number; fail: number } {
  const all = r.stdout + r.stderr;
  const pass = Number(/(\d+) pass/.exec(all)?.[1] ?? "0");
  const fail = Number(/(\d+) fail/.exec(all)?.[1] ?? "0");
  return { pass, fail };
}

interface CaseRecord {
  type: "case";
  run_id: string;
  case: string;
  spec_ids: string[];
  action: string;
  expected: string;
  observed: string;
  verdict: "PASS" | "FAIL" | "DELEGATED";
  detail?: string;
}

const records: CaseRecord[] = [];

function record(r: Omit<CaseRecord, "type" | "run_id">): void {
  const full: CaseRecord = { type: "case", run_id: runId, ...r };
  records.push(full);
  console.log(
    `[${r.verdict}] ${r.case} (${r.spec_ids.join(",")})\n` +
      `    action:   ${r.action}\n` +
      `    expected: ${r.expected}\n` +
      `    observed: ${r.observed}`
  );
  if (r.detail) console.log(`    detail:   ${r.detail}`);
}

/** Memoized fresh executions so several case rows can share one run's evidence. */
const sharedRuns = new Map<string, Promise<ProcResult>>();
function runOnce(key: string, fn: () => Promise<ProcResult>): Promise<ProcResult> {
  if (!sharedRuns.has(key)) sharedRuns.set(key, fn());
  return sharedRuns.get(key)!;
}

/** Verify a shared bun-test run passed; returns observed text for the record. */
async function requireTestRun(
  key: string,
  targets: string[],
  timeoutMs?: number
): Promise<{ ok: boolean; observed: string; detail: string }> {
  const r = await runOnce(key, () => runBunTest(targets, timeoutMs));
  const counts = parseTestCounts(r);
  const ok = !r.timedOut && r.code === 0 && counts.fail === 0 && counts.pass > 0;
  return {
    ok,
    observed: `bun test ${targets.join(" ")} exit ${r.code}: ${counts.pass} pass / ${counts.fail} fail`,
    detail: ok ? "" : tail(r),
  };
}

function tail(r: ProcResult, lines = 6): string {
  return (r.stdout + "\n" + r.stderr).trim().split("\n").slice(-lines).join(" | ").slice(0, 600);
}

async function requireGate(
  key: string,
  cmd: string[],
  expect: { exitCode: number; includes: string[] },
  timeoutMs?: number
): Promise<{ ok: boolean; observed: string; detail: string }> {
  const r = await runOnce(key, () => run(cmd, { timeoutMs }));
  const output = r.stdout + r.stderr;
  const missing = expect.includes.filter((needle) => !output.includes(needle));
  const ok = !r.timedOut && r.code === expect.exitCode && missing.length === 0;
  const observed =
    `exit ${r.code} (expected ${expect.exitCode})` +
    (expect.includes.length > 0
      ? missing.length === 0
        ? `; all ${expect.includes.length} output assertions matched`
        : `; MISSING: ${missing.join(" | ")}`
      : "");
  return { ok, observed, detail: ok ? "" : tail(r) };
}

// ---------------------------------------------------------------------------
// VAR-005 inline router probe: provider selection is confined to the declared
// provider list of the routed capability; a preferred provider that is NOT
// declared is never selected merely because it was named/installed — the
// declared fallback is selected and recorded on the same capability contract.
// ---------------------------------------------------------------------------
async function routerFallbackProbe(): Promise<{ ok: boolean; observed: string; detail: string }> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "t24-var005-"));
  const probePath = path.join(dir, "probe.ts");
  await fs.promises.writeFile(
    probePath,
    `
import { routeCapability } from "${path.join(repoRoot, "packages", "studio", "src", "router", "router.ts")}";
import { defaultCapabilityRegistry } from "${path.join(repoRoot, "packages", "studio", "src", "capabilities", "registry.ts")}";
const cap = defaultCapabilityRegistry.get("audio.procedural");
if (!cap) throw new Error("audio.procedural missing from registry");
const mk = (pref?: string) => ({
  id: "req-t24-var005-" + Math.random().toString(36).slice(2, 8),
  project_id: "t24-conformance",
  capability_id: "audio.procedural",
  intent: "engine sound",
  acceptance: ["audio handle produced"],
  inputs: { audio_event_spec: "probe" },
  ...(pref ? { preferred_provider: pref } : {}),
});
const declared = cap.providers;
const viaDeclaredFallbackPref = routeCapability(mk("audio.null")).provider;   // declared fallback honored
const viaPrimaryPref = routeCapability(mk("audio.tone")).provider;            // declared primary honored
const unlistedNamed = routeCapability(mk("audio.not-installed")).provider;    // unlisted name ignored
const defaultSelection = routeCapability(mk()).provider;                      // deterministic first
console.log("PROBE:" + JSON.stringify({
  declared, viaDeclaredFallbackPref, viaPrimaryPref, unlistedNamed, defaultSelection,
}));
`,
    "utf-8"
  );
  const r = await run(["bun", "run", probePath], { timeoutMs: 60_000 });
  await fs.promises.rm(dir, { recursive: true, force: true });
  try {
    const line = r.stdout.split("\n").find((l) => l.startsWith("PROBE:"));
    if (!line) return { ok: false, observed: "probe produced no PROBE line", detail: tail(r) };
    const p = JSON.parse(line.slice("PROBE:".length)) as Record<string, unknown>;
    const declared = p.declared as string[];
    const checks: Array<[string, boolean]> = [
      ["declared providers recorded", Array.isArray(declared) && declared.length >= 2],
      ["declared fallback selection recorded", p.viaDeclaredFallbackPref === "audio.null"],
      ["declared primary selection recorded", p.viaPrimaryPref === "audio.tone"],
      [
        "undeclared provider name never selected (REQ-ROUTE-005)",
        p.unlistedNamed === "audio.tone" && !declared.includes("audio.not-installed"),
      ],
      ["deterministic default selection recorded", p.defaultSelection === declared[0]],
    ];
    const failed = checks.filter(([, ok]) => !ok).map(([n]) => n);
    return {
      ok: failed.length === 0,
      observed:
        `router recorded selections ${JSON.stringify({
          declared,
          fallback_pref: p.viaDeclaredFallbackPref,
          unlisted_pref_ignored: p.unlistedNamed,
        })}` + (failed.length > 0 ? `; failed: ${failed.join("; ")}` : ""),
      detail: failed.length > 0 ? tail(r) : "",
    };
  } catch (err) {
    return { ok: false, observed: "probe threw", detail: `${err} :: ${tail(r)}` };
  }
}

// ---------------------------------------------------------------------------
// Matrix
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  console.log(`=== T24 conformance:recovery (run ${runId}) ===`);
  console.log(
    `model credentials stripped from all child env: ${MODEL_CREDENTIAL_VARS.join(", ")}`
  );
  const header = { type: "run" as const, run_id: runId, started: new Date().toISOString() };
  fs.appendFileSync(jsonlPath, JSON.stringify(header) + "\n");

  // RECOV-005 — Rapier/Recast init delayed/failed: readiness barrier never reports
  // ready; scenario start fails explicitly; no WASM race.
  {
    const res = await requireTestRun("readiness", ["packages/runtime/test/readiness.test.ts"]);
    record({
      case: "RECOV-005",
      spec_ids: ["RECOV-005", "failure_model:readiness_failure"],
      action: "Register required physics/navigation subsystems; hold one in booting, then fail it (delayed/failed Rapier+Recast init).",
      expected: "Runtime readiness does not report ready; startScenario fails (RuntimeNotReadyError) while booting and after failure; awaitReady rejects (SubsystemBootError) rather than racing WASM.",
      observed: res.observed,
      verdict: res.ok ? "PASS" : "FAIL",
      detail: res.detail,
    });
  }

  // RECOV-001 + RECOV-002 — T14 teeth (missing reference blocks; duplicate Three.js fails preflight).
  {
    const res = await requireTestRun("t14-teeth", [
      "packages/studio/test/capabilities/teeth.test.ts",
    ]);
    record({
      case: "RECOV-001",
      spec_ids: ["RECOV-001", "failure_model:evidence_failure"],
      action: "Request faithful reconstruction with the reference image removed (TEETH-T14-001).",
      expected: "Typed blocked (REFERENCE_REQUIRED) asking for an allowed reference; never silently reinterpreted as generic text-to-3D (route_preserved, degraded_to_generic_text_to_3d false).",
      observed: res.observed,
      verdict: res.ok ? "PASS" : "FAIL",
      detail: res.detail,
    });
    record({
      case: "RECOV-002",
      spec_ids: ["RECOV-002", "failure_model:integration_failure"],
      action: "Forge a second distinct Three.js installation and run the compatibility guard (TEETH-T14-003).",
      expected: "Preflight fails with MULTIPLE_THREE_INSTALLATIONS; the runtime never resolves multiple hidden Three.js instances.",
      observed: res.observed,
      verdict: res.ok ? "PASS" : "FAIL",
      detail: res.detail,
    });
  }

  // RECOV-004 — required browser verification unavailable → typed blocked, never passed.
  {
    const res = await requireTestRun("proof-tests", ["packages/studio/test/proof"]);
    record({
      case: "RECOV-004",
      spec_ids: ["RECOV-004", "REQ-SAFE-002"],
      action: "Inject Playwright-unavailable into the proof harness and settlement path (TEETH-T20-003 simulation seam).",
      expected: "Typed PLAYWRIGHT_UNAVAILABLE blockage recorded; settlement decision blocked (exit semantics 2=blocked can never read as passed); static inspection is not substituted.",
      observed: res.observed,
      verdict: res.ok ? "PASS" : "FAIL",
      detail: res.detail,
    });
  }

  // Stale evidence rejected (T20 machinery): identity-based freshness + immutability.
  {
    const res = await requireGate(
      "check-fixtures",
      ["bun", "run", "studio", "--", "evidence", "check-fixtures", "--json"],
      { exitCode: 0, includes: ['"status": "success"'] }
    );
    record({
      case: "stale-evidence-rejected",
      spec_ids: ["failure_model:evidence_failure", "T20-immutability"],
      action: "Re-validate committed evidence fixtures including the stale-revision negative control that MUST reject.",
      expected: "Foreign-revision manifest rejected via identity-based staleness; schemas/correlation/hashes verified; check exits 0 only because the negative control rejects as declared.",
      observed: res.observed,
      verdict: res.ok ? "PASS" : "FAIL",
      detail: res.detail,
    });
  }

  // RECOV-003 — over-budget asset remains unaccepted; unknown license blocks acceptance.
  {
    const tests = await requireTestRun("assets", ["packages/studio/test/assets"]);
    const verify = await requireGate(
      "asset-verify",
      [
        "bun",
        "run",
        "studio",
        "--",
        "asset",
        "verify",
        "--all",
        "--project",
        "examples/blackwater-relay",
        "--json",
      ],
      { exitCode: 0, includes: ['"status": "success"'] }
    );
    const ok = tests.ok && verify.ok;
    record({
      case: "RECOV-003",
      spec_ids: ["RECOV-003", "failure_model:provenance_failure"],
      action: "Evaluate an asset exceeding its declared runtime budget and an asset with unknown/unacceptable license (TEETH-T13-001/002); verify all accepted committed assets.",
      expected: "Over-budget asset stays unaccepted while correction is bounded (explicit waiver yields degraded, never silent acceptance); unknown provenance blocks production acceptance; committed accepted assets verify green.",
      observed: `${tests.observed}; asset verify --all: ${verify.observed}`,
      verdict: ok ? "PASS" : "FAIL",
      detail: [tests.detail, verify.detail].filter(Boolean).join(" :: "),
    });
  }

  // RECOV-008 — donor architecture conflicting with Koota authority is rejected.
  {
    const tests = await requireTestRun("donor-isolation", [
      "packages/runtime/test/donor-isolation.test.ts",
    ]);
    const audit = await requireGate("donor-audit", ["bun", "run", "donor:audit"], {
      exitCode: 0,
      includes: ["SUCCESS: Mavon donor audit completed with 0 errors."],
    });
    const ok = tests.ok && audit.ok;
    record({
      case: "RECOV-008",
      spec_ids: ["RECOV-008", "REQ-DONOR-002"],
      action: "Feed donor GameObject/BaseWorld/Actor-style semantic payloads to the Gauntlet semantic authority (assertValidSemanticData) and run the donor audit.",
      expected: "Only transplanted mechanisms survive; conflicting donor entity/world architecture is rejected rather than preserved for convenience; attribution/provenance intact.",
      observed: `${tests.observed}; donor:audit: ${audit.observed}`,
      verdict: ok ? "PASS" : "FAIL",
      detail: [tests.detail, audit.detail].filter(Boolean).join(" :: "),
    });
  }

  // VAR-005 — provider unavailability/fallback recorded on the same contract.
  {
    const probe = await routerFallbackProbe();
    const audio = await requireTestRun("audio-headless", [
      "packages/runtime/test/audio-headless.test.ts",
    ]);
    const ok = probe.ok && audio.ok;
    record({
      case: "VAR-005",
      spec_ids: ["VAR-005", "REQ-ROUTE-005", "REQ-ROUTE-006"],
      action: "Route audio.procedural with (a) declared fallback provider preferred, (b) an undeclared provider name preferred, (c) no preference; run the headless audio backend fallback (Tone unavailable headless → Null backend).",
      expected: "Fallback selection explicitly recorded from the DECLARED provider list only (never the unlisted name); same normalized capability contract; headless null fallback recorded and counted, no silent degradation.",
      observed: `${probe.observed}; ${audio.observed}`,
      verdict: ok ? "PASS" : "FAIL",
      detail: [probe.detail, audio.detail].filter(Boolean).join(" :: "),
    });
  }

  // VAR-001 — reference-image reconstruction routes to img2threejs, provenance preserved,
  // settles only after evidence passes.
  {
    const res = await requireTestRun("var001-img2threejs", [
      "packages/studio/test/capabilities/img2threejs.test.ts",
    ]);
    record({
      case: "VAR-001",
      spec_ids: ["VAR-001", "REQ-ROUTE-004"],
      action: "Run the reference-image reconstruction capability suite (routing to img2threejs, reference provenance capture, settle-after-evidence).",
      expected: "Routes to agent-skill.img2threejs, preserves reference-only provenance, integrates through the authoritative Three.js owner, settles only after evidence passes.",
      observed: res.observed,
      verdict: res.ok ? "PASS" : "FAIL",
      detail: res.detail,
    });
  }

  // VAR-002 — composition + terrain + navigation routing and verification.
  {
    const viz = await requireTestRun("var002-3dviz", [
      "packages/studio/test/capabilities/3dviz-world-compose.test.ts",
    ]);
    const nav = await requireTestRun("var002-nav", ["packages/runtime/test/navigation.test.ts"]);
    const ok = viz.ok && nav.ok;
    record({
      case: "VAR-002",
      spec_ids: ["VAR-002"],
      action: "Run the 3dviz world-composition suite (scene routed to 3dviz, terrain authority preserved) and the Recast navigation suite (traversal consequences verified).",
      expected: "Scene composition routes to 3dviz; terrain stays canonical; navigation verified through Recast projections with traversal/runtime consequence checks.",
      observed: `${viz.observed}; ${nav.observed}`,
      verdict: ok ? "PASS" : "FAIL",
      detail: [viz.detail, nav.detail].filter(Boolean).join(" :: "),
    });
  }

  // VAR-009 — asymmetric terrain fixture parity with deliberate defect detection
  // (shared fresh run with VAR-002's terrain leg).
  {
    const res = await requireTestRun("var002-terrain", [
      "packages/runtime/test/terrain-parity.test.ts",
    ]);
    record({
      case: "VAR-009",
      spec_ids: ["VAR-009"],
      action: "Project the asymmetric terrain heightfield fixture to Three.js, Rapier, and Recast; inject deliberate transpose/axis/scale defects.",
      expected: "Sampled world positions agree across projections; every deliberate defect is detected.",
      observed: res.observed,
      verdict: res.ok ? "PASS" : "FAIL",
      detail: res.detail,
    });
  }

  // VAR-003 — known CC0 asset reused with provenance + budgets (not regenerated).
  {
    const res = await requireTestRun("var003-polyhaven", [
      "packages/studio/test/assets/polyhaven.test.ts",
    ]);
    record({
      case: "VAR-003",
      spec_ids: ["VAR-003", "REQ-ASSET-003"],
      action: "Intake a known Poly Haven CC0 asset through the sourcing adapter and hand it to the acceptance registry.",
      expected: "Asset is sourced/reused with full provenance capture (never image reconstruction or opaque generation), normalized, and checked against budgets.",
      observed: res.observed,
      verdict: res.ok ? "PASS" : "FAIL",
      detail: res.detail,
    });
  }

  // VAR-004 — Blender escalation with recorded rationale; semantics stay outside Blender.
  {
    const res = await requireTestRun("var004-blender", [
      "packages/studio/test/capabilities/blender-process.test.ts",
    ]);
    record({
      case: "VAR-004",
      spec_ids: ["VAR-004", "REQ-BLENDER-001"],
      action: "Run the dcc.blender.process escalation suite (escalation rationale, derived runtime asset through the accepted handoff).",
      expected: "Escalation rationale recorded; derived asset returned through the accepted handoff; game semantics never owned by Blender.",
      observed: res.observed,
      verdict: res.ok ? "PASS" : "FAIL",
      detail: res.detail,
    });
  }

  // VAR-008 — accepted agent-skill output verifies with credentials removed; no regeneration.
  {
    const res = await requireGate(
      "var008-verify-result",
      [
        "bun",
        "run",
        "studio",
        "--",
        "capability",
        "verify-result",
        "asset.reconstruct.reference-image",
        "examples/blackwater-relay/.studio/results/transceiver.yaml",
        "--json",
      ],
      { exitCode: 0, includes: ['"status": "success"'] }
    );
    record({
      case: "VAR-008",
      spec_ids: ["VAR-008", "TEETH-T14-002"],
      action: "Run the full deterministic verification of the accepted committed agent-skill output in a subprocess with all 9 model-credential env vars deleted.",
      expected: "Verification succeeds solely from committed artifact/runtime evidence (13 checks); CI does not attempt regeneration; model_invocation none, network_access none.",
      observed: res.observed,
      verdict: res.ok ? "PASS" : "FAIL",
      detail: res.detail,
    });
  }

  // VAR-010 — single-player runs with networking disabled.
  {
    const teeth = await requireGate(
      "var010-network-disabled",
      [
        "bun",
        "run",
        "--cwd",
        "examples/blackwater-relay",
        "teeth:network-disabled",
      ],
      { exitCode: 0, includes: [] },
      300_000
    );
    const tests = await requireTestRun("var010-single-player", [
      "packages/runtime/test/network/single-player.test.ts",
    ]);
    const ok = teeth.ok && tests.ok;
    record({
      case: "VAR-010",
      spec_ids: ["VAR-010", "REQ-RUNTIME-009"],
      action: "Run the game with networking disabled end-to-end (teeth:network-disabled) and the network-free single-player suite.",
      expected: "No server/transport constructed or required; all non-network behavior remains valid; network surface reports not_registered.",
      observed: `teeth:network-disabled exit ${teeth.ok ? 0 : "nonzero"}; ${tests.observed}`,
      verdict: ok ? "PASS" : "FAIL",
      detail: [teeth.detail, tests.detail].filter(Boolean).join(" :: "),
    });
  }

  // RECOV-006 — Blender absent: normal build green; only scoped regeneration blockage.
  {
    const res = await requireGate(
      "recov006-blender-absent",
      ["bun", "run", "test:blender-absent-build"],
      { exitCode: 0, includes: ["BLENDER_ABSENT_BUILD_OK"] },
      600_000
    );
    record({
      case: "RECOV-006",
      spec_ids: ["RECOV-006", "REQ-BLENDER-006", "REQ-BLENDER-007"],
      action: "Strip every blender executable from PATH and run legs A-D: game tests, game build, typed BLENDER_UNAVAILABLE regeneration blockage + offline verification of the committed derivative, donor isolation.",
      expected: "Committed accepted Blender-derived assets remain usable; normal build/test green; only live Blender regeneration/proof is blocked, typed and scoped.",
      observed: res.observed,
      verdict: res.ok ? "PASS" : "FAIL",
      detail: res.detail,
    });
  }

  // VAR-006 — pixels pass while semantic state wrong: semantic channel fails, unsettled.
  {
    const res = await requireGate(
      "var006-wrong-state",
      ["bun", "run", "studio", "--", "verify", "fixture-wrong-state", "--json"],
      { exitCode: 1, includes: ['"decision": "failed"', "pixels_pass_state_fail"] },
      480_000
    );
    record({
      case: "VAR-006",
      spec_ids: ["VAR-006", "REQ-GAUNTLET-004"],
      action: "Verify the contradictory fixture: pixels visually correct (byte-identical to the ok variant) while the authoritative semantic state is intentionally wrong.",
      expected: "Pixel channel passes, semantic channel fails, decision failed with pixels_pass_state_fail contradiction; requirement remains unsettled (exit 1).",
      observed: res.observed,
      verdict: res.ok ? "PASS" : "FAIL",
      detail: res.detail,
    });
  }

  // VAR-007 — semantic+visual pass, degraded frame performance: telemetry channel fails.
  {
    const res = await requireGate(
      "var007-budget-regress",
      [
        "bun",
        "run",
        "studio",
        "--",
        "verify",
        "--scenario",
        "performance-fixture-regress",
        "--profile",
        "test-budget",
        "--json",
      ],
      { exitCode: 1, includes: ['"decision": "failed"', "budget_error"] },
      480_000
    );
    record({
      case: "VAR-007",
      spec_ids: ["VAR-007", "REQ-PERF-004"],
      action: "Verify the deliberate frame-performance/draw-call regression fixture under the declared test-budget profile.",
      expected: "Telemetry/performance channel fails with budget_error and performance_contradiction; state+pixels success cannot settle the requirement (exit 1).",
      observed: res.observed,
      verdict: res.ok ? "PASS" : "FAIL",
      detail: res.detail,
    });
  }

  // VAR-014 — browser audio starts locked; real gesture unlocks; headless stays independent.
  {
    const browser = await requireGate(
      "var014-audio-browser",
      ["bun", "run", "test:audio-browser"],
      { exitCode: 0, includes: [] },
      480_000
    );
    const headless = await requireTestRun("audio-headless", [
      "packages/runtime/test/audio-headless.test.ts",
    ]);
    const ok = browser.ok && headless.ok;
    record({
      case: "VAR-014",
      spec_ids: ["VAR-014", "REQ-AUDIO-001", "REQ-AUDIO-002", "REQ-SAFE-007"],
      action: "Start real Chrome audio locked; first attack unlock WITHOUT a gesture over raw CDP, then unlock inside a real trusted click.",
      expected: "Un-gestured unlock stays explicitly locked/suspended (no autoplay-policy bypass); real gesture transitions audio to ready; headless pure-logic tests remain browser-audio independent and unavailable audio never crashes unrelated game logic.",
      observed: `test:audio-browser exit ${browser.ok ? 0 : "nonzero"}; ${headless.observed}`,
      verdict: ok ? "PASS" : "FAIL",
      detail: [browser.detail, headless.detail].filter(Boolean).join(" :: "),
    });
  }

  // VAR-011 / VAR-012 / RECOV-007 — two-client authoritative multiplayer:
  // nominal sync, interest filtering, latency/jitter impairment, mid-scenario
  // disconnect (browser suite) + the raw falsification teeth (non-browser).
  {
    const suite = await requireGate(
      "multiplayer-suite",
      [
        "bun",
        "run",
        "--cwd",
        "examples/blackwater-relay",
        "test:blackwater-multiplayer",
      ],
      {
        exitCode: 0,
        includes: [
          "[multiplayer] multiplayer-sync: SETTLED",
          "[multiplayer] interest-filtering: SETTLED",
          "[multiplayer] multiplayer-latency: SETTLED",
        ],
      },
      600_000
    );
    record({
      case: "VAR-011",
      spec_ids: ["VAR-011", "REQ-NET-008"],
      action: "Connect two local browser clients to the authoritative headless server under nominal latency and run sequenced commands.",
      expected: "Sequenced commands produce authoritative Koota consequence; clients reconcile the authoritative projection without client authority; multiplayer-sync scenario settles.",
      observed: suite.observed,
      verdict: suite.ok ? "PASS" : "FAIL",
      detail: suite.detail,
    });
    record({
      case: "VAR-012",
      spec_ids: ["VAR-012", "REQ-NET-006"],
      action: "Repeat the sync window under configured latency/jitter impairment (multiplayer-latency scenario).",
      expected: "Connection/command telemetry exposes the impairment and bounded reconciliation preserves declared game invariants; scenario settles.",
      observed: suite.observed,
      verdict: suite.ok ? "PASS" : "FAIL",
      detail: suite.detail,
    });
    const teeth = await requireGate(
      "multiplayer-teeth",
      ["bun", "run", "--cwd", "examples/blackwater-relay", "teeth:multiplayer"],
      { exitCode: 0, includes: [] },
      600_000
    );
    record({
      case: "RECOV-007",
      spec_ids: ["RECOV-007", "REQ-NET-009", "REQ-SAFE-006"],
      action: "Disconnect the authoritative transport mid-scenario (suite disconnect phase) and run the raw falsification teeth (forged state, reorder under impairment, server-side drop + bounded reconnect).",
      expected: "Disconnect becomes an explicit observable state with bounded recovery; semantic authority remains server/Koota-owned; the client never becomes silent semantic authority.",
      observed: `teeth:multiplayer exit ${teeth.ok ? 0 : "nonzero"}; multiplayer-sync disconnect phase settled in suite (${suite.ok ? "suite exit 0" : "suite failed"})`,
      verdict: teeth.ok && suite.ok ? "PASS" : "FAIL",
      detail: [teeth.detail, suite.detail].filter(Boolean).join(" :: "),
    });
  }

  // VAR-013 — donor deleted / absent: executed by conformance:clean-checkout.
  record({
    case: "VAR-013",
    spec_ids: ["VAR-013", "REQ-DONOR-004", "REQ-SAFE-005"],
    action: "Build/test/verify the committed repository with .tmp/donor deleted entirely (executed by the conformance:clean-checkout gate: fresh /tmp clone where donor never exists + explicit rm -rf + full committed gate set green).",
    expected: "No build/runtime/test/proof path depends on donor files or donor identity.",
    observed:
      "DELEGATED to conformance:clean-checkout (fresh clean checkout without .tmp/; see artifacts/plan/T24/clean-checkout.jsonl and gate evidence)",
    verdict: "DELEGATED",
  });

  // ---------------------------------------------------------------------------
  // Summary + append-only persistence
  // ---------------------------------------------------------------------------
  const pass = records.filter((r) => r.verdict === "PASS").length;
  const fail = records.filter((r) => r.verdict === "FAIL").length;
  const delegated = records.filter((r) => r.verdict === "DELEGATED").length;
  for (const r of records) fs.appendFileSync(jsonlPath, JSON.stringify(r) + "\n");
  fs.appendFileSync(
    jsonlPath,
    JSON.stringify({
      type: "summary",
      run_id: runId,
      finished: new Date().toISOString(),
      pass,
      fail,
      delegated,
    }) + "\n"
  );

  console.log(`\n=== recovery matrix summary: ${pass} PASS / ${fail} FAIL / ${delegated} DELEGATED ===`);
  console.log(fail === 0 ? "RECOVERY_MATRIX_OK" : "RECOVERY_MATRIX_FAILED");
  return fail === 0 ? 0 : 1;
}

process.exitCode = await main();
