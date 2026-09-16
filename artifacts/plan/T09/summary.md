# Task Settlement Evidence: T09

## Task Information
- **Task ID**: `T09`
- **Title**: Strategically mine Mavon donor mechanisms into first-party runtime
- **Proof Level**: `P3`
- **Confirmation**: `independent` — CONFIRM (see confirmation.md)
- **Settles**: `REQ-DONOR-001`, `REQ-DONOR-002`, `REQ-DONOR-003`, `REQ-DONOR-005`, `REQ-DONOR-006`, `REQ-DONOR-007`, `REQ-SEC-006`
- **Timestamp**: 2026-09-15T21:05:00Z
- **Preregistration**: `.agents/preregistrations/gauntlet-game-studio-plan-T09.prereg.yaml` (frozen before evaluation)

## Donor Identity (recorded, not assumed)
- **Repository**: https://github.com/MavonEngine/Core.git
- **HEAD revision**: `20d4a4db7b5ec08f8f1cc5aeb8be4707fa0ef67c`
- **Quarantine**: `.tmp/donor/Core` (gitignored, non-authoritative)
- **Inventory report**: `artifacts/plan/T09/donor-inventory.md`

## Implementation Overview
1. **Donor classification** (`third_party/mavon-engine/PROVENANCE.md`):
   - DISCARD: BaseWorld/GameObject/Actor/LivingActor semantic authority, editor, bootstrap.
   - NOT_NEEDED: custom particle shaders (three.quarks is pinned dependency), donor DOM UI.
   - TRANSPLANT: BandwidthTracker, LatencySimulator (adapted, white-labeled).
   - REWRITE_FROM_CONCEPT: network command buffering/packet sequencing (owned by T12 networking scope).
2. **Transplanted diagnostics** (`packages/runtime/src/diagnostics/`):
   - `BandwidthTracker`: per-peer and aggregate send/receive accounting with sorted peer summaries.
   - `LatencySimulator`: deterministic latency/jitter/packet-loss simulation with injectable RNG and timer cleanup.
   - Both adapted to Gauntlet contracts (typed options, no donor logging dependencies, no donor class hierarchy).
3. **Semantic guard hardening** (`packages/runtime/src/state/world.ts`):
   - New `assertValidSemanticData(obj, entityId)` generalizes the existing provider-object leak guard
     (`assertNoProviderObjectsInState` unchanged in behavior) and adds donor constructors
     (`GameObject`, `BaseWorld`, `Actor`, `LivingActor`) to the forbidden-instance list (REQ-DONOR-003).
4. **Enforcement gates**:
   - `scripts/donor-audit.ts` (bound as `bun run donor:audit`): records donor identity/HEAD, verifies MIT LICENSE
     and PROVENANCE, verifies attribution manifest entries, greps runtime src for forbidden donor symbols,
     regenerates the donor inventory report. Handles donor-absent checkouts gracefully.
   - `scripts/donor-dependency-scan.ts` (bound as `bun run donor:dependency-scan`): scans first-party source,
     package manifests, and tsconfig path mappings for donor imports/dependencies/mappings and Mavon branding.
   - `vendor/attribution.json`: `temporary_donor` entry updated with repository + commit; `copied_code` entry
     names destination modules with license/notice/provenance paths (REQ-DONOR-006).

## Verification Evidence
- **Narrow Gates** (fresh run, exit 0): `bun run donor:audit`, `bun run donor:dependency-scan`,
  `bun run third-party:verify` — gate log: `artifacts/plan/T09/gate.txt`
- **Teeth / Falsification Checks**: all three preregistered falsifiers exercised and passing —
  `artifacts/plan/T09/teeth.txt`; donor-absent independence log: `artifacts/plan/T09/donor-absent.txt`
- **Tests**: `bun test packages/runtime/test/donor-isolation.test.ts` 5/5 (24 expects);
  full workspace `just test` 103/103 across 17 files.
- **Global Gates**: `just check`, `just test`, `just lint`, `just validate-agent-artifacts` — all exit 0.

## Independent Confirmation
- Mode: `independent` (P3). Fresh verifier received source requirements, frozen prereg, implementation, and fresh
  evidence; builder conclusions were not treated as authority.
- Verdict: **CONFIRM**. The verifier reproduced all gates, built a true donor-absent working-tree copy (all suites
  and `tsc --noEmit` pass), live-fired the dependency scan against injected violations, and confirmed module
  boundaries are Gauntlet-shaped (barrel export pattern, Koota authority preserved, donor logging coupling removed).
- Record: `artifacts/plan/T09/confirmation.md`

## Scope Notes
- Full clean-checkout donor-absent proof is repeated at whole-studio scale by T24 per plan.
- Networking command sequencing (REWRITE_FROM_CONCEPT) settles with T12; not claimed here.
