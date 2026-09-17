# T25 Final Report — DRAFT for the independent whole-studio verifier

**Task**: T25 — Run final traceability, clean reproduction, and whole-studio independent confirmation
**Proof level**: P3 — **Confirmation mode**: independent_adversarial (frozen preregistration:
`.agents/preregistrations/gauntlet-game-studio-plan-T25.prereg.yaml`)
**Revision under verification**: `dea0673c8f9031e0df278ccd79e053794c093c87` (committed HEAD; no
commits were made during T25, so all fresh evidence below binds to exactly this revision)
**Builder verdict**: NONE — this draft is non-authoritative context. The verifier's evidence-based
CONFIRM/REJECT is the settlement act. No builder conclusion below may be treated as authority.

Verifier receives: the frozen spec (`.agents/specs/gauntlet-game-studio.spec.yaml`, SHA-256
`595c1f56f1f59e8f59d93d6e19f857635a98ca3418504dc861ca6a7f149d9e7e`, bound by the plan), the frozen
preregistration above, the implementation (repository at the revision above), the fresh evidence
(`artifacts/plan/T25/`, `artifacts/runs/` under the game project), and the confirmation questions in
section 7.

---

## 1. Mechanical traceability summary (Gate 1 — exit 0, fresh)

Command: `python3 scripts/check-traceability.py .agents/plans/gauntlet-game-studio.plan.yaml .agents/specs/gauntlet-game-studio.spec.yaml`

Mechanically parsed and enforced (full output: `artifacts/plan/T25/gate.txt` GATE 1 section):

- Spec: 193 unique IDs — 152 REQ, 14 VAR, 8 RECOV, 10 CLAIM, 9 NONGOAL; status `approved`.
- Plan↔spec binding: plan-bound SHA-256 equals actual spec SHA-256.
- Zero unmapped and zero unknown IDs in every mapped class: all 152 REQ mapped to settlement
  tasks, all 14 VAR and all 8 RECOV explicitly settled by T24, all 10 CLAIM mapped to evidence
  tasks. No unknown ID is referenced by the plan.
- Dependency DAG: strictly acyclic; declared critical path equals the computed longest path
  (17 tasks, 6 equal critical paths).
- Every P3 task declares a preregistration artifact; every declared P3 preregistration artifact
  exists on disk with `status: frozen` (final-validation check added this task — a strengthening;
  no existing check was weakened).
- Path conventions and baseline boundary rules (no Blender/toktx/WebRTC in baseline gates;
  donor-absent clean checkout enforced as final conformance condition) verified.

## 2. Fresh whole-studio gates at the verified revision (all exit 0)

All captured fresh in `artifacts/plan/T25/gate.txt`:

| Gate | Result |
|---|---|
| Gate 1 — traceability (above) | exit 0, ALL CHECKS PASSED |
| Gate 2 — `just ci` (new aggregate alias composing `just check` + `just test` + `just lint` + `just validate-agent-artifacts` + `just doctor`; no competing protocol, no new commands) | exit 0; 339 pass / 0 fail across 46 test files; doctor SUCCESS |
| Gate 3 — `bun run studio -- verify --project examples/blackwater-relay --suite all --json` | exit 0; 9/9 scenarios settled fresh (suites: `multiplayer`, `single-player`; `teeth-*` falsification fixtures excluded by declared rule) |
| `just check`, `just test`, `just lint`, `just validate-agent-artifacts`, `just doctor` individually | each exit 0 |

Gate 3 fresh per-scenario ObservationRun/EvidenceManifest/SettlementRecord (append-only, under
`examples/blackwater-relay/artifacts/runs/<run_id>/`): multiplayer-sync
`run-multiplayer-sync-dea0673c8f90-20260917T003311Z`, interest-filtering
`run-interest-filtering-dea0673c8f90-20260917T003314Z`, multiplayer-latency
`run-multiplayer-latency-dea0673c8f90-20260917T003316Z`, boot
`run-boot-dea0673c8f90-20260917T003318Z`, active-play
`run-active-play-dea0673c8f90-20260917T003321Z`, transceiver-interaction
`run-transceiver-interaction-dea0673c8f90-20260917T003323Z`, patrol-obstacle
`run-patrol-obstacle-dea0673c8f90-20260917T003325Z`, beacon-activation
`run-beacon-activation-dea0673c8f90-20260917T003327Z`, performance-flythrough
`run-performance-flythrough-dea0673c8f90-20260917T003329Z`.

## 3. Fresh clean reproduction (plan step 2)

`bun run conformance:clean-checkout` (T24 machinery reused; fresh run
`t24-clean-20260917T002546709Z`): 13 PASS / 0 FAIL — `artifacts/plan/T25/clean-reproduction.log`
and `clean-reproduction.jsonl`. Fresh `git clone --no-hardlinks` of committed HEAD into
`os.tmpdir()` (never under repo `.tmp/`); `.tmp/donor` genuinely absent throughout (absent-from-
clone plus explicit `rm -rf` attack leg); `bun install --frozen-lockfile`; `just
validate-agent-artifacts` / `check` / `test` / `lint` green in the clone; `studio doctor` success;
donor:audit (absent-donor path) + donor:dependency-scan green; Blackwater build green;
deterministic headless scenario verification green; final donor-absence assertion PASS. All child
processes ran with the nine model-credential env vars stripped.

Recorded scope (never silent): browser legs were NOT executed inside the clone (deterministic
headless path in the clone, per the T24 scope decision). Fresh real-browser proof at this revision
ran in the MAIN checkout through Gate 3 — both suites, real system Chrome (`DISPLAY=:0`), two
independent Playwright contexts + authoritative headless server for the multiplayer suite. The
clone proves committed-HEAD donor-free buildability; the main checkout proves browser-observed
conformance; both bind to the same revision.

## 4. Evidence settlement index and preservation (plan step 4)

- `bun run studio -- evidence check-fixtures` (settled T20 gate): exit 0 — `run-fixture-contradiction`
  valid, `run-fixture-ok` valid, `run-fixture-stale` rejected_as_expected.
- `bun run ./scripts/final-evidence-index.ts` (new; composes only the settled T20 EvidenceStore
  machinery — schema validation, run/manifest correlation by run_id + revision identity, artifact
  hash re-verification, identity-based freshness classification): exit 0 —
  `artifacts/plan/T25/evidence-index.json`.
  - 183 runs validated in `examples/blackwater-relay/artifacts/runs/` across 4 revisions
    (66 @ 33188d92efb8, 90 @ cc8e21660c23, 9 @ 1c8284028e11, 18 @ dea0673c8f90).
  - All 18 current-revision runs validate fresh; all 165 foreign-revision runs are rejected by
    identity (EvidenceStaleError) AND remain intact — historical evidence is classified stale,
    never deleted or rewritten.
  - Failed/correction evidence remains preserved append-only: 2 runs with `decision: "failed"`
    (`run-patrol-obstacle-cc8e21660c23-20260916T203800Z`, `...T203834Z`) plus the committed
    contradiction fixture in `packages/studio/test/proof/fixtures/run-fixture-contradiction/`.

## 5. Teeth (both preregistered falsifiers bite — `artifacts/plan/T25/teeth.txt`)

1. **TEETH-T25-001** (remove one requirement mapping from a temporary plan copy): disposable copy
   under `/tmp/t25-teeth1/` with `REQ-TERRAIN-001 -> [T10]` removed; gate invoked with the temp
   plan + real spec reported `FAIL: Unmapped REQ-* requirements (1): ['REQ-TERRAIN-001']` and
   exited 1. Control: the real plan gate immediately after — exit 0, working tree untouched.
   (Two incidental path-convention FAILs also appear on the copy: `yaml.safe_dump` escaped the
   plan's tree-diagram block scalar; unrelated to the attack; the declared expectation held.)
2. **TEETH-T25-002** (replace fresh final evidence with historical passing run IDs from another
   revision): disposable store copy under `os.tmpdir()`; historical PASSING run
   `run-boot-cc8e21660c23-20260916T213654Z` (original settlement: settled) substituted for final
   conformance at the current revision. Store layer: `EvidenceStaleError` naming both revisions.
   Settlement layer: `incomplete` / `evidence_stale`, record decision not settled. Control: fresh
   current-revision manifest in the same disposable store validates fresh. Identity-based, not
   filename-based; the freshness gate fires before channel evaluation, so no channel evidence
   could have flipped the verdict. Script: `scripts/t25-tooth-stale-evidence.ts`.

## 6. Per-high-risk-group evidence pointers (T25 `confirms` list — 55 requirements, 16 groups)

Mechanically derived from the plan's `traceability.requirement_to_tasks` and task `confirms`/
`confirmation`/`evidence` fields. Every group's settled tasks hold a spec-declared confirmation
verdict recorded in `.agents/CURRENT_STATUS.yml` `latest_evidence`, and each group is exercised
fresh at the verified revision by the T25 gates above.

| Group | Settled by (mode) | Key evidence paths |
|---|---|---|
| REQ-ASSET (001,002,003,004,006) | T14 (independent), T13 (peer) | `artifacts/plan/T14/`, `artifacts/plan/T13/`; fresh: Gate 3 asset registry check inside every suite scenario; `artifacts/plan/T24/recovery-cases.jsonl` (VAR-001/003, RECOV-003) |
| REQ-AUDIO (001,002) | T17 (independent_adversarial) | `artifacts/plan/T17/`; fresh: `artifacts/plan/T24/recovery-cases.jsonl` (VAR-014) |
| REQ-BIND (001,002,006) | T07, T08 (independent_adversarial), T14 (independent) | `artifacts/plan/T07/`, `artifacts/plan/T08/`, `artifacts/plan/T14/` |
| REQ-BLENDER (001,002,004,005,006,007) | T18 (independent) | `artifacts/plan/T18/`; fresh: `artifacts/plan/T24/recovery-cases.jsonl` (RECOV-006) + clean-reproduction LEG-6a (Blender-free build) |
| REQ-CONFIG (004,014) | T07 (independent_adversarial) | `artifacts/plan/T07/`; fresh: Gate 2 `just doctor` configuration integrity |
| REQ-DONOR (001,004,005,006) | T09 (independent), T24 (independent_adversarial) | `artifacts/plan/T09/`, `artifacts/plan/T24/` (`clean-checkout.jsonl`); fresh: clean-reproduction LEG-1/5/7 (donor absent, scans green) |
| REQ-GAUNTLET (002,003,006) | T20 (independent_adversarial) | `artifacts/plan/T20/`; fresh: Gate 3 per-scenario SettlementRecords; evidence index §4; teeth.txt TEETH-T25-002 |
| REQ-NET (001,003,004,005,007,008) | T12, T23 (independent_adversarial) | `artifacts/plan/T12/`, `artifacts/plan/T23/`; fresh: Gate 3 multiplayer suite (3 networked scenarios, two real-Chrome clients + headless server) |
| REQ-OBS (001,002) | T19 (independent_adversarial) | `artifacts/plan/T19/`; fresh: Gate 3 observations flow through `__GAUNTLET_STUDIO_OBS__` v1 |
| REQ-PERF (001,002,003,004) | T21 (independent_adversarial) | `artifacts/plan/T21/`; fresh: Gate 3 `performance-flythrough` settled under the declared quality profile |
| REQ-ROUTE (005,006) | T04 (independent_adversarial) | `artifacts/plan/T04/`; fresh: Gate 3 routing single-player vs multiplayer project-runner modes |
| REQ-RUNTIME (001,004,005,006) | T07, T08 (independent_adversarial) | `artifacts/plan/T07/`, `artifacts/plan/T08/`; fresh: Gate 3 all nine scenarios over the first-party runtime |
| REQ-SAFE (002,005,006,007) | T04, T12, T17, T24 | `artifacts/plan/T04/`, `T12/`, `T17/`, `T24/`; fresh: clean-reproduction credential-stripped env (REQ-SAFE-005); Gate 2 doctor secret hygiene (REQ-SAFE-002) |
| REQ-SEC (004,007) | T13 (peer), T12 (independent_adversarial) | `artifacts/plan/T13/`, `artifacts/plan/T12/`; fresh: `artifacts/plan/T24/security-cases.jsonl` |
| REQ-SKILL (004,005,006) | T04 (independent_adversarial) | `artifacts/plan/T04/`; fresh: Gate 2 `just validate-agent-artifacts` + capabilities surfaces via doctor |
| REQ-TERRAIN (001,002,003) | T10 (independent_adversarial) | `artifacts/plan/T10/`; fresh: Gate 3 patrol-obstacle scenario over the canonical heightfield |

Full mechanical expansion (per-requirement settling tasks) is regenerable from the plan's
`traceability` section; the verifier is encouraged to re-run Gate 1 and the index script rather
than trust this table.

## 7. Exact confirmation questions for the independent verifier

Per the frozen preregistration (`independent_confirmation.focus`), answer from fresh evidence at
revision `dea0673c8f9031e0df278ccd79e053794c093c87`, not from this draft:

1. Does Gate 1 exit 0 on the real plan+spec with zero unmapped and zero unknown IDs — and did
   TEETH-T25-001 fail with the exact removed requirement named, on a disposable copy only, with
   the real plan untouched?
2. Does `just ci` compose only existing gates (inspect `justfile`) and pass fresh — with no
   competing parallel protocol introduced?
3. Does `studio verify --project examples/blackwater-relay --suite all --json` exit 0 with every
   game-declared scenario settled fresh (verify the run dirs cited in section 2: each contains
   `run.json`, `manifest-01.json`, `settlement-01.json` bound to the current revision)? Is the
   clone-vs-main-checkout browser-leg scope recorded honestly rather than overstated?
4. Does the evidence index validate every referenced manifest, keep foreign-revision evidence
   rejected-but-preserved, and keep failed/correction evidence append-only — with TEETH-T25-002's
   substitution rejected by identity?
5. For each high-risk group in section 6: is there a settled task whose spec-declared confirmation
   mode is actually recorded, and fresh evidence at this revision? Flag any group where the fresh
   pointer does not exercise the group's requirements.
6. Are the hard constraints intact: no git commits by T25, no `.agents/CURRENT_STATUS.yml` edits,
   no new npm dependencies, no imports from `.tmp/donor`, no builder self-confirmation?

Required verdict: CONFIRM (per plan `independent_confirmation.required_verdict`).

## 8. Scope honesty / known fog

- The clean reproduction proves the committed tree builds, tests, lints, doctors, and verifies
  deterministically without donor, credentials, or Blender; it does not run browser legs inside
  the clone (recorded LEG-6c; browser legs ran fresh in the main checkout at the same revision).
- Model-generation providers were never invoked; deterministic offline result verification covers
  the agent-skill surfaces (per T14/T15 settlement design).
- `examples/blackwater-relay/artifacts/runs/` now contains evidence from four revisions; only the
  18 current-revision runs settle anything at HEAD. This coexistence is by design (append-only
  history) and is enforced by identity-based freshness.
- After the independent verdicts pass, `.agents/CURRENT_STATUS.yml` and the handoff are updated by
  the operator flow (explicitly NOT by this task's builder evidence step).
