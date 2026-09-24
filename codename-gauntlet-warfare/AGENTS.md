# AGENTS.md (Game Project)

Operating guidance for coding agents within this generated game project.

## Invariants
1. Authoritative gameplay state must remain separate from Three.js scene objects and visual representations.
2. Assets must be registered in `assets/manifest.json` before being referenced in game code.
3. Keep runtime performance within budgets declared in `.agents/specs/game.spec.yaml`.
4. Verification evidence must be placed in `artifacts/evidence/`.
