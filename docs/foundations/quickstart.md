# Foundation library: source to usable humanoid

This guide documents what the implementation in `feat/foundation-library` **actually supports**. It does not claim real-game screenshot, physics or animation quality proof merely because a 65-bone name signature matches.

## One-time source import

The repository contains four Quaternius Standard archives tracked in Git LFS. The first `asset resolve` in a development checkout automatically prepares the ignored catalog from these archives when it does not yet exist. Explicit commands:

```sh
git lfs pull
just foundations-import
just foundations-test
```

The importer emits `.tmp/foundations/quaternius/inventory.json`, with source SHA-256, corrected glTF derivative files/dependencies, CC0 license evidence, compatible joint-name signatures, actual clip names and pending acceptance. It does **not** publish raw assets to the runtime by itself.

## From an agent's requested character to a project-local asset

```sh
bun run studio -- asset resolve npc_woman --role npc_character \
  --keywords female,humanoid --project ../my-game
bun run studio -- asset resolve npc_motion --role animation \
  --keywords animation,walk --project ../my-game
bun run studio -- asset verify --all --project ../my-game
```

Accepted project records are checked first; local foundations are checked second; Poly Haven acquisition and the existing adapt/create fallbacks follow. Resolved files and dependencies enter `../my-game/assets/sources/foundations/<asset-id>/`, with the asset registry entry intentionally marked **pending**.

Before a game can rely on one of these assets: inspect, normalize where needed, prove colliders/LOD/profile and source hashes, then explicitly `AssetRegistry.accept(id)` and `save()`. The existing CLI provides `asset verify --all`, not a settled per-asset accept command. Do not programmatically accept every pending asset by default.

## Game integration API

The runtime exports `spawnHumanoidPrefab`, `HumanoidMotion`, `HumanoidAnimationProjector`, and `applyLightingPreset`.

```ts
import {
  GameWorld, RenderProjectionManager,
  HumanoidMotion, spawnHumanoidPrefab, applyLightingPreset,
} from "@gauntlet/runtime";
import * as THREE from "three";
import type { AssetRecord } from "@gauntlet/contracts";

const scene = new THREE.Scene();
const world = new GameWorld();
const render = new RenderProjectionManager();
const lights = applyLightingPreset(scene, {
  preset: "stylized-daylight", quality: "mobile",
});

// These must come from ACCEPTED project-local AssetRegistry records.
// Their verified animation_contract skeleton signatures must match.
declare const characterRecord: AssetRecord;
declare const ual1Record: AssetRecord;
declare const ual2Record: AssetRecord;
const player = await spawnHumanoidPrefab({
  world, scene, render, entityId: "hero",
  model: { asset: characterRecord, url: "/assets/character.gltf" },
  animations: [
    { asset: ual1Record, url: "/assets/ual1.glb" },
    { asset: ual2Record, url: "/assets/ual2.glb" },
  ],
  position: [0, 0, 0],
});

// Game simulation owns movement, collisions and gameplay state.
const hero = world.getEntity("hero")!;
hero.set(HumanoidMotion, { state: "walk", rate: 1 });
// After advancing the established first-party fixed-timestep scheduler:
render.syncFromState(world);
player.update(1 / 60); // visual projection, no ECS mutation

// When retiring the scene:
player.dispose();
lights.dispose();
```

The example demonstrates integration signatures, **not** a complete playable game. Connect game input and movement through the established Koota/Rapier/Recast path. The prefab loader validates acceptance, same-origin paths, asset-kind and matching skeleton signatures; the projector provides transitions for idle, walk, jog, sprint, crouch, jump, swim, punch, sword, push, climb, interact and death. Only clips actually present in the selected pack can be played. The Standard packs contain no complete climbing locomotion graph or separately proportioned child meshes.

## Validation

```sh
just foundations-test
just foundations-verify  # requires 4 LFS archives
bun test packages/studio/test/assets/resolve.test.ts packages/runtime/test/authority.test.ts
```

The new GitHub Actions `Foundation library` workflow runs Python archive safety, Bun catalog/prefab/animation/lighting tests and monorepo TypeScript checking. An optional full LFS intake job is available via workflow_dispatch when the workflow is present on the default branch. The default PR check deliberately avoids downloading 437 MB of LFS content on every push.

### Still requiring real-game proof

- Import and render both actual superhero bases with UAL1/UAL2 via Three.js GLTFLoader; inspect skin deformation, axis conventions, root tracks, crossfades, timing and foot contacts.
- Bake retargeting only if necessary, produce optimized GLB derivatives/LODs and record texture/render budgets.
- Add character collider measurements and sample gameplay under Rapier and browser Playwright; settle state/pixels/telemetry.
- Build properly assembled outfit+head/hair variants, bespoke child proportion models and equipment sockets as follow-on audited derivatives.

Do not treat the PR as ready to merge until these integration results have been evaluated against the game's requested quality profile.
