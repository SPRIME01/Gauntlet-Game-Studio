# T34/T35 Correction Round 1 — Adversarial REJECT remediation

Independent adversarial verification returned REJECT with two falsifier-level holes plus operability gaps.
Failed evidence preserved verbatim; the verifier's full report is session record. Findings and dispositions:

1. game_replay fabricated "evidence-found" for any id (TEETH-T34-005 violation) — FIXED: replay now consults
   the real evidence store (artifacts/runs) and reports evidence-missing/basis:unavailable when no recorded
   run or settlement matches; evidence-found only with recorded decisions; settles:false always.
2. Closed surfaces did not stay closed (REQ-COCKPIT-004 sentence) — FIXED: WorkspaceState.closedByOwner
   memory; agent surface.put on an owner-closed id refused AUTHORITY_LAYOUT until human.open.
3. Work requests not operable end-to-end — FIXED: work_submit tool added (agent may queue typed requests);
   human.work-review / human.work-cancel handled in core with human authority (accept, or reject → blocked
   with reason recorded); web terminal Accept/Reject now route through the human channel; end-to-end loop
   test added (submit → acknowledged → running → produced → ready_for_review → owner accepted).
4. No-op stubs reporting fabricated effects (view.place/view.size/human.size/human.layout-restore) — FIXED:
   real placement records in WorkspaceState.placements; human.size validates (0,1) and records; layout-restore
   resets placement state for real.
5. Recorded, not fixed in this round (gray-zone or web-static, per the verifier's own classification):
   pinned-surface content rewriting (spec-ambiguous; in-place replacement is mandated by the same sentence),
   viewport target free-string (sandbox mitigations + loopback; requires product decision), source-binding
   depth in the web client (server grammar is bounded; client binding is T35 surface work), partial
   agent-supplied badging, static rail content fields, WebMCP boot-time refresh. Each is carried into T37's
   remaining-gaps list honestly.
