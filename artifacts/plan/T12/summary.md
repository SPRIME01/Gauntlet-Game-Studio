# Task Settlement Evidence: T12

## Task Information
- **Task ID**: `T12`
- **Title**: Implement optional authoritative multiplayer over Bun native WebSocket baseline and transport abstraction
- **Proof Level**: `P3`
- **Confirmation**: `independent_adversarial` — PENDING (verifier receives source requirements, frozen prereg, implementation, fresh evidence, and the exact confirmation question; builder conclusions are non-authoritative context)
- **Settles**: `REQ-BIND-013`, `REQ-NET-001`, `REQ-NET-002`, `REQ-NET-003`, `REQ-NET-004`, `REQ-NET-005`, `REQ-NET-006`, `REQ-NET-007`, `REQ-NET-009`, `REQ-SAFE-006`, `REQ-SEC-007`
- **Timestamp**: 2026-09-15T23:30:00Z
- **Preregistration**: `.agents/preregistrations/gauntlet-game-studio-plan-T12.prereg.yaml` (frozen before implementation and before any evidence evaluation)

## Implementation Overview
1. **Transport-neutral boundary** (`packages/runtime/src/network/types.ts`, `transport.ts`):
   - `ConnectionTransport`/`ServerTransport` interfaces exposing `TransportCharacteristics`:
     reliability, ordering, `supportsUnreliable`, `supportsUnordered`, backpressure
     (`pendingBytes`/`pendingMessages`), connection state, transport-level RTT, and
     `maxMessageBytes` (REQ-BIND-013, REQ-NET-002).
   - Requesting an unsupported delivery mode is REJECTED (`unreliable_not_supported` /
     `unordered_not_supported`), never silently degraded — WebSocket and WebRTC semantics
     are structurally non-equivalent.
   - `InMemoryServerTransport`: deterministic loopback for pure tests/diagnostics.
   - `LatencyImpairedTransport`: wraps any client transport through the first-party
     `LatencySimulator` (delay/jitter/reorder/loss) with observable impairment stats.
   - WebRTC/geckos.io documented as an OPTIONAL advanced transport (unreliable/unordered)
     in every characteristics note; NOT a baseline; zero new dependencies added.
2. **Bun native WebSocket baseline** (`bun-websocket.ts`):
   - Server side via `Bun.serve` built-in WebSockets (ephemeral port support, per-socket
     ids, buffered-amount backpressure); client side via the standard WebSocket API.
     Built into Bun 1.4 — no npm dependency added (REQ-BIND-013, REQ-BIND-014).
3. **Wire protocol** (`protocol.ts`):
   - Reuses the authoritative `@gauntlet/contracts` `NetworkEnvelope` schema via
     `validateNetworkEnvelope` (REQ-NET-007). Closed kind whitelist: client→server only
     `cmd.move`/`cmd.ping` (sequence ≥ 1); server→client `net.welcome|pong|ping|reject|
     disconnect`, `replication.snapshot` (sequence 0 = unsequenced control). Explicit wire
     limits (64 KiB message, 4 KiB command payload, 512 entities/snapshot).
4. **Authoritative server** (`server.ts`):
   - Koota `GameWorld` is the sole semantic authority; envelopes/projections never are
     (REQ-NET-001). Per-connection lifecycle: welcome + player entity spawn on accept;
     explicit `connected | disconnected | timed_out` session states; explicit recorded
     despawn on disconnect/timeout; bounded closed-client record ring (REQ-NET-009).
   - Untrusted-input pipeline: size → JSON → contracts schema → client identity → kind
     whitelist → payload shape → ownership (a client may move ONLY its own player entity)
     → sequence window — ALL before any semantic mutation (REQ-SEC-007, REQ-NET-003).
   - Command buffering + strict in-order drain on authoritative ticks; bounded buffers
     (256 default); duplicate/replay drop; `ack_sequence` published on every snapshot
     (REQ-NET-004). Bounded recovery: full-buffer backpressure (new arrivals refused with
     explicit reject) plus explicit tick-bounded gap skip — a session never wedges and
     never silently rewrites authority.
   - Authoritative Koota-side `simulationHook` per tick; the server is a scheduler step
     CONSUMER, never a second scheduler. `bootNetworkSubsystem` binds the optional
     "network" subsystem to the `SubsystemBarrier`; single-player never calls it.
5. **Replication & reconciliation** (`replication.ts`):
   - One-way `projectEntities` from Koota; `AllInterestFilter` and `RadiusInterestFilter`
     relevance filtering so clients receive only nearby entities, with per-client
     removed-entity deltas (REQ-NET-005).
   - `reconcileSnapshot`: authoritative snapshots win in the client PROJECTION world
     (never authority), then at most `maxReplayCommands` unacked commands are replayed
     (client-side prediction, REQ-SAFE-006).
6. **Client** (`client.ts`): monotonic per-client sequencing, bounded pending window
   (default 128, oldest dropped + counted), ack-driven pending eviction, client-initiated
   `cmd.ping` RTT (EWMA), auto-echo of server liveness pings, explicit server-disconnect
   state.
7. **Diagnostics** (`diagnostics.ts`): ping/RTT estimators, per-peer/aggregate bandwidth
   via the T09 `BandwidthTracker`, full command/replication/forgery/reorder counters, and
   `LatencySimulator` stats exposure on impaired channels (REQ-NET-006).
8. **Donor consult** (post-design, per operating contract): `.tmp/donor/Core/.../Networking/
   Server/Commands.ts` (21 lines: kind string-enum + optional `sequenceId` + ping/pong
   concepts) consulted AFTER first-party contracts were designed; classified
   **REWRITE_FROM_CONCEPT** (row already declared in T09's PROVENANCE matrix, target
   `packages/runtime/src/network/`); `vendor/attribution.json` `copied_code` entry
   extended with the network destination modules and T12 purpose. No donor imports,
   branding, or semantic classes; `donor:dependency-scan`, `donor:audit`, and
   `donor-isolation` tests all remain green.

## Verification Evidence
- **Narrow Gates** (fresh runs, exit 0):
  - `bun test packages/runtime/test/network` — 29 pass / 0 fail, 178 expects, 5 files
  - `bun run network:headless-smoke` — real Bun WebSocket server+client loop: welcome,
    sequenced commands, Koota mutation, acks, 30 interest-filtered snapshots,
    reconciliation, RTT 6.6 ms, 9,326 bytes accounted — SUCCESS
  - Gate log: `artifacts/plan/T12/gate.txt`
- **Teeth / Falsification Checks**: all three preregistered falsifiers exercised fresh with
  PASS verdicts — `artifacts/plan/T12/teeth.txt`:
  - TEETH-T12-001: forged `state.set` / impersonated `replication.snapshot` / oversized /
    malformed / cross-entity / id-forgery / replay attacks all rejected; Koota unchanged.
  - TEETH-T12-002: 24 commands delayed+reordered through LatencySimulator; processed
    exactly once in order, ack bounded & complete, reconciliation converged, diagnostics
    expose impairment (out-of-order counters + simulator stats); loss variant recovers
    via explicit bounded skips (skips=2) and buffer backpressure (6 refusals), session
    fully recovers (ack=13).
  - TEETH-T12-003: single-player scenario starts via readiness barrier with NO network
    subsystem, runs 60 normal ticks, zero servers/transports ever constructed
    (`AuthoritativeServer.getActiveServerCount() === 0`).
- **Global Gates** (fresh runs, all exit 0): `just check`, `just test` (184 pass / 0 fail
  across 27 files, 1611 expects), `just lint`, `just validate-agent-artifacts`.
- **Donor isolation**: `bun run donor:dependency-scan` (zero donor imports/deps/mappings),
  `bun run donor:audit` (0 errors), `bun run third-party:verify` (all 5 attribution
  classes + overlay policy verified).

## Known limitations (not claimed)
- Two-client conformance under nominal AND impaired latency (REQ-NET-008) is T23 scope;
  this task proves the single-client authoritative loop end-to-end (real sockets in smoke,
  deterministic in-memory in tests) plus transport-level realism via the latency wrapper.
- `LatencyImpairedTransport` impairs the client→server direction only; server→client
  impairment can be added by wrapping server-side sends once a conformance scenario needs
  it (interface supports it; no task gate requires it here).
- Reconnection after disconnect is "new connection, new client_id, fresh session"
  (bounded, explicit); session-resume/re-join semantics are not claimed.

## Scope Notes
- Root `package.json` changed by exactly one appended script line:
  `"network:headless-smoke": "bun run ./packages/runtime/src/network/headless-smoke.ts"`.
- `packages/runtime/src/index.ts` changed by exactly one appended export line
  (`export * from "./network";`).
- No new npm dependencies; no git commits; `.agents/CURRENT_STATUS.yml` untouched.
