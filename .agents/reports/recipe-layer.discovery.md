# Discovery: Recipe layer above the capability layer (change candidate)

- status: change candidate — NOT normative; recorded for the post-baseline recipe-layer amendment
- date: 2026-09-23
- companion spec-delta proposal: `.agents/reports/recipe-layer.spec-delta.proposal.md`
- discovered_by: operator instruction (recipe-layer request recovered at `/tmp/opencode/recipe-request-full.md`) + repository observation
- governs_future: spec amendment candidate only; frozen requirements, gates, teeth, and previously settled evidence remain untouched

## Observation

Gauntlet Game Studio already owns a complete capability layer: 17 stable `CapabilityDescriptor`s in
`packages/studio/src/capabilities/catalog.ts`, a single router (`routeCapability` in
`packages/studio/src/router/router.ts`), Zod contracts, AssetRecord provenance, EvidenceStore,
and Gauntlet settlement. Human and agent callers, however, still must discover and compose those
capabilities manually. Intent such as “add a patrolling enemy” or “create a third-person game”
maps to no first-class studio surface; callers must understand Koota, Rapier, Recast, Three.js,
asset providers, and capability IDs to get anything done.

There is no existing recipe, make, or add CLI command (verified against `apps/studio-cli/src/index.ts`
dispatch: doctor, config, create, capabilities, capability, asset, observe, verify, evidence).
There is no parallel orchestration authority: skill overlay policy already forbids
`threejs-game-director` and keeps the studio director sole orchestration owner.

## Why it matters

- The capability layer solved *routing and authority*; it did not solve *outcome vocabulary*.
- A thin semantic layer that compiles into the existing router removes the largest remaining
  human/agent friction without touching settled runtime architecture.
- Without a normative recipe contract, every agent re-invents composition ad hoc, which is exactly
  the class of drift the studio contracts exist to prevent.

## Whether current settlement is affected

No. This is a post-baseline improvement. T00–T26 remain settled on their original evidence.
No settled task, gate, tooth, provider-specific proof, or frozen game is re-decided by this
discovery. Blackwater Relay and all prior EvidenceManifests stay untouched.

## Affected future surfaces

- `packages/contracts`: RecipeDescriptor / RecipePlan / apply-provenance schemas (strict Zod, same
  conventions as CapabilityDescriptor).
- `packages/studio/src/recipes/`: registry, canonical catalog (5–8 recipes), compiler
  (descriptor + choices → RecipePlan affordance DAG), apply executor that reuses
  `routeCapability`, `AssetResolver`, EvidenceStore, and Gauntlet verify/settle.
- `apps/studio-cli`: `recipes`, `recipe describe|plan|apply` with existing `--json` / StudioResult
  conventions. No `make`/`add` exists, so the surface is non-redundant.
- Template game: optional minimal declarative content consumer only; settled example games
  (blackwater-relay) do not change.

## Reuse, not replacement (explicit)

| Existing surface | Recipe-layer role |
| --- | --- |
| Capability registry/router | Sole execution path for capability-kind steps |
| Contracts/schemas | Parent conventions for Recipe* schemas |
| AssetResolver (`asset.resolve`) | Ordered find/acquire → adapt → create; no hardcoded providers |
| AssetRecord / EvidenceManifest | Unchanged provenance and evidence authority |
| Observe / verify / Gauntlet | Sole acceptance and settlement path |
| Runtime (Koota/Three/Rapier/Recast) | Unchanged authority boundaries |
| GDC skill | Complementary agent coordinator; recipes are data + CLI, not a second director |

## Explicit non-goals for this change

- No second capability router, evidence format, ECS representation, or workflow framework.
- No provider-specific recipe logic (Kenney/Poly Haven/img2threejs/Blender are not baked into
  normal recipes).
- No retroactive re-authoring of settled games or historical evidence.
- No dozens of shallow recipes; prove the abstraction with a small excellent set first.
