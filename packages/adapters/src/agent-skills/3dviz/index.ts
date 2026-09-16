/**
 * T15 (REQ-BIND-005): agent-skills/3dviz — world/environment composition handoff
 * normalization and deterministic result verification for `world.environment.compose`
 * (pinned 3dviz-pro-max skill content).
 *
 * Boundary: this module NEVER invokes a model and NEVER owns terrain, navigation,
 * physics, or reconstruction authority. It normalizes agent output into project/runtime
 * forms and verifies accepted results deterministically (no model credentials).
 */

export * from "./types";
export * from "./verify";
