# Task Settlement Evidence: T20

## Task Information
- **Task ID**: `T20`
- **Title**: Implement browser proof harness, immutable evidence, and Gauntlet settlement bridge
- **Proof Level**: `P3`
- **Confirmation**: `independent_adversarial` — PENDING (verifier receives source requirements, frozen prereg, implementation, fresh evidence, and the exact confirmation question; builder conclusions are non-authoritative context)
- **Settles**: `REQ-GOAL-004`, `REQ-OUT-003`, `REQ-BIND-010`, `REQ-VERIFY-001`, `REQ-VERIFY-002`, `REQ-VERIFY-005`, `REQ-GAUNTLET-001`, `REQ-GAUNTLET-002`, `REQ-GAUNTLET-003`, `REQ-GAUNTLET-004`, `REQ-GAUNTLET-005`, `REQ-GAUNTLET-006`
- **Timestamp**: 2026-09-16T05:10:00Z
- **Preregistration**: `.agents/preregistrations/gauntlet-game-studio-plan-T20.prereg.yaml` (frozen before implementation and before any evidence evaluation)

## Implementation Overview
1. **Playwright proof harness** (`packages/adapters/src/browser/`):
   - `harness.ts` — `runScenario()` performs ONE fresh observation: loads Playwright through an
     injectable loader (typed `PLAYWRIGHT_UNAVAILABLE` blockage when unavailable — RECOV-004,
     TEETH-T20-003 simulation seam), preflights system Chrome (`/usr/bin/google-chrome`; no browser
     downloads, NO autoplay-policy bypass flags), serves inline scenario HTML over loopback, waits
     for and structurally validates the mounted `__GAUNTLET_STUDIO_OBS__` v1 surface (missing stable
     methods fail there — never DOM fallbacks, preserving the TEETH-T19-001 boundary), drives
     determinism exclusively through the privileged control namespace
     (`resetScenario -> setSeed -> setView -> bounded step -> pause -> settle frames`), then captures
     four channels: semantic state (Koota-backed `entities.snapshot()`), pixels (screenshot of the
     named view after pause/step/render), telemetry (console/page errors + tick consequence),
     network (observed responses + surface read), plus renderer identity (REQ-BIND-010) and optional
     Playwright trace. Observation only — it never interprets expectations.
   - `surface-client.ts` — stable-surface client; every method maps 1:1 to a contract-v1 stable
     method; deliberately NO generic evaluate-for-semantics escape hatch exists.
   - `fixture.ts` — committed deterministic fixture scenario (self-contained page mounting a
     contract-v1-shaped surface; no build step; no Date.now/Math.random). Variants: `fixture-ok`
     (channels agree) and `fixture-wrong-state` (TEETH-T20-001: pixels visually correct and
     byte-identical to the ok variant, authoritative simulated-Koota snapshot deliberately wrong).
   - `types.ts`/`index.ts`; adapters index gained one appended export line. Channel evidence is
     delivered to a sink; the canonical sink lives in the studio evidence store.
2. **Immutable evidence store** (`packages/studio/src/evidence/`):
   - `store.ts` — `EvidenceStore`: canonical `artifacts/runs/<run-id>/` layout (run.json,
     manifest-NN.json, settlement-NN.json, artifacts/*), all records strictly validated against the
     reused contracts schemas (`ObservationRunSchema`, `EvidenceManifestSchema`,
     `SettlementRecordSchema`, `ArtifactRefSchema`). Evidence is IMMUTABLE once written
     (`EvidenceImmutabilityError` on any rewrite attempt); manifests/settlements are append-only with
     unique-ID enforcement, so failed/contradictory evidence is preserved, never overwritten.
     `EvidenceRunWriter` implements the harness `ObservationSink` interface.
   - Freshness/correlation from run/revision IDENTITY, never filenames: `validateFreshness` throws
     `EvidenceStaleError` when a manifest's `project_revision` differs from the expected revision;
     `validateCorrelation` rejects run_id/revision mismatches (`EvidenceCorrelationError`);
     `verifyArtifactsAgainstDir` re-verifies every artifact sha256/size (tamper detection).
   - `checkFixtures()`/`checkFixtureDir()` validate committed fixture directories (schema +
     correlation + artifact hashes + settlement records) including negative controls declared in
     `expected.json` that MUST reject (`stale_revision`, `uncorrelated_manifest`, `schema`) —
     detectors must bite for the check to pass.
   - `revision.ts` — `resolveProjectRevision` (git HEAD, explicit override, typed
     `RevisionUnavailableError` otherwise).
3. **Gauntlet settlement bridge** (`packages/studio/src/gauntlet/`):
   - `expectation.ts` — `FrozenExpectation` (zod, strict): scenario binding, requirement IDs,
     revision (with "current" sentinel), claimed channels, and per-channel constraint blocks; frozen
     BEFORE evidence evaluation (REQ-GAUNTLET-002).
   - `checks.ts` — channel-appropriate evaluation (REQ-GAUNTLET-003): semantic state constraints
     (entity presence/tags/position within tolerance against the Koota snapshot), pixel constraints
     (fresh captures for named views, minimum dimensions), telemetry constraints (console/page error
     ceilings, tick advance), network constraints (response success). Passing channels never mask
     failing ones.
   - `settle.ts` — `settleExpectation()` produces `SettlementRecord`s (schema-validated) classified
     `settled | blocked | failed | incomplete`: stale/uncorrelated -> incomplete (TEETH-T20-002);
     required browser proof unavailable -> blocked, never passed (TEETH-T20-003, RECOV-004); any
     required check failure -> failed with REQ-GAUNTLET-004 classification
     (`insufficiently_represented` / `represented_but_deficient` / `visual_consequence_deficit` /
     `runtime_consequence_deficit` / `network_consequence_deficit`) and cross-channel contradiction
     records (notably `pixels_pass_state_fail` — TEETH-T20-001); missing required confirmation
     prevents settled (`confirmation_required`); provider/build success is structurally not an input.
4. **CLI** (`apps/studio-cli/src/index.ts`): `observe` (deterministic Playwright observation,
   immutable run evidence, structured JSON, exit 0 observed / 2 blocked), `verify <expectation>`
   (fresh observation vs frozen expectation, append-only SettlementRecord, exit 0 settled / 1 failed
   / 2 blocked-incomplete — a blockage can never read as a pass), `evidence check-fixtures` (gate;
   structured JSON, exit 0/1); remaining evidence subcommands stay honest typed placeholders.
5. **Tests + gates**: root `package.json` gained one appended script line
   (`"test:proof-harness": "bun test packages/studio/test/proof && bun run ./packages/studio/test/proof/run-browser-proof.ts"`).
   `packages/studio/test/proof/` contains deterministic browser-free tests (22) covering the three
   teeth at store/settlement layers, plus the real-Chrome gate script (`run-browser-proof.ts`, legs
   A–D). Committed fixtures: `packages/studio/test/proof/expectations/*.json` (frozen expectations)
   and `packages/studio/test/proof/fixtures/run-*` (three evidence fixtures GENERATED FROM REAL
   HARNESS RUNS: valid, contradictory-preserved with its failed settlement record, and the
   stale-revision negative control; artifact hashes re-verified by the gate).

## Verification Evidence
- **Narrow Gates** (fresh runs, exit 0, log: `artifacts/plan/T20/gate.txt`):
  - `bun run test:proof-harness` — 22 unit tests pass (71 expects) + all four browser legs PASS:
    leg A fresh observation settles; leg B TEETH-T20-001 end-to-end ('failed', pixels byte-identical
    between variants, sha256 b0728f1c91d3…); leg C TEETH-T20-003 typed blocked; leg D TEETH-T20-002
    stale rejection + immutability refusal.
  - `bun run studio -- evidence check-fixtures --json` — status success; 3 fixtures: 2 valid +
    1 rejected_as_expected (stale negative control).
  - `studio observe fixture-ok --json` exit 0 (fresh run under `artifacts/runs/`); `studio verify
    fixture-ok --json` exit 0 (decision "settled", all channels pass); `studio verify
    fixture-wrong-state --json` exit 1 (decision "failed", contradiction recorded).
- **Teeth / Falsification Checks**: all three preregistered falsifiers exercised fresh with PASS
  verdicts — `artifacts/plan/T20/teeth.txt`.
- **Global Gates** (fresh runs, exit 0): `just validate-agent-artifacts`, `just check`
  (traceability + topology + `bun x tsc --noEmit` clean), `just test` (260 pass / 0 fail across 36
  files, 2016 expects — includes the 22 new T20 tests), `just lint`.
- **Fresh run evidence at this revision** (append-only, `artifacts/runs/`): settled runs
  (`...T050718Z`), a preserved blocked run (`...T050719Z`, PLAYWRIGHT_UNAVAILABLE, blockage.json
  artifact, settlement decision "blocked"), and preserved failed runs (`run-fixture-wrong-state-...`,
  settlement decision "failed" with the pixels_pass_state_fail contradiction).

## Known limitations (not claimed)
- The committed fixture page is a deterministic stand-in for a real game title (it mounts a
  contract-v1-shaped surface with tiny simulated semantics); it proves the harness/evidence/
  settlement machinery and the preregistered teeth — NOT a real title's gameplay. Real titles mount
  the real T19 bridge; the harness validates whatever surface is mounted against contract v1.
- Performance settlement, quality profiles, and network-mode scenarios are T21+ scope; the network
  channel here captures loopback response success and surface diagnostics only.
- Fixture screenshots are host/Chrome-version-sensitive bytes; `check-fixtures` re-verifies their
  hashes and fails honestly on drift — regenerate with
  `bun run ./packages/studio/test/proof/run-browser-proof.ts --write-fixtures` when Chrome changes.
- Browser legs ran headed (WSLg DISPLAY present); headless is exercised when no display exists.
  Independent adversarial confirmation remains REQUIRED before settlement (P3).
