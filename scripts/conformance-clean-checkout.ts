#!/usr/bin/env bun
/**
 * T24 gate: conformance:clean-checkout (REQ-DONOR-004, REQ-SAFE-005, VAR-008,
 * VAR-013, TEETH-T24-001, TEETH-T24-002; preregistration:
 * .agents/preregistrations/gauntlet-game-studio-plan-T24.prereg.yaml).
 *
 * Proves the COMMITTED repository builds, tests, lints, verifies, and runs the
 * reference game deterministically from a fresh checkout in which .tmp/donor
 * genuinely does not exist — with model credentials removed from every child
 * environment.
 *
 * Legs:
 *   0. Clone committed HEAD into a fresh temp directory OUTSIDE the repository
 *      (os.tmpdir(), never under repo .tmp/). A clone of tracked state cannot
 *      contain .tmp/donor — a strictly stronger state than delete-then-run.
 *   1. Assert .tmp/donor absent; execute the TEETH-T24-001 attack explicitly
 *      (`rm -rf .tmp/donor`, idempotent) and re-assert absence.
 *   2. bun install from the committed lockfile (TEETH-T24-002 env).
 *   3. Committed gate set in the checkout: just check / just test / just lint /
 *      just validate-agent-artifacts.
 *   4. studio doctor --json (status success) inside the checkout.
 *   5. Donor independence scans inside the checkout: donor:audit (absent-donor
 *      path) + donor:dependency-scan (exit 0).
 *   6. Reference game: bun run --cwd examples/blackwater-relay build, then the
 *      deterministic headless scenario verification (project `bun test`).
 *      Browser e2e legs are NOT executed inside the clean checkout (task scope:
 *      deterministic headless path); fresh real-browser proof for the same
 *      content executes in conformance:recovery (multiplayer + fixture legs).
 *      This choice is RECORDED here — never silent.
 *   7. Final donor-absence assertion.
 *
 * Per-leg structured records append to artifacts/plan/T24/clean-checkout.jsonl.
 * The checkout directory is removed on success and PRESERVED on failure for
 * diagnosis. Exit 0 only when every leg verdicts PASS.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..");
const evidenceDir = path.join(repoRoot, "artifacts", "plan", "T24");
const jsonlPath = path.join(evidenceDir, "clean-checkout.jsonl");

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

const runId = `t24-clean-${new Date().toISOString().replace(/[-:.]/g, "")}`;
fs.mkdirSync(evidenceDir, { recursive: true });

function strippedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !MODEL_CREDENTIAL_VARS.includes(k)) env[k] = v;
  }
  return env;
}

async function run(cmd: string[], opts: { cwd: string; timeoutMs: number }) {
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd,
    env: strippedEnv(),
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, opts.timeoutMs);
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  return { code, stdout, stderr, timedOut };
}

function tail(r: { stdout: string; stderr: string }, lines = 8): string {
  return (r.stdout + "\n" + r.stderr).trim().split("\n").slice(-lines).join(" | ").slice(0, 800);
}

interface LegRecord {
  type: "leg";
  run_id: string;
  leg: string;
  action: string;
  expected: string;
  observed: string;
  verdict: "PASS" | "FAIL";
  detail?: string;
}

const records: LegRecord[] = [];
function record(r: Omit<LegRecord, "type" | "run_id">): void {
  records.push({ type: "leg", run_id: runId, ...r });
  console.log(
    `[${r.verdict}] ${r.leg}\n    observed: ${r.observed}` + (r.detail ? `\n    detail: ${r.detail}` : "")
  );
}

function donorAbsent(dir: string): boolean {
  return !fs.existsSync(path.join(dir, ".tmp", "donor"));
}

async function main(): Promise<number> {
  console.log(`=== T24 conformance:clean-checkout (run ${runId}) ===`);
  console.log(`model credentials stripped from all child env: ${MODEL_CREDENTIAL_VARS.join(", ")}`);
  fs.appendFileSync(jsonlPath, JSON.stringify({ type: "run", run_id: runId, started: new Date().toISOString() }) + "\n");

  const checkout = path.join(os.tmpdir(), `gauntlet-t24-clean-${Date.now()}`);
  let ok = true;

  // Leg 0: fresh clone of committed HEAD outside the repository.
  {
    const clone = await run(["git", "clone", "--no-hardlinks", "--quiet", repoRoot, checkout], {
      cwd: repoRoot,
      timeoutMs: 300_000,
    });
    const cloned = fs.existsSync(path.join(checkout, "package.json"));
    const legOk = clone.code === 0 && cloned;
    record({
      leg: "LEG-0: fresh clone of committed HEAD outside the repository",
      action: `git clone --no-hardlinks ${repoRoot} -> ${checkout} (os.tmpdir(); never under repo .tmp/).`,
      expected: "Clone contains exactly the committed tracked state; no untracked/gitignored content (in particular no .tmp/).",
      observed: legOk ? `clone created at ${checkout} (removed after the gate; kept only on failure)` : `clone failed: ${tail(clone)}`,
      verdict: legOk ? "PASS" : "FAIL",
      detail: legOk ? "" : tail(clone),
    });
    ok = ok && legOk;
  }

  // Leg 1: donor absence + explicit deletion attack (TEETH-T24-001).
  {
    const absentFromStart = donorAbsent(checkout);
    fs.rmSync(path.join(checkout, ".tmp", "donor"), { recursive: true, force: true });
    const absentAfterDelete = donorAbsent(checkout);
    const legOk = absentFromStart && absentAfterDelete;
    record({
      leg: "LEG-1: TEETH-T24-001 — .tmp/donor deleted entirely in the clean checkout",
      action: "Assert .tmp/donor absent in the fresh clone, then execute rm -rf .tmp/donor explicitly and re-assert.",
      expected: "The donor directory genuinely does not exist at any point of the clean checkout's life (absence-from-clone is strictly stronger than delete-then-run); deletion is tolerated harmlessly.",
      observed: `donor absent from clone: ${absentFromStart}; after explicit rm -rf: ${absentAfterDelete}`,
      verdict: legOk ? "PASS" : "FAIL",
    });
    ok = ok && legOk;
  }

  // Leg 2: install from the committed lockfile (credential-stripped env).
  {
    const r = await run(["bun", "install", "--frozen-lockfile"], { cwd: checkout, timeoutMs: 600_000 });
    const legOk = !r.timedOut && r.code === 0;
    record({
      leg: "LEG-2: bun install --frozen-lockfile (TEETH-T24-002 env)",
      action: "Install the exact committed dependency graph with all model-credential env vars deleted.",
      expected: "Deterministic install from the lockfile succeeds without credentials.",
      observed: legOk ? `exit 0` : `exit ${r.code}${r.timedOut ? " (timed out)" : ""}`,
      verdict: legOk ? "PASS" : "FAIL",
      detail: legOk ? "" : tail(r),
    });
    ok = ok && legOk;
  }

  // Leg 3: the committed gate set.
  for (const gate of [
    { name: "just validate-agent-artifacts", cmd: ["just", "validate-agent-artifacts"], timeout: 300_000 },
    { name: "just check", cmd: ["just", "check"], timeout: 600_000 },
    { name: "just test", cmd: ["just", "test"], timeout: 900_000 },
    { name: "just lint", cmd: ["just", "lint"], timeout: 300_000 },
  ]) {
    const r = await run(gate.cmd, { cwd: checkout, timeoutMs: gate.timeout });
    const legOk = !r.timedOut && r.code === 0;
    record({
      leg: `LEG-3: ${gate.name} (in the clean checkout)`,
      action: `Run the repository-native committed gate in the donor-absent checkout.`,
      expected: "Committed first-party code checks/tests/lints/validates green with .tmp/donor completely absent (REQ-DONOR-004, REQ-SAFE-005).",
      observed: legOk ? "exit 0" : `exit ${r.code}${r.timedOut ? " (timed out)" : ""}`,
      verdict: legOk ? "PASS" : "FAIL",
      detail: legOk ? "" : tail(r),
    });
    ok = ok && legOk;
  }

  // Leg 4: studio doctor inside the checkout.
  {
    const r = await run(["bun", "run", "studio", "--", "doctor", "--json"], {
      cwd: checkout,
      timeoutMs: 180_000,
    });
    const legOk = !r.timedOut && r.code === 0 && r.stdout.includes('"status": "success"');
    record({
      leg: "LEG-4: studio doctor (clean checkout)",
      action: "Run the studio preflight diagnostics inside the checkout.",
      expected: "Doctor reports success: donor isolation gitignored, zero donor dependencies, configuration secret hygiene, all workspace packages present.",
      observed: legOk ? "exit 0, status success" : `exit ${r.code}, success marker ${r.stdout.includes('"status": "success"') ? "present" : "MISSING"}`,
      verdict: legOk ? "PASS" : "FAIL",
      detail: legOk ? "" : tail(r),
    });
    ok = ok && legOk;
  }

  // Leg 5: donor independence scans inside the checkout.
  {
    const audit = await run(["bun", "run", "donor:audit"], { cwd: checkout, timeoutMs: 180_000 });
    const scan = await run(["bun", "run", "donor:dependency-scan"], { cwd: checkout, timeoutMs: 180_000 });
    const auditAbsentPath = audit.stdout.includes("absent");
    const legOk =
      audit.code === 0 && scan.code === 0 && auditAbsentPath;
    record({
      leg: "LEG-5: donor independence scans in the checkout (path absent + scans green)",
      action: "Run donor:audit and donor:dependency-scan inside the clean checkout.",
      expected: "audit reports the donor path ABSENT and verifies MIT attribution/provenance independently of it; dependency scan finds zero donor imports/dependencies/mappings.",
      observed: `donor:audit exit ${audit.code} (absent-donor path: ${auditAbsentPath}); donor:dependency-scan exit ${scan.code}`,
      verdict: legOk ? "PASS" : "FAIL",
      detail: legOk ? "" : `${tail(audit)} :: ${tail(scan)}`,
    });
    ok = ok && legOk;
  }

  // Leg 6: reference game build + deterministic headless scenario verification.
  {
    const build = await run(["bun", "run", "--cwd", "examples/blackwater-relay", "build"], {
      cwd: checkout,
      timeoutMs: 600_000,
    });
    const buildOk = !build.timedOut && build.code === 0;
    record({
      leg: "LEG-6a: reference game build (clean checkout)",
      action: "bun run --cwd examples/blackwater-relay build (typecheck + deterministic browser bundle).",
      expected: "The committed game builds green without donor and without credentials.",
      observed: buildOk ? "exit 0" : `exit ${build.code}${build.timedOut ? " (timed out)" : ""}`,
      verdict: buildOk ? "PASS" : "FAIL",
      detail: buildOk ? "" : tail(build),
    });
    ok = ok && buildOk;

    const test = await run(["bun", "run", "--cwd", "examples/blackwater-relay", "test"], {
      cwd: checkout,
      timeoutMs: 600_000,
    });
    const testOut = test.stdout + test.stderr;
    const pass = /(\d+) pass/.exec(testOut)?.[1] ?? "0";
    const fail = /(\d+) fail/.exec(testOut)?.[1] ?? "0";
    const testOk = !test.timedOut && test.code === 0 && fail === "0";
    record({
      leg: "LEG-6b: reference game deterministic scenario verification (headless path)",
      action: "Run the game project suite: deterministic headless scenario progression checks (T22 frozen scenarios through the authoritative core, no DOM/WebGL/AudioContext) plus unit/world/service-drone tests.",
      expected: "All deterministic scenario checks pass in the donor-absent checkout (reference-game deterministic verification).",
      observed: `${pass} pass / ${fail} fail, exit ${test.code}`,
      verdict: testOk ? "PASS" : "FAIL",
      detail: testOk ? "" : tail(test),
    });
    ok = ok && testOk;

    // Honest scope record: browser legs not executed inside the clean checkout.
    record({
      leg: "LEG-6c: browser-leg scope note (recorded, never silent)",
      action: "Record that real-browser e2e legs were not executed inside the clean checkout.",
      expected: "Per task scope the deterministic headless path satisfies the checkout's scenario verification; fresh real-browser proof for the same game content runs in conformance:recovery at this revision (multiplayer suite, fixture-wrong-state, performance-regress, audio-browser legs).",
      observed: "browser legs: not-run-inside-checkout (scope choice recorded); covered fresh in conformance:recovery",
      verdict: "PASS",
    });
  }

  // Leg 7: final donor absence.
  {
    const absent = donorAbsent(checkout);
    record({
      leg: "LEG-7: final donor-absence assertion",
      action: "Re-assert .tmp/donor absent after every gate/leg completed.",
      expected: "No leg recreated or required the donor at any point.",
      observed: absent ? "donor absent" : "DONOR PRESENT — gate contaminated",
      verdict: absent ? "PASS" : "FAIL",
    });
    ok = ok && absent;
  }

  // Cleanup on success; preserve checkout on failure for diagnosis.
  if (ok) {
    fs.rmSync(checkout, { recursive: true, force: true });
  } else {
    console.error(`CLEAN CHECKOUT PRESERVED FOR DIAGNOSIS: ${checkout}`);
  }

  const pass = records.filter((r) => r.verdict === "PASS").length;
  const fail = records.filter((r) => r.verdict === "FAIL").length;
  for (const r of records) fs.appendFileSync(jsonlPath, JSON.stringify(r) + "\n");
  fs.appendFileSync(
    jsonlPath,
    JSON.stringify({ type: "summary", run_id: runId, finished: new Date().toISOString(), pass, fail, checkout_preserved: !ok ? checkout : null }) + "\n"
  );
  console.log(`\n=== clean-checkout summary: ${pass} PASS / ${fail} FAIL ===`);
  console.log(fail === 0 ? "CLEAN_CHECKOUT_OK" : "CLEAN_CHECKOUT_FAILED");
  return fail === 0 ? 0 : 1;
}

process.exitCode = await main();
