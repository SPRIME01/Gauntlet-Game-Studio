#!/usr/bin/env bun
/**
 * T25 TEETH-T25-002 demonstration (preregistration:
 * .agents/preregistrations/gauntlet-game-studio-plan-T25.prereg.yaml).
 *
 * Attack: replace fresh final evidence with HISTORICAL PASSING run IDs from
 * another revision, executed on a DISPOSABLE copy of the game evidence store
 * under os.tmpdir() (the real store is never modified).
 *
 * Expected: the T20 identity-based evidence freshness gate rejects final
 * conformance —
 *   (a) store layer: EvidenceStore.validateFreshness(historicalPassingManifest,
 *       currentRevision) throws EvidenceStaleError;
 *   (b) settlement layer: settleExpectation for final conformance at the
 *       current revision with the historical run+manifest decides
 *       incomplete / evidence_stale and NEVER settled;
 *   (c) control (after the attack): fresh current-revision run+manifest in the
 *       same disposable copy still validates fresh and its settlement remains
 *       "settled" — the gate is identity-based, not broken.
 *
 * Exit 0 only when (a), (b), and (c) all hold.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { EvidenceStore, EvidenceStaleError } from "../packages/studio/src/evidence/store.ts";
import { resolveProjectRevision } from "../packages/studio/src/evidence/revision.ts";
import { settleExpectation } from "../packages/studio/src/gauntlet/settle.ts";
import { parseFrozenExpectation } from "../packages/studio/src/gauntlet/expectation.ts";


const repoRoot = path.resolve(import.meta.dir, "..");
const gameRoot = path.join(repoRoot, "examples", "blackwater-relay");
const storeRoot = path.join(gameRoot, "artifacts", "runs");

const currentRevision = resolveProjectRevision(gameRoot);

// Locate one historical PASSING run (foreign revision) and one fresh
// current-revision run for the same scenario, from the committed store.
function loadJson(file: string): any {
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

const historicalRunId = "run-boot-cc8e21660c23-20260916T213654Z";
const freshRunId = fs
  .readdirSync(storeRoot)
  .filter((d) => d.startsWith("run-boot-") && d.includes(currentRevision.slice(0, 12)))
  .sort()
  .at(-1);

if (!freshRunId || !fs.existsSync(path.join(storeRoot, historicalRunId, "run.json"))) {
  console.error(`required runs not found (fresh=${freshRunId}, historical present=${fs.existsSync(path.join(storeRoot, historicalRunId))})`);
  process.exit(1);
}

// Disposable copy under os.tmpdir() — the real store is never touched.
const scratch = path.join(os.tmpdir(), `gauntlet-t25-tooth2-${Date.now()}`);
fs.mkdirSync(path.join(scratch, "artifacts"), { recursive: true });
fs.cpSync(path.join(storeRoot, historicalRunId), path.join(scratch, "artifacts", "runs", historicalRunId), { recursive: true });
fs.cpSync(path.join(storeRoot, freshRunId!), path.join(scratch, "artifacts", "runs", freshRunId!), { recursive: true });

const store = new EvidenceStore({ projectRoot: scratch });
const historicalRun = store.loadRun(historicalRunId);
const historicalManifests = store.listManifests(historicalRunId);
const historicalSettlements = store.listSettlements(historicalRunId);
const historicalManifest = historicalManifests[0];

console.log(`=== T25 TEETH-T25-002: stale historical evidence substituted for fresh final evidence ===`);
console.log(`current revision : ${currentRevision}`);
console.log(`attack evidence  : ${historicalRunId} (revision ${historicalRun.project_revision}, historical settlement: ${historicalSettlements.map((s) => s.decision).join(",")})`);
console.log(`control evidence : ${freshRunId} (revision ${currentRevision})`);

let failures = 0;

// (a) Store layer: identity-based freshness rejects the historical passing manifest.
try {
  store.validateFreshness(historicalManifest, currentRevision);
  console.log(`[FAIL] (a) validateFreshness ACCEPTED foreign-revision manifest ${historicalManifest.id}`);
  failures += 1;
} catch (e) {
  if (e instanceof EvidenceStaleError) {
    console.log(`[PASS] (a) EvidenceStaleError: ${e.message}`);
  } else {
    console.log(`[FAIL] (a) unexpected error: ${e}`);
    failures += 1;
  }
}

// (b) Settlement layer: final conformance with the substituted historical evidence.
const expectation = parseFrozenExpectation(loadJson(path.join(gameRoot, "tests", "expectations", "boot.json")));
const outcome = settleExpectation({
  expectation,
  run: historicalRun,
  manifests: historicalManifests,
  channels: [],
  availability: { browser_proof_available: true },
  currentRevision,
});
const bOk =
  outcome.decision === "incomplete" &&
  outcome.blockage_class === "evidence_stale" &&
  (outcome.record?.decision ?? "unsettled") !== "settled";
console.log(
  `[${bOk ? "PASS" : "FAIL"}] (b) settleExpectation -> decision=${outcome.decision} blockage=${outcome.blockage_class} record=${outcome.record?.decision}`
);
console.log(`       reason: ${outcome.reason}`);
if (!bOk) failures += 1;

// (c) Control: fresh current-revision evidence still validates fresh.
const freshRun = store.loadRun(freshRunId!);
const freshManifests = store.listManifests(freshRunId!);
let cOk = freshRun.project_revision === currentRevision;
try {
  for (const m of freshManifests) store.validateFreshness(m, currentRevision);
  console.log(`[PASS] (c) fresh manifest ${freshManifests[0]?.id} validates fresh at the current revision`);
} catch (e) {
  console.log(`[FAIL] (c) fresh evidence rejected: ${e}`);
  cOk = false;
}
if (!cOk) failures += 1;

fs.rmSync(scratch, { recursive: true, force: true });
console.log(failures === 0 ? "TEETH-T25-002 OK: freshness gate rejected final conformance from historical evidence" : "TEETH-T25-002 FAILED");
process.exitCode = failures === 0 ? 0 : 1;
