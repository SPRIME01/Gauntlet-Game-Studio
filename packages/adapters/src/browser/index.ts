/**
 * Browser proof adapters (T20).
 * Deterministic Playwright proof harness over the stable T19 observability contract
 * (`__GAUNTLET_STUDIO_OBS__` v1), plus the committed deterministic fixture scenario.
 *
 * Boundary: agent-browser remains exploratory/debugging-only; it MUST NOT be the sole
 * settlement oracle (REQ-BIND-010). This harness is the deterministic proof binding.
 */

export * from "./types";
export * from "./surface-client";
export * from "./fixture";
export * from "./harness";
export * from "./perf";
