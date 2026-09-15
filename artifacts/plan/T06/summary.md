# Task Settlement Summary: T06

**Task ID**: T06  
**Title**: Bind third-party skills/libraries, overlay policy, and attribution classes  
**Proof Level**: P2  
**Confirmation**: peer CONFIRM  
**Status**: SETTLED  
**Governing Requirements**:
- `REQ-GOAL-006`: The studio MUST make upstream providers replaceable behind stable contracts and SHOULD avoid source forks unless an affordance cannot be supplied through an adapter, overlay, patch, or configuration.
- `REQ-SOURCE-005`: `threejs-game-skills` SHOULD be overlaid/selectively adapted first; only an individual specialist skill whose assumptions cannot be constrained externally should be copied into a local vendor override. The upstream director `threejs-game-director` must not compete with studio router authority.
- `REQ-SOURCE-006`: Third-party notices and provenance records MUST distinguish runtime package dependencies, agent-skill sources, temporary code donors, copied/modified code, and external content assets.

## Changes Completed
1. Preregistered claims and falsifiers in `.agents/preregistrations/gauntlet-game-studio-plan-T06.prereg.yaml` under proof level P2.
2. Created `THIRD_PARTY_NOTICES.md` at repository root defining the 5 normative attribution classes.
3. Created `vendor/attribution.json` systematically tracking:
   - `runtime_dependency`: Three.js, Koota, Rapier, three-mesh-bvh, three.quarks, Tone.js
   - `agent_skill_source`: img2threejs, 3dviz-pro-max, threejs-game-skills
   - `temporary_donor`: .tmp/donor/
   - `copied_code`: zero untracked copied code
   - `external_asset`: Poly Haven PBR textures and skyboxes
4. Pinned metadata for agent-facing skill sources in `vendor/skills/img2threejs/metadata.json`, `vendor/skills/3dviz-pro-max/metadata.json`, and `vendor/skills/threejs-game-skills/metadata.json`.
5. Created overlay policy in `vendor/skills/threejs-game-skills/overlay.json` explicitly whitelisting specialist prompts while strictly forbidding `threejs-game-director` to prevent competing orchestration authority.
6. Implemented overlay policy validation and source attribution linter in `packages/studio/src/skills/overlay.ts`.
7. Created verification scripts `scripts/verify-source.ts` and `scripts/verify-third-party.ts` bound to `bun run source:verify` and `bun run third-party:verify`.
8. Created automated test suite in `packages/studio/src/skills/overlay.test.ts` (5 tests passing).

## Gates & Falsification Evidence
- **Preregistration**: Frozen in `.agents/preregistrations/gauntlet-game-studio-plan-T06.prereg.yaml`.
- **Narrow Gate 1 (`bun run source:verify`)**: PASS (exit code 0, single Three.js dependency verified, zero unnecessary vendoring).
- **Narrow Gate 2 (`bun run third-party:verify`)**: PASS (exit code 0, overlay policy and all 5 attribution classes verified).
- **Global Gate (`just check`)**: PASS.
- **Global Gate (`just test`)**: PASS (60 tests pass across workspaces).
- **Global Gate (`just lint`)**: PASS.
- **Teeth Attack 1 (`TEETH-T06-001`)**: PASS — Attempting to expose `threejs-game-director` as an orchestration skill throws `ForbiddenUpstreamAuthorityError` (`FORBIDDEN_UPSTREAM_AUTHORITY`).
- **Teeth Attack 2 (`TEETH-T06-002`)**: PASS — Introducing a standard runtime library through `vendor/` is caught by `lintSourceAttribution` and flagged as unnecessary vendoring.

## Artifacts Generated
- `.agents/preregistrations/gauntlet-game-studio-plan-T06.prereg.yaml`
- `THIRD_PARTY_NOTICES.md`
- `vendor/attribution.json`
- `vendor/skills/img2threejs/metadata.json`
- `vendor/skills/3dviz-pro-max/metadata.json`
- `vendor/skills/threejs-game-skills/metadata.json`
- `vendor/skills/threejs-game-skills/overlay.json`
- `packages/studio/src/skills/overlay.ts`
- `packages/studio/src/skills/overlay.test.ts`
- `scripts/verify-source.ts`
- `scripts/verify-third-party.ts`
- `artifacts/plan/T06/gate.txt`
- `artifacts/plan/T06/teeth.txt`
- `artifacts/plan/T06/summary.md`
