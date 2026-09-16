/**
 * Stable studio error classes (spec error_classes vocabulary).
 *
 * Error surface requirements: errors MUST include a stable code, a concise message,
 * and a recoverability hint where possible; errors MUST NOT include secrets or
 * excessive raw configuration.
 */

/** One violated budget under a named quality profile. */
export interface BudgetViolation {
  /** Declared budget key, e.g. "structural_budgets.max_draw_calls". */
  budget: string;
  /** Declared limit (profile-owned numeric). */
  limit: number;
  /** Measured value that exceeded the budget. */
  measured: number;
  /** Where the measurement came from (channel/scope), e.g. "performance.renderer_stats". */
  scope: string;
}

/**
 * budget_error — "Blocks acceptance under the affected quality profile."
 * Raised when a measured value violates a declared structural or hardware budget;
 * visual quality alone can never recover it (REQ-PERF-004).
 */
export class BudgetError extends Error {
  readonly code = "budget_error";
  constructor(
    message: string,
    readonly details: {
      quality_profile: string;
      violations: BudgetViolation[];
      /** Recoverability hint (required surface element). */
      recoverability: string;
    }
  ) {
    super(message);
    this.name = "BudgetError";
  }
}

/** Minimal JSON-safe projection of a BudgetError for structured results. */
export interface BudgetErrorSummary {
  code: "budget_error";
  quality_profile: string;
  violations: BudgetViolation[];
  recoverability: string;
}

export function budgetErrorSummary(err: BudgetError): BudgetErrorSummary {
  return {
    code: err.code,
    quality_profile: err.details.quality_profile,
    violations: err.details.violations,
    recoverability: err.details.recoverability,
  };
}
