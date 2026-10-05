# Post-settlement follow-up: release rail data fields + web source binding

Date: 2026-10-05. Closes gaps 1 and 2 from the T37 whole-studio settlement summary.

## What was built

- **Release rail derivation** (packages/cockpit/src/server/rail.ts): `deriveRail` computes the
  thirteen REQ-COCKPIT-002 fields purely from canonical state — game, model version, derived phase
  (orient/build/verify/release from release-matrix + deviation state), milestone, per-target
  settlement, declared + production-bound quality profiles, contradictions, unknowns, stale
  derivatives, interrupt-severity blockers, owner input (asks/reviews/owner moves), the Game Case's
  primary move, and the owner-settled verdict. No percentage, no score (asserted by test).
- **Surfaces**: GET /api/rail (any authenticated role; shell-rendered, addressable by no agent
  action) and the get_rail semantic tool; web shell renders the real fields with
  contradiction/blocker/owner-input tone states.
- **Web source binding**: read_source tool + fixed /api/data (root/selector parse fixed for
  trailing-colon roots; evidence: and recipes: resolve from real run/recipe records; file: boundary
  now a true path-containment check — a sibling directory sharing a prefix is refused). The client
  fetches source-bound rows (table/tree/timeline/document) with a "sourced: <root>" badge, keeping
  the agent-supplied badge for inline data.

## Evidence

- 5 additional cockpit tests (rail fields + no-percentage invariant, staleness reflection after a
  decision, source grammar + prefix-escape refusal, evidence/recipes resolution, live /api/rail
  auth). Full workspace: 542 pass / 0 fail. just ci: SUCCESS.
