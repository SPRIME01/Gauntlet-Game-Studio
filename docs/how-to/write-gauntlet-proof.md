# How-To Guide: Write and Execute a Gauntlet Proof

This guide walks you through authoring a `FrozenExpectation` contract and running Gauntlet tri-channel verification against an observable browser game scenario.

---

## 1. Overview

A Gauntlet Proof verifies that a game feature meets its normative requirements across **state** (Koota ECS truth), **pixels** (rendered canvas appearance), and **telemetry** (performance budgets). A proof consists of:
1. A **Scenario Implementation**: Authoritative initial state programmed into the game core.
2. A **Frozen Expectation File**: A YAML contract specifying pass/fail criteria.
3. A **Settlement Run**: Executed by Playwright via `studio verify`.

---

## 2. Step 1: Create the Expectation Contract

Create a YAML file in your game's test expectations directory (e.g., `tests/expectations/relay-docking.yaml`):

```yaml
schema: gauntlet.frozen_expectation
schema_version: "1.0"
scenario_id: relay-docking
requirement_ids:
  - REQ-GOAL-003 # Rover docking mechanic

simulation:
  ticks_to_advance: 180 # Advance 3 simulated seconds at 60Hz

channels:
  # Channel 1: State Truth (Koota ECS)
  state:
    assertions:
      - entity_id: "rover"
        trait: "docking"
        field: "is_docked"
        equals: true
      - entity_id: "docking-bay"
        trait: "lock"
        field: "state"
        equals: "latched"

  # Channel 2: Pixels (Visual Render)
  pixels:
    viewport:
      width: 1280
      height: 720
    camera_view: "docking_bay_cam"
    assertions:
      - target: "viewport"
        metric: "mean_luminance"
        greater_than: 0.25

  # Channel 3: Telemetry (Performance Budget)
  telemetry:
    quality_profile: "desktop-high"
    assertions:
      - metric: "draw_calls"
        less_than_or_equal: 40
      - metric: "triangles"
        less_than_or_equal: 45000
```

---

## 3. Step 2: Ensure the Observability Surface Exposes the Scenario

In your game's bootstrap code (e.g. `src/game/build.ts`), verify that the scenario is registered on the observability bridge:

```typescript
bridge.control.resetScenario = (scenarioName: string) => {
  if (scenarioName === "relay-docking") {
    // Position rover near the docking bay
    // Set rover docking velocity
    // Reset docking bay clamps
  }
};
```

---

## 4. Step 3: Run the Verification Command

Execute the verification through `studio verify`:

```bash
bun run studio -- verify \
  --scenario relay-docking \
  --profile desktop-high \
  --json
```

### Exit Codes:
- `0`: **Settled** — All channels passed; no contradictions; settlement record created.
- `1`: **Failed** — At least one channel assertion failed or a contradiction occurred.
- `2`: **Blocked** — Browser proof could not execute (e.g., headless Chrome missing or revision unavailable).

---

## 5. Step 4: Interpret the Settlement Report

When the command completes, examine the output JSON:

```json
{
  "status": "success",
  "operation": "verify",
  "result": {
    "decision": "settled",
    "scenario_id": "relay-docking",
    "contradictions": [],
    "run_id": "run-2026-09-16-docking",
    "manifest_id": "manifest-docking-01",
    "record_id": "settle-docking-01"
  }
}
```

### If Settlement Fails:
Look for `contradictions` and `blockage_class`:
```json
{
  "status": "failed",
  "operation": "verify",
  "result": {
    "decision": "failed",
    "blockage_class": "represented_but_deficient",
    "contradictions": ["pixels_pass_state_fail"],
    "reason": "Pixel luminance passed threshold, but rover entity reported is_docked = false."
  }
}
```
*Diagnosis: The docking animation played visually, but the gameplay system failed to set the authoritative `is_docked` trait in Koota ECS.*
