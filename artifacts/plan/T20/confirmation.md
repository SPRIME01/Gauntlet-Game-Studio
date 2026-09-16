# T20 Independent Adversarial Confirmation Record

- **Confirmation mode**: independent_adversarial (per plan T20 preregistration)
- **Confirmed at**: 2026-09-16 (fresh verifier session; builder conclusions not treated as authority)
- **Required verdict**: CONFIRM
- **Actual verdict**: **CONFIRM**
- **Scope**: REQ-GOAL-004, REQ-OUT-003, REQ-BIND-010, REQ-VERIFY-001, REQ-VERIFY-002, REQ-VERIFY-005, REQ-GAUNTLET-001..006

## Gates reproduced fresh (verifier's own runs, exit 0)
- `bun run test:proof-harness` — 22 deterministic tests + real-Chrome legs A–D PASS
- `bun run studio -- evidence check-fixtures --json` — 2 valid + 1 rejected-as-expected
- `just check` (tsc clean), `just test` (260/260), `just lint`, `just validate-agent-artifacts`

## Adversarial findings (all attacks rejected)
1. Pixels-over-state: fresh reruns of both fixture variants produce byte-identical screenshots (same sha256)
   while semantic snapshots diverge; settling the wrong-state run yields decision `failed`, blockage class
   `represented_but_defer` (represented_but_deficient), failing check `state/SEMANTIC_POSITION_MISMATCH`, and the
   `pixels_pass_state_fail` contradiction. `settleExpectation` structurally has no provider/build-success input;
   the spec's verify_observation pseudocode is implemented step-for-step.
2. Stale evidence: cross-revision manifest append → typed `EvidenceCorrelationError`; freshness validation →
   `EvidenceStaleError` (identity-based, not filename-based); settlement with foreign/uncorrelated evidence →
   `incomplete`, never settled; run overwrite / manifest-ID reuse / settlement rewrite all refused
   (`EvidenceImmutabilityError`); failed evidence preserved append-only in committed fixtures.
3. Unavailability honesty: injected failing Playwright loader → typed `PLAYWRIGHT_UNAVAILABLE`, blocked run and
   blocked settlement (still blocked when availability is lied about, because the manifest gates settlement).
   Launch args minimal; zero autoplay/policy bypass; all page evaluation scoped to the __GAUNTLET_STUDIO_OBS__ v1
   contract (no DOM/game-internal coupling in harness or surface client).
4. Separation: ObservationRun/EvidenceManifest, channel checks (interpretation), and SettlementRecord are distinct
   types in distinct modules; observation `result:"pass"` means evidence-obtained and cannot become settlement.
5. Fixture integrity: tampering a screenshot byte or forging manifest hashes fails `ARTIFACT_HASH`; a real
   semantic tamper of the state snapshot is caught by hash mismatch; fixtures provenance-real (generated via
   `run-browser-proof.ts --write-fixtures`, real Chrome 151, fixed timestamps).

## Prereg discipline
Prereg frozen (status: frozen; mtime precedes all evidence). All three falsifiers independently reproduced fresh.

## Honesty
summary.md scopes claims to the contract-v1 fixture machinery — not the full Blackwater game (T22); performance
is T21; network channel loopback-only.

## Recorded non-blocking observations
1. Fixture screenshots are Chrome-version-sensitive bytes; regenerate via `--write-fixtures` on Chrome upgrades
   (the checker fails honestly on drift by design).
2. The committed evidence fixtures under artifacts/runs/ double as regression fixtures; they are evidence
   artifacts with fixed timestamps, not live runs.
