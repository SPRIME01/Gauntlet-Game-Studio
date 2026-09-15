/**
 * @gauntlet/studio
 * Capability registry, router, asset pipeline, evidence collector, and studio director.
 */

export const STUDIO_VERSION = "0.2.0";

export * from "./config";
export * from "./doctor";
export * from "./capabilities/catalog";
export * from "./capabilities/registry";
export * from "./skills/linter";
export * from "./router/router";
export * from "./generator";
