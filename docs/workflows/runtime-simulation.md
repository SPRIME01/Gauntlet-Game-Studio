# Execution Trace: Simulation Tick & Projection Lifecycle

This trace details the inner execution lifecycle of a single simulation tick in the Gauntlet Runtime, illustrating how wall-clock time is converted into deterministic fixed sub-steps, how the single step owner mutates Koota state, and how execution projections are synchronized.

---

## 1. Summary

The Gauntlet Runtime decouples the browser render loop (`requestAnimationFrame`) from gameplay simulation. The `SimulationScheduler` accumulates wall-clock elapsed time and advances the game in fixed 60Hz sub-steps (16.66ms). During each sub-step, exactly one registered step owner executes game logic, mutating entities in Koota ECS (`GameWorld`). Downstream execution projections (Three.js render meshes, Rapier physics colliders, Recast navigation agents, Tone audio emitters, and DOM HUD) synchronize one-way from Koota state.

---

## 2. Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    participant Loop as Browser Loop (rAF) / Headless Runner
    participant Sched as SimulationScheduler
    participant Hook as Registered Step Owner (e.g. stepGame)
    participant Koota as GameWorld (Koota ECS)
    participant Rapier as RapierPhysicsAdapter
    participant Recast as RecastNavigationAdapter
    participant Render as RenderProjectionManager (Three.js)
    participant HUD as DomHudRenderer

    Loop->>Sched: advance(deltaTime)
    Note over Sched: accumulator += min(deltaTime, fixedDeltaTime * maxSubSteps)
    
    loop While accumulator >= fixedDeltaTime
        Sched->>Sched: stepSingleTick()
        Sched->>Hook: executeStepOwner("game", stepFn)
        
        Note over Hook: Game Logic (e.g., input handling, AI decisions)
        Hook->>Koota: Mutate entity traits (Transform, Velocity, Tags)
        
        Hook->>Rapier: Step physics world (single tick step)
        Rapier-->>Koota: Update entity dynamic transforms from physics contacts
        
        Hook->>Recast: Step crowd simulation (crowd.update(dt))
        Recast-->>Koota: Update agent positions
        
        Hook->>Render: syncFromWorld(gameWorld)
        Note over Render: Copy Koota transforms to THREE.Object3D instances
        
        Hook->>HUD: update(hudState)
        Note over HUD: Update score, health, prompts in DOM
        
        Sched->>Sched: accumulator -= fixedDeltaTime
    end
    
    Loop->>Sched: getAlpha() (for render interpolation)
    Loop->>Render: renderer.render(scene, camera)
```

---

## 3. Detailed Execution Steps

### Step 1: Accumulator & Fixed Sub-stepping
In [`packages/runtime/src/scheduler.ts`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/scheduler.ts#L43):
- The caller invokes `advance(deltaTime)`.
- To prevent the "spiral of death" during lag spikes, `deltaTime` is clamped to `fixedDeltaTime * maxSubSteps` (default: 5 sub-steps, or 83.3ms).
- While `accumulator >= 1/60`, the scheduler calls `stepSingleTick()`.

### Step 2: Single Step Owner Invariant Enforcement
In [`packages/runtime/src/scheduler.ts`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/scheduler.ts#L82):
- `SimulationScheduler.executeStepOwner(ownerName, stepFn)` executes the gameplay callback.
- The scheduler tracks `steppedThisTick`. If a secondary system or duplicate owner attempts to step during the same tick, the scheduler throws `DuplicateStepOwnerError`. This ensures game systems cannot race or step out of sequence.

### Step 3: Game Systems & Authoritative State Mutation
Inside `stepGame()` (in [`examples/blackwater-relay/src/game/systems.ts`](file:///home/sprime01/projects/gauntlet-game-studio/examples/blackwater-relay/src/game/systems.ts)):
- **Input Processing**: Rover steering and throttle commands are converted into forces or direct velocity mutations on the rover's `Velocity` trait.
- **Objective Evaluation**: Checks rover distance to power cell and transceiver. If within range, updates `cell` trait to `delivered` and `gate` trait to `open`.
- **AI Steering**: Queries Recast crowd agents for autonomous service drone waypoints.

### Step 4: Physics & Navigation Integration
- **Rapier Physics**: `RapierPhysicsAdapter.step()` advances the Rapier rigid body world. Contact events are converted into semantic triggers. Dynamic body transforms update the corresponding Koota `Transform` trait.
- **Recast Navigation**: `RecastNavigationAdapter.update(dt)` advances crowd agents along their navigation corridors.
- Both adapters operate strictly as subordinates to the single simulation tick.

### Step 5: One-Way Projection Synchronization
- **Render Projection**: [`RenderProjectionManager.syncFromWorld(gameWorld)`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/projections/render.ts) iterates over entities with `RenderProjectionHandle`:
  - Copies `Transform.position` and `Transform.rotation` to `THREE.Object3D.position` and `THREE.Object3D.quaternion`.
  - Sets `THREE.Object3D.visible` based on `RenderProjectionHandle.visible`.
  - Projections never write back to Koota.
- **DOM HUD**: [`DomHudRenderer`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/ui/dom-hud.ts) reads high-level HUD state and updates text nodes. If running in a headless environment, HUD updates are cleanly skipped.

---

## 4. Failure Branches & Error Handling

| Failure Condition | Detection Mechanism | Consequence | Recovery Path |
| :--- | :--- | :--- | :--- |
| **Duplicate Step Owner** | Second caller invokes `executeStepOwner` in same tick | `DuplicateStepOwnerError` | Remove competing step call; consolidate into primary game step hook |
| **Multiple Schedulers** | Second `SimulationScheduler` constructed | `MultipleSchedulerError` | Use the singleton kernel scheduler via `kernel.scheduler` |
| **DOM Access in Headless** | Render projection or HUD touches `document` in headless mode | `HeadlessDomLeakError` | Guard DOM calls behind `isHeadless` checks; use `NullAudioBackend` |
| **Provider Leaks into State** | Trait object contains `THREE.Mesh` or `Rapier.RigidBody` | `GameWorld.assertValidSemanticData()` throws | Pass only primitive coordinates, IDs, or plain data structures into traits |

---

## 5. Source Trail

- **Simulation Scheduler**: [`packages/runtime/src/scheduler.ts`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/scheduler.ts)
- **Koota World & Traits**: [`packages/runtime/src/state/world.ts`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/state/world.ts), [`packages/runtime/src/state/traits.ts`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/state/traits.ts)
- **Render Projections**: [`packages/runtime/src/projections/render.ts`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/projections/render.ts)
- **Physics Integration**: [`packages/runtime/src/physics/rapier.ts`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/physics/rapier.ts)
- **Navigation Integration**: [`packages/runtime/src/navigation/recast.ts`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/navigation/recast.ts)
- **Reference Game Systems**: [`examples/blackwater-relay/src/game/systems.ts`](file:///home/sprime01/projects/gauntlet-game-studio/examples/blackwater-relay/src/game/systems.ts)
- **Scheduler & Readiness Tests**: [`packages/runtime/test/scheduler.test.ts`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/test/scheduler.test.ts)
