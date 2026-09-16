/**
 * @gauntlet/runtime observability module (T19).
 * Stable versioned development/test observability surface
 * (`__GAUNTLET_STUDIO_OBS__` v1, mounted as `window.__GAUNTLET_STUDIO_OBS__`)
 * with production gating that strips all privileged debug mutation
 * (REQ-OUT-004, REQ-OBS-001..005, REQ-SEC-005).
 *
 * The bridge is a read/projection and controlled-invocation layer; Koota
 * (GameWorld) remains the sole semantic authority.
 */

export * from "./contract";
export * from "./bridge";
export * from "./validate";
export * from "./production-check";
