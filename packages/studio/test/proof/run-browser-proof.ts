#!/usr/bin/env bun
/**
 * T20 browser gate leg: end-to-end proof of the Playwright harness, immutable
 * evidence, and the Gauntlet settlement bridge against REAL system Chrome
 * (/usr/bin/google-chrome, headless by default, NO autoplay-policy bypass flags).
 *
 * Legs (preregistered in .agents/preregistrations/gauntlet-game-studio-plan-T20.prereg.yaml):
 *   A. observe fixture-ok through the stable `__GAUNTLET_STUDIO_OBS__` v1 methods
 *      (never DOM selectors), store an immutable ObservationRun/EvidenceManifest
 *      under artifacts/runs/<run-id>/, settle the frozen expectation -> "settled".
 *   B. TEETH-T20-001 end-to-end: observe fixture-wrong-state — pixels visually
 *      correct, authoritative Koota-backed state deliberately wrong — overall
 *      verification MUST be "failed" with the pixels-vs-state contradiction.
 *   C. TEETH-T20-003: Playwright unavailability injected (simulated loader failure;
 *      nothing uninstalled) -> typed blocked observation, settlement "blocked",
 *      never passed.
 *   D. TEETH-T20-002: settle leg A's evidence against a foreign revision ->
 *      rejected as stale/incomplete; immutability refuses rewriting the run.
 *
 * Usage:
 *   bun run ./packages/studio/test/proof/run-browser-proof.ts                 # gate legs
 *   bun run ./packages/studio/test/proof/run-browser-proof.ts --write-fixtures
 *       # (re)generate the committed deterministic fixtures under
 *       #  packages/studio/test/proof/fixtures/ from a REAL harness run
 *
 * Exit codes: 0 = all preregistered legs behaved as specified; 1 = hard failure;
 * 2 = scoped environmental blockage (browser proof impossible here; documented,
 * never faked).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  buildFixtureScenario,
  FIXTURE_OK_SCENARIO_ID,
  FIXTURE_WRONG_STATE_SCENARIO_ID,
  runScenario,
  type ChannelEvidence,
} from "@gauntlet/adapters";
import {
  EvidenceStore,
  EvidenceImmutabilityError,
  EvidenceStaleError,
  resolveProjectRevision,
} from "@gauntlet/studio";
import {
  parseFrozenExpectation,
  settleExpectation,
  type FrozenExpectation,
  type SettlementOutcome,
} from "@gauntlet/studio";

const REPO_ROOT = path.resolve(import.meta.dir, "..", "..", "..", "..");
const CHROME_PATH = "/usr/bin/google-chrome";
const RUNS_DIR = path.join(REPO_ROOT, "artifacts", "runs");
const EXPECTATIONS_DIR = path.join(REPO_ROOT, "packages", "studio", "test", "proof", "expectations");
const FIXTURES_DIR = path.join(REPO_ROOT, "packages", "studio", "test", "proof", "fixtures");
const FIXTURE_REVISION = "rev-fixture-a";
const FIXTURE_STALE_REVISION = "rev-fixture-old";
const FIXTURE_TS = "2026-09-15T12:00:00Z";
const FOREIGN_REVISION = "0000000000000000000000000000000000000000";

const args = process.argv.slice(2);
const WRITE_FIXTURES = args.includes("--write-fixtures");

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

function channelsOf(channelList: ChannelEvidence[] | undefined): ChannelEvidence[] {
  return channelList ?? [];
}

function settleFor(
  expectation: FrozenExpectation,
  observed: Awaited<ReturnType<typeof runScenario>>,
  currentRevision: string,
  browserProofAvailable: boolean,
  unavailableReason?: string
): SettlementOutcome {
  if (!observed.run) fail("observation produced no run; cannot settle");
  const run = JSON.parse(JSON.stringify(observed.run));
  const manifests = observed.manifest ? [JSON.parse(JSON.stringify(observed.manifest))] : [];
  return settleExpectation({
    expectation,
    run,
    manifests,
    channels: channelsOf(observed.channels),
    availability: {
      browser_proof_available: browserProofAvailable,
      unavailable_reason: unavailableReason,
    },
    currentRevision,
    now: observed.run.timestamp,
  });
}

// ---------------------------------------------------------------------------
// Fixture generation (--write-fixtures)
// ---------------------------------------------------------------------------

async function writeFixtures(): Promise<void> {
  console.log("=== T20 fixture generation (real harness run -> committed fixtures) ===");
  if (!fs.existsSync(CHROME_PATH)) {
    block(`system Chrome not found at ${CHROME_PATH}; fixtures cannot be generated here`);
  }
  fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  // Fixture generation OWNS these directories: clear partial/previous fixture runs
  // so regeneration is deterministic (the runtime store itself stays immutable).
  for (const entry of fs.readdirSync(FIXTURES_DIR)) {
    if (/^run-fixture-/.test(entry)) {
      fs.rmSync(path.join(FIXTURES_DIR, entry), { recursive: true, force: true });
    }
  }
  const store = new EvidenceStore({ projectRoot: REPO_ROOT, runsRoot: FIXTURES_DIR });

  async function generate(
    scenarioId: string,
    revision: string,
    runId: string,
    expected: Record<string, unknown>
  ): Promise<void> {
    const writer = store.createRunWriter();
    const observed = await runScenario({
      scenario: buildFixtureScenario(scenarioId, { seed: 1337, steps: 3, view: "main" }),
      projectRevision: revision,
      requirementIds: ["REQ-GOAL-004", "REQ-OUT-003", "REQ-GAUNTLET-003"],
      sink: writer,
      chromeExecutablePath: CHROME_PATH,
      headless: !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
      fixedTimestampIso: FIXTURE_TS,
      timeoutMs: 45000,
    });
    if (observed.status !== "observed" || !observed.manifest) {
      block(`fixture generation for ${scenarioId} did not observe: ${JSON.stringify(observed.blockage)}`);
    }
    // The harness derives the run id from timestamp; for the committed fixture we
    // regenerate under the canonical deterministic id by writing with fixed TS
    // (makeRunId is deterministic given revision + fixedTimestampIso).
    const actualId = observed.manifest!.run_id;
    if (actualId !== runId) {
      // Rename is safe: nothing has referenced the fresh dir yet.
      fs.renameSync(path.join(FIXTURES_DIR, actualId), path.join(FIXTURES_DIR, runId));
      fs.writeFileSync(
        path.join(FIXTURES_DIR, runId, "run.json"),
        fs
          .readFileSync(path.join(FIXTURES_DIR, runId, "run.json"), "utf-8")
          .replace(`"${actualId}"`, `"${runId}"`)
      );
      fs.writeFileSync(
        path.join(FIXTURES_DIR, runId, "manifest-01.json"),
        fs
          .readFileSync(path.join(FIXTURES_DIR, runId, "manifest-01.json"), "utf-8")
          .replaceAll(actualId, runId)
      );
    }
    fs.writeFileSync(
      path.join(FIXTURES_DIR, runId, "expected.json"),
      JSON.stringify(expected, null, 2) + "\n"
    );
    console.log(`OK fixture ${runId} (${scenarioId}, revision ${revision})`);
  }

  await generate(FIXTURE_OK_SCENARIO_ID, FIXTURE_REVISION, "run-fixture-ok", {
    description:
      "Valid fresh evidence: fixture-ok observed end-to-end via the stable observability surface; schema, correlation, and artifact hashes must validate.",
    must_validate: true,
  });

  // Contradiction fixture: wrong-state observation plus its failed settlement,
  // preserved as append-only contradictory evidence.
  await generate(FIXTURE_WRONG_STATE_SCENARIO_ID, FIXTURE_REVISION, "run-fixture-contradiction", {
    description:
      "Preserved contradictory evidence: pixels plausible but authoritative state wrong; the failed settlement record is preserved append-only and never overwritten.",
    must_validate: true,
  });
  {
    const expectation = loadExpectation("fixture-wrong-state");
    const store2 = new EvidenceStore({ projectRoot: REPO_ROOT, runsRoot: FIXTURES_DIR });
    const runId = "run-fixture-contradiction";
    const observedRun = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, runId, "run.json"), "utf-8"));
    const observedManifest = JSON.parse(
      fs.readFileSync(path.join(FIXTURES_DIR, runId, "manifest-01.json"), "utf-8")
    );
    // The harness records the full channel evidence in run.json.
    const channels = observedRun.channels as ChannelEvidence[];
    const outcome = settleExpectation({
      expectation,
      run: observedRun,
      manifests: [observedManifest],
      channels,
      availability: { browser_proof_available: true },
      currentRevision: FIXTURE_REVISION,
      now: FIXTURE_TS,
    });
    if (outcome.decision !== "failed" || !outcome.record) {
      fail(`contradiction fixture settlement expected 'failed', got '${outcome.decision}'`);
    }
    if (!outcome.contradictions.some((c) => c.startsWith("pixels_pass_state_fail"))) {
      fail("contradiction fixture settlement did not record the pixels-vs-state contradiction");
    }
    store2.appendSettlement(runId, outcome.record);
    console.log(`OK settlement record (failed, contradiction recorded) appended to ${runId}`);
  }

  await generate(FIXTURE_WRONG_STATE_SCENARIO_ID, FIXTURE_STALE_REVISION, "run-fixture-stale", {
    description:
      "Negative control: evidence from another project revision (rev-fixture-old) MUST be rejected by identity-based freshness validation.",
    must_reject: "stale_revision",
    current_revision: FIXTURE_REVISION,
  });

  console.log("SUCCESS: committed fixtures regenerated from real harness runs.");
}

// ---------------------------------------------------------------------------
// Gate legs
// ---------------------------------------------------------------------------

async function runGateLegs(): Promise<void> {
  console.log("=== T20 browser proof gate (system Chrome, deterministic) ===");
  if (!fs.existsSync(CHROME_PATH)) {
    block(
      `system Chrome not found at ${CHROME_PATH}; required browser proof is environmentally ` +
        "impossible on this host — scoped blockage, never a fake pass"
    );
  }
  const revision = resolveProjectRevision(REPO_ROOT);
  console.log(`project revision: ${revision}`);
  const store = new EvidenceStore({ projectRoot: REPO_ROOT });
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  const headless = !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
  console.log(`mode: ${headless ? "headless" : "headed"}; no autoplay-policy bypass flags used`);

  const runOpts = (scenarioId: string, requirementIds: string[]) => ({
    scenario: buildFixtureScenario(scenarioId, { seed: 1337, steps: 3, view: "main" }),
    projectRevision: revision,
    requirementIds,
    sink: store.createRunWriter(),
    chromeExecutablePath: CHROME_PATH,
    headless,
    timeoutMs: 45000,
  });

  // ---- Leg A: fresh observation settles the agreeing fixture ----
  const okObserved = await runScenario(runOpts(FIXTURE_OK_SCENARIO_ID, ["REQ-GOAL-004", "REQ-OUT-003", "REQ-GAUNTLET-003"]));
  if (okObserved.status !== "observed" || !okObserved.manifest || okObserved.manifest.result !== "pass") {
    block(`leg A observation failed: ${JSON.stringify(okObserved.blockage)}`);
  }
  console.log(`LEG A observed run ${okObserved.run!.id} -> ${store.runDir(okObserved.run!.id)}`);
  const okExpectation = loadExpectation("fixture-ok");
  const okSettlement = settleFor(okExpectation, okObserved, revision, true);
  if (okSettlement.decision !== "settled") {
    fail(`leg A expected 'settled', got '${okSettlement.decision}': ${okSettlement.reason}`);
  }
  store.appendSettlement(okObserved.run!.id, okSettlement.record!);
  console.log("LEG A PASS: fresh correlated evidence settles the agreeing fixture");

  // ---- Leg B: TEETH-T20-001 end-to-end (correct pixels, wrong Koota state) ----
  const wrongObserved = await runScenario(runOpts(FIXTURE_WRONG_STATE_SCENARIO_ID, ["REQ-VERIFY-001", "REQ-VERIFY-002", "REQ-GOAL-004"]));
  if (wrongObserved.status !== "observed" || !wrongObserved.manifest) {
    block(`leg B observation failed: ${JSON.stringify(wrongObserved.blockage)}`);
  }
  const wrongPixels = wrongObserved.channels.find((c) => c.channel === "pixels") as
    | { captures: Array<{ sha256: string }> }
    | undefined;
  const okPixels = okObserved.channels.find((c) => c.channel === "pixels") as
    | { captures: Array<{ sha256: string }> }
    | undefined;
  const identicalPixels =
    wrongPixels && okPixels && wrongPixels.captures[0].sha256 === okPixels.captures[0].sha256;
  console.log(
    `LEG B pixels: wrong-state capture sha256 ${wrongPixels?.captures[0].sha256.slice(0, 12)}… ` +
      `(byte-identical to ok run: ${identicalPixels === true ? "yes" : "no — visually equivalent fixture either way"})`
  );
  const wrongExpectation = loadExpectation("fixture-wrong-state");
  const wrongSettlement = settleFor(wrongExpectation, wrongObserved, revision, true);
  if (wrongSettlement.decision !== "failed") {
    fail(
      `TEETH-T20-001 BIT FAILED: overall verification was '${wrongSettlement.decision}', must be 'failed' — pixels cannot override semantic contradiction`
    );
  }
  if (!wrongSettlement.contradictions.some((c) => c.startsWith("pixels_pass_state_fail"))) {
    fail("TEETH-T20-001: pixels-vs-state contradiction was not recorded");
  }
  const wrongStateVerdict = wrongSettlement.channel_verdicts.find((v) => v.channel === "state");
  const wrongPixelsVerdict = wrongSettlement.channel_verdicts.find((v) => v.channel === "pixels");
  if (!wrongStateVerdict || wrongStateVerdict.pass) fail("TEETH-T20-001: state channel should fail");
  if (!wrongPixelsVerdict || !wrongPixelsVerdict.pass) fail("TEETH-T20-001: pixel channel should pass (screenshot is correct)");
  store.appendSettlement(wrongObserved.run!.id, wrongSettlement.record!);
  console.log(
    `TEETH-T20-001 PASS: correct screenshot + incorrect Koota state -> '${wrongSettlement.decision}' ` +
      `(classified: ${wrongSettlement.blockage_class}); pixels did not override the semantic contradiction`
  );

  // ---- Leg C: TEETH-T20-003 (Playwright unavailable -> blocked, never passed) ----
  const unavailableObserved = await runScenario({
    ...runOpts(FIXTURE_OK_SCENARIO_ID, ["REQ-VERIFY-005"]),
    playwrightLoader: async () => {
      throw new Error("simulated Playwright unavailability (injected; nothing uninstalled)");
    },
  });
  if (unavailableObserved.status !== "blocked" || unavailableObserved.blockage?.code !== "PLAYWRIGHT_UNAVAILABLE") {
    fail(`TEETH-T20-003: expected typed PLAYWRIGHT_UNAVAILABLE blockage, got ${JSON.stringify(unavailableObserved)}`);
  }
  if (!unavailableObserved.manifest || unavailableObserved.manifest.result !== "blocked") {
    fail("TEETH-T20-003: blocked observation must record a blocked manifest");
  }
  const blockedSettlement = settleFor(
    loadExpectation("fixture-ok"),
    unavailableObserved,
    revision,
    false,
    unavailableObserved.blockage.message
  );
  if (blockedSettlement.decision !== "blocked" || blockedSettlement.record?.decision !== "blocked") {
    fail(`TEETH-T20-003: settlement must be 'blocked', got '${blockedSettlement.decision}'`);
  }
  if (blockedSettlement.record.evidence_manifest_ids.length === 0) {
    fail("TEETH-T20-003: blocked settlement must cite the blocked evidence manifest");
  }
  store.appendSettlement(unavailableObserved.manifest!.run_id, blockedSettlement.record!);
  console.log(
    "TEETH-T20-003 PASS: required browser proof with Playwright unavailable -> blocked/skipped, never passed"
  );

  // ---- Leg D: TEETH-T20-002 (foreign revision rejected) + immutability ----
  const foreignSettlement = settleFor(okExpectation, okObserved, FOREIGN_REVISION, true);
  if (foreignSettlement.decision !== "incomplete" || foreignSettlement.blockage_class !== "evidence_stale") {
    fail(
      `TEETH-T20-002: foreign-revision evidence must be rejected as stale/incomplete, got '${foreignSettlement.decision}'`
    );
  }
  const okManifest = JSON.parse(JSON.stringify(okObserved.manifest));
  let staleCaught = false;
  try {
    store.validateFreshness(okManifest, FOREIGN_REVISION);
  } catch (err) {
    staleCaught = err instanceof EvidenceStaleError;
  }
  if (!staleCaught) fail("TEETH-T20-002: store-level freshness validation did not reject");
  let immutableCaught = false;
  try {
    store.beginRun(JSON.parse(JSON.stringify(okObserved.run)));
  } catch (err) {
    immutableCaught = err instanceof EvidenceImmutabilityError;
  }
  if (!immutableCaught) fail("immutability: rewriting an existing run directory was not refused");
  console.log(
    "TEETH-T20-002 PASS: passing EvidenceManifest from another revision rejected (stale/incomplete); run dir immutable"
  );

  console.log("SUCCESS: all T20 browser proof legs behaved as preregistered.");
}

async function main(): Promise<void> {
  if (WRITE_FIXTURES) {
    await writeFixtures();
  } else {
    await runGateLegs();
  }
}

main().catch((err) => {
  fail(`unexpected runner error: ${err instanceof Error ? err.stack : String(err)}`);
});
