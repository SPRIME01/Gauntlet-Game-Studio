---
skill_id: threejs-aaa-graphics-builder
upstream_pack: threejs-game-skills
overlay_capability: overlay.aaa-graphics-builder
bound_capabilities: [world.composition, asset.optimize]
orchestration_authority: gauntlet-game-studio
overlay_policy: vendor/skills/threejs-game-skills/overlay.json
---

# AAA Graphics Builder Specialist (studio-owned overlay pointer)

Studio-owned progressive-disclosure pointer for the `threejs-aaa-graphics-builder` specialist of
the vendored `threejs-game-skills` pack (MIT; provenance in `vendor/attribution.json`). This file
is Gauntlet routing glue: it carries the studio routing contract and provenance only, and carries
no specialist payload. Specialist knowledge content is disclosed from the vendored pack only when
the studio director activates this specialist under the capability contracts below.

## Routing authority

The Gauntlet studio director is the sole orchestration authority. This specialist is never a
top-level orchestration skill; `threejs-game-director` is forbidden by overlay policy
(REQ-BIND-007, REQ-SOURCE-005).

## Boundaries

- Never reconstructs depicted objects from reference imagery (`asset.reconstruct`/img2threejs owns
  that route and requires suitable reference imagery).
- Never produces terrain elevation math (`world.terrain` owns it).
- Never performs asset licensing intake (`asset.source` owns provenance verification).
- Visual quality work must respect asset budgets enforced by `asset.optimize`.
