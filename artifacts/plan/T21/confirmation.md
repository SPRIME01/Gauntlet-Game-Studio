# T21 Independent Adversarial Confirmation Record

- **Confirmation mode**: independent_adversarial (per plan T21 preregistration)
- **Confirmed at**: 2026-09-16 (fresh verifier session at revision 480fc69; builder conclusions not treated as authority)
- **Required verdict**: CONFIRM
- **Actual verdict**: **CONFIRM**
- **Scope**: REQ-VERIFY-003, REQ-PERF-001, REQ-PERF-002, REQ-PERF-003, REQ-PERF-004

## Gates reproduced fresh (verifier's own runs, exit 0)
- `bun run test:performance-fixtures` — 31 tests + Chrome legs A–D PASS
- `bun run studio -- verify --scenario performance-fixture --profile test-budget --json` — settled, 8/8 checks
- `just check`, `just test` (291/291), `just lint`, `just validate-agent-artifacts`
- T20 regression: `test:proof-harness` and `evidence check-fixtures` green, unchanged

## Adversarial findings (all attacks rejected)
1. Silent regression: regress fixture → exit 1, decision failed, budget_error (5 violations), `performance_contradiction`
   citing REQ-PERF-004 — with screenshot AND state snapshot byte-identical to the healthy run. No settlement path
   ignores the performance channel when pixels+state pass; missing channel → incomplete; unmeasurable surface →
   `PERF_SURFACE_ABSENT` structural fail.
2. Average-only masking: avg-only fixture → failed with `PERF_METRIC_RULE_MISSING_PERCENTILE` ×3 +
   `PERF_AVERAGE_ONLY_REPORTING`; hand-crafted artifacts omitting percentiles are rejected against the
   project-declared profile.
3. Hardware masquerade: software renderer + hardware-target profile → blocked `hardware_target_unavailable`,
   while structural violations still fail under software (the guard blocks hardware claims without excusing
   structural failures). Probe-seam spoofing collapses to software/unknown (never hardware-target); committed-
   evidence renderer tampering breaks `ARTIFACT_HASH`.
4. Budget locality: numeric budgets exist only in examples/blackwater-relay/.agents/specs/game.spec.yaml; adapter
   code carries no budget numbers; declared-before-use enforced with typed `PROFILE_NOT_DECLARED` (no defaults).
5. Separation: capture (observation) → profile evaluation (pure, never settles) → Gauntlet settlement mapping;
   budget failure produces failed/blocked settlement, not warnings.

## Prereg discipline
Prereg frozen (status: frozen) before all evidence; both falsifiers reproduced fresh end-to-end by the verifier.

## Honesty
summary.md explicitly disclaims real-GPU proof; fixture metrics are deterministic stand-ins through real contract
seams; absolute `target`-profile numbers settle only on bound target hardware (T22 scope).

## Advisory findings carried forward to T22 (must be addressed before target-hardware settlement)
1. `evaluate.ts` silently skips a hardware-sensitive check when its metric is entirely unreported (e.g., fps_avg
   omitted with healthy percentiles vacates the declared `min_fps_avg` budget under test-budget). Not reachable
   via committed fixtures/capture and outside the frozen metric rules, but declared hardware budgets should imply
   report-requirements.
2. `max_memory_mb: 256` is declared in the `target` profile but no capture/evaluation path measures memory yet;
   wire it before any T22 target-hardware settlement under that profile.
