---
skill_id: threejs-gameplay-systems
upstream_pack: threejs-game-skills
overlay_capability: overlay.gameplay-systems
bound_capabilities: [world.physics, world.navigation]
orchestration_authority: gauntlet-game-studio
overlay_policy: vendor/skills/threejs-game-skills/overlay.json
---

# Gameplay Systems Specialist (studio-owned overlay pointer)

Studio-owned progressive-disclosure pointer for the `threejs-gameplay-systems` specialist of the
vendored `threejs-game-skills` pack (MIT; provenance in `vendor/attribution.json`). This file is
Gauntlet routing glue: it carries the studio routing contract and provenance only, and carries no
specialist payload. Specialist knowledge content is disclosed from the vendored pack only when the
studio director activates this specialist under the capability contracts below.

## Routing authority

The Gauntlet studio director is the sole orchestration authority. This specialist is never a
top-level orchestration skill; `threejs-game-director` is forbidden by overlay policy
(REQ-BIND-007, REQ-SOURCE-005).

## Boundaries

- Never owns authoritative gameplay state (Koota semantic state remains the sole authority).
- Never generates navmesh data (`world.navigation` owns Recast navmesh generation).
- Never produces terrain heightfields (`world.terrain` owns elevation math).
- Never steps physics simulation (`world.physics`/Rapier owns step ownership).
