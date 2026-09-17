# T24 Independent Adversarial Confirmation Record

- **Confirmation mode**: independent_adversarial (per plan T24 preregistration)
- **Confirmed at**: 2026-09-16 (fresh verifier session at revision 1c82840; builder conclusions not treated as authority)
- **Required verdict**: CONFIRM
- **Actual verdict**: **CONFIRM**
- **Scope**: settles REQ-DONOR-004, REQ-SAFE-001, REQ-SAFE-005, REQ-SEC-002, REQ-SEC-003; executes VAR-001..VAR-014, RECOV-001..RECOV-008

## Gates reproduced fresh (verifier's own runs, exit 0)
- `bun run conformance:recovery` — 22 PASS / 0 FAIL / 1 delegated (VAR-013 → clean-checkout gate, justified and executed)
- `bun run conformance:security` — 6 PASS / 0 FAIL
- `bun run conformance:clean-checkout` — 13 PASS / 0 FAIL
- `just check`, `just test` (339/339), `just lint`, `just validate-agent-artifacts`

## Adversarial findings (all attacks rejected)
1. Matrix integrity: all 14 VAR + 8 RECOV cases map exactly once to executed verdicts in the append-only JSONL
   plus a stale-evidence row; the VAR-013 delegation is the strictly stronger form (donor never existed in the
   clone + explicit rm). Verifier spot-reran 4 underlying suites: 19/19.
2. Clean-checkout honesty: verifier's own `git clone --no-hardlinks` of committed HEAD into /tmp — `.tmp/` never
   existed; frozen-lockfile install + full committed gate set + doctor + donor scans + Blackwater build + 9/9
   game tests green under credential-stripped env. The committed script has no shortcuts (every leg cwd-bound to
   the clone).
3. Injection reality: readiness tests drive booting→failed with typed errors; the browser-proof case throws
   through the real loader seam to a typed blocked; the budget case injects a real 42,000-vs-5,000 triangle
   overflow. Cases key on typed failing observables — regression would fail them.
4. Security reality: verifier's own 10-vector path-traversal probe (incl. null-byte, percent-encoding) — zero
   bytes escaped the base; 9 novel forged-command vectors — `commands_processed: 0` with authority byte-unchanged
   and session alive; a broader 20-pattern secret scan over 1,076 files found only the declared T03 canary,
   exact-content-gated.
5. Correction preservation: both mid-round corrections (recovery VAR-005 import fix; security SEC-01/SEC-04 first
   rounds) recorded append-only with both rounds in the JSONL; no acceptance narrowed anywhere.

## Prereg discipline
Prereg frozen (status: frozen; mtime before all evidence). All three falsifiers reproduced fresh.

## Minor findings → resolved in hygiene round 1 (artifacts/plan/T24/hygiene-round1.md)
1. summary.md's "exact line content" phrasing for branding classifications corrected (per-line heuristic; the
   secret baseline IS exact-content).
2. The summary no longer reproduces the canary literal, preventing a fails-closed SEC-01 self-trip once the
   evidence is committed.
3. Null-byte intake hardening in safeIntakePath (defense in depth; Node fs already refused such names).
All gates rerun green after the hygiene round (hygiene-gate.txt).
