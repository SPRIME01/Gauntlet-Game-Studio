# Verifier report (abbreviated to the decision-bearing content)

VERDICT: REJECT — REQ-RES-003 is not settled: the reservoir intake/acceptance path (put + markAccepted)
applies no accepted-license-set or unknown-license rejection, and the resolver's R1 reuse check never
re-examines the record's license or require_license, so a cc-by-nc-4.0 or unknown-licensed resource becomes
accepted and resolves as production-reusable (confirmed by executed attack), refuting the prereg claim that
"unknown licenses are unusable"; all four prereg falsifiers otherwise reproduce as preregistered and the
declared gates pass.

Prereg falsifier results: TEETH-T30-001 PASS, TEETH-T30-002 PASS (provider path; reservoir path defeated
it — H1), TEETH-T30-003 PASS (recording function; resolver intake unguarded — H3), TEETH-T30-004 PASS
(dedupe caveat H9). Declared gates pass; traceability exit 0. Full detail in the session transcript.
