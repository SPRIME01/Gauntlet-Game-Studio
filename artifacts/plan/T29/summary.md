# T29 — Canonical Game Model, Versioning, and Model-Derived Staleness Engine

Settled: 2026-10-04. Confirmation: independent_adversarial CONFIRM (see confirmation.md).

## What was built

- **Contracts** (`packages/contracts/src/schemas.ts`): `GameModelDecisionSchema` (append-only ledger record:
  ordinal, version, summary, touched), `DerivativeStampSchema` (built_from/reads), `GameModelKnownSchema`
  (strict typed core covering REQ-GM-002: identity, fantasy, audience, genre, pillars, core/secondary loops,
  progression, mechanics, worlds, entities, characters, factions, objects, interactions, camera grammar,
  controls grammar, the six languages, narrative, platforms, budgets, accessibility, assets, provenance
  policy, scenarios, release, north star, unknowns, contradictions, decisions), `AssetRecordSchema` extended
  with optional built_from/reads (REQ-STALE-001).
- **Loader** (`packages/studio/src/model/model.ts`): strict per-section validation; canonical v2
  (`gauntlet.game.model`) rejects invalid typed sections; v1 legacy files load unchanged with failing
  sections preserved as extensions and reported via `legacySections`; identity fallback from v1 top-level
  game_id/title; quality profiles validated against the game-owned profile schema; ledger-consistency teeth
  (nonzero version requires decisions; the current version must be produced by a recorded decision; no
  decision may claim a newer version).
- **Decision writes** (`applyDecision`): the only mutation path (REQ-GM-004). Text-level append preserving
  hand-authored structure; flow-style `decisions: []` converted in place; post-write load validation with
  automatic restore on failure (no corrupt-write-claims-success). Verifier-demonstrated corruption edge case
  fixed in the confirmation round.
- **Staleness engine** (`packages/studio/src/model/staleness.ts`): pure `touches`/`staleReasons` with
  symmetric hierarchy matching (parent touch stales child reader and vice versa — under-reporting direction
  fixed in the confirmation round); `assertEvidenceFreshAgainstModel` typed gate (stale/unstamped evidence
  cannot settle, REQ-STALE-004); `absentReads` fog reporting (REQ-GM-006), wired into
  `evaluateProjectStaleness` in the confirmation round.
- **Project stamp collection**: scans asset registry records, recipe project content, and evidence manifests
  for stamps; malformed stamps are reported unstamped, never coerced.
- **CLI**: `studio model verify|stale|decide` with StudioResult envelope.

## Gate results

- `bun test` full workspace: 431→443 pass / 0 fail across the T29/T30 waves (25 game-model tests).
- `bun x tsc --noEmit`: exit 0.
- `python3 scripts/check-traceability.py`: PASS 224/224 REQ.
- `python3 scripts/check-topology.py`: PASS.
- CLI verified live against all three real game specs (template, blackwater-relay, warfare).

## Prereg falsifier outcomes (all confirmed independently)

- TEETH-T29-001: all three existing specs load unchanged; sabotaged quality profile typed-rejected naming
  the Zod path; no spec file rewritten (SHA-256 stable).
- TEETH-T29-002: camera decision stales exactly the camera reader; audio reader current; pure/deterministic.
- TEETH-T29-003: silent version bump rejected (ledger inconsistency); stale/unstamped evidence
  typed-rejected from settlement gate.
- TEETH-T29-004: `touched: [all]` stales every stamped derivative; absent reads surfaced, never dropped;
  no crash.

## Consequences carried (preserved, not erased)

1. `assertEvidenceFreshAgainstModel` has no production settlement caller yet — the `observe`/`verify`
   settlement path gains the gate in T33 (Game Case / release matrix wiring), and stamp producers land
   incrementally (resource resolution records and AssetRecord now carry optional stamps). The engine-level
   invariant is tested; the integrated invariant is re-proven in T33/T37.
2. Ledger historical integrity (deleting a *historical* decision) is enforced by git discipline, not the
   loader; recorded as a known limitation.
3. `studio model stale` exits 0 with `status: degraded` JSON rather than nonzero; staleness is a report, and
   the settlement gate is the enforcement point.

## Confirmation verdict

Independent adversarial verifier executed its own 20-test attack suite, reproduced all recorded gates, found
four genuine defects (corrupt-write edge case, REQ-GM-002 typed-section gap, child-touch asymmetry, unwired
absent-read surfacing) — all four fixed and re-tested in the confirmation round before settlement. Verdict:
CONFIRM.
