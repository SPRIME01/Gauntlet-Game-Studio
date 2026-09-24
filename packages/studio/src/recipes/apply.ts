/**
 * Recipe apply executor (REQ-RECIPE-003/007/008/009/010/014).
 *
 * - Capability steps call the injectable router (default: existing routeCapability).
 * - Asset capability steps flow through asset.resolve when invoked via CLI wiring;
 *   the executor itself never invents a provider path.
 * - Project steps write declarative project recipe content under `.studio/recipes/`
 *   (project-owned semantics; not a second ECS).
 * - Verify steps record acceptance linkage only; actual observation/settlement stays
 *   with existing observe/verify/Gauntlet channels.
 * - Provenance is append-only JSONL under `.studio/recipe-provenance.jsonl`.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type {
  CapabilityRequest,
  RecipeApplyProvenance,
  RecipeApplyStepRecord,
  RecipeDescriptor,
  RecipePlan,
} from "@gauntlet/contracts";
import {
  validateRecipeApplyProvenance,
  validateCapabilityRequest,
  validateRecipePlan,
} from "@gauntlet/contracts";
import { defaultCapabilityRegistry, type CapabilityRegistry } from "../capabilities/registry";
import { routeCapability, type RouteResolution } from "../router/router";

/** Thrown when a plan attempts to bypass routing authority or asset.resolve policy (T27 teeth). */
export class RecipeAuthorityViolationError extends Error {
  readonly code: "ROUTING_AUTHORITY_VIOLATION" | "ASSET_POLICY_VIOLATION";
  readonly failedAffordance?: string;
  readonly causalCapability?: string;
  constructor(
    code: RecipeAuthorityViolationError["code"],
    message: string,
    detail: { failedAffordance?: string; causalCapability?: string } = {}
  ) {
    super(message);
    this.name = "RecipeAuthorityViolationError";
    this.code = code;
    this.failedAffordance = detail.failedAffordance;
    this.causalCapability = detail.causalCapability;
  }
}

function assertNoRoutingBypass(plan: RecipePlan): void {
  // Strict schema: any step-level provider field is a routing-authority violation.
  for (const raw of plan.steps as Array<Record<string, unknown>>) {
    if ("provider" in raw || "preferred_provider" in raw) {
      throw new RecipeAuthorityViolationError(
        "ROUTING_AUTHORITY_VIOLATION",
        `Recipe plan step '${String(raw.id)}' carries a direct provider binding; ` +
          `provider selection is exclusive to routeCapability (REQ-RECIPE-003).`,
        { failedAffordance: String(raw.affordance ?? raw.id), causalCapability: String(raw.capability_id ?? "") }
      );
    }
  }
}

function assertAssetPolicy(plan: RecipePlan): void {
  // Affordances that acquire assets MUST compile to asset.resolve — never a side channel.
  for (const step of plan.steps) {
    if (step.kind !== "capability") continue;
    const isAssetAffordance =
      step.affordance.startsWith("resolved_") && step.affordance.endsWith("_asset");
    if (isAssetAffordance && step.capability_id && step.capability_id !== "asset.resolve") {
      throw new RecipeAuthorityViolationError(
        "ASSET_POLICY_VIOLATION",
        `Asset affordance '${step.affordance}' is bound to capability '${step.capability_id}' ` +
          `instead of asset.resolve; ordered search/acquire → adapt → create policy is mandatory (REQ-RECIPE-003).`,
        { failedAffordance: step.affordance, causalCapability: step.capability_id }
      );
    }
    // A capability step that claims an asset acquire without naming asset.resolve.
    if (
      step.capability_id &&
      step.capability_id !== "asset.resolve" &&
      (step.summary.toLowerCase().includes("acquire asset") ||
        step.summary.toLowerCase().includes("resolve asset"))
    ) {
      throw new RecipeAuthorityViolationError(
        "ASSET_POLICY_VIOLATION",
        `Step '${step.id}' attempts asset acquisition via '${step.capability_id}' rather than asset.resolve.`,
        { failedAffordance: step.affordance, causalCapability: step.capability_id }
      );
    }
  }
}

export type RecipeRouteFn = (
  request: CapabilityRequest,
  registry: CapabilityRegistry
) => RouteResolution;

export type RecipeApplyContext = {
  projectRoot: string;
  registry?: CapabilityRegistry;
  /** Injectable for tests; defaults to the studio capability router. */
  route?: RecipeRouteFn;
  now?: () => string;
  /** Probe for already-satisfied affordances (idempotent apply). */
  satisfiedAffordances?: (affordances: string[]) => string[];
  /** Optional evidence manifest ids to link when verify steps complete recording. */
  evidenceManifestIds?: string[];
  /** Prefix for generated capability request ids. */
  requestIdPrefix?: string;
};

export type RecipeApplyOutcome = {
  status: "success" | "blocked" | "failed" | "degraded";
  provenance: RecipeApplyProvenance;
  provenancePath: string;
  resolutions: Array<{ step_id: string; resolution?: RouteResolution }>;
  structured_failure?: {
    failed_affordance: string;
    causal_capability?: string;
    retryable: boolean;
    recovery_actions: string[];
    alternate_provider_available: boolean;
    user_input_required: boolean;
    detail: string;
  };
};

function provenancePathFor(projectRoot: string): string {
  return path.join(projectRoot, ".studio", "recipe-provenance.jsonl");
}

function appendProvenance(projectRoot: string, record: RecipeApplyProvenance): string {
  const file = provenancePathFor(projectRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
  return file;
}

function topoSteps(plan: RecipePlan): typeof plan.steps {
  const byId = new Map(plan.steps.map((s) => [s.id, s]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const out: typeof plan.steps = [];
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`Recipe plan step cycle at '${id}'`);
    visiting.add(id);
    const step = byId.get(id);
    if (!step) throw new Error(`Recipe plan references unknown step '${id}'`);
    for (const dep of step.depends_on) visit(dep);
    visiting.delete(id);
    visited.add(id);
    out.push(step);
  };
  for (const s of plan.steps) visit(s.id);
  return out;
}

function defaultSatisfiedProbe(projectRoot: string): (affordances: string[]) => string[] {
  // Project recipe application marker: once a step's project content exists, its
  // affordances can be treated as satisfied on re-apply (idempotence).
  return (affordances) => {
    const marker = path.join(projectRoot, ".studio", "recipes", `${"probe"}.json`);
    if (!fs.existsSync(marker)) {
      // Also honor per-recipe applied content written by project steps below.
      const recipesDir = path.join(projectRoot, ".studio", "recipes");
      if (!fs.existsSync(recipesDir)) return [];
      const applied = new Set<string>();
      for (const file of fs.readdirSync(recipesDir)) {
        if (!file.endsWith(".json")) continue;
        try {
          const data = JSON.parse(fs.readFileSync(path.join(recipesDir, file), "utf8")) as {
            affordances?: string[];
          };
          for (const a of data.affordances ?? []) applied.add(a);
        } catch {
          // ignore unreadable markers
        }
      }
      return affordances.filter((a) => applied.has(a));
    }
    return [];
  };
}

export async function applyRecipe(
  desc: RecipeDescriptor,
  plan: RecipePlan,
  ctx: RecipeApplyContext
): Promise<RecipeApplyOutcome> {
  if (plan.recipe_id !== desc.id) {
    throw new Error(`Plan recipe_id '${plan.recipe_id}' does not match descriptor '${desc.id}'`);
  }

  // Validate the plan first (strict schema rejects provider fields), then run
  // explicit authority/policy teeth before any route or project mutation.
  const validatedPlan = validateRecipePlan(plan);
  assertNoRoutingBypass(validatedPlan);
  assertAssetPolicy(validatedPlan);

  const registry = ctx.registry ?? defaultCapabilityRegistry;
  const route =
    ctx.route ??
    ((request: CapabilityRequest, reg: CapabilityRegistry) => routeCapability(request, reg));
  const now = ctx.now ?? (() => new Date().toISOString());
  const satisfiedProbe = ctx.satisfiedAffordances ?? defaultSatisfiedProbe(ctx.projectRoot);
  const preSatisfied = new Set(satisfiedProbe(desc.affordances));
  const prefix = ctx.requestIdPrefix ?? `recipe-${desc.id.replace(/\./g, "-")}`;

  const stepRecords: RecipeApplyStepRecord[] = [];
  const resolutions: Array<{ step_id: string; resolution?: RouteResolution }> = [];
  let result: RecipeApplyOutcome["status"] = "success";
  let structured_failure: RecipeApplyOutcome["structured_failure"];

  // Mutable apply-time statuses (superset of plan statuses; "failed" is apply-only).
  type ApplyStatus = "pending" | "satisfied" | "needs_creation" | "needs_modification" | "blocked" | "skipped" | "failed";
  const statusById = new Map<string, ApplyStatus>(plan.steps.map((s) => [s.id, s.status]));
  for (const s of plan.steps) {
    if (preSatisfied.has(s.affordance)) statusById.set(s.id, "satisfied");
  }

  const ordered = topoSteps(plan);

  for (const step of ordered) {
    // Honor dependency blockage.
    const blockedDep = step.depends_on.find((d) => {
      const st = statusById.get(d);
      return st === "blocked" || st === "failed";
    });
    if (blockedDep) {
      statusById.set(step.id, "blocked");
      if (result === "success") result = "blocked";
      stepRecords.push({
        step_id: step.id,
        kind: step.kind,
        affordance: step.affordance,
        outcome: "blocked",
        ...(step.capability_id ? { capability_id: step.capability_id } : {}),
        detail: `blocked by dependency step '${blockedDep}'`,
        artifacts: [],
        evidence_manifest_ids: [],
      });
      if (!structured_failure) {
        const depStep = plan.steps.find((s) => s.id === blockedDep);
        structured_failure = {
          failed_affordance: depStep?.affordance ?? step.affordance,
          ...(depStep?.capability_id
            ? { causal_capability: depStep.capability_id }
            : step.capability_id
              ? { causal_capability: step.capability_id }
              : {}),
          retryable: true,
          recovery_actions: [
            `Resolve blocked affordance '${depStep?.affordance ?? blockedDep}' first`,
            "Re-run recipe plan after the dependency is satisfied",
          ],
          alternate_provider_available: step.capability_id
            ? Boolean(registry.get(step.capability_id)?.providers?.length)
            : false,
          user_input_required: false,
          detail: `Step '${step.id}' blocked because dependency '${blockedDep}' did not succeed`,
        };
      }
      continue;
    }

    if (statusById.get(step.id) === "satisfied") {
      stepRecords.push({
        step_id: step.id,
        kind: step.kind,
        affordance: step.affordance,
        outcome: "satisfied",
        ...(step.capability_id ? { capability_id: step.capability_id } : {}),
        detail: "already satisfied; duplicate resources not recreated",
        artifacts: [],
        evidence_manifest_ids: [],
      });
      continue;
    }

    if (step.kind === "capability") {
      const capabilityId = step.capability_id;
      if (!capabilityId) {
        statusById.set(step.id, "failed");
        result = "failed";
        structured_failure = {
          failed_affordance: step.affordance,
          retryable: false,
          recovery_actions: ["Recompile recipe plan"],
          alternate_provider_available: false,
          user_input_required: false,
          detail: `Capability step '${step.id}' is missing capability_id`,
        };
        stepRecords.push({
          step_id: step.id,
          kind: step.kind,
          affordance: step.affordance,
          outcome: "failed",
          detail: "capability step missing capability_id",
          artifacts: [],
          evidence_manifest_ids: [],
        });
        continue;
      }
      // REQ-RECIPE-003: only the existing router may select providers.
      if (!registry.has(capabilityId)) {
        statusById.set(step.id, "blocked");
        result = "blocked";
        structured_failure = {
          failed_affordance: step.affordance,
          causal_capability: capabilityId,
          retryable: false,
          recovery_actions: ["Register the capability or choose a recipe that uses settled capabilities"],
          alternate_provider_available: false,
          user_input_required: false,
          detail: `Capability '${capabilityId}' is not registered`,
        };
        stepRecords.push({
          step_id: step.id,
          kind: step.kind,
          affordance: step.affordance,
          outcome: "blocked",
          capability_id: capabilityId,
          detail: `capability '${capabilityId}' not registered`,
          artifacts: [],
          evidence_manifest_ids: [],
        });
        continue;
      }

      const request = validateCapabilityRequest({
        id: `${prefix}-${step.id}`,
        project_id: path.basename(ctx.projectRoot),
        capability_id: capabilityId,
        intent: `${desc.summary} — establish affordance '${step.affordance}' for recipe ${desc.id}`,
        acceptance: desc.acceptance,
        inputs: { ...plan.choices, recipe_id: desc.id, affordance: step.affordance },
      });

      let resolution: RouteResolution;
      try {
        resolution = route(request, registry);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        statusById.set(step.id, "failed");
        result = "failed";
        structured_failure = {
          failed_affordance: step.affordance,
          causal_capability: capabilityId,
          retryable: true,
          recovery_actions: [
            "Inspect routing diagnostics and negative affordances",
            "Adjust recipe choices or project intent and re-plan",
          ],
          alternate_provider_available: (registry.get(capabilityId)?.providers.length ?? 0) > 1,
          user_input_required: false,
          detail: msg,
        };
        stepRecords.push({
          step_id: step.id,
          kind: step.kind,
          affordance: step.affordance,
          outcome: "failed",
          capability_id: capabilityId,
          detail: msg,
          artifacts: [],
          evidence_manifest_ids: [],
        });
        resolutions.push({ step_id: step.id });
        continue;
      }

      resolutions.push({ step_id: step.id, resolution });
      if (resolution.status === "blocked") {
        statusById.set(step.id, "blocked");
        result = "blocked";
        structured_failure = {
          failed_affordance: step.affordance,
          causal_capability: capabilityId,
          retryable: true,
          recovery_actions: [
            resolution.reason ?? "Provide missing inputs and re-plan",
            "Check provider availability without changing capability semantics",
          ],
          alternate_provider_available: (registry.get(capabilityId)?.providers.length ?? 1) > 1,
          user_input_required: true,
          detail: resolution.reason ?? `Capability '${capabilityId}' routed blocked`,
        };
        stepRecords.push({
          step_id: step.id,
          kind: step.kind,
          affordance: step.affordance,
          outcome: "blocked",
          capability_id: capabilityId,
          provider: resolution.provider,
          detail: resolution.reason ?? "routed blocked",
          artifacts: [],
          evidence_manifest_ids: [],
        });
        continue;
      }

      statusById.set(step.id, "needs_modification");
      stepRecords.push({
        step_id: step.id,
        kind: step.kind,
        affordance: step.affordance,
        outcome: "succeeded",
        capability_id: capabilityId,
        provider: resolution.provider,
        detail: resolution.is_agent_handoff
          ? `routed to agent-skill provider ${resolution.provider} (handoff requires real outputs before settlement)`
          : `routed to provider ${resolution.provider}`,
        artifacts: [],
        evidence_manifest_ids: [],
      });
      continue;
    }

    if (step.kind === "project") {
      // Declarative project content — not a second ECS; records which recipe affordances
      // the project now owns so re-apply can mark them satisfied (REQ-RECIPE-008).
      const recipesDir = path.join(ctx.projectRoot, ".studio", "recipes");
      fs.mkdirSync(recipesDir, { recursive: true });
      const contentPath = path.join(recipesDir, `${desc.id.replace(/\./g, "-")}.json`);
      let existing: { affordances?: string[]; steps?: string[] } = {};
      if (fs.existsSync(contentPath)) {
        try {
          existing = JSON.parse(fs.readFileSync(contentPath, "utf8"));
        } catch {
          existing = {};
        }
      }
      const affordances = Array.from(new Set([...(existing.affordances ?? []), step.affordance]));
      const stepsDone = Array.from(new Set([...(existing.steps ?? []), step.id]));
      fs.writeFileSync(
        contentPath,
        JSON.stringify(
          {
            schema: "gauntlet.recipe.project_content",
            schema_version: "1.0",
            recipe_id: desc.id,
            recipe_version: desc.version,
            choices: plan.choices,
            affordances,
            steps: stepsDone,
            updated_at: now(),
          },
          null,
          2
        ),
        "utf8"
      );
      statusById.set(step.id, "needs_modification");
      stepRecords.push({
        step_id: step.id,
        kind: step.kind,
        affordance: step.affordance,
        outcome: "succeeded",
        detail: `project recipe content updated at ${path.relative(ctx.projectRoot, contentPath)}`,
        artifacts: [{ path: path.relative(ctx.projectRoot, contentPath), role: "recipe_project_content" }],
        evidence_manifest_ids: [],
      });
      continue;
    }

    // verify step: record acceptance linkage only (REQ-RECIPE-014).
    statusById.set(step.id, "needs_modification");
    stepRecords.push({
      step_id: step.id,
      kind: step.kind,
      affordance: step.affordance,
      outcome: "succeeded",
      detail:
        "acceptance conditions recorded for existing observe/verify/Gauntlet channels; no alternate evidence format introduced",
      artifacts: [],
      evidence_manifest_ids: ctx.evidenceManifestIds ?? [],
    });
  }

  const recordedAt = now();
  const provenance = validateRecipeApplyProvenance({
    schema: "gauntlet.recipe.apply",
    schema_version: "1.0",
    id: `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    recipe_id: desc.id,
    recipe_version: desc.version,
    choices: plan.choices,
    steps: stepRecords,
    result,
    ...(structured_failure
      ? {
          failed_affordance: structured_failure.failed_affordance,
          ...(structured_failure.causal_capability
            ? { causal_capability: structured_failure.causal_capability }
            : {}),
          retryable: structured_failure.retryable,
          recovery_actions: structured_failure.recovery_actions,
          alternate_provider_available: structured_failure.alternate_provider_available,
          user_input_required: structured_failure.user_input_required,
        }
      : {}),
    evidence_manifest_ids: ctx.evidenceManifestIds ?? [],
    recorded_at: recordedAt,
  });

  const provenancePath = appendProvenance(ctx.projectRoot, provenance);

  return {
    status: result,
    provenance,
    provenancePath,
    resolutions,
    ...(structured_failure ? { structured_failure } : {}),
  };
}
