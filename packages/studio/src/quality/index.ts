/**
 * Quality profiles and performance budget evaluation (T21).
 * Project-local quality-profile schema (numbers live in the game project per
 * REQ-CONFIG-005), declared-before-use gate resolution, deterministic structural vs
 * hardware-sensitive budget separation (REQ-PERF-003), software-renderer guard, and
 * typed budget_error violations (REQ-PERF-004).
 */

export * from "./profiles";
export * from "./evaluate";
