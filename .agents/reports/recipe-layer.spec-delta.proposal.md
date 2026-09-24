# Spec delta proposal: recipe layer above the capability layer

- status: PROPOSAL — not normative until formal spec amendment + plan rebinding
- date: 2026-09-23
- companion discovery: `.agents/reports/recipe-layer.discovery.md`
- authorization source: operator recipe-layer request (full text `/tmp/opencode/recipe-request-full.md`), including
  “create the appropriate scoped spec/plan under .agents/ following the existing project conventions” and
  “treat the recipe layer as a new post-baseline improvement”
- timing: prepared against approved spec v0.3.0 (SHA-256 `b020a49d…`); amendment target v0.4.0

## Motivation

The capability layer routes and constrains work, but callers still compose low-level capabilities
by hand. The recipe layer adds an outcome vocabulary: `intent → recipe → capabilities → runtime`,
compiled through the existing router — not a parallel implementation path.

## Proposed normative group

New `core_behavior_requirements.recipe_composition` group. Draft IDs finalized at amendment time
as **REQ-RECIPE-001..014** to fit the settlement tooling identifier convention.

### Composition and authority

- **REQ-RECIPE-001**: The studio MUST expose a recipe layer above capabilities so callers can
  express game-development outcomes as `intent → recipe → capabilities → runtime`. Recipes MUST
  compile into the existing capability system; a parallel implementation path MUST NOT exist.
- **REQ-RECIPE-002**: Each recipe MUST be described by a machine-readable, primarily declarative
  RecipeDescriptor covering identity/version, human-oriented summary, use_when, do_not_use_when,
  required and optional inputs with defaults, affordances produced, affordance dependencies,
  capability requirements, constraints, escalation/stop conditions, and acceptance conditions —
  reusing existing contract naming where it already fits.
- **REQ-RECIPE-003**: Recipe execution MUST invoke capabilities exclusively through the existing
  capability registry/router (`routeCapability` or its settled equivalent). A second router,
  orchestration authority, or provider dispatcher MUST NOT be introduced.
- **REQ-RECIPE-004**: Recipes MUST NOT become semantic authority. Koota remains authoritative
  state; Three.js rendering; Rapier physics; Recast navigation; providers replaceable; AssetRecords
  provenance; Gauntlet settlement. Recipes describe outcome, affordances, dependencies, defaults,
  choices, and acceptance only.
- **REQ-RECIPE-005**: The studio MUST support dry-run planning: resolving a recipe + resolved
  choices into an inspectable RecipePlan (affordance DAG and ordered steps with status
  satisfied / needs_creation / needs_modification / blocked / skipped) before mutation.
- **REQ-RECIPE-006**: Recipe names and exposed inputs MUST use outcome vocabulary meaningful to a
  novice. Only choices that materially affect the result SHOULD be exposed; all other configuration
  MUST receive strong defaults. Implementation detail MAY appear in expert inspection but MUST NOT
  define the user-facing abstraction.
- **REQ-RECIPE-007**: Recipe steps that require 3D assets MUST flow through the existing
  `asset.resolve` ordered policy (search/acquire → adapt → create). Recipes MUST NOT hardcode a
  specific provider unless the recipe exists specifically to prove that provider.
- **REQ-RECIPE-008**: Recipe apply MUST reason about already-satisfied affordances, partial
  completion, retries, resumability, and duplicate application; it MUST NOT blindly recreate
  resources that already satisfy the recipe.
- **REQ-RECIPE-009**: Recipe failure results MUST be structured and actionable: failed affordance,
  causal capability, evidence reference, retryability, available safe recovery actions, whether
  another provider can satisfy the same affordance, and whether user input is required. A bare
  “recipe failed” is non-conformant.
- **REQ-RECIPE-010**: Applying a recipe MUST record an append-only structured provenance record
  linking recipe id/version → resolved choices/defaults → capabilities invoked → providers
  selected → artifacts produced → verification/evidence → result, available to humans as a
  concise summary and to agents/Gauntlet in full.
- **REQ-RECIPE-011**: The semantic CLI MUST expose recipe discovery and operation consistent with
  existing conventions (equivalents of `studio recipes`, `studio recipe describe|plan|apply`) with
  stable `--json` / StudioResult behavior. Redundant `make`/`add` semantics MUST NOT be created if
  an existing command already provides the surface.
- **REQ-RECIPE-012**: The studio MUST ship a small canonical recipe set (roughly 5–8) that proves
  the abstraction across composition patterns — at minimum a third-person world base, patrolling
  enemy, interactable, pickup, door/key dependency, and checkpoint; dialogue or multiplayer player
  only when they exercise meaningfully different substrate.
- **REQ-RECIPE-013**: A cold coding agent MUST be able to discover recipes, understand use/do-not-use,
  inspect required vs default inputs, generate a dry-run plan, apply, inspect evidence, and recover
  from failure using only the public discovery/CLI surface — without reading recipe-engine source.
- **REQ-RECIPE-014**: Recipe acceptance MUST be verified through the existing observe / verify /
  Gauntlet channels and evidence manifests. Recipe apply MUST NOT introduce a second evidence
  format or bypass settlement.

### Domain model additions

- **RecipeDescriptor** — stable outcome-level composition unit (fields per REQ-RECIPE-002).
- **RecipePlan** — dry-run expansion: recipe id/version, resolved choices, affordance dependency
  DAG, ordered steps (`capability` | `project` | `verify`) with per-step status and provenance.

### Conformance_traceability addition

New high-risk group **Recipe composition and authority preservation**
(REQ-RECIPE-001..014), confirmation mode: **adversarial** (at minimum: a recipe cannot bypass
authority/provenance/verification boundaries).

### System / CLI touch-ups at amendment time

- `core_behavior_requirements.cli_and_operator_surface`: no duplicate REQ; recipe commands are
  covered by REQ-RECIPE-011 to keep single mapping.
- README / docs updates are implementation follow-through, not new REQ IDs.

## Acceptance/falsification sketch (for the amendment plan)

- Tooth 1: a recipe plan that skips `routeCapability` and invents a direct provider call is rejected.
- Tooth 2: apply of a recipe whose asset step skips `asset.resolve` ordered policy is typed-rejected.
- Tooth 3: re-apply when affordances are already satisfied reports `satisfied` and does not recreate.
- Tooth 4: blocked dependency yields structured actionable failure (failed affordance + causal
  capability + recovery), not a bare failure string.
- Tooth 5: provenance record is append-only and links to evidence; missing linkage fails.
- Cold-agent test: start from `studio recipes` only and reach a dry-run plan for `enemy.patrol`.
- UX benchmark: count user decisions, commands, and exposed implementation concepts for each
  canonical recipe; report measured reduction vs manual capability composition.

## Explicit non-goals

- No retroactive modification of settled historical evidence or frozen games.
- No second capability router, evidence format, ECS, workflow framework, or per-recipe package.
- No redesign of settled runtime architecture.
- No requirement that Blender, toktx, WebRTC, or donor source participate in normal recipes.
