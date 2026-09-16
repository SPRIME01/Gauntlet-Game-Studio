# T12 Independent Adversarial Confirmation Record

- **Confirmation mode**: independent_adversarial (per plan T12 `independent_confirmation` and frozen prereg)
- **Confirmed at**: 2026-09-15 (fresh verifier session; builder conclusions not treated as authority)
- **Required verdict**: CONFIRM
- **Actual verdict**: **CONFIRM**
- **Scope**: REQ-BIND-013, REQ-NET-001, REQ-NET-002, REQ-NET-003, REQ-NET-004, REQ-NET-005, REQ-NET-006, REQ-NET-009, REQ-SAFE-006, REQ-SEC-007

## Gates reproduced fresh (verifier's own runs, exit 0)
- `bun test packages/runtime/test/network` — 29 pass / 0 fail
- `bun run network:headless-smoke` — real Bun WebSocket loopback, 10/10 checks
- `just check`, `just test` (184/184), `just lint`, `just validate-agent-artifacts`, `bun run donor:dependency-scan`

## Adversarial attacks — all six failed to break the implementation
1. **Authority smuggling**: ~25 hostile messages (state-setting kinds, impersonated snapshots, spoofed identity,
   replays, NaN/speed exploits, 200 KB payloads). Authoritative state byte-identical before/after; every rejection
   observable. Enforcement chain (size→JSON→schema→identity→kind whitelist→sequence→payload→ownership) all runs
   before mutation (packages/runtime/src/network/server.ts).
2. **Sequencing under impairment**: hostile transport (reorder + permanent swallow) recovers via explicit bounded
   skip; survivors applied exactly once; ack converges; 500-sequence flood drains; diagnostics expose impairment.
3. **Single-player freedom**: with a `Bun.serve` spy installed, headless kernel runs 60 ticks with zero network
   initialization; `AuthoritativeServer.getActiveServerCount() === 0`.
4. **Transport replaceability**: `ConnectionTransport`/`ServerTransport` expose material characteristics;
   unsupported delivery modes rejected (never silently degraded); zero node-datachannel/geckos dependencies;
   WebSocket ≠ WebRTC semantics preserved.
5. **Koota purity**: no network fields in traits; replication is one-way projection; reconciliation only into a
   distinct client projection world; no second tick owner.
6. **Donor independence**: no donor imports/branding; command-sequencing REWRITE_FROM_CONCEPT attribution recorded.

## Prereg discipline
Prereg `status: frozen`; file mtime precedes earliest implementation file (verified via mtimes). All three
falsifiers reproduced passing by the verifier.

## Recorded non-blocking observations
1. `WIRE_LIMITS.maxCommandPayloadBytes` (protocol.ts) is declared but unenforced; effective bound is the 64 KB
   message limit. No authority impact (extra fields ignored); future hardening candidate, not a spec violation.
2. No per-connection message rate limiting (buffers bounded; validation-before-mutation holds; not spec-required).
3. REQ-NET-008 two-client reference-game conformance is T23 scope per plan `does_not_prove`; no overclaim.
4. At confirmation time the T12 implementation was uncommitted working-tree state; evidence verified against that
   exact tree. Settlement commit follows this record.
