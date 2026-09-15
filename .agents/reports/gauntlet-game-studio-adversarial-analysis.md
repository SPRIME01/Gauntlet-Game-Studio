# Adversarial Analysis: Gauntlet Game Studio Specification & Plan

**Target Plan**: [`.agents/plans/gauntlet-game-studio.plan.yaml`](file:///home/sprime01/projects/gauntlet-game-studio/.agents/plans/gauntlet-game-studio.plan.yaml)  
**Governing Specification**: [`.agents/specs/gauntlet-game-studio.spec.yaml`](file:///home/sprime01/projects/gauntlet-game-studio/.agents/specs/gauntlet-game-studio.spec.yaml)  
**Operating Contract**: [`AGENTS.md`](file:///home/sprime01/projects/gauntlet-game-studio/AGENTS.md)  
**Analysis Date**: September 15, 2026  
**Auditor**: Antigravity Adversarial Verification Agent  
**Environment Baseline**: Linux x86_64, Bun v1.4.0, Node v26.8.2  

---

## 1. Executive Summary & Verdict

The revised specification ([`gauntlet-game-studio.spec.yaml`](file:///home/sprime01/projects/gauntlet-game-studio/.agents/specs/gauntlet-game-studio.spec.yaml)) and implementation plan ([`gauntlet-game-studio.plan.yaml`](file:///home/sprime01/projects/gauntlet-game-studio/.agents/plans/gauntlet-game-studio.plan.yaml)) represent a massive, commendable leap in architectural maturity over the superseded v0.1 draft. 

### Key Advancements Observed:
1. **First-Party Runtime**: Needle Engine was completely removed, resolving the dual-Three.js dependency conflict and commercial watermarking/licensing liability.
2. **Monorepo Rationalization**: The speculative 20-package explosion was consolidated into a lean 5-package topology (`contracts`, `studio`, `runtime`, `adapters`, `apps/studio-cli`).
3. **Agent-Skill Boundaries**: Agent skills (`img2threejs`, `3dviz-pro-max`, `threejs-game-skills`) now explicitly separate interactive developer handoffs (`studio capability prepare`) from deterministic, credential-free CI result validation (`studio capability verify-result`).
4. **Donor Containment**: Mavon Engine is rigorously quarantined as a non-authoritative, temporary code donor under gitignored `.tmp/donor/` with strict donor-absent clean build gates.
5. **Canonical Terrain**: The architectural flaw of treating generated mesh vertices as authority was superseded by a canonical `TerrainHeightfield` specification.

---

### Critical Adversarial Findings:
Despite these major improvements, an adversarial audit and live empirical execution tests under Bun 1.4 revealed **7 critical/high severity flaws, tooling traps, graph inaccuracies, and specification debt** that will block execution or cause silent failure if executed as written.

### High-Level Risk Scorecard

| ID | Category | Finding Summary | Severity | Risk Level |
| :--- | :--- | :--- | :--- | :--- |
| **F-01** | **Ecosystem / Bun 1.4** | `geckos.io` relies on `node-datachannel` (native C++ N-API addon); Bun blocks postinstalls by default, causing immediate import crashes | High | 🚨 Blocker |
| **F-02** | **Tooling / Headless** | `three.terrain.js@3.1.1` hardcodes `instanceof HTMLCanvasElement`, crashing headless Bun tests with `ReferenceError` | High | 🚨 Blocker |
| **F-03** | **Specification Gaps** | Spec binds 14 tools in `REQ-BIND-001..014`, but completely omits a binding requirement for Rapier physics | Medium | ⚠️ Major |
| **F-04** | **Dependency Graph** | Declared `critical_path` has length 14, skipping prerequisites `T03 -> T04 -> T05`; true longest path has length 17 | Medium | ⚠️ Major |
| **F-05** | **Traceability / Debt** | 22 normative test/recovery items (`VAR-001..014`, `RECOV-001..008`) and 10 claims (`CLAIM-001..010`) are unmapped in plan traceability | Medium | ⚠️ Major |
| **F-06** | **Audio / Headless** | `Tone.js@15.1.22` throws `param must be an AudioParam` in headless Bun tests without an explicit Web Audio mock | Medium | ⚠️ Major |
| **F-07** | **Tooling / glTF** | `glTF-Transform` KTX2 texture compression requires external `toktx` CLI binary in host `PATH`, which is missing on clean machines | Medium | ⚠️ Minor |
| **F-08** | **Governance** | Spec and Plan both declare `metadata.status: draft`, externally blocking `T00` per `AGENTS.md` operating contract | Low | ℹ️ Operational |

---

## 2. Library-by-Library & Tooling Audit (Empirically Verified)

Every external library, runtime package, and tool specified in the documents was tested live under `bun v1.4.0` on Linux x86_64 to verify actual compatibility.

### 2.1 [HIGH] `geckos.io` / `node-datachannel` vs. Bun 1.4 Native Addon Trap

#### The Conflict
- [`REQ-BIND-013`](file:///home/sprime01/projects/gauntlet-game-studio/.agents/specs/gauntlet-game-studio.spec.yaml#L905) declares:
  > *"The preferred initial real-time multiplayer transport is geckos.io/WebRTC data channels behind a transport-neutral Gauntlet Runtime networking contract..."*
- [`REQ-BIND-014`](file:///home/sprime01/projects/gauntlet-game-studio/.agents/specs/gauntlet-game-studio.spec.yaml#L908) declares:
  > *"First-party workspace/package/script and headless-server tooling is Bun 1.4."*
- Task `T12` specifies:
  > *"Implement the initial geckos.io transport adapter, proving compatibility with Bun 1.4 server execution."*

#### Empirical Test Results (Bun v1.4.0)
A clean installation of `@geckos.io/server@3.1.0` was executed under Bun 1.4:
```bash
bun add @geckos.io/server
```
**Observation 1 (Blocked Postinstall)**:
```
installed @geckos.io/server@3.1.0
Blocked 1 postinstall. Run `bun pm untrusted` for details.
```
Bun 1.4 by default **blocks all native compilation and postinstall scripts** unless explicitly trusted.

**Observation 2 (Runtime Crash on Import)**:
When importing `@geckos.io/server` in Bun:
```bash
bun -e "import geckos from '@geckos.io/server';"
```
**Output**:
```
error: Cannot find module '../../../build/Release/node_datachannel.node' 
from '.../node_modules/node-datachannel/dist/esm/lib/node-datachannel.mjs'
Bun v1.4.0 (Linux x64)
```
Even if `bun pm trust --all` is run, `node-datachannel` attempts to compile or download prebuilt C++ binaries for Node-API. On clean containerized CI or non-standard environments, this requires Python, GNU Make, C++ compilers, and dev headers, completely defying Bun's fast, zero-dependency philosophy.

#### Actionable Recommendation
- Replace `geckos.io` with **Bun's built-in WebSockets** (`Bun.serve({ websocket: ... })`) as the primary, first-party headless server transport.
- Bun's native WebSocket engine is powered by `uWebSockets`, provides microsecond-level latency, zero external dependencies, zero native addon compilation, and 100% native stability in Bun 1.4.
- Relegate `geckos.io`/WebRTC to an optional secondary transport adapter behind the `Transport` interface.

---

### 2.2 [HIGH] `three.terrain.js@3.1.1` Headless `HTMLCanvasElement` ReferenceError Crash

#### The Conflict
- In Task `T10` ([`gauntlet-game-studio.plan.yaml` L1273](file:///home/sprime01/projects/gauntlet-game-studio/.agents/plans/gauntlet-game-studio.plan.yaml#L1273)):
  > *"Adapt three.terrain.js or another allowed generator to produce/normalize a TerrainHeightfield rather than treating generated mesh vertices as downstream authority."*
- Task `T10` gate command:
  ```bash
  bun test packages/runtime/test/terrain-parity.test.ts
  ```

#### Empirical Test Results (Bun v1.4.0)
Testing `three.terrain.js@3.1.1` in a headless Bun environment:
```typescript
import * as THREE from 'three';
import Terrain from 'three.terrain.js';

const terrain = Terrain({
  xSize: 100,
  ySize: 100,
  xSegments: 10,
  ySegments: 10,
  material: new THREE.MeshBasicMaterial()
});
```
**Output**:
```
ReferenceError: HTMLCanvasElement is not defined
  at r (.../node_modules/three.terrain.js/dist/three.terrain.js:30:32)
Bun v1.4.0 (Linux x64)
```

#### Why it fails:
`three.terrain.js` (written years ago for legacy Three.js r70/80) contains hardcoded DOM checks (`n.heightmap instanceof HTMLCanvasElement || n.heightmap instanceof Image`). In headless test runners (`bun test`) or Node/Bun servers where `window` and DOM globals are absent, `three.terrain.js` crashes immediately on invocation.

Furthermore:
1. `three.terrain.js` internally mutates `THREE.PlaneGeometry` vertices and returns an `Object3D` rotated by `-0.5 * Math.PI`, rather than producing a pure elevation height array.
2. Relying on it directly violates the spec's principle of first-party `TerrainHeightfield` canonical data.

#### Actionable Recommendation
- **Eliminate `three.terrain.js` from `T10` and the runtime entirely.**
- Implement a lightweight, pure-mathematical procedural elevation function (e.g. using standard simplex/perlin noise math or `fast-simplex-noise`) that outputs directly into a 1D `Float32Array` conforming to `TerrainHeightfield`.
- From this canonical array, derive:
  1. `THREE.PlaneGeometry` position attributes (setting `position.setZ(i, height)` or `setY`).
  2. Rapier heightfield collider (`RAPIER.ColliderDesc.heightfield(nrows, ncols, heights, scale)`).
  3. Recast navigation mesh triangles.

---

### 2.3 [MAJOR] Tone.js Web Audio Lifecycle in Headless Bun Test Runners

#### The Conflict
- [`REQ-AUDIO-002`](file:///home/sprime01/projects/gauntlet-game-studio/.agents/specs/gauntlet-game-studio.spec.yaml#L1377):
  > *"Pure/headless game tests MUST be able to substitute a non-browser audio backend or mock; importing core game logic MUST NOT depend on a live browser AudioContext."*
- Task `T17` gate:
  ```bash
  bun test packages/runtime/test/audio-headless.test.ts
  ```

#### Empirical Test Results (Bun v1.4.0)
Instantiating Tone nodes in headless Bun:
```typescript
import * as Tone from 'tone';
const synth = new Tone.Synth();
```
**Output**:
```
error: param must be an AudioParam
  at assert (.../node_modules/tone/build/esm/core/util/Debug.js:9:19)
  at new Param (.../node_modules/tone/build/esm/core/context/Param.js:30:9)
  at new Gain (.../node_modules/tone/build/esm/core/context/Gain.js:33:21)
  at new Synth (.../node_modules/tone/build/esm/instrument/Synth.js:24:9)
Bun v1.4.0 (Linux x64)
```

#### Why it fails:
`Tone.js@15.1.22` initializes its default context on module load or component instantiation. When instantiated in a headless runtime (Bun test or headless server), `window.AudioContext` does not exist, causing Tone's internal `Gain` and `Param` wrappers to throw assertions.

#### Actionable Recommendation
- Define an explicit `AudioBackend` interface in `packages/runtime/src/audio/`:
  - `BrowserToneAudioBackend`: Wraps Tone.js, active only in real browser environments after user gesture.
  - `NullAudioBackend`: Mocks all triggers (`playEvent`, `setVolume`, `stopEvent`) as no-ops for headless tests and headless servers.
- Ensure `packages/runtime` never instantiates Tone nodes directly; all audio commands must flow through `AudioBackend`.

---

### 2.4 [MAJOR] glTF-Transform KTX2 Texture Compression Dependency (`toktx`)

#### The Conflict
- Task `T13` steps ([`gauntlet-game-studio.plan.yaml` L1487](file:///home/sprime01/projects/gauntlet-game-studio/.agents/plans/gauntlet-game-studio.plan.yaml#L1487)):
  > *"Implement glTF compiler/normalizer using glTF-Transform for Draco/meshopt geometry and KTX2/Basis Universal texture compression where project policy requires."*

#### Empirical Finding
- In `glTF-Transform` (`@gltf-transform/functions`), geometry optimization (Draco via `draco3d`, Meshopt via `meshoptimizer`) and WebP image compression (via `sharp`) run within Node/Bun.
- **However, KTX2 texture compression (`textureCompress({ targetFormat: 'ktx2' })`) strictly spawns the external `toktx` binary** from the Khronos Group's `KTX-Software`.
- Running `which toktx` on the target machine returns nothing (exit code 1).
- If `studio asset optimize` or `T13` executes KTX2 texture compression on clean developer checkouts or standard CI runners, the process will crash with `Error: Command failed: toktx ...`.

#### Actionable Recommendation
- Standardize **WebP** as the default baseline texture compression format in `packages/studio/src/assets/gltf-compiler.ts`.
- Make KTX2 texture compression an explicit **opt-in escalation path** (similar to Blender), guarded by a preflight check for the `toktx` binary, falling back to WebP when `toktx` is absent.

---

### 2.5 [PASS] Successful Library Verifications under Bun 1.4

The following libraries were empirically verified to install, initialize, and execute cleanly under Bun v1.4.0:

| Library | Version Verified | Test Case | Result |
| :--- | :--- | :--- | :--- |
| **`koota`** | `0.6.6` | Spawning world, declaring traits, querying entity data | ✅ Pass |
| **`@dimforge/rapier3d-compat`** | `0.20.0` | `await RAPIER.init()`, creating world, stepping gravity | ✅ Pass |
| **`@recast-navigation/core`** | `0.43.1` | `await init()`, Recast module readiness | ✅ Pass |
| **`three`** | `0.186.0` | Instantiating `BoxGeometry`, `Scene`, matrix math | ✅ Pass |
| **`three-mesh-bvh`** | `0.9.15` | `BufferGeometry.computeBoundsTree()`, raycasting acceleration | ✅ Pass |
| **`three.quarks`** | `0.17.1` | Importing `ParticleSystem`, `BatchedRenderer` | ✅ Pass |
| **`@gltf-transform/core`** | `4.5.0` | Initializing `Document`, `NodeIO` | ✅ Pass |
| **`@playwright/test`** | `1.63.0` | CLI invocation via `bun x playwright --version` | ✅ Pass |

---

## 3. Normative Specification Gaps & Architectural Inconsistencies

### 3.1 [CRITICAL GAP] Missing `REQ-BIND` for Rapier 3D Physics

#### The Spec Inconsistency
In [`gauntlet-game-studio.spec.yaml`](file:///home/sprime01/projects/gauntlet-game-studio/.agents/specs/gauntlet-game-studio.spec.yaml#L865-L910), the specification defines 14 explicit provider bindings in `core_behavior_requirements.current_preferred_bindings`:
- `REQ-BIND-001`: Three.js
- `REQ-BIND-002`: Koota
- `REQ-BIND-003`: Recast Navigation JS
- `REQ-BIND-004`: three-mesh-bvh
- `REQ-BIND-005`: 3dviz-pro-max
- `REQ-BIND-006`: img2threejs
- `REQ-BIND-007`: threejs-game-skills
- `REQ-BIND-008`: glTF-Transform
- `REQ-BIND-009`: three.quarks
- `REQ-BIND-010`: Playwright
- `REQ-BIND-011`: Blender
- `REQ-BIND-012`: Tone.js
- `REQ-BIND-013`: geckos.io/WebRTC
- `REQ-BIND-014`: Bun 1.4

**Rapier is mentioned 24 times throughout the specification**, is the sole physics simulation engine for the studio (`REQ-RUNTIME-001`, `REQ-RUNTIME-006`, `REQ-TERRAIN-002`), and owns Task `T10`.  
**Yet there is NO `REQ-BIND` requirement binding Rapier in the specification!**

#### Actionable Recommendation
Add `REQ-BIND-015` to `core_behavior_requirements.current_preferred_bindings`:
```yaml
- id: REQ-BIND-015
  text: The preferred 3D physics binding is @dimforge/rapier3d-compat (WASM) owned by exactly one Gauntlet Runtime simulation scheduler; direct Rapier bodies are execution projections, not semantic game state.
```

---

### 3.2 [MAJOR GAP] Missing Traceability for 22 Normative Test/Recovery Cases and 10 Claims

#### Audit Findings
A full audit of all identifiers in `gauntlet-game-studio.spec.yaml` revealed **193 unique IDs**:
- 151 `REQ-*` normative requirements (100% mapped to tasks in `plan.traceability.requirement_to_tasks`).
- 14 `VAR-*` variations (`VAR-001` through `VAR-014`).
- 8 `RECOV-*` recovery cases (`RECOV-001` through `RECOV-008`).
- 10 `CLAIM-*` hypothesis claims (`CLAIM-001` through `CLAIM-010`).
- 9 `NONGOAL-*` statements.
- 1 `metadata.id`.

#### The Problem:
1. `gauntlet-game-studio.spec.yaml` explicitly states in line 1632:
   > `capability_claim_rule: A capability claim remains unverified until every REQUIRED variation and recovery case applicable to the target environment has passed.`
2. In Task `T24` line 2309, the step says:
   > `- Execute all VAR-001..VAR-014 and RECOV-001..RECOV-008 cases applicable to the target environment and preserve`
3. **However, `T24.settles` omits them completely!**
   `T24.settles` only contains: `['REQ-SAFE-001', 'REQ-SAFE-005', 'REQ-SEC-002', 'REQ-SEC-003', 'REQ-DONOR-004']`.
4. The plan's `traceability` declares:
   ```yaml
   spec_requirement_count: 151
   mapped_requirement_count: 151
   unmapped_requirements: []
   ```
   It completely ignores the 14 `VAR-*` cases, 8 `RECOV-*` cases, and 10 `CLAIM-*` claims.
5. When `scripts/check-traceability.py` is created in Task `T00` and executed in `T25`, an automated scan looking for all IDs in the spec will report **22 unmapped normative test/recovery cases**.

#### Actionable Recommendation
- Update `T24.settles` to explicitly include `VAR-001..VAR-014` and `RECOV-001..RECOV-008`.
- Expand `plan.traceability` to either:
  a. Include `VAR-*` and `RECOV-*` in `requirement_to_tasks` (adjusting `spec_requirement_count: 173`), OR
  b. Add a dedicated `variations_and_recovery_to_tasks` mapping section in `traceability`.

---

## 4. Graph & Planning Sequencing Inconsistencies

### 4.1 [MAJOR] Critical Path Discrepancy: Declared 14 Tasks vs. True Longest Path 17 Tasks

#### The Defect
In [`gauntlet-game-studio.plan.yaml` L473-L490](file:///home/sprime01/projects/gauntlet-game-studio/.agents/plans/gauntlet-game-studio.plan.yaml#L473-L490), the plan declares:
```yaml
critical_path:
  - T00
  - T01
  - T02
  - T07
  - T08
  - T09
  - T12
  - T19
  - T20
  - T21
  - T22
  - T23
  - T24
  - T25
```
This declared path has **length 14**.

#### Graph Theory & DAG Analysis:
When computing the actual topological longest path from `T00` to `T25` using the declared `depends_on` edges:
1. `T07` depends on `['T02', 'T05', 'T06']`.
2. `T05` depends on `['T03', 'T04']`.
3. `T04` depends on `['T03']`.
4. `T03` depends on `['T02']`.
5. Therefore, reaching `T07` from `T02` requires traversing:
   `T02 -> T03 -> T04 -> T05 -> T07` (4 edges, 5 nodes).
   **The declared critical path jumped directly from `T02` to `T07`**, skipping `T03`, `T04`, and `T05`!
6. Furthermore, downstream from `T08`:
   - `T08 -> T10 -> T11 -> T19` (3 edges)
   - `T08 -> T09 -> T12 -> T19` (3 edges)
7. The **true critical path has length 17**:
   `T00 -> T01 -> T02 -> T03 -> T04 -> T05 -> T07 -> T08 -> T10 -> T11 -> T19 -> T20 -> T21 -> T22 -> T23 -> T24 -> T25`

#### Actionable Recommendation
Update `dependency_graph.critical_path` in `gauntlet-game-studio.plan.yaml` to the true 17-task sequence:
```yaml
critical_path:
  - T00
  - T01
  - T02
  - T03
  - T04
  - T05
  - T07
  - T08
  - T10
  - T11
  - T19
  - T20
  - T21
  - T22
  - T23
  - T24
  - T25
```

---

## 5. Execution Environment, Observability & Verification Traps

### 5.1 Playwright Headless WebGL & Canvas `preserveDrawingBuffer` Pitfall

#### The Risk
In Tasks `T20`, `T21`, and `T22`, Playwright executes end-to-end browser verification of Three.js scenes, capturing screenshots for pixel channel evidence.
1. **SwiftShader / Software Rasterizer Requirement**:
   On headless Linux runners without a dedicated GPU, Chromium will fail to create a WebGL context (`canvas.getContext('webgl')` returns `null`) unless launched with:
   `--use-gl=angle`, `--use-gl=swiftshader`, `--enable-webgl`, and `--ignore-gpu-blocklist`.
2. **Black Screenshots from `preserveDrawingBuffer`**:
   By default in WebGL, drawing buffers are cleared immediately after presentation. If Playwright captures a canvas element screenshot or calls `toDataURL()`, it will capture empty/black pixels unless:
   - `preserveDrawingBuffer: true` is set on `WebGLRenderer({ preserveDrawingBuffer: true })` during verification runs, OR
   - Screenshots are taken at full-page level immediately following a deterministic render step.

#### Actionable Recommendation
- Explicitly document in `packages/adapters/src/browser/` and `playwright.config.ts` that Chromium launch args must include `--use-gl=angle` and `--ignore-gpu-blocklist`.
- Ensure `window.__GAME_STUDIO__.captureFrame()` triggers an explicit render call before extracting image data.

---

### 5.2 Headless CI Frame-Time Telemetry vs. Hardware Variance

#### The Risk
- `REQ-PERF-001..004` and Task `T21` gate on frame-time metrics (`frame_time_ms`, `fps`).
- Task `T21` tooth:
  > *"Inject a deliberate frame-time/draw-call regression without changing screenshots or semantic state -> Performance verification fails..."*
- In headless CI using SwiftShader software emulation, frame times can be 5x to 20x slower than on hardware GPUs, with high variance depending on CPU load.
- If performance budgets in `test-budget` use rigid absolute milliseconds (e.g. `< 16.6ms` for 60fps), automated tests in headless CI will fail or flake continuously.

#### Actionable Recommendation
- In `packages/studio/src/gauntlet/performance.ts`, enforce a strict distinction between:
  1. **Structural Renderer Budgets** (Hardware-independent, 100% deterministic in CI):
     `renderer_draw_calls`, `renderer_triangles`, `renderer_textures`, `console_error_count`.
  2. **Timing / Frame-Time Budgets** (Hardware-dependent):
     Must use profile-specific configurations (`profiles/ci-software.yaml` vs `profiles/desktop-target.yaml`) or relative baseline comparisons (asserting regression delta > 25% relative to a committed baseline run).

---

## 6. Repository Scaffolding & Pre-Execution State

### 6.1 Missing Initial State Files

An inventory of the current repository against the plan prerequisites indicates:
- `.agents/CURRENT_STATUS.yml` does not exist (only `.agents/CURRENT_STATUS.template.yml` exists).
- `package.json` and `bun.lock` do not exist.
- `justfile` does not exist.
- `scripts/check-traceability.py` and `scripts/verify-plan-source.py` do not exist.
- `.agents/preregistrations/` and `.agents/decisions/` directories do not exist.

### 6.2 Circular Gate Dependency in `T00`
Task `T00` gate declares:
```bash
test -f AGENTS.md && test -f .agents/CURRENT_STATUS.yml
git check-ignore .tmp/donor
just validate-agent-artifacts
```
For `just validate-agent-artifacts` to pass, `justfile` must exist. Task `T00` is responsible for creating `justfile` and `.agents/CURRENT_STATUS.yml`.  
**Confirmation**: This is valid under the settlement model, provided `T00` creates these files in its first step before the gate is evaluated.

---

## 7. Actionable Remediation Checklist

To transition both artifacts to an approved, airtight, and immediately executable state, apply the following modifications:

1. **Decouple from `geckos.io` in Default Server Mode**:
   - Update `REQ-BIND-013` to designate **Bun Native WebSockets** (`Bun.serve({ websocket: ... })`) as the primary real-time multiplayer transport.
   - Retain WebRTC/geckos.io as an optional secondary adapter.
   - Configure `"trustedDependencies": ["node-datachannel"]` in `package.json` if `geckos.io` is retained in any adapter.
2. **Purge `three.terrain.js`**:
   - Remove `three.terrain.js` from `T10` steps and redesign triggers.
   - Implement procedural elevation generation directly into `TerrainHeightfield`'s `Float32Array` using standard mathematical noise functions.
3. **Add `REQ-BIND-015` for Rapier**:
   - Add `REQ-BIND-015` binding `@dimforge/rapier3d-compat` to `core_behavior_requirements.current_preferred_bindings`.
4. **Correct Plan Critical Path**:
   - Update `dependency_graph.critical_path` in `gauntlet-game-studio.plan.yaml` to include `T03`, `T04`, and `T05`, matching the true longest path of 17 tasks.
5. **Map `VAR-*` and `RECOV-*` in Plan Traceability**:
   - Add `VAR-001..VAR-014` and `RECOV-001..RECOV-008` to Task `T24.settles`.
   - Update `plan.traceability.requirement_to_tasks` and `spec_requirement_count` to cover all 173 normative requirements and test/recovery cases.
6. **Specify Web Audio Mocking Interface**:
   - Explicitly define `NullAudioBackend` in `packages/runtime/src/audio/` so headless tests in `T17` execute without crashing on Web Audio API calls.
7. **Make glTF-Transform KTX2 Compression Optional**:
   - Standardize on WebP for baseline texture optimization; require `toktx` preflight before attempting KTX2 compression.
8. **Approve and Freeze Normative Specification**:
   - Promote `metadata.status` from `draft` to `approved` in `.agents/specs/gauntlet-game-studio.spec.yaml`.
   - Recompute SHA-256 and bind the frozen hash into `gauntlet-game-studio.plan.yaml`.
