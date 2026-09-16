# Third-Party Notices and Provenance

Gauntlet Game Studio strictly classifies all external code, assets, skills, dependencies, and DCC tooling into mutually exclusive provenance and attribution classes (`REQ-SOURCE-006`): the five intake classes below, plus `dcc_tooling` (section 6) for offline DCC escalation tools whose committed outputs are standard runtime assets.

## 1. Runtime Package Dependencies (`runtime_dependency`)
Standard pinned packages managed by package managers, resolved through one authoritative dependency graph.
- **Three.js** (`three`): WebGL rendering engine (MIT).
- **Koota** (`koota`): Decoupled entity-component-system (MIT).
- **Rapier** (`@dimforge/rapier3d-compat`): Deterministic physics simulation (Apache-2.0).
- **three-mesh-bvh** (`three-mesh-bvh`): Spatial indexing and accelerated raycasting (MIT).
- **three.quarks** (`three.quarks`): Particle effects engine (Apache-2.0).
- **Tone.js** (`tone`): Web Audio synthesis engine (MIT).

## 2. Agent-Skill Sources (`agent_skill_source`)
Pinned upstream agent capabilities adapted for studio router dispatch.
- **img2threejs** (`vendor/skills/img2threejs`): Reference-to-object reconstruction.
- **3dviz-pro-max** (`vendor/skills/3dviz-pro-max`): Scene and world composition.
- **threejs-game-skills** (`vendor/skills/threejs-game-skills`): Specialist prompt library overlaid with Gauntlet routing policy. Note: Upstream `threejs-game-director` is explicitly forbidden to prevent dual orchestration authority (`REQ-SOURCE-005`).

## 3. Temporary Code Donors (`temporary_donor`)
Isolated, non-authoritative references quarantined under `.tmp/donor/`.
- Never imported directly into runtime or studio code.
- Purely for transplantation analysis and architectural comparison.
- Discarded and gitignored at all times.

## 4. Copied / Modified Code (`copied_code`)
Any adapted code transplanted into studio packages.
- Zero unidentified transplanted code currently committed.

## 5. External Content Assets (`external_asset`)
Media assets, textures, skyboxes, and models with explicit licensing and checksums.
- **Poly Haven**: CC0 HDRIs and PBR textures.

## 6. DCC Tooling (`dcc_tooling`)
Offline digital-content-creation tools used only for escalation/regeneration of committed derived assets. The tool is never shipped, never imported, and never a runtime/build/CI dependency; only its standard glTF/GLB output is committed, tracked as the `blender` provenance class in the Asset Registry (`REQ-BLENDER-004/006`).
- **Blender** (`5.2.2 LTS`, GPL-2.0-or-later, https://www.blender.org): deterministic `--background --factory-startup` bpy retarget/bake for the Blackwater Relay service-drone derivative through the `dcc.blender.process` route.
