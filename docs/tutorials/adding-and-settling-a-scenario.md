# Tutorial: Adding & Settling a Gameplay Scenario

This tutorial guides you through adding a new gameplay scenario to Blackwater Relay and proving its completion through Gauntlet tri-channel verification. You will declare the scenario, write its initial entity conditions, author a frozen expectation contract, run automated verification via Playwright, and inspect the resulting `SettlementRecord`.

---

## Prerequisites
- Working knowledge of the [System Mental Model](file:///home/sprime01/projects/gauntlet-game-studio/docs/mental-model.md).
- Access to the `examples/blackwater-relay` project directory.
- Playwright Chromium installed (`bun x playwright install chromium`).

---

## Step 1: Declare the Scenario in the Game Specification

Open `examples/blackwater-relay/.agents/specs/game.spec.yaml`. Add your new scenario to the list of declared scenarios:

```yaml
scenarios:
  - id: emergency-beacon-flare
    description: "The rover triggers an emergency flare at the relay tower summit."
    initial_conditions:
      rover: "at-summit"
      flare: "primed"
      beacon: "active"
```

---

## Step 2: Implement the Scenario Initial Conditions

Open [`examples/blackwater-relay/src/game/build.ts`](file:///home/sprime01/projects/gauntlet-game-studio/examples/blackwater-relay/src/game/build.ts).
Update `SCENARIO_IDS` and `SCENARIO_PROGRAMS` to configure the authoritative initial state when this scenario is loaded:

```typescript
export const SCENARIO_IDS = [
  "boot",
  "active-play",
  "transceiver-interaction",
  "patrol-obstacle",
  "beacon-activation",
  "performance-flythrough",
  "emergency-beacon-flare", // New scenario
] as const;

export const SCENARIO_PROGRAMS: Record<ScenarioId, ScenarioProgram> = {
  // ... existing scenarios ...
  "emergency-beacon-flare": {
    rover: "beacon-run",
    cell: "delivered",
    gate: "open",
    obstacle: false,
    dronePatrol: false,
  },
};
```

When `bridge.control.resetScenario("emergency-beacon-flare")` is called, the game core will automatically position the rover at the summit coordinates and open the security gate.

---

## 3. Author the Frozen Expectation Contract

Create a new frozen expectation file at `examples/blackwater-relay/tests/expectations/emergency-beacon-flare.yaml`:

```yaml
schema: gauntlet.frozen_expectation
schema_version: "1.0"
scenario_id: emergency-beacon-flare
requirement_ids:
  - REQ-GOAL-006 # Flare activation requirement

simulation:
  ticks_to_advance: 120 # Advance 2 simulated seconds (at 60Hz)

channels:
  # 1. Authoritative State Channel
  state:
    assertions:
      - entity_id: "beacon"
        trait: "lamp"
        field: "state"
        equals: "active"
      - entity_id: "rover"
        trait: "transform"
        field: "position[1]"
        greater_than: 12.0 # Summit elevation

  # 2. Visible Pixel Channel
  pixels:
    viewport:
      width: 1280
      height: 720
    camera_view: "summit_overhead"
    assertions:
      - target: "viewport"
        metric: "mean_luminance"
        greater_than: 0.35 # Validates that emissive beacon light is rendering

  # 3. Telemetry Channel
  telemetry:
    quality_profile: "desktop-high"
    assertions:
      - metric: "draw_calls"
        less_than_or_equal: 45
      - metric: "triangles"
        less_than_or_equal: 50000
```

---

## Step 4: Run Gauntlet Verification

Execute the scenario verification via the studio CLI:

```bash
bun run studio -- verify \
  --scenario emergency-beacon-flare \
  --profile desktop-high \
  --json
```

### What Happens Under the Hood:
1. The CLI launches Playwright with headless Chromium.
2. The browser navigates to `dist/index.html` and waits for `SubsystemBarrier` to report `ready`.
3. Playwright calls `window.__GAUNTLET_STUDIO_OBS__.control.resetScenario("emergency-beacon-flare")`.
4. It calls `control.step(120)`, advancing 120 simulation ticks deterministically.
5. It takes a Koota entity snapshot, captures a canvas PNG screenshot, and reads renderer statistics.
6. The Gauntlet settlement engine evaluates all three channels and verifies that no cross-channel contradictions exist.

---

## Step 5: Inspect the Emitted Settlement Artifacts

Upon completion, inspect the JSON output:

```json
{
  "status": "success",
  "operation": "verify",
  "result": {
    "decision": "settled",
    "scenario_id": "emergency-beacon-flare",
    "contradictions": [],
    "run_id": "run-2026-09-16-flare",
    "record_id": "settle-flare-001"
  }
}
```

Now check the immutable evidence stored under `artifacts/runs/`:
```text
artifacts/runs/run-2026-09-16-flare/
├── observation.json       # Metadata, revision commit hash, seed
├── manifest.json          # Artifact links and SHA-256 checksums
├── screenshot.png         # Captured viewport showing emissive beacon
├── state_dump.json        # Full Koota entity registry snapshot
└── telemetry.json         # Draw call, triangle, and FPS metrics
```

You have successfully defined, executed, and settled a new gameplay increment using Gauntlet tri-channel proof!
