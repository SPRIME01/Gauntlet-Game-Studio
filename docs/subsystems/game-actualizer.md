# Subsystem: Game Actualizer (spec v0.5.1)

Status: implemented under the Game Actualizer amendment (spec v0.5.0 → v0.5.1, tasks T29–T37).
This document describes the subsystems added on top of the settled capability/recipe/asset/evidence
substrate. Authority boundaries are unchanged: Koota remains semantic authority; the cockpit and all
agent surfaces are projections/control surfaces, never truth.

## Canonical Game Model — `packages/studio/src/model/`

- `.agents/specs/game.spec.yaml` in each game project is the canonical Game Model
  (`gauntlet.game.model` v2; `gauntlet.game.spec` v1 files load unchanged with legacy sections
  preserved as extensions).
- Strict typed core in `packages/contracts` (GameModelKnownSchema): identity, fantasy, audience,
  genre, pillars, loops, progression, mechanics, worlds, entities, characters, factions, objects,
  interactions, camera/controls grammar, six languages, narrative, platforms, budgets, accessibility,
  assets, provenance policy, scenarios, release requirements, north star, unknowns, contradictions,
  quality bar, decision ledger.
- Versioning: `model_version` + append-only decision ledger (`n`, `version`, `summary`, `touched`).
  The only mutation path is `applyDecision`; bare version bumps are rejected as ledger-inconsistent.
- CLI: `studio model verify|stale|decide`.

## Staleness engine — `packages/studio/src/model/staleness.ts`

- Pure `touches`/`staleReasons`: a derivative is stale exactly when a newer decision touches a field
  it reads (symmetric hierarchy matching; `all` stales everything).
- Derivative stamps (`built_from` + `reads`) live on AssetRecords, resource-resolution records,
  normalization plans, DCC jobs, animation contracts, world manifests.
- `assertEvidenceFreshAgainstModel` is the typed settlement gate (stale/unstamped evidence cannot settle).
- CLI: `studio model stale` reports stale/unstamped/current across the project.

## Resource resolution — `packages/studio/src/resources/`

- `ResourceResolver` generalizes `asset.resolve` across kinds (mesh … networking-pattern) with the
  minimum-novelty cascade: R0 reuse-accepted → R1 reuse-reservoir → R2 acquire → R3 adapt → R4
  composite → R5 code-donor → R6 procedural → R7 reference-reconstruction → R8 dcc-modification →
  R9 generate-component → R10 scratch (creation-exception-gated only).
- Asset-kind requests delegate to the settled AssetResolver (two-pass: reuse probe, then acquire),
  preserving cascade order.
- License teeth: unknown/unacceptable licenses are unusable at reservoir intake, at acceptance, and
  at R1 resolution; provider matches without license evidence fail before intake.
- Resolution records: append-only exclusive-create JSON under `.studio/resolutions/resource-*`.
- Creation exceptions: append-only JSONL at `.studio/creation-exceptions.jsonl`; recording requires
  searched routes + failure reasons; the resolver validates and binds exceptions to the request.
- CLI: `studio resource resolve|reservoir list/search/add|exceptions|exception`.

## Reservoir — `packages/studio/src/resources/reservoir.ts`

- Studio-level content-addressed store (`reservoir/objects/<hash12>/`, one blob per content).
- Records carry tags, license, source/local hashes, format, metadata, `derived_from` lineage,
  `used_by` usage, accepted flag, verification refs, derivative stamp.
- Adaptations that pass acceptance become reservoir resources; the next game reuses the derivative.
- Index writes are atomic (tmp+rename); index corruption is typed.

## Normalization + GLB ABI — `packages/studio/src/normalize/`

- `NormalizationPlan` (`gauntlet.resource.normalization`): transforms bound to declared model
  language sections; undeclared bindings rejected (`MODEL_LANGUAGE_UNDECLARED`); provenance preserved.
- GLB production ABI gate (`glb_abi` inside the settled asset acceptance evaluation): sourced,
  generated, normalized, and DCC-produced mesh geometry must be normalized glTF/GLB. Settled
  procedural code-module routes (img2threejs) and environment composition outputs (3dviz skies) are
  exempt per the v0.5.1 clarification.

## DCC jobs + animation — `packages/studio/src/dcc/`, capability catalog

- `DccJob` (`gauntlet.dcc.job`): structured DCC work with mandatory cascade rationale, registry-known
  capability, budgets, outputs, deterministic definition, acceptance, verification. Persisted under
  `.studio/dcc-jobs/`.
- Animation is a first-class domain: `animation.rig/retarget/bake/validate` capability descriptors
  (providers: dcc.blender; composition-first policy; runtime/semantic boundaries in do_not_use_when)
  and `AnimationResourceContract` (`gauntlet.animation.contract`) expressing base clips + layers +
  model-owned semantics.

## Godot production backend — `packages/studio/src/worldmanifest/`, `packages/adapters/src/godot/`

- `WorldManifest` (`gauntlet.world.manifest`): engine-neutral zones/placements/scatter/lighting/
  atmosphere/colliders/navigation-refs/terrain-ref/spawns/anchors/LOD/streaming with injection-safe ids.
- Deterministic projections: `projectToThree` (reference) and `projectToGodot` (project.godot, boot
  scene, world_builder.gd, export_presets.cfg) — byte-identical per manifest; scene artifacts are
  projections, never semantic authority.
- Export preflight: typed TOOLCHAIN_UNAVAILABLE blockage for absent godot binary / non-macOS iOS hosts;
  studio operation never depends on Godot.
- Observability adapter: wraps a Godot JS bridge into `__GAUNTLET_STUDIO_OBS__` v1, validated with the
  runtime's own validator; production mode inspects surface AND raw bridge with the existing lockout
  inspector. Absent bridge → typed blockage.
- Config: optional `production: { engine: "godot", targets: [godot.web|android|ios] }`; `runtime.engine`
  stays literally "three".
- CLI: `studio world validate|project`, `studio godot preflight|generate`.

## Quality bar + Game Case + release matrix — `packages/studio/src/quality/bar.ts`, `packages/studio/src/case/case.ts`

- `quality_bar` model section: project-declared criteria over 7 dimensions; states derived from
  evidence only (pass requires fresh settled evidence; unknown stays unknown; not-applicable needs a
  declared reason). No numeric score anywhere.
- `deriveReleaseMatrix`: per-target, per-dimension; one target passing never settles another;
  non-target (software-rendered) evidence can never contribute a pass (blocked with reason).
- `deriveGameCase`: pure, stored-nowhere; destination/current/material deviation/primary move
  (leverage-ordered: release blockers → contradictions → stale re-derivation → resource leverage →
  uncertainty → quality gap)/alternatives/blocked lanes; settlement reachability is guidance; the
  release verdict is the owner's.
- CLI: `studio quality bar`, `studio release matrix`, `studio case`.

## Game Cockpit — `packages/cockpit/`

- Protocol (`src/protocol/blocks.ts`): 16 strict block types (donor vocabulary + `viewport`), bounded
  source grammar, agent/human op sets, AUTHORITY_OPS, work-request transition table, workbench modes
  orient/decide/build/verify/release.
- Storage (`src/server/db.ts`): two-class bun:sqlite — disposable projection (entities+fts5 search)
  vs cockpit state (ui_state/interactions/work_requests). Deleting the DB never changes the game.
- Projection (`src/server/project.ts`): pure re-derivation from canonical files (model, decisions,
  contradictions, unknowns, north star, entities, scenarios, quality, release, case, assets,
  reservoir, work).
- Reducer (`src/server/workspace.ts`): transport-decided authority; pinned immunity; AUTHORITY_LAYOUT;
  closed-surface memory (`closedByOwner`); real placement records; surface cap with pinned-safe
  eviction; in-place content replacement; work-request lifecycle with agent self-acceptance
  structurally impossible.
- World debugger (`src/server/world.ts`): why/impact/diff/timeline/counterfactual/resource_reach/replay —
  read-only, recorded/derived/unavailable basis, replay consults real evidence or says evidence-missing.
- Core (`src/server/core.ts`): one implementation per semantic tool (24 tools) behind every transport;
  role-aware action dispatch; workSubmit/workMove with human review.
- Serve (`src/server/serve.ts`): Bun.serve loopback — human WebSocket (token-checked at upgrade and per
  message), agent HTTP (token → role), loopback MCP (JSON-RPC, agent role only), /api/boot (roles,
  tool schemas, active set), Host guard.
- Web client (`src/web/`): closed block registry (unknown types cannot render), shell-rendered release
  rail, Dockview workspace with server-authoritative layout, workbench mode switch, work terminal over
  the human channel, WebMCP bridge (document.modelContext.registerTool, per-tool AbortController
  withdrawal, graceful no-op).
- CLI: `studio cockpit up|tool|rebuild`.

## Tool registry — `packages/cockpit/src/protocol/tools.ts`

- 24 tools: base 12, game 4, world debugger 7, work 3 (workbench/work_get/work_update/work_submit).
- Dynamic offering (`activeTools`) by focus/screen-mode/pending-work; offering is discovery, not
  authorization — every tool stays executable via the registry.
- Annotations (readOnlyHint/untrustedContentHint) projected to MCP/WebMCP framing via z.toJSONSchema.
