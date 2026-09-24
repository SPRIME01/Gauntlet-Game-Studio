# Gauntlet Warfare repair and settlement

Approved scope: user's tactical FPS brief and instruction to repair, build, implement and settle. Preserve existing evidence; no new pre-flight approval is required.

Execution order:
1. Replace false-positive combat with Koota-owned simulation. Gates: misses cannot award hits; cover blocks shots and enemy fire; reload timing, semi/auto cadence, sprint delay, death and restart tested.
2. Connect Rapier kinematic movement and hitscan, Recast cover paths, and browser pointer-lock input. Exactly one fixed-step physics owner.
3. Execute weapon/world capability lifecycles, retaining reference-only provenance. Improve materials, framing, lighting, audio, particles and HUD.
4. Capture browser input scenarios, screenshots and telemetry at 1280x720. Required limits: 150 draw calls, 180000 triangles, weapon 12000 triangles, silhouette 0.70, zero warnings/errors. Operator amendment: 60 FPS is an optimization target, not a hard acceptance threshold; measure and deliver the best practical browser performance with documented quality tradeoffs. Do not infer performance from pixels or functional tests.
5. Independently review authority, occlusion and proof integrity before settlement. Preserve failures and report any unmet criterion individually.

Assumptions: desktop mouse/keyboard; local single player; no external publication; previous reference authorization and prerequisite resolution accepted per operator. Existing assets remain provisional until verified.

## Authorized weapon-route correction (2026-09-18)

The operator approved switching weapon authoring after the img2threejs run plateaued
and stopped at 4/4. Replace the runtime proxy with an independently hand-authored,
project-owned procedural Three.js module. The stopped provider result remains
unaccepted and archived; this route does not claim to pass that provider's gates.
Governing requirements are request req-gauntlet-m4a1-001, REQ-ASSET-003/005/006/007
and the game-local 12000-triangle / 0.70-silhouette acceptance criteria. Preserve
the existing reference-only license, named sockets, single Three.js graph and
Koota authority boundary. Reference pixels cannot ship as surface textures.
Before promotion: measure silhouette, triangle budget, sockets, source hash and
multi-angle volume; independently inspect model and in-game hip/ADS captures.
The world, console and memory gates remain unchanged.
