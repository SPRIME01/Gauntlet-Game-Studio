# T19 Independent Adversarial Confirmation Record

- **Confirmation mode**: independent_adversarial (per plan T19 preregistration)
- **Confirmed at**: 2026-09-16 (fresh verifier session; builder conclusions not treated as authority)
- **Required verdict**: CONFIRM
- **Actual verdict**: **CONFIRM**
- **Scope**: REQ-OUT-004, REQ-OBS-001, REQ-OBS-002, REQ-OBS-003, REQ-OBS-004, REQ-OBS-005, REQ-SEC-005

## Gates reproduced fresh (verifier's own runs, exit 0)
- `bun test packages/runtime/test/observability.test.ts` — 12/12
- `bun run test:production-observability` — production surface clean; both negative controls fail as required
- `just check` (full-repo tsc), `just test` (238/238), `just lint`, `just validate-agent-artifacts`

## Adversarial findings (verifier's own attack shapes)
1. DOM-only, provider-internals-only, header-only, method-dropped, wrong-version, and wrong-name surfaces all
   FAIL `validateObservabilityContract`; real surface reads equal `GameWorld.takeSemanticSnapshot()` bit-for-bit
   (Koota correlation is the semantic teeth).
2. Production bridge exposes exactly 17 read methods; `control` never constructed; mount non-writable and
   non-configurable (replacement/deletion throw); injected `pause`/`setSeed`/`control` namespace all FAIL the
   inspector; dev-surface-as-production fails with 11 violations; the 17 reads mutate nothing.
3. No authority smuggling: `control.step` advances THE kernel scheduler via the canonical `stepSingleTick`; zero
   Koota writes / scheduler construction / DOM access in observability source.
4. Coverage honestly disclosed: renderer probe is a headless-safe wiring seam; production authorization-gating is
   not claimed — the proven boundary is full structural absence of mutation APIs (REQ-OBS-005 "absent" branch).

## Recorded non-blocking observations
1. A lying-but-non-throwing stable method would pass the structural validator alone; it is convicted by the
   Koota-correlation equality check.
2. A token-less mutation name (e.g., `fastForward()`) would evade the name-based production inspector; structural
   absence is the primary guarantee and the inspector is a regression tripwire.
