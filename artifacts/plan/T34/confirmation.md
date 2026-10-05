# T34/T35 Independent Adversarial Confirmation — three rounds

## Round 1 (initial): REJECT
Two falsifier-level holes: game_replay fabricated "evidence-found" for any id without consulting
evidence (TEETH-T34-005 violation); closed surfaces did not stay closed (REQ-COCKPIT-004). Also:
work requests not operable end-to-end, no-op stubs with fabricated effects. Preserved in
correction-round1/findings.md; all fixed in commit 8b014ee.

## Round 2 (post-correction): REJECT (narrow)
Fixes 1/2/4 confirmed; all five original falsifiers held. New: D1 work_submit seq aliasing from the
third submit (demonstrated wrong-request mutation), D2 work_submit never advertised, minors D3-D6.
Preserved in correction-round2/findings.md; all six fixed in commit 493451e.

## Round 3 (focused): CONFIRM
All six fixes verified by independent execution (live servers, real tokens, restart persistence,
MCP-routed submits, degenerate replay ids). Regression sweep: all five original falsifiers hold;
537/537 workspace tests; traceability exit 0. Two informational observations recorded (seq/db
lockstep path; work_get history window) — neither material. Zero verifier repo mutation.
