import { z } from "zod";

/**
 * Artifact reference within results and manifests.
 */
export const ArtifactRefSchema = z
  .object({
    id: z.string().optional(),
    path: z.string().min(1),
    sha256: z.string().optional(),
    role: z.string().optional(),
    mime_type: z.string().optional(),
    size_bytes: z.number().int().nonnegative().optional(),
  })
  .strict();

/**
 * CapabilityDescriptor: Defines one stable studio affordance independently of current provider.
 */
export const CapabilityDescriptorSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9]+(\.[a-z0-9_-]+)+$/, "Capability ID must be lower-case dotted namespace"),
    summary: z.string().min(10).max(1024),
    use_when: z.array(z.string().min(1)).min(1, "Must contain at least one positive trigger"),
    do_not_use_when: z.array(z.string().min(1)).default([]),
    inputs: z.array(z.string().min(1)),
    outputs: z.array(z.string().min(1)),
    verification: z.array(z.string().min(1)),
    providers: z.array(z.string().min(1)),
    fallback_policy: z.string().optional(),
    cost_class: z.enum(["free", "metered", "quota", "expensive"]).optional(),
    requires_user_reference: z.boolean().optional(),
    security_class: z.string().optional(),
  })
  .strict();

/**
 * CapabilityRequest: Represents admitted work before provider selection.
 * STRICT: Provider-specific fields (like mavonGameObject, needleComponent, etc.) are strictly forbidden.
 */
export const CapabilityRequestSchema = z
  .object({
    id: z.string().min(1),
    project_id: z.string().min(1),
    capability_id: z.string().min(1),
    intent: z.string().min(1),
    acceptance: z.array(z.string().min(1)).min(1, "Acceptance criteria must be recorded before settlement"),
    inputs: z.record(z.string(), z.unknown()).default({}),
    preferred_provider: z.string().optional(),
    budget: z.record(z.string(), z.unknown()).optional(),
    quality_profile: z.string().optional(),
    reference_ids: z.array(z.string()).optional(),
  })
  .strict();

/**
 * CapabilityResult: Normalizes a provider invocation outcome.
 */
export const CapabilityResultSchema = z
  .object({
    id: z.string().min(1),
    request_id: z.string().min(1),
    provider: z.string().min(1),
    status: z.enum(["success", "blocked", "failed", "degraded"]),
    artifacts: z.array(ArtifactRefSchema).default([]),
    diagnostics: z.record(z.string(), z.unknown()).default({}),
    asset_ids: z.array(z.string()).optional(),
    affordances: z.array(z.string()).optional(),
    degradation_reason: z.string().optional(),
  })
  .strict();

/**
 * AgentHandoff: Represents an agent-skill capability to be executed by the coding agent.
 */
export const AgentHandoffSchema = z
  .object({
    request_id: z.string().min(1),
    skill_id: z.string().min(1),
    instructions_ref: z.string().min(1),
    expected_outputs: z.array(z.string().min(1)).min(1),
    acceptance: z.array(z.string().min(1)).min(1),
    reference_ids: z.array(z.string()).optional(),
    provider_context: z.record(z.string(), z.unknown()).optional(),
    cost_warning: z.string().optional(),
  })
  .strict();

/**
 * AssetRecord: Production identity and acceptance history for game assets.
 */
export const AssetOriginSchema = z.enum([
  "user",
  "project",
  "cc0",
  "licensed",
  "generated",
  "blender",
  "procedural",
]);

export const AssetAcceptanceStateSchema = z.enum([
  "pending",
  "accepted",
  "rejected",
  "blocked",
  "degraded",
]);

export const AssetRecordSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9_.-]+$/, "Asset ID must use lower-case letters, numbers, dots, hyphens, or underscores"),
    role: z.string().min(1),
    origin: AssetOriginSchema,
    construction_route: z.string().min(1),
    source_provenance: z
      .object({
        uri: z.string().optional(),
        license: z.string().optional(),
        author: z.string().optional(),
        sha256: z.string().optional(),
        retrieved_at: z.string().optional(),
        donor_notice: z.string().optional(),
      })
      .default({}),
    runtime_representation: z.string().min(1),
    budget: z.record(z.string(), z.unknown()).default({}),
    acceptance_state: AssetAcceptanceStateSchema,
    semantic_nodes: z.array(z.string()).optional(),
    sockets: z.record(z.string(), z.unknown()).optional(),
    collider_policy: z.string().optional(),
    lod_policy: z.string().optional(),
    animation_contract: z.record(z.string(), z.unknown()).optional(),
    verification_refs: z.array(z.string()).optional(),
  })
  .strict();

/**
 * TerrainHeightfield: Canonical elevation representation.
 */
export const TerrainHeightfieldSchema = z
  .object({
    rows: z.number().int().min(2, "Rows must be at least 2"),
    columns: z.number().int().min(2, "Columns must be at least 2"),
    heights: z
      .union([
        z.array(z.number()),
        z.instanceof(Float32Array),
      ])
      .refine(
        (val) => {
          return Array.isArray(val) ? val.length > 0 : val.byteLength > 0;
        },
        { message: "Heights array cannot be empty" }
      ),
    size_x: z.number().positive("World-space size_x must be positive"),
    size_z: z.number().positive("World-space size_z must be positive"),
    orientation: z.string().min(1, "Must document row/column axis orientation"),
    seed: z.number().int().optional(),
    min_height: z.number().optional(),
    max_height: z.number().optional(),
    generator_metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

/**
 * RuntimeReadiness: Deterministic boot state for asynchronous subsystems.
 */
export const SubsystemStateEnum = z.enum(["uninitialized", "booting", "ready", "failed"]);

export const RuntimeReadinessSchema = z
  .object({
    state: z.enum(["created", "booting", "ready", "failed"]),
    required_subsystems: z.array(z.string()),
    subsystem_states: z.record(z.string(), SubsystemStateEnum),
    failure: z.string().optional(),
    started_at: z.string().optional(),
    ready_at: z.string().optional(),
  })
  .strict()
  .refine(
    (val) => {
      // If overall state is 'ready', every required subsystem must be 'ready'
      if (val.state === "ready") {
        for (const req of val.required_subsystems) {
          if (val.subsystem_states[req] !== "ready") {
            return false;
          }
        }
      }
      return true;
    },
    {
      message: "Runtime state cannot be 'ready' while required subsystems are not 'ready'",
      path: ["state"],
    }
  );

/**
 * AudioBackendState: State abstraction for audio backends.
 */
export const AudioBackendStateSchema = z
  .object({
    state: z.enum(["locked", "suspended", "ready"]),
    is_headless: z.boolean(),
    active_sources: z.number().int().nonnegative().optional(),
    unlocked_at: z.string().optional(),
  })
  .strict();

/**
 * NetworkEnvelope: Transport-neutral command and replication envelope.
 */
export const NetworkEnvelopeSchema = z
  .object({
    kind: z.string().min(1),
    sequence: z.number().int().nonnegative(),
    payload: z.record(z.string(), z.unknown()),
    client_id: z.string().optional(),
    server_tick: z.number().int().nonnegative().optional(),
    ack_sequence: z.number().int().nonnegative().optional(),
    entity_scope: z.string().optional(),
    timestamp_ms: z.number().optional(),
  })
  .strict();

/**
 * ObservationRun: Unique execution in which a game scenario is observed.
 */
export const ObservationRunSchema = z
  .object({
    id: z.string().min(1),
    project_revision: z.string().min(1, "ObservationRun must identify project revision"),
    scenario_id: z.string().min(1),
    environment: z.record(z.string(), z.unknown()),
    channels: z.array(z.union([z.string(), z.record(z.string(), z.unknown())])).min(1),
    seed: z.number().int().optional(),
    input_trace: z.string().optional(),
    camera_views: z.array(z.string()).optional(),
    timestamp: z.string().optional(),
  })
  .strict();

/**
 * EvidenceManifest: Binds proof artifacts to one ObservationRun.
 * STRICT: Must have run_id, project_revision, requirement_ids, and non-empty artifacts.
 */
export const EvidenceManifestSchema = z
  .object({
    id: z.string().min(1),
    run_id: z.string().min(1, "EvidenceManifest must be bound to a run_id"),
    project_revision: z.string().min(1, "EvidenceManifest must identify project_revision"),
    requirement_ids: z.array(z.string().min(1)).min(1, "Must declare at least one requirement supported"),
    artifacts: z.array(ArtifactRefSchema).min(1, "Must contain at least one artifact reference"),
    result: z.enum(["pass", "fail", "blocked", "incomplete"]),
    confirmation_mode: z.enum(["builder", "builder_with_teeth", "peer", "independent", "adversarial"]).optional(),
    reviewer: z.string().optional(),
    contradictions: z.array(z.string()).optional(),
    created_at: z.string().optional(),
  })
  .strict();

/**
 * SettlementRecord: Records Gauntlet decision for one expectation.
 */
export const SettlementRecordSchema = z
  .object({
    id: z.string().min(1),
    requirement_ids: z.array(z.string().min(1)).min(1),
    decision: z.enum(["settled", "blocked", "failed", "incomplete"]),
    evidence_manifest_ids: z.array(z.string().min(1)).min(1, "Settlement must cite evidence manifests"),
    reason: z.string().min(1),
    blockage_class: z.string().optional(),
    confirmation_ref: z.string().optional(),
    next_affordance: z.string().optional(),
    settled_at: z.string().optional(),
  })
  .strict();

/**
 * StudioResult: Structured CLI and semantic operation outcome.
 */
export const StudioResultSchema = z
  .object({
    status: z.enum(["success", "blocked", "failed", "degraded"]),
    operation: z.string().min(1),
    result: z.unknown().optional(),
    diagnostics: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

/**
 * RecipeInput: One declared recipe input (required or defaultable).
 * `material: true` marks a choice that genuinely affects the outcome and may be
 * exposed to the user; non-material inputs MUST receive strong defaults (REQ-RECIPE-006).
 */
export const RecipeInputSchema = z
  .object({
    key: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/, "Recipe input keys must be lower_snake_case"),
    label: z.string().min(1).max(200),
    required: z.boolean().default(false),
    material: z.boolean().default(false),
    type: z.enum(["string", "number", "boolean", "enum", "string[]"]),
    summary: z.string().min(1).max(500),
    default: z.unknown().optional(),
    enum_values: z.array(z.string().min(1)).optional(),
  })
  .strict();

/**
 * RecipeAffordanceDependency: enablement edge between outcome-level affordances.
 * Modeled as affordance dependency, not arbitrary linear order (REQ-RECIPE-002).
 */
export const RecipeAffordanceDependencySchema = z
  .object({
    requires: z.string().min(1),
    required_by: z.string().min(1),
  })
  .strict();

export const RecipeEscalationSchema = z
  .object({
    stop_and_ask_when: z.array(z.string().min(1)).default([]),
    escalate_when: z.array(z.string().min(1)).default([]),
  })
  .strict();

/**
 * RecipeDescriptor: outcome-oriented semantic composition above capabilities.
 * Primarily declarative; compiles into the existing capability registry/router (REQ-RECIPE-001..003).
 */
export const RecipeDescriptorSchema = z
  .object({
    id: z
      .string()
      .regex(
        /^[a-z0-9]+(\.[a-z0-9_-]+)*$/,
        "Recipe ID must use lower-case outcome vocabulary (e.g. enemy.patrol, checkpoint)"
      ),
    version: z.string().regex(/^\d+\.\d+\.\d+$/, "Recipe version must be semver"),
    summary: z.string().min(10).max(1024),
    use_when: z.array(z.string().min(1)).min(1),
    do_not_use_when: z.array(z.string().min(1)).default([]),
    inputs: z.array(RecipeInputSchema).default([]),
    affordances: z.array(z.string().min(1)).min(1),
    affordance_dependencies: z.array(RecipeAffordanceDependencySchema).default([]),
    capability_requirements: z
      .array(z.string().min(1))
      .min(1, "A recipe must declare the capabilities it may invoke"),
    constraints: z.array(z.string().min(1)).default([]),
    escalation: RecipeEscalationSchema.default({ stop_and_ask_when: [], escalate_when: [] }),
    acceptance: z.array(z.string().min(1)).min(1),
    expert_inspection: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const RecipePlanStepStatusSchema = z.enum([
  "pending",
  "satisfied",
  "needs_creation",
  "needs_modification",
  "blocked",
  "skipped",
]);

export const RecipePlanStepSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(["capability", "project", "verify"]),
    affordance: z.string().min(1),
    summary: z.string().min(1),
    capability_id: z.string().min(1).optional(),
    depends_on: z.array(z.string().min(1)).default([]),
    status: RecipePlanStepStatusSchema.default("pending"),
    reason: z.string().optional(),
  })
  .strict();

export const RecipeAffordanceGraphSchema = z
  .object({
    nodes: z.array(z.string().min(1)).min(1),
    edges: z
      .array(z.object({ from: z.string().min(1), to: z.string().min(1) }).strict())
      .default([]),
  })
  .strict();

/**
 * RecipePlan: inspectable dry-run expansion before mutation (REQ-RECIPE-005).
 */
export const RecipePlanSchema = z
  .object({
    schema: z.literal("gauntlet.recipe.plan"),
    schema_version: z.literal("1.0"),
    recipe_id: z.string().min(1),
    recipe_version: z.string().min(1),
    choices: z.record(z.string(), z.unknown()).default({}),
    affordance_graph: RecipeAffordanceGraphSchema,
    steps: z.array(RecipePlanStepSchema).min(1),
    created_at: z.string().min(1),
  })
  .strict();

export const RecipeApplyStepRecordSchema = z
  .object({
    step_id: z.string().min(1),
    kind: z.enum(["capability", "project", "verify"]),
    affordance: z.string().min(1),
    outcome: z.enum([
      "satisfied",
      "succeeded",
      "skipped",
      "blocked",
      "failed",
      "needs_modification",
    ]),
    capability_id: z.string().optional(),
    provider: z.string().optional(),
    detail: z.string().min(1),
    artifacts: z.array(ArtifactRefSchema).default([]),
    evidence_manifest_ids: z.array(z.string().min(1)).default([]),
  })
  .strict();

/**
 * RecipeApplyProvenance: append-only structured record of one recipe application (REQ-RECIPE-009..010).
 */
export const RecipeApplyProvenanceSchema = z
  .object({
    schema: z.literal("gauntlet.recipe.apply"),
    schema_version: z.literal("1.0"),
    id: z.string().min(1),
    recipe_id: z.string().min(1),
    recipe_version: z.string().min(1),
    choices: z.record(z.string(), z.unknown()).default({}),
    steps: z.array(RecipeApplyStepRecordSchema).default([]),
    result: z.enum(["success", "blocked", "failed", "degraded"]),
    failed_affordance: z.string().optional(),
    causal_capability: z.string().optional(),
    evidence_manifest_ids: z.array(z.string().min(1)).default([]),
    retryable: z.boolean().optional(),
    recovery_actions: z.array(z.string().min(1)).default([]),
    alternate_provider_available: z.boolean().optional(),
    user_input_required: z.boolean().optional(),
    recorded_at: z.string().min(1),
  })
  .strict();
