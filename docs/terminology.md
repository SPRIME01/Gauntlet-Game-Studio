# Domain and Vocabulary Model

This document defines the core technical terminology used throughout Gauntlet Game Studio. For each term, it specifies the exact meaning within this repository, what it **does not** mean (to eliminate common developer or LLM misinterpretations), and where it is implemented in source code.

---

## 1. Studio & Architecture Terms

### CapabilityDescriptor
- **What it is**: A formal, provider-neutral definition of a studio capability (e.g., `world.terrain`, `asset.reconstruct`). Declares summary, positive triggers (`use_when`), negative boundaries (`do_not_use_when`), inputs, outputs, verification methods, and candidate providers.
- **What it is NOT**: It is not a vendor SDK wrapper, a Python script, or an agent prompt.
- **Implementation**: [`CapabilityDescriptorSchema`](file:///home/sprime01/projects/gauntlet-game-studio/packages/contracts/src/schemas.ts#L20) in `packages/contracts/src/schemas.ts`, [`CAPABILITY_CATALOG`](file:///home/sprime01/projects/gauntlet-game-studio/packages/studio/src/capabilities/catalog.ts#L7).

### AgentHandoff
- **What it is**: A structured execution envelope passed to a coding agent when a capability requires agent-skill intervention (e.g., `img2threejs`, `3dviz-pro-max`). Contains instruction references, input arguments, expected outputs, and acceptance criteria.
- **What it is NOT**: It is not an unconstrained conversational prompt or an autonomous background daemon.
- **Implementation**: [`AgentHandoffSchema`](file:///home/sprime01/projects/gauntlet-game-studio/packages/contracts/src/schemas.ts#L78), [`settleAgentHandoff()`](file:///home/sprime01/projects/gauntlet-game-studio/packages/studio/src/router/router.ts).

### Skill Overlay Policy
- **What it is**: A governance mechanism that allows Gauntlet Game Studio to reuse specialized game knowledge (from `threejs-game-skills`) while strictly forbidding upstream director agents (`threejs-game-director`) from usurping orchestration authority, and quarantining generic AI generators.
- **What it is NOT**: It is not a vendor fork. It leaves upstream submodules untouched and applies non-invasive studio routing policies.
- **Implementation**: [`loadSkillOverlayPolicy()`](file:///home/sprime01/projects/gauntlet-game-studio/packages/studio/src/skills/overlay.ts), [`lintStudioSkillSurface()`](file:///home/sprime01/projects/gauntlet-game-studio/packages/studio/src/skills/linter.ts).

---

## 2. Runtime & Authority Terms

### Semantic Authority
- **What it is**: The single source of truth for gameplay state, entity existence, health, inventory, mission status, and spatial coordinates. In Gauntlet, this is exclusively **Koota ECS** (`GameWorld`).
- **What it is NOT**: It is not the Three.js scene graph, Needle components, Rapier colliders, or DOM variables.
- **Implementation**: [`GameWorld`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/state/world.ts#L63).

### Execution Projection
- **What it is**: A downstream, one-way synchronized representation of an entity created to satisfy an external engine requirement (e.g., rendering via Three.js, collision via Rapier, pathfinding via Recast).
- **What it is NOT**: It is not an authoritative entity. Destroying a projection (e.g., deleting a Three.js mesh) does not destroy the underlying Koota entity or game logic.
- **Implementation**: [`ProjectionRegistry`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/projections/registry.ts), [`RenderProjectionManager`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/projections/render.ts).

### SubsystemBarrier
- **What it is**: A deterministic readiness gate that tracks the asynchronous initialization lifecycle (`uninitialized` -> `booting` -> `ready` / `failed`) of runtime subsystems (WASM physics, navmesh, network, audio).
- **What it is NOT**: It is not a simple `setTimeout` or generic Promise wrapper. It enforces that required subsystems cannot be bypassed before scenario execution begins.
- **Implementation**: [`SubsystemBarrier`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/readiness.ts#L5).

### SimulationScheduler
- **What it is**: The authoritative clock manager advancing game simulation by fixed delta time sub-steps (60Hz) and enforcing single-step ownership.
- **What it is NOT**: It is not `requestAnimationFrame` or the browser render loop. Rendering may interpolate between fixed simulation ticks using the scheduler's `getAlpha()`.
- **Implementation**: [`SimulationScheduler`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/scheduler.ts#L9).

---

## 3. Assets & DCC Terms

### AssetRecord
- **What it is**: The formal production metadata record tracking an asset's identity, role, origin class (`user`, `project`, `cc0`, `licensed`, `generated`, `blender`, `procedural`), source hash, runtime representation, collider policy, LOD policy, and acceptance history.
- **What it is NOT**: It is not just a loose `.glb` file or directory path.
- **Implementation**: [`AssetRecordSchema`](file:///home/sprime01/projects/gauntlet-game-studio/packages/contracts/src/schemas.ts#L112), [`AssetRegistry`](file:///home/sprime01/projects/gauntlet-game-studio/packages/studio/src/assets/registry.ts#L102).

### Reference-Image Reconstruction
- **What it is**: The specialized process (`img2threejs`) of reconstructing a specific depicted object or character into a procedural Three.js module using an authorized reference image.
- **What it is NOT**: It is not generic text-to-3D generation. If no reference image exists, this capability cannot be routed.
- **Implementation**: [`ASSET_RECONSTRUCT_REFERENCE_IMAGE_CAPABILITY`](file:///home/sprime01/projects/gauntlet-game-studio/packages/adapters/src/agent-skills/handoff.ts#L22).

### DCC Escalation
- **What it is**: An intentional escape route invoking headless Blender (`blender --background`) for tasks that procedural code cannot cleanly solve: retargeting animations across differing rigs, baking complex keyframes, or mesh cleanup.
- **What it is NOT**: It is not the primary authoring environment. Normal builds and CI run without Blender; `.blend` files are never authoritative game state.
- **Implementation**: [`runServiceDroneRetargetPipeline()`](file:///home/sprime01/projects/gauntlet-game-studio/packages/adapters/src/dcc/pipeline.ts), [`DCC_BLENDER_PROCESS_CAPABILITY`](file:///home/sprime01/projects/gauntlet-game-studio/packages/adapters/src/dcc/pipeline.ts#L30).

---

## 4. Observability & Verification Terms

### Observability Bridge
- **What it is**: The standardized window global `window.__GAUNTLET_STUDIO_OBS__` (version 1) exposing readiness, entity state snapshots, renderer statistics, camera views, and (in dev/test only) simulation control methods (`step`, `pause`, `resetScenario`).
- **What it is NOT**: It is not a backdoor for production cheating. Production builds structurally omit the `control` namespace.
- **Implementation**: [`createObservabilityBridge()`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/observability/bridge.ts#L106), [`inspectProductionSurface()`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/observability/production-check.ts).

### FrozenExpectation
- **What it is**: A pre-declared, immutable YAML test contract specifying exact conditions across state, pixels, telemetry, or network channels that must be satisfied for a named scenario.
- **What it is NOT**: It is not an ad-hoc test assertion written after the fact.
- **Implementation**: [`parseFrozenExpectation()`](file:///home/sprime01/projects/gauntlet-game-studio/packages/studio/src/gauntlet/expectation.ts#L160).

### SettlementRecord
- **What it is**: The formal outcome record emitted by the Gauntlet settlement engine. Classifies an expectation outcome as `settled`, `blocked`, `failed`, or `incomplete`, citing exact `EvidenceManifest` IDs and any cross-channel contradictions.
- **What it is NOT**: It is not a boolean test pass/fail flag. It preserves diagnostic evidence and blockage classifications.
- **Implementation**: [`SettlementRecordSchema`](file:///home/sprime01/projects/gauntlet-game-studio/packages/contracts/src/schemas.ts#L270), [`settleExpectation()`](file:///home/sprime01/projects/gauntlet-game-studio/packages/studio/src/gauntlet/settle.ts#L192).

### Tri-Channel Contradiction
- **What it is**: An explicit failure condition where one observation channel passes but another channel contradicts it (e.g., `pixels_pass_state_fail`: image looks right, state is broken; or `state_pass_pixels_fail`: state changed, render is blank).
- **What it is NOT**: It is not an ignorable warning. It causes immediate settlement rejection.
- **Implementation**: [`evaluateClaimedChannels()`](file:///home/sprime01/projects/gauntlet-game-studio/packages/studio/src/gauntlet/checks.ts), [`classifySemanticFailure()`](file:///home/sprime01/projects/gauntlet-game-studio/packages/studio/src/gauntlet/settle.ts#L92).
