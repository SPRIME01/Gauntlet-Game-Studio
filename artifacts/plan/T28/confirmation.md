# T28 confirmation (independent_adversarial)

Task: Integration, UX benchmark, cold-agent path, E2E settlement linkage for the recipe layer.
Proof level: P2. Preregistration: `.agents/preregistrations/gauntlet-game-studio-plan-T28.prereg.yaml` (frozen).

## Gates observed

| Gate | Evidence | Result |
|------|----------|--------|
| Canonical recipe E2E suites | `t28-recipes-e2e.txt` (24 pass / 0 fail) | PASS |
| UX benchmark artifact | `ux-benchmark.json` under `artifacts/plan/T28/` | PASS — all 6 recipes positive decision delta |
| Traceability (plan×spec) | `t28-trace.txt` | PASS (EXIT:0) |
| Topology | `t28-topology.txt` | PASS (EXIT:0) |
| `bun run source:verify` | `t28-source.txt` | PASS |
| `bun run third-party:verify` | `t28-third-party.txt` | PASS |
| Public CLI `recipes` + `recipe describe enemy.patrol` | `t28-cli-gates.txt` | PASS (EXIT:0) |
| Cold-agent dry-run (`recipe plan --json`) | `t28-cold-agent.txt`, `t28-cold-agent-plan.json` | PASS — `mutation: false`, 8 steps |
| `bun run studio -- verify --project examples/blackwater-relay --suite all --json` | `t28-blackwater-verify.json`, `t28-blackwater-verify-exit.txt` | PASS — exit 0, `all_settled: true`, settled=9 failed=0 |
| `just ci` (shared global gate) | `../T27/t27-ci-final.txt`, `t28-ci-final.txt` | PASS (EXIT:0); full suite 411 pass / 0 fail |

## Teeth observed

| ID | Attack | Expected | Observed |
|----|--------|----------|----------|
| TEETH-T28-001 | Parser-only evidence (compile without apply) claimed as settlement | Insufficient — no provenance/evidence linkage until apply E2E | PASS — `.studio` absent after compile-only; apply writes append-only provenance (`recipes-e2e.test.ts`) |
| TEETH-T28-002 | Cold-agent must reach RecipePlan from public CLI only | Plan reachable without engine/provider nouns or private modules | PASS — `recipe plan enemy.patrol --json` via public CLI; `mutation: false` |
| TEETH-T28-003 | Second evidence format bypassing Gauntlet | Verify steps only record acceptance linkage under `gauntlet.recipe.apply` | PASS — `validateRecipeApplyProvenance` strict; no alternate settlement schema |

## Claims

- REQ-RECIPE-012 (canonical recipes end-to-end) settled by catalog + CLI + E2E tests.
- REQ-RECIPE-013 (UX benchmark) settled by `ux-benchmark.json`: recipe path 28 decisions vs manual baseline 47 (19 saved); exposed concepts avg 2.5 vs 12.17; 13 capabilities still composed internally (composition preserved below).
- REQ-RECIPE-014 (settlement linkage) settled by blackwater `--suite all` green (9/9) without changing the settled reference game, plus provenance under shared contracts schema.

## Independent confirmation

Confirmation mode: independent_adversarial (P2). Focus in prereg. A separate adversarial pass should re-run the gates/teeth from these evidence files without trusting this narrative.
