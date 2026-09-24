# Spec delta proposal: first-class `asset.resolve` routing (search/acquire → adapt → create)

- status: PROPOSAL — not normative; the frozen spec `.agents/specs/gauntlet-game-studio.spec.yaml`
  (SHA-256 595c1f56…) is unchanged and must not be edited without formal spec amendment and plan rebinding
- date: 2026-09-18
- companion discovery: `.agents/reports/asset-resolve-find-adapt-create.discovery.md`
- timing: prepared after the Codename: Gauntlet Warfare repair run reached settlement
  (independent confirmation CONFIRM, 2026-09-18 late session)

## Motivation

Current routing resolves assets by choosing an authoring route up front (reuse accepted
project asset, `asset.source`, procedural, `asset.reconstruct.reference-image`,
`dcc.blender.process`). Nothing normative requires *searching for an existing acceptable
asset* before generating one. Free/CC0 libraries (Kenney, KayKit, Poly Haven, Quaternius)
make acquisition often cheaper and higher-fidelity than generation.

## Proposed requirement (draft IDs; finalized at amendment time as REQ-ASSET-008..012 to fit the settlement tooling's identifier convention)

REQ-ASSET-008 (new): The studio SHALL expose `asset.resolve` as a first-class
capability that resolves each required production asset through the ordered policy:

1. **search/acquire** — locate a suitable existing asset from an approved provider adapter
   (project registry first, then licensed external libraries);
2. **adapt** — when a close asset exists but misses acceptance criteria, adapt it
   (normalize, re-material, re-topologize via approved routes) while preserving upstream
   license obligations and recording the derivative relationship;
3. **create** — fall back to generation (procedural, reference reconstruction, DCC) only
   when no suitable asset can be acquired or adapted under the declared acceptance criteria.

Constraints (all existing invariants, restated as gates):

- REQ-ASSET-009: Every resolved asset passes the existing AssetRecord intake —
  per-asset provenance (URI, author, license, retrieval metadata, SHA-256), normalization,
  and verification. Provider-level license assumptions are rejected; evidence is per asset.
- REQ-ASSET-010: The resolution decision (which step succeeded, why later steps
  were unnecessary or failed) is recorded append-only.
- REQ-ASSET-011: No provider becomes authoritative; all providers remain
  replaceable adapters below the stable studio contract.
- REQ-ASSET-012: `asset.source` remains the acquisition primitive; library
  integrations (e.g., Kenney/KayKit CC0 packs) are new adapters over it, not parallel paths.

## Acceptance/falsification sketch (for the amendment plan)

- Tooth 1: an `asset.resolve` request whose acquired asset lacks per-asset license evidence
  is rejected (not waved through on provider-level reputation).
- Tooth 2: a request where a searchable CC0 asset exists but the resolver jumps to
  generation returns a typed policy violation.
- Tooth 3: adaptation that drops upstream attribution is rejected.
- Regression: existing Poly Haven intake and AssetRegistry flows unchanged.

## Explicit non-goals

- No retroactive re-routing of settled tasks or frozen games; existing settlement evidence
  (including the Gauntlet Warfare manual weapon route) is not reopened.
- No new orchestration authority; routing policy stays studio-owned.
- No assumption that any library is universally CC0; per-asset verification remains mandatory.
