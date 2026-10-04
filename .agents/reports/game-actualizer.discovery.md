# Game Actualizer Discovery Report

Date: 2026-10-04
Author: Agent (operator-authorized Game Actualizer mission)
Status: discovery complete; spec delta proposed separately

## 1. Authorization

Operator mission (2026-10-04): "Implement its next architectural form completely and additively: turn
Gauntlet Game Studio into an evidence-driven, resource-maximizing Game Actualizer with a cockpit analogous to
the Product Actualizer cockpit, while preserving and exploiting the architecture already present."

Constraints recorded by the same mission: preserve all settled evidence (T00–T28), do not replace working
architecture, do not make Product Actualizer a runtime dependency, do not create a second orchestration
authority, follow the repository's own amendment/settlement discipline.

## 2. Donor study (Product Actualizer, read-only)

Live donor at `/home/sprime01/projects/product-actualizer` (Bun 1.4, zod 4, React 19, dockview-react,
bun:sqlite, Bun.serve). Mechanisms judged portable into Gauntlet vocabulary:

| Donor mechanism | Port shape for Gauntlet |
| --- | --- |
| Typed 15-block cockpit protocol, strict Zod, closed render registry | Direct port of the mechanism; block vocabulary preserved, one game-specific block added (`viewport`) |
| Source grammar (`pa:`, `graph:`, `world:`, `case:`, `work:`, `file:`) | New grammar roots: `gm:` (game model), `case:`, `resources:`, `recipes:`, `affordances:`, `evidence:`, `work:`, `file:` |
| Transport-decided authority (human WS vs agent HTTP; AUTHORITY_OPS) | Port unchanged; game vocabulary |
| Two-class bun:sqlite storage (disposable projection vs cockpit state) | Port unchanged |
| Staleness: `built_from`/`reads`/`cites` stamps + decision `touched` matching (`touches`, `staleReasons`) | Port algorithm into model staleness engine over the canonical Game Model |
| Derived Case (13 questions, material deviation, primary move, blocked lanes) | Game Case derivation with game-specific leverage ordering (mission §20) |
| World debugger read-only ops (why/impact/diff/timeline/counterfactual/reach/replay) | Game equivalents incl. `resource_reach` over the resource resolution layer |
| Work request lifecycle + transition table; executor cannot accept own work | Port unchanged |
| Single tool registry feeding CLI / loopback MCP / WebMCP (`document.modelContext.registerTool`) | Port with Gauntlet tool set |
| Release rail (immutable), workbench screen modes, work terminal rule interpreter | Port with ORIENT/DECIDE/BUILD/VERIFY/RELEASE modes |

Non-goals honored: donor stays a donor; no donor code is imported at runtime; mechanisms are re-expressed in
Gauntlet's own contracts and vocabulary.

## 3. Existing Gauntlet substrate (verified live)

- Capability layer: 16 capabilities in `packages/studio/src/capabilities/catalog.ts`, strict Zod contracts in
  `packages/contracts/src/schemas.ts`, routing in `packages/studio/src/router/router.ts` with negative
  affordances and AgentHandoff settlement.
- Recipe layer (settled T27/T28): `packages/studio/src/recipes/{catalog,registry,compiler,apply}.ts`,
  affordance DAG plans, append-only provenance at `<project>/.studio/recipe-provenance.jsonl`,
  teeth `assertNoRoutingBypass` / `assertAssetPolicy`.
- Asset layer (settled T13/T26): `AssetRegistry` (acceptance gates, license policy, append-only history,
  reference-only entries) at `<project>/assets/manifest.json`; `AssetResolver` cascade
  `reuse → acquire → adapt → create-fallback` with append-only `.studio/resolutions/` decision records;
  Poly Haven CC0 provider; glTF-Transform normalization.
- Evidence/settlement (settled T20/T25): `EvidenceStore` runs at `<project>/artifacts/runs/`, frozen
  expectations, `settleExpectation` channel ladder, contradictions (`pixels_pass_state_fail`, …),
  identity-based staleness via `resolveProjectRevision`.
- Quality profiles (settled T21): game-declared `quality_profiles` in `game.spec.yaml`, structural vs
  hardware-sensitive budget split, `PERF_NON_TARGET_RENDERER` rule.
- Runtime/observability (settled T07/T08/T19): Koota authority, versioned observability bridge
  (`__GAUNTLET_STUDIO_OBS__` v1), production mutation lockout inspector.
- CLI: `apps/studio-cli` single entry (`studio …`) with StudioResult envelope.
- Game projects: `templates/game/`, `examples/blackwater-relay/`, `codename-gauntlet-warfare/`; each has
  `.agents/specs/game.spec.yaml`; only `quality_profiles` is schema-validated today — this is the canonical
  Game Model seam.

## 4. Gaps (requirement-bearing)

1. No canonical, versioned Game Model with decision-ledger semantics; the game spec is free-form YAML with
   one schema-validated section.
2. No model-derived staleness: derived artifacts do not record what model facts they were built from;
   a settled decision cannot mark exactly its downstream consumers stale.
3. `asset.resolve` covers CC0 mesh/texture/HDMI acquisition only; no generalized resource resolution across
   rigs/animations/audio/code/UI/etc., no reservoir, no creation-exception record.
4. No coherence/normalization layer owned by the model's declared art language; no explicit GLB production
   ABI statement; no structured DCC job contract; animation is not a first-class capability domain.
5. No production backend distinction: runtime config is `engine: "three"` literal; no engine-neutral world
   manifest; no Godot projection; no cross-runtime observability adapter; no release matrix.
6. No professional quality bar representation (no fake AAA score either — correct absence), no derived Game
   Case, no cockpit, no MCP/WebMCP surface.

## 5. Risks / confounds

- Traceability gate hardcodes: plan binds spec SHA-256; all REQs mapped; T24 settles all VAR/RECOV; critical
  path = longest T00→T25 path; P3 tasks need frozen preregs. Therefore the amendment adds REQ-* groups only
  (no VAR/RECOV/CLAIM additions), hangs new tasks downstream of T25/T28, and freezes preregs before evidence.
- `scripts/check-topology.py` approves package dirs explicitly; a cockpit package requires a topology update.
- Godot binary and iOS/macOS toolchains are unavailable in this environment; requirements are written so that
  absence yields typed blocked states, not claimed readiness (honest blockage is conformant; fake readiness is not).
- Live Poly Haven network access is not deterministic; resource-resolution tests use injectable providers
  (existing pattern).

## 6. Decision

Proceed with a formal spec amendment to v0.5.0 (new requirement groups REQ-GM, REQ-STALE, REQ-RES, REQ-NORM,
REQ-GLB, REQ-DCC, REQ-ANIM, REQ-GODOT, REQ-QUAL, REQ-CASE, REQ-COCKPIT, REQ-MCP, REQ-RELEASE) and a rebound
settlement plan with tasks T29–T37, per the spec-delta proposal.
