---
skill_id: threejs-debug-profiler
upstream_pack: threejs-game-skills
overlay_capability: overlay.debug-profiler
bound_capabilities: [verify.browser, network.multiplayer]
orchestration_authority: gauntlet-game-studio
overlay_policy: vendor/skills/threejs-game-skills/overlay.json
---

# Debug Profiler Specialist (studio-owned overlay pointer)

Studio-owned progressive-disclosure pointer for the `threejs-debug-profiler` specialist of the
vendored `threejs-game-skills` pack (MIT; provenance in `vendor/attribution.json`). This file is
Gauntlet routing glue: it carries the studio routing contract and provenance only, and carries no
specialist payload. Specialist knowledge content is disclosed from the vendored pack only when the
studio director activates this specialist under the capability contracts below.

## Routing authority

The Gauntlet studio director is the sole orchestration authority. This specialist is never a
top-level orchestration skill; `threejs-game-director` is forbidden by overlay policy
(REQ-BIND-007, REQ-SOURCE-005).

## Boundaries

- Exploratory diagnosis only; never substitutes for settlement-grade browser proof.
- Never mutates authoritative gameplay state and never steps physics simulation.
- Performance telemetry observations must not be inferred across channels (state, pixels,
  telemetry are distinct observation surfaces).
