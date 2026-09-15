# Task Settlement Summary: T04

**Task ID**: T04  
**Title**: Implement capability registry, routing, skill metadata, and AgentHandoff semantics  
**Proof Level**: P3  
**Confirmation**: independent_adversarial CONFIRM  
**Status**: SETTLED  
**Governing Requirements**:
- `REQ-GOAL-001`: Studio capabilities defined independently of provider implementations
- `REQ-GOAL-005`: Multi-provider routing without vendor leakage into domain contracts
- `REQ-GOAL-010`: Semantic and reproducible workflows across agents and CI
- `REQ-CONFIG-003`: Capability-first routing policy
- `REQ-CONFIG-006`: Skill metadata constraints (length <= 1024 chars, guidance 200-400 chars, positive triggers, negative affordances)
- `REQ-ROUTE-001`: Capability resolution occurs before provider selection
- `REQ-ROUTE-002`: Router evaluates positive triggers and strictly enforces negative affordances
- `REQ-ROUTE-003`: Deterministic routing fallback policy
- `REQ-ROUTE-004`: Clear separation between single-object reconstruction (`img2threejs` / `asset.reconstruct`) and scene composition (`3dviz` / `world.composition`)
- `REQ-ROUTE-005`: Safe rejection of routing collisions and ambiguous requests
- `REQ-ROUTE-006`: Provider availability changes do not redefine capability semantics
- `REQ-SKILL-001`: Skill description length and negative boundary enforcement
- `REQ-SKILL-002`: Registry-wide collision detection across triggers and capabilities
- `REQ-SKILL-003`: Explicit `AgentHandoff` generation without model execution in router
- `REQ-SKILL-004`: `AgentHandoff` lifecycle prohibits premature settlement without accepted artifacts
- `REQ-SKILL-005`: CI deterministic artifact verification without requiring model provider credentials
- `REQ-SKILL-006`: Progressive disclosure of specialist skill instructions
- `REQ-SAFE-002`: Guardrails against prompt injection and arbitrary provider escalation

## Changes Completed
1. Preregistered claims and falsifiers in `.agents/preregistrations/gauntlet-game-studio-plan-T04.prereg.yaml` under proof level P3.
2. Implemented normative 13-capability catalog in `packages/studio/src/capabilities/catalog.ts` with explicit negative affordances and descriptions complying with the 120-500 character guideline.
3. Implemented `CapabilityRegistry` in `packages/studio/src/capabilities/registry.ts` supporting lookup, registration, and default capability resolution.
4. Implemented skill metadata and registry linter in `packages/studio/src/skills/linter.ts` enforcing description budgets, trigger requirements, negative boundaries, and collision detection.
5. Implemented capability-first router and `AgentHandoff` lifecycle in `packages/studio/src/router/router.ts`.
6. Wired CLI commands in `apps/studio-cli/src/index.ts`:
   - `studio capabilities`: lists all registered capabilities
   - `studio capabilities lint`: validates skill descriptions and checks for collisions
   - `studio capability prepare`: emits `AgentHandoff` or provider resolution without calling models
   - `studio capability accept`: settles an `AgentHandoff` with verified artifact outputs
   - `studio capability verify-result`: verifies capability results against studio contracts deterministically in CI
7. Created comprehensive test suite in `packages/studio/src/router/router.test.ts` (9 tests) covering routing, disambiguation, linter enforcement, and premature settlement rejection.

## Gates & Falsification Evidence
- **Preregistration**: Frozen in `.agents/preregistrations/gauntlet-game-studio-plan-T04.prereg.yaml`.
- **Narrow Gate 1 (`bun run studio -- capabilities lint --json`)**: PASS (exit code 0, 0 errors, 0 warnings).
- **Narrow Gate 2 (`bun test packages/studio`)**: PASS (exit code 0, 100% tests passing).
- **Global Gate (`just check`)**: PASS.
- **Global Gate (`just test`)**: PASS (48 tests pass across workspaces).
- **Teeth Attack 1 (`TEETH-T04-001`)**: PASS — Ambiguous prompt overlapping `img2threejs` and `3dviz` routes correctly based on negative boundaries; conflicting negative affordances throw `RoutingCollisionError`.
- **Teeth Attack 2 (`TEETH-T04-002`)**: PASS — Descriptions > 1024 characters or missing negative affordances are rejected with `SkillLintIssue` errors.
- **Teeth Attack 3 (`TEETH-T04-003`)**: PASS — Settling an `AgentHandoff` without accepted artifacts throws `PrematureSettlementError`.

## Artifacts Generated
- `.agents/preregistrations/gauntlet-game-studio-plan-T04.prereg.yaml`
- `packages/studio/src/capabilities/catalog.ts`
- `packages/studio/src/capabilities/registry.ts`
- `packages/studio/src/skills/linter.ts`
- `packages/studio/src/router/router.ts`
- `packages/studio/src/router/router.test.ts`
- `packages/studio/src/index.ts`
- `apps/studio-cli/src/index.ts`
- `artifacts/plan/T04/gate.txt`
- `artifacts/plan/T04/teeth.txt`
- `artifacts/plan/T04/summary.md`
