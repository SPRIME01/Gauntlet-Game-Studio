# Game Actualizer Spec Delta Proposal (v0.4.0 → v0.5.0)

Date: 2026-10-04
Governing spec: `.agents/specs/gauntlet-game-studio.spec.yaml` (v0.4.0, approved)
Amendment plan: `.agents/plans/game-actualizer.amendment.plan.yaml`

## Summary

Additive amendment. The frozen v0.4.0 requirements (T00–T28 evidence) remain in force untouched. v0.5.0 adds
thirteen new requirement groups under `core_behavior_requirements` that compile the Game Actualizer into the
existing substrate: canonical Game Model, model-derived staleness, universal resource resolution + reservoir,
coherence normalization, GLB production ABI, structured DCC jobs, first-class animation, Godot production
backend with an engine-neutral world manifest, professional quality bar, derived Game Case, the Game Cockpit,
MCP/WebMCP over one semantic tool registry, and target-specific release settlement.

## New requirement groups (all under core_behavior_requirements)

| Group | Section | IDs | Settlement task |
| --- | --- | --- | --- |
| game_model | Canonical Game Model | REQ-GM-001..006 | T29 |
| staleness_and_derivatives | Model-derived staleness | REQ-STALE-001..004 | T29 |
| resource_resolution | Universal resource resolution + reservoir | REQ-RES-001..006 | T30 |
| coherence_normalization | Normalization layer | REQ-NORM-001..002 | T31 |
| production_asset_abi | GLB ABI | REQ-GLB-001 | T31 |
| dcc_job_system | Structured DCC jobs | REQ-DCC-001..002 | T31 |
| animation_domain | Animation first-class | REQ-ANIM-001..002 | T31 |
| production_backend | Godot backend + world manifest + cross-runtime observation | REQ-GODOT-001..006 | T32 |
| professional_quality_bar | Quality bar | REQ-QUAL-001..002 | T33 |
| game_case | Derived Game Case | REQ-CASE-001..003 | T33 |
| release_settlement | Release matrix + target profiles | REQ-RELEASE-001..003 | T33 |
| game_cockpit | Cockpit protocol/server/storage/authority/surfaces | REQ-COCKPIT-001..012 | T34 (001–008), T35 (009–012) |
| mcp_webmcp | Shared tool registry, MCP, WebMCP | REQ-MCP-001..004 | T36 |

## Invariants preserved (explicit in new requirement text)

- Koota remains sole semantic authority; Godot scene nodes are projections (REQ-GODOT-001, REQ-GODOT-006).
- Three.js stays the reference runtime binding; Godot is a production export backend behind capability
  contracts, never a replacement runtime (REQ-GODOT-002). REQ-BIND-0xx text is unchanged.
- Recipes stay above capabilities; the cockpit composes data over existing surfaces and never becomes a second
  engine, router, evidence store, or capability registry (REQ-COCKPIT-001; non-goals).
- asset.resolve policy stands for asset-kind requests; resource resolution extends, not replaces (REQ-RES-001).
- Acceptable-license set, provenance intake, and unknown-license rejection carry into resource resolution
  (REQ-RES-003).
- Evidence/settlement authority unchanged: cockpit and tool surfaces are read-only over canonical truth; only
  the proper actualization/settlement path mutates it (REQ-COCKPIT-007, REQ-MCP-003).
- No numeric AAA score, no percentage completion, no decorative KPIs (REQ-QUAL-001, REQ-COCKPIT-002).

## Deliberate non-additions

- No new VAR-* or RECOV-* IDs: the traceability gate binds T24 to the settled variation/recovery matrix; new
  falsifiers are expressed as requirement teeth inside the new groups and their task teeth lists.
- No new CLAIM-* IDs in the spec: amendment-level claims live in the amendment plan (AMR-CLAIM-*) as with the
  v0.4.0 precedent.
- No new package without topology registration: `packages/cockpit` is added together with
  `scripts/check-topology.py` approval and tsconfig paths in T34.
