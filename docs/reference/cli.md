# Technical Reference: Studio CLI (`apps/studio-cli`)

This reference details the full syntax, options, input parameters, exit codes, and machine-readable JSON schemas for the Gauntlet Game Studio CLI (`studio`).

---

## 1. Global Invocations & Flags

### Command Syntax
```bash
bun run studio -- <command> [subcommand] [flags...]
```

### Global Flags
| Flag | Type | Description |
| :--- | :--- | :--- |
| `--json` | boolean | Output the final result as a machine-readable JSON object conforming to `StudioResult`. Disables decorative terminal styling. |
| `--help`, `-h` | boolean | Display usage information and exit. |
| `--version`, `-v`| boolean | Display CLI version (`0.3.0`). |

### Exit Codes
- `0`: **Success** — The operation completed cleanly (e.g. diagnostics passed, scenario settled, asset registered).
- `1`: **Error / Failure** — An unexpected exception occurred, validation failed, or a scenario assertion failed.
- `2`: **Blocked** — The operation could not proceed due to missing environmental prerequisites (e.g. headless Chrome unavailable for browser proof).

---

## 2. Commands & Subcommands

### `studio doctor`
Runs preflight environment and monorepo health diagnostics.
- **Syntax**: `studio doctor [--json]`
- **Checks Performed**:
  1. `bun_version`: Confirms Bun `>= 1.4.0`.
  2. `donor_isolation_gitignore`: Confirms `.tmp/` is present in `.gitignore`.
  3. `donor_dependency_check`: Confirms zero donor dependencies in root `package.json`.
  4. `configuration_integrity`: Validates configuration schemas and secret masking.
  5. `workspace_packages`: Confirms all 5 workspace packages are present.
- **JSON Output**:
  ```json
  {
    "status": "success",
    "operation": "doctor",
    "result": {
      "overall": "SUCCESS",
      "checks": [
        { "name": "bun_version", "status": "pass", "message": "Bun v1.4.0 satisfies baseline (>= 1.4.0)" }
      ]
    }
  }
  ```

---

### `studio create <target-path>`
Scaffolds an independent game project outside the monorepo.
- **Syntax**: `studio create <path> [--name <name>] [--template <dir>] [--json]`
- **Arguments**:
  - `<target-path>` (required): Directory where the new project will be created.
  - `--name <string>` (optional): Project name in `package.json` (defaults to directory basename).
  - `--template <string>` (optional): Alternate template directory (defaults to `templates/game/`).
- **JSON Output**:
  ```json
  {
    "status": "success",
    "operation": "create",
    "result": {
      "project_name": "mars-rover",
      "path": "/path/to/mars-rover",
      "files": ["package.json", "studio.lock.yaml", "AGENTS.md", "src/index.ts", "tests/game.test.ts"]
    }
  }
  ```

---

### `studio capabilities` & `studio capability`
Inspects, lints, and executes studio capabilities.

#### `studio capabilities`
Lists all registered capabilities.
- **Syntax**: `studio capabilities [--json]`

#### `studio capabilities lint`
Lints all capability and skill descriptors against studio constraints.
- **Syntax**: `studio capabilities lint [--json]`
- **Rules**: Descriptions between 200–400 chars; positive triggers declared; negative boundaries declared; forbidden upstream directors rejected.

#### `studio capability route`
Routes an intent string to a capability.
- **Syntax**: `studio capability route --intent "<intent>" [--ref <id>] [--json]`
- **JSON Output**:
  ```json
  {
    "status": "success",
    "operation": "capability.route",
    "result": {
      "status": "routed",
      "capability_id": "asset.reconstruct",
      "provider": "agent-skill.img2threejs",
      "is_agent_handoff": true
    }
  }
  ```

#### `studio capability prepare <capability-id>`
Prepares an `AgentHandoff` envelope for an admitted request.
- **Syntax**: `studio capability prepare <id> --request <request.json> [--json]`

#### `studio capability verify-result <capability-id>`
Deterministically verifies the output of an agent handoff.
- **Syntax**: `studio capability verify-result <id> --result <result.json> [--json]`

---

### `studio asset`
Controls the production asset registry.

#### `studio asset register`
Ingests an asset record.
- **Syntax**:
  ```bash
  studio asset register \
    --id <id> \
    --role <role> \
    --origin <user|project|cc0|licensed|generated|blender|procedural> \
    --source <path> \
    [--license <license>] \
    [--route <route>] \
    [--json]
  ```

#### `studio asset verify`
Audits registered assets against acceptance gates.
- **Syntax**: `studio asset verify [--id <id>] [--all] [--json]`

#### `studio asset compile`
Runs glTF-Transform optimization.
- **Syntax**: `studio asset compile --input <in.glb> --output <out.glb> [--webp | --ktx2] [--json]`

---

### `studio verify`
Executes Gauntlet proof scenarios in headless Chrome and evaluates evidence.
- **Syntax**:
  ```bash
  studio verify \
    --scenario <scenario-id> \
    --profile <desktop-high | desktop-low | mobile> \
    [--suite <suite-name>] \
    [--json]
  ```
- **Exit Codes**:
  - `0`: Expectation settled cleanly.
  - `1`: Assertion failure, budget overage, or cross-channel contradiction.
  - `2`: Headless browser proof unavailable in environment.
- **JSON Output**:
  ```json
  {
    "status": "success",
    "operation": "verify",
    "result": {
      "decision": "settled",
      "scenario_id": "beacon-activation",
      "contradictions": [],
      "run_id": "run-2026-09-16-01",
      "manifest_id": "manifest-01",
      "record_id": "settle-01"
    }
  }
  ```

---

### `studio evidence`
Inspects the immutable evidence store.
- **`studio evidence list`**: Lists all recorded runs in `artifacts/runs/`.
- **`studio evidence check-fixtures`**: Verifies deterministic proof fixtures against frozen expectations.
