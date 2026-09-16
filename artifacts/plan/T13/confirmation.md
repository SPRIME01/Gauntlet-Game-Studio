# T13 Peer Confirmation Record

- **Confirmation mode**: peer (per plan T13 preregistration)
- **Confirmed at**: 2026-09-15 (fresh reviewer session; builder conclusions not treated as authority)
- **Required verdict**: CONFIRM
- **Actual verdict**: **CONFIRM**
- **Scope**: REQ-OUT-002, REQ-ASSET-003, REQ-ASSET-005, REQ-ASSET-006, REQ-ASSET-007, REQ-BIND-008, REQ-SAFE-003, REQ-SEC-004

## Gates reproduced fresh (reviewer's own runs, exit 0)
- `bun test packages/studio/test/assets` — 42 pass / 0 fail
- `bun run studio -- asset verify --all --json` — exit 0 (vacuous at root; fixture: accepted 1, degraded 1, pending 1)
- `just check`, `just test` (184/184), `just lint`, `just validate-agent-artifacts`

## Falsifiers — real passing evidence
- TEETH-T13-001: unknown license → intake `blocked`, `accept()` refuses, `verifyAll` fails, CLI exits 1; block
  event preserved in append-only history.
- TEETH-T13-002: over-budget accept → `rejected`; only path is explicit recorded waiver (author+reason+gate) →
  visible `degraded`; waivers structurally cannot extend past budget gates.

## Alternate failure paths probed (all held)
- Six forged manifests written directly to disk (bypassing the API) — all caught: `verifyAll` re-runs every gate
  per record rather than trusting stored `acceptance_state`; reference-only imagery blocked from production even
  on forged records.
- KTX2-required-without-toktx → typed `blocked/TOKTX_UNAVAILABLE`, no output written (toktx genuinely absent on
  this machine); WebP baseline succeeds; no silent downgrade path exists.
- Poly Haven network-down → typed `blocked/NETWORK_UNAVAILABLE`, zero bytes written; path-traversal fails closed.
- Append-only history survives save/load; supersession retains predecessor; no delete/truncate surface.

## Residual observations (recorded, do not defeat the claim)
1. `verifyAll` pattern-checks `sha256` but does not re-hash retained source files; a fabricated-but-well-formed
   hash can pass gate shape checks. Automated intake hashes real bytes; this is a self-asserted-metadata limit,
   not a spec violation. Future hardening candidate.
2. Origin class is self-declared; a download declared `procedural` skips stricter cc0 requirements. Classes remain
   structurally distinguishable and the CC0 adapter records true class.
3. `intake()` can store a smuggled `acceptance_state: "accepted"` with valid provenance, but `verifyAll` re-runs
   gates, so the release check still holds.
4. REQ-ASSET-005 (SHOULD-preference) settled thinly but defensibly: CC0 Poly Haven and glTF-Transform are
   first-class capabilities and no paid/opaque generative provider exists in the catalog.
