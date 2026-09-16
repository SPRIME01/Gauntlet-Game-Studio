/**
 * Frozen expectations for Gauntlet settlement (T20, REQ-GAUNTLET-002).
 *
 * "Each settlement-critical increment MUST have frozen expectations before its final
 * evidence is evaluated." A FrozenExpectation is the declared, channel-appropriate
 * oracle for one scenario: which observation channels the claim requires, and the
 * concrete constraints each channel must satisfy. Expectations are frozen BEFORE
 * evidence evaluation — never derived from a run afterwards.
 */

import { z } from "zod";

export const SemanticEntityExpectationSchema = z
  .object({
    /** Authoritative entity ID (Koota correlation ID). */
    id: z.string().min(1),
    tags_include: z.array(z.string().min(1)).default([]),
    position_approx: z
      .object({ x: z.number(), y: z.number(), z: z.number() })
      .strict()
      .optional(),
    tolerance: z.number().positive().default(1e-6),
  })
  .strict();

export const SemanticConstraintsSchema = z
  .object({
    entities: z.array(SemanticEntityExpectationSchema).min(1),
  })
  .strict();

export const PixelConstraintsSchema = z
  .object({
    /** Named views that MUST have fresh rendered captures. */
    views: z.array(z.string().min(1)).min(1).default(["main"]),
    min_width: z.number().int().positive().default(1),
    min_height: z.number().int().positive().default(1),
  })
  .strict();

export const TelemetryConstraintsSchema = z
  .object({
    max_console_errors: z.number().int().nonnegative().default(0),
    max_page_errors: z.number().int().nonnegative().default(0),
    /** The authoritative tick must have advanced at least this far after stepping. */
    tick_advanced_min: z.number().int().nonnegative().default(1),
  })
  .strict();

export const NetworkConstraintsSchema = z
  .object({
    require_all_ok: z.boolean().default(true),
    min_responses: z.number().int().nonnegative().default(1),
  })
  .strict();

/**
 * Performance constraints (T21, REQ-VERIFY-003, REQ-PERF-002/003): the claim names
 * ONE quality profile declared by the game project; the profile's OWN budgets and
 * metric rules (loaded from the game project, never duplicated here) gate acceptance.
 */
export const PerformanceConstraintsSchema = z
  .object({
    /** Quality-profile id that MUST be declared in the game project before use. */
    profile: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/, "quality profile id must be a normalized identifier"),
  })
  .strict();

export const ClaimChannelsSchema = z
  .object({
    state: z.boolean().default(false),
    pixels: z.boolean().default(false),
    telemetry: z.boolean().default(false),
    network: z.boolean().default(false),
    performance: z.boolean().default(false),
  })
  .strict();

export const FrozenExpectationSchema = z
  .object({
    id: z.string().min(1),
    scenario_id: z.string().min(1),
    requirement_ids: z.array(z.string().min(1)).min(1),
    /**
     * Project revision the expectation is bound to. The sentinel "current" resolves
     * to the live project revision at settlement time (fresh evidence required).
     */
    revision: z.string().min(1),
    seed: z.number().int().optional(),
    steps: z.number().int().min(1).max(240).default(3),
    view: z.string().min(1).default("main"),
    claims: ClaimChannelsSchema.default({
      state: false,
      pixels: false,
      telemetry: false,
      network: false,
      performance: false,
    }),
    requires_confirmation: z.boolean().default(false),
    semantic: SemanticConstraintsSchema.optional(),
    pixels: PixelConstraintsSchema.optional(),
    telemetry: TelemetryConstraintsSchema.optional(),
    network: NetworkConstraintsSchema.optional(),
    performance: PerformanceConstraintsSchema.optional(),
  })
  .strict()
  .refine(
    (e) => e.claims.state || e.claims.pixels || e.claims.telemetry || e.claims.network || e.claims.performance,
    { message: "frozen expectation must claim at least one observation channel" }
  )
  .refine(
    (e) =>
      (!e.claims.state || e.semantic !== undefined) &&
      (!e.claims.pixels || e.pixels !== undefined) &&
      (!e.claims.telemetry || e.telemetry !== undefined) &&
      (!e.claims.network || e.network !== undefined) &&
      (!e.claims.performance || e.performance !== undefined),
    { message: "each claimed channel must declare its constraint block" }
  );

export type FrozenExpectation = z.infer<typeof FrozenExpectationSchema>;
export type SemanticEntityExpectation = z.infer<typeof SemanticEntityExpectationSchema>;
export type PerformanceConstraints = z.infer<typeof PerformanceConstraintsSchema>;

/** Sentinel revision meaning "resolve to the live project revision at settle time". */
export const CURRENT_REVISION_SENTINEL = "current";

/** Parses/validates a frozen expectation (e.g. from a committed fixture file). */
export function parseFrozenExpectation(raw: unknown): FrozenExpectation {
  return FrozenExpectationSchema.parse(raw) as FrozenExpectation;
}
