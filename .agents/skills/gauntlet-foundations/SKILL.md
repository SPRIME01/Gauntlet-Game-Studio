---
name: gauntlet-foundations
description: Find, acquire, adapt and instantiate reusable game models, humanoid motion, lighting, and scene defaults without bypassing the game-authoritative Koota/AssetRegistry contracts.
---

# Gauntlet Foundation Library

Use this skill whenever the agent needs a generic game character, animation, outfit, or visual scene starting point. Prefer tested assets and recipes over modeling from scratch. It is a supplement to, **not a replacement for**, `asset.resolve`, `AssetRegistry`, and Koota authority.

## Capability and source inventory

- The four Quaternius Standard archives are at `assets/sources/quaternius/` (Git LFS).
- The source importer is `scripts/foundations/import_quaternius.py`.
- Imported, license-checked derivatives are stored at `.tmp/foundations/quaternius/raw/` with `inventory.json`. This location is ignored and reproducible.
- In a repo checkout, `studio asset resolve` bootstraps this inventory if absent. Explicitly rebuild with `just foundations-import` when source packs change.
- This Standard inventory contains 2 rigged superhero bases, 4 complete outfits, 4 animation GLBs (in-place and root-motion variants), 85 distinct clip names. Child body types are **not** included.
- All 10 primary compatible entries have the same 65 ordered named joints. This does not prove retargeted visual quality: screenshot and runtime verification are still needed.

## Required workflow

1. Check whether the target project's `assets/manifest.json` already contains an **accepted** asset with the required semantics.
2. Run `bun run studio -- asset resolve <normalized-id> --role npc_character --keywords female,humanoid --project <game-dir>`. Project-accepted assets are preferred; foundations are searched before Poly Haven. For animation assets, use `--role animation --keywords animation,walk`.
3. Record the returned `decision_file`. The foundation provider copies relevant glTF/GLB source and dependencies into the project and adds an `AssetRecord` with `acceptance_state: pending`.
4. Do not treat pending, blocked or reference-only content as approved. Verify original ZIP provenance and derivative hash, model bind-pose, rig name layout, project profile budgets, LOD and collider policy; normalize through existing glTF-Transform/Blender adapters as necessary. Run `bun run studio -- asset verify --all --project <game-dir>` and accept through the existing `AssetRegistry.accept()`/`save()` API after proving the concrete project. The CLI does not yet expose an `asset accept` subcommand. Failed checks are blocking; no fabricated waiver.
5. Bind an accepted model and accepted **in-place** animation GLBs using `spawnHumanoidPrefab` from `@gauntlet/runtime`. The helper requires matching rig signatures and creates Koota `HumanoidMotion` semantic state, Three.js rendering projection, and `HumanoidAnimationProjector`.
6. Game logic changes `HumanoidMotion.state` and `HumanoidMotion.rate`; after a fixed authoritative step, call prefab `update(dt)`. Use the existing rendering projection manager to sync Koota transforms. Do NOT move the authoritative entity by mutating meshes or clip root motion.
7. Prove with Gauntlet's three channels: Koota semantic state changes; pixels prove expected pose, attachment, scale and style; telemetry proves texture/animation drawcall/frame budget on target browser and device.
8. Keep evidence and append-only decision/provenance history in the target game; a successful new derivative may become a reusable foundation candidate after independent provenance and compatibility checks.

## Built-in rendering presets

`applyLightingPreset(scene, { preset: "stylized-daylight", quality: "mobile" })` from `@gauntlet/runtime` adds a reversible scene light/fog rig. Available IDs: `neutral-studio`, `stylized-daylight`, `golden-hour`, `moonlit-forest`, `cinematic-interior`. Keep the returned handle and dispose it when changing scenes.

## Guardrails

- Avoid incorrect body-type matching (e.g. `male` must not match `female`). No separate boy/girl base models exist in these Standard ZIPs.
- UAL1's `Idle_Loop` is mandatory for the default animation controller. UAL2 alone does not provide it. Duplicate shared clips such as `A_TPose` may be deduplicated by exact name.
- Root-motion variants (`*_RM.glb`) are intentionally rejected by the prefab until a Koota/Rapier reconciliation controller is provided.
- Outfits should not simply cover a complete body mesh; original creator guidance calls for appropriate head-only assembly to prevent clipping. These Standard archives have **not** been validated as full modular-body prefab replacements.
- A valid bone-name hash does not certify body proportions, skinning weights, rest transforms, foot contacts, or weapon alignment.
- For unknown or bespoke art, follow the existing policy: project reuse → foundation → external search/acquire → adapt → create fallback. Do not fabricate an asset or claim a blocked route succeeded.
- Licenses and budget proof are per asset and per project; never silently change license, texture quality requirement or acceptance state.

## Useful checks

- `just foundations-test` — Python safety checks and Bun runtime/catalog tests
- `just foundations-verify` — rebuild source derivatives, tests and TypeScript check (requires Git LFS payloads)
- `just ci` — full repository-native gates; retain ordinary release/settlement requirements
