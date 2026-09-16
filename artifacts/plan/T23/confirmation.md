# T23 Independent Adversarial Confirmation Record

- **Confirmation mode**: independent_adversarial (per plan T23 preregistration)
- **Confirmed at**: 2026-09-16 (fresh verifier session at revision 33188d9; builder conclusions not treated as authority)
- **Required verdict**: CONFIRM
- **Actual verdict**: **CONFIRM**
- **Scope**: settles REQ-NET-008; confirms REQ-NET-001, REQ-NET-003, REQ-NET-004, REQ-NET-005, REQ-NET-007, REQ-SAFE-006, REQ-SEC-007

## Gates reproduced fresh (verifier's own runs, exit 0)
- `bun run test:blackwater-multiplayer` — 3/3 scenarios SETTLED
- `bun run studio -- verify --project examples/blackwater-relay --suite multiplayer --json` — 3/3 settled with fresh
  ObservationRun/EvidenceManifest/SettlementRecord per scenario
- Single-player regression: `test:e2e` (6/6 scenarios + network-free surface proof) and
  `studio verify --suite single-player` 6/6 — green and simultaneous
- `just check`, `just test` (339/339), `just lint`, `just validate-agent-artifacts`

## Adversarial findings (all attacks rejected)
1. Authority takeover: a raw-WebSocket hostile client (no game code) sent 15+ hostile vectors — `state.set`,
   replication/welcome spoofs, cross-entity moves, forged identities, replays with mutated payloads, malformed/70KB
   messages, negative/reserved sequences, gap-too-large, prototype pollution, POST to the observation endpoint.
   Every vector typed-rejected and counted; authoritative Koota snapshot byte-identical across the attack window;
   the attack's only legitimate displacement matched analytical accounting exactly (no double-application); the
   server stayed alive and applied a subsequent owned command exactly once.
2. Impairment: at ~9× declared impairment (150ms + 350ms jitter) with a 345-command burst plus an injected
   permanent head gap — peak buffering 121 ≤ the 256 bound, explicit bounded gap-skip, buffer fully drained, exact
   displacement to 1e-6, latency-sim stats exposed, transport characteristics honestly downgraded.
3. Disconnect: SIGKILLed client → explicit `disconnected` + authoritative despawn replicated to an independent
   observer; 9.5s silence → explicit `timed_out`; reconnect lands as a fresh identity at declared spawn with no
   forged state carried over; client projection freezes with no local simulation (no authority takeover).
4. Same model: the server boots the identical `bootGameCore` + `stepGame` composition as single-player; the net
   client contains no game semantics; `teeth:network-disabled` bites fresh; `packages/runtime/**` unmodified.
5. Relevance: fresh absence-window artifact — B's projection lacked the far entity while server truth held it;
   radius filter is game-declared in the frozen spec; re-acquired on return.
6. Scope honesty: WebRTC intentionally unexercised (baseline Bun WS per REQ-NET-002); internet-scale/matchmaking
   not claimed; loopback-only accurately documented.

## Prereg discipline
Prereg frozen (status: frozen) before implementation and evidence; all three falsifiers reproduced fresh via the
builder's teeth suite and the verifier's own independent harnesses.

## Non-blocking observations
1. Run environments honestly record headed Chrome for the studio-verify legs (the server itself is the headless
   authority).
2. The latency simulator's jitter is ±jitterMs/2, consistent with the frozen RTT floor declaration.
