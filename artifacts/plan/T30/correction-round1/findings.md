# T30 Correction Round 1 — Adversarial REJECT (REQ-RES-003 not settled)

Independent adversarial verification returned REJECT: the reservoir intake/acceptance/reuse path
(put + markAccepted → R1 resolution) applies no accepted-license-set or unknown-license rejection,
so an unlicensed resource becomes production-reusable — refuting REQ-RES-003 / prereg claim
"unknown licenses are unusable". Confirmed by executed attack (H1).

All holes found (preserved verbatim from the verifier report, artifacts/plan/T30/correction-round1/verifier-report.md):
- H1 (falsifying): reservoir license-gate bypass — fix required before settlement.
- H2: provider-declared stage untrusted (a provider declaring "scratch" satisfied R10 with no exception).
- H3: resolver intake does not validate creation exceptions; records written without schema validation.
- H4: asset-kind R1 skip (reservoir never consulted when delegation acquires) — cascade-order tension.
- H5: composite R4 recorded "satisfied" on declaration alone (theater).
- H6: creation exceptions not bound to the request they justify.
- H7: first-match-only evaluation; fail-closed asymmetry (documented, partly defensible).
- H8: record() TOCTOU (existsSync + write instead of wx exclusive create).
- H9: blob dedupe per (content, filename), not per content.
- Minor: RESERVOIOIR typo; non-atomic writeIndex; no CLI surface populates the reservoir.

Correction: fix the falsified layer (license gates + validation teeth), re-run the preregistered
falsifiers, then obtain fresh independent adversarial confirmation. No criterion weakened.

## Correction round 1 — fixes applied (all verified by regression tests)

- H1: `ReservoirStore.put` rejects unknown/unacceptable licenses at intake (RESERVOIR_LICENSE_UNACCEPTABLE);
  `markAccepted` refuses them; the R1 resolution hit honors `require_license`.
- H2: providers declaring authority-bearing stages (reuse-accepted/reuse-reservoir/scratch) are clamped out
  of the cascade with a recorded skipped attempt.
- H3: creation exceptions are validated at the resolver boundary (schema + routes_searched non-empty) and
  bound to the request (derivative_id/id/what must reference the requested id); only validated exceptions
  are embedded in records; every record is schema-validated before write (RECORD_SCHEMA_INVALID is thrown,
  never persisted).
- H4: asset-kind delegation now runs as a provider-free reuse probe (R0) before the reservoir check (R1)
  and the acquire delegation (R2+), restoring cascade order.
- H5: composite attempts record satisfied only when all declared ingredients exist as accepted project
  resources; otherwise blocked with the missing ids named.
- H8: resolution records use exclusive-create (wx) writes.
- H9: blob dedupe is per content (identical content under a different filename reuses the existing blob).
- Minor: RESERVOIR_INDEX_CORRUPT typo fixed; index writes atomic (tmp+rename); `studio resource reservoir add`
  added so R1 can fire end-to-end from the CLI.
- H7 documented (not code-fixed): unacceptable/unknown license on a match hard-fails the resolution
  (fail-closed, matching settled asset.resolve behavior); require_license mismatch continues searching.
