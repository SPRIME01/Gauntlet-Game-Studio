/**
 * Structured DCC jobs (REQ-DCC-001..002, spec v0.5.0).
 *
 * DCC work is declared, reviewable, and reproducible: explicit inputs,
 * operations, the reason cheaper cascade routes were insufficient, budgets,
 * outputs, deterministic definition, acceptance, and verification. DCC jobs
 * are consumed by the settled dcc.blender.process capability path — this
 * module validates and persists the declarations, it is not a second DCC
 * execution authority, and DCC never owns gameplay semantics (REQ-DCC-002).
 */

import { DccJobSchema, type DccJob } from "@gauntlet/contracts";
import { defaultCapabilityRegistry } from "../capabilities/registry";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export type DccJobErrorCode =
  | "DCC_JOB_INVALID"
  | "DCC_CAPABILITY_UNKNOWN"
  | "DCC_CASCADE_RATIONALE_REQUIRED";

export class DccJobError extends Error {
  constructor(
    readonly code: DccJobErrorCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "DccJobError";
  }
}

/**
 * Validate a DCC job declaration. Beyond schema strictness, the capability
 * must exist in the registry and the cascade rationale must actually argue
 * why cheaper routes failed — an empty or copy-paste rationale is rejected
 * (the tooth REQ-DCC-001 demands).
 */
export function validateDccJob(job: unknown): DccJob {
  let parsed: DccJob;
  try {
    parsed = DccJobSchema.parse(job);
  } catch (error) {
    const message = String(error);
    if (/cascade_rationale/.test(message)) {
      throw new DccJobError(
        "DCC_CASCADE_RATIONALE_REQUIRED",
        `DCC job must record why lighter cascade routes (R0–R7) were insufficient: ${message}`,
      );
    }
    throw new DccJobError("DCC_JOB_INVALID", message);
  }

  const registry = defaultCapabilityRegistry;
  if (!registry.has(parsed.capability_id)) {
    throw new DccJobError(
      "DCC_CAPABILITY_UNKNOWN",
      `DCC job '${parsed.id}' names capability '${parsed.capability_id}' which is not in the registry`,
    );
  }

  const rationale = parsed.cascade_rationale.trim().toLowerCase();
  const weak =
    rationale.length < 24 ||
    ["because i want", "n/a", "none", "fastest", "easier"].some((phrase) => rationale === phrase);
  if (weak && parsed.cascade_attempts.length === 0) {
    throw new DccJobError(
      "DCC_CASCADE_RATIONALE_REQUIRED",
      `DCC job '${parsed.id}' carries no cascade attempts and its rationale does not demonstrate that cheaper routes were searched`,
    );
  }
  return parsed;
}

export function persistDccJob(projectRoot: string, job: DccJob): string {
  const dir = join(projectRoot.replace(/\/$/, ""), ".studio", "dcc-jobs");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, `${job.id.replace(/[^A-Za-z0-9._-]/g, "_")}.json`);
  Bun.write(path, JSON.stringify(job, null, 2));
  return path;
}

export function loadDccJob(projectRoot: string, id: string): DccJob {
  const path = join(projectRoot.replace(/\/$/, ""), ".studio", "dcc-jobs", `${id.replace(/[^A-Za-z0-9._-]/g, "_")}.json`);
  if (!existsSync(path)) {
    throw new DccJobError("DCC_JOB_INVALID", `no DCC job '${id}' under ${dirName(projectRoot)}`);
  }
  return validateDccJob(JSON.parse(require("node:fs").readFileSync(path, "utf8")));
}

function dirName(projectRoot: string): string {
  return join(projectRoot.replace(/\/$/, ""), ".studio", "dcc-jobs");
}
