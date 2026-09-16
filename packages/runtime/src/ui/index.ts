/**
 * First-party DOM/CSS HUD conventions (T17).
 * Pure-data HUD state model plus an opt-in DOM renderer that is never required on
 * headless/server paths (import-safe without DOM).
 */

export * from "./hud-state";
export * from "./dom-hud";
