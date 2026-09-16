#!/usr/bin/env bun
/**
 * TEETH-T22-003: Corrupt one semantic objective transition while preserving the
 * visible animation.
 *
 * The fixture variant (?bwSemanticFixture=corrupt-gate) keeps the relay-gate RENDER
 * projection animating open while the authoritative Koota gate transform stays closed.
 * The Gauntlet bridge MUST reject settlement through semantic evidence: the frozen
 * transceiver-interaction expectation requires the gate OPEN in Koota, so the state
 * channel fails (SEMANTIC_POSITION_MISMATCH) and the decision is "failed" — never a
 * pass, and never rescued by the healthy pixels/telemetry channels.
 */

import * as path from "node:path";
import { runSinglePlayerSuite } from "./run-suite";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..", "..");

const result = await runSinglePlayerSuite({
  projectRoot: PROJECT_ROOT,
  suiteName: "teeth-corrupt-gate",
  evidence: false,
  query: "bwSemanticFixture=corrupt-gate",
});

const scenario = result.scenarios.find((s) => s.scenario === "transceiver-interaction");
if (!scenario) {
  console.error("TEETH-T22-003 BIT FAILED: transceiver-interaction did not run");
  process.exit(1);
}
const stateFail = scenario.channel_verdicts.find((v) => v.channel === "state");
const hasSemanticMismatch = (stateFail?.failed_checks ?? []).some((c) => c.startsWith("SEMANTIC_POSITION_MISMATCH"));
const otherChannelsPass = scenario.channel_verdicts
  .filter((v) => v.channel !== "state")
  .every((v) => !v.evaluated || v.pass);

console.log(`[teeth] transceiver-interaction decision: ${scenario.decision.toUpperCase()}`);
for (const v of scenario.channel_verdicts) {
  console.log(`[teeth]   ${v.channel}: ${v.evaluated ? (v.pass ? "pass" : "FAIL") : "not-evaluated"}`);
}
if (stateFail) {
  for (const c of stateFail.failed_checks) console.log(`[teeth]   state failed check: ${c}`);
}

if (
  scenario.decision === "failed" &&
  hasSemanticMismatch &&
  otherChannelsPass &&
  !result.all_settled
) {
  console.log(
    "TEETH-T22-003 BIT: settlement REJECTED through semantic evidence while the visible " +
      "animation stayed correct (pixels/telemetry healthy, state channel failed)."
  );
  process.exit(0);
}

console.error("TEETH-T22-003 BIT FAILED: corrupted semantic transition was not rejected.");
process.exit(1);
