# Codename: Gauntlet Warfare

Playable tactical-FPS vertical slice. Pushed toward AAA presentation: PBR
environment (accepted CC0 Poly Haven texture sets via `asset.resolve`), a
procedural late-afternoon sky feeding image-based lighting, MSAA HDR
post-processing on hardware GPUs, red-dot optic with visible reticle, tracers
and muzzle-light combat readability, procedural NPC animation (walk cycle,
flinch, death fall), layered procedural gun audio with wind bed and footsteps,
and a COD-style compass HUD.

From this directory:

```sh
bun install
bun start
```

Open http://127.0.0.1:4173 and click Deploy. Keep the terminal running.
The start command builds and serves the correct bundle path; no Python server is needed.

WASD moves, mouse aims, left mouse fires, right mouse aims down sights,
Shift sprints, Ctrl/C crouches (while sprinting: slide), R reloads, B switches
semi/automatic fire, Escape pauses. Clear two enemies within 45 seconds;
the terminal overlay offers redeployment.

Verification: `bun test`, `bun run typecheck`, `bun run build:web`, then
`bun run test:browser` (requires local Chrome and permission to bind loopback).
Browser captures and measurements live under `artifacts/evidence/repair/`.
The proof rejects console warnings as well as errors. Proof runs use ANGLE's
SwiftShader software backend because the legacy `--enable-unsafe-swiftshader`
GL frontend emitted four spurious "GPU stall due to ReadPixels" driver warnings
during page load before any application code runs; both paths are pure software
rendering and no message is filtered. The runtime picks its rendering policy by
renderer class: hardware GPUs get the always-on MSAA HDR composer chain, while
SwiftShader-class software renderers keep the direct path outside ADS so
fixed-step simulation time never dilutes.

The CC0 texture sets (dry ground, concrete wall, brick wall, container side)
were sourced live from Poly Haven through `studio asset resolve` with per-file
SHA-256 provenance and accepted through the studio asset gates; only extracted
images are retained, and reference imagery never ships as textures.

The runtime weapon is the operator-approved, project-owned hand-authored
procedural M4A1 (`src/assets/m4a1-viewmodel.ts`, 2,840 triangles, named
muzzle/optic/ejection sockets). Measured silhouette IoU against the frozen
reference is 0.834 (`scripts/measure-silhouette.py`, game minimum 0.70);
independent multi-angle visual review returned accept. The stopped
img2threejs attempts (silhouette 0.7050 vs the unchanged provider gate 0.85)
remain preserved and unaccepted.

The latest browser proof observed timeout, death, victory and redeployment
through browser input with zero console errors and zero warnings. Measured
peaks: 132 draw calls (budget 150) and 43,958 triangles (budget 180,000).
Total runtime memory is measured: 96.4 MB page-attributed JS+WASM via
`performance.measureUserAgentSpecificMemory` under crossOriginIsolation
(budget 256 MB); renderer/GPU process RSS is recorded as context only.
Performance is software-rendered; 60 FPS remains an aspirational target under
the operator amendment. An independent settlement reviewer confirmed the
evidence chain (CONFIRM, 2026-09-18).

All five declared production assets are accepted through the studio asset CLI
gates. combat-audio acceptance rests on a signal-level browser proof (real
gesture policy with an un-gestured negative control; transient, spatial and
reload paths observed through an analyser tap); human audibility was never
observed headless and is not claimed.

Recovery evidence and remaining gates: `artifacts/evidence/repair/recovery-2026-09-18.md`.
The proof rebuilds the bundle, records its SHA-256 and captures each terminal
scenario separately. Unit tests also detect missing or changed asset sources.
