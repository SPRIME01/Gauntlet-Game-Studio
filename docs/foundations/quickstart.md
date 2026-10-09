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
just foundations-real-browser # additionally requires matching Playwright Chromium
bun test packages/studio/test/assets/resolve.test.ts packages/runtime/test/authority.test.ts
```

The new GitHub Actions `Foundation library` workflow runs Python archive safety, Bun catalog/prefab/animation/lighting tests and monorepo TypeScript checking. An optional full LFS intake job is available via workflow_dispatch when the workflow is present on the default branch. The default PR check deliberately avoids downloading 437 MB of LFS content on every push.

### Real source-backed browser evidence — PASSED, October 9, 2026

The opt-in real-source Chromium job completed successfully at [GitHub Actions run 38001290860](https://github.com/SPRIME01/Gauntlet-Game-Studio/actions/runs/38001290860). The [proof artifact](https://github.com/SPRIME01/Gauntlet-Game-Studio/actions/runs/38001290860/artifacts/11649956580) contains 12 PNG screenshots and a machine-readable report.

- The real Git LFS archives yielded **10 primary assets and 85 unique clips**, with source hash and license evidence retained.
- Real Three.js GLTFLoader + AnimationMixer + Gauntlet Koota loaded **distinct** female and male models. The test explicitly rejects selecting the female base when the request is male or when screenshots are identical.
- All six sampled states **idle, walk, run, punch, sword attack, swim** rendered with visible geometry for both models.
- Female: 15,060 visible triangles, 3 draw calls; 64 bones changed versus initial rig state. Male: 14,318 visible triangles, 3 draw calls; 62 bones changed.
- Fixed-step Koota world positions did not change when animations played.
- Captured per-state synchronous update + renderer invocation time in a CI software-rendered headless browser. These samples are **not** a production FPS guarantee.
- The test constructs *fixture accepted records* solely for a source-backed browser proof, **not** an automatic production registry acceptance decision.

### Remaining per-game production and feature work

- Assess full video transitions, foot contacts, any retarget/rest-pose adjustment and visual style under the intended game camera before settling a game release.
- Normalize and optimize runtime glTF/GLB, textures, and LOD levels to the target game's actual performance profile.
- Measure Rapier collider fit, mobility, equipment sockets and combat interactions against real gameplay.
- Implement proper outfit + head/hair modular assembly; the current catalog can acquire outfits but does not yet compose them.
- Produce child-specific body types only from appropriately sourced/generated and verified assets; they are absent from the Standard ZIPs.

The library can be reviewed as a reusable **foundation core**; production-game acceptance, full costume composition and game-release settlement remain independent of this library's proof.
