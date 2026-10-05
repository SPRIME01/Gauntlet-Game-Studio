import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadGameModel, gameSpecPathFor } from "../../src/model/model";
import {
  buildNormalizationPlan,
  persistNormalizationPlan,
  loadNormalizationPlan,
  recordNormalizationExecution,
  NormalizationError,
} from "../../src/normalize/plan";
import { assertProductionGlbAbi, isGeometryRole, isGltfRepresentation, GlbAbiError } from "../../src/normalize/abi";
import { validateDccJob, persistDccJob, loadDccJob, DccJobError } from "../../src/dcc/jobs";
import type { AssetRecord } from "@gauntlet/contracts";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), "gauntlet-normalize-"));
}

function writeModel(root: string, body: string): string {
  const dir = join(root, ".agents", "specs");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "game.spec.yaml");
  writeFileSync(path, body);
  return path;
}

const MODEL_WITH_LANGUAGES = `schema: gauntlet.game.model
schema_version: "2.0"
model_version: 1
identity:
  game_id: "lang-game"
  title: "Language Game"
languages:
  visual:
    summary: "hand-painted stylization, warm rim light"
  material:
    summary: "matte painted metal, roughness 0.6-0.9, desaturated base palette"
  animation:
    summary: "snappy 12-frame cycles, additive injury layers"
decisions:
  - n: 1
    version: 1
    summary: "art direction locked"
    touched: ["languages"]
`;

describe("normalization plans (REQ-NORM-001..002)", () => {
  test("plan binds transforms to declared model languages and records provenance", () => {
    const root = tmpProject();
    const model = loadGameModel(writeModel(root, MODEL_WITH_LANGUAGES));
    const plan = buildNormalizationPlan({
      id: "norm-robot",
      target: "polyhaven-robot",
      kind: "mesh",
      model,
      transforms: [
        { op: "scale", params: { factor: 0.01 }, reason: "source is in cm, model world is meters" },
        { op: "palette", params: {}, reason: "source palette is saturated; conform to material language" },
      ],
      source_provenance: { uri: "https://example.org/robot", license: "cc0", derived_from: [] },
    });
    expect(plan.model_reads).toContain("languages.material");
    expect(plan.model_reads).toContain("languages.visual");
    expect(plan.source_provenance.license).toBe("cc0");
    expect(plan.executed).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  test("a plan naming an undeclared language is rejected, not silently defaulted", () => {
    const root = tmpProject();
    const model = loadGameModel(writeModel(root, MODEL_WITH_LANGUAGES));
    expect(() =>
      buildNormalizationPlan({
        id: "norm-cloth",
        target: "cloak",
        kind: "mesh",
        model,
        transforms: [
          { op: "material-model", params: { model_language: "languages.fabric" }, reason: "cloth" },
        ],
        source_provenance: { license: "cc0" },
      }),
    ).toThrow(NormalizationError);
    rmSync(root, { recursive: true, force: true });
  });

  test("execution recording flips executed and appends verification refs; provenance never erased", () => {
    const root = tmpProject();
    const model = loadGameModel(writeModel(root, MODEL_WITH_LANGUAGES));
    const plan = buildNormalizationPlan({
      id: "norm-robot",
      target: "polyhaven-robot",
      kind: "mesh",
      model,
      transforms: [{ op: "scale", params: { factor: 0.01 }, reason: "cm to m" }],
      source_provenance: { uri: "https://example.org/robot", license: "cc0" },
    });
    persistNormalizationPlan(root, plan);
    const executed = recordNormalizationExecution(root, "norm-robot", ["gltf-transform-report-01"]);
    expect(executed.executed).toBe(true);
    expect(executed.execution_refs).toContain("gltf-transform-report-01");
    expect(executed.source_provenance.uri).toBe("https://example.org/robot");
    expect(loadNormalizationPlan(root, "norm-robot").executed).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("GLB production ABI (REQ-GLB-001)", () => {
  function asset(overrides: Partial<AssetRecord>): AssetRecord {
    return {
      id: "test-asset",
      role: "prop",
      origin: "cc0",
      construction_route: "asset.source/asset.polyhaven",
      source_provenance: { license: "cc0" },
      runtime_representation: "GLB/glTF",
      budget: {},
      acceptance_state: "pending",
      ...overrides,
    } as AssetRecord;
  }

  test("geometry roles require glTF/GLB representation", () => {
    expect(isGeometryRole("prop")).toBe(true);
    expect(isGeometryRole("hero")).toBe(true);
    expect(isGltfRepresentation("GLB/glTF")).toBe(true);
    assertProductionGlbAbi(asset({}));
    expect(() =>
      assertProductionGlbAbi(asset({ runtime_representation: "three.js Object3D dump" })),
    ).toThrow(GlbAbiError);
    expect(() =>
      assertProductionGlbAbi(asset({ runtime_representation: "fbx" })),
    ).toThrow(/provider object graphs|normalized glTF\/GLB/);
  });

  test("non-geometry resources keep their own representations", () => {
    assertProductionGlbAbi(asset({ role: "texture", runtime_representation: "webp-texture-set" }));
    assertProductionGlbAbi(asset({ role: "audio", runtime_representation: "wav" }));
  });

  test("acceptance evaluation carries the glb_abi gate", () => {
    // Covered through evaluateAsset in the assets suite; here verify the gate
    // blocks acceptance for a non-gltf geometry record via the full report.
    const { evaluateAsset } = require("../../src/assets/gates") as typeof import("../../src/assets/gates");
    const report = evaluateAsset(asset({ runtime_representation: "obj" }));
    const gate = report.results.find((r) => r.gate === "glb_abi");
    expect(gate?.status).toBe("fail");
    expect(report.production_acceptable).toBe(false);
  });
});

describe("structured DCC jobs (REQ-DCC-001..002)", () => {
  const baseJob = {
    schema: "gauntlet.dcc.job",
    schema_version: "1.0",
    id: "job-robot-cleanup",
    capability_id: "dcc.blender.process",
    inputs: ["polyhaven-robot"],
    operations: [{ op: "mesh-repair", params: {} }, { op: "lod-generate", params: { levels: 3 } }],
    cascade_rationale:
      "no accepted project or reservoir robot mesh exists; permissive providers carry no rigged variant with LODs; procedural adaptation cannot repair non-manifold geometry",
    cascade_attempts: [
      { stage: "acquire", target: "robot", outcome: "unavailable", detail: "no permissive rigged robot" },
    ],
    budgets: { max_minutes: 10 },
    outputs: [{ path: "assets/robot-normalized.glb", format: "glb" }],
    acceptance: ["non-manifold triangles = 0", "3 LOD levels present"],
    verification: "dcc.blender.process verify-result with deterministic reproduction",
  };

  test("a valid DCC job validates and persists", () => {
    const root = tmpProject();
    const job = validateDccJob(baseJob);
    expect(job.operations.length).toBe(2);
    const path = persistDccJob(root, job);
    expect(loadDccJob(root, "job-robot-cleanup").id).toBe("job-robot-cleanup");
    expect(path).toContain(".studio/dcc-jobs");
    rmSync(root, { recursive: true, force: true });
  });

  test("missing cascade rationale is typed-rejected naming the tooth", () => {
    const { cascade_rationale, ...without } = baseJob as Record<string, unknown>;
    void cascade_rationale;
    expect(() => validateDccJob(without)).toThrow(DccJobError);
    expect(() => validateDccJob(without)).toThrow(/cascade/i);
  });

  test("a copy-paste rationale with no cascade attempts is rejected", () => {
    expect(() =>
      validateDccJob({ ...baseJob, cascade_rationale: "easier", cascade_attempts: [] }),
    ).toThrow(/cheaper routes were searched/);
  });

  test("DCC jobs cannot name unknown capabilities", () => {
    expect(() => validateDccJob({ ...baseJob, capability_id: "world.gameplay.authority" })).toThrow(
      /not in the registry/,
    );
  });
});

describe("animation capability descriptors (REQ-ANIM-001..002)", () => {
  test("animation domain capabilities are registered with composition-first policy", () => {
    const { CAPABILITY_CATALOG } = require("../../src/capabilities/catalog") as typeof import("../../src/capabilities/catalog");
    for (const id of ["animation.rig", "animation.retarget", "animation.bake", "animation.validate"]) {
      const descriptor = CAPABILITY_CATALOG.find((c) => c.id === id);
      expect(descriptor).toBeDefined();
      expect(descriptor!.providers).toContain("dcc.blender");
    }
    const rig = CAPABILITY_CATALOG.find((c) => c.id === "animation.rig")!;
    expect(/composition-first|Composition-first|prefer an existing accepted rig/i.test(rig.summary)).toBe(true);
    const retarget = CAPABILITY_CATALOG.find((c) => c.id === "animation.retarget")!;
    expect(/runtime (graph transitions|animation blending)/i.test(retarget.do_not_use_when.join(" "))).toBe(true);
  });

  test("animation resource contracts express composition over bespoke creation", () => {
    const { AnimationResourceContractSchema } = require("@gauntlet/contracts") as typeof import("@gauntlet/contracts");
    const contract = AnimationResourceContractSchema.parse({
      schema: "gauntlet.animation.contract",
      schema_version: "1.0",
      id: "injured-rifle-walk",
      domain: "adaptation",
      skeleton: "standard-humanoid",
      clip_inventory: ["walk-cycle", "rifle-upper-body", "injured-additive"],
      composition: {
        base_clips: ["walk-cycle"],
        layers: [
          { clip: "rifle-upper-body", mode: "upper-body" },
          { clip: "injured-additive", mode: "additive" },
        ],
      },
      semantics: "enemy enters alerted injured locomotion",
    });
    expect(contract.composition?.layers.length).toBe(2);
  });
});
