# Gauntlet Game Studio Source Map

This map connects domain concepts, architectural invariants, capabilities, and execution layers directly to the concrete source code artifacts, symbols, schemas, and test suites in the repository.

---

## 1. Monorepo Topology & Boundaries

| Domain Component | Source Directory | Package / Target | Primary Exports & Symbols | Verification Tests |
| :--- | :--- | :--- | :--- | :--- |
| **Studio Contracts** | [`packages/contracts/src/`](file:///home/sprime01/projects/gauntlet-game-studio/packages/contracts/src/) | `@gauntlet/contracts` | `CapabilityDescriptorSchema`, `CapabilityRequestSchema`, `CapabilityResultSchema`, `AssetRecordSchema`, `RuntimeReadinessSchema`, `EvidenceManifestSchema`, `SettlementRecordSchema` | [`packages/contracts/src/schemas.test.ts`](file:///home/sprime01/projects/gauntlet-game-studio/packages/contracts/src/schemas.test.ts), [`packages/contracts/src/index.test.ts`](file:///home/sprime01/projects/gauntlet-game-studio/packages/contracts/src/index.test.ts) |
| **Gauntlet Runtime** | [`packages/runtime/src/`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/) | `@gauntlet/runtime` | `GauntletKernel`, `ServerRuntime`, `ClientRuntime`, `GameWorld`, `SimulationScheduler`, `SubsystemBarrier`, `createObservabilityBridge` | [`packages/runtime/test/`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/test/) (18 test suites) |
| **Studio Engine** | [`packages/studio/src/`](file:///home/sprime01/projects/gauntlet-game-studio/packages/studio/src/) | `@gauntlet/studio` | `routeCapability`, `CapabilityRegistry`, `AssetRegistry`, `EvidenceStore`, `settleExpectation`, `createGameProject` | [`packages/studio/test/`](file:///home/sprime01/projects/gauntlet-game-studio/packages/studio/test/) (17 test suites) |
| **Production Adapters** | [`packages/adapters/src/`](file:///home/sprime01/projects/gauntlet-game-studio/packages/adapters/src/) | `@gauntlet/adapters` | `prepareReferenceImageReconstruction`, `verifyImg2ThreeJsResult`, `runScenario`, `SurfaceClient`, `ToneAudioBackend`, `QuarksVfxProjection` | [`packages/adapters/test/`](file:///home/sprime01/projects/gauntlet-game-studio/packages/adapters/test/) (8 test suites) |
| **Studio CLI** | [`apps/studio-cli/src/`](file:///home/sprime01/projects/gauntlet-game-studio/apps/studio-cli/src/) | `@gauntlet/studio-cli` | `main`, `getDoctorStudioResult`, `CLI_VERSION` | [`apps/studio-cli/src/cli.test.ts`](file:///home/sprime01/projects/gauntlet-game-studio/apps/studio-cli/src/cli.test.ts) |
| **Reference Game** | [`examples/blackwater-relay/`](file:///home/sprime01/projects/gauntlet-game-studio/examples/blackwater-relay/) | `blackwater-relay` | `bootBrowserGame`, `bootHeadlessGame`, `stepGame`, `AuthoritativeServer` entrypoint | [`examples/blackwater-relay/tests/`](file:///home/sprime01/projects/gauntlet-game-studio/examples/blackwater-relay/tests/) (13 test suites) |
| **Project Template** | [`templates/game/`](file:///home/sprime01/projects/gauntlet-game-studio/templates/game/) | template scaffold | Standalone project structure, `studio.lock.yaml`, `AGENTS.md` | [`packages/studio/src/generator.test.ts`](file:///home/sprime01/projects/gauntlet-game-studio/packages/studio/src/generator.test.ts) |

---

## 2. Core Concepts & Subsystem Symbol Index

### A. Semantic State Authority (Koota ECS)
*Game state is isolated from rendering, physics, audio, and DCC projections.*

- **ECS World & Container**: [`GameWorld`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/state/world.ts#L63) in `packages/runtime/src/state/world.ts`
- **Entity Creation & Trait Binding**: [`GameWorld.spawnEntity()`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/state/world.ts#L74)
- **Snapshot Serialization**: [`GameWorld.takeSemanticSnapshot()`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/state/world.ts#L208)
- **Snapshot Deserialization**: [`GameWorld.restoreSemanticSnapshot()`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/state/world.ts#L305)
- **Leak Detection & Provider Lockout**: [`GameWorld.assertValidSemanticData()`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/state/world.ts#L331), [`assertNoProviderObjectsInState()`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/state/world.ts#L345)
- **Core Semantic Traits**: [`Transform`, `Velocity`, `EntityId`, `RenderProjectionHandle`, `PhysicsProjectionHandle`, `NavigationProjectionHandle`, `AssetBinding`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/state/traits.ts)
- **Tests & Proof**: [`packages/runtime/test/authority.test.ts`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/test/authority.test.ts)

### B. Execution Projections & Projection Correlation
*Projections are derived, one-way synchronized views of the authoritative state.*

- **Projection Registry**: [`ProjectionRegistry`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/projections/registry.ts)
- **Three.js Render Projections**: [`RenderProjectionManager`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/projections/render.ts)
- **Rapier Physics Projection**: [`RapierPhysicsAdapter`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/physics/rapier.ts)
- **Recast Navigation Projection**: [`RecastNavigationAdapter`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/navigation/recast.ts)
- **Spatial BVH Queries**: [`SpatialQueryAccelerator`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/spatial/bvh.ts)
- **Quarks VFX Particles**: [`QuarksVfxProjection`](file:///home/sprime01/projects/gauntlet-game-studio/packages/adapters/src/vfx/quarks/index.ts)
- **DOM HUD Projection**: [`DomHudRenderer`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/ui/dom-hud.ts)
- **Tests & Proof**: [`packages/runtime/test/projections.test.ts`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/test/projections.test.ts), [`packages/runtime/test/terrain-parity.test.ts`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/test/terrain-parity.test.ts)

### C. Simulation Scheduling & Subsystem Readiness
*Single step owner invariant and deterministic boot coordination.*

- **Subsystem Barrier**: [`SubsystemBarrier`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/readiness.ts#L5)
- **Subsystem State Machine**: [`markBooting()`, `markReady()`, `markFailed()`, `getReadiness()`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/readiness.ts#L34-L113)
- **Authoritative Scheduler**: [`SimulationScheduler`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/scheduler.ts#L9)
- **Fixed Sub-step Execution**: [`SimulationScheduler.advance()`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/scheduler.ts#L43)
- **Single Step Owner Enforcement**: [`SimulationScheduler.executeStepOwner()`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/scheduler.ts#L82)
- **Headless Runtime Kernel**: [`GauntletKernel`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/kernel.ts)
- **Tests & Proof**: [`packages/runtime/test/readiness.test.ts`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/test/readiness.test.ts), [`packages/runtime/test/scheduler.test.ts`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/test/scheduler.test.ts)

### D. Observability Bridge & Production Hardening
*Versioned interface `window.__GAUNTLET_STUDIO_OBS__` (v1) with mutation lockout.*

- **Bridge Factory**: [`createObservabilityBridge()`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/observability/bridge.ts#L106)
- **Contract Header & Types**: [`OBSERVABILITY_CONTRACT_NAME`, `OBSERVABILITY_CONTRACT_VERSION`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/observability/contract.ts)
- **Surface Client (Playwright Adapter)**: [`SurfaceClient`](file:///home/sprime01/projects/gauntlet-game-studio/packages/adapters/src/browser/surface-client.ts#L17)
- **Production Surface Inspector (Lockout Teeth)**: [`inspectProductionSurface()`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/observability/production-check.ts)
- **Tests & Proof**: [`packages/runtime/test/observability.test.ts`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/test/observability.test.ts), [`scripts/conformance-security.ts`](file:///home/sprime01/projects/gauntlet-game-studio/scripts/conformance-security.ts)

### E. Capability Routing & Skill Overlays
*Capability-first matching, negative affordances, and single director authority.*

- **Normative Catalog**: [`CAPABILITY_CATALOG`](file:///home/sprime01/projects/gauntlet-game-studio/packages/studio/src/capabilities/catalog.ts#L7)
- **Capability Registry**: [`CapabilityRegistry`](file:///home/sprime01/projects/gauntlet-game-studio/packages/studio/src/capabilities/registry.ts)
- **Capability Router**: [`routeCapability()`](file:///home/sprime01/projects/gauntlet-game-studio/packages/studio/src/router/router.ts#L42)
- **Skill Overlay Policy**: [`loadSkillOverlayPolicy()`, `SkillOverlayPolicy`](file:///home/sprime01/projects/gauntlet-game-studio/packages/studio/src/skills/overlay.ts)
- **Skill Linter**: [`lintStudioSkillSurface()`](file:///home/sprime01/projects/gauntlet-game-studio/packages/studio/src/skills/linter.ts)
- **Agent Handoff Verification**: [`verifyImg2ThreeJsResult()`](file:///home/sprime01/projects/gauntlet-game-studio/packages/adapters/src/agent-skills/verify-result.ts), [`verifyWorldCompositionResultFile()`](file:///home/sprime01/projects/gauntlet-game-studio/packages/adapters/src/agent-skills/3dviz.ts)
- **Tests & Proof**: [`packages/studio/test/capabilities/`](file:///home/sprime01/projects/gauntlet-game-studio/packages/studio/test/capabilities/), [`packages/studio/test/skill-overlays/`](file:///home/sprime01/projects/gauntlet-game-studio/packages/studio/test/skill-overlays/)

### F. Asset Registry & glTF / DCC Pipelines
*Production asset records, CC0 intake, glTF-Transform optimization, and Blender escalation.*

- **Asset Registry**: [`AssetRegistry`](file:///home/sprime01/projects/gauntlet-game-studio/packages/studio/src/assets/registry.ts#L102)
- **Intake & Gate Policy**: [`DEFAULT_ASSET_POLICY`, `validateProvenanceIntake()`, `evaluateAsset()`](file:///home/sprime01/projects/gauntlet-game-studio/packages/studio/src/assets/gates.ts)
- **glTF-Transform Compiler**: [`runGltfPipeline()`, `planGltfOptimization()`](file:///home/sprime01/projects/gauntlet-game-studio/packages/adapters/src/assets/gltf.ts)
- **Poly Haven Intake**: [`fetchPolyhavenAsset()`](file:///home/sprime01/projects/gauntlet-game-studio/packages/adapters/src/assets/polyhaven.ts)
- **Blender Headless Pipeline**: [`runServiceDroneRetargetPipeline()`](file:///home/sprime01/projects/gauntlet-game-studio/packages/adapters/src/dcc/pipeline.ts), [`checkBlenderPreflight()`](file:///home/sprime01/projects/gauntlet-game-studio/packages/adapters/src/dcc/preflight.ts)
- **Tests & Proof**: [`packages/studio/test/assets/`](file:///home/sprime01/projects/gauntlet-game-studio/packages/studio/test/assets/), [`packages/adapters/test/blender/`](file:///home/sprime01/projects/gauntlet-game-studio/packages/adapters/test/blender/)

### G. Authoritative Multiplayer Network Stack
*Bun native WebSocket baseline, sequenced commands, Koota replication, and diagnostics.*

- **Server Runtime**: [`ServerRuntime`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/server.ts#L43)
- **Authoritative Server**: [`AuthoritativeServer`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/network/server.ts#L59)
- **Network Client**: [`NetworkClient`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/network/client.ts#L49)
- **Bun WebSocket Transport**: [`BunWebSocketServerTransport`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/network/transport-ws.ts)
- **Interest Filtering**: [`RadiusInterestFilter`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/network/interest.ts)
- **Sequenced Commands & Validation**: [`ProtocolValidator`, `validateClientMessageEnvelope`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/network/protocol.ts)
- **Diagnostics & Impairment**: [`BandwidthTracker`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/diagnostics/bandwidth.ts), [`LatencySimulator`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/diagnostics/latency.ts)
- **Tests & Proof**: [`packages/runtime/test/network/`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/test/network/) (29 tests), [`examples/blackwater-relay/tests/multiplayer/`](file:///home/sprime01/projects/gauntlet-game-studio/examples/blackwater-relay/tests/multiplayer/)

### H. Gauntlet Settlement & Quality Profiles
*Frozen expectation settlement, tri-channel evaluation, contradiction detection, and evidence store.*

- **Frozen Expectation Parser**: [`parseFrozenExpectation()`](file:///home/sprime01/projects/gauntlet-game-studio/packages/studio/src/gauntlet/expectation.ts#L160)
- **Settlement Engine**: [`settleExpectation()`](file:///home/sprime01/projects/gauntlet-game-studio/packages/studio/src/gauntlet/settle.ts#L192)
- **Channel Checks & Contradictions**: [`evaluateClaimedChannels()`](file:///home/sprime01/projects/gauntlet-game-studio/packages/studio/src/gauntlet/checks.ts)
- **Evidence Store**: [`EvidenceStore`](file:///home/sprime01/projects/gauntlet-game-studio/packages/studio/src/evidence/store.ts#L67)
- **Project Revision Hashing**: [`resolveProjectRevision()`](file:///home/sprime01/projects/gauntlet-game-studio/packages/studio/src/evidence/revision.ts#L26)
- **Quality Profiles**: [`loadQualityProfiles()`, `bindQualityProfile()`](file:///home/sprime01/projects/gauntlet-game-studio/packages/studio/src/quality/profiles.ts)
- **Performance Evaluation**: [`evaluatePerformanceEvidence()`](file:///home/sprime01/projects/gauntlet-game-studio/packages/studio/src/quality/evaluate.ts)
- **Tests & Proof**: [`packages/studio/test/proof/`](file:///home/sprime01/projects/gauntlet-game-studio/packages/studio/test/proof/), [`packages/studio/test/performance/`](file:///home/sprime01/projects/gauntlet-game-studio/packages/studio/test/performance/)

---

## 3. Governance & Verification Scripts

| Script Path | Purpose | Applicable Gate |
| :--- | :--- | :--- |
| [`scripts/check-traceability.py`](file:///home/sprime01/projects/gauntlet-game-studio/scripts/check-traceability.py) | Verifies 100% mapping of spec requirements (152 REQ, 14 VAR, 8 RECOV, 10 CLAIM) and DAG acyclicity | `validate-agent-artifacts`, `ci` |
| [`scripts/check-topology.py`](file:///home/sprime01/projects/gauntlet-game-studio/scripts/check-topology.py) | Enforces 5 workspace packages, Bun 1.4 baseline, and donor isolation (`.tmp/` gitignored) | `validate-agent-artifacts`, `lint`, `ci` |
| [`scripts/donor-audit.ts`](file:///home/sprime01/projects/gauntlet-game-studio/scripts/donor-audit.ts) | Audits codebase for unauthorized donor imports, identities, or files | `donor:audit` |
| [`scripts/donor-dependency-scan.ts`](file:///home/sprime01/projects/gauntlet-game-studio/scripts/donor-dependency-scan.ts) | Scans all `package.json` manifests for donor dependencies | `donor:dependency-scan` |
| [`scripts/verify-source.ts`](file:///home/sprime01/projects/gauntlet-game-studio/scripts/verify-source.ts) | Verifies first-party source ownership and file integrity | `source:verify` |
| [`scripts/verify-third-party.ts`](file:///home/sprime01/projects/gauntlet-game-studio/scripts/verify-third-party.ts) | Verifies third-party notices and attribution classes | `third-party:verify` |
| [`scripts/conformance-clean-checkout.ts`](file:///home/sprime01/projects/gauntlet-game-studio/scripts/conformance-clean-checkout.ts) | Confirms monorepo compiles and tests with `.tmp/donor/` physically absent | `conformance:clean-checkout` |
| [`scripts/conformance-security.ts`](file:///home/sprime01/projects/gauntlet-game-studio/scripts/conformance-security.ts) | Audits secret hygiene, production mutation lockout, and network protocol whitelisting | `conformance:security` |
| [`scripts/conformance-recovery.ts`](file:///home/sprime01/projects/gauntlet-game-studio/scripts/conformance-recovery.ts) | Tests all 8 RECOV-* recovery cases and 14 VAR-* variations | `conformance:recovery` |
