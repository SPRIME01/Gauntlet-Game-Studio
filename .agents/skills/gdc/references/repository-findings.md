# Gauntlet Studio discovery map

This snapshot records the GDC inspection performed on 2026-09-17. Re-check live sources on every invocation because the repository is authoritative.

## Governing sources

- Root operating contract: `AGENTS.md`
- Mutable execution state: `.agents/CURRENT_STATUS.yml`
- Approved normative spec: `.agents/specs/gauntlet-game-studio.spec.yaml`
- Approved settlement plan: `.agents/plans/gauntlet-game-studio.plan.yaml`
- Stable capability catalog: `packages/studio/src/capabilities/catalog.ts`
- Studio CLI: `apps/studio-cli/src/index.ts`
- Independent project generator: `packages/studio/src/generator.ts`
- Game template: `templates/game/`
- Reference implementation and proof suites: `examples/blackwater-relay/`

At inspection time, the Studio plan was fully settled through T25, with no active or ready task. Treat new game work as a project-specific graph, not as unfinished Studio implementation.

## Existing skill inventory

Repository-owned skills exclude dependency-managed `node_modules` content.

| Skill | Trigger/input | Output | Important constraint |
|---|---|---|---|
| `graft` | A repository question, symbol, file, or change scope | Ranked code context, exhaustive matches, API skeleton, or call graph | Query Graft before broad source reads; choose one tool matching the question. |
| `jolli` | `/jolli` or a request for the Jolli menu | Routes to an installed Jolli skill or MCP action | Menu only; it does not reimplement an action. |
| `jolli-recall` | Branch name or current branch | Structured prior branch context | Report only returned facts and clearly attributed synthesis. |
| `jolli-search` | Topic, decision, file, or commit query | Ranked cross-branch memory hits | Use recall, not search, for full context on a known branch. |
| `jolli-local-run` | Workflow choice and variables | Local workflow output on a Jolli Space branch and PR | Requires `space-cli`, review approval, heartbeats, and explicit completion/cancel handling. |
| `jolli-remote-run` | Remote workflow ID and optional variables | Terminal run status plus reported article/PR/workflow links | Trigger and cancel through registered tools; never invent absent URLs. |
| `threejs-gameplay-systems` | Gameplay mechanic, movement feel, camera, interaction, enemy-pattern work under `world.physics`/`world.navigation` | Specialist guidance applied through Studio-owned routes | Never owns game state, terrain, navmesh generation, or physics stepping. |
| `threejs-aaa-graphics-builder` | Materials, shaders, post-processing, grading, or render tuning under `world.composition`/`asset.optimize` | Visual-quality specialist guidance | No reference reconstruction, terrain authority, or licensing intake. |
| `threejs-game-ui-designer` | HUD, menu, flow, diegetic UI, DOM/CSS interface | UI specialist guidance | Browser proof remains owned by `verify.browser`; no game-state authority. |
| `threejs-debug-profiler` | Frame time, draw calls, memory, runtime, bandwidth, or bottleneck diagnosis | Exploratory diagnostic guidance | Does not mutate authoritative state or replace deterministic proof. |
| `threejs-qa-release` | Release checklist, smoke-plan, regression triage, or quality-gate review | QA/release planning guidance | Does not execute or settle browser proof. |

Dependency-managed Playwright packages also contain `playwright-cli`, `playwright-component-testing`, and `playwright-trace` skills. They accept browser/test/trace tasks and produce automation, component-test, or trace-analysis output. They are vendor-managed implementation aids, not Studio orchestration authorities or substitutes for committed Gauntlet proof.

Two pinned agent-skill providers participate in the build pipeline even though their inspected repo surface is metadata plus adapters rather than a local `SKILL.md`:

- `img2threejs` accepts a reference-image reconstruction `CapabilityRequest`; it produces a procedural Three.js module, `AssetRecord`, and verification evidence. It requires authorized `.png`, `.jpg`, `.jpeg`, or `.webp` files of 1 byte through 32 MiB and never serves as generic text-to-3D.
- `3dviz-pro-max` accepts a world brief, canonical terrain reference, and accepted kit asset IDs; it produces placements, sockets, collider intent, scatter metadata, and lighting/atmosphere. It cannot own elevation, navmesh, physics, or depicted-object reconstruction.

The overlay forbids `threejs-game-director`; quarantines generic 3D, image, and audio generators; and requires explicit project policy before any quarantined fallback is enabled. Credentials alone never select a provider.

## Stable capability contracts

| Capability | Required inputs | Outputs |
|---|---|---|
| `world.composition` | world brief, environment theme, layout spec | scene graph spec, world manifest |
| `world.environment.compose` | world brief, canonical terrain reference, kit asset IDs | placements, sockets, collider specs, scatter, lighting/atmosphere |
| `asset.reconstruct` | reference image URI, target role, polygon budget | procedural code, GLB derivative |
| `asset.reconstruct.reference-image` | reference images, target role, budgets, similarity threshold | procedural module, asset record, verification evidence |
| `world.terrain` | seed, grid dimensions, bounds, octaves | canonical `TerrainHeightfield` |
| `world.physics` | physics config, collider spec | singular Rapier step owner |
| `world.navigation` | accepted geometry, agent radius and height | Recast navmesh data, path-query handle |
| `world.spatial` | target mesh | BVH acceleration structure |
| `asset.source` | source URL, license type | `AssetRecord`, cached texture set |
| `asset.optimize` | raw glTF path, compression profile | optimized GLB, budget report |
| `asset.dcc_escalate` | source blend path, export script | committed GLB derivative |
| `dcc.blender.process` | source definition, escalation rationale, output/report paths, budgets | committed derivative, asset record, bake report |
| `vfx.particles` | emitter configuration | Quarks particle system |
| `audio.procedural` | audio event specification | audio handle |
| `network.multiplayer` | transport config, replication schema | network session handle |
| `verify.browser` | scenario specification, target URL | `ObservationRun`, `EvidenceManifest` |

## Build pipeline and artifacts

1. Inspect instructions, status, game spec, lock, capability catalog, skills, assets, tests, and evidence.
2. Define the smallest complete loop, acceptance scenarios, quality profile, budgets, asset needs, and authority boundaries.
3. Run the GDC pre-flight gate and obtain explicit approval.
4. Use the Studio CLI as the control surface. Start with `bun run studio -- doctor --json`, `bun run studio -- config --json`, and `bun run studio -- capabilities --json`; use the repo's capability-lint script for routing validation.
5. If needed, run `bun run studio -- create <target> --json`. The generator copies `templates/game/` and customizes the project name in `package.json`, `.agents/specs/game.spec.yaml`, and `.agents/CURRENT_STATUS.yml`.
6. The scaffold includes `AGENTS.md`, a draft game spec, current status, `studio.lock.yaml`, an empty `assets/manifest.json`, source/tests, and evidence directories. It builds independently with Bun/TypeScript and a single Three.js dependency.
7. Create strict `.studio/requests/*.yaml` capability requests. For agent providers, call CLI `capability prepare` to create the `AgentHandoff`; let the bound skill produce artifacts; then call CLI `capability accept` and `capability verify-result` to normalize and re-derive evidence offline.
8. Register assets and run `bun run studio -- asset verify --all --json`. Unknown provenance, unacceptable licenses, missing required collider/LOD policy, or over-budget assets block production acceptance unless a permitted waiver is explicitly recorded.
9. Build and test with project-native scripts. The reference game uses headless, browser, multiplayer, asset, performance, and evidence fixtures.
10. Use CLI `studio observe` for immutable browser evidence and `studio verify` for frozen expectations. Final project suites run with `bun run studio -- verify --project <dir> --suite <name|all> --json`; validate committed evidence fixtures with `bun run studio -- evidence check-fixtures --json`.

Do not import Studio package internals to replace an available CLI command, and do not hand-author a success envelope the CLI is responsible for validating. Placeholder CLI actions remain unavailable until their owning implementation exists.

## Conventions that shape GDC decisions

- Koota owns semantic game state. Three.js rendering, Rapier bodies, Recast data, audio/VFX, network replicas, and Blender data are projections or inputs.
- One authoritative Three.js dependency graph must resolve across the runtime.
- Every production asset needs an `AssetRecord` with origin, route, runtime representation, budgets, and acceptance state.
- External source intake records license/authorization, URI, author when external, retrieval metadata, and SHA-256 where retained.
- Reference imagery is reference-only. It stays distinguishable from shipped source assets.
- Terrain elevation comes from the canonical `TerrainHeightfield`; Recast derives navigation from accepted geometry.
- Blender is an isolated, expensive escalation. Normal builds consume committed derivatives without requiring Blender.
- Agent-browser may explore. Playwright and Studio verification settle deterministic browser behavior.
- Performance profiles and expectations are preregistered before their evidence is evaluated.
- Claims settle through the channels they concern: state, pixels, telemetry, and network evidence are not interchangeable.

## Existing template and example

`templates/game/` is the sole scaffold. Its default spec targets the browser at 60 FPS with initial limits of 200 draw calls, 250,000 triangles, and 256 MiB, but GDC must treat these as visible template defaults and confirm or revise them for the game rather than silently presenting them as user requirements.

`examples/blackwater-relay/` demonstrates the complete route: strict capability requests for reference reconstruction, world composition, and Blender; accepted assets; authoritative runtime integration; and fresh single-player/multiplayer proof. Reuse its shapes and commands, not its product decisions.
