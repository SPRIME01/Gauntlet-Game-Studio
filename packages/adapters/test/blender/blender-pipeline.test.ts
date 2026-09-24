/**
 * dcc.blender.process real-chain test (T18).
 *
 * Runs the FULL retarget/bake/normalize pipeline against REAL Blender when it
 * is present (skipped, never failed, when absent — absent-Blender coverage is
 * the dedicated teeth-1 runner `test:blender-absent-build`). Outputs go to a
 * temp project so committed artifacts are never mutated by tests.
 */

import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { checkBlenderPreflight } from "../../src/dcc/blender/preflight";
import { loadServiceDroneDefinition, runServiceDroneRetargetPipeline } from "../../src/dcc/blender/pipeline";
import { verifyBlenderProcessResult } from "../../src/dcc/blender/verify";
import { validateCapabilityResult, type CapabilityResult } from "@gauntlet/contracts";

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..", "..");
const projectRoot = path.join(repoRoot, "examples", "blackwater-relay");
const preflight = await checkBlenderPreflight();
const blenderAvailable = preflight.available;

describe("dcc.blender.process real chain (Blender 5.2.2 LTS)", () => {
  it.skipIf(!blenderAvailable)(
    "retargets, bakes, and normalizes the service drone end to end",
    async () => {
      const tempProject = fs.mkdtempSync(path.join(os.tmpdir(), "t18-pipeline-"));
      fs.mkdirSync(path.join(tempProject, "assets", "dcc", "service-drone"), { recursive: true });
      fs.mkdirSync(path.join(tempProject, ".studio", "requests"), { recursive: true });
      fs.mkdirSync(path.join(tempProject, ".studio", "results"), { recursive: true });

      const request = Bun.YAML.parse(
        fs.readFileSync(path.join(projectRoot, ".studio", "requests", "service-drone-retarget.yaml"), "utf-8")
      );
      const definitionRel = request.inputs.source_definition;
      fs.copyFileSync(
        path.join(projectRoot, definitionRel),
        path.join(tempProject, definitionRel)
      );
      // The committed accepted manifest (service-drone accepted record included)
      // proves the offline verifier end to end against a fresh regeneration.
      fs.copyFileSync(
        path.join(projectRoot, "assets", "manifest.json"),
        path.join(tempProject, "assets", "manifest.json")
      );

      const result = await runServiceDroneRetargetPipeline({
        projectRoot: tempProject,
        repoRoot,
        definitionPath: path.join(tempProject, definitionRel),
        escalationRationale: request.inputs.escalation_rationale,
        outputGlbPath: path.join(tempProject, "assets", "service-drone.glb"),
        bakeReportPath: path.join(tempProject, "assets", "dcc", "service-drone", "service-drone.bake-report.json"),
      });

      expect(result.status).toBe("success");
      if (result.status !== "success") return;

      // The version probe recorded the LTS release verbatim.
      expect(result.blender.version).toBe("5.2.2 LTS");
      expect(result.escalation_rationale.rejected_routes.length).toBeGreaterThanOrEqual(1);

      // Two deterministic background invocations with the exact contract argv.
      expect(result.invocations.length).toBe(2);
      for (const inv of result.invocations) {
        expect(inv.exit_code).toBe(0);
        expect(inv.argv).toContain("--background");
        expect(inv.argv).toContain("--factory-startup");
        expect(inv.argv).toContain("--python");
      }

      // The committed-style derivative is a real animated glTF asset.
      expect(result.normalized_glb.animations).toEqual(["hover_cycle"]);
      expect(result.normalized_glb.triangles).toBeGreaterThan(0);
      expect(result.normalized_glb.triangles).toBeLessThanOrEqual(request.inputs.budget_limits.max_triangles);
      expect(result.normalized_glb.bytes).toBeLessThanOrEqual(request.inputs.budget_limits.max_file_bytes);
      expect(fs.existsSync(result.normalized_glb.path)).toBe(true);
      expect(fs.existsSync(result.bake_report.path)).toBe(true);

      // Structural provenance markers rode into the GLB node extras.
      const glb = fs.readFileSync(result.normalized_glb.path);
      const jsonLen = glb.readUInt32LE(12);
      const gltf = JSON.parse(glb.subarray(20, 20 + jsonLen).toString("utf-8"));
      const rigExtras = gltf.nodes?.find((n: { name?: string }) => n.name === "DroneRigTarget")?.extras;
      expect(rigExtras?.gw_asset_id).toBe("service-drone");

      // The full deterministic offline verifier passes on the fresh outputs.
      const freshResult: CapabilityResult = validateCapabilityResult({
        id: "res-t18-fresh-regeneration",
        request_id: "req-t18-fresh-regeneration",
        provider: "dcc.blender",
        status: "success",
        artifacts: [
          {
            id: "service-drone-glb",
            path: path.relative(tempProject, result.normalized_glb.path),
            role: "committed_glb_derivative",
            mime_type: "model/gltf-binary",
            sha256: result.normalized_glb.sha256,
          },
          {
            id: "service-drone-bake-report",
            path: path.relative(tempProject, result.bake_report.path),
            role: "regeneration_metadata",
            mime_type: "application/json",
            sha256: result.bake_report.sha256,
          },
        ],
        asset_ids: ["service-drone"],
        diagnostics: {
          capability_id: "dcc.blender.process",
          verification: {
            method: "deterministic-offline",
            model_invocation: "none",
            network_access: "none",
            blender_required_at_verify: false,
          },
          regeneration: {
            blender_version: result.blender.version,
            invocations: result.invocations,
            scripts: [
              "packages/adapters/src/dcc/blender/scripts/generate_service_drone_source.py",
              "packages/adapters/src/dcc/blender/scripts/retarget_bake_service_drone.py",
            ],
            source_definition: {
              path: definitionRel,
              sha256: result.source_definition.sha256,
            },
          },
        },
      });

      // The fresh request file mirrors the committed request inputs.
      fs.writeFileSync(
        path.join(tempProject, ".studio", "requests", "fresh-regeneration.yaml"),
        JSON.stringify({
          id: "req-t18-fresh-regeneration",
          project_id: "blackwater-relay",
          capability_id: "dcc.blender.process",
          intent: request.intent,
          acceptance: request.acceptance,
          inputs: {
            budget_limits: request.inputs.budget_limits,
            source_definition: definitionRel,
          },
        })
      );

      const outcome = await verifyBlenderProcessResult(freshResult, {
        resultPath: path.join(tempProject, ".studio", "results", "fresh-regeneration.yaml"),
        projectRoot: tempProject,
        repoRoot,
        capabilityId: "dcc.blender.process",
      });
      const failed = outcome.checks.filter((c) => c.status === "fail");
      expect(failed).toEqual([]);
      expect(outcome.ok).toBe(true);

      // Cleanup: intermediates live in the shared workdir; leave .tmp to its own hygiene.
      fs.rmSync(tempProject, { recursive: true, force: true });
    },
    240_000
  );

  it("blocks with typed BLENDER_UNAVAILABLE when Blender is absent", async () => {
    const request = Bun.YAML.parse(
      fs.readFileSync(path.join(projectRoot, ".studio", "requests", "service-drone-retarget.yaml"), "utf-8")
    );
    const result = await runServiceDroneRetargetPipeline({
      projectRoot,
      repoRoot,
      definitionPath: path.join(projectRoot, request.inputs.source_definition),
      escalationRationale: request.inputs.escalation_rationale,
      preflight: { which: () => null },
    });
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") expect(result.code).toBe("BLENDER_UNAVAILABLE");
  }, 120000);

  it("committed source definition stays valid", () => {
    const check = loadServiceDroneDefinition(
      path.join(projectRoot, "assets", "dcc", "service-drone", "service-drone.source.json")
    );
    expect(check.ok).toBe(true);
  });
});
