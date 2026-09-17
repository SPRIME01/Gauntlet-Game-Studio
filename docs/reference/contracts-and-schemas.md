# Technical Reference: Contracts & Schemas (`@gauntlet/contracts`)

This reference provides the authoritative specification for all Zod schemas and TypeScript data models exported by `@gauntlet/contracts`. Every schema is configured with `.strict()` to forbid extraneous properties.

---

## 1. Schema Catalog & Definitions

### `ArtifactRefSchema`
Represents an immutable reference to an on-disk artifact.

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` | No | Optional artifact identifier. |
| `path` | `string` | **Yes** | Relative path to the artifact file (`min(1)`). |
| `sha256` | `string` | No | SHA-256 digest of the artifact contents. |
| `role` | `string` | No | Role of artifact (e.g. `screenshot`, `state_dump`, `telemetry_log`). |
| `mime_type` | `string` | No | MIME type (e.g. `image/png`, `application/json`). |
| `size_bytes` | `number` | No | File size in bytes (non-negative integer). |

---

### `CapabilityDescriptorSchema`
Defines a stable studio affordance independently of current tools.

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` | **Yes** | Dotted namespace matching `^[a-z0-9]+(\.[a-z0-9_-]+)+$`. |
| `summary` | `string` | **Yes** | Summary description (10 to 1024 characters). |
| `use_when` | `string[]` | **Yes** | Array of positive trigger phrases (`min(1)`). |
| `do_not_use_when` | `string[]` | **Yes** | Array of negative affordance boundaries (default: `[]`). |
| `inputs` | `string[]` | **Yes** | Declared input parameter names. |
| `outputs` | `string[]` | **Yes** | Declared output artifact names. |
| `verification` | `string[]` | **Yes** | Declared verification check names. |
| `providers` | `string[]` | **Yes** | List of approved provider adapter IDs. |
| `cost_class` | `enum` | No | `"free"`, `"metered"`, `"quota"`, or `"expensive"`. |
| `requires_user_reference` | `boolean` | No | Whether request requires user-supplied reference images. |

---

### `CapabilityRequestSchema` & `CapabilityResultSchema`

#### `CapabilityRequestSchema`
Represents admitted work before provider selection.

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` | **Yes** | Unique request identifier. |
| `project_id` | `string` | **Yes** | Target game project identifier. |
| `capability_id` | `string` | **Yes** | Target capability namespace. |
| `intent` | `string` | **Yes** | Plain-language description of requested work. |
| `acceptance` | `string[]` | **Yes** | Acceptance criteria that must be verified (`min(1)`). |
| `inputs` | `Record<string, unknown>` | **Yes** | Input parameters (default: `{}`). |
| `preferred_provider` | `string` | No | Optional provider hint. |
| `quality_profile` | `string` | No | Target performance profile. |
| `reference_ids` | `string[]` | No | Associated reference asset IDs. |

#### `CapabilityResultSchema`
Normalizes the outcome of a provider invocation.

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` | **Yes** | Result identifier. |
| `request_id` | `string` | **Yes** | Originating `CapabilityRequest` ID. |
| `provider` | `string` | **Yes** | Concrete provider ID that executed the work. |
| `status` | `enum` | **Yes** | `"success"`, `"blocked"`, `"failed"`, or `"degraded"`. |
| `artifacts` | `ArtifactRef[]` | **Yes** | Generated artifacts (default: `[]`). |
| `diagnostics` | `Record<string, unknown>` | **Yes** | Diagnostic metrics (default: `{}`). |
| `degradation_reason` | `string` | No | Justification if status is `"degraded"`. |

---

### `AgentHandoffSchema`
Envelope dispatched to a coding agent for specialized skill execution.

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `request_id` | `string` | **Yes** | Originating request ID. |
| `skill_id` | `string` | **Yes** | Agent skill identifier (e.g. `agent-skill.img2threejs`). |
| `instructions_ref` | `string` | **Yes** | Path to skill instructions (`SKILL.md`). |
| `expected_outputs` | `string[]` | **Yes** | Expected output files (`min(1)`). |
| `acceptance` | `string[]` | **Yes** | Acceptance criteria (`min(1)`). |
| `provider_context` | `Record<string, unknown>` | No | Contextual metadata passed to agent. |

---

### `AssetRecordSchema`
Tracks production identity and acceptance history in `AssetRegistry`.

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` | **Yes** | Dotted asset ID matching `^[a-z0-9_.-]+$`. |
| `role` | `string` | **Yes** | Asset role (e.g. `interactive_hero_prop`, `scenic_foliage`). |
| `origin` | `AssetOrigin` | **Yes** | `"user"`, `"project"`, `"cc0"`, `"licensed"`, `"generated"`, `"blender"`, `"procedural"`. |
| `construction_route` | `string` | **Yes** | Capability route used to build asset. |
| `source_provenance` | `object` | **Yes** | `{ uri?, license?, author?, sha256?, retrieved_at?, donor_notice? }`. |
| `runtime_representation` | `string` | **Yes** | Representation (e.g. `procedural_three`, `gltf_glb`). |
| `acceptance_state` | `AssetAcceptanceState` | **Yes** | `"pending"`, `"accepted"`, `"rejected"`, `"blocked"`, `"degraded"`. |
| `semantic_nodes` | `string[]` | No | Exposed socket or node names. |
| `budget` | `Record<string, unknown>` | **Yes** | Triangle, draw call, and memory budget limits. |

---

### `TerrainHeightfieldSchema`
Canonical elevation data structure.

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `rows` | `number` | **Yes** | Integer count of rows (`>= 2`). |
| `columns` | `number` | **Yes** | Integer count of columns (`>= 2`). |
| `heights` | `number[]` or `Float32Array` | **Yes** | Flattened elevation array (`length > 0`). |
| `size_x` | `number` | **Yes** | World-space width in meters (`> 0`). |
| `size_z` | `number` | **Yes** | World-space depth in meters (`> 0`). |
| `orientation` | `string` | **Yes** | Axis orientation descriptor (e.g. `row_major_z_positive`). |
| `seed` | `number` | No | Deterministic generator seed. |

---

### `RuntimeReadinessSchema`
Readiness barrier synchronization contract.

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `state` | `enum` | **Yes** | `"created"`, `"booting"`, `"ready"`, or `"failed"`. |
| `required_subsystems` | `string[]` | **Yes** | List of essential subsystem IDs. |
| `subsystem_states` | `Record<string, SubsystemState>` | **Yes** | Map of state per subsystem (`uninitialized`, `booting`, `ready`, `failed`). |
| `failure` | `string` | No | Reason if overall state is `"failed"`. |

> [!IMPORTANT]
> **Refinement Rule**: The schema strictly enforces that `state` cannot be `"ready"` unless every subsystem listed in `required_subsystems` is marked as `"ready"` in `subsystem_states`.

---

### `NetworkEnvelopeSchema`
Transport-neutral command and replication envelope.

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `kind` | `string` | **Yes** | Command or snapshot kind (`min(1)`). |
| `sequence` | `number` | **Yes** | Monotonic packet sequence integer (`>= 0`). |
| `payload` | `Record<string, unknown>` | **Yes** | Message payload. |
| `client_id` | `string` | No | Authenticated client ID. |
| `server_tick` | `number` | No | Server tick index when packet was broadcast. |
| `ack_sequence` | `number` | No | Latest client sequence acknowledged by server. |

---

### `EvidenceManifestSchema` & `SettlementRecordSchema`

#### `EvidenceManifestSchema`
Binds proof artifacts to an observation run.

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` | **Yes** | Manifest ID. |
| `run_id` | `string` | **Yes** | Observation run identifier. |
| `project_revision` | `string` | **Yes** | Git commit SHA at time of run. |
| `requirement_ids` | `string[]` | **Yes** | Declared requirement IDs being proven (`min(1)`). |
| `artifacts` | `ArtifactRef[]` | **Yes** | Artifact references (`min(1)`). |
| `result` | `enum` | **Yes** | `"pass"`, `"fail"`, `"blocked"`, or `"incomplete"`. |
| `contradictions` | `string[]` | No | Recorded cross-channel contradictions. |

#### `SettlementRecordSchema`
The formal Gauntlet certification record.

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `id` | `string` | **Yes** | Settlement record ID. |
| `requirement_ids` | `string[]` | **Yes** | Citing requirement IDs (`min(1)`). |
| `decision` | `enum` | **Yes** | `"settled"`, `"blocked"`, `"failed"`, or `"incomplete"`. |
| `evidence_manifest_ids` | `string[]` | **Yes** | Manifest IDs cited as justification (`min(1)`). |
| `reason` | `string` | **Yes** | Detailed justification of decision. |
| `blockage_class` | `string` | No | Standardized blockage category if not settled. |

---

### `StudioResultSchema`
Standard machine-readable CLI response format.

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `status` | `enum` | **Yes** | `"success"`, `"blocked"`, `"failed"`, or `"degraded"`. |
| `operation` | `string` | **Yes** | Executed command verb (e.g. `doctor`, `verify`). |
| `result` | `unknown` | No | Payload data if successful. |
| `diagnostics` | `Record<string, unknown>` | **Yes** | Diagnostic dictionary (default: `{}`). |
