# Task Settlement Summary: T25

**Task ID**: T25
**Title**: Run final traceability, clean reproduction, and whole-studio independent confirmation
**Proof Level**: P3
**Confirmation**: independent_adversarial (frozen preregistration: `.agents/preregistrations/gauntlet-game-studio-plan-T25.prereg.yaml`; verifier verdict PENDING — builder evidence below makes no settlement claim beyond the captured gates/teeth)
**Status**: GATES+TEETH GREEN (builder evidence; settlement requires independent confirmation)
**Verified revision**: `dea0673c8f9031e0df278ccd79e053794c093c87` (committed HEAD; T25 made no commits, so every fresh run below binds to exactly this revision)

**Governing requirements**: settles REQ-VERIFY-004; confirms 52 high-risk requirements across 16 groups (full mechanical expansion in `final-report.md` section 6).

## What was done (validation task — minimal additive tooling, no behavior rewrites)

1. **Preregistration frozen BEFORE evidence evaluation** (`.agents/preregistrations/gauntlet-game-studio-plan-T25.prereg.yaml`, `status: frozen`): one claim (conformance at the evidence level actually claimed; zero unmapped REQUIRED requirements; no hidden donor/model/Blender/builder-assertion dependency), the plan's two falsifiers verbatim, declared confounds and confirmation condition, independent_adversarial confirmation focus.
2. **Gate 1 — final traceability** (`python3 scripts/check-traceability.py .agents/plans/gauntlet-game-studio.plan.yaml .agents/specs/gauntlet-game-studio.spec.yaml`): exit 0 — 152 REQ + 14 VAR + 8 RECOV + 10 CLAIM all mapped, zero unknown IDs, plan↔spec SHA-256 binding intact, DAG acyclic with declared critical path (17 tasks), every P3 preregistration artifact present on disk and frozen (new strengthening check, no existing check weakened), path conventions and donor/baseline boundary rules verified.
3. **`just ci`** (new aggregate alias in the root `justfile`): composes ONLY the existing repository-native gates — `just check`, `just test`, `just lint`, `just validate-agent-artifacts`, `just doctor`. No new competing protocol; no new commands. Exit 0: 339 pass / 0 fail across 46 test files; doctor SUCCESS.
4. **`--suite all`** (studio CLI extension, `apps/studio-cli/src/index.ts`): `studio verify --project <dir> --suite all` runs EVERY game-declared suite in `<project>/.agents/suites/` (`teeth-*` preregistered falsification fixtures excluded by declared rule) through the UNCHANGED per-suite T20/T21/T22 machinery — fresh ObservationRun + EvidenceManifest + SettlementRecord per scenario, structured JSON, stable exit codes (0=settled 1=failed 2=blocked/incomplete). Gate 3 (`bun run studio -- verify --project examples/blackwater-relay --suite all --json`): exit 0, 9/9 scenarios settled fresh at HEAD (multiplayer 3 + single-player 6), real system Chrome in the main checkout.
5. **Fresh clean reproduction** (plan step 2; T24 clean-checkout machinery reused): run `t24-clean-20260917T002546709Z`, 13 PASS / 0 FAIL — fresh clone of committed HEAD into os.tmpdir() (never under repo `.tmp/`), donor genuinely absent throughout (absent-from-clone + explicit `rm -rf` leg), frozen-lockfile install, all committed gates + doctor + donor scans green in the clone, Blackwater build + deterministic headless verification green, credential-stripped child env throughout. Scope recorded, never silent: browser legs ran in the MAIN checkout (Gate 3), deterministic legs in the clone; both at the same revision (`clean-reproduction.log`, `clean-reproduction.jsonl`).
6. **Evidence settlement index + preservation** (plan step 4): `studio evidence check-fixtures` exit 0 (contradiction fixture valid, stale fixture rejected_as_expected); new `scripts/final-evidence-index.ts` composes only the settled T20 EvidenceStore machinery — 183 runs validated (schema + run/manifest correlation + artifact hash re-verification + identity-based freshness): all 18 current-revision runs fresh, all 165 foreign-revision runs identity-stale-rejected AND preserved, failed/correction evidence preserved append-only (2 failed-settlement runs + committed contradiction fixture). Index: `evidence-index.json`.
7. **Both preregistered teeth bite fresh** (`teeth.txt`): see below.
8. **Final report draft for the verifier** (`final-report.md`): mechanical traceability summary, fresh gate/clean-reproduction/evidence-index outcomes, per-high-risk-group pointers (requirement group → settled task → confirmation mode → evidence paths), the exact confirmation questions, and explicit scope-honesty/fog notes. The verifier is dispatched separately AFTER this task; no self-confirmation.

## Gates (all fresh at HEAD `dea0673c8f9031e0df278ccd79e053794c093c87` — see gate.txt)

- Gate 1 traceability — exit 0, ALL TRACEABILITY, INTEGRITY, AND SETTLEMENT CHECKS PASSED
- Gate 2 `just ci` — exit 0 (339 pass / 0 fail; doctor SUCCESS)
- Gate 3 `studio verify --project examples/blackwater-relay --suite all --json` — exit 0, 9/9 settled
- `just check` / `just test` / `just lint` / `just validate-agent-artifacts` / `just doctor` — each exit 0
- `studio evidence check-fixtures` — exit 0; `final-evidence-index.ts` — exit 0 (EVIDENCE_INDEX_OK)
- Clean reproduction — 13 PASS / 0 FAIL (CLEAN_CHECKOUT_OK)

## Teeth (both bite — see teeth.txt)

1. **TEETH-T25-001** (remove one requirement mapping from a temporary plan copy): on a disposable `/tmp` copy with `REQ-TERRAIN-001 -> [T10]` removed, the gate reported `FAIL: Unmapped REQ-* requirements (1): ['REQ-TERRAIN-001']` and exited 1; the real-plan gate immediately after remained exit 0 with the working tree untouched. (Two incidental path-convention FAILs also appeared on the copy from `yaml.safe_dump` escaping the plan's tree-diagram scalar — unrelated to the attack; the declared expectation held.)
2. **TEETH-T25-002** (replace fresh final evidence with historical passing run IDs from another revision): on a disposable store copy, the historical PASSING run `run-boot-cc8e21660c23-20260916T213654Z` (original settlement: settled) was substituted for final conformance at HEAD — store layer threw `EvidenceStaleError` naming both revisions; settlement decided `incomplete`/`evidence_stale`, record never settled; fresh current-revision evidence in the same copy still validated fresh. Identity-based rejection, fired before channel evaluation (`scripts/t25-tooth-stale-evidence.ts`).

## Files created/changed

- Changed: `justfile` (added `ci` recipe composing existing gates), `apps/studio-cli/src/index.ts` (`--suite all` + help/usage text), `scripts/check-traceability.py` (P3 prereg on-disk existence + frozen-status check — strengthening only).
- New: `scripts/final-evidence-index.ts` (evidence step machinery), `scripts/t25-tooth-stale-evidence.ts` (tooth 2 machinery), `.agents/preregistrations/gauntlet-game-studio-plan-T25.prereg.yaml` (frozen), `artifacts/plan/T25/{gate.txt, teeth.txt, summary.md, final-report.md, evidence-index.json, clean-reproduction.log, clean-reproduction.jsonl}`.
- No changes to packages/** or examples/** source. No new npm dependencies. NO git commits. NO `.agents/CURRENT_STATUS.yml` edits (operator flow updates it only after the independent verdicts pass). `.tmp/donor` never imported.

## Dependency / scope discipline

- Reused settled surfaces instead of duplicating: T20 EvidenceStore/settlement/fixture gates, T21 profiles, T22/T23 suite + project-runner machinery, T24 clean-checkout gate. `just ci` binds only existing gates per AGENTS.md §9 (no competing gate surface).
- `--suite all` excludes `teeth-*.yaml` falsification fixtures by declared naming rule; the exclusion is documented in CLI help and here, never silent.

## Blockers / unknowns

- None blocking. Bounded notes: (a) the clone's browser legs were intentionally not run (recorded LEG-6c; fresh real-Chrome legs ran in the main checkout at the same revision via Gate 3); (b) the prereg `timestamp` field is the declared freeze moment (before the first green gate capture); (c) fresh runs doubled the current-revision run count in the game evidence store (18 runs) because probe and official captures are both retained append-only — by design; only current-revision evidence settles.
- NEXT (operator): dispatch the independent whole-studio verifier with `artifacts/plan/T25/final-report.md` sections 6–7 as the confirmation-question sheet; only after the verdict(s) pass, update `.agents/CURRENT_STATUS.yml` (handoff next action `none — plan settled`).

## Independent confirmation

REQUIRED before settlement (P3, independent_adversarial). The verifier receives the source requirements (frozen spec), the frozen preregistration, the implementation at HEAD, fresh evidence (`artifacts/plan/T25/`, game `artifacts/runs/`), and the exact confirmation questions (`final-report.md` section 7); builder conclusions above are non-authoritative context.
