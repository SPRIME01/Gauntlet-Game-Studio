# Task Settlement Evidence: T19

## Task Information
- **Task ID**: `T19`
- **Title**: Implement development/test observability bridge and network/runtime diagnostics
- **Proof Level**: `P3`
- **Confirmation**: `independent_adversarial` — PENDING (verifier receives source requirements, frozen prereg, implementation, fresh evidence, and the exact confirmation question; builder conclusions are non-authoritative context)
- **Settles**: `REQ-OUT-004`, `REQ-OBS-001`, `REQ-OBS-002`, `REQ-OBS-003`, `REQ-OBS-004`, `REQ-OBS-005`, `REQ-SEC-005`
- **Timestamp**: 2026-09-16T03:35:00Z
- **Preregistration**: `.agents/preregistrations/gauntlet-game-studio-plan-T19.prereg.yaml` (frozen before implementation and before any evidence evaluation)

## Observability Contract (declared name/version)
- **Contract name**: `__GAUNTLET_STUDIO_OBS__` — mounted on the runtime global target as
  `window.__GAUNTLET_STUDIO_OBS__` in browser builds (the explicitly-versioned equivalent of
  `window.__GAME_STUDIO__` per REQ-OBS-001; default mount target is `globalThis`, and tests mount
  on isolated objects for hermetic verification).
- **Contract version**: `1` — every surface declares
  `{ name: "__GAUNTLET_STUDIO_OBS__", version: 1, mode: "development" | "test" | "production", readonly, privileged_control }`.

## Implementation Overview
1. **Contract module** (`packages/runtime/src/observability/contract.ts`):
   - Versioned constants and the full v1 surface types: readiness + per-subsystem reads,
     tick/scheduler read, semantic entity/state reads (`entities.list/get/snapshot`, each read
     provenance-marked `source: "koota"`), bounded error log reads, renderer probe/stats/capture,
     physics/navigation/spatial reads, network diagnostics read, named camera views, and the
     privileged `control` namespace type (pause/resume/isPaused, bounded fixed-step, seed,
     view selection, scenario reset, error clearing).
2. **Bridge** (`packages/runtime/src/observability/bridge.ts`):
   - `createObservabilityBridge({ mode, kernel, target, renderCapture, maxStepTicks, errorBufferSize })`
     builds and mounts the surface. Modes `development`/`test` install the full surface including the
     single clearly-separated privileged `control` namespace; mode `production` constructs NO control
     object at all and mounts a read-only surface under a non-writable, non-configurable property
     (cannot be silently replaced or removed; `dispose()` is refused).
   - Reads are pure projections over T07/T08/T10/T11/T12 contracts: `SubsystemBarrier.getReadiness()`,
     `SimulationScheduler` tick state, `GameWorld.takeSemanticSnapshot()` for semantic reads,
     `RapierPhysicsAdapter.getLastSteppedTick()`, `RecastNavigationAdapter.getDiagnostics()`,
     `SpatialQueryAccelerator.getDiagnostics()`, `NetworkClient.getDiagnostics()` /
     server diagnostics / transport characteristics (wiring-provided), capture-only
     `preserveDrawingBuffer` configuration (default false, purpose "capture-only").
   - Controlled mutations only: `control.step(ticks)` is bounded `[1, maxStepTicks]` (default 240)
     and drives the scheduler's `stepSingleTick` (never a second scheduler); `resetScenario` only
     invokes game-registered scenario hooks which rebuild state through the authoritative GameWorld
     API; `setSeed` notifies a game-owned handler. The bridge is a read/projection and
     controlled-invocation layer — Koota remains the sole semantic authority.
   - Wiring handle (registration of scenarios/views/renderer probe/stats/seed handler/subsystem
     attachments/error recording) is deliberately narrower on the mounted surface: registration
     never leaks through the window surface.
3. **Contract validator** (`packages/runtime/src/observability/validate.ts`):
   - `validateObservabilityContract(surface, { mode, expectControl, behavioral })` checks the
     contract header, every required stable method (structural), executes reads against live state
     (behavioral), requires the privileged namespace on dev/test surfaces, forbids it on production
     surfaces, and runs the production mutation inspector for `mode: "production"`.
   - This is the detector for TEETH-T19-001: a surface with only transient DOM/provider access
     fails ("missing stable method 'entities.get()'" etc.), and a stable method secretly coupled to
     provider internals fails behaviorally.
4. **Production check** (`packages/runtime/src/observability/production-check.ts`):
   - `inspectProductionSurface` recursively inspects a mounted surface (cycle-safe, depth-bounded)
     and flags any function whose name matches a privileged token (pause/resume/step/seed/scenario/
     reset/spawn/despawn/teleport/mutate/setview/register/exec/eval/advance/simulate/restore/control)
     or any `control` key at any depth. `assertProductionSurfaceSafety` throws
     `ObservabilityProductionViolationError` on violations.
   - Executed as a script (`bun run test:production-observability`) it constructs a production
     bridge, proves the mounted surface is clean while keeping reads, and runs the two embedded
     negative controls proving the detector bites (dev/test surface as production → 11 violations;
     injected `pause()` → flagged). Exit 0 only when all hold. This is the detector for TEETH-T19-002.
5. **Integration**: `packages/runtime/src/index.ts` gained exactly one appended export line
   (`export * from "./observability";`); root `package.json` gained exactly one appended script line
   (`"test:production-observability": "bun run ./packages/runtime/src/observability/production-check.ts"`).
   Network readiness/disconnect/latency diagnostics are integrated read-only via
   `network.read()` reusing the T12 diagnostics/transport contracts (verified with the real
   in-memory server+client fixture, including explicit `closed` disconnect state).

## Verification Evidence
- **Narrow Gates** (fresh runs, exit 0):
  - `bun test packages/runtime/test/observability.test.ts` — 12 pass / 0 fail, 114 expects
  - `bun run test:production-observability` — production surface clean (17 methods inspected,
    zero privileged mutation APIs), both simulated regressions FAIL as required — SUCCESS
  - Gate log: `artifacts/plan/T19/gate.txt`
- **Teeth / Falsification Checks**: both preregistered falsifiers exercised fresh with PASS
  verdicts — `artifacts/plan/T19/teeth.txt`:
  - TEETH-T19-001: DOM-only surface, method-deleted surface, and provider-coupled method all FAIL
    contract validation; the real surface passes and returns Koota-correlated data via stable
    methods only.
  - TEETH-T19-002: production surface carries no privileged mutation (no `control` key, immutable
    mount); dev/test surface inspected as production FAILS (11 violations); injected `pause()`
    FAILS the inspection — the build check exits non-zero whenever privileged mutation is exposed.
- **Global Gates** (fresh runs): `just validate-agent-artifacts` exit 0, `just test` exit 0
  (196 pass / 0 fail across 28 files, 1738 expects — includes the 12 new T19 tests), `just lint`
  exit 0. `just check`: traceability + topology portions exit 0; the final full-repo
  `bun x tsc --noEmit` step currently fails exclusively inside packages/adapters files owned by
  concurrent in-flight tasks (T14/T15/T17/T18 — e.g. `agent-skills/3dviz/verify.ts` referencing a
  not-yet-created `./internal`, `audio/tone/tone-backend.ts` TS2339); zero tsc errors reference any
  T19 file. Isolated proof: `bun x tsc --noEmit -p <tmp tsconfig over packages/runtime/src +
  packages/contracts/src>` exits 0 (logged in gate.txt). This is an observed concurrent-work
  condition, not a T19 regression; a clean-checkout `just check` must be re-confirmed by the
  independent verifier once the concurrent tasks settle their files.

## Known limitations (not claimed)
- No Playwright/scenario orchestration and no Gauntlet evidence/settlement policy — that is T20
  scope; this task only provides the stable surface it will consume.
- The renderer probe/stats are wiring seams: no real WebGL renderer probe is shipped here
  (headless-safe `{ present: false }` when unregistered); a browser renderer integration registers
  through `setRendererProbe`/`setRendererStats`.
- Camera views are semantic descriptors (name/position/target/fov); wiring them into a real
  Three.js camera rig is the game/client integration's job — the bridge never owns scene objects.
- `preserveDrawingBuffer` is exposed as capture-only configuration; enabling actual pixel capture
  pipelines is T20 evidence-harness scope.
- Production authorization-GATING of mutation (as opposed to absence) is intentionally NOT claimed;
  the implemented and proven boundary is full absence of privileged mutation in production mode.

## Scope Notes
- Files created: `packages/runtime/src/observability/{index,contract,bridge,validate,production-check}.ts`,
  `packages/runtime/test/observability.test.ts`,
  `.agents/preregistrations/gauntlet-game-studio-plan-T19.prereg.yaml`,
  `artifacts/plan/T19/{gate.txt,teeth.txt,summary.md}`.
- Files changed: `packages/runtime/src/index.ts` (one appended export line), root `package.json`
  (one appended script line). No other tasks' files edited; no new dependencies; no git commits;
  `.agents/CURRENT_STATUS.yml` untouched.
