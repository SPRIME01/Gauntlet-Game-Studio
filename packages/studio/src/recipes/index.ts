/**
 * Recipe layer — outcome-oriented semantic composition above the capability system.
 *
 * intent → recipe → capabilities → runtime
 *
 * Reuses capability registry/router, contracts, asset resolution, evidence, and
 * Gauntlet settlement. Does not introduce a parallel path or second authority.
 */
export * from "./catalog";
export * from "./registry";
export * from "./compiler";
export * from "./apply";
