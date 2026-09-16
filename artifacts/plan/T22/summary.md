# Task Settlement Summary: T22

**Task ID**: T22
**Title**: Assemble and settle Blackwater Relay single-player vertical slice
**Proof Level**: P3
**Confirmation**: independent_adversarial (frozen preregistration: `.agents/preregistrations/gauntlet-game-studio-plan-T22.prereg.yaml`; verifier verdict pending — builder evidence below makes no settlement claim beyond the captured gates/teeth)
**Status**: GATES+TEETH GREEN (builder evidence; settlement requires independent confirmation)

**Governing requirements (confirmed, not settled, by this task)**: REQ-GOAL-002/003/004/007/008/010, REQ-RUNTIME-001/004/005/006/009, REQ-SKILL-004/005, REQ-TERRAIN-001/002/003, REQ-AUDIO-001/002, REQ-BLENDER-006/007, REQ-PERF-001/002/003/004.

## What was built

The Blackwater Relay reference game (`examples/blackwater-relay/`) is now a playable,
evidence-settled single-player browser vertical slice that composes every major
non-network studio capability:

1. **Canonical terrain authority** (`src/game/config.ts` TERRAIN, `src/game/build.ts`): one
   seeded sinusoidal-octaves TerrainHeightfield (20260915, 129x129, 512x512) matching the
   committed 3dviz composition reference; Three.js render mesh, Rapier heightfield collider,
   and Recast navmesh all derive from it (REQ-TERRAIN-002). Nav config `walkableClimb: 2`
   keeps the terraced heightfield voxels connected (climb 0.5 fragmented the navmesh into
   islands — documented in config).
2. **Koota sole semantic authority** (`src/game/state.ts`, `src/game/systems.ts`): stable-id
   entities (`bw-rover`, `bw-relay-gate`, `bw-power-cell`, `bw-field-transceiver`,
   `bw-service-drone`, `bw-beacon`, scenario-additive `bw-patrol-obstacle`); objective
   progression is expressed through authoritative transforms + tags (cell carried →
   transceiver anchor; gate raised +4; beacon mounted at socket), never through projections.
3. **One scheduler, one step owner** (`stepGame`): exactly one Rapier step and one crowd
   step per authoritative tick, registered as the single scheduler step handler
   (REQ-RUNTIME-006). Readiness barrier boots terrain/physics/navigation/spatial (+audio,
   non-required) before scenario execution (REQ-RUNTIME-005).
4. **Gameplay composition**: Rapier rover traversal + closed-gate collision over the
   canonical collider; Recast crowd drone patrol whose controller verifies the corridor via
   Recast `computePath` + BVH `verifyPathAgainstObstacles` and reroutes through a
   deterministic detour when the obstacle blocks line-of-sight (terminal proportional
   velocity control because recast crowd agents orbit move targets without an arrive-stop);
   power-cell pickup/delivery powering the gate; beacon activation at the relay tower.
5. **Accepted assets consumed**: committed 3dviz kits (relay tower / dock / hut, seeded
   instanced scatter, storm-dusk sky), accepted img2threejs field transceiver, committed
   Blender-derived `service-drone.glb` validated at container level and animated with the
   baked `hover_cycle` clip — zero Blender, zero donor presence at build/run/CI time.
6. **Projections**: Quarks VFX bursts (gate/beacon), Tone AudioBackend (locked until a real
   user gesture; suppressed-intent accounting; headless Null backend swapped only via
   dynamic import in the browser bundle — REQ-AUDIO-001/002), DOM/CSS HUD (objective
   messages + score), all one-way consumers of drained semantic events.
7. **Observability**: the T19 `__GAUNTLET_STUDIO_OBS__` v1 surface is the only settlement
   read path; the six frozen scenarios are registered as game-owned hooks; renderer
   probe/stats seams report real renderer identity (SwiftShader honestly classed
   `software`), frame-time distributions, draw calls, triangles, textures, and readiness.

## Named scenarios (frozen before implementation in game.spec.yaml `scenarios`)

All six settle with fresh state + pixels + telemetry evidence through the T20 harness and
the Gauntlet bridge; frozen expectations live in `tests/expectations/*.json`, committed
before evidence, referenced by `.agents/suites/single-player.yaml`:

| Scenario | Settles on (state channel, Koota-backed) |
|---|---|
| boot | full entity set at authored spawns; readiness ready; no transport wired |
| active-play | rover ≥2.5u displacement with terrain-following Y |
| transceiver-interaction | cell delivered at transceiver anchor; gate raised +4; rover past gate line |
| patrol-obstacle | drone completes BVH-verified detour A→(0,3.5)→B around the blocking obstacle |
| beacon-activation | beacon mounted at socket (tower base +14); rover in activation range |
| performance-flythrough | structural profile budgets (draw calls ≤128, triangles ≤65536, textures ≤16, console ≤8) + percentile reporting discipline |

## Dependency mechanism (independent buildability, REQ-GOAL-007 / REQ-REPO-002/003)

- The game keeps its own `package.json` (pinned versions mirroring the runtime/adapters
  lock) and `studio.lock.yaml`. First-party packages are bound through the declared
  Bun **workspace** mechanism (`"workspace:*"`; the reference game joined the root
  workspaces list) — the same first-party packages `studio.lock.yaml` pins at 0.2.0.
  `templates/game/` is unchanged and still generates registry-pinned projects; the T05
  teeth (no `../packages`/`workspace:` in the *template* output) still pass.
- Third-party deps are the already-pinned `packages/runtime` versions (three, koota,
  rapier3d-compat, recast-navigation, three-mesh-bvh) plus the adapters' tone/quarks pins.
  No new external dependency classes were introduced.
- `bun run build` = typecheck + deterministic browser bundle (`scripts/bundle.ts` →
  `dist/game.js` + `dist/index.html`); `dist/` and `artifacts/runs/` are gitignored.

## Studio-side suite support (declared gate)

`studio verify --project <dir> --suite <name> --json` was added to the CLI (T22 suite
form): reads the game project's committed suite manifest, serves the built game over
loopback, runs each scenario through the T20 harness with a fresh ObservationRun +
EvidenceManifest, resolves the game-declared quality profile (T21 machinery), settles each
frozen expectation via the Gauntlet bridge, and appends a SettlementRecord per scenario.
Exit codes 0/1/2 = settled/failed/blocked. The legacy `verify` forms are untouched.

## Quality-profile note (declared before use)

`test-budget` and `target` are unchanged (T21 tests pin their numbers). The composed game
scene needed a game-owned gate, so the spec freeze (T22 step 1) declares a third profile,
`structural` (structural-only class, budgets 128/65536/16/8), enforced by the
performance-flythrough expectation. Its console budget (8) is documented in the spec: it
admits the bounded, driver-throttled SwiftShader "GPU stall due to ReadPixels" notices that
software rasterization emits during any WebGL capture; `target` keeps a strict zero budget
for hardware qualification. The T21 profile-set assertion was updated to include the new
declared profile; all original T21 number assertions are intact.

## Gates (all fresh, exit 0 — see gate.txt)

- `bun run --cwd examples/blackwater-relay build` (the plan's `bun --cwd … run …` with the
  flag order bun 1.4 accepts)
- `bun run --cwd examples/blackwater-relay test:e2e` (6/6 scenarios settled, 3/3 tests)
- `bun run studio -- verify --project examples/blackwater-relay --suite single-player --json`
  (6/6 settled; fresh runs under `examples/blackwater-relay/artifacts/runs/`)
- `just check`, `just test` (339 pass), `just lint`, `just validate-agent-artifacts`

## Teeth (all three bite — see teeth.txt)

1. **Network transport disabled/removed** (`teeth:network-disabled`): config disabled +
   zero transport construction in `src/`; full suite settles; `network.read()` reports
   `not_registered`. Single-player is provably network-free (REQ-RUNTIME-009).
2. **Blender absent + donor ignored** (`teeth:blender-absent`): sanitized-PATH probe,
   unit tests, build, full e2e suite, and `donor:dependency-scan` all green without
   Blender; the committed derivative is sufficient (REQ-BLENDER-006/007).
3. **Corrupt semantic transition** (`teeth:corrupt-transition`): the corrupt-gate fixture
   keeps the gate's render animation while Koota stays closed; Gauntlet rejects settlement
   — decision `failed`, state channel `SEMANTIC_POSITION_MISMATCH` (gate stuck at closed
   height, delta exactly 4.0), pixels/telemetry healthy. The rover additionally stalls
   against the closed gate body (gate collision evidence falls out of the same fixture).

## Measured evidence (flythrough, software renderer — honest limits)

- Structural: draw_calls 4 ≤ 128; triangles 40688 ≤ 65536; textures 0 ≤ 16;
  console_errors 4 ≤ 8. Percentile distribution reported (p50 20.8 / p95 60.5 / p99 133.1
  ms); `unreported: []`.
- **Honest limit**: this host renders through SwiftShader, so `renderer_class: software`.
  Frame-time/FPS numbers are structural-context only and can never settle the `target`
  hardware profile; desktop-target performance remains unproven by T22 by design
  (REQ-PERF-003 separation held).

## Files created/changed (no git commits made)

- Frozen before implementation: `.agents/preregistrations/gauntlet-game-studio-plan-T22.prereg.yaml`;
  `examples/blackwater-relay/.agents/specs/game.spec.yaml` (scenarios, single_player,
  structural profile)
- Game source: `src/game/{config,state,physics,systems,build,headless,browser}.ts`,
  `src/main.ts`, `src/world/kits.ts`, `scripts/{bundle,teeth-network-disabled,teeth-blender-absent}.ts`
- Tests: `tests/{world,scenarios-headless.test}.ts`, `tests/scenarios-headless.run.ts`,
  `tests/e2e/{serve,run-suite,single-player.e2e,teeth-corrupt-transition}.ts`,
  `tests/expectations/*.json` (6), `.agents/suites/{single-player,teeth-corrupt-gate}.yaml`
- Project: `package.json` (scripts + pinned deps), `tsconfig.json`, `.gitignore`
- Studio: `apps/studio-cli/src/index.ts` (suite verify form + project game server),
  `packages/studio/test/performance/quality.test.ts` (declared-profile set update only)
- Root: `package.json` (workspaces += examples/blackwater-relay), `bun.lock`
- Evidence: `artifacts/plan/T22/{gate.txt,teeth.txt,summary.md}`;
  fresh runs under `examples/blackwater-relay/artifacts/runs/`

## Blockers / unknowns

- None blocking. Known bounded notes: (a) bun 1.4 flag order for the gate commands
  (`bun run --cwd`); (b) Koota's per-process 16-world cap required the headless scenario
  checks to run in a child process (wrapper test) and the e2e to serve one game per
  scenario run — both documented in code; (c) the drone's authoritative hover altitude
  rides the navmesh surface (up to ~2u above sampled ground due to walkableClimb=2), which
  the frozen tolerances absorb; (d) hardware-target performance is explicitly NOT settled
  by this task.
