# T21 Hardening Round 1 — T22 prerequisites resolution

- **Round**: bounded CORRECTION/HARDENING under the plan's correction protocol
- **Date**: 2026-09-16
- **Requirement source**: `artifacts/plan/T21/confirmation.md`, section "Advisory findings
  carried forward to T22 (must be addressed before target-hardware settlement)"; mirrored in
  `.agents/CURRENT_STATUS.yml` (`next_action.reason`, `unresolved_summary`)
- **Revision hardened**: f0a07cb36dd5c3c8fce39742c2c5ed2d2aba856f (T21 settled at 7916bfe)
- **Fresh gate log**: `artifacts/hardening-gate.txt` (13 battery runs, all expected outcomes)
- **Original acceptance**: NOT weakened — every original T21/T20 gate and tooth was rerun
  fresh at this revision and passed with unchanged semantics (see "No weakening" below).

## Prerequisite 1 — Wire memory-budget capture (`max_memory_mb`)

The `target` profile declares `hardware_budgets.max_memory_mb: 256`
(examples/blackwater-relay/.agents/specs/game.spec.yaml) but no capture or evaluation path
measured memory. Resolution:

- Capture types (`packages/adapters/src/browser/types.ts:110-133`): `PerformanceMetrics`
  gains `memory_used_mb` and `memory_heap_limit_mb` (MB); new `JsHeapMemoryBytes` raw-bytes
  shape.
- Capture source (`packages/adapters/src/browser/harness.ts:437-456`): the harness reads
  Chrome `performance.memory` (`usedJSHeapSize`/`jsHeapSizeLimit`) through the existing T20
  page-evaluation seam — observation only, gated on a requested quality profile like the
  stats read; browsers/contexts without a reading yield null and the absence is recorded in
  the evidence `unreported` list (never fabricated).
- Capture mapping (`packages/adapters/src/browser/perf.ts:84-101,186-200,214-215`): pure
  deterministic `normalizeJsHeapMemory()` (bytes -> MB, invalid/absent -> null);
  `capturePerformanceEvidence()` prefers a stable-seam `renderer.stats()` memory declaration
  (what a real title/fixture that measures its own heap would report) and falls back to the
  Chrome page read; with neither source it records `memory_used_mb` in `unreported`
  (including the `present:false` branch, perf.ts:142).
- Evaluation (`packages/studio/src/quality/evaluate.ts:261`): `PERF_MEMORY` check evaluates
  `metrics.memory_used_mb` against `hardware_budgets.max_memory_mb` when declared
  (hardware-sensitive class, `<=` boundary inclusive). Profiles that do not declare the
  budget emit no memory check (no invented gates).
- Browser proof (`packages/studio/test/performance/run-performance-proof.ts:150-169`): leg A
  now asserts the memory fields are present in real-Chrome captured evidence and fails the
  gate otherwise. Fresh run observed `memory_used_mb=1.6 memory_heap_limit_mb=4067`.

Decision recorded: an unreported declared memory budget produces the typed
`PERF_METRIC_UNREPORTED` check failure but NO numeric `BudgetViolation`, because
`BudgetViolation.measured` is a required number (packages/contracts/src/errors.ts:16) and no
measurement exists — fabricating one would be dishonest evidence. The failure is carried by
the typed check, the failing channel verdict, and the settlement reason; the memory-budget
EXCEEDED case produces the full `budget_error` (below), as required.

## Prerequisite 2 — Declared hardware budgets imply report requirements

Demonstrated defect (preserved citation: artifacts/plan/T21/confirmation.md advisory finding
1): "evaluate.ts silently skips a hardware-sensitive check when its metric is entirely
unreported (e.g., fps_avg omitted with healthy percentiles vacates the declared min_fps_avg
budget under test-budget)". Root cause: the hardware budget loop's
`if (typeof item.measured !== "number") continue;` silently skipped declared-but-unreported
metrics, and `PERF_AVERAGE_ONLY_REPORTING` only fires when fps_avg IS a number — so pure
omission evaluated `pass: true`.

Correction (`packages/studio/src/quality/evaluate.ts`):

- `evaluate.ts:270-282` — whenever a profile declares a hardware-sensitive budget on metric
  M and the evidence contains NO value for M, the check now FAILS with the typed
  `PERF_METRIC_UNREPORTED` violation naming the vacated budget key; it never silently
  passes. Structural checks keep their existing semantics (unchanged code paths).
- `evaluate.ts:76-81` — `PERF_METRIC_UNREPORTED` is classified structural/deterministic
  (whether the evidence reports a value is provable in ANY environment), mirroring the
  existing `PERF_METRIC_RULE_MISSING_PERCENTILE` family.
- `evaluate.ts:295-299` — `structural_failed` is now computed after ALL checks are pushed so
  it observes the unreported-metric checks arising from the hardware loop.
- `packages/studio/src/quality/profiles.ts:50-57` — schema documentation: declaring a
  hardware budget implies a report requirement.

Not changed on purpose: `game.spec.yaml` needed no schema/declaration adjustment (the rule
is a evaluation-level consequence of declaration; both profiles already declare
`metric_rules`, and the rule text is documented at the schema and evaluation layers).

## New deterministic falsification surface

- Fixture variant `performance-fixture-no-fps`
  (`packages/adapters/src/browser/fixture.ts:35-42,90,106,113,199,280-284,334,343`): healthy
  frame-time percentiles, `fps_avg` omitted ENTIRELY — the exact vacating shape; pixels and
  semantics stay byte-identical to `performance-fixture` by construction.
- Frozen expectation `packages/studio/test/performance/expectations/performance-fixture-no-fps.json`
  (bound to the declared `test-budget` profile).
- Browser gate leg E (`run-performance-proof.ts:275-311`): the vacating shape must settle
  `failed` with `PERF_METRIC_UNREPORTED` end-to-end under real Chrome; precondition asserts
  the fixture truly does not report fps_avg.
- Browser-free tests (`packages/studio/test/performance/hardening.test.ts`, 16 tests):
  TEETH-T22-H1 reproduces the EXACT confirmation-record vacating scenario at the evaluation
  layer (fps_avg omitted, healthy percentiles, test-budget -> pass:false,
  `PERF_METRIC_UNREPORTED` citing `hardware_budgets.min_fps_avg`, structural_failed) and at
  the settlement layer (decision failed through the T20 bridge, never settled; healthy
  fully-reported evidence still settles — no over-blocking); TEETH-T22-H2 covers memory
  evaluation browser-free (exceeded -> `PERF_MEMORY` fail + `budget_error` with
  `hardware_budgets.max_memory_mb`; within-budget and exactly-at-budget pass; missing while
  declared -> `PERF_METRIC_UNREPORTED`; undeclared -> no memory check), `normalizeJsHeapMemory`
  determinism, and the capture precedence/fallback/absence wiring. Settlement-level helper
  `healthyEvidence` in performance-settlement.test.ts now reports memory (the `target`
  profile gates it), preserving the original blocked/failed leg semantics exactly.

## Fresh teeth outcomes (all at revision f0a07cb36dd5…, log: artifacts/hardening-gate.txt)

| # | Gate / tooth | Expected | Observed |
|---|---|---|---|
| 1 | `bun test packages/studio/test/performance` | all pass | 47/47 pass, 176 expects (31 original + 16 new) |
| 2 | `run-performance-proof.ts` browser legs A–E (real Chrome) | all pass | LEG A settled (memory captured: 1.6/4067 MB); LEG B TEETH-T21-001 failed with budget_error 5 violations, pixels byte-identical (sha256 b0728f1c91d3… — same prefix as the T21 record); LEG C TEETH-T21-002 failed per metric rules; SOFTWARE GUARD blocked (hardware_target_unavailable); RELATIVE BASELINE settled; LEG E vacating shape failed with PERF_METRIC_UNREPORTED |
| 3 | `studio verify --scenario performance-fixture --profile test-budget --json` | exit 0 settled | exit 0 |
| 4 | `studio verify --scenario performance-fixture-no-fps --profile test-budget --json` | exit 1, PERF_METRIC_UNREPORTED | exit 1, decision "failed", reason cites PERF_METRIC_UNREPORTED (hardware_budgets.min_fps_avg) + performance_contradiction |
| 5 | CLI cross-check `performance-fixture-regress` | exit 1 failed | exit 1 |
| 6 | CLI cross-check `performance-fixture-avg-only` | exit 1 failed | exit 1 |
| 7 | CLI cross-check `performance-fixture-swiftshader` under `target` | exit 2 blocked | exit 2, hardware_target_unavailable |
| 8 | T20 regression `bun run test:proof-harness` | pass | 22/22 tests + browser legs PASS, exit 0 |
| 9 | T20 regression `studio evidence check-fixtures --json` | pass | exit 0 (negative control still rejects) |
| 10 | `just validate-agent-artifacts` | exit 0 | exit 0 |
| 11 | `just check` | exit 0 | exit 0 (tsc --noEmit clean) |
| 12 | `just test` | exit 0 | 307/307 pass across 39 files (291 at T21 + 16 new hardening tests) |
| 13 | `just lint` | exit 0 | exit 0 |

## No weakening

- The prior defect and its exact reproduction are preserved as a named tooth
  (TEETH-T22-H1) with a committed fixture and expectation; the correction strictly narrows
  accepted evidence (a previously silently-passing shape now fails). No acceptance criterion
  of T21 or T20 was relaxed; all original gates/teeth rerun fresh with unchanged outcomes
  (table above; full outputs in artifacts/hardening-gate.txt).
- Fresh observation runs are preserved append-only under `artifacts/runs/` (settled,
  failed, and blocked runs from this round, including `run-performance-fixture-no-fps-*`).

## Files changed

- packages/adapters/src/browser/types.ts (memory metrics types)
- packages/adapters/src/browser/perf.ts (memory capture mapping + normalization)
- packages/adapters/src/browser/harness.ts (Chrome performance.memory page seam)
- packages/adapters/src/browser/fixture.ts (performance-fixture-no-fps variant)
- packages/studio/src/quality/evaluate.ts (PERF_METRIC_UNREPORTED rule; PERF_MEMORY;
  flag recompute)
- packages/studio/src/quality/profiles.ts (report-requirement documentation)
- packages/studio/test/performance/hardening.test.ts (NEW, 16 deterministic tests)
- packages/studio/test/performance/performance-settlement.test.ts (helper reports memory)
- packages/studio/test/performance/run-performance-proof.ts (leg A memory assertion; leg E)
- packages/studio/test/performance/expectations/performance-fixture-no-fps.json (NEW)
- artifacts/hardening-gate.txt (fresh gate log), artifacts/plan/T21/hardening-round1.md (this record)

Not touched (owned by the concurrent DCC builder): packages/adapters/src/dcc/,
examples/blackwater-relay/assets/dcc/, examples/blackwater-relay .studio results.
No git commits; no .agents/CURRENT_STATUS.yml edits; no new dependencies; nothing imported
from .tmp/donor.

## Known limitations (not claimed)

- Memory capture uses Chrome's `performance.memory` (deprecated-but-present JS-heap API);
  browsers without it record `memory_used_mb` in `unreported`, which correctly fails a
  declared `max_memory_mb` gate as unreported rather than passing it.
- The browser leg asserts PRESENCE of the memory fields in captured evidence; absolute
  memory VALUES on this host are not deterministic and are not claimed as such.
- The `target` profile's absolute budgets (including `max_memory_mb: 256`) still settle only
  on the bound `desktop-chrome-hardware` environment (T22 scope); this round wires capture +
  evaluation, it does not perform target-hardware settlement.
