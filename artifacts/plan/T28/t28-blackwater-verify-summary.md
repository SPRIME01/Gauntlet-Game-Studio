# T28 blackwater-relay `--suite all` regression gate

Command: `env -u DISPLAY -u WAYLAND_DISPLAY bun run studio -- verify --project examples/blackwater-relay --suite all --json`

Result: **exit 0**, `status: success`, `all_settled: true`

| suite | settled | failed | blocked | incomplete |
|-------|---------|--------|---------|------------|
| multiplayer | (see totals) | 0 | 0 | 0 |
| single-player | (see totals) | 0 | 0 | 0 |
| **total** | **9** | **0** | **0** | **0** |

- `fresh_observation: true`
- `settlement_append_only: true`
- exit semantics: 0=settled 1=failed 2=blocked/incomplete

Note: DISPLAY was unset to force Playwright headless (ambient DISPLAY pointed at a dead X server).
