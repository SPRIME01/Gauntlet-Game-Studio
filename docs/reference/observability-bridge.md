# Technical Reference: Observability Bridge (`__GAUNTLET_STUDIO_OBS__`)

This reference specifies the standardized browser global interface `window.__GAUNTLET_STUDIO_OBS__` (version 1). It enables deterministic inspection, telemetry sampling, and test control for Playwright test runners and coding agents.

---

## 1. Overview & Versioning

The bridge is mounted on the global browser window by `createObservabilityBridge()` in [`packages/runtime/src/observability/bridge.ts`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/observability/bridge.ts).

### Contract Header
Every mounted bridge exposes metadata:
```typescript
window.__GAUNTLET_STUDIO_OBS__.header = {
  contract: "gauntlet.runtime.observability",
  version: "1.0"
};
```

---

## 2. Read-Only Namespaces (Available in All Modes)

The following APIs are accessible in development, test, and production builds:

### `readiness(): RuntimeReadiness`
Returns the current readiness state of all registered asynchronous subsystems:
```typescript
const readiness = window.__GAUNTLET_STUDIO_OBS__.readiness();
// {
//   state: "ready",
//   required_subsystems: ["physics", "navigation"],
//   subsystem_states: { "physics": "ready", "navigation": "ready" },
//   failure: null,
//   started_at: "...",
//   ready_at: "..."
// }
```

### `entities` (Entity State Inspection)
Reads authoritative gameplay state from Koota ECS (`GameWorld`):
- **`entities.get(id: string): SerializedEntityState | null`**: Returns the serialized traits (`transform`, `velocity`, `tags`) for a specific entity ID.
- **`entities.query(tag: string): SerializedEntityState[]`**: Returns all entities possessing the specified tag (e.g. `"player"`, `"enemy"`).
- **`entities.snapshot(): SemanticStateSnapshot`**: Returns a complete, frozen dump of all entities in the game world.

### `tick` (Simulation Clock)
Reads authoritative scheduler timing:
- **`tick.getTick(): number`**: Current fixed simulation tick index.
- **`tick.getTime(): number`**: Total elapsed simulation time in seconds.
- **`tick.getAlpha(): number`**: Fractional accumulator value (0.0 to 1.0) used for rendering interpolation.

### `renderer` (Graphics Statistics & Probe)
Queries the Three.js WebGL renderer:
- **`renderer.stats(): ObservabilityRendererStats`**:
  ```json
  {
    "draw_calls": 38,
    "triangles": 34200,
    "geometries": 12,
    "textures": 8,
    "fps": 60.0,
    "frame_time_ms": 16.2
  }
  ```
- **`renderer.probe()`**: Returns GPU hardware information and supported WebGL extensions.

### `physics` & `navigation`
- **`physics.dump()`**: Dumps active Rapier rigid body count, collider count, and broadphase statistics.
- **`navigation.status()`**: Returns Recast navmesh status, tile count, and active crowd agent coordinates.

### `network` (Multiplayer Diagnostics)
Available when multiplayer mode is active:
- Returns client connection state, ping (round-trip time in ms), ingress/egress bytes per second, packet drop rate, and sequence acknowledgment lag.

### `views` (Named Camera Views)
- **`views.list(): string[]`**: Returns available camera angles (e.g. `["player_follow", "summit_overhead", "cinematic_flythrough"]`).
- **`views.current(): ObservabilityCameraView`**: Returns active camera position, target coordinates, and FOV.

### `errors` (Error Buffer)
- **`errors.recent(): ObservabilityErrorEntry[]`**: Returns a ring buffer of the last 100 unhandled exceptions or shader compilation warnings.

---

## 3. Privileged Control Namespace (`control`)

> [!WARNING]
> **DEVELOPMENT & TEST BUILDS ONLY**:
> The `control` namespace is installed **only** when `mode: "development"` or `mode: "test"`. It is structurally stripped from production builds.

| Method | Signature | Description |
| :--- | :--- | :--- |
| `pause()` | `() => void` | Freezes simulation advancing. |
| `resume()` | `() => void` | Resumes normal simulation ticking. |
| `step(ticks)` | `(ticks: number) => void` | Advances simulation by a fixed number of ticks (clamped to max 240 ticks). |
| `setSeed(seed)` | `(seed: number) => void` | Reseeds deterministic procedural generators. |
| `resetScenario(name)` | `(name: string) => void` | Resets game entities to declared scenario initial conditions. |
| `selectView(name)` | `(name: string) => void` | Switches the active camera to a named viewpoint. |
| `clearErrors()` | `() => void` | Clears the error ring buffer. |

---

## 4. Production Hardening & Mutation Lockout

In production mode (`mode: "production"`):
1. The `control` property on `window.__GAUNTLET_STUDIO_OBS__` is `undefined`.
2. No methods capable of mutating entity state, modifying transforms, or stepping ticks exist on the window surface.
3. **Automated Audit**: The script `packages/runtime/src/observability/production-check.ts` runs [`inspectProductionSurface()`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/observability/production-check.ts) in CI:
   - Scans the mounted object for forbidden keys (`step`, `pause`, `resume`, `resetScenario`, `setSeed`).
   - Asserts that all returned objects from `entities` are read-only copies (`Object.freeze`), preventing external JavaScript from mutating internal Koota references.
   - Fails the build if any mutation vector is detected.

---

## 5. Source Trail

- **Bridge Implementation**: [`packages/runtime/src/observability/bridge.ts`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/observability/bridge.ts)
- **Contract Interface & Types**: [`packages/runtime/src/observability/contract.ts`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/observability/contract.ts)
- **Production Surface Inspector**: [`packages/runtime/src/observability/production-check.ts`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/src/observability/production-check.ts)
- **Playwright Surface Client**: [`packages/adapters/src/browser/surface-client.ts`](file:///home/sprime01/projects/gauntlet-game-studio/packages/adapters/src/browser/surface-client.ts)
- **Observability Tests**: [`packages/runtime/test/observability.test.ts`](file:///home/sprime01/projects/gauntlet-game-studio/packages/runtime/test/observability.test.ts)
