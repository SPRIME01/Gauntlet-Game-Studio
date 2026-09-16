/**
 * TEETH-T18-002: quest/NPC semantic state in .blend-side metadata must be
 * rejected by asset/runtime authority checks (T18, REQ-BLENDER-005,
 * REQ-RUNTIME-001). Koota stays the sole semantic authority.
 *
 * Three rejection layers are exercised:
 *   1. pipeline/definition intake — poisoned dcc_metadata is rejected BEFORE
 *      any Blender execution (works with or without Blender installed);
 *   2. verify-result — a committed result whose bake report / GLB extras
 *      carry gameplay semantics fails AUTHORITY_BOUNDARY offline;
 *   3. runtime — the Koota-backed GameWorld keeps its own semantic authority
 *      intact while the derivative is present: provider objects in state are
 *      rejected and benign affordance metadata stays inert data.
 */

import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { BlendSemanticAuthorityError, assertNoGameSemanticsInBlendMetadata } from "../../src/dcc/blender/authority";
import { loadServiceDroneDefinition, runServiceDroneRetargetPipeline } from "../../src/dcc/blender/pipeline";
import { verifyBlenderProcessResult } from "../../src/dcc/blender/verify";

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..", "..");
const projectRoot = path.join(repoRoot, "examples", "blackwater-relay");
const POISON = {
  quest_state: "stage_2_active",
  quest_giver: "relay_maintainer",
  npc: { id: "drone-7", hostile: true, dialogue: "unauthorized_repair_detected" },
  faction_reputation: -10,
};

function makeTempProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t18-authority-"));
  // Mirror the committed example project layout.
  fs.mkdirSync(path.join(dir, "assets", "dcc", "service-drone"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".studio", "requests"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".studio", "results"), { recursive: true });
  fs.copyFileSync(
    path.join(projectRoot, "assets", "service-drone.glb"),
    path.join(dir, "assets", "service-drone.glb")
  );
  fs.copyFileSync(path.join(projectRoot, "assets", "manifest.json"), path.join(dir, "assets", "manifest.json"));
  fs.copyFileSync(
    path.join(projectRoot, ".studio", "requests", "service-drone-retarget.yaml"),
    path.join(dir, ".studio", "requests", "service-drone-retarget.yaml")
  );
  fs.copyFileSync(
    path.join(projectRoot, "assets", "dcc", "service-drone", "service-drone.source.json"),
    path.join(dir, "assets", "dcc", "service-drone", "service-drone.source.json")
  );
  return dir;
}

function sha256File(p: string): string {
  return require("node:crypto").createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

describe("TEETH-T18-002: DCC metadata never carries gameplay semantics", () => {
  it("layer 1: poisoned dcc_metadata in the source definition blocks before Blender", async () => {
    const dir = makeTempProject();
    const defPath = path.join(dir, "assets", "dcc", "service-drone", "service-drone.source.json");
    const definition = JSON.parse(fs.readFileSync(defPath, "utf-8"));
    definition.dcc_metadata = POISON;
    fs.writeFileSync(defPath, JSON.stringify(definition));

    // Structural check reports the rejection.
    const loaded = loadServiceDroneDefinition(defPath);
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) {
      expect(loaded.code).toBe("DCC_METADATA_REJECTED");
      expect(loaded.message).toContain("REQ-BLENDER-005");
    }

    // The pipeline blocks with the typed code regardless of Blender presence.
    const request = Bun.YAML.parse(
      fs.readFileSync(path.join(projectRoot, ".studio", "requests", "service-drone-retarget.yaml"), "utf-8")
    );
    const pipeline = await runServiceDroneRetargetPipeline({
      projectRoot: dir,
      repoRoot,
      definitionPath: defPath,
      escalationRationale: request.inputs.escalation_rationale,
    });
    expect(pipeline.status).toBe("blocked");
    if (pipeline.status === "blocked") {
      expect(pipeline.code).toBe("DCC_METADATA_REJECTED");
      expect(pipeline.message).toContain("quest_state");
    }
  });

  it("layer 2: a committed result with poisoned bake-report metadata fails AUTHORITY_BOUNDARY offline", async () => {
    const dir = makeTempProject();
    // Poison the bake report's dcc_metadata and restamp its hash in the result.
    const reportPath = path.join(dir, "assets", "dcc", "service-drone", "service-drone.bake-report.json");
    fs.copyFileSync(
      path.join(projectRoot, "assets", "dcc", "service-drone", "service-drone.bake-report.json"),
      reportPath
    );
    const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
    report.dcc_metadata = POISON;
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    // Mirror the GLB node extras poison so both surfaces are checked.
    // (Extras live inside the GLB binary; the committed GLB here stays clean,
    // so layer 2 isolates the bake-report surface.)

    const resultPath = path.join(dir, ".studio", "results", "service-drone-retarget.yaml");
    const raw = fs
      .readFileSync(path.join(projectRoot, ".studio", "results", "service-drone-retarget.yaml"), "utf-8")
      .replace(
        /id: service-drone-bake-report\n    path: assets\/dcc\/service-drone\/service-drone\.bake-report\.json\n    role: regeneration_metadata\n    mime_type: application\/json\n    sha256: [a-f0-9]{64}/,
        `id: service-drone-bake-report\n    path: assets/dcc/service-drone/service-drone.bake-report.json\n    role: regeneration_metadata\n    mime_type: application/json\n    sha256: ${sha256File(reportPath)}`
      );
    fs.writeFileSync(resultPath, raw);

    const outcome = await verifyBlenderProcessResult(Bun.YAML.parse(fs.readFileSync(resultPath, "utf-8")), {
      resultPath,
      projectRoot: dir,
      repoRoot,
      capabilityId: "dcc.blender.process",
    });
    expect(outcome.ok).toBe(false);
    const authority = outcome.checks.find((c) => c.id === "AUTHORITY_BOUNDARY");
    expect(authority?.status).toBe("fail");
    expect(authority?.detail).toContain("quest_state");
  });

  it("layer 3: runtime Koota authority stays intact alongside the derivative", () => {
    // Koota caps worlds per PROCESS (max 16) and the full `bun test` suite
    // already sits at that cap, so the runtime assertion runs in its own
    // short-lived subprocess: same guard, isolated world budget.
    const script = `
      const { GameWorld } = require("${path.join(repoRoot, "packages", "runtime", "src", "state", "world.ts")}");
      const { createRequire } = require("node:module");
      const req = createRequire("${path.join(repoRoot, "packages", "runtime", "src", "index.ts")}");
      const { Object3D } = req("three");
      const world = new GameWorld();
      world.spawnEntity({ id: "drone-7" });
      // Benign DCC affordance metadata is inert data — allowed as a value.
      world.assertValidSemanticData({ asset: "service-drone", affordances: { animation: "hover_cycle" } }, "drone-7");
      // Provider objects (Blender/Three projections) in semantic state are rejected.
      try {
        world.assertValidSemanticData({ projection: new Object3D() }, "drone-7");
        console.log("LAYER3_FAILED provider object accepted");
        process.exit(1);
      } catch (err) {
        if (!/Object3D/.test(err.message)) { console.log("LAYER3_FAILED " + err.message); process.exit(1); }
      }
      world.assertNoProviderObjectsInState();
      console.log("LAYER3_OK");
    `;
    const proc = Bun.spawnSync([process.execPath, "-e", script], { stdout: "pipe", stderr: "pipe" });
    const out = proc.stdout.toString() + proc.stderr.toString();
    expect(proc.exitCode).toBe(0);
    expect(out).toContain("LAYER3_OK");
  });

  it("rejection (not silent filtering) is the contract", () => {
    expect(() => assertNoGameSemanticsInBlendMetadata(POISON, "poison fixture")).toThrow(BlendSemanticAuthorityError);
  });
});
