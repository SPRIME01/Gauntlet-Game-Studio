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
    // Derivative stamp (REQ-STALE-001): which Game Model version and fields
    // this asset was accepted against. Optional so pre-stamp records load.
    built_from: z.number().int().nonnegative().optional(),
    reads: z.array(z.string().min(1).max(120)).max(64).optional(),
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

// ── Game Model (REQ-GM-001..006, v0.5.0 amendment) ──────────────────────────

/**
 * GameModelDecision: one append-only settled change of the canonical Game Model
 * (REQ-GM-003). `touched` names model fields/resources the decision affects
 * ("all", dotted field keys like "camera" or "languages.material", or
 * resource-scoped keys like "asset:rifle" / "entity:player"). Staleness is
 * computed from these records, never from manual invalidation lists
 * (REQ-STALE-002).
 */
export const GameModelDecisionSchema = z
  .object({
    n: z.number().int().positive(),
    version: z.number().int().nonnegative(),
    decided_at: z.string().min(1).optional(),
    summary: z.string().min(1).max(1200),
    touched: z.array(z.string().min(1).max(120)).max(64).default([]),
  })
  .strict();

export type GameModelDecision = z.infer<typeof GameModelDecisionSchema>;

/**
 * DerivativeStamp: what a model-derived artifact was built from (REQ-STALE-001).
 * `built_from` is the Game Model version; `reads` names the model fields and
 * resource ids the derivative consumed.
 */
export const DerivativeStampSchema = z
  .object({
    built_from: z.number().int().nonnegative(),
    reads: z.array(z.string().min(1).max(120)).max(256).default([]),
  })
  .strict();

export type DerivativeStamp = z.infer<typeof DerivativeStampSchema>;

const LanguageSpecSchema = z
  .object({
    summary: z.string().max(4000).optional(),
    references: z.array(z.string().min(1).max(80)).max(24).optional(),
  })
  .strict();

const ModelEntitySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_.-]+$/),
    name: z.string().min(1).max(120),
    role: z.string().max(120).optional(),
    summary: z.string().max(2000).optional(),
  })
  .strict();

const ModelMechanicSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_.-]+$/),
    name: z.string().min(1).max(120),
    summary: z.string().max(2000).optional(),
    affordances: z.array(z.string().min(1).max(80)).max(32).optional(),
  })
  .strict();

const ModelWorldSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_.-]+$/),
    name: z.string().min(1).max(120),
    summary: z.string().max(2000).optional(),
  })
  .strict();

const ModelLoopStepSchema = z.string().min(1).max(400);

const CoreLoopSchema = z
  .object({
    summary: z.string().max(2000).optional(),
    steps: z.array(ModelLoopStepSchema).max(32).optional(),
  })
  .strict();

const SecondaryLoopSchema = CoreLoopSchema.extend({ name: z.string().min(1).max(120) }).strict();

const ProgressionSchema = z
  .object({
    summary: z.string().max(2000).optional(),
    milestones: z.array(z.string().min(1).max(200)).max(64).optional(),
  })
  .strict();

const CameraGrammarSchema = z
  .object({
    mode: z.enum(["first-person", "third-person", "fixed", "top-down", "isometric", "cinematic", "other"]),
    fov: z.number().min(20).max(150).optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();

const ControlBindingSchema = z
  .object({
    action: z.string().min(1).max(80),
    input: z.string().min(1).max(80),
  })
  .strict();

const ControlsGrammarSchema = z
  .object({
    grammar: z.string().max(2000).optional(),
    bindings: z.array(ControlBindingSchema).max(128).optional(),
  })
  .strict();

const PlatformTargetSchema = z
  .object({
    id: z.enum(["web", "android", "ios", "desktop", "other"]),
    requirements: z.array(z.string().min(1).max(400)).max(64).optional(),
  })
  .strict();

const NorthStarReferenceSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_.-]+$/),
    kind: z.enum([
      "world",
      "character",
      "materials",
      "lighting",
      "ui",
      "animation",
      "vfx",
      "audio",
      "game",
      "film",
      "art",
      "other",
    ]),
    classification: z.enum(["reference-only", "shippable", "derivative-permitted", "license-unresolved"]),
    location: z.string().min(1).max(600),
    notes: z.string().max(1000).optional(),
  })
  .strict();

const UnknownSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_.-]+$/),
    question: z.string().min(1).max(1000),
    status: z.enum(["open", "resolved"]),
    resolution: z.string().max(2000).optional(),
  })
  .strict();

const ContradictionSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_.-]+$/),
    text: z.string().min(1).max(2000),
    refs: z.array(z.string().min(1).max(120)).max(24).default([]),
  })
  .strict();

const ModelScenarioSchema = z
  .object({
    description: z.string().min(1).max(2000),
    acceptance: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

const AssetRequirementSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_.-]+$/),
    kind: z.string().min(1).max(60).optional(),
    description: z.string().min(1).max(2000),
  })
  .strict();

/**
 * GameModelKnownSchema: strict typed core of the canonical Game Model
 * (REQ-GM-002). Every section is optional (absence is an absent fact, not a
 * default); unknown top-level keys are per-game extensions preserved by the
 * loader, not silently accepted into the typed core (REQ-GM-005).
 * `quality_profiles` is validated by the studio quality-profile loader against
 * the same game-owned schema used since REQ-CONFIG-005.
 */
export const GameModelKnownSchema = z
  .object({
    schema: z.literal("gauntlet.game.model").or(z.literal("gauntlet.game.spec")).optional(),
    schema_version: z.string().min(1).max(20).optional(),
    model_version: z.number().int().nonnegative().optional(),
    identity: z
      .object({
        game_id: z.string().regex(/^[a-z0-9_.-]+$/),
        title: z.string().min(1).max(160),
        tagline: z.string().max(400).optional(),
        status: z.string().max(60).optional(),
      })
      .strict()
      .optional(),
    fantasy: z.string().max(4000).optional(),
    audience: z.string().max(2000).optional(),
    genre: z.string().max(200).optional(),
    pillars: z.array(z.string().min(1).max(400)).max(16).optional(),
    core_loop: CoreLoopSchema.optional(),
    secondary_loops: z.array(SecondaryLoopSchema).max(16).optional(),
    progression: ProgressionSchema.optional(),
    mechanics: z.array(ModelMechanicSchema).max(256).optional(),
    worlds: z.array(ModelWorldSchema).max(256).optional(),
    entities: z.array(ModelEntitySchema).max(1024).optional(),
    characters: z.array(ModelEntitySchema).max(512).optional(),
    factions: z.array(ModelEntitySchema).max(128).optional(),
    objects: z.array(ModelEntitySchema).max(1024).optional(),
    interactions: z.array(ModelMechanicSchema).max(512).optional(),
    camera: CameraGrammarSchema.optional(),
    controls: ControlsGrammarSchema.optional(),
    languages: z
      .object({
        visual: LanguageSpecSchema.optional(),
        material: LanguageSpecSchema.optional(),
        lighting: LanguageSpecSchema.optional(),
        animation: LanguageSpecSchema.optional(),
        vfx: LanguageSpecSchema.optional(),
        audio: LanguageSpecSchema.optional(),
        ui: LanguageSpecSchema.optional(),
      })
      .strict()
      .optional(),
    narrative: z.object({ summary: z.string().max(8000).optional() }).strict().optional(),
    platforms: z.array(PlatformTargetSchema).max(8).optional(),
    budgets: z
      .object({
        target_fps: z.number().positive().optional(),
        max_draw_calls: z.number().int().nonnegative().optional(),
        max_triangles: z.number().int().nonnegative().optional(),
        max_memory_mb: z.number().nonnegative().optional(),
      })
      .strict()
      .optional(),
    accessibility: z.object({ requirements: z.array(z.string().min(1).max(400)).max(64).optional() }).strict().optional(),
    assets: z
      .object({
        manifest: z.string().max(400).optional(),
        requirements: z.array(AssetRequirementSchema).max(512).optional(),
      })
      .strict()
      .optional(),
    provenance_policy: z
      .object({ acceptable_licenses: z.array(z.string().min(1).max(60)).max(64).optional() })
      .strict()
      .optional(),
    scenarios: z.record(z.string(), ModelScenarioSchema).optional(),
    release: z
      .object({ requirements: z.record(z.string(), z.array(z.string().min(1).max(400)).max(64)) })
      .strict()
      .optional(),
    north_star: z.object({ references: z.array(NorthStarReferenceSchema).max(256).optional() }).strict().optional(),
    unknowns: z.array(UnknownSchema).max(256).optional(),
    contradictions: z.array(ContradictionSchema).max(128).optional(),
    decisions: z.array(GameModelDecisionSchema).max(4096).optional(),
  })
  .strict();

export type GameModelKnown = z.infer<typeof GameModelKnownSchema>;

export function validateDerivativeStamp(data: unknown) {
  return DerivativeStampSchema.parse(data);
}

// ── Resource resolution (REQ-RES-001..006, v0.5.0 amendment) ────────────────

/** Resource kinds covered by generalized resource resolution (REQ-RES-001). */
export const RESOURCE_KINDS = [
  "mesh",
  "material",
  "texture",
  "hdri",
  "environment",
  "kit",
  "rig",
  "animation",
  "audio",
  "music",
  "vfx",
  "shader",
  "ui",
  "icon",
  "font",
  "code",
  "addon",
  "gameplay",
  "controller",
  "save",
  "dialogue",
  "navigation-pattern",
  "networking-pattern",
  "other",
] as const;

export const ResourceKindSchema = z.enum(RESOURCE_KINDS);
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

/** Asset-kind requests delegate to the settled AssetResolver policy (REQ-RES-001). */
export const ASSET_RESOURCE_KINDS: readonly ResourceKind[] = ["mesh", "material", "texture", "hdri", "environment"];

/**
 * Minimum-novelty cascade stages, ordered cheapest first (REQ-RES-002).
 * Choosing a costlier stage requires recording why cheaper valid routes failed.
 */
export const RESOURCE_ROUTE_STAGES = [
  "reuse-accepted",
  "reuse-reservoir",
  "acquire",
  "adapt",
  "composite",
  "code-donor",
  "procedural",
  "reference-reconstruction",
  "dcc-modification",
  "generate-component",
  "scratch",
] as const;

export const ResourceRouteStageSchema = z.enum(RESOURCE_ROUTE_STAGES);
export type ResourceRouteStage = (typeof RESOURCE_ROUTE_STAGES)[number];

export const ResourceRouteAttemptSchema = z
  .object({
    stage: ResourceRouteStageSchema,
    target: z.string().min(1).max(300),
    provider: z.string().min(1).max(120).optional(),
    outcome: z.enum(["satisfied", "rejected", "unavailable", "blocked", "skipped"]),
    detail: z.string().min(1).max(1200),
  })
  .strict();

export type ResourceRouteAttempt = z.infer<typeof ResourceRouteAttemptSchema>;

export const CreationExceptionSchema = z
  .object({
    id: z.string().min(1).max(120),
    what: z.string().min(1).max(2000),
    routes_searched: z.array(ResourceRouteAttemptSchema).min(1).max(64),
    why_failed: z.array(z.string().min(1).max(600)).min(1).max(32),
    partial_reuse: z.array(z.string().min(1).max(200)).max(32).default([]),
    provenance: z
      .object({
        uri: z.string().max(600).optional(),
        license: z.string().max(60).optional(),
        author: z.string().max(200).optional(),
        sha256: z.string().max(64).optional(),
      })
      .strict()
      .default({}),
    derivative_id: z.string().max(120).optional(),
    recorded_at: z.string().min(1),
  })
  .strict();

export type CreationException = z.infer<typeof CreationExceptionSchema>;

/**
 * ResourceResolutionRecord: append-only record of one resource resolution
 * (REQ-RES-004) with the attempted cascade ladder, the chosen route, and —
 * when the terminal scratch stage is used — the creation exception
 * (REQ-RES-006). Model-derived resolutions carry a derivative stamp
 * (REQ-STALE-001).
 */
export const ResourceResolutionRecordSchema = z
  .object({
    schema: z.literal("gauntlet.resource.resolution"),
    schema_version: z.literal("1.0"),
    id: z.string().min(1),
    requested_id: z.string().min(1).max(200),
    kind: ResourceKindSchema,
    role: z.string().max(120).optional(),
    keywords: z.array(z.string().min(1).max(80)).max(16).default([]),
    attempts: z.array(ResourceRouteAttemptSchema).min(1).max(64),
    chosen_route: ResourceRouteStageSchema.optional(),
    decision: z.enum(["resolved", "blocked", "failed"]),
    status_code: z.string().min(1).max(80),
    rationale: z.string().min(1).max(2000),
    creation_exception: CreationExceptionSchema.optional(),
    asset_id: z.string().max(120).optional(),
    built_from: z.number().int().nonnegative().optional(),
    reads: z.array(z.string().min(1).max(120)).max(64).default([]),
    recorded_at: z.string().min(1),
  })
  .strict();

export type ResourceResolutionRecord = z.infer<typeof ResourceResolutionRecordSchema>;

/** Reservoir record: one indexed, content-addressed reusable resource (REQ-RES-005). */
export const ReservoirRecordSchema = z
  .object({
    id: z.string().min(1).max(160),
    kind: ResourceKindSchema,
    tags: z.array(z.string().min(1).max(60)).max(32).default([]),
    source: z
      .object({
        uri: z.string().max(600).optional(),
        license: z.string().min(1).max(60),
        author: z.string().max(200).optional(),
        sha256: z.string().max(64).optional(),
      })
      .strict(),
    local_hash: z.string().min(8).max(64),
    format: z.string().min(1).max(40),
    metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
    derived_from: z.array(z.string().min(1).max(160)).max(32).default([]),
    used_by: z.array(z.string().min(1).max(120)).max(64).default([]),
    accepted: z.boolean().default(false),
    verification_refs: z.array(z.string().min(1).max(160)).max(16).default([]),
    built_from: z.number().int().nonnegative().optional(),
    reads: z.array(z.string().min(1).max(120)).max(64).default([]),
    added_at: z.string().min(1),
  })
  .strict();

export type ReservoirRecord = z.infer<typeof ReservoirRecordSchema>;

// ── Coherence normalization, DCC jobs, animation (v0.5.0 amendment) ─────────

/** Normalization operations a resource may require toward model language (REQ-NORM-001). */
export const NORMALIZATION_OPS = [
  "units",
  "scale",
  "orientation",
  "pivot",
  "naming",
  "skeleton-convention",
  "animation-naming",
  "material-model",
  "palette",
  "roughness-range",
  "metalness-range",
  "normal-intensity",
  "texel-density",
  "texture-resolution",
  "lod",
  "collider",
  "sockets",
  "runtime-metadata",
  "lighting-response",
] as const;

export const NormalizationOpSchema = z.enum(NORMALIZATION_OPS);
export type NormalizationOp = (typeof NORMALIZATION_OPS)[number];

export const NormalizationTransformSchema = z
  .object({
    op: NormalizationOpSchema,
    params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
    reason: z.string().min(1).max(600),
  })
  .strict();

/**
 * NormalizationPlan: the systematic transformation record that makes twenty
 * sources read as one authored world (REQ-NORM-001). The plan is bound to the
 * Game Model language sections it conforms to (`model_reads`); provenance of
 * the source resource is never erased (REQ-NORM-002).
 */
export const NormalizationPlanSchema = z
  .object({
    schema: z.literal("gauntlet.resource.normalization"),
    schema_version: z.literal("1.0"),
    id: z.string().min(1).max(160),
    target: z.string().min(1).max(200),
    kind: ResourceKindSchema,
    model_reads: z.array(z.string().min(1).max(120)).max(32).min(1),
    transforms: z.array(NormalizationTransformSchema).min(1).max(64),
    source_provenance: z
      .object({
        uri: z.string().max(600).optional(),
        license: z.string().max(60).optional(),
        sha256: z.string().max(64).optional(),
        derived_from: z.array(z.string().max(160)).max(32).default([]),
      })
      .strict(),
    built_from: z.number().int().nonnegative(),
    executed: z.boolean().default(false),
    execution_refs: z.array(z.string().min(1).max(200)).max(16).default([]),
    recorded_at: z.string().min(1),
  })
  .strict();

export type NormalizationPlan = z.infer<typeof NormalizationPlanSchema>;

/** Structured DCC operations (REQ-DCC-001). */
export const DCC_OPERATIONS = [
  "topology-cleanup",
  "retopology",
  "uv-edit",
  "material-bake",
  "bake",
  "rig",
  "skin",
  "animate",
  "retarget",
  "bake-animation",
  "mesh-repair",
  "collision-proxy",
  "lod-generate",
  "kitbash-consolidate",
  "export-normalize",
] as const;

export const DccOperationSchema = z.enum(DCC_OPERATIONS);
export type DccOperation = (typeof DCC_OPERATIONS)[number];

export const DccJobOperationSchema = z
  .object({
    op: DccOperationSchema,
    params: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

/**
 * DccJob: a structured, reviewable declaration of DCC work (REQ-DCC-001).
 * `cascade_rationale` is mandatory: the record of why cheaper routes
 * (R0–R7) were insufficient. DCC jobs never own gameplay semantics
 * (REQ-DCC-002).
 */
export const DccJobSchema = z
  .object({
    schema: z.literal("gauntlet.dcc.job"),
    schema_version: z.literal("1.0"),
    id: z.string().min(1).max(160),
    capability_id: z.string().min(1).max(120),
    inputs: z.array(z.string().min(1).max(300)).min(1).max(64),
    operations: z.array(DccJobOperationSchema).min(1).max(64),
    cascade_rationale: z.string().min(1).max(2000),
    cascade_attempts: z.array(ResourceRouteAttemptSchema).max(64).default([]),
    budgets: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
    outputs: z
      .array(z.object({ path: z.string().min(1).max(400), format: z.string().min(1).max(40) }).strict())
      .min(1)
      .max(32),
    deterministic: z
      .object({
        recipe_sha256: z.string().max(64).optional(),
        tool_version: z.string().max(60).optional(),
      })
      .strict()
      .default({}),
    acceptance: z.array(z.string().min(1).max(400)).min(1).max(32),
    verification: z.string().min(1).max(600),
    built_from: z.number().int().nonnegative().optional(),
    reads: z.array(z.string().min(1).max(120)).max(64).default([]),
  })
  .strict();

export type DccJob = z.infer<typeof DccJobSchema>;

/**
 * AnimationResourceContract: first-class animation domain contracts
 * (REQ-ANIM-001). `composition` declares the additive/layer composition this
 * resource participates in, so composition is preferred over bespoke creation
 * (REQ-ANIM-002) and the Game Model owns the semantic meaning.
 */
export const AnimationResourceContractSchema = z
  .object({
    schema: z.literal("gauntlet.animation.contract"),
    schema_version: z.literal("1.0"),
    id: z.string().min(1).max(160),
    domain: z.enum(["rig", "retarget", "source", "adaptation", "bake", "validation", "runtime-graph"]),
    skeleton: z.string().max(160).optional(),
    clip_inventory: z.array(z.string().min(1).max(160)).max(256).default([]),
    composition: z
      .object({
        base_clips: z.array(z.string().max(160)).max(32).default([]),
        layers: z
          .array(
            z
              .object({
                clip: z.string().min(1).max(160),
                mode: z.enum(["additive", "override", "upper-body", "partial"]),
                mask: z.string().max(160).optional(),
              })
              .strict(),
          )
          .max(32)
          .default([]),
      })
      .strict()
      .optional(),
    semantics: z.string().max(600).optional(),
    built_from: z.number().int().nonnegative().optional(),
    reads: z.array(z.string().min(1).max(120)).max(64).default([]),
  })
  .strict();

export type AnimationResourceContract = z.infer<typeof AnimationResourceContractSchema>;
