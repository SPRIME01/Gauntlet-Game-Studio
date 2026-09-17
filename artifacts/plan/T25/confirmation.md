# T25 Whole-Studio Independent Confirmation Record

- **Confirmation mode**: independent_adversarial (per plan T25 preregistration) — the final whole-studio confirmation
- **Confirmed at**: 2026-09-17 (fresh verifier session at revision dea0673; builder conclusions not treated as authority)
- **Required verdict**: CONFIRM
- **Actual verdict**: **CONFIRM — 16/16 high-risk groups**

## Gates reproduced fresh (verifier's own runs, exit 0)
- `python3 scripts/check-traceability.py <plan> <spec>` — 193 IDs mapped (152 REQ / 14 VAR / 8 RECOV / 10 CLAIM),
  zero unmapped, zero unknown; DAG acyclic; declared critical path equals computed (17); all P3 preregs on disk
  and frozen
- `just ci` — 339/339 tests, doctor SUCCESS; recipe composes only existing gates (no competing protocol)
- `bun run studio -- verify --project examples/blackwater-relay --suite all --json` — 9/9 scenarios settled fresh
  with real system Chrome at HEAD
- `just check` / `test` / `lint` / `validate-agent-artifacts` individually green

## Verifier's own clean reproduction
Independent `git clone --no-hardlinks` of committed HEAD (not the builder's script): donor never present,
frozen-lockfile install, all gates + doctor + donor scans + Blackwater build + 9/9 deterministic game tests green
under credential-stripped env; extra `rm -rf` donor + re-test leg green.

## Per-group verdicts (all CONFIRM)
REQ-ASSET, REQ-AUDIO, REQ-BIND, REQ-BLENDER, REQ-CONFIG, REQ-DONOR, REQ-GAUNTLET, REQ-NET, REQ-OBS, REQ-PERF,
REQ-ROUTE, REQ-RUNTIME, REQ-SAFE, REQ-SEC, REQ-SKILL, REQ-TERRAIN — each spot-verified with fresh gate/test runs
by the verifier; confirmation-mode records (artifacts/plan/Tnn/confirmation.md) verified present with verdict
CONFIRM for T09/T12/T14/T17–T24; T04/T07/T08/T10 independent_adversarial records corroborated in their settled
summaries.

## Adversarial checks (all rejected)
1. Traceability: 8 requirement IDs traced spec→implementation→evidence independently; sharper unmapped-tooth
   variant (two mappings removed) named both exact IDs and failed; real plan untouched, control exit 0.
2. Hidden dependencies: zero provider API endpoints in source; Blender spawned only inside the dcc adapter
   (runtime-policed); donor referenced only by audit tooling; single-player bundle network-free (behavioral teeth
   hold); donor-absent clone builds/tests green.
3. Evidence freshness: index sample — current-revision runs fresh; foreign-revision runs stale-rejected AND
   preserved; failed/correction settlements append-only; stale-substitution tooth re-run by the verifier fired at
   store and settlement layers with the game store byte-clean.
4. Claim discipline: known honest limits (software rendering; loopback-only multiplayer; fixture-level T14
   similarity; WebRTC optional/unexercised; target-hardware profile unclaimed) are stated where the
   corresponding claims live.

## Post-confirmation correction (round 2, preserved per protocol)
Once scripts/conformance-security.ts was committed, its secret scanner self-matched the verbatim canary literal
inside its own baseline declaration (fail-closed; conformance:security exited 1 at HEAD). Failure preserved in
artifacts/plan/T24/security-correction2-failure.txt; correction: a self-declaration baseline entry matching the
scanner's own trimmed source line; rerun green (security-correction2-gate.txt, 6/6). No acceptance weakened.
Also: final-report.md requirement count corrected (55, matching the plan's mechanical confirms expansion).

## Non-blocking observations recorded for the record
1. T02 (P2) prereg filename on disk is `T02-contracts.md` while the plan declares `...plan-T02.prereg.yaml`
   (same frozen claims); the traceability gate enforces frozen-on-disk preregs for P3 only.
2. CURRENT_STATUS latest_evidence lacked T23/T24 rows (recorded in execution/handoff/confirmation records);
   added in the final status update.
3. donor:audit rewrites the timestamp line of artifacts/plan/T09/donor-inventory.md on each run (designed
   behavior; content otherwise stable).
