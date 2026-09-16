# Task Settlement Evidence: T21

## Task Information
- **Task ID**: `T21`
- **Title**: Implement quality profiles and performance settlement
- **Proof Level**: `P3`
- **Confirmation**: `independent_adversarial` — PENDING (verifier receives source requirements, frozen prereg, implementation, fresh evidence, and the exact confirmation question; builder conclusions are non-authoritative context)
- **Settles**: `REQ-VERIFY-003`, `REQ-PERF-001`, `REQ-PERF-002`, `REQ-PERF-003`, `REQ-PERF-004`
- **Timestamp**: 2026-09-16T17:30:00Z
- **Preregistration**: `.agents/preregistrations/gauntlet-game-studio-plan-T21.prereg.yaml` (frozen before implementation and before any evidence evaluation)

## Implementation Overview
1. **Game-project quality profiles** (`examples/blackwater-relay/.agents/specs/game.spec.yaml`):
   The flat `budgets` block was migrated into declared, named `quality_profiles` BEFORE any use
   as gates (REQ-PERF-002). Numeric budgets live ONLY here (REQ-CONFIG-005) — adapters and the
   CLI carry no budget numbers and no universal cross-game target is claimed.
   - `target` — `hardware-target` evidence class bound to named environment
     `desktop-chrome-hardware`: structural budgets (max_draw_calls 200, max_triangles 250000,
     max_textures 64, max_console_errors 0) plus absolute hardware budgets (target_fps 60,
     min_fps_avg 55, frame-time p50/p95/p99 ≤ 20/22/33 ms, max_load_ms 8000, max_memory_mb 256).
   - `test-budget` — `structural+relative-baseline` evidence class bound to
     `ci-deterministic-fixture`: tight structural budgets (max_draw_calls 24, max_triangles 600,
     max_textures 4, max_console_errors 0) plus frame-time/FPS budgets explicitly bound to the
     declared relative baseline `performance-fixture-v1` — fixture-relative CI semantics, never
     absolute hardware claims.
   - Both profiles declare `metric_rules`: frame-time percentiles [p50, p95, p99] are gating
     metrics and `average_only_rejected: true`.
2. **Quality-profile module** (`packages/studio/src/quality/`, exported from `@gauntlet/studio`):
   - `profiles.ts` — zod-strict schema (metric rules, structural budgets, hardware budgets,
     relative baseline, evidence class, environment binding) and YAML loading from the game
     project. Undeclared profiles / missing `quality_profiles` sections are typed failures
     (`QualityProfileError`: `PROFILE_NOT_DECLARED`, `PROFILE_SCHEMA_INVALID`,
     `GAME_SPEC_UNREADABLE`); a profile can gate only after its declaration exists.
   - `evaluate.ts` — pure, deterministic, browser-free budget evaluation:
     `evaluatePerformanceEvidence(profile, evidence, assetSummary?)` produces per-check verdicts
     tagged `structural` vs `hardware-sensitive`, typed `budget_error` violations, a
     `non_target` flag (hardware-target profile + non-hardware renderer), and honest handling of
     `present:false` surfaces (`PERF_SURFACE_ABSENT`). Declared-metric-rule violations
     (`PERF_METRIC_RULE_MISSING_PERCENTILE`, `PERF_AVERAGE_ONLY_REPORTING`) are classified
     structural/deterministic. T13 integration: `AssetBudgetSummary` (registry `verifyAll()`
     not-acceptable count; optional byte total) feeds `PERF_ASSET_REGISTRY` /
     `PERF_ASSET_BYTES`.
3. **Typed budget_error** (`packages/contracts/src/errors.ts`): `BudgetError` implements the
   spec `error_classes` `budget_error` ("Blocks acceptance under the affected quality profile")
   with stable code, concise message, and a required recoverability hint, plus a JSON-safe
   summary projection for structured CLI results.
4. **Performance capture through the T19 observability contract** (`packages/adapters/src/browser/`):
   - `surface-client.ts` — `rendererStats()` stable method (the T19 renderer-stats seam).
   - `perf.ts` — `capturePerformanceEvidence()` maps stable `renderer.stats()`/`renderer.probe()`
     reads into `PerformanceChannelEvidence` (observation ONLY — no budget interpretation):
     fps_avg, draw calls, triangles, textures, resources, readiness_ms, console-error count, and
     a deterministic nearest-rank frame-time distribution (`computeFrameTimeDistribution`,
     p50/p95/p99 over raw `frame_time_samples_ms`, or explicitly declared percentiles; neither →
     `unreported`). `classifyRendererIdentity()` implements the software-rendering guard input
     (SwiftShader/llvmpipe/softpipe/software-renderer patterns → `software`; absent → `unknown`,
     which can never satisfy a hardware-target binding). A stats-less surface records
     `present:false` — never fabricated metrics.
   - `harness.ts` — `runScenario({ qualityProfile })` captures the performance channel (new
     `performance-metrics.json` hashed artifact), records the profile in
     `run.environment.quality_profile`, and pushes `PerformanceChannelEvidence` through the same
     channel/sink/settlement machinery as T20 (no fork).
   - `types.ts` — `PerformanceChannelEvidence`/`PerformanceMetrics`/`FrameTimeDistribution`
     types and the extended `ChannelEvidence` union.
5. **Gauntlet settlement integration** (`packages/studio/src/gauntlet/`):
   - `expectation.ts` — `claims.performance` + `performance.profile` constraint block; the
     profile id MUST be declared by the game project.
   - `checks.ts` — `checkPerformanceChannel()` evaluates evidence against the resolved profile;
     an unresolved profile fails `PERF_PROFILE_UNRESOLVED` (never an implicit pass).
   - `settle.ts` — performance failures map through the declared profile:
     violated budgets → decision `failed` with `budget_error` cited in the reason, structured
     violations, blockage class `runtime_consequence_deficit`, and a new
     `performance_contradiction` ("visual or semantic success cannot settle a performance
     requirement", REQ-PERF-004) whenever state+pixels pass while the profile is violated;
     hardware-target profile on software/unknown renderer → decision `blocked`, new blockage
     class `hardware_target_unavailable` (non-target evidence can never settle or masquerade),
     while structural violations still fail under software rendering (structural budgets are
     valid evidence everywhere).
6. **Deterministic fixture variants** (`packages/adapters/src/browser/fixture.ts`): four new
   scenario ids sharing the T20 canvas paint and semantics byte-for-byte —
   `performance-fixture` (healthy, hardware-class identity, 40-sample frame-time distribution),
   `performance-fixture-regress` (TEETH-T21-001: draw_calls 36, p95 ≈ 56 ms, p99 58 ms, fps 24 —
   identical pixels, identical semantic snapshot), `performance-fixture-avg-only` (TEETH-T21-002:
   healthy fps_avg 60, NO percentiles reported), `performance-fixture-swiftshader` (software
   guard identity with healthy metrics). All metrics are fixed functions of the variant (no
   clocks, no randomness).
7. **CLI** (`apps/studio-cli/src/index.ts`): `verify --scenario <id> --profile <id>` form — loads
   the committed frozen expectation bound to the scenario, rejects a `--profile` that does not
   match the frozen declaration, resolves the profile from the game project (default reference
   game spec; `--game-spec` override) BEFORE evidence evaluation, optionally folds the local T13
   AssetRegistry summary in, and emits structured JSON with `quality_profile`, `budget_error`,
   and stable exit codes (0 settled / 1 failed / 2 blocked-incomplete). `observe` gained
   `--profile` (validated declared-before-use).
8. **Tests + gate 1** (`packages/studio/test/performance/`): 31 deterministic browser-free tests
   (quality.test.ts, performance-settlement.test.ts) covering profile loading/declared-before-use,
   percentile math, software classification, structural budget enforcement with budget_error,
   metric rules vs average-only reporting, T13 registry integration, stable-seam capture, and
   both teeth at the settlement layer; committed frozen expectations
   (`expectations/performance-*.json`); and `run-performance-proof.ts` (gate legs A–D under real
   system Chrome). Root `package.json` gained one script line:
   `"test:performance-fixtures": "bun test packages/studio/test/performance && bun run ./packages/studio/test/performance/run-performance-proof.ts"`.

## Verification Evidence
- **Narrow Gates** (fresh runs, exit 0, log: `artifacts/plan/T21/gate.txt`):
  - `bun run test:performance-fixtures` — 31 tests pass (114 expects) + all browser legs PASS:
    leg A healthy fixture settles under test-budget; leg B TEETH-T21-001 end-to-end ('failed',
    pixels byte-identical, sha256 b0728f1c91d3…, budget_error with 5 violations); leg C
    TEETH-T21-002 end-to-end (metric-rule failures); leg D software guard (hardware-target
    blocked on SwiftShader evidence; relative-baseline test-budget settles the same evidence,
    explicitly labeled).
  - `bun run studio -- verify --scenario performance-fixture --profile test-budget --json` —
    decision "settled", performance channel 8/8 checks pass, exit 0.
  - CLI teeth/guard cross-checks (same gate log): `performance-fixture-regress` → exit 1
    (failed + budget_error payload + performance_contradiction); `performance-fixture-avg-only`
    → exit 1 (failed, metric-rule codes); `performance-fixture-swiftshader` → exit 2 (blocked,
    hardware_target_unavailable).
- **Teeth / Falsification Checks**: both preregistered falsifiers exercised fresh (deterministic
  + end-to-end + CLI exit codes), verdicts PASS — `artifacts/plan/T21/teeth.txt`.
- **Global Gates** (fresh runs, exit 0): `just validate-agent-artifacts`, `just check`
  (traceability + topology + `bun x tsc --noEmit` clean), `just test` (291 pass / 0 fail across
  38 files — includes the 31 new T21 tests), `just lint`.
- **T20 regression** (fresh runs, exit 0): `bun run test:proof-harness` (22 tests + browser legs
  A–D all PASS) and `studio evidence check-fixtures --json` (3 fixtures: 2 valid +
  1 rejected_as_expected) — T20 behavior is preserved unchanged.
- **Fresh run evidence at this revision** (append-only, `artifacts/runs/`): settled
  `run-performance-fixture-*` runs, preserved failed `run-performance-fixture-regress-*` /
  `run-performance-fixture-avg-only-*` runs (settlement decision "failed", budget_error cited),
  and a preserved blocked `run-performance-fixture-swiftshader-*` run (hardware_target_unavailable).

## How hardware-vs-structural budget separation is proven
- **Schema level**: every profile declares `evidence_class` (`structural-only` |
  `structural+relative-baseline` | `hardware-target`) and `environment_binding`; budgets are
  split into `structural_budgets` (draw calls, triangles, textures, resources, console errors,
  asset bytes) vs `hardware_budgets` (FPS, frame-time percentiles, load time, memory). Numeric
  values exist only in the game project.
- **Evaluation level**: every verdict check is tagged `budget_class`; structural checks are
  evaluated and enforced in ANY environment (tests prove structural violations fail even under a
  software renderer), while hardware-sensitive checks bind to the declared environment: a
  hardware-target profile on a software/unknown renderer is `non_target` → settlement BLOCKED
  (`hardware_target_unavailable`), never settled, never passed.
- **Capture level**: the renderer identity flows from the stable T19 probe seam and is
  classified at capture time (SwiftShader/llvmpipe/softpipe patterns → software); the class is
  recorded on the evidence so downstream consumers can never mistake it for target hardware.
- **Relative-baseline level**: the `test-budget` CI profile binds its frame-time/FPS numbers to
  the DECLARED fixture-relative baseline (`performance-fixture-v1`) — deterministic legs stay
  valid under software rendering but are explicitly labeled fixture-relative, never hardware
  claims; the profile text and check details state this.
- **Deterministic-vs-hardware honesty**: structural budgets and metric rules run browser-free in
  the unit suite; hardware-identity legs run under system Chrome; no noisy host-GPU measurement
  is presented as deterministic (the plan's redesign_trigger was applied by declaring relative
  baselines rather than faking determinism).

## Known limitations (not claimed)
- The fixture's frame-time distributions and renderer identities are fixture-controlled
  deterministic stand-ins read through the SAME stable contract seams a real title uses; they
  prove the metric rules, budget evaluation, guard, and teeth — NOT real-GPU performance. The
  `target` profile's absolute numbers are declared now and settle only on
  `desktop-chrome-hardware` (T22 scope, on target hardware).
- A real SwiftShader/software-rendered Chrome run is classified through the same guard logic;
  this host's fixture scenarios carry fixture-declared identities because the fixture does not
  mount real WebGL (the real T19 bridge wiring supplies live identities for real titles).
- Asset-byte budgets consume `AssetBudgetSummary.total_bytes` when provided; the CLI currently
  folds in the T13 registry acceptance summary (not-acceptable count) and leaves byte totals to
  project tooling, where declared.
- Performance evidence is captured while the scenario is paused/stepped (deterministic drive, as
  in T20); sustained-load soak measurement is not claimed.
- Independent adversarial confirmation remains REQUIRED before settlement (P3).
