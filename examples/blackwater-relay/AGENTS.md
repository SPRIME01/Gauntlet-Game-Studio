# AGENTS.md (Game Project)

Operating guidance for coding agents within this generated game project.

## Invariants
1. Authoritative gameplay state must remain in Koota, separate from Three.js scene
   objects, Rapier bodies, Recast data, VFX/audio, and the DOM HUD (projections only).
2. Assets must be registered in `assets/manifest.json` before being referenced in game code.
3. Keep runtime performance within the quality profiles declared in
   `.agents/specs/game.spec.yaml`; named scenarios and expectations are frozen before
   evidence and must not be weakened to make an implementation pass.
4. Verification evidence flows through the stable `__GAUNTLET_STUDIO_OBS__` v1 surface;
   fresh runs land in `artifacts/runs/` (gitignored, immutable per run) and curated
   settlement evidence in `artifacts/plan/` + `artifacts/evidence/`.
5. The game declares a network-FREE single-player build (`network.enabled = false`):
   the single-player build graph (`src/game/**`, `src/world/**`, `src/assets/**`,
   `src/main.ts`, `src/index.ts`) never imports or constructs a transport. The OPTIONAL
   T23 multiplayer mode lives ONLY in the declared entries (`src/server.ts`,
   `src/net/**`) and is never started by the single-player path.
6. The service drone is consumed ONLY as the committed accepted GLB derivative;
   never require Blender or `.tmp/donor` at build/test/runtime.

## Gates
- `bun run build` — typecheck + browser bundles (dist/: game.js + net-client.js)
- `bun run test` — unit + headless scenario progression checks
- `bun run test:e2e` — full six-scenario single-player Playwright suite (system Chrome)
- `bun run test:blackwater-multiplayer` — full three-scenario authoritative multiplayer
  suite (headless server + two independent browser clients per scenario)
- `studio verify --project . --suite single-player --json` — single-player settlement gate
- `studio verify --project . --suite multiplayer --json` — multiplayer settlement gate
