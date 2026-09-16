/**
 * Quality-profile schema and project-local loading (T21, REQ-PERF-002, REQ-PERF-003,
 * REQ-CONFIG-005).
 *
 * The SCHEMA (what a quality profile is) lives in the studio; the NUMBERS live in the
 * game project (e.g. examples/blackwater-relay/.agents/specs/game.spec.yaml). Numeric
 * budgets are never hardcoded in provider adapters, and no universal cross-game target
 * exists. Profiles are declared BEFORE they are used as gates: verifying against an
 * undeclared profile is a typed failure, never an implicit pass.
 *
 * Structural budgets (draw calls, triangles, textures/resources, console errors, asset
 * byte sizes) are deterministic and enforceable in any environment, including
 * software-rendered CI. Hardware-sensitive budgets (FPS, frame-time percentiles, load
 * timing, memory) bind to the profile's named environment_binding — or, for
 * `structural+relative-baseline` profiles, to an explicit declared relative baseline —
 * and can never be settled by a software-rendered run masquerading as target hardware.
 */

import * as fs from "node:fs";
import { z } from "zod";

export const QualityMetricRulesSchema = z
  .object({
    /** Frame-time distribution percentiles that MUST be reported and evaluated. */
    frame_time_percentiles: z.array(z.enum(["p50", "p95", "p99"])).min(1),
    /** Average-only reporting is rejected when percentile rules are declared. */
    average_only_rejected: z.boolean(),
  })
  .strict();

export const StructuralBudgetsSchema = z
  .object({
    max_draw_calls: z.number().int().nonnegative().optional(),
    max_triangles: z.number().int().nonnegative().optional(),
    max_textures: z.number().int().nonnegative().optional(),
    max_resources: z.number().int().nonnegative().optional(),
    max_console_errors: z.number().int().nonnegative().optional(),
    /** Scene-total asset byte budget (fed from T13 Asset Registry data where applicable). */
    max_asset_bytes: z.number().int().nonnegative().optional(),
  })
  .strict();

export const RelativeBaselineSchema = z
  .object({
    description: z.string().min(1),
    /** Named deterministic baseline the relative budgets are expressed against. */
    baseline_ref: z.string().min(1),
  })
  .strict();

export const HardwareBudgetsSchema = z
  .object({
    target_fps: z.number().positive().optional(),
    min_fps_avg: z.number().positive().optional(),
    max_frame_time_p50_ms: z.number().positive().optional(),
    max_frame_time_p95_ms: z.number().positive().optional(),
    max_frame_time_p99_ms: z.number().positive().optional(),
    max_load_ms: z.number().positive().optional(),
    max_memory_mb: z.number().positive().optional(),
    /** Explicit relative-baseline binding instead of absolute hardware targets. */
    relative_baseline: RelativeBaselineSchema.optional(),
  })
  .strict();

export const QualityEvidenceClassSchema = z.enum([
  "structural-only",
  "structural+relative-baseline",
  "hardware-target",
]);

export const QualityProfileSchema = z
  .object({
    description: z.string().min(1),
    /** What class of evidence this profile accepts. */
    evidence_class: QualityEvidenceClassSchema,
    /** Named environment this profile's hardware-sensitive acceptance binds to. */
    environment_binding: z.string().min(1),
    /** Declared metric rules — WHICH metrics gate acceptance and how. */
    metric_rules: QualityMetricRulesSchema,
    structural_budgets: StructuralBudgetsSchema,
    hardware_budgets: HardwareBudgetsSchema,
  })
  .strict();

export type QualityMetricRules = z.infer<typeof QualityMetricRulesSchema>;
export type StructuralBudgets = z.infer<typeof StructuralBudgetsSchema>;
export type HardwareBudgets = z.infer<typeof HardwareBudgetsSchema>;
export type QualityEvidenceClass = z.infer<typeof QualityEvidenceClassSchema>;
export type QualityProfile = z.infer<typeof QualityProfileSchema>;

/** quality_profiles mapping in a game project spec: profile id -> profile. */
export const QualityProfilesFileSchema = z.record(
  z.string().regex(/^[a-z0-9][a-z0-9._-]*$/, "profile id must be a normalized identifier"),
  QualityProfileSchema
);

export type QualityProfilesFile = z.infer<typeof QualityProfilesFileSchema>;

export class QualityProfileError extends Error {
  readonly code: string;
  constructor(code: "PROFILE_NOT_DECLARED" | "PROFILE_SCHEMA_INVALID" | "GAME_SPEC_UNREADABLE", message: string) {
    super(message);
    this.name = "QualityProfileError";
    this.code = code;
  }
}

/**
 * Loads and validates the `quality_profiles` section of a game project spec
 * (YAML). Profiles are usable as gates only after this declaration exists.
 */
export function loadQualityProfiles(gameSpecPath: string): QualityProfilesFile {
  let raw: unknown;
  try {
    const text = fs.readFileSync(gameSpecPath, "utf-8");
    raw = Bun.YAML.parse(text);
  } catch (err) {
    throw new QualityProfileError(
      "GAME_SPEC_UNREADABLE",
      `could not read game spec '${gameSpecPath}': ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!raw || typeof raw !== "object" || !("quality_profiles" in (raw as Record<string, unknown>))) {
    throw new QualityProfileError(
      "PROFILE_NOT_DECLARED",
      `game spec '${gameSpecPath}' declares no quality_profiles; profiles MUST be declared in the game project before they are used as gates (REQ-PERF-002, REQ-CONFIG-005)`
    );
  }
  const parsed = QualityProfilesFileSchema.safeParse((raw as Record<string, unknown>).quality_profiles);
  if (!parsed.success) {
    throw new QualityProfileError(
      "PROFILE_SCHEMA_INVALID",
      `quality_profiles in '${gameSpecPath}' failed the quality-profile schema: ${parsed.error.message}`
    );
  }
  return parsed.data;
}

/** Resolves ONE declared profile by id; undeclared profiles are a typed failure. */
export function resolveQualityProfile(profiles: QualityProfilesFile, id: string): QualityProfile {
  const profile = profiles[id];
  if (!profile) {
    throw new QualityProfileError(
      "PROFILE_NOT_DECLARED",
      `quality profile '${id}' is not declared by the game project (declared: ${Object.keys(profiles).join(", ") || "none"}); undeclared profiles can never be used as gates`
    );
  }
  return profile;
}

/** A quality profile bound to its declared game-project id. */
export type ResolvedQualityProfile = QualityProfile & { id: string };

/** Resolves a profile AND binds its declared id (the id the gate was declared under). */
export function bindQualityProfile(profiles: QualityProfilesFile, id: string): ResolvedQualityProfile {
  return { ...resolveQualityProfile(profiles, id), id };
}
