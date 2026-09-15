# Task Settlement Summary: T05

**Task ID**: T05  
**Title**: Create independent game template and Blackwater Relay scaffold  
**Proof Level**: P1  
**Confirmation**: builder_with_teeth CONFIRM  
**Status**: SETTLED  
**Governing Requirements**:
- `REQ-GOAL-007`: The studio MUST produce projects that remain independently buildable from the studio repository after creation.
- `REQ-OUT-001`: Every created game project MUST carry a project-local game specification, studio lock manifest, runtime source, tests, asset registry, and evidence location.
- `REQ-REPO-002`: Created games SHOULD live in separate repositories/directories and MUST remain independently buildable from pinned project dependencies and project-local manifests.
- `REQ-REPO-003`: The studio MAY retain one or more reference games inside the studio repository solely for integration/conformance testing (`examples/blackwater-relay/`).

## Changes Completed
1. Preregistered claims and falsifiers in `.agents/preregistrations/gauntlet-game-studio-plan-T05.prereg.yaml`.
2. Created standard independent game template in `templates/game/`:
   - `package.json`: Independent project manifest with check/typecheck/test/build scripts and pinned dependencies.
   - `tsconfig.json`: Independent TypeScript configuration.
   - `studio.lock.yaml`: Complete studio lock manifest pinning studio version, spec SHA-256, runtime version, and capability provider versions.
   - `.agents/specs/game.spec.yaml`: Project-local game specification template with budgets, asset registry, and evidence location.
   - `.agents/CURRENT_STATUS.yml`: Project-local status file.
   - `AGENTS.md`: Scoped agent operating instructions.
   - `assets/manifest.json`: Asset registry manifest.
   - `src/index.ts`: Independent game runtime entry point.
   - `tests/game.test.ts`: Independent test suite running under Bun.
   - `references/` and `artifacts/evidence/`: Working directories with gitkeep placeholders.
3. Implemented project generator in `packages/studio/src/generator.ts` (`createGameProject`) and wired to semantic CLI command `studio create <target-path> [--json]`.
4. Scaffolded reference conformance game in `examples/blackwater-relay/` using the exact same game template contract without privileged hidden wiring.
5. Added `test:generated-game` script in root `package.json`.
6. Created automated test suite in `packages/studio/src/generator.test.ts` (5 tests passing).

## Gates & Falsification Evidence
- **Preregistration**: Frozen in `.agents/preregistrations/gauntlet-game-studio-plan-T05.prereg.yaml`.
- **Narrow Gate 1 (`bun run studio -- create .tmp/generated-game-smoke --json`)**: PASS (exit code 0, 11 files generated).
- **Narrow Gate 2 (`bun run test:generated-game`)**: PASS (exit code 0, 5/5 tests passing).
- **Global Gate (`just check`)**: PASS (typecheck, traceability, topology clean).
- **Global Gate (`just test`)**: PASS (56 tests pass across workspaces).
- **Global Gate (`just lint`)**: PASS (all checks pass).
- **Teeth Attack 1 (`TEETH-T05-001`)**: PASS — Generated smoke game moved to decoupled location outside repository (`.tmp/outside-repo-test-game`) runs and passes `bun test` independently.
- **Teeth Attack 2 (`TEETH-T05-002`)**: PASS — Verified smoke project package.json, tsconfig.json, and source contain zero private relative path dependencies into the studio monorepo.

## Artifacts Generated
- `.agents/preregistrations/gauntlet-game-studio-plan-T05.prereg.yaml`
- `templates/game/` (full template structure)
- `packages/studio/src/generator.ts`
- `packages/studio/src/generator.test.ts`
- `examples/blackwater-relay/` (conformance game scaffold)
- `artifacts/plan/T05/gate.txt`
- `artifacts/plan/T05/teeth.txt`
- `artifacts/plan/T05/summary.md`
