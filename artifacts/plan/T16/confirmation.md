# T16 Peer Confirmation Record

- **Confirmation mode**: peer (per plan T16 preregistration)
- **Confirmed at**: 2026-09-15 (fresh reviewer session; builder conclusions not treated as authority)
- **Required verdict**: CONFIRM
- **Actual verdict**: **CONFIRM**
- **Scope**: REQ-BIND-007

## Gates reproduced fresh (reviewer's own runs, exit 0)
- `bun run studio -- capabilities lint --json` — valid, 0 issues
- `bun test packages/studio/test/skill-overlays` — 7/7, 191 expects
- `bun run source:verify`, `bun run third-party:verify`, `just lint`, `just validate-agent-artifacts`
- `just check` / `just test` — exit 0, 184/184 (stronger than the captured gate.txt window, which predated the
  concurrent T12/T13 builders' final fixes; the captured attribution of those failures was verified accurate at
  its timestamp and is now moot)

## Falsifiers — live, independently reproduced
- TEETH-T16-001: reviewer registered two schema-valid director-discovery variants into the live registry and ran
  the real CLI gate → exit 1, `FORBIDDEN_UPSTREAM_AUTHORITY` for `game.director`,
  `agent-skill.threejs-game-director`, `skill.threejs-game-director`. Enforcement is structural
  (packages/studio/src/skills/overlay.ts surface scan + token matching), not a test stub.
- TEETH-T16-002: quarantined generator with `credentials_present=true` → `QUARANTINED_SKILL`; credential-only
  preference → `CREDENTIAL_PREFERENCE_REJECTED`; positive control (`agent-skill.img2threejs` for
  `asset.reconstruct`) stayed ALLOWED — the policy discriminates rather than blanket-rejects.

## Alternate probes (all held)
- Overlay mapping is exactly schema-conformant: five specialists, three+ quarantined generators
  (`enabled:false` + `enablement_declared_by` required), director tokens forbidden; tampering with policy copies
  fails validation.
- Progressive disclosure is real: capability catalog unchanged (13 capabilities, zero `overlay.*` discoverable);
  specialist detail resolved only on demand and throws for director/generators/undeclared skills.
- SKILL.md files are disclosure pointers only (studio provenance/authority/boundaries), no upstream payload.
- Orchestration/provider policy unchanged; no vendor noun in capability IDs.

## Honesty check
summary.md explicitly does_not_prove "that every upstream specialist workflow is suitable unchanged or that
optional generators are enabled"; no vendor-override fork was created (consistent with evidence).

## Non-blocking observations
1. The five SKILL.md pointers say specialist content "is disclosed from the vendored pack," but the vendored
   pack currently holds metadata/overlay JSON only (metadata-only vendoring pattern, consistent with
   img2threejs/3dviz). Phrasing slightly outruns current repo contents; reconcile when actual payload disclosure
   lands.
