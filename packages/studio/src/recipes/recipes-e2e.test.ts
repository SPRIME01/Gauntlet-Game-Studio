import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { defaultRecipeRegistry, compileRecipe, applyRecipe } from "./index";
import { defaultCapabilityRegistry } from "../index";
import { validateRecipeApplyProvenance } from "@gauntlet/contracts";

describe("Recipe E2E & Cold-Agent Suite (T28)", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "recipe-e2e-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("canonical set is complete and engine-noun free (REQ-RECIPE-012)", () => {
    const ids = defaultRecipeRegistry.list().map((r) => r.id).sort();
    expect(ids).toEqual([
      "checkpoint",
      "enemy.patrol",
      "interaction",
      "interaction.door-key",
      "interaction.pickup",
      "world.third-person",
    ]);
    for (const r of defaultRecipeRegistry.list()) {
      expect(r.id).not.toMatch(/rapier|recast|koota|three|blender|needle|playwright/i);
      expect(r.use_when.length).toBeGreaterThan(0);
      expect(r.acceptance.length).toBeGreaterThan(0);
    }
  });

  it("cold-agent path: describe+plan only (public surface) reaches inspectable plan with mutation:false", () => {
    // Simulates TEETH-T28-002: only public registry/describe/compile — no engine source.
    const recipe = defaultRecipeRegistry.get("enemy.patrol")!;
    expect(recipe).toBeDefined();
    expect(recipe.use_when.some((u) => u.includes("patrol"))).toBe(true);
    const plan = compileRecipe(recipe, { choices: { on_detect: "alert-hold" } });
    expect(plan.schema).toBe("gauntlet.recipe.plan");
    expect(plan.choices.on_detect).toBe("alert-hold");
    expect(plan.steps.length).toBeGreaterThan(0);
    // Dry-run: no project mutation
    expect(fs.existsSync(path.join(tmp, ".studio"))).toBe(false);
  });

  it("E2E apply through existing capabilities writes append-only provenance and project content (REQ-RECIPE-013/014)", async () => {
    const recipe = defaultRecipeRegistry.get("interaction.pickup")!;
    const plan = compileRecipe(recipe);
    const outcome = await applyRecipe(recipe, plan, { projectRoot: tmp });
    expect(outcome.status).toBe("success");
    expect(outcome.provenance.schema).toBe("gauntlet.recipe.apply");
    // Provenance validates under shared contracts — no second evidence format.
    expect(() => validateRecipeApplyProvenance(outcome.provenance)).not.toThrow();
    const provPath = path.join(tmp, ".studio", "recipe-provenance.jsonl");
    expect(fs.existsSync(provPath)).toBe(true);
    const lines = fs.readFileSync(provPath, "utf8").trim().split("\n");
    expect(lines.length).toBe(1);
    // Capability steps routed through default registry only.
    const capIds = new Set(
      outcome.provenance.steps.map((s) => s.capability_id).filter(Boolean)
    );
    for (const id of capIds) {
      expect(defaultCapabilityRegistry.has(id as string)).toBe(true);
    }
    // Project content exists for owned affordances.
    const content = path.join(tmp, ".studio", "recipes", "interaction-pickup.json");
    expect(fs.existsSync(content)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(content, "utf8"));
    expect(parsed.recipe_id).toBe("interaction.pickup");
    expect(parsed.affordances.length).toBeGreaterThan(0);
  });

  it("verify steps only record acceptance linkage — no alternate evidence format (REQ-RECIPE-014)", async () => {
    // enemy.patrol is the canonical recipe with a verify affordance (patrol_scenario).
    const recipe = defaultRecipeRegistry.get("enemy.patrol")!;
    const plan = compileRecipe(recipe);
    expect(plan.steps.filter((s) => s.kind === "verify").length).toBeGreaterThan(0);
    const outcome = await applyRecipe(recipe, plan, {
      projectRoot: tmp,
      evidenceManifestIds: ["manifest-e2e-001"],
    });
    expect(outcome.status).toBe("success");
    const verifySteps = outcome.provenance.steps.filter((s) => s.kind === "verify");
    expect(verifySteps.length).toBeGreaterThan(0);
    for (const s of verifySteps) {
      expect(s.detail).toContain("observe/verify/Gauntlet");
      expect(s.evidence_manifest_ids).toContain("manifest-e2e-001");
      // Never invents a parallel settlement channel.
      expect(s.detail).not.toMatch(/secondary evidence|alternate settlement/i);
    }
    // Provenance uses the single shared schema — validate strictly.
    expect(() => validateRecipeApplyProvenance(outcome.provenance)).not.toThrow();
  });

  it("TEETH-T28-001: parser-only evidence is insufficient — apply E2E is required for settlement linkage", async () => {
    // Parser-only: compile succeeds but nothing is written (no apply).
    const recipe = defaultRecipeRegistry.get("world.third-person")!;
    compileRecipe(recipe);
    expect(fs.existsSync(path.join(tmp, ".studio"))).toBe(false);
    // Without apply there is no provenance and no evidence linkage to settle.
    const provPath = path.join(tmp, ".studio", "recipe-provenance.jsonl");
    expect(fs.existsSync(provPath)).toBe(false);

    // E2E apply supplies the linkage the gate requires.
    const plan = compileRecipe(recipe);
    const outcome = await applyRecipe(recipe, plan, { projectRoot: tmp });
    expect(outcome.status).toBe("success");
    expect(fs.existsSync(provPath)).toBe(true);
    const rec = JSON.parse(fs.readFileSync(provPath, "utf8").trim().split("\n")[0]);
    expect(rec.schema).toBe("gauntlet.recipe.apply");
    expect(rec.evidence_manifest_ids).toBeDefined();
  });
});
