# Task Settlement Summary: T24

**Task ID**: T24
**Title**: Execute adversarial recovery, security, donor-independence, and environment-removal matrix
**Proof Level**: P3
**Confirmation**: independent_adversarial (frozen preregistration: `.agents/preregistrations/gauntlet-game-studio-plan-T24.prereg.yaml`; verifier verdict pending — builder evidence below makes no settlement claim beyond the captured gates/teeth)
**Status**: GATES+TEETH GREEN (builder evidence; settlement requires independent confirmation)

**Governing requirements**: settles REQ-DONOR-004, REQ-SAFE-001, REQ-SAFE-005, REQ-SEC-002, REQ-SEC-003, VAR-001..VAR-014, RECOV-001..RECOV-008; confirms REQ-DONOR-001/004/005/006, REQ-SAFE-005, REQ-ROUTE-005/006, REQ-SAFE-002, REQ-SKILL-004/005/006, REQ-BLENDER-006/007, REQ-AUDIO-001/002, REQ-SAFE-007.

## What was built

Three root conformance gates (one script each under `scripts/`, one binding each in
root `package.json`; nothing outside scripts/**, package.json gate bindings, and
evidence dirs was modified). Each gate orchestrates the EXISTING settled tests and
CLI surfaces fresh rather than duplicating their logic, emits per-case structured
records (case id, spec ids, action, expected, observed, verdict), and appends them
to append-only JSONL evidence so every failed/corrected round is preserved:

1. `bun run conformance:recovery` → `scripts/conformance-recovery.ts` — executes
   the VAR/RECOV matrix applicable to this environment (23 case rows: 14 VAR +
   8 RECOV + a stale-evidence row; VAR-013 explicitly delegated to
   conformance:clean-checkout, never silently dropped). All children run with the
   nine model-credential env vars deleted (TEETH-T24-002 held everywhere).
2. `bun run conformance:security` → `scripts/conformance-security.ts` — six cases:
   secret-leakage scan over all git-tracked text (source AND committed evidence)
   + studio doctor secret-hygiene; direct path-traversal/unsafe-type probes of the
   T13 intake surface with a pristine-target side-effect assertion; untrusted
   client commands (T12 authority suite + T23 raw-socket teeth, counted
   rejections); donor imports/identity (donor:audit + donor:dependency-scan +
   public-surface branding sweep); production observability mutation absence
   (T19 inspector with both simulated regressions); browser-facing source
   credential hygiene (REQ-SEC-001).
3. `bun run conformance:clean-checkout` → `scripts/conformance-clean-checkout.ts`
   — fresh `git clone --no-hardlinks` of committed HEAD into os.tmpdir() (never
   under repo `.tmp/`), donor genuinely absent throughout (LEG-0/1, plus the
   explicit `rm -rf .tmp/donor` attack), `bun install --frozen-lockfile` and the
   full committed gate set (`just validate-agent-artifacts` / `check` / `test` /
   `lint`), `studio doctor`, donor:audit absent-donor path + donor:dependency-scan,
   reference-game build + deterministic headless scenario verification (9/9), and
   final donor-absence assertion. Checkout is removed on success, preserved on
   failure. All children run credential-stripped.

## VAR/RECOV coverage table (final-round verdicts; evidence: `recovery-cases.jsonl` run `t24-recovery-20260916T234013388Z`, `clean-checkout.jsonl`, `security-cases.jsonl`)

| Case | Verdict | Evidence line (observed) |
|---|---|---|
| VAR-001 reference-image reconstruction routes to img2threejs, provenance preserved, settles after evidence | PASS | `bun test packages/studio/test/capabilities/img2threejs.test.ts` exit 0: 10 pass / 0 fail |
| VAR-002 composition + terrain + navigation routing/verification | PASS | 3dviz suite 13 pass; navigation 6 pass (both exit 0) |
| VAR-003 known CC0 asset reused with provenance + budgets | PASS | polyhaven suite exit 0: 5 pass / 0 fail (incl. typed NETWORK_UNAVAILABLE scoped blockage) |
| VAR-004 Blender escalation with recorded rationale, semantics outside Blender | PASS | blender-process suite exit 0: 5 pass / 0 fail |
| VAR-005 provider fallback explicitly recorded on the same contract; undeclared provider never selected | PASS | router probe `{declared:[audio.tone,audio.null], fallback_pref:audio.null, unlisted_pref_ignored:audio.tone}`; audio-headless 6 pass (Null backend fallback recorded/counted) |
| VAR-006 pixels pass + semantic wrong → semantic channel fails, unsettled | PASS | `studio verify fixture-wrong-state --json` exit 1 (expected 1), `"decision": "failed"` + `pixels_pass_state_fail` |
| VAR-007 semantic+visual pass + degraded performance → telemetry channel fails | PASS | `studio verify --scenario performance-fixture-regress --profile test-budget --json` exit 1 (expected 1), `"decision": "failed"` + `budget_error` |
| VAR-008 accepted agent-skill output verifies with credentials removed, no regeneration | PASS | credential-stripped verify-result subprocess exit 0, status success (TEETH-T14-002 form) |
| VAR-009 asymmetric terrain fixture parity, deliberate defects detected | PASS | terrain-parity exit 0: 5 pass / 0 fail |
| VAR-010 single-player runs with networking disabled | PASS | `teeth:network-disabled` exit 0; single-player network suite 2 pass / 0 fail |
| VAR-011 two local clients vs authoritative headless server, nominal latency | PASS | `test:blackwater-multiplayer` exit 0; `[multiplayer] multiplayer-sync: SETTLED` (+interest-filtering) |
| VAR-012 same scenario under latency/jitter impairment | PASS | same suite exit 0; `[multiplayer] multiplayer-latency: SETTLED` |
| VAR-013 build/test after `.tmp/donor/` deleted | PASS (via clean-checkout gate) | clean-checkout LEG-0/1/3/5/7: donor never exists, explicit rm -rf tolerated, full committed gate set green |
| VAR-014 browser audio locked → real gesture unlocks; headless independent | PASS | `test:audio-browser` exit 0 (raw-CDP un-gestured attack stays locked; trusted click → ready); audio-headless 6 pass (REQ-SAFE-007 degrade) |
| RECOV-001 missing reference → blocked, never text-to-3D | PASS | T14 teeth exit 0: 4 pass / 0 fail (TEETH-T14-001 REFERENCE_REQUIRED, route_preserved) |
| RECOV-002 duplicate Three.js → preflight compatibility failure | PASS | same fresh run (TEETH-T14-003 MULTIPLE_THREE_INSTALLATIONS) |
| RECOV-003 over-budget asset unaccepted; unknown provenance blocks | PASS | assets suite 42 pass / 0 fail (TEETH-T13-001/002); `asset verify --all` exit 0 |
| RECOV-004 required browser verification unavailable → typed blocked, never passed | PASS | proof suite exit 0: 22 pass / 0 fail (TEETH-T20-003 typed blocked) |
| RECOV-005 Rapier/Recast init delayed/failed → not ready, explicit failure, no WASM race | PASS | readiness suite exit 0: 4 pass / 0 fail (TEETH-T07-001 RuntimeNotReadyError + SubsystemBootError) |
| RECOV-006 Blender absent → committed derivatives usable, only scoped regeneration blocked | PASS | `test:blender-absent-build` exit 0, BLENDER_ABSENT_BUILD_OK (legs A-D) |
| RECOV-007 transport disconnect mid-scenario → explicit state, bounded recovery, server authority intact | PASS | `teeth:multiplayer` exit 0 (server-side drop, frozen projection, bounded reconnect); multiplayer-sync disconnect phase SETTLED |
| RECOV-008 donor architecture conflicting with Koota authority rejected | PASS | donor-isolation suite 5 pass / 0 fail; donor:audit exit 0 |
| stale evidence rejected (T20, required minimum) | PASS | `studio evidence check-fixtures --json` exit 0 — stale-revision negative control rejects as declared |

Applicability note (no case silently dropped): all 14 VAR + 8 RECOV cases were
executed fresh; VAR-013 is executed by the clean-checkout gate because donor
absence can only be genuine in a checkout that never contained `.tmp/` (the main
working tree legitimately contains the quarantined donor). The clean-checkout
browser-leg scope choice (deterministic headless path inside the checkout) is
recorded as LEG-6c, never silent; fresh real-browser proof for the same game
content ran in the recovery gate (VAR-006/007/011/012/014 legs over real Chrome).

## Gates (all fresh, exit 0 — see gate.txt)

- `bun run conformance:recovery` — 22 PASS / 0 FAIL / 1 DELEGATED (RECOVERY_MATRIX_OK)
- `bun run conformance:security` — 6 PASS / 0 FAIL (SECURITY_MATRIX_OK)
- `bun run conformance:clean-checkout` — 13 PASS / 0 FAIL (CLEAN_CHECKOUT_OK)
- `just check`, `just test` (339 pass / 0 fail), `just lint`,
  `just validate-agent-artifacts` — all exit 0

## Teeth (all three bite — see teeth.txt)

1. **Delete `.tmp/donor/` entirely in the clean checkout**: the clone never
   contains the donor (strictly stronger than delete-then-run); the explicit
   `rm -rf` was executed and every committed build/test/proof gate ran green in
   that checkout under credential-stripped env, with donor:audit proving the
   absent-donor path and final absence re-asserted.
2. **Remove model credentials and network model access**: all three gates strip
   the nine credential vars from every child; the full committed gate set (clean
   checkout) and the credential-free verify-result of the accepted committed
   agent-skill output both succeeded with no regeneration attempted.
3. **Path-traversal archive or forged network command**: five traversal/unsafe
   inputs typed-rejected UNSAFE_FILE before any byte was written (target proven
   pristine); forged client commands rejected server-side with counted
   rejections (forged_rejected=4, commands_rejected=4) and a byte-identical
   authoritative Koota snapshot across the attack window.

## Corrections made during this round (both rounds preserved, append-only)

1. **VAR-005 router probe failed on first recovery round**
   (`recovery-cases.jsonl` run `t24-recovery-20260916T233741813Z`: "Export named
   'defaultCapabilityRegistry' not found") — the probe imported the registry
   from `router.ts` instead of `capabilities/registry.ts`. Fixed the import;
   re-run green. No acceptance change.
2. **SEC-01 secret scan flagged 1 hit on first security round** —
   `apps/studio-cli/src/cli.test.ts:49` matches an openai-style key pattern; on
   inspection it is the settled T03 secret-hygiene teeth canary (a deliberately
   FAKE key literal in the CLI test, whose purpose is proving the config loader
   rejects and never echoes literal secrets; the literal itself is intentionally
   not reproduced here so this summary cannot trip the scanner). Classified
   against a declared, recorded baseline (exact file + line content + reason);
   every other hit still fails. No weakening: the requirement (no real secrets committed) is
   unchanged and the T03 rejection behavior itself remains verified.
3. **SEC-04 branding sweep flagged 3 hits on first security round** —
   `packages/studio/src/config.ts:99`, `packages/studio/src/doctor.ts:82`
   (donor-dependency DETECTION conditions that must name the donor to reject it)
   and `packages/contracts/src/schemas.ts:41` (STRICT schema doc naming the
   forbidden `mavonGameObject` field class). Classified as boundary-enforcement
   references (deny-list class, per line, recorded in evidence); any branding
   match outside an enforcement context still fails. No weakening: donor
   identity remains confined to provenance/attribution/enforcement surfaces.

## Dependency / scope discipline

- Files created/changed: `scripts/conformance-recovery.ts`,
  `scripts/conformance-security.ts`, `scripts/conformance-clean-checkout.ts`
  (new), root `package.json` (three gate bindings appended),
  `.agents/preregistrations/gauntlet-game-studio-plan-T24.prereg.yaml` (frozen
  before evidence), `artifacts/plan/T24/{gate.txt,teeth.txt,summary.md,
  recovery-cases.jsonl,security-cases.jsonl,clean-checkout.jsonl}`.
- No changes to packages/**, apps/**, examples/** source. No new npm
  dependencies. NO git commits. NO `.agents/CURRENT_STATUS.yml` edits.
  `.tmp/donor` never imported; the clean checkout provably never contained it.
- Reused settled surfaces instead of duplicating: T07 readiness, T09 donor
  gates, T12 network authority, T13 asset gates + safeIntakePath, T14
  verify-result + teeth, T17 audio, T18 blender-absent-build, T19 production
  inspector, T20 proof/fixtures, T21 performance profiles, T22
  network-disabled + headless scenarios, T23 multiplayer suite + teeth.

## Blockers / unknowns

- None blocking. Bounded notes: (a) the clean-checkout browser legs were
  intentionally not run inside the clone (task scope allows the deterministic
  headless path; recorded as LEG-6c, covered fresh in recovery over real
  Chrome); (b) the secret-scan baseline and branding enforcement
  classifications are recorded in evidence and re-verified every run — they
  gate on exact file+line identity (secret baseline on exact line content;
  branding classifications on a per-line heuristic), so drift re-fails the scan;
  (c) VAR-006/007
  intentionally assert FAILING verification decisions (exit 1) as the declared
  safe failure behavior — a regression that made them pass would fail the gate;
  (d) the clean checkout verified committed HEAD; this task's own additive
  files (scripts/package.json bindings) are uncommitted per the no-commit
  constraint and do not touch game/runtime/studio behavior.

## Independent confirmation

REQUIRED before settlement (P3, independent_adversarial). The verifier receives
the source requirements, the frozen preregistration, the implementation, fresh
evidence (`artifacts/plan/T24/`), and the exact confirmation question; builder
conclusions above are non-authoritative context.
