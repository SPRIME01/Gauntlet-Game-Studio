# T27 summary

Recipe layer implementation above the capability system (spec v0.4.0, REQ-RECIPE-001..011).

## Delivered

- **Contracts**: `RecipeDescriptor`, `RecipePlan`, `RecipeApplyProvenance` (+ inputs/affordance/escalation), strict Zod, validators, tests (32 contracts tests green).
- **Studio**: `packages/studio/src/recipes/` — catalog (6 recipes), registry, compiler (affordance DAG → ordered plan, dry-run), apply (routeCapability, asset.resolve for asset affordances, structured failures, append-only provenance, authority/policy rejects).
- **CLI**: `recipes`, `recipe describe|plan|apply` with `--json` StudioResult; help updated.
- **Teeth**: routing-authority reject, asset-policy reject, idempotent re-apply, structured (never bare) failures.

## Not claimed

- Does not settle T28 UX/cold-agent/E2E gates (separate task).
- Does not change blackwater-relay or settled runtime authority.
