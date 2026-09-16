#!/usr/bin/env bun
/**
 * Regenerate the Blackwater Relay service-drone derivative through the real
 * dcc.blender.process route (T18).
 *
 * This is the ONE committed entry point that executes Blender. It:
 *   1. loads the committed capability request (.studio/requests/
 *      service-drone-retarget.yaml) for the escalation rationale and budgets;
 *   2. runs the adapter pipeline: preflight -> source rig .blend ->
 *      retarget/bake/export raw GLB -> glTF-Transform normalization;
 *   3. intakes + accepts the derivative through the project Asset Registry
 *      as a blender-origin derived asset (idempotent for identical inputs).
 *
 * Usage:
 *   bun run ./scripts/regenerate-service-drone.ts [--project examples/blackwater-relay]
 *
 * Normal builds/tests/CI NEVER invoke this; they consume the committed
 * accepted derivative (REQ-BLENDER-006).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { runServiceDroneRetargetPipeline } from "../packages/adapters/src/dcc/blender/pipeline";
import { AssetRegistry } from "../packages/studio/src/assets";

const repoRoot = path.resolve(import.meta.dir, "..");
const projectIdx = process.argv.indexOf("--project");
const projectRoot = path.resolve(
  projectIdx >= 0 ? process.argv[projectIdx + 1] : path.join(repoRoot, "examples", "blackwater-relay")
);
const requestPath = path.join(projectRoot, ".studio", "requests", "service-drone-retarget.yaml");

interface RequestInputs {
  source_definition: string;
  output_glb_path: string;
  bake_report_path: string;
  budget_limits: Record<string, number>;
  escalation_rationale: unknown;
}

async function main(): Promise<number> {
  if (!fs.existsSync(requestPath)) {
    console.error(`FAIL: request file not found at ${requestPath}`);
    return 1;
  }
  const request = Bun.YAML.parse(fs.readFileSync(requestPath, "utf-8"));
  const inputs = request.inputs as RequestInputs;
  const definitionPath = path.resolve(projectRoot, inputs.source_definition);

  console.log(`=== dcc.blender.process regeneration: ${request.id} ===`);
  const result = await runServiceDroneRetargetPipeline({
    projectRoot,
    repoRoot,
    definitionPath,
    escalationRationale: inputs.escalation_rationale,
    outputGlbPath: path.resolve(projectRoot, inputs.output_glb_path),
    bakeReportPath: path.resolve(projectRoot, inputs.bake_report_path),
    log: (line) => console.log(`  ${line}`),
  });

  if (result.status === "blocked") {
    console.log(JSON.stringify({ status: "blocked", code: result.code, message: result.message, details: result.details ?? [] }, null, 2));
    return 2;
  }
  if (result.status === "failed") {
    console.log(JSON.stringify({ status: "failed", code: result.code, message: result.message }, null, 2));
    return 1;
  }

  // --- Asset Registry intake + acceptance (idempotent) ---------------------
  const registry = new AssetRegistry(projectRoot);
  registry.load();
  const existing = registry.get("service-drone");
  const record = {
    id: "service-drone",
    role: "prop",
    origin: "blender",
    construction_route: "dcc.blender.process",
    source_provenance: {
      uri: inputs.source_definition,
      license: "project-owned",
      author: "gauntlet coding agent via dcc.blender.process (T18)",
      sha256: result.source_definition.sha256,
    },
    runtime_representation: `glb:${inputs.output_glb_path}`,
    budget: {
      max_triangles: inputs.budget_limits.max_triangles,
      measured_triangles: result.normalized_glb.triangles,
      max_file_bytes: inputs.budget_limits.max_file_bytes,
      measured_file_bytes: result.normalized_glb.bytes,
    },
    acceptance_state: "pending",
    semantic_nodes: result.normalized_glb.nodes,
    animation_contract: {
      clips: result.normalized_glb.animations,
      frames: "1..24",
      source: "retargeted from DroneRigSource hover cycle and baked via dcc.blender.process",
      note: "Animation contract is recorded AssetRecord affordance metadata only; the game model owns any semantics (REQ-BLENDER-005).",
    },
    collider_policy: "no collider nodes in derivative; ambient animated prop, collision semantics owned by the game model",
    lod_policy: "single-lod; LOD generation deferred to the asset.optimize route",
    verification_refs: [
      ".studio/results/service-drone-retarget.yaml",
      inputs.bake_report_path,
    ],
  };

  if (existing) {
    const sameSource = existing.source_provenance.sha256 === record.source_provenance.sha256;
    const sameDerivative = String(existing.runtime_representation) === record.runtime_representation;
    const existingBudget = existing.budget as Record<string, unknown>;
    const sameMeasurements =
      existingBudget["measured_triangles"] === record.budget.measured_triangles &&
      existingBudget["measured_file_bytes"] === record.budget.measured_file_bytes;
    if (sameSource && sameDerivative && sameMeasurements && existing.acceptance_state === "accepted") {
      console.log("registry: service-drone already registered and accepted with identical inputs; skipping intake");
    } else {
      console.error(
        "FAIL: service-drone is already registered with different inputs; supersession is an explicit AssetRegistry decision, not a regeneration side effect"
      );
      return 1;
    }
  } else {
    const intake = registry.intake(record);
    if (intake.state === "blocked") {
      console.error(`FAIL: intake blocked: ${intake.provenance_violations.join("; ")}`);
      return 1;
    }
    const accepted = registry.accept("service-drone");
    if (accepted.state !== "accepted") {
      console.error(`FAIL: acceptance did not pass: ${accepted.report.blockers.map((b) => `${b.gate}: ${b.detail}`).join("; ")}`);
      return 1;
    }
    registry.save();
    console.log("registry: service-drone intake -> accepted (blender origin, source hash verified)");
  }

  console.log("REGENERATION_SUMMARY " + JSON.stringify(result, null, 2));
  return 0;
}

main().then((code) => {
  if (code !== 0) process.exit(code);
});
