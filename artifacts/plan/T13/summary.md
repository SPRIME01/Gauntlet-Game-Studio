# Task Settlement Evidence: T13

## Task Information
- **Task ID**: `T13`
- **Title**: Implement Asset Registry, provenance gates, source intake, and glTF compiler
- **Proof Level**: `P2`
- **Confirmation**: `peer` — pending (builder evidence recorded in `gate.txt` and `teeth.txt`; peer confirmation not performed by the builder)
- **Settles**: `REQ-OUT-002`, `REQ-ASSET-003`, `REQ-ASSET-005`, `REQ-ASSET-006`, `REQ-ASSET-007`, `REQ-BIND-008`, `REQ-SAFE-003`, `REQ-SEC-004`
- **Timestamp**: 2026-09-16T02:40:00Z
- **Preregistration**: `.agents/preregistrations/gauntlet-game-studio-plan-T13.prereg.yaml` (frozen before implementation/evidence evaluation)

## Implementation Overview
1. **Project-local Asset Registry** (`packages/studio/src/assets/registry.ts`):
   - Storage/API strictly over the frozen `AssetRecord` contract (`@gauntlet/contracts`);
     manifest schema `gauntlet.asset.manifest` 1.0 (`records` + append-only `history`
     + distinct `references`) at `<projectRoot>/assets/manifest.json`, matching the
     T05 game template; atomic save (temp file + rename) protects accepted assets
     and prior evidence (REQ-SAFE-001).
   - Intake validation per origin class (`user | project | cc0 | licensed | generated |
     blender | procedural`): required license/authorization, source URI/reference,
     author/attribution, retrieval metadata, and 64-hex sha256 source hash per class
     (REQ-ASSET-003, REQ-SEC-004). Unknown/unacceptable license states are recorded
     in a `blocked` state with preserved violation evidence — never dropped, never
     accepted.
   - Acceptance state machine `pending | accepted | rejected | blocked | degraded`:
     `accept()` runs all gates; budget-only failure requires an explicit recorded
     waiver (author + reason + gate) producing a visibly `degraded` state; any other
     failure rejects; blocked-class failures (unknown provenance, prohibited texture
     downgrade) block.
   - Reference-only imagery is a distinct provenance class (`references` list) that
     can never become production content (REQ-ASSET-004); user-provided references,
     shipped source assets, and external sourced assets remain distinguishable.
   - Supersession preserves the predecessor, links it to the successor, and keeps
     the full accept → supersede → replace chain reconstructable (REQ-ASSET-007).
   - Release/asset check `verifyAll()`: fails on unknown provenance, missing
     collider/LOD policy where required by role policy, budget failure/unmeasured
     limits, and any accepted asset failing current gates (REQ-OUT-002, REQ-ASSET-006).
2. **Acceptance gates** (`packages/studio/src/assets/gates.ts`): pure evaluation
   functions — provenance, collider/LOD policy (role-pattern policy, default
   `hero|vehicle|character|weapon|prop` for colliders; `+environment` for LODs),
   budget limits with mandatory `measured_*` counterparts, and texture-format gate
   binding compiler results to registry acceptance (KTX2-required profile achieved
   as WebP is BLOCKED; silent downgrade prohibited; KTX2 acceptance requires
   recorded `toktx_preflight: pass`) (REQ-BIND-008, REQ-ASSET-006).
3. **glTF-Transform compiler adapter** (`packages/adapters/src/assets/gltf.ts`):
   - WebP is the portable baseline texture path (default when a profile omits the
     format); KTX2 is optional, profile-specific, and gated on a toktx preflight —
     with toktx unavailable the pipeline returns typed `blocked/TOKTX_UNAVAILABLE`
     and writes no output; a declared texture format without an encoder returns
     typed `blocked/TEXTURE_ENCODER_UNAVAILABLE` instead of copying through
     (REQ-BIND-008, REQ-SAFE-002).
   - Real pipeline on real GLB documents via `@gltf-transform/core` 4.5.0 +
     `dedup()`/`prune()` transforms and a pluggable texture encoder; verified that
     dedup genuinely merges duplicate textures in-memory.
4. **Poly Haven CC0 source adapter** (`packages/adapters/src/assets/polyhaven.ts`):
   - HTTP intake with provenance capture (source URI, CC0 license from metadata,
     author, sha256 of every written byte, retrieval timestamp), producing a
     `pending` AssetRecord — acceptance authority stays with the registry
     (REQ-ASSET-003, REQ-ASSET-005).
   - Network unavailability degrades to typed `blocked/NETWORK_UNAVAILABLE`; 404 →
     `ASSET_NOT_FOUND`; server errors → `REMOTE_ERROR`; nothing is written on
     failure (REQ-SAFE-002).
   - Path safety (REQ-SEC-002): intake files constrained under
     `<projectRoot>/assets/sources/polyhaven/<id>/`, traversal rejected, unsafe
     file types rejected before any write.
   - Tests use injected fetchers/fixtures; no test touches the real network.
5. **CLI** (`apps/studio-cli/src/index.ts`): `studio asset verify --all [--json]
   [--project <path>]` implemented over the registry with stable exit codes
   (0 = pass/vacuous, 1 = verification failures, 2 = explicit-project manifest
   missing); other `asset` subcommands remain typed placeholders gated on
   T14/T15/T18. `packages/studio/test/assets/fixtures/fixture-project/` provides a
   committed fixture registry (1 accepted, 1 degraded-by-recorded-waiver, 1 clean
   pending, plus a reference-only entry) so the command has real evidence to verify.

## Dependency changes
- `packages/adapters/package.json`: added `@gltf-transform/core` 4.5.0 (pinned exact),
  `@gltf-transform/functions` 4.5.0 (pinned exact); `bun install` run (22 packages).
- `packages/studio/package.json`: added `@gauntlet/adapters` `workspace:*` as
  devDependency so the declared gate suite (`packages/studio/test/assets`) can
  exercise the adapters under Bun's isolated linker.
- `packages/studio/src/index.ts` and `packages/adapters/src/index.ts`: append-only
  barrel exports of the new assets modules.

## Verification Evidence
- **Narrow Gates** (fresh, exit 0; `artifacts/plan/T13/gate.txt`):
  - `bun test packages/studio/test/assets` — 42 pass / 0 fail, 181 expect calls.
  - `bun run studio -- asset verify --all --json` — exit 0 (no registry at repo
    root: explicit vacuous pass with diagnostics).
  - Same command with `--project packages/studio/test/assets/fixtures/fixture-project`
    — exit 0, totals: total 3, accepted 1, degraded 1 (waiver recorded), pending 1,
    not_acceptable 0.
- **Teeth / Falsification Checks**: both preregistered falsifiers exercised and
  passing at test level and CLI level — `artifacts/plan/T13/teeth.txt`.
  - TEETH-T13-001 (unknown/unacceptable license → production acceptance blocked): PASS.
  - TEETH-T13-002 (over-budget asset cannot be silently accepted; rejected or
    explicit recorded waiver → degraded): PASS.
  - Related REQ-BIND-008 falsification (KTX2 profile without toktx → typed blocked,
    no downgraded output written): PASS.
- **Global Gates** (final run, all exit 0 — see `gate.txt` for both the interim and
  final windows):
  - `just validate-agent-artifacts` — exit 0. `just lint` — exit 0.
  - `just check` — exit 0 (`bun x tsc --noEmit`, zero errors repo-wide).
  - `just test` — exit 0: 184 pass / 0 fail across 27 files (includes every
    T13 suite and the full workspace).
  - Interim note preserved honestly: during an earlier evidence window, global
    `just check`/`just test` failures were confined to `packages/runtime/src/network/*`
    (T12 in-flight work by a concurrent agent); T12 landed its fixes during a bounded
    retry and the final gate run is fully green. Zero failures were ever attributable
    to T13 files at any point.

## Scope Notes
- Peer confirmation (`confirmation: peer`) has NOT been performed by the builder;
  per the plan, T13 settlement requires that declared confirmation mode to pass on
  fresh evidence.
- The builder did not modify: `.agents/CURRENT_STATUS.yml`, root `package.json`,
  `packages/runtime/**`, `packages/contracts/**`, or `.tmp/donor` (never imported).
- T12 ran concurrently in this session; its in-flight state temporarily broke the
  repo-wide gates during one evidence window (mechanically confined to T12-owned
  files, proven in `gate.txt`), and the final recorded gate run is fully green.
