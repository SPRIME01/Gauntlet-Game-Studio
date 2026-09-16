# Task Settlement Evidence: T16

## Task Information
- **Task ID**: `T16`
- **Title**: Integrate threejs-game-skills specialists through studio-owned overlay
- **Proof Level**: `P2`
- **Confirmation**: `peer` — evidence prepared; peer confirmation pending (P2 mode, not builder-self-confirmed)
- **Settles**: `REQ-BIND-007`
- **Timestamp**: 2026-09-16T02:55:00Z
- **Preregistration**: `.agents/preregistrations/gauntlet-game-studio-plan-T16.prereg.yaml` (frozen before any evidence evaluation)

## Implementation Overview
1. **Overlay mapping** (`vendor/skills/threejs-game-skills/overlay.json`, schema `gauntlet.skill_overlay` 1.1):
   - `allowed_specialists` is exactly the plan's overlay set: `threejs-gameplay-systems`,
     `threejs-aaa-graphics-builder`, `threejs-game-ui-designer`, `threejs-debug-profiler`,
     `threejs-qa-release`, each with a `specialist_bindings` entry (summary, positive triggers,
     negative affordances, capability anchor, disclosure pointer).
   - Each binding anchors to existing studio capability contracts (capability-first): gameplay-systems →
     `world.physics`+`world.navigation`; aaa-graphics → `world.composition`+`asset.optimize`;
     game-ui → `verify.browser`; debug-profiler → `verify.browser`+`network.multiplayer`;
     qa-release → `verify.browser`.
   - `quarantined_skills` includes `threejs-3d-generator`, `threejs-image-generator`,
     `threejs-audio-generator`; `quarantine_policy.enabled=false`; enabling requires
     `enablement_declared_by` naming explicit project policy — credential presence is never a basis.
   - `forbidden_skills` unchanged: `threejs-game-director`, `director`, `game-director`.
2. **Overlay mechanism** (`packages/studio/src/skills/overlay.ts`, extended, not duplicated):
   - `loadSkillOverlayPolicy` loader; extended `validateOverlayPolicy` (canonical specialist set,
     generator quarantine, binding structure, disclosure-pointer confinement under `skills/`/`vendor/`).
   - `OverlaySkillRegistry` with registration-time enforcement: forbidden director references
     (id, provider, or last-dotted-segment match) throw `ForbiddenUpstreamAuthorityError`; quarantined
     generators throw `QuarantinedSkillError`; entries must anchor to real catalog capabilities and pass
     the skill metadata contract.
   - `lintOverlayRouting` / `lintStudioSkillSurface`: routing-collision lint between studio capabilities
     and upstream specialist descriptions — uncoordinated trigger collisions with unbound studio
     capabilities are hard errors (`OVERLAY_ROUTING_COLLISION`), specialist-vs-specialist trigger
     duplication is an error (`OVERLAY_SPECIALIST_TRIGGER_COLLISION`), unknown capability anchors are
     errors, coordinated provider-below-contract overlap stays a warning.
   - `evaluateProviderPreference` provider policy: quarantined generators and forbidden directors are
     never selectable; credential presence alone (`CREDENTIAL_PREFERENCE_REJECTED`) never prefers a
     provider — preference must come from declared studio capability providers (identity below contracts).
   - Progressive disclosure: routing surface (summaries/triggers/anchors) is separated from content;
     `resolveSpecialistDisclosure` resolves the layer-2 pointer only on demand.
3. **Disclosure pointers** (`skills/threejs-game-skills/<specialist>/SKILL.md`, five files): studio-owned
   routing/provenance glue matching the AgentHandoff `skills/<skill_id>/SKILL.md` convention. They carry
   authority/boundary statements only — no specialist payload, no fabricated upstream content.
4. **Gate enforcement** (`apps/studio-cli/src/index.ts`): `studio capabilities lint` now composes
   `lintStudioSkillSurface` over the registered surface plus the loaded overlay policy, so the declared
   gate enforces director exclusion, quarantine, and collision rules (missing/unparsable policy fails lint).

## Verification Evidence
- **Narrow Gates** (fresh runs, exit 0): `bun run studio -- capabilities lint --json` (valid, 0 issues);
  `bun test packages/studio/test/skill-overlays` (7/7 tests, 191 expects) — log: `artifacts/plan/T16/gate.txt`
- **Policy re-runs**: `bun run source:verify`, `bun run third-party:verify` — both exit 0.
- **Teeth / Falsification Checks**: both preregistered falsifiers exercised live and passing —
  `artifacts/plan/T16/teeth.txt`:
  - TEETH-T16-001: two director-discovery attack variants injected into the live registry; the real
    CLI gate reported `status=failed`, exit 1, `FORBIDDEN_UPSTREAM_AUTHORITY` for all three references.
  - TEETH-T16-002: quarantined generator with `credentials_present=true` rejected (`QUARANTINED_SKILL`);
    credential-only preference rejected (`CREDENTIAL_PREFERENCE_REJECTED`); declared-provider positive
    control allowed.
- **Regression**: existing T06 overlay tests 5/5; full workspace excluding untracked T12 WIP network
  tests: 153/153 pass, exit 0 (20 files, includes router.test.ts "13 normative capabilities" invariant).

## Global Gate Status (shared working tree, precisely attributed)
- `just lint`: exit 0. `just validate-agent-artifacts`: exit 0.
- `just check`: exit 2 — all 8 TypeScript errors originate in **untracked concurrent T12/T13 WIP files**
  (`packages/runtime/src/network/*.ts`, `packages/adapters/src/assets/gltf.ts`). Proof: those paths do not
  exist in committed HEAD (`git ls-tree`), and a scoped typecheck over every T16-touched compile surface
  (contracts + studio incl. new tests + studio-cli) exits 0 (`.tmp/t16-tsconfig.json`).
- `just test`: exit 1 — every failure is inside untracked T12 WIP `packages/runtime/test/network/*.test.ts`
  ("Koota: Too many worlds created" during setup); zero failures in any T16 or previously settled suite
  (153/153 excluding the T12 WIP directory).

## Confirmation
- Mode: `peer` (P2). Evidence in `artifacts/plan/T16/` is prepared for peer confirmation; per plan
  discipline the builder does not self-confirm.

## Scope Notes
- **No vendor-override fork was needed**: external overlay configuration fully constrains the mapping
  (bindings, quarantine, disclosure pointers), so nothing was copied under `skills/vendor-overrides/`;
  the five pointer files are studio-owned routing glue, not upstream copies.
- The specialist routing surface is deliberately separate from `defaultCapabilityRegistry`; the normative
  catalog remains 13 capabilities and `catalog.ts` was not modified.
- `just check`/`just test` non-zero exits in the shared tree are attributable entirely to concurrent,
  uncommitted T12/T13 work-in-progress; re-verification after those tasks settle is at the operator's
  discretion. No T16 evidence depends on T12/T13 files.
