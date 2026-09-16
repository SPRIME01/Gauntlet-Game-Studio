# Task Settlement Evidence: T15

## Task Information
- **Task ID**: `T15`
- **Title**: Integrate 3dviz world-composition handoff with terrain/navigation composition
- **Proof Level**: `P2`
- **Confirmation**: `builder_with_teeth` — this record was produced by the task builder exercising the declared teeth; per plan, settlement additionally requires the declared confirmation mode to be satisfied on fresh evidence.
- **Settles**: `REQ-BIND-005` ("The preferred environment-composition agent skill is 3dviz-pro-max")
- **Timestamp**: 2026-09-16T03:55:00Z
- **Preregistration**: `.agents/preregistrations/gauntlet-game-studio-plan-T15.prereg.yaml` (frozen 2026-09-16T03:23:13Z, before implementation and before any evidence evaluation; falsifiers are exactly the plan's two teeth; confirmation mode builder_with_teeth)

## Implementation Overview
1. **Capability/provider binding** (`packages/studio/src/capabilities/catalog.ts`, one appended entry):
   - `world.environment.compose` — positive triggers: scene/world composition, environment
     construction, architecture placement, vegetation scatter, lighting and atmosphere;
     negative affordances: no specific depicted-object reconstruction, no terrain elevation
     authority/heightfield generation, no navigation authority/navmesh production;
     provider `agent-skill.3dviz`; outputs are composition metadata forms (placements,
     sockets, colliders, scatter, lighting/atmosphere), verified deterministically.
     Passes the T16 skill-surface lint with zero issues; catalog edits by the concurrent T14
     builder (`asset.reconstruct.reference-image`) coexist cleanly.
2. **3dviz adapter module** (`packages/adapters/src/agent-skills/3dviz/` — `types.ts`,
   `verify.ts`, `index.ts`; exported from `packages/adapters`):
   - `normalizeWorldCompositionOutput`: normalizes raw 3dviz agent output (world kits,
     sockets, colliders, scatter, lighting/atmosphere) into project/runtime forms with an
     explicit `terrain_authority` (mode `canonical_heightfield_reference`, capability
     `world.terrain`) and `navigation_derivation` (mode `runtime_derived`, capability
     `world.navigation`).
   - Authority boundaries enforced during normalization (REQ-BIND-005, AGENTS.md §5/§6):
     specific depicted-object reconstruction -> `WorldCompositionAuthorityError`
     (violation `object_reconstruction`, redirect `asset.reconstruct`); embedded terrain
     elevation / heightfield / terrain-mesh authority -> violation `terrain_authority`;
     embedded navmesh/physics authority -> violation `navigation_authority`; sockets must be
     terrain-socked with `height_source: canonical_heightfield`.
   - `verifyWorldCompositionResultDocument` / `verifyWorldCompositionResultFile`: DETERMINISTIC
     result verification with NO model credentials and NO network/model invocation. 17 checks:
     document schema + capability binding; handoff lifecycle record (request_id, skill 3dviz,
     confined instructions_ref, acceptance); strict `@gauntlet/contracts` CapabilityResult
     envelope, provider binding, settled status with committed artifacts; request-id
     consistency; canonical terrain reference; downstream navigation derivation; deep-scan
     rejection of embedded competing authority keys; reconstruction-route rejection; Asset
     Registry provenance binding (every referenced asset a settled accepted/degraded
     `AssetRecord` in the project manifest, construction routes not reconstruction); socket
     canonical socking; deterministic seeded/bounded scatter; credential-shaped-key scan.
3. **CLI file-based capability lifecycle** (`apps/studio-cli/src/index.ts` + dependency
   declaration `@gauntlet/adapters` in `apps/studio-cli/package.json`):
   - `capability prepare <capability-id> <request-file.(yaml|json)>` validates the request
     against the strict CapabilityRequest schema, asserts capability-id match, enforces the
     reconstruction routing boundary for this capability, then routes through the
     capability-first router (AgentHandoff produced for agent-skill providers).
   - `capability verify-result <capability-id> <result-file.(yaml|json)>` performs
     capability-specific deterministic verification (`world.environment.compose` ->
     3dviz verifier; other capabilities explicitly reported as not settled by the active
     plan DAG). Legacy JSON-argument forms from T04 are preserved.
   - Workspace link for the new dependency created the same way `bun install` links
     workspaces (no install run, per task constraints).
4. **Blackwater Relay environment handoff fixture** (`examples/blackwater-relay/`):
   - `.studio/requests/world.yaml` — capability request (strict schema): compose relay
     compound architecture, dock/hut kits, vegetation scatter, storm-dusk lighting with the
     canonical procedural island heightfield and runtime navigation.
   - `src/world/environment.ts` — the ACCEPTED COMMITTED world-composition output (authored
     by the coding agent exercising the pinned `vendor/skills/3dviz-pro-max` skill content;
     zero model invocations): 3 kit placements, 3 canonical-heightfield sockets, 3 collider
     specs, 2 seeded/bounded scatter layers, storm-dusk lighting/atmosphere; heights resolve
     ONLY through an injected canonical height sampler (`resolveWorldKitAnchors` /
     `resolveWorldSocketTransforms`) — the module stores no elevation data, keeps the example
     dependency-free, and never replaces terrain/navigation authority.
   - `.studio/results/world.yaml` — the committed handoff LIFECYCLE record: request ref ->
     routed AgentHandoff (skill 3dviz, pinned skill content pointer) -> accepted output ->
     strict CapabilityResult (`res-req-blackwater-world-001`, provider `agent-skill.3dviz`,
     status success, 3 committed artifacts, 5 bound asset ids, zero model invocations).
   - `assets/manifest.json` — five project-origin `AssetRecord`s (kit-relay-tower,
     kit-dock-planks, kit-maintainer-hut, veg-shoreline-scrub, skybox-storm-dusk) with
     project-owned license, module sha256 provenance, route
     `world.environment.compose/agent-skill.3dviz`, acceptance `accepted`; pass T13's
     `asset verify --all` gates (5/5, exit 0). Provenance classes stay distinguishable per
     AGENTS.md §5.
   - `studio.lock.yaml` — `world.environment.compose` binding recorded.

## Handoff Lifecycle Recording
The full lifecycle is committed and mechanically checkable:
1. **prepare** — `studio capability prepare world.environment.compose .../requests/world.yaml`
   (exit 0) validates the request and emits the studio-directed AgentHandoff
   (`skill_id: 3dviz`; provider below the stable capability contract).
2. **accept** — the coding agent fulfilled the handoff interactively (3dviz specialist
   knowledge; no model credentials) and the director settled it via
   `studio capability accept <handoff> <artifacts> agent-skill.3dviz` (exit 0,
   `res-req-blackwater-world-001`, acceptance evaluated, 2 committed artifacts).
3. **verify-result** — `studio capability verify-result world.environment.compose
   .../results/world.yaml` (exit 0) re-verifies the committed lifecycle document
   deterministically (17/17 checks), including lifecycle consistency (request_ref,
   request_id binding across request/handoff/result) and provenance binding into the
   project Asset Registry.

## Verification Evidence
- **Narrow Gates** (fresh runs, exit 0):
  - `bun run studio -- capability prepare world.environment.compose examples/blackwater-relay/.studio/requests/world.yaml --json` — routed, AgentHandoff emitted. Gate log: `artifacts/plan/T15/gate.txt`.
  - `bun run studio -- capability verify-result world.environment.compose examples/blackwater-relay/.studio/results/world.yaml --json` — 17/17 checks pass, zero model credentials.
- **Teeth / Falsification Checks**: both preregistered falsifiers exercised fresh at three
  enforcement layers, plus live CLI gate attacks (both exit 1) — `artifacts/plan/T15/teeth.txt`:
  - TEETH-T15-001: transceiver reconstruction through the world-composition route is
    rejected at prepare (redirect to `asset.reconstruct`), redirected by intent-based
    routing to `asset.reconstruct`/img2threejs, and rejected by normalization/verification.
  - TEETH-T15-002: a 3dviz terrain-mesh terrain authority (and embedded elevation/navmesh)
    is rejected by normalization and by the integration gate (live CLI attack exit 1;
    TERRAIN_AUTHORITY_CANONICAL / NO_COMPETING_AUTHORITY_EMBEDDED fail).
  - Positive control: the unmodified committed fixture passes 17/17, so the teeth are
    load-bearing.
- **Tests**: `bun test packages/studio/test/capabilities/3dviz-world-compose.test.ts` —
  13 pass / 0 fail (teeth, routing boundaries, normalization, deterministic fixture
  verification, lifecycle consistency).
- **Global Gates** (fresh runs):
  - `just lint` exit 0; `just validate-agent-artifacts` exit 0.
  - Scoped suites: `bun test packages/studio packages/adapters packages/contracts apps`
    129 pass / 0 fail (all T15-owned code and all settled-task suites in those packages,
    including T13/T16/T14-present suites); the two runtime suites that fail ONLY in the
    whole-repo single-process run pass standalone (34 pass / 0 fail).
  - `just test` (whole repo) currently reports 219 pass / 5 fail: the 5 failures are all
    Koota's process-wide 16-world pool exhaustion ("Too many worlds created") triggered by
    concurrently in-flight T17/T19 runtime test files; T15 code never imports koota or
    runtime. NOT CLAIMED AS PASS for the workspace-wide invocation.
  - `just check` (whole repo) currently fails with exactly two type errors in the
    concurrently in-flight T14 file `packages/adapters/src/agent-skills/img2threejs/module-contract.ts`
    (lines 115/310); zero type errors originate from any T15 file. NOT CLAIMED AS PASS for
    the workspace-wide invocation while that file is mid-edit.
  - These two workspace-wide gate states are concurrent-revision confounds (preregistration
    known_confounds: "stale evidence or a different project revision"), recorded honestly
    rather than attributed or masked. Every suite containing T15 code is green.

## Known limitations (not claimed)
- Final visual quality of Blackwater Relay (explicitly outside `proves`); no pixels were
  rendered or claimed — this task settles the HANDOFF/binding/authority surface
  (state-channel + deterministic verification), not visual settlement.
- Broad world-streaming scalability not proven (explicitly outside `proves`).
- `world.environment.compose` coexists with the pre-existing T04 `world.composition`
  catalog entry; T15's gate, fixtures, and verification bind the new id only. Consolidation
  of the two entries is not claimed and was not in task scope.
- The router's generic handoff pointer pattern (`skills/3dviz/SKILL.md`) remains the T04
  default; the committed lifecycle record points at the pinned vendor skill content
  (`vendor/skills/3dviz-pro-max/metadata.json`). Both are confined pointers; unifying them
  is not claimed.
- The verified composition is studio-level semantic/authority composition; Rapier/Recast
  projection construction from the committed specs (physics/navigation runtime projection)
  is exercised by the settled T10/T11 runtime surfaces and later scenario tasks, not claimed here.

## Scope Notes
- No git commits; `.agents/CURRENT_STATUS.yml` untouched; root `package.json` untouched.
- Files created: `packages/adapters/src/agent-skills/3dviz/{index,types,verify}.ts`,
  `packages/studio/test/capabilities/3dviz-world-compose.test.ts`,
  `examples/blackwater-relay/{.studio/requests/world.yaml,.studio/results/world.yaml,src/world/environment.ts}`,
  `.agents/preregistrations/gauntlet-game-studio-plan-T15.prereg.yaml`,
  `artifacts/plan/T15/{gate.txt,teeth.txt,summary.md}`.
- Files changed: `packages/studio/src/capabilities/catalog.ts` (exactly one appended entry),
  `packages/adapters/src/index.ts` (one appended export), `apps/studio-cli/src/index.ts`
  (file-based capability prepare/verify-result for the settled capability),
  `apps/studio-cli/package.json` (one dependency line),
  `examples/blackwater-relay/assets/manifest.json` (five appended records),
  `examples/blackwater-relay/studio.lock.yaml` (one binding).
- Transient attack fixtures used for live CLI teeth were deleted after capture; the results
  directory contains only the committed `world.yaml`.
