# T27 confirmation (independent_adversarial)

Task: Implement recipe contracts, studio recipe module, and CLI over the amended v0.4.0 spec.
Proof level: P2. Preregistration: `.agents/preregistrations/gauntlet-game-studio-plan-T27.prereg.yaml` (frozen).

## Gates observed

| Gate | Evidence | Result |
|------|----------|--------|
| `bun test packages/contracts packages/studio apps/studio-cli` (recipe suites included) | `artifacts/plan/T27/t27-test.txt` (re-run after timeout hardening: full workspace 406/0) | PASS |
| `python3 scripts/check-traceability.py …` | `artifacts/plan/T27/t27-trace.txt` | PASS (EXIT:0) |
| `bun run studio -- recipes --json` | `artifacts/plan/T27/t27-cli-gates.txt` | PASS (EXIT:0, 6 recipes) |
| `bun run studio -- recipe describe enemy.patrol --json` | same | PASS (EXIT:0) |
| `bun run source:verify` | `artifacts/plan/T27/t27-source.txt` | PASS |
| `bun run third-party:verify` | `artifacts/plan/T27/t27-third-party.txt` | PASS |
| `python3 scripts/check-topology.py` | `artifacts/plan/T27/t27-topology.txt` | PASS |
| `just ci` | `artifacts/plan/T27/t27-ci.txt`, final re-run `t27-ci-final.txt` | PASS (EXIT:0; final re-run after isolated Blender flake under load) |

## Teeth observed

| ID | Attack | Expected | Observed |
|----|--------|----------|----------|
| TEETH-T27-001 | Plan capability step with direct `provider` binding | Routing-authority reject; no route/provider invoked; no mutation | PASS — `RecipeAuthorityViolationError` / strict schema; `routeCalls==0`; no `.studio/` (`recipes.test.ts`) |
| TEETH-T27-002 | Asset affordance bound to non-`asset.resolve` capability | ASSET_POLICY_VIOLATION before any route; no mutation | PASS — typed reject, `routeCalls==0` |
| TEETH-T27-003 | Re-apply when affordances already satisfied | Steps satisfied; no duplicates; append-only provenance | PASS — all steps `satisfied`; provenance JSONL lines increase only |
| TEETH-T27-004 | Blocked dependency with bare failure string | Structured actionable failure; bare `recipe-failed` non-conformant | PASS — `structured_failure` with affordance/capability/recovery; detail ≠ `recipe-failed` |

Focused teeth run: `artifacts/plan/T27/t27-teeth.txt` (7 TEETH tests, 0 fail).

## Claims

- REQ-RECIPE-001..011 settled by contracts + `packages/studio/src/recipes/*` + CLI `recipes`/`recipe` surface.
- No parallel dispatcher: capability steps exclusively call injectable route defaulting to `routeCapability`.
- Provenance append-only under project `.studio/recipe-provenance.jsonl`, schema `gauntlet.recipe.apply`.

## Independent confirmation

Confirmation mode: independent_adversarial (P2). Focus recorded in prereg. Builder self-confirmation is not sufficient; a separate adversarial pass should re-run the gates/teeth above from the evidence files without trusting this narrative.

## Flaky evidence note

The real-Blender chain test (`packages/adapters/test/blender/blender-pipeline.test.ts`) is intermittently flaky under concurrent load (isolation sometimes 1 fail). Final settlement evidence uses sequential full-suite runs: `t27-bun-test-full.txt` = 411 pass / 0 fail; `just ci` (`t27-ci-final.txt`) Overall Status: SUCCESS. Flake is pre-existing load sensitivity, not recipe-layer related; `t27-blender-alone.txt` preserved as intermediate observation.
