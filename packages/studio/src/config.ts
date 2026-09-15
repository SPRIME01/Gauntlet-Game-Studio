import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";

export const StudioConfigSchema = z
  .object({
    project_id: z.string().min(1).default("default-project"),
    title: z.string().min(1).default("Gauntlet Game"),
    version: z.string().default("0.1.0"),
    runtime: z
      .object({
        engine: z.literal("three").default("three"),
        rapier: z.boolean().default(true),
        recast: z.boolean().default(true),
        bvh: z.boolean().default(true),
        multiplayer: z.enum(["none", "websocket", "webrtc"]).default("none"),
      })
      .default({
        engine: "three",
        rapier: true,
        recast: true,
        bvh: true,
        multiplayer: "none",
      }),
    budgets: z
      .object({
        max_draw_calls: z.number().int().positive().default(150),
        max_triangles: z.number().int().positive().default(200_000),
        target_fps: z.number().int().positive().default(60),
      })
      .default({
        max_draw_calls: 150,
        max_triangles: 200_000,
        target_fps: 60,
      }),
    providers: z.record(z.string(), z.string()).default({}),
    secrets: z.record(z.string(), z.string()).default({}),
  })
  .strict();

export type StudioConfig = z.infer<typeof StudioConfigSchema>;

export class ConfigValidationError extends Error {
  code = "CONFIG_VALIDATION_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

export class ConfigSecretLeakError extends Error {
  code = "SECRET_LEAK_DETECTED";
  constructor(key: string) {
    // REQ-SEC-001: Never echo the secret value in error messages or logs!
    super(`Secret leak detected in configuration key '${key}'. Values must reference environment variables (e.g. '$VAR_NAME'), not raw literals.`);
    this.name = "ConfigSecretLeakError";
  }
}

export class DonorDependencyError extends Error {
  code = "DONOR_DEPENDENCY_DETECTED";
  constructor(location: string) {
    super(`Disallowed donor dependency detected at '${location}'. Normal studio operations must not rely on .tmp/donor.`);
    this.name = "DonorDependencyError";
  }
}

/**
 * Checks for literal secret leakage in a configuration value.
 */
function assertSecretHygiene(key: string, value: unknown): void {
  if (typeof value === "string") {
    // If key indicates a secret or token
    const lowerKey = key.toLowerCase();
    const isSecretKey =
      lowerKey.includes("secret") ||
      lowerKey.includes("token") ||
      lowerKey.includes("api_key") ||
      lowerKey.includes("password") ||
      lowerKey.includes("private_key");

    if (isSecretKey && value.length > 0) {
      if (!value.startsWith("$")) {
        throw new ConfigSecretLeakError(key);
      }
    }
  } else if (typeof value === "object" && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      assertSecretHygiene(k, v);
    }
  }
}

/**
 * Validates that no path or reference points to the donor workspace.
 */
function assertDonorIsolation(obj: unknown, loc: string = "config"): void {
  if (typeof obj === "string") {
    if (obj.includes(".tmp/donor") || obj.includes(".tmp/donor/mavon")) {
      throw new DonorDependencyError(loc);
    }
  } else if (typeof obj === "object" && obj !== null) {
    for (const [k, v] of Object.entries(obj)) {
      assertDonorIsolation(v, `${loc}.${k}`);
    }
  }
}

/**
 * Loads configuration following the specification precedence:
 * 1. Explicit runtime overrides
 * 2. Project configuration file (gauntlet.config.json)
 * 3. Studio default configuration
 */
export function loadStudioConfig(
  cwd: string = process.cwd(),
  overrides: Partial<StudioConfig> = {}
): StudioConfig {
  let fileConfig: Record<string, unknown> = {};
  const configPath = path.join(cwd, "gauntlet.config.json");

  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, "utf-8");
      fileConfig = JSON.parse(raw);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ConfigValidationError(`Failed to parse gauntlet.config.json: ${msg}`);
    }
  }

  // Check donor isolation and secret hygiene in raw file config
  assertDonorIsolation(fileConfig);
  assertSecretHygiene("root", fileConfig);

  // Merge defaults, file config, and overrides
  const merged = {
    ...fileConfig,
    ...overrides,
    runtime: {
      ...((fileConfig.runtime as Record<string, unknown>) || {}),
      ...(overrides.runtime || {}),
    },
    budgets: {
      ...((fileConfig.budgets as Record<string, unknown>) || {}),
      ...(overrides.budgets || {}),
    },
  };

  assertDonorIsolation(merged);
  assertSecretHygiene("merged", merged);

  const parsed = StudioConfigSchema.safeParse(merged);
  if (!parsed.success) {
    throw new ConfigValidationError(
      `Invalid studio configuration: ${parsed.error.issues.map((e: z.ZodIssue) => `${e.path.join(".")}: ${e.message}`).join(", ")}`
    );
  }

  return parsed.data;
}
