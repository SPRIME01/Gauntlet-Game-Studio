# T22 Independent Adversarial Confirmation Record

- **Confirmation mode**: independent_adversarial (per plan T22 preregistration)
- **Confirmed at**: 2026-09-16 (fresh verifier session; builder conclusions not treated as authority)
- **Required verdict**: CONFIRM
- **Actual verdict**: **CONFIRM**
- **Scope**: REQ-GOAL-002/003/004/007/008/010, REQ-RUNTIME-001/004/005/006/009, REQ-SKILL-004/005, REQ-TERRAIN-001/002/003, REQ-AUDIO-001/002, REQ-BLENDER-006/007, REQ-PERF-001/002/003/004

## Gates reproduced fresh (verifier's own runs, exit 0)
- `bun run --cwd examples/blackwater-relay build` (typecheck + deterministic bundle) — note: the plan's literal
  `bun --cwd <dir> run build` silently no-ops under bun 1.4; the working order is documented in
  artifacts/plan/T22/summary.md and used throughout.
- `bun run --cwd examples/blackwater-relay test:e2e` — all six scenarios SETTLED
- `bun run studio -- verify --project examples/blackwater-relay --suite single-player --json` — 6/6 settled on
  FRESH ObservationRuns bound to the current revision
- `just check`, `just test` (339/339), `just lint`, `just validate-agent-artifacts`

## Adversarial findings (all attacks rejected)
1. Network freedom: builder tooth rerun passes; verifier's own stronger sabotage replaced WebSocket,
   EventSource, RTCPeerConnection, sendBeacon, cross-origin fetch, and XHR with throwing versions in a
   disposable copy — all six scenarios still SETTLED (any console error would fail the frozen telemetry budget).
   No `new WebSocket` in the built bundle; readiness barrier registers terrain/physics/navigation/spatial only.
2. Tool independence: with blender genuinely absent from PATH and `.tmp` stripped, disposable-copy rebuild runs
   8/8 unit tests and all six e2e scenarios SETTLED on the committed GLB derivative; donor scans green.
3. Semantic authority: corrupt-gate fixture reproducible — settlement `failed` via `SEMANTIC_POSITION_MISMATCH`
   (gate Y delta exactly 4.0) while pixels/telemetry pass, and the rover physically stalls at the closed kinematic
   gate (physics/state coherence). Verifier's own additional divergence (beacon mounted +6 off its socket while
   VFX/HUD/mounting event fire) also rejected via the state channel.
4. Authority boundaries: one canonical heightfield feeds render/Rapier collider/Recast navmesh/world-kit sockets
   (injected sampler); Koota sole semantics with unidirectional render sync; GLB animation render-only; VFX/audio/
   HUD one-way consumers; exactly one scheduler singleton and one step handler issuing one physics step + one
   crowd step per tick; single three@0.170.0 graph.
5. Independence/buildability: own package.json/tsconfig; zero escaping relative imports; `workspace:*` on
   first-party packages is the declared T05 mechanism; template untouched.
6. Freshness/correlation: CLI verify re-observes fresh per invocation; store append-only (preserved iterations
   per scenario); T20 stale-evidence rejection reproven fresh; recorded gate/teeth/perf numbers match fresh reruns
   (flythrough triangles deterministically 40,688; `renderer_class: "software"`).

## Prereg discipline
Prereg frozen (status: frozen) with mtime ordering confirming freeze-before-evidence: prereg → game spec scenario
freeze → expectations → first evidence. All three falsifiers reproduced fresh.

## Honesty
Performance claims are structural-only: fresh flythrough labeled `renderer_class: "software"` (SwiftShader probe);
the `target` hardware profile is explicitly NOT claimed; every scenario criterion in the frozen spec is an
observable assertion actually evaluated by the settlement machinery.

## Non-blocking observations
1. Revision binding is git HEAD; the post-confirmation commit finalizes the revision the evidence describes.
2. The pixels channel checks fresh-capture presence/dimensions/sha256, not semantic content — semantics settle via
   the state channel, which the corruption teeth prove is load-bearing.
