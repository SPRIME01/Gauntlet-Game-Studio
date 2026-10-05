# T33 — Professional Quality Bar, Derived Game Case, Target Release Matrix

Settled: 2026-10-04. Confirmation: peer (P2).

## What was built

- **quality_bar Game Model section** (contracts): project-declared criteria across the seven dimensions
  (player-feel, visual, world, audio, ux, technical, release), each with requirement, evidence_refs,
  optional not_applicable_reason, optional target. No numeric score exists anywhere (REQ-QUAL-001).
- **evaluateQualityBar** (packages/studio/src/quality/bar.ts): pure derivation to pass/attention/fail/unknown/
  not-applicable. Pass requires fresh settled evidence explicitly linked via evidence_refs; stale evidence →
  attention with re-derive reason; contradicted evidence → attention; fail from failing evidence; unknown
  stays unknown; not-applicable only with declared reason. A model without a declared bar is an error —
  quality is never assumed (REQ-QUAL-002).
- **deriveReleaseMatrix**: target-by-target matrix over 15 dimensions; per-target independent settlement
  (evidence matched by target AND dimension; one target passing never settles another); declared
  not-applicable dimensions carry reasons; software-rendered/non-target evidence can never contribute a
  pass and yields the blocked state with an honest reason (REQ-RELEASE-003). Target-specific quality
  profiles bind through the existing game-owned quality profile architecture (REQ-RELEASE-002).
- **deriveGameCase** (packages/studio/src/case/case.ts): pure, stored-nowhere derivation answering
  destination/current/material deviation/primary move/why/cost/authority/recovery/expected evidence/opens/
  alternatives/blocked/settlement reachability (REQ-CASE-001). Leverage ordering implemented per
  REQ-CASE-002 (release blockers 1, contradictions 1, evidence gathering 2, stale re-derivation 3,
  resource leverage 4, uncertainty 5, quality gap 7); blocked moves live only in the blocked lane with
  named blockers; contradictions rank first among interrupts; the release verdict is never decided
  (REQ-CASE-003 — the settlement note names the owner).
- **CLI**: `studio quality bar`, `studio release matrix`, `studio case` — fed from the real project files
  (model, settlements under artifacts/runs, studio config production targets). A project without a declared
  quality bar fails loudly rather than assuming one.

## Gate results

- bun test full workspace: 496 pass / 0 fail (14 case/quality/release tests).
- bun x tsc --noEmit: exit 0.
- Live CLI demonstration on a quality-bar project: destination from model, pass with evidence, unknown
  without, primary move = gather missing web evidence, release matrix web=unsettled.

## Teeth outcomes

- Pass without evidence impossible (derivation never emits pass with empty evidence list).
- SwiftShader-tagged evidence yields blocked, not pass, on a hardware dimension (verified after the
  non-target-exclusion fix).
- Web settled never changes the android row (independent per-target derivation).
- Blocked moves never appear as primary/alternatives; blocked_by names the concrete blockers.
- No "verdict" field anywhere in the Game Case output.
