import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  defaultRecipeRegistry,
  RecipeRegistry,
  compileRecipe,
  applyRecipe,
  RecipeCompileError,
} from "./index";
import { defaultCapabilityRegistry, routeCapability } from "../index";
import type { CapabilityRequest, RecipeDescriptor } from "@gauntlet/contracts";
import { validateRecipeDescriptor } from "@gauntlet/contracts";

describe("Recipe Layer Suite (T27)", () => {
  describe("Recipe Registry & Catalog (REQ-RECIPE-002, REQ-RECIPE-012)", () => {
    it("exposes the six canonical recipes", () => {
      const ids = defaultRecipeRegistry.list().map((r) => r.id).sort();
      expect(ids).toEqual([
        "checkpoint",
        "enemy.patrol",
        "interaction",
        "interaction.door-key",
        "interaction.pickup",
        "world.third-person",
      ]);
    });

    it("validates every catalog recipe through the shared contracts schema", () => {
      for (const recipe of defaultRecipeRegistry.list()) {
        expect(() => validateRecipeDescriptor(recipe)).not.toThrow();
        expect(recipe.capability_requirements.length).toBeGreaterThan(0);
        expect(recipe.affordances.length).toBeGreaterThan(0);
        expect(recipe.acceptance.length).toBeGreaterThan(0);
        // Outcome naming: no engine/provider nouns in recipe ids.
        expect(recipe.id).not.toMatch(/rapier|recast|koota|three|blender|needle/i);
      }
    });

    it("REJECTS registering an invalid recipe (Teeth Check)", () => {
      const registry = new RecipeRegistry([]);
      const bad = {
        id: "Bad Recipe ID with spaces!",
        version: "1.0.0",
        summary: "x".repeat(2000),
        use_when: [],
        do_not_use_when: [],
        inputs: [],
        affordances: [],
        affordance_dependencies: [],
        capability_requirements: [],
        constraints: [],
        escalation: { stop_and_ask_when: [], escalate_when: [] },
        acceptance: [],
      } as unknown as RecipeDescriptor;
      expect(() => registry.register(bad)).toThrow();
    });
  });

  describe("Recipe Compile (REQ-RECIPE-005, dry-run no mutation)", () => {
    let tmp: string;

    beforeEach(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), "recipe-compile-"));
    });

    afterEach(() => {
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    it("compiles world.third-person to an inspectable plan without mutating the project", () => {
      const recipe = defaultRecipeRegistry.get("world.third-person")!;
      const before = fs.readdirSync(tmp);
      const plan = compileRecipe(recipe, { now: () => "2026-09-23T00:00:00.000Z" });

      expect(plan.schema).toBe("gauntlet.recipe.plan");
      expect(plan.recipe_id).toBe("world.third-person");
      expect(plan.steps.length).toBeGreaterThan(0);
      expect(plan.affordance_graph.nodes.length).toBe(recipe.affordances.length);
      // Capability steps carry only declared capability requirements.
      const capabilitySteps = plan.steps.filter((s) => s.kind === "capability");
      expect(capabilitySteps.length).toBeGreaterThan(0);
      for (const step of capabilitySteps) {
        expect(step.capability_id).toBeDefined();
        expect(recipe.capability_requirements).toContain(step.capability_id!);
      }
      // No mutation
      expect(fs.readdirSync(tmp)).toEqual(before);
      expect(fs.existsSync(path.join(tmp, ".studio"))).toBe(false);
    });

    it("honors material choice overrides and defaults", () => {
      const recipe = defaultRecipeRegistry.get("enemy.patrol")!;
      const plan = compileRecipe(recipe, { choices: { on_detect: "alert-hold" } });
      expect(plan.choices.on_detect).toBe("alert-hold");
      expect(plan.choices.enemy_kind).toBe("drone"); // default
    });

    it("REJECTS required input missing with structured compile error (Teeth Check)", () => {
      const recipe: RecipeDescriptor = {
        ...defaultRecipeRegistry.get("interaction")!,
        inputs: [
          {
            key: "must_provide",
            label: "Must",
            required: true,
            material: true,
            type: "string",
            summary: "required with no default",
          },
        ],
      };
      expect(() => compileRecipe(recipe)).toThrow(RecipeCompileError);
      try {
        compileRecipe(recipe);
      } catch (err) {
        expect((err as RecipeCompileError).code).toBe("REQUIRED_INPUT_MISSING");
      }
    });

    it("REJECTS unknown choice keys (Teeth Check)", () => {
      const recipe = defaultRecipeRegistry.get("checkpoint")!;
      expect(() => compileRecipe(recipe, { choices: { not_a_key: 1 } })).toThrow(RecipeCompileError);
    });

    it("REJECTS enum value outside declared values (Teeth Check)", () => {
      const recipe = defaultRecipeRegistry.get("interaction.pickup")!;
      expect(() => compileRecipe(recipe, { choices: { grant: "nope" } })).toThrow(RecipeCompileError);
    });
  });

  describe("Recipe Apply through capability router (REQ-RECIPE-003, teeth)", () => {
    let tmp: string;

    beforeEach(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), "recipe-apply-"));
    });

    afterEach(() => {
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    it("TEETH-T27-001: rejects a plan whose capability step carries a direct provider binding (routing-authority violation)", async () => {
      const recipe = defaultRecipeRegistry.get("world.third-person")!;
      const plan = compileRecipe(recipe);
      const routeCalls: CapabilityRequest[] = [];
      // Craft a plan that injects provider selection onto a capability step.
      const bypassPlan = {
        ...plan,
        steps: plan.steps.map((s, i) =>
          i === 0 ? { ...s, provider: "bypassed.provider" } : s
        ),
      } as unknown as typeof plan;

      await expect(
        applyRecipe(recipe, bypassPlan, {
          projectRoot: tmp,
          route: (request) => {
            routeCalls.push(request);
            return {
              status: "routed",
              capability: defaultCapabilityRegistry.get(request.capability_id)!,
              provider: "bypassed.provider",
              is_agent_handoff: false,
            };
          },
        })
      ).rejects.toThrow(/provider binding|strict|unrecognized/i);

      // No provider was invoked and no project mutation occurred.
      expect(routeCalls.length).toBe(0);
      expect(fs.existsSync(path.join(tmp, ".studio"))).toBe(false);
    });

    it("TEETH-T27-001b: default route still selects providers only via routeCapability", async () => {
      const recipe = defaultRecipeRegistry.get("world.third-person")!;
      const plan = compileRecipe(recipe);
      const outcome = await applyRecipe(recipe, plan, { projectRoot: tmp });
      expect(outcome.resolutions.length).toBeGreaterThan(0);
      const first = outcome.resolutions.find((r) => r.resolution)?.resolution;
      expect(first?.status).toBe("routed");
      const direct = routeCapability({
        id: "direct-check",
        project_id: "probe",
        capability_id: first!.capability.id,
        intent: recipe.summary,
        acceptance: recipe.acceptance,
        inputs: {},
      });
      expect(direct.provider).toBe(first!.provider);
    });

    it("TEETH-T27-002-asset: rejects an asset affordance bound to a non-asset.resolve capability (asset-policy violation)", async () => {
      const recipe = defaultRecipeRegistry.get("interaction.pickup")!;
      const plan = compileRecipe(recipe);
      const assetSteps = plan.steps.filter((s) => s.affordance.startsWith("resolved_") && s.affordance.endsWith("_asset"));
      expect(assetSteps.length).toBeGreaterThan(0);
      const routeCalls: string[] = [];
      const badPlan = {
        ...plan,
        steps: plan.steps.map((s) =>
          s.affordance.startsWith("resolved_") && s.affordance.endsWith("_asset")
            ? { ...s, capability_id: "world.composition" }
            : s
        ),
      };

      let threw: unknown = null;
      try {
        await applyRecipe(recipe, badPlan, {
          projectRoot: tmp,
          route: (request) => {
            routeCalls.push(request.capability_id);
            return {
              status: "routed",
              capability: defaultCapabilityRegistry.get(request.capability_id)!,
              provider: defaultCapabilityRegistry.get(request.capability_id)!.providers[0],
              is_agent_handoff: false,
            };
          },
        });
      } catch (err) {
        threw = err;
      }

      expect(routeCalls.length).toBe(0);
      expect(threw).toBeTruthy();
      expect(String((threw as Error).message)).toMatch(/asset\.resolve|asset-policy|ASSET_POLICY/i);
      expect(String((threw as Error).name)).toContain("RecipeAuthorityViolation");
      expect(fs.existsSync(path.join(tmp, ".studio"))).toBe(false);
    });

    it("TEETH-T27-004b: never returns a bare 'recipe-failed' string; structured failure is mandatory", async () => {
      const recipe = defaultRecipeRegistry.get("world.third-person")!;
      const plan = compileRecipe(recipe);
      const outcome = await applyRecipe(recipe, plan, {
        projectRoot: tmp,
        route: (request) => ({
          status: "blocked",
          capability: defaultCapabilityRegistry.get(request.capability_id)!,
          provider: defaultCapabilityRegistry.get(request.capability_id)!.providers[0],
          is_agent_handoff: false,
          reason: "forced blocked dependency",
        }),
      });
      expect(outcome.status).not.toBe("success");
      expect(outcome.structured_failure).toBeDefined();
      const sf = outcome.structured_failure!;
      expect(typeof sf.failed_affordance).toBe("string");
      expect(sf.failed_affordance.length).toBeGreaterThan(0);
      expect(sf.recovery_actions.length).toBeGreaterThan(0);
      // Bare string failures are non-conformant: the outcome object must carry structure, not just a message.
      expect(typeof outcome).toBe("object");
      expect(JSON.stringify(outcome)).not.toMatch(/"recipe-failed"$/);
      expect(sf.detail).not.toBe("recipe-failed");
    });

    it("TEETH-T27-002: already-satisfied affordances are not recreated on re-apply", async () => {
      const recipe = defaultRecipeRegistry.get("interaction.pickup")!;
      const plan = compileRecipe(recipe);
      const first = await applyRecipe(recipe, plan, {
        projectRoot: tmp,
        route: () => ({
          status: "routed",
          capability: defaultCapabilityRegistry.get("asset.resolve")!,
          provider: "asset.polyhaven",
          is_agent_handoff: false,
        }),
        satisfiedAffordances: () => [],
      });
      expect(first.status).toBe("success");
      const firstContent = path.join(tmp, ".studio", "recipes", "interaction-pickup.json");
      expect(fs.existsSync(firstContent)).toBe(true);
      const firstStat = fs.statSync(firstContent).mtimeMs;

      // Second apply: probe reports all affordances satisfied (idempotence).
      const second = await applyRecipe(recipe, plan, {
        projectRoot: tmp,
        satisfiedAffordances: (aff) => aff,
        now: () => "2026-09-23T00:00:01.000Z",
      });
      expect(second.status).toBe("success");
      const satisfiedSteps = second.provenance.steps.filter((s) => s.outcome === "satisfied");
      expect(satisfiedSteps.length).toBe(plan.steps.length);
      expect(satisfiedSteps.some((s) => s.detail.includes("already satisfied"))).toBe(true);
      // Project content not rewritten when everything is already satisfied.
      expect(fs.statSync(firstContent).mtimeMs).toBe(firstStat);
    });

    it("TEETH-T27-003: default probe marks previously written project affordances satisfied (idempotent re-apply)", async () => {
      const recipe = defaultRecipeRegistry.get("checkpoint")!;
      const plan = compileRecipe(recipe);
      const route = () => ({
        status: "routed" as const,
        capability: defaultCapabilityRegistry.get("asset.resolve")!,
        provider: "asset.polyhaven",
        is_agent_handoff: false,
      });
      const first = await applyRecipe(recipe, plan, { projectRoot: tmp, route });
      expect(first.status).toBe("success");

      const second = await applyRecipe(recipe, plan, { projectRoot: tmp, route });
      expect(second.status).toBe("success");
      const satisfied = second.provenance.steps.filter((s) => s.outcome === "satisfied");
      // Project steps written in first apply are satisfied on second via default probe.
      const projectSatisfied = satisfied.filter((s) => s.kind === "project");
      expect(projectSatisfied.length).toBeGreaterThan(0);
      // Provenance is append-only: two lines.
      const provPath = path.join(tmp, ".studio", "recipe-provenance.jsonl");
      const lines = fs.readFileSync(provPath, "utf8").trim().split("\n");
      expect(lines.length).toBe(2);
    });

    it("TEETH-T27-004: blocked route yields structured actionable failure and append-only provenance", async () => {
      const recipe = defaultRecipeRegistry.get("world.third-person")!;
      const plan = compileRecipe(recipe);
      const outcome = await applyRecipe(recipe, plan, {
        projectRoot: tmp,
        route: (request) => ({
          status: "blocked",
          capability: defaultCapabilityRegistry.get(request.capability_id)!,
          provider: defaultCapabilityRegistry.get(request.capability_id)!.providers[0],
          is_agent_handoff: false,
          reason: "missing required project intent inputs",
        }),
      });

      expect(outcome.status).toBe("blocked");
      expect(outcome.structured_failure).toBeDefined();
      expect(outcome.structured_failure!.failed_affordance).toBeTruthy();
      expect(outcome.structured_failure!.causal_capability).toBeTruthy();
      expect(outcome.structured_failure!.retryable).toBe(true);
      expect(outcome.structured_failure!.recovery_actions.length).toBeGreaterThan(0);
      expect(outcome.structured_failure!.user_input_required).toBe(true);
      expect(outcome.provenance.result).toBe("blocked");
      expect(outcome.provenance.failed_affordance).toBe(outcome.structured_failure!.failed_affordance);

      const provPath = path.join(tmp, ".studio", "recipe-provenance.jsonl");
      expect(fs.existsSync(provPath)).toBe(true);
      const lines = fs.readFileSync(provPath, "utf8").trim().split("\n");
      expect(lines.length).toBe(1);
      const parsed = JSON.parse(lines[0]);
      expect(parsed.schema).toBe("gauntlet.recipe.apply");
      expect(parsed.result).toBe("blocked");
      expect(parsed.retryable).toBe(true);
    });

    it("blocks downstream steps when a dependency capability step fails (affordance DAG, not pipeline)", async () => {
      const recipe = defaultRecipeRegistry.get("world.third-person")!;
      const plan = compileRecipe(recipe);
      let call = 0;
      const outcome = await applyRecipe(recipe, plan, {
        projectRoot: tmp,
        route: (request) => {
          call += 1;
          if (call === 1) {
            throw new Error("provider exploded");
          }
          return {
            status: "routed",
            capability: defaultCapabilityRegistry.get(request.capability_id)!,
            provider: "ok",
            is_agent_handoff: false,
          };
        },
      });
      expect(outcome.status).toBe("failed");
      expect(outcome.structured_failure?.causal_capability).toBeTruthy();
      const blockedSteps = outcome.provenance.steps.filter((s) => s.outcome === "blocked");
      expect(blockedSteps.length).toBeGreaterThan(0);
      expect(blockedSteps[0].detail).toContain("blocked by dependency");
    });

    it("REJECTS plan/descriptor id mismatch (Teeth Check)", async () => {
      const a = defaultRecipeRegistry.get("checkpoint")!;
      const b = defaultRecipeRegistry.get("interaction")!;
      const plan = compileRecipe(b);
      await expect(applyRecipe(a, plan, { projectRoot: tmp })).rejects.toThrow(/does not match/);
    });

    it("does not bypass asset.resolve for asset affordances: default route uses registered capability only", async () => {
      const recipe = defaultRecipeRegistry.get("interaction.door-key")!;
      const plan = compileRecipe(recipe);
      const outcome = await applyRecipe(recipe, plan, { projectRoot: tmp });
      const assetSteps = plan.steps.filter((s) => s.capability_id === "asset.resolve");
      expect(assetSteps.length).toBeGreaterThan(0);
      const resolvedAsset = outcome.resolutions
        .map((r) => r.resolution)
        .filter((r) => r?.capability.id === "asset.resolve");
      expect(resolvedAsset.length).toBe(assetSteps.length);
      for (const r of resolvedAsset) {
        // Registered provider only — no invented provider ids.
        expect(defaultCapabilityRegistry.get("asset.resolve")!.providers).toContain(r!.provider);
      }
    });
  });

  describe("Default route compatibility", () => {
    it("routeCapability still owns provider selection when apply uses defaults", async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "recipe-default-route-"));
      try {
        const recipe = defaultRecipeRegistry.get("interaction")!;
        const plan = compileRecipe(recipe);
        const outcome = await applyRecipe(recipe, plan, { projectRoot: tmp });
        expect(outcome.resolutions.length).toBeGreaterThan(0);
        const routed = outcome.resolutions.map((r) => r.resolution).filter(Boolean);
        expect(routed.length).toBeGreaterThan(0);
        // Cross-check first capability resolution against a direct routeCapability call.
        const first = routed[0]!;
        const direct = routeCapability({
          id: "direct-check",
          project_id: "probe",
          capability_id: first.capability.id,
          intent: recipe.summary,
          acceptance: recipe.acceptance,
          inputs: {},
        });
        expect(direct.provider).toBe(first.provider);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });
  });
});
