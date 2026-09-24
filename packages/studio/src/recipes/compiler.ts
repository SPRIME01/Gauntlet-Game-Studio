/**
 * Recipe compiler — turns a RecipeDescriptor + resolved choices into an inspectable
 * RecipePlan (affordance DAG + ordered typed steps) WITHOUT mutating the project
 * (REQ-RECIPE-005).
 *
 * Compilation is declarative: steps are derived from affordance dependencies and
 * declared capability requirements. Capability-kind steps always name a capability
 * from the recipe's capability_requirements; apply later routes them through the
 * existing capability registry/router only.
 */
import type { RecipeDescriptor, RecipePlan, RecipePlanStep } from "@gauntlet/contracts";
import { validateRecipePlan } from "@gauntlet/contracts";

export type RecipeCompileOptions = {
  /** Override/merge caller choices; missing required inputs without defaults throw. */
  choices?: Record<string, unknown>;
  now?: () => string;
  /**
   * Probe already-satisfied affordances for dry-run status (REQ-RECIPE-008).
   * Returns affordance ids that already hold in the target project.
   */
  satisfiedAffordances?: (affordances: string[]) => string[];
};

export class RecipeCompileError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "RecipeCompileError";
    this.code = code;
  }
}

function resolveChoices(desc: RecipeDescriptor, input: Record<string, unknown> | undefined): Record<string, unknown> {
  const choices: Record<string, unknown> = {};
  const provided = input ?? {};

  for (const key of Object.keys(provided)) {
    const declared = desc.inputs.find((i) => i.key === key);
    if (!declared) {
      throw new RecipeCompileError(
        "UNKNOWN_CHOICE",
        `Recipe '${desc.id}' does not declare input '${key}'`
      );
    }
  }

  for (const field of desc.inputs) {
    const providedValue = provided[field.key];
    if (providedValue !== undefined && providedValue !== null) {
      if (field.type === "enum" && field.enum_values && !field.enum_values.includes(String(providedValue))) {
        throw new RecipeCompileError(
          "INVALID_CHOICE",
          `Input '${field.key}' must be one of: ${field.enum_values.join(", ")}`
        );
      }
      choices[field.key] = providedValue;
      continue;
    }
    if (field.default !== undefined && field.default !== null && field.default !== "") {
      choices[field.key] = field.default;
      continue;
    }
    if (field.required) {
      throw new RecipeCompileError(
        "REQUIRED_INPUT_MISSING",
        `Recipe '${desc.id}' requires input '${field.key}' (${field.summary})`
      );
    }
    // Optional with no default: omit (caller did not care).
  }
  return choices;
}

/**
 * Derive ordered steps from affordance dependencies.
 *
 * For each affordance:
 * - if already satisfied → status satisfied
 * - if it maps to a declared capability requirement (via step plan below) → capability step
 * - if it is a terminal verify affordance (ends with _scenario or is acceptance-related) → verify step
 * - otherwise → project step (semantic content mutation owned by the game project)
 *
 * Step depends_on are earlier steps that produce required affordances (affordance
 * dependency DAG → step edges), not an arbitrary linear pipeline.
 */
function buildSteps(desc: RecipeDescriptor, satisfied: Set<string>): RecipePlanStep[] {
  const affordanceToCapability = new Map<string, string>();
  // Map each affordance to a capability when the recipe declares a natural owner.
  const capabilityByAffordance: Record<string, string> = {
    canonical_terrain: "world.terrain",
    environment_composition: "world.composition",
    player_physics_projection: "world.physics",
    navigation_mesh: "world.navigation",
    navigation_agent: "world.navigation",
    enemy_physics_projection: "world.physics",
    resolved_enemy_asset: "asset.resolve",
    resolved_interactable_asset: "asset.resolve",
    resolved_pickup_asset: "asset.resolve",
    resolved_door_asset: "asset.resolve",
    resolved_key_asset: "asset.resolve",
    resolved_checkpoint_asset: "asset.resolve",
    interaction_focus: "world.spatial",
    checkpoint_trigger: "world.spatial",
    patrol_scenario: "verify.browser",
  };
  for (const [aff, cap] of Object.entries(capabilityByAffordance)) {
    if (desc.capability_requirements.includes(cap)) {
      affordanceToCapability.set(aff, cap);
    }
  }

  const requiresOf = new Map<string, string[]>();
  for (const edge of desc.affordance_dependencies) {
    const list = requiresOf.get(edge.required_by) ?? [];
    list.push(edge.requires);
    requiresOf.set(edge.required_by, list);
  }

  // Topological order over affordances (stable: declaration order as tiebreak).
  const ordered: string[] = [];
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (node: string): void => {
    if (done.has(node)) return;
    if (visiting.has(node)) {
      throw new RecipeCompileError(
        "AFFORDANCE_CYCLE",
        `Affordance dependency cycle detected at '${node}' in recipe '${desc.id}'`
      );
    }
    visiting.add(node);
    for (const req of requiresOf.get(node) ?? []) {
      if (!desc.affordances.includes(req)) {
        throw new RecipeCompileError(
          "UNKNOWN_AFFORDANCE",
          `Recipe '${desc.id}' dependency references unknown affordance '${req}'`
        );
      }
      visit(req);
    }
    visiting.delete(node);
    done.add(node);
    ordered.push(node);
  };
  for (const aff of desc.affordances) visit(aff);

  const affordanceToStepId = new Map<string, string>();
  const steps: RecipePlanStep[] = [];

  for (const aff of ordered) {
    const stepId = aff.replace(/[^a-z0-9]+/gi, "-");
    const dependencyAffordances = requiresOf.get(aff) ?? [];
    const depends_on = dependencyAffordances
      .map((a) => affordanceToStepId.get(a))
      .filter((id): id is string => Boolean(id));

    let kind: RecipePlanStep["kind"] = "project";
    const capability_id = affordanceToCapability.get(aff);
    if (capability_id) kind = "capability";
    if (aff.endsWith("_scenario")) kind = "verify";

    let status: RecipePlanStep["status"] = "pending";
    let reason: string | undefined;
    if (satisfied.has(aff)) {
      status = "satisfied";
      reason = "affordance already satisfied in project probe";
    } else if (kind === "capability") {
      status = "needs_creation";
    } else if (kind === "verify") {
      status = "pending";
    } else {
      status = "needs_creation";
    }

    steps.push({
      id: stepId,
      kind,
      affordance: aff,
      summary: kind === "capability"
        ? `Invoke capability ${capability_id} to establish '${aff}'`
        : kind === "verify"
          ? `Verify acceptance affordance '${aff}' through existing observe/verify channels`
          : `Establish project affordance '${aff}' (${aff})`,
      ...(capability_id ? { capability_id } : {}),
      depends_on,
      status,
      ...(reason ? { reason } : {}),
    });
    affordanceToStepId.set(aff, stepId);
  }

  return steps;
}

export function compileRecipe(desc: RecipeDescriptor, options: RecipeCompileOptions = {}): RecipePlan {
  const choices = resolveChoices(desc, options.choices);
  const satisfiedList = options.satisfiedAffordances?.(desc.affordances) ?? [];
  const satisfied = new Set(satisfiedList);

  const steps = buildSteps(desc, satisfied);
  const edges = desc.affordance_dependencies.map((e) => ({
    from: e.requires,
    to: e.required_by,
  }));

  const plan: RecipePlan = {
    schema: "gauntlet.recipe.plan",
    schema_version: "1.0",
    recipe_id: desc.id,
    recipe_version: desc.version,
    choices,
    affordance_graph: {
      nodes: [...desc.affordances],
      edges,
    },
    steps,
    created_at: (options.now ?? (() => new Date().toISOString()))(),
  };

  return validateRecipePlan(plan);
}
