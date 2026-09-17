# How-To Guide: Debug Subsystem Readiness Failures

This guide explains how to diagnose and resolve runtime initialization failures caused by the `SubsystemBarrier`.

---

## 1. Symptom & Error Signatures

When running a game in the browser, in tests, or under Playwright, the simulation halts and throws one of these errors:
```text
RuntimeNotReadyError: Cannot advance simulation: runtime is in state 'booting' (required: ['physics', 'navigation'])
```
Or:
```text
SubsystemBootError: Subsystem 'physics' failed to boot: RuntimeError: Aborted() due to WASM compilation failure
```

---

## 2. Step 1: Inspect Readiness via the Observability Bridge

If the game is running in a browser:
1. Open the Developer Tools console (`F12`).
2. Query the readiness state:
   ```javascript
   window.__GAUNTLET_STUDIO_OBS__.readiness()
   ```

**Example Output**:
```json
{
  "state": "booting",
  "required_subsystems": ["physics", "navigation", "audio"],
  "subsystem_states": {
    "physics": "ready",
    "navigation": "ready",
    "audio": "booting"
  },
  "failure": null,
  "started_at": "2026-09-16T21:00:00.000Z"
}
```
*Diagnosis: `audio` is still in the `booting` state, preventing overall runtime readiness.*

---

## 3. Common Root Causes & Fixes

### Cause A: Audio Subsystem Waiting for User Gesture
- **Root Cause**: Browsers do not allow WebAudio contexts (`Tone.js`) to start without a real user gesture. In automated headless tests or automated loads, `ToneAudioBackend` remains in state `"locked"` or `"suspended"`.
- **Fix**:
  - **In Headless / CI Tests**: Use `NullAudioBackend` instead of `ToneAudioBackend`. `NullAudioBackend` immediately reports `state: "ready"` without touching browser audio contexts:
    ```typescript
    import { NullAudioBackend } from "@gauntlet/runtime";
    const audio = new NullAudioBackend();
    barrier.markReady("audio");
    ```
  - **In Browser Proofs (Playwright)**: Perform a synthetic click on the viewport canvas to unlock audio before advancing scenarios:
    ```typescript
    await page.locator("canvas").click();
    ```

### Cause B: Rapier 3D WebAssembly Loading Failure
- **Root Cause**: `@dimforge/rapier3d-compat` loads a `.wasm` binary via `fetch()`. If your local development server or bundler does not serve `.wasm` with MIME type `application/wasm`, initialization hangs or fails.
- **Fix**:
  - Ensure your bundler (Bun / Vite) supports WASM imports:
    ```typescript
    import RAPIER from "@dimforge/rapier3d-compat";
    await RAPIER.init();
    barrier.markReady("physics");
    ```
  - In `scripts/bundle.ts`, verify that `.wasm` assets are copied to `dist/`.

### Cause C: Recast NavMesh Generation on Degenerate Geometry
- **Root Cause**: If procedural terrain heightfield coordinates contain `NaN` or infinite elevation values, Recast fails to calculate navmesh triangles and throws.
- **Fix**:
  - Check canonical terrain bounds in `heightfield.ts`. Ensure `min_height` and `max_height` are finite numbers.
  - Test navmesh generation in isolation:
    ```bash
    bun test packages/runtime/test/navigation.test.ts
    ```

---

## 4. Diagnostic Checklist

1. [ ] Check `readiness().subsystem_states` to find which specific subsystem is not `"ready"`.
2. [ ] Verify that non-essential subsystems are registered with `required = false`:
   ```typescript
   barrier.register("optional-vfx", false);
   ```
3. [ ] Confirm that `markReady(id)` or `markFailed(id, reason)` is called inside a `try/catch/finally` block around every async loader.
4. [ ] In headless test environments, verify that no browser-only subsystem (`tone-audio`, `dom-hud`) is registered in `required_subsystems`.
