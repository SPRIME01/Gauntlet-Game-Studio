# Task Settlement Summary: T23

**Task ID**: T23
**Title**: Settle Blackwater Relay authoritative multiplayer and impairment scenarios
**Proof Level**: P3
**Confirmation**: independent_adversarial (frozen preregistration: `.agents/preregistrations/gauntlet-game-studio-plan-T23.prereg.yaml`; verifier verdict pending — builder evidence below makes no settlement claim beyond the captured gates/teeth)
**Status**: GATES+TEETH GREEN (builder evidence; settlement requires independent confirmation)

**Governing requirements**: settles REQ-NET-008; confirms REQ-NET-001/003/004/005/007/008, REQ-SAFE-006, REQ-SEC-007.

## What was built

Blackwater Relay (`examples/blackwater-relay/`) now has an OPTIONAL authoritative
multiplayer mode that reuses the single-player semantic/runtime model with zero
duplication — the redesign_trigger boundary held:

1. **Authoritative headless server** (`src/server.ts`): boots the SAME `bootGameCore`
   composition as single-player (one Koota world, canonical seeded terrain, Rapier,
   Recast, BVH) and composes the T12 `AuthoritativeServer` over it on the Bun native
   WebSocket baseline. The simulation hook runs the game's single step owner
   (`stepGame`) exactly once per authoritative tick; the server is never a scheduler.
   A loopback `/state` observation endpoint exposes the server-side Koota truth
   (snapshot + diagnostics + interest-filter declaration) for evidence only.
2. **Networked browser client** (`src/net/net-page.ts` + `src/net/main.ts`, bundled to
   `dist/net-client.js` + `dist/net.html`): its Koota world is a PROJECTION world
   reconciled one-way from authoritative snapshots through the T12 `NetworkClient`
   (REQ-SAFE-006); it never runs the game simulation. Actions are validated sequenced
   commands only (`cmd.move`/`cmd.ping` — the T12 whitelist, unchanged). The page
   mounts the stable `__GAUNTLET_STUDIO_OBS__` v1 surface and is driven solely through
   the privileged control namespace (resetScenario arms the frozen per-scenario command
   plan; step pumps it) — no new control seam, no runtime modifications.
3. **Two independent clients**: separate Playwright contexts over system Chrome
   (`/usr/bin/google-chrome`, headless, no autoplay bypass). Client A connects first
   (deterministic `player-client-1`), client B second (`player-client-2`); the observer
   enforces the order via sequential readiness waits.
4. **Game-owned observation runner** (`tests/multiplayer/observer.ts`): per scenario,
   spawns the server child process, opens both clients, captures the declared channels
   at each scenario's declared observation checkpoint (state = B's reconciled Koota
   projection; telemetry = full console/page sweep + tick; network = both clients'
   `network.read()` diagnostics), captures the server authoritative state and phase
   artifacts (disconnect/reconnect records, interest absence window), and enforces the
   frozen phase/deep checks (failure ⇒ typed blocked observation, never passed).
   Evidence flows through the canonical studio EvidenceStore sink.
5. **Studio-side suite support** (minimal, additive): `studio verify --project <dir>
   --suite multiplayer --json` reuses the T22 suite form; the suite manifest's
   declared `observation.mode: project-runner` swaps only the observation step for the
   game-owned two-client observer. Settlement machinery unchanged.

## Frozen scenarios (declared in game.spec.yaml BEFORE implementation; expectations committed first)

| Scenario | Settles on (state channel = client B's reconciled projection at the declared checkpoint) |
|---|---|
| multiplayer-sync | A bursts 30 sequenced moves (+x, speed 50 ⇒ exactly +25.0); B bursts 5 (+x, speed 6 ⇒ +0.5). B reconciles `player-client-1` at (25, 0, 0) and `player-client-2` at (0.5, 0, 0); server truth identical. Disconnect phase: explicit closed session + authoritative despawn replicated to B; bounded reconnect as client-3 with no client-authority takeover. |
| interest-filtering | A moves out to +75 (beyond the declared 40-unit `RadiusInterestFilter`): B's projection despawns `player-client-1` (absence-window artifact); return burst brings it back to exactly (0, 0, 0) and replication resumes (re-acquired at the checkpoint). |
| multiplayer-latency | Same sync window with A's transport impaired (fixed 40 ms + jitter 40 ms, seeded, zero loss): commands arrive reordered, the server's strict-sequence drain recovers (out_of_order 36/36), B still reconciles exactly (25, 0, 0); acting-client RTT 54.1 ms vs observer 8 ms, latency-simulation stats exposed, transport characteristics honestly downgraded (`bun-websocket+latency-sim`, reliable=false, ordered=false). |

Measured diagnostics captured per run (`artifacts/runs/<run-id>/artifacts/`):
`net-diagnostics.json` (command/ack/reconciliation/ping/RTT/bandwidth + latency-sim
stats for BOTH clients), `server-state-checkpoint/final.json` (authoritative Koota
snapshot + server counters/bandwidth/closed records), `net-deep-checks.json`,
`interest-absence-window.json`, screenshots of both clients.

## Gates (all fresh, exit 0 — see gate.txt)

- `bun run --cwd examples/blackwater-relay test:blackwater-multiplayer` — Gate 1:
  3/3 scenarios settled (multiplayer-sync, interest-filtering, multiplayer-latency) +
  single-player build-graph transport-free proof (2/2 tests).
- `bun run studio -- verify --project examples/blackwater-relay --suite multiplayer
  --json` — Gate 2: 3/3 settled with fresh ObservationRun + EvidenceManifest +
  SettlementRecord per scenario (runs `run-multiplayer-sync-33188d92efb8-20260916T224542Z`,
  `run-interest-filtering-…-T224544Z`, `run-multiplayer-latency-…-T224547Z`; revision
  `33188d92efb8aaddcbef675f6c954598bdc03535` = git HEAD, working tree uncommitted per
  the no-commit constraint).
- Single-player regression: `test:e2e` 6/6 settled + navigation/spatial + network-free
  surface proof (3/3 tests); `teeth:network-disabled` (TEETH-T22-001) bits; `studio
  verify --suite single-player --json` 6/6 settled.
- `just check`, `just test` (339 pass), `just lint`, `just validate-agent-artifacts`.

## Teeth (all three bite — see teeth.txt, fresh exit 0)

1. **Forge client-side authoritative gate/objective state**: a RAW WebSocket client
   (no game code) sends a `state.set` state-authoring kind, a move targeting the relay
   gate (unowned), a forged client identity, and a client-side `replication.snapshot`
   spoof. All four rejected (`kind_not_permitted` / `entity_not_owned` /
   `client_id_forgery`); counters advance (forged_rejected=4, commands_rejected=4);
   the authoritative snapshot of all forge-target and non-simulated entities is
   byte-identical across the attack window. Documented refinement: the rover/drone are
   excluded from the fingerprint because they move through the server's OWN
   authoritative simulation step (no client input) — the forge attempts touch nothing.
2. **Latency/jitter + command reorder**: 30 commands through a seeded impaired
   transport arrive reordered (out_of_order_buffered=28, processed=28 in the teeth
   leg); strict-sequence drain preserves the declared invariants — authoritative and
   reconciled positions both land at exactly 25.0 — and telemetry exposes the
   impairment (latency-simulation stats, RTT, honest characteristic downgrade).
3. **Disconnect the authoritative transport mid-scenario**: server-side drop yields an
   explicit `disconnected` state on both ends, authoritative despawn of the player
   entity, a recorded closed session, and a client projection FROZEN at the last
   authoritative snapshot (no local simulation starts — no silent authority takeover);
   a bounded reconnect opens a fresh session (`client-2`/`player-client-2`) without
   trusting any client-authored state. Also exercised over real WebSockets inside the
   multiplayer-sync scenario (client-1 → despawn → client-3 reconnect, observed by B).

## Dependency / scope discipline

- NO changes to `packages/runtime/**` (T12 composed, never modified). No new npm
  dependencies (Playwright was already the game's pinned devDependency; Bun native
  WebSockets are built in). No git commits; no `.tmp/donor` imports; no LLM calls.
- Additive studio changes: `packages/studio/src/gauntlet/{expectation,checks}.ts`
  gained OPTIONAL `network.client` / `network.acting_client` constraint blocks
  (default-off; every T20/T21/T22 expectation parses unchanged — 169 studio tests
  green); `apps/studio-cli/src/index.ts` gained the manifest-declared project-runner
  observation branch + `net.html`/`net-client.js` static routes.
- The T22 `teeth:network-disabled` Leg A scan scope was refined to the single-player
  build graph with the T23-declared multiplayer entries (`src/server.ts`, `src/net/`)
  as the ONLY sanctioned transport home; any transport reference anywhere else in
  `src/` still fails the tooth. All three legs pass.

## Files created/changed (no git commits made)

- Frozen before implementation: `.agents/preregistrations/gauntlet-game-studio-plan-T23.prereg.yaml`;
  `examples/blackwater-relay/.agents/specs/game.spec.yaml` (multiplayer block + 3
  scenarios; single_player declaration kept); `tests/expectations/{multiplayer-sync,
  interest-filtering,multiplayer-latency}.json`; `.agents/suites/multiplayer.yaml`.
- Game source: `src/server.ts`, `src/net/{net-page,main}.ts`, `src/game/config.ts`
  (frozen MULTIPLAYER constants + comment reword), `scripts/bundle.ts` (net entry),
  `scripts/teeth-network-disabled.ts` (Leg A T23 scope refinement).
- Tests: `tests/multiplayer/{observer,run-multiplayer-suite,multiplayer.e2e,
  teeth-multiplayer}.ts`, `tests/e2e/serve.ts` (net routes).
- Studio: `packages/studio/src/gauntlet/{expectation,checks}.ts` (additive network
  diagnostic constraints), `apps/studio-cli/src/index.ts` (project-runner branch,
  net static routes).
- Project: `package.json` (game scripts `test:blackwater-multiplayer`,
  `teeth:multiplayer`), root `package.json` (plan-literal gate binding),
  `AGENTS.md` (multiplayer declaration + gates).
- Evidence: `artifacts/plan/T23/{gate.txt,teeth.txt,summary.md,
  gate2-multiplayer-verify.json.raw}`; fresh runs under
  `examples/blackwater-relay/artifacts/runs/`.

## Blockers / unknowns

- None blocking. Bounded notes: (a) the plan's literal `bun run
  test:blackwater-multiplayer` works at the repo root through a root package.json
  script binding (`bun run --cwd examples/blackwater-relay
  test:blackwater-multiplayer`, the working bun 1.4 flag order documented in T22);
  both forms were run fresh with exit 0; (b) the T1 fingerprint
  excludes simulation-driven bodies (rover/drone) as documented above; (c) run
  environment records `clients: 2` / `server_transport` via a typed cast because the
  adapters' ObservationEnvironment interface has fixed keys (runtime schema accepts
  them); (d) WebRTC remains an optional transport not exercised here (baseline is Bun
  native WebSockets per REQ-NET-002); (e) the disconnected client's Koota projection
  keeps its last authoritative state by design — the client never simulates, so
  nothing can drift while disconnected.
