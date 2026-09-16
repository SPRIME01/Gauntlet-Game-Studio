---
skill_id: threejs-game-ui-designer
upstream_pack: threejs-game-skills
overlay_capability: overlay.game-ui-designer
bound_capabilities: [verify.browser]
orchestration_authority: gauntlet-game-studio
overlay_policy: vendor/skills/threejs-game-skills/overlay.json
---

# Game UI Designer Specialist (studio-owned overlay pointer)

Studio-owned progressive-disclosure pointer for the `threejs-game-ui-designer` specialist of the
vendored `threejs-game-skills` pack (MIT; provenance in `vendor/attribution.json`). This file is
Gauntlet routing glue: it carries the studio routing contract and provenance only, and carries no
specialist payload. Specialist knowledge content is disclosed from the vendored pack only when the
studio director activates this specialist under the capability contracts below.

## Routing authority

The Gauntlet studio director is the sole orchestration authority. This specialist is never a
top-level orchestration skill; `threejs-game-director` is forbidden by overlay policy
(REQ-BIND-007, REQ-SOURCE-005).

## Boundaries

- Never owns authoritative gameplay state; UI reads studio state projections.
- Never settles visible HUD behavior: deterministic browser proof (`verify.browser`/Playwright)
  owns settlement; this specialist is exploratory design knowledge only.
- Never synthesizes audio (`audio.procedural` owns the AudioBackend boundary).
