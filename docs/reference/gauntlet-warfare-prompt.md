/gdc
Build an execution-ready, triple-A fidelity Call of Duty-style tactical FPS vertical slice ("Codename: Gauntlet Warfare") using Gauntlet Game Studio contracts.

### 1. Vision & Core Gameplay Loop
- Tactical First-Person Shooter vertical slice set in an urban military compound.
- Core 45-second gameplay loop:
  1. Tactical movement: First-person camera with authentic viewmodel sway, sprint-to-fire delay, ADS (Aim Down Sights) zoom with depth-of-field, and crouch/slide.
  2. Gunplay: M4A1 assault rifle with semi/auto fire, projectile/hitscan raycasting, screen shake, procedural recoil pattern (vertical climb + horizontal jitter), muzzle flash, shell ejection VFX, and dynamic crosshairs with hitmarkers.
  3. Combat AI: 2 enemy combatants driven by Recast navigation with cover-seeking, line-of-sight aggro, and return fire.
  4. Audio & Juice: Procedural spatial gunshot audio, reload sounds, impact decals on geometry, and subtle shell casing bounces.
  5. Minimal Tactical HUD: Clean DOM overlay with ammo counter, health bar, dynamic crosshair, and kill notification.

### 2. Online Reference Scraping & Reference Image Intake
- Use web search / internet tools to fetch high-resolution reference images:
  1. A clean side/perspective reference of a modern military M4A1 rifle / carbine.
  2. A reference screenshot of Call of Duty: Modern Warfare viewmodel perspective (first-person ADS and hip-fire framing).
  3. A reference screenshot of an urban warzone/desert compound environment (lighting, ground textures, concrete barriers).
- Ingest these references into `references/` with full provenance tracking (origin URL, SHA-256 hash, reference-only tag).

### 3. Capability Routing Plan
- `asset.reconstruct.reference-image` via `img2threejs`:
  - Reconstruct the primary player weapon (M4A1) viewmodel into a procedural Three.js module (`src/assets/m4a1-viewmodel.ts`) with named sockets (`socket-muzzle`, `socket-optic`, `socket-ejection`).
  - Enforce silhouette similarity >= 0.70 and triangle budget <= 12,000 tris.
- `world.environment.compose` via `3dviz-pro-max`:
  - Compose a focused urban combat arena (concrete blast barriers, sandbags, shipping container, ruined brick wall) with tactical sightlines.
  - Realistic PBR lighting setup: Directional sunlight with soft cascaded shadows, subtle atmospheric fog, and tone mapping tuned to AAA military shooter aesthetics.
- `world.physics`:
  - Rapier physics with singular step ownership for player controller kinematics, cover colliders, and high-precision hitscan raycasting.
- `world.navigation`:
  - Recast navmesh for enemy bot pathfinding and cover nodes.
- `vfx.particles` & `audio.procedural`:
  - Quarks GPU particle emitters for muzzle flashes and dust impacts; Tone.js / WebAudio for punchy gunshot transients and spatialized ricochets.

### 4. The Gauntlet Visual & Performance Convergence Loop
Execute the autonomous Gauntlet Loop:
1. Scaffold the project using `bun run studio -- create codename-gauntlet-warfare --json`.
2. Implement systems against Koota ECS semantic authority (gameplay state completely decoupled from Three.js scene graphs).
3. Capture browser observations using `bun run studio -- observe` / Playwright proof harness.
4. Run the Visual Critic evaluation:
   - Compare captured viewport screenshots against the frozen Call of Duty reference screenshots.
   - Iteratively tune viewmodel FOV, gun placement, lighting specular highlights, and ADS lerp curves until the visual discrepancy is minimized to fidelity.
5. Settle under strict performance budgets:
   - Locked 60 FPS (target) in headless/browser execution.
   - Max 150 draw calls.
   - Max 180,000 total rendered triangles.
   - Zero console warnings or errors.

Present the GDC Pre-Flight Summary Table before mutating project files.




use this skill: /home/sprime01/projects/gauntlet-game-studio/.claude/skills/graft/SKILL.md

Continue building the execution-ready, triple-A fidelity Call of Duty-style tactical FPS vertical slice ("Codename: Gauntlet Warfare") using Gauntlet Game Studio contracts. Build from the current state of the project, continuing where we left off.

### 1. Vision & Core Gameplay Loop
- Tactical First-Person Shooter vertical slice set in an urban military compound.
- Core 45-second gameplay loop:
  1. Tactical movement: First-person camera with authentic viewmodel sway, sprint-to-fire delay, ADS (Aim Down Sights) zoom with depth-of-field, and crouch/slide.
  2. Gunplay: M4A1 assault rifle with semi/auto fire, projectile/hitscan raycasting, screen shake, procedural recoil pattern (vertical climb + horizontal jitter), muzzle flash, shell ejection VFX, and dynamic crosshairs with hitmarkers.
  3. Combat AI: 2 enemy combatants driven by Recast navigation with cover-seeking, line-of-sight aggro, and return fire.
  4. Audio & Juice: Procedural spatial gunshot audio, reload sounds, impact decals on geometry, and subtle shell casing bounces.
  5. Minimal Tactical HUD: Clean DOM overlay with ammo counter, health bar, dynamic crosshair, and kill notification.

### 2. Online Reference Scraping & Reference Image Intake
- Use web search / internet tools to fetch high-resolution reference images:
  1. A clean side/perspective reference of a modern military M4A1 rifle / carbine.
  2. A reference screenshot of Call of Duty: Modern Warfare viewmodel perspective (first-person ADS and hip-fire framing).
  3. A reference screenshot of an urban warzone/desert compound environment (lighting, ground textures, concrete barriers).
- Ingest these references into `references/` with full provenance tracking (origin URL, SHA-256 hash, reference-only tag).

### 3. Capability Routing Plan
- `asset.reconstruct.reference-image` via `img2threejs`:
  - Reconstruct the primary player weapon (M4A1) viewmodel into a procedural Three.js module (`src/assets/m4a1-viewmodel.ts`) with named sockets (`socket-muzzle`, `socket-optic`, `socket-ejection`).
  - Enforce silhouette similarity >= 0.70 and triangle budget <= 12,000 tris.
- `world.environment.compose` via `3dviz-pro-max`:
  - Compose a focused urban combat arena (concrete blast barriers, sandbags, shipping container, ruined brick wall) with tactical sightlines.
  - Realistic PBR lighting setup: Directional sunlight with soft cascaded shadows, subtle atmospheric fog, and tone mapping tuned to AAA military shooter aesthetics.
- `world.physics`:
  - Rapier physics with singular step ownership for player controller kinematics, cover colliders, and high-precision hitscan raycasting.
- `world.navigation`:
  - Recast navmesh for enemy bot pathfinding and cover nodes.
- `vfx.particles` & `audio.procedural`:
  - Quarks GPU particle emitters for muzzle flashes and dust impacts; Tone.js / WebAudio for punchy gunshot transients and spatialized ricochets.

### 4. The Gauntlet Visual & Performance Convergence Loop
Execute the autonomous Gauntlet Loop:
1. Scaffold the project using `bun run studio -- create codename-gauntlet-warfare --json`.
2. Implement systems against Koota ECS semantic authority (gameplay state completely decoupled from Three.js scene graphs).
3. Capture browser observations using `bun run studio -- observe` / Playwright proof harness.
4. Run the Visual Critic evaluation:
   - Compare captured viewport screenshots against the frozen Call of Duty reference screenshots.
   - Iteratively tune viewmodel FOV, gun placement, lighting specular highlights, and ADS lerp curves until the visual discrepancy is minimized to fidelity.
5. Settle under strict performance budgets:
   - Locked 60 FPS (target) in headless/browser execution.
   - Max 150 draw calls.
   - Max 180,000 total rendered triangles.
   - Zero console warnings or errors.

Present the GDC Pre-Flight Summary Table before mutating project files.
