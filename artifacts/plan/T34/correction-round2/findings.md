# T34/T35 Correction Round 2 — second adversarial REJECT remediation

Re-verification (post round 1) confirmed fixes 1/2/4 and all five original falsifiers, and REJECTED on
two defects in the work lifecycle plus four minors. All six fixed in this round; each with a regression test:

- D1 (integrity): work_submit seq aliasing from the third submit (position-based seq over a
  newest-first list) causing demonstrated wrong-request mutation — FIXED: seq = MAX(seq)+1 over the
  whole work list; regression test runs the exact three-submit scenario and asserts fresh seqs, correct
  cancel target, no duplicate seq rows.
- D2 (discovery): work_submit never advertised — FIXED: added to the always-on active set (the work line
  is a persistent surface, not context-gated); test asserts presence on /api/boot and /mcp tools/list.
- D3: work_update refusals now carry the tool contract shape {ok:false,error:{code,message}}.
- D4: work_request rows record the initial queued step durably and the true submitter (agent-on-behalf
  recorded as agent); tests assert history[0] = queued/by:agent.
- D5: game_replay with a degenerate id (empty needle) matches nothing → evidence-missing; over-matching
  fixed; test asserts degenerate id does not list unrelated runs.
- D6: .gitignore mangled by the earlier cockpit rule — restored the .zcodeignore rule and added .cockpit/
  correctly; verified with git check-ignore.

Residual recorded (not a fix claim): agent view.size returns ok while recording nothing (placement sizes
come from view.place / human.size); verifier classified it a residual of claim 4, now recorded here as a
known limitation of the agent size op.
