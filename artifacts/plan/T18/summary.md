# Task Settlement Evidence: T18

## Task Information
- **Task ID**: `T18`
- **Title**: Implement Blender escalation and committed derived-asset workflow
- **Proof Level**: `P3`
- **Confirmation**: `independent` — PENDING (verifier receives source requirements, frozen prereg, implementation, fresh evidence, and the exact confirmation question; builder conclusions are non-authoritative context)
- **Settles**: `REQ-BIND-011`, `REQ-BLENDER-001`, `REQ-BLENDER-002`, `REQ-BLENDER-003`, `REQ-BLENDER-004`, `REQ-BLENDER-005`, `REQ-BLENDER-006`, `REQ-BLENDER-007`
- **Timestamp**: 2026-09-16T15:40:00Z
- **Preregistration**: `.agents/preregistrations/gauntlet-game-studio-plan-T18.prereg.yaml` (frozen before implementation and before any evidence evaluation)
- **Environment**: Blender 5.2.2 LTS at `/snap/bin/blender` (snap install, verified working for deterministic `--background --factory-startup` runs with repo file I/O)

## Implementation Overview
1. **Blender DCC escalation adapter** (`packages/adapters/src/dcc/blender/` — the ONLY monorepo code that touches Blender):
   - `preflight.ts` — executable discovery (injectable `which`) + `blender --version` probe recording the version string verbatim ("5.2.2 LTS"); every failure is a typed unavailable, never a throw (REQ-BLENDER-007).
   - `invoke.ts` — the single deterministic invocation form `blender --background --factory-startup --python <script> -- <args>`; captures exact argv, exit code, output tails as `BlenderInvocationRecord` provenance. No GUI, no ad-hoc code injection.
   - `escalation.ts` — REQ-BLENDER-002 rationale validation: a request must record `requested_operation`, a non-trivial `reason`, and ≥1 rejected lighter route before any Blender execution.
   - `authority.ts` — the DCC metadata authority boundary (REQ-BLENDER-005): quest/NPC/gameplay-semantics keys in `.blend`-side metadata produce `BlendSemanticAuthorityError` (`BLEND_SEMANTIC_AUTHORITY_REJECTED`) with per-key findings — rejection, not silent filtering.
   - `pipeline.ts` — orchestrates rationale check → committed source-definition load + authority gate (both BEFORE preflight, so they hold with or without Blender) → preflight → source-rig generation → retarget/bake/export → glTF-Transform normalization → on-disk stat re-derivation. Typed outcomes: `blocked` (BLENDER_UNAVAILABLE / ESCALATION_RATIONALE_REQUIRED / SOURCE_DEFINITION_INVALID / DCC_METADATA_REJECTED), `failed`, `success`.
   - `prepare.ts` / `verify.ts` — capability prepare (provider-exclusive binding, rationale, definition, preflight) and deterministic OFFLINE verify-result (11 re-derived checks; zero Blender, zero network, zero model invocation).
   - `scripts/generate_service_drone_source.py`, `scripts/retarget_bake_service_drone.py` — committed deterministic bpy scripts (Blender 5.2.x layered-action API): build source armature + hover-cycle action from the committed definition; retarget via COPY_TRANSFORMS/COPY_ROTATION constraints per the committed mapping; `bpy.ops.nla.bake` (visual keying, constraints cleared); skinned low-poly mesh parts; GLB export with structural `gw_*` node extras; bake-report JSON with full regeneration metadata.
2. **Service-drone fixture + committed derivative** (`examples/blackwater-relay/`):
   - `assets/dcc/service-drone/service-drone.source.json` — deterministic source rig/animation definition (bones, keyframes, retarget map, bake settings, budgets, benign `dcc_metadata`); the whole chain is reproducible on any host with Blender.
   - `assets/service-drone.glb` — committed accepted derivative: standard glTF 2.0 (sha256 `e0ff0f70…fb98b`, 12,656 bytes, 84 triangles, animation `hover_cycle`, 14 nodes). Byte-identical across repeated full regenerations.
   - `assets/dcc/service-drone/service-drone.bake-report.json` — committed regeneration metadata (Blender version "5.2.2 LTS", constraint types, bake stats, raw-export hash, benign DCC metadata). Also byte-deterministic. The `.blend` intermediate is deliberately NOT hash-pinned: .blend files embed a per-save session UID; the chain OUTPUT is pinned instead (documented in the report and result file).
   - `assets/manifest.json` — `service-drone` AssetRecord: origin `blender`, route `dcc.blender.process`, source hash of the committed definition, budgets (max 2000 triangles / 256 KiB vs measured 84 / 12,656), collider/LOD policy, animation contract as affordance metadata only; append-only intake→accept history. Registry `asset verify --all`: 7/7 accepted.
   - `src/assets/service-drone.ts` + `tests/service-drone.test.ts` — the game consumes ONLY the committed GLB (pure-DataView glTF container validation, zero dependencies, zero Blender) and asserts manifest correlation and metadata purity.
   - `.studio/requests/service-drone-retarget.yaml` / `.studio/results/service-drone-retarget.yaml` — capability request (with full escalation rationale: 4 rejected lighter routes) and accepted CapabilityResult (artifacts hash-pinned, regeneration provenance incl. both real invocation argv records, offline verification declaration).
3. **Capability wiring**: `dcc.blender.process` added to the studio capability catalog (provider `dcc.blender`); `studio capability prepare` and `capability verify-result` file-form handlers in `apps/studio-cli/src/index.ts`; `examples/blackwater-relay/studio.lock.yaml` binds the capability.
4. **Regeneration runner**: `scripts/regenerate-service-drone.ts` — the one committed entry point that executes Blender; runs the adapter pipeline then idempotent AssetRegistry intake/accept (identical inputs skip; drifted inputs fail loudly rather than silently superseding).
5. **Provenance/attribution**: `vendor/attribution.json` gained a `dcc_tooling` class recording Blender 5.2.2 LTS (GPL-2.0-or-later, never shipped/imported/runtime-required; `output_class: blender-derived`); `THIRD_PARTY_NOTICES.md` section 6 documents the class; the 5 required attribution classes are unchanged and `third-party:verify` / `source:verify` stay green.
6. **Teeth 1 gate**: root `package.json` gained one script line — `"test:blender-absent-build": "bun run ./packages/adapters/test/blender/blender-absent-build.ts"`. The runner strips every PATH directory containing a blender executable (env manipulation, no uninstall), then proves: leg A game tests green, leg B game module build green, leg C typed `BLENDER_UNAVAILABLE` regeneration blockage + offline verify-result of the committed derivative in the same stripped environment, leg D donor isolation via the repository-native `donor:dependency-scan`.
7. **Tests** (all `*blender*`-named): `packages/adapters/test/blender/blender-adapter.test.ts` (12: preflight, rationale, authority, argv contract, definition intake), `blender-authority.test.ts` (4: TEETH-T18-002 three rejection layers, runtime layer in its own subprocess to respect Koota's per-process world cap), `blender-pipeline.test.ts` (3: FULL real-Blender chain into a temp project + offline verification of fresh outputs, typed absence blockage, committed definition validity; skips — never fails — when Blender is absent), `packages/studio/test/capabilities/blender-process.test.ts` (5: descriptor/routing, prepare ready/mismatch/rationale/absence). Example project: `tests/service-drone.test.ts` (4).

## Verification Evidence
- **Narrow Gates** (fresh runs, exit 0, log: `artifacts/plan/T18/gate.txt`):
  - `bun run ./scripts/regenerate-service-drone.ts` — real Blender 5.2.2 LTS chain exit 0 (two recorded invocations, 3.2s + 3.5s; glTF-Transform dedup/prune; registry accept).
  - `bun run studio -- capability verify-result dcc.blender.process examples/blackwater-relay/.studio/results/service-drone-retarget.yaml --json` — status success, 11/11 checks PASS, exit 0. Re-derives GLB validity (84 triangles, `hover_cycle`), artifact hashes, budgets, regeneration metadata (Blender 5.2.2 LTS + argv records + committed scripts + source-definition hash), provenance acceptance, and the DCC metadata authority boundary — with NO Blender at verify time.
  - `bun run test:blender-absent-build` — exit 0; all four legs PASS with `/snap/bin` stripped from PATH.
  - `studio capability prepare dcc.blender.process <request>` — ready with Blender present (plan + "5.2.2 LTS"); exit 1 `BLENDER_UNAVAILABLE` (`scoped_to_regeneration: true`) with Blender stripped from PATH.
  - `studio asset verify --project examples/blackwater-relay --all` — 7/7 accepted; `studio capabilities lint` — valid.
- **Teeth / Falsification Checks**: both preregistered falsifiers exercised fresh with PASS verdicts — `artifacts/plan/T18/teeth.txt`.
  - TEETH-T18-001: normal game tests, module build, and donor isolation green with Blender absent from PATH; regeneration reports typed scoped blockage; committed derivative verifies offline in the same environment.
  - TEETH-T18-002: quest/NPC semantic metadata rejected at definition intake (before any Blender run), at offline verify-result (AUTHORITY_BOUNDARY), and the runtime Koota guard still rejects provider objects while benign affordance metadata stays inert.
- **Global Gates** (fresh runs, exit 0): `just check` (traceability + topology + `bun x tsc --noEmit` clean), `just test` (335 pass / 0 fail across 44 files — includes the 24 new blender tests + 4 example service-drone tests), `just lint`, `just validate-agent-artifacts`.
- **Determinism evidence**: two consecutive full regenerations produce byte-identical committed artifacts (GLB `e0ff0f70…`, bake report `fbb072e5…`); the .blend intermediate is documented as not pinned (per-save session UID).

## Known limitations (not claimed)
- The retarget fixture is a low-poly project-owned drone (7 boxes, one hover cycle) built to prove the ROUTE — routing, rationale, bake, normalization, acceptance, offline verification, absence blockage — not Blender's full DCC surface (no UV baking, cloth, or complex skinning).
- The .blend intermediate is regenerable and not committed; its bytes vary per save (session UID). Reproduction claims bind to the committed GLB/bake-report hashes, which are stable.
- Regeneration requires Blender 5.2.x (layered-action API); other versions are untested. The committed derivative itself requires no Blender anywhere.
- The GLB normalization profile ships zero textures; a texture-bearing DCC derivative must supply a real WebP encoder through the pipeline (the adapter fails loudly rather than downgrading).
- `test:blender-absent-build` strips PATH entries containing a blender executable; a host with blender outside PATH would (correctly) also be absent from discovery.
- Independent confirmation remains REQUIRED before settlement (P3).
