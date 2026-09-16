# Task Settlement Evidence: T14

## Task Information
- **Task ID**: `T14`
- **Title**: Integrate img2threejs reference-reconstruction handoff and deterministic fixture verification
- **Proof Level**: `P3`
- **Confirmation**: `independent` — PENDING (the independent verifier receives the source requirements, this frozen preregistration, the implementation, fresh evidence, and the exact confirmation question; builder conclusions are non-authoritative context)
- **Settles**: `REQ-BIND-006`, `REQ-ASSET-001`, `REQ-ASSET-002`, `REQ-ASSET-004`
- **Timestamp**: 2026-09-16T04:05:00Z
- **Preregistration**: `.agents/preregistrations/gauntlet-game-studio-plan-T14.prereg.yaml` (frozen 2026-09-16T03:22:11Z, before implementation and before any evidence evaluation)

## Implementation Overview
1. **Capability/provider binding** (`packages/studio/src/capabilities/catalog.ts`): one appended entry
   `asset.reconstruct.reference-image` — positive triggers require a specific depicted object/character WITH
   suitable reference imagery; negative affordances reject generic text-to-3D, scene/world-environment
   composition, terrain, and navmesh; provider `agent-skill.img2threejs`; `requires_user_reference: true`.
   (Coexistence note: the concurrent T15 builder appended `world.environment.compose` to the same file; both
   entries are present and the `capabilities lint` surface remains valid.)
2. **img2threejs adapter module** (`packages/adapters/src/agent-skills/img2threejs/`, new):
   - `handoff.ts` — AgentHandoff normalization: validates reference imagery on disk (existence, type, size,
     sha256), records provenance class + license with `reference_only: true` (REQ-ASSET-004), and blocks with
     typed codes (`REFERENCE_REQUIRED`, `REFERENCE_INVALID`, `PROVIDER_MISMATCH`, `SKILL_CONTENT_MISSING`) and
     explicit `allowed_next_steps` (user-supplied preferred per REQ-ASSET-001, then project-owned/authorized
     per REQ-ASSET-002). The ready handoff points the coding agent at the PINNED vendor skill content
     (`vendor/skills/img2threejs/metadata.json`, id/version/license verified). Creating a handoff never
     reports capability success.
   - `verify-result.ts` — deterministic offline verification pipeline (13 checks): result schema, request
     correlation (sibling `../requests/<name>.yaml`), provider binding, artifact integrity (sha256),
     module syntax (Bun transpiler), import hygiene (`three` only; no network APIs; no `@gauntlet/*`/`koota`
     gameplay-state imports), single standard Three.js resolution guard, staged runtime import +
     structural instantiation, semantic-affordance existence, reference-comparison recomputation, budget
     recomputation, offline declaration, reference-only provenance class (REQ-ASSET-004).
   - `three-resolution.ts` — compatibility guard extending the T06 single-Three check with on-disk
     resolution: scans candidate roots for `node_modules/three`, dedupes by realpath (Bun store symlinks
     collapse to one physical installation), compares normalized pinned versions; a second distinct
     installation fails `MULTIPLE_THREE_INSTALLATIONS`.
   - `module-contract.ts` — procedural-module contract (`gauntlet.asset.procedural_module`): metadata export
     convention, import scan (type-only detection, network/gameplay deny-lists), staged runtime import via a
     temp `node_modules/three` symlink to the pinned installation, headless instantiation (no renderer/DOM),
     triangle counting, front-projected barycentric silhouette sampling, 8x8 occupancy grids, and IoU.
   - `png.ts` — dependency-free PNG decoder (8-bit gray/RGB/RGBA/palette, filters 0-4, node:zlib).
   - No model invocation and no network access anywhere in the module (no network imports, no credential
     reads; fetch/WebSocket/etc. appear only as deny-list pattern literals).
3. **CLI wiring** (`apps/studio-cli/src/index.ts`): the T15 builder's file-form `capability prepare|verify-result
   <capability-id> <file.yaml>` was extended with the reference-image hooks — prepare blocks/asks when the
   reference is missing/invalid (exit 1, `status: blocked`, `route_preserved`, `degraded_to_generic_text_to_3d:
   false`) and on success attaches the normalized handoff + validated reference evidence; verify-result runs
   the deterministic pipeline (exit 0 only when all checks pass). `capability accept` gained a file form
   (`accept <handoff.json> <artifacts.json>`); legacy JSON-string forms are preserved. Project root is derived
   from the `.studio/` parent; repo root by walking to the workspaces `package.json`.
4. **Interactive handoff lifecycle** (recorded under `examples/blackwater-relay/.studio/`):
   - `requests/transceiver.yaml` — CapabilityRequest (intent, acceptance, reference spec with honest
     provenance class `project-generated-reference-fixture` / license `in-house-generated`, budget, threshold).
   - `requests/transceiver.handoff.json` + `requests/transceiver.artifacts.json` — the exact handoff produced
     by `capability prepare` (pinned skill ref, validated reference sha256) and the artifacts committed.
   - `results/transceiver.yaml` — CapabilityResult from `capability accept` (settleAgentHandoff; premature
     settlement without artifacts throws) enriched with the run's recorded evidence (recorded similarity,
     budget measurement, affordances, offline declarations).
   - Acting as the coding agent fulfilling the handoff: authored `src/assets/field-transceiver.ts` — a
     procedural Three.js module (body/panel/mast/cap/feet, sockets `socket-power`/`socket-antenna`, collider
     declaration node `collider-body`) importing only `three`, exporting `ASSET_MODULE_META` with structural
     affordances and reference evidence.
5. **Asset Registry** (`examples/blackwater-relay/assets/manifest.json`): the reference image is registered
   via `registerReference` (reference-only provenance class, distinct from production records — REQ-ASSET-004)
   and the transceiver was intake'd + accepted via the T13 AssetRegistry (`accepted`, production-acceptable:
   provenance/collider/LOD/budget gates pass; `asset verify --all --project examples/blackwater-relay` exits 0
   with 6/6 assets acceptable).
6. **Reference fixture** (`examples/blackwater-relay/references/field-transceiver/`): `generate.ts`
   deterministically regenerates the committed 96x64 grayscale `reference.png` (byte-identical reruns; zlib
   level 9, no timestamps). Provenance recorded honestly as a project-generated stand-in for a user-supplied
   image; reference-only, never shipped content.

## Verification Evidence
- **Narrow Gates** (fresh runs, exit 0) — `artifacts/plan/T14/gate.txt`:
  - `bun run studio -- capability prepare asset.reconstruct.reference-image examples/blackwater-relay/.studio/requests/transceiver.yaml --json`
    → routed, provider `agent-skill.img2threejs`, handoff pinned to `vendor/skills/img2threejs/metadata.json`,
    reference validated (sha256 `b615ea17...`, provenance class recorded).
  - `bun run studio -- capability verify-result asset.reconstruct.reference-image examples/blackwater-relay/.studio/results/transceiver.yaml --json`
    → all 13 checks PASS, including recomputed silhouette IoU 0.8696 ≥ 0.5 (recorded evidence consistent),
    128 recomputed triangles ≤ 2000 budget, runtime import against pinned three@0.170.0.
  - Credential-stripped env rerun (`env -u OPENAI_API_KEY -u ANTHROPIC_API_KEY -u HUGGINGFACE_API_KEY -u HF_TOKEN ...`)
    → exit 0, `model_invocation: none`, `network_access: none`.
- **Teeth / Falsification Checks** (fresh runs, PASS) — `artifacts/plan/T14/teeth.txt`; tests in
  `packages/studio/test/capabilities/teeth.test.ts` (4 pass / 0 fail):
  - TEETH-T14-001: requests with the reference removed (absent block or nonexistent file) block with exit 1,
    `REFERENCE_REQUIRED`, `allowed_next_steps` naming user-supplied/project-owned options,
    `route_preserved`, `degraded_to_generic_text_to_3d: false` — never silently generic text-to-3D.
  - TEETH-T14-002: all 9 model-credential env vars deleted + `globalThis.fetch` poisoned to throw → full
    pipeline passes with 0 network attempts and byte-identical module (no regeneration); CLI subprocess with
    credential-stripped env exits 0.
  - TEETH-T14-003: forged second `node_modules/three@0.999.9-private` installation → guard fails
    `MULTIPLE_THREE_INSTALLATIONS` at unit level and through the full verify pipeline.
- **Tests**: `packages/studio/test/capabilities/` — 27 pass / 0 fail, 127 expects, 3 files
  (`img2threejs.test.ts` positive-path settlement, `teeth.test.ts` preregistered falsifiers).
- **Global Gates**: `just check` exit 0; `just lint` exit 0; `just validate-agent-artifacts` exit 0;
  `bun test packages/studio` 95 pass / 0 fail. `just test` (whole-repo) currently reports 233 pass / 2 fail on
  the SHARED IN-FLIGHT tree (5 fail earlier in the session; concurrent builders are actively converging) —
  see "Known issues / blockers" below; the failures are T14-independent (proven by exclusion, isolation, and
  committed-HEAD worktree runs recorded in gate.txt).

## Known issues / blockers (recorded, not attributed to T14)
- `just test` on the current shared tree fails in `packages/runtime/test/authority.test.ts` ("Headless
  Parity") and `packages/runtime/test/network/single-player.test.ts` (TEETH-T12-003) with "Koota: Too many
  worlds created. The maximum is 16." — a cumulative process-global Koota world-id exhaustion introduced by
  other builders' in-flight uncommitted test files (T15 `packages/adapters/test/vfx-quarks.test.ts`, T17
  audio/observability/ui tests). The failure count dropped from 5 to 2 during this task's session as those
  builders converge. Evidence of T14-independence: (1) excluding `packages/studio/test/capabilities`
  reproduces the same failures; (2) the failing runtime files pass in isolation (5/5 and 29/29); (3) a
  detached worktree at committed HEAD 247afa0 runs the full suite green (184/184). T14 adds zero Koota
  worlds. This blocker must be resolved by the owners of the in-flight files (world reuse/disposal) or a
  suite-level isolation decision; it is not fixable within T14 scope.
- Console noise ("Particle system powered by three.quarks.") precedes `--json` output of CLI commands because
  `@gauntlet/adapters` index transitively imports the T15 vfx module at import time; JSON consumers must skip
  to the first `{`. Recorded as an integration nit for the T15 owner; not changed here to avoid cross-task
  interference.

## Known limitations (not claimed)
- The reference-comparison method (8x8 silhouette occupancy IoU over the front projection) is a deliberately
  coarse deterministic stand-in for perceptual similarity; it proves committed-evidence recomputability, not
  visual fidelity. Stronger similarity metrics can be added behind the same evidence contract.
- `reference.png` is a project-generated fixture standing in for a user-supplied image; its provenance class
  is recorded honestly (`project-generated-reference-fixture`, license `in-house-generated`) and it is
  registered reference-only, never shippable as production content (enforced by the registry and the
  verify pipeline).
- Budget verification deterministically recomputes triangle counts; other budget dimensions (texture memory,
  draw calls) are accepted by the request schema but not yet recomputable offline.
- The example project's own `node_modules` is only partially materialized by concurrent work; runtime proof of
  the accepted module is performed against the single pinned installation via the guard's staged resolution.

## Scope Notes
- `packages/studio/src/capabilities/catalog.ts`: exactly one appended entry (T15's concurrent entry also
  present; both lint-clean). `packages/studio/src/router/router.test.ts`: the brittle "exactly 13 capabilities"
  count was made monotonic (≥13 + explicit ids) because the normative catalog grows only by plan settlement.
- `packages/adapters/src/index.ts`: one appended export line (`./agent-skills`). Adapters gains no dependency
  on studio (circular-free); the guard re-implements manifest reading natively over contracts + node builtins.
- `apps/studio-cli/src/index.ts`: file-form capability prepare/accept/verify-result hooks for the
  reference-image route + project/repo-root helpers. `apps/studio-cli/package.json`: `@gauntlet/adapters`
  workspace dependency (shared with the T15 builder's identical edit).
- `examples/blackwater-relay/`: `.studio/requests|results` lifecycle files, `references/field-transceiver/`
  fixture + generator, `src/assets/field-transceiver.ts`, accepted AssetRecord + reference entry in
  `assets/manifest.json`, one appended lock binding in `studio.lock.yaml`. No world/environment files were
  created (T15 scope).
- No git commits; no `.agents/CURRENT_STATUS.yml` edits; no root `package.json` edits (observed root
  modifications belong to concurrent builders); no new external dependencies; `.tmp/donor` never imported.
