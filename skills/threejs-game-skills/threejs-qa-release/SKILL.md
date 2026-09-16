---
skill_id: threejs-qa-release
upstream_pack: threejs-game-skills
overlay_capability: overlay.qa-release
bound_capabilities: [verify.browser]
orchestration_authority: gauntlet-game-studio
overlay_policy: vendor/skills/threejs-game-skills/overlay.json
---

# QA Release Specialist (studio-owned overlay pointer)

Studio-owned progressive-disclosure pointer for the `threejs-qa-release` specialist of the
vendored `threejs-game-skills` pack (MIT; provenance in `vendor/attribution.json`). This file is
Gauntlet routing glue: it carries the studio routing contract and provenance only, and carries no
specialist payload. Specialist knowledge content is disclosed from the vendored pack only when the
studio director activates this specialist under the capability contracts below.

## Routing authority

The Gauntlet studio director is the sole orchestration authority. This specialist is never a
top-level orchestration skill; `threejs-game-director` is forbidden by overlay policy
(REQ-BIND-007, REQ-SOURCE-005).

## Boundaries

- Planning and triage only; never executes deterministic proof: `verify.browser`/Playwright owns
  deterministic browser end-to-end proof and pixel capture.
- Never owns authoritative gameplay state.
- Required skipped integrations remain skipped, not passed; claims must not exceed observed
  evidence.
