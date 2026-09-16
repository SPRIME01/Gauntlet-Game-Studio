/**
 * Studio evidence module (T20).
 * Immutable ObservationRun / EvidenceManifest storage under artifacts/runs/<run-id>/,
 * identity-based freshness and correlation validation, append-only preservation of
 * failed/contradictory evidence, and committed fixture checking.
 */

export * from "./revision";
export * from "./store";
