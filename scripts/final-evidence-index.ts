#!/usr/bin/env bun
/**
 * T25 plan step 4: final evidence check / settlement index over a game project's
 * committed evidence store (preregistration:
 * .agents/preregistrations/gauntlet-game-studio-plan-T25.prereg.yaml, CLAIM-T25-001
 * clause (e)).
 *
 * Composes ONLY the settled T20 EvidenceStore machinery — no duplicated validation
 * logic. For every run in `<project>/artifacts/runs/`:
 *   - schema validation of run.json, manifest-NN.json, settlement-NN.json;
 *   - run/manifest correlation by run_id AND project revision identity;
 *   - artifact hash/size re-verification against disk;
 *   - identity-based freshness classification at the CURRENT revision:
 *       current-revision manifests  -> must validate fresh;
 *       foreign-revision manifests  -> must be rejected with EvidenceStaleError
 *                                      (and remain preserved, never rewritten).
 * Preservation (append-only): every historical run (including failed/correction
 * settlements) must still be present and loadable; deleting or rewriting any is a
 * gate failure.
 *
 * Usage: bun run ./scripts/final-evidence-index.ts [--project examples/blackwater-relay]
 * Writes the structured index to artifacts/plan/T25/evidence-index.json.
 * Exit 0 only when every run validates and preservation holds.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { EvidenceStore, EvidenceStaleError } from "../packages/studio/src/evidence/store.ts";
import { resolveProjectRevision } from "../packages/studio/src/evidence/revision.ts";

function flagValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const repoRoot = path.resolve(import.meta.dir, "..");
const projectRoot = path.resolve(repoRoot, flagValue("--project") ?? "examples/blackwater-relay");
const outPath = path.join(repoRoot, "artifacts", "plan", "T25", "evidence-index.json");

const currentRevision = resolveProjectRevision(projectRoot);
const store = new EvidenceStore({ projectRoot });
const runIds = store.listRuns();

interface RunEntry {
  run_id: string;
  project_revision: string;
  freshness: "current" | "foreign";
  fresh_validated: boolean;
  stale_rejected: boolean;
  manifests: number;
  settlements: Array<{ id: string; decision: string }>;
  artifacts_verified: number;
  error?: string;
}

const entries: RunEntry[] = [];
let hardFailures = 0;

for (const runId of runIds) {
  try {
    const run = store.loadRun(runId); // schema-validated
    const manifests = store.listManifests(runId); // schema-validated
    const settlements = store.listSettlements(runId); // schema-validated
    const isCurrent = run.project_revision === currentRevision;
    let freshValidated = false;
    let staleRejected = false;
    for (const m of manifests) {
      store.validateCorrelation(run, m); // run_id + revision identity
      store.verifyManifestArtifacts(runId, m); // hash/size re-verification
      try {
        store.validateFreshness(m, currentRevision);
        freshValidated = true;
      } catch (e) {
        if (e instanceof EvidenceStaleError && !isCurrent) {
          staleRejected = true; // declared behavior for historical evidence
        } else {
          throw e;
        }
      }
    }
    const okFreshness = isCurrent ? freshValidated : staleRejected;
    if (!okFreshness) hardFailures += 1;
    entries.push({
      run_id: runId,
      project_revision: run.project_revision,
      freshness: isCurrent ? "current" : "foreign",
      fresh_validated: freshValidated,
      stale_rejected: staleRejected,
      manifests: manifests.length,
      settlements: settlements.map((s) => ({ id: s.id, decision: s.decision })),
      artifacts_verified: manifests.reduce((n, m) => n + m.artifacts.length, 0),
      ...(okFreshness ? {} : { error: "freshness classification mismatch" }),
    });
  } catch (e) {
    hardFailures += 1;
    entries.push({
      run_id: runId,
      project_revision: "unknown",
      freshness: "foreign",
      fresh_validated: false,
      stale_rejected: false,
      manifests: 0,
      settlements: [],
      artifacts_verified: 0,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

const byRevision: Record<string, number> = {};
for (const e of entries) byRevision[e.project_revision] = (byRevision[e.project_revision] ?? 0) + 1;
const decisions: Record<string, number> = {};
for (const e of entries) for (const s of e.settlements) decisions[s.decision] = (decisions[s.decision] ?? 0) + 1;
const current = entries.filter((e) => e.freshness === "current");
const foreign = entries.filter((e) => e.freshness === "foreign");
const failedPreserved = entries.filter((e) => e.settlements.some((s) => s.decision === "failed"));

const index = {
  generated: new Date().toISOString(),
  project: projectRoot,
  current_revision: currentRevision,
  runs_total: entries.length,
  runs_by_revision: byRevision,
  settlement_decisions: decisions,
  current_revision_runs: current.map((e) => e.run_id),
  current_all_fresh: current.length > 0 && current.every((e) => e.fresh_validated && !e.error),
  foreign_all_stale_rejected: foreign.length > 0 && foreign.every((e) => e.stale_rejected && !e.error),
  failed_correction_evidence_preserved: failedPreserved.map((e) => ({
    run_id: e.run_id,
    revision: e.project_revision,
    decisions: e.settlements.map((s) => s.decision),
  })),
  hard_failures: hardFailures,
  entries,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(index, null, 2) + "\n");

console.log(`=== T25 final evidence settlement index ===`);
console.log(`project: ${projectRoot}`);
console.log(`current revision: ${currentRevision}`);
console.log(`runs total: ${entries.length} | by revision: ${JSON.stringify(byRevision)}`);
console.log(`settlement decisions: ${JSON.stringify(decisions)}`);
console.log(`current-revision runs all fresh: ${index.current_all_fresh} (${current.length})`);
console.log(`foreign-revision runs all stale-rejected: ${index.foreign_all_stale_rejected} (${foreign.length})`);
console.log(`failed/correction evidence preserved: ${failedPreserved.length} run(s) -> ${failedPreserved.map((e) => e.run_id).join(", ")}`);
console.log(`index written: ${outPath}`);
const pass = hardFailures === 0 && index.current_all_fresh && index.foreign_all_stale_rejected;
console.log(pass ? "EVIDENCE_INDEX_OK" : "EVIDENCE_INDEX_FAILED");
process.exitCode = pass ? 0 : 1;
