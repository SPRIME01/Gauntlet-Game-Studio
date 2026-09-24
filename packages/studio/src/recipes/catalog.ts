/**
 * Canonical recipe catalog — small excellent vocabulary proving the recipe layer
 * (REQ-RECIPE-012). Outcome names only; no engine/provider nouns in user-facing IDs.
 *
 * Recipes are primarily declarative: they declare affordances, affordance
 * dependencies, capability requirements, defaults, and acceptance. Compilation
 * turns them into an inspectable RecipePlan; apply routes capability steps through
 * the existing capability registry/router and asset.resolve.
 */
import type { RecipeDescriptor } from "@gauntlet/contracts";

const WORLD_THIRD_PERSON: RecipeDescriptor = {
  id: "world.third-person",
  version: "1.0.0",
  summary:
    "Create a small third-person game/world with a controllable player, ground navigation, and a runnable baseline.",
  use_when: [
    "create a third-person game",
    "start a third-person world",
    "new third-person prototype",
  ],
  do_not_use_when: [
    "first-person or top-down only experience",
    "multiplayer-only spawn without a local third-person baseline",
  ],
  inputs: [
    {
      key: "world_theme",
      label: "World theme",
      required: false,
      material: true,
      type: "string",
      summary: "High-level environment theme for composition defaults",
      default: "neutral-outdoor",
    },
    {
      key: "player_speed",
      label: "Player move speed",
      required: false,
      material: false,
      type: "number",
      summary: "Ground move speed; defaulted from studio judgment",
      default: 6,
    },
  ],
  affordances: [
    "canonical_terrain",
    "environment_composition",
    "player_entity",
    "player_render_projection",
    "player_physics_projection",
    "navigation_mesh",
    "runnable_scene",
  ],
  affordance_dependencies: [
    { requires: "canonical_terrain", required_by: "environment_composition" },
    { requires: "canonical_terrain", required_by: "navigation_mesh" },
    { requires: "player_entity", required_by: "player_render_projection" },
    { requires: "player_entity", required_by: "player_physics_projection" },
    { requires: "player_physics_projection", required_by: "runnable_scene" },
    { requires: "navigation_mesh", required_by: "runnable_scene" },
  ],
  capability_requirements: ["world.terrain", "world.composition", "world.physics", "world.navigation"],
  constraints: [
    "Koota remains authoritative game state",
    "Three.js remains rendering projection",
    "exactly one Rapier step owner",
    "asset steps use asset.resolve search/acquire then adapt then create",
  ],
  escalation: {
    stop_and_ask_when: ["operator requests multiplayer-only without local baseline"],
    escalate_when: ["budget requires a quality profile other than default"],
  },
  acceptance: [
    "third-person scenario boots with ready runtime",
    "player moves under authoritative state observation",
    "state, pixels, and telemetry channels available for settlement",
  ],
  expert_inspection: {
    note: "Internal capability IDs are inspectable here and must not define the user-facing name.",
  },
};

const ENEMY_PATROL: RecipeDescriptor = {
  id: "enemy.patrol",
  version: "1.0.0",
  summary:
    "Add a patrolling enemy that moves along a path, detects the player, and reacts — composed from existing capabilities.",
  use_when: ["add a patrolling enemy", "enemy that patrols", "patrol guard or drone"],
  do_not_use_when: ["multi-phase boss fight", "purely decorative prop with no detection"],
  inputs: [
    {
      key: "enemy_kind",
      label: "Enemy kind",
      required: false,
      material: true,
      type: "enum",
      summary: "Conceptual enemy archetype affecting defaults only",
      enum_values: ["drone", "guard"],
      default: "drone",
    },
    {
      key: "patrol_area",
      label: "Patrol area intent",
      required: false,
      material: true,
      type: "string",
      summary: "Human description of the patrol region or loop",
      default: "circular-loop-8m",
    },
    {
      key: "on_detect",
      label: "On player detect",
      required: false,
      material: true,
      type: "enum",
      summary: "Reaction when the enemy detects the player",
      enum_values: ["alert-pursue", "alert-hold"],
      default: "alert-pursue",
    },
    {
      key: "style_hint",
      label: "Optional visual style",
      required: false,
      material: false,
      type: "string",
      summary: "Optional style constraint; default follows world theme",
      default: "",
    },
  ],
  affordances: [
    "resolved_enemy_asset",
    "semantic_enemy_entity",
    "enemy_render_projection",
    "enemy_physics_projection",
    "navigation_agent",
    "patrol_behavior",
    "detection_behavior",
    "patrol_scenario",
  ],
  affordance_dependencies: [
    { requires: "resolved_enemy_asset", required_by: "enemy_render_projection" },
    { requires: "semantic_enemy_entity", required_by: "enemy_render_projection" },
    { requires: "semantic_enemy_entity", required_by: "enemy_physics_projection" },
    { requires: "semantic_enemy_entity", required_by: "patrol_behavior" },
    { requires: "navigation_agent", required_by: "patrol_behavior" },
    { requires: "patrol_behavior", required_by: "detection_behavior" },
    { requires: "patrol_behavior", required_by: "patrol_scenario" },
  ],
  capability_requirements: [
    "asset.resolve",
    "world.physics",
    "world.navigation",
    "vfx.particles",
    "audio.procedural",
  ],
  constraints: [
    "authoritative enemy state lives in Koota, not the render mesh",
    "navigation uses Recast over accepted world geometry",
    "asset resolution uses asset.resolve ordered policy",
  ],
  escalation: {
    stop_and_ask_when: ["patrol area cannot be inferred and no default is safe"],
    escalate_when: ["enemy requires a custom rig beyond default content routes"],
  },
  acceptance: [
    "patrol scenario observes enemy translation in authoritative state",
    "detection transitions are observable in state",
    "render and physics projections track authoritative entity",
  ],
};

const INTERACTION: RecipeDescriptor = {
  id: "interaction",
  version: "1.0.0",
  summary:
    "Add a generic interactable object the player can activate, with focus feedback and a typed interaction result.",
  use_when: ["add an interactable", "press-to-use object", "activatable object"],
  do_not_use_when: ["pickup that is consumed", "locked door requiring a key item"],
  inputs: [
    {
      key: "interaction_prompt",
      label: "Interaction prompt",
      required: false,
      material: true,
      type: "string",
      summary: "Short player-facing prompt",
      default: "Use",
    },
    {
      key: "one_shot",
      label: "One-shot interaction",
      required: false,
      material: true,
      type: "boolean",
      summary: "Whether the interaction can only complete once",
      default: false,
    },
  ],
  affordances: [
    "resolved_interactable_asset",
    "semantic_interactable_entity",
    "interaction_focus",
    "interaction_action",
  ],
  affordance_dependencies: [
    { requires: "semantic_interactable_entity", required_by: "interaction_focus" },
    { requires: "interaction_focus", required_by: "interaction_action" },
  ],
  capability_requirements: ["asset.resolve", "world.spatial"],
  constraints: ["interaction state is authoritative in Koota", "no provider-specific interaction bus"],
  escalation: {
    stop_and_ask_when: ["interaction requires networked authority beyond local baseline"],
    escalate_when: ["dialogue tree is required"],
  },
  acceptance: [
    "interaction scenario observes focus and action in authoritative state",
    "prompt UI reflects interaction state",
  ],
};

const INTERACTION_PICKUP: RecipeDescriptor = {
  id: "interaction.pickup",
  version: "1.0.0",
  summary:
    "Add a pickup the player collects, updating inventory/progress state with provenance-safe asset resolution.",
  use_when: ["add a pickup", "collectible item", "item the player grabs"],
  do_not_use_when: ["permanent world switch", "key that unlocks a specific door (use interaction.door-key)"],
  inputs: [
    {
      key: "item_name",
      label: "Item name",
      required: false,
      material: true,
      type: "string",
      summary: "Display name for the pickup",
      default: "pickup",
    },
    {
      key: "grant",
      label: "What collecting grants",
      required: false,
      material: true,
      type: "enum",
      summary: "Progression effect of collecting",
      enum_values: ["inventory", "progress-flag"],
      default: "inventory",
    },
  ],
  affordances: [
    "resolved_pickup_asset",
    "semantic_pickup_entity",
    "pickup_render_projection",
    "collect_action",
    "inventory_or_progress_update",
  ],
  affordance_dependencies: [
    { requires: "resolved_pickup_asset", required_by: "pickup_render_projection" },
    { requires: "semantic_pickup_entity", required_by: "collect_action" },
    { requires: "collect_action", required_by: "inventory_or_progress_update" },
  ],
  capability_requirements: ["asset.resolve"],
  constraints: [
    "collected state is authoritative in Koota",
    "pickup asset passes AssetRecord provenance before production use",
  ],
  escalation: {
    stop_and_ask_when: ["grant effect needs a design decision with no safe default"],
    escalate_when: ["pickup requires multiplayer replication"],
  },
  acceptance: [
    "collect scenario transitions pickup to collected in state",
    "inventory or progress flag updates observably",
  ],
};

const DOOR_KEY: RecipeDescriptor = {
  id: "interaction.door-key",
  version: "1.0.0",
  summary:
    "Add a locked door and matching key: acquiring the key enables opening the door through affordance dependencies.",
  use_when: ["add a locked door and key", "keycard door", "door that needs an item"],
  do_not_use_when: ["door with no key item", "puzzle lock with multi-step combination"],
  inputs: [
    {
      key: "lock_style",
      label: "Lock style",
      required: false,
      material: true,
      type: "enum",
      summary: "Conceptual lock presentation",
      enum_values: ["key", "keycard"],
      default: "key",
    },
  ],
  affordances: [
    "resolved_door_asset",
    "resolved_key_asset",
    "semantic_door_entity",
    "semantic_key_entity",
    "key_collect",
    "door_unlock_gate",
    "door_open_action",
  ],
  affordance_dependencies: [
    { requires: "resolved_key_asset", required_by: "semantic_key_entity" },
    { requires: "semantic_key_entity", required_by: "key_collect" },
    { requires: "semantic_door_entity", required_by: "door_unlock_gate" },
    { requires: "key_collect", required_by: "door_unlock_gate" },
    { requires: "door_unlock_gate", required_by: "door_open_action" },
  ],
  capability_requirements: ["asset.resolve", "world.spatial"],
  constraints: [
    "lock state is authoritative in Koota",
    "door and key assets resolve through asset.resolve",
  ],
  escalation: {
    stop_and_ask_when: ["key identity is ambiguous across multiple locks"],
    escalate_when: ["lock requires puzzle logic beyond key possession"],
  },
  acceptance: [
    "door remains locked until key collected (state observation)",
    "opening is possible only after unlock gate satisfied",
  ],
};

const CHECKPOINT: RecipeDescriptor = {
  id: "checkpoint",
  version: "1.0.0",
  summary:
    "Add a checkpoint that records progress and restores the player when they respawn.",
  use_when: ["add a checkpoint", "save progress point", "respawn anchor"],
  do_not_use_when: ["full save system with slots", "multiplayer sync checkpoint"],
  inputs: [
    {
      key: "restore_on_respawn",
      label: "Restore pose on respawn",
      required: false,
      material: false,
      type: "boolean",
      summary: "Whether respawn restores the checkpoint pose",
      default: true,
    },
  ],
  affordances: [
    "resolved_checkpoint_asset",
    "semantic_checkpoint_entity",
    "checkpoint_trigger",
    "progress_snapshot",
    "respawn_restore",
  ],
  affordance_dependencies: [
    { requires: "semantic_checkpoint_entity", required_by: "checkpoint_trigger" },
    { requires: "checkpoint_trigger", required_by: "progress_snapshot" },
    { requires: "progress_snapshot", required_by: "respawn_restore" },
  ],
  capability_requirements: ["asset.resolve", "world.spatial"],
  constraints: ["progress snapshot is authoritative game state, not a render marker"],
  escalation: {
    stop_and_ask_when: ["checkpoint must span networked clients without baseline multiplayer plan"],
    escalate_when: ["checkpoint must persist across browser sessions with external storage"],
  },
  acceptance: [
    "reaching checkpoint records progress in authoritative state",
    "respawn restores from checkpoint without inventing new evidence channels",
  ],
};

/** Canonical recipe set (REQ-RECIPE-012). */
export const RECIPE_CATALOG: RecipeDescriptor[] = [
  WORLD_THIRD_PERSON,
  ENEMY_PATROL,
  INTERACTION,
  INTERACTION_PICKUP,
  DOOR_KEY,
  CHECKPOINT,
];
