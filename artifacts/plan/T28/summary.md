# T28 summary

Recipe-layer integration above the capability system (spec v0.4.0, REQ-RECIPE-012..014).

## Delivered

- **Canonical 6 recipes** usable without engine/provider nouns: `world.third-person`, `enemy.patrol`, `interaction`, `interaction.pickup`, `interaction.door-key`, `checkpoint`.
- **Cold-agent path**: public CLI `recipes` → `recipe describe` → `recipe plan` → inspectable RecipePlan with `mutation: false`.
- **UX benchmark** (`ux-benchmark.json`): outcome-level decision surface vs manual capability composition baseline; internal capability composition preserved (>0 capabilities per recipe).
- **E2E settlement linkage**: apply writes append-only provenance validated by shared contracts; verify steps record acceptance only (no second evidence format).
- **Regression**: blackwater-relay `--suite all` remains green (9/9 settled, exit 0) with headless Playwright.

## Evidence index

- `confirmation.md` — gates + teeth vs prereg
- `t28-recipes-e2e.txt`, `t28-trace.txt`, `t28-topology.txt`, `t28-source.txt`, `t28-third-party.txt`
- `t28-cli-gates.txt`, `t28-cold-agent.txt`, `t28-cold-agent-plan.json`
- `ux-benchmark.json`
- `t28-blackwater-verify.json`, `t28-blackwater-verify-exit.txt`, `t28-blackwater-verify-summary.md`

## Not claimed

- Does not redesign settled runtime or change authority (Koota/Three.js/Rapier/Recast/Gauntlet unchanged).
- UX benchmark is a decision/concept-surface comparison, not a timing study (method documented in artifact).
