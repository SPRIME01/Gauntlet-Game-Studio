/**
 * Asset acceptance gates for the Gauntlet Asset Registry.
 *
 * Pure evaluation functions over the frozen AssetRecord contract (packages/contracts).
 * Gate outcomes are the ONLY route to production acceptance; they never infer state
 * from visual plausibility. Settles REQ-OUT-002, REQ-ASSET-003, REQ-ASSET-006,
 * REQ-ASSET-007, REQ-BIND-008, REQ-SAFE-003, REQ-SEC-004.
 */

import type { AssetRecord, AssetOrigin } from "@gauntlet/contracts";

export type GateStatus = "pass" | "fail" | "blocked" | "waived";

export interface GateResult {
  gate: string;
  status: GateStatus;
  detail: string;
}

export interface AssetGateOptions {
  /** Asset id is registered as reference-only imagery (REQ-ASSET-004). */
  referenceOnly?: boolean;
  /** Asset ids with an explicitly recorded policy waiver (budget gate only). */
  waivedGates?: ReadonlySet<string>;
}

export interface AssetGateReport {
  asset_id: string;
  acceptance_state: AssetRecord["acceptance_state"];
  production_acceptable: boolean;
  results: GateResult[];
  blockers: GateResult[];
}

export interface AssetPolicy {
  /** Roles matching this pattern require a collider_policy at acceptance. */
  colliderRequiredRolePattern: RegExp;
  /** Roles matching this pattern require a lod_policy at acceptance. */
  lodRequiredRolePattern: RegExp;
}

export const DEFAULT_ASSET_POLICY: AssetPolicy = {
  colliderRequiredRolePattern: /(hero|vehicle|character|weapon|prop)/,
  lodRequiredRolePattern: /(hero|vehicle|character|weapon|prop|environment)/,
};

/**
 * Licenses/authorization states acceptable for production acceptance, per origin class.
 * REQ-SEC-004: acceptance MUST include provenance/license state appropriate to the
 * project's distribution model. Unknown or unacceptable license states are blocked.
 */
const ACCEPTABLE_LICENSES: ReadonlyArray<string> = [
  // Open/creative-commons source classes
  "cc0",
  "cc0-1.0",
  "cc-by-4.0",
  "cc-by-3.0",
  "cc-by-sa-4.0",
  "cc-by-sa-3.0",
  "unlicense",
  "public-domain",
  // Permissive software-adjacent (for bundled data)
  "mit",
  "apache-2.0",
  "bsd-2-clause",
  "bsd-3-clause",
  "isc",
  "0bsd",
  // Project-internal authorization classes
  "user-authorized",
  "project-owned",
  "in-house-generated",
  "proprietary",
];

export function isAcceptableLicense(origin: AssetOrigin, license: string | undefined): boolean {
  if (!license) return false;
  const normalized = license.trim().toLowerCase();
  if (normalized.length === 0) return false;
  if (normalized === "unknown" || normalized === "unspecified" || normalized === "tbd") return false;
  return ACCEPTABLE_LICENSES.includes(normalized);
}

export const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

export interface ProvenanceViolation {
  requirement: string;
  detail: string;
}

/**
 * Provenance/license/source-hash intake validation per origin class.
 *
 * REQ-ASSET-003: open-web acquisition MUST preserve source URL/reference, retrieval
 * metadata, license/authorization assessment, and source hash where retained.
 * Provenance classes remain distinguishable (REQ-ASSET-004): user, project, cc0,
 * licensed, generated, blender, procedural each carry distinct required evidence.
 */
export function validateProvenanceIntake(
  origin: AssetOrigin,
  provenance: AssetRecord["source_provenance"]
): ProvenanceViolation[] {
  const violations: ProvenanceViolation[] = [];
  const require = (ok: boolean, requirement: string, detail: string) => {
    if (!ok) violations.push({ requirement, detail });
  };

  require(
    isAcceptableLicense(origin, provenance.license),
    "license",
    `Origin '${origin}' requires an acceptable license/authorization state; got '${provenance.license ?? "none"}'`
  );

  switch (origin) {
    case "cc0":
    case "licensed":
      require(typeof provenance.uri === "string" && provenance.uri.length > 0, "source_uri", "External sourced assets must record the source URI/reference");
      require(typeof provenance.author === "string" && provenance.author.length > 0, "author", "External sourced assets must record the author/attribution");
      require(typeof provenance.retrieved_at === "string" && provenance.retrieved_at.length > 0, "retrieval_metadata", "External sourced assets must record retrieval metadata");
      break;
    case "user":
      require(typeof provenance.uri === "string" && provenance.uri.length > 0, "source_uri", "User-provided assets must record the supplied reference/origin");
      break;
    case "generated":
    case "blender":
    case "procedural":
      // Derived/generated assets must remain distinguishable and traceable to their route.
      break;
    case "project":
      require(typeof provenance.uri === "string" || typeof provenance.author === "string", "project_reference", "Project assets must record an internal reference or owning author");
      break;
  }

  // Source hash required wherever the source is retained (REQ-ASSET-003).
  require(
    typeof provenance.sha256 === "string" && SHA256_PATTERN.test(provenance.sha256),
    "source_hash",
    "A 64-hex-char lower/upper-case sha256 source hash is required where the source is retained"
  );

  return violations;
}

function budgetGate(record: AssetRecord, waivedGates: ReadonlySet<string>): GateResult {
  const budget = record.budget as Record<string, unknown>;
  const limits = Object.keys(budget).filter((k) => k.startsWith("max_"));
  if (limits.length === 0) {
    return { gate: "budget", status: "pass", detail: "No runtime budgets declared for this asset" };
  }
  for (const limitKey of limits) {
    const limit = budget[limitKey];
    const measuredKey = `measured_${limitKey.slice("max_".length)}`;
    const measured = budget[measuredKey];
    if (typeof limit !== "number") {
      return { gate: "budget", status: "fail", detail: `Budget limit '${limitKey}' must be numeric` };
    }
    if (typeof measured !== "number") {
      if (waivedGates.has("budget")) {
        return { gate: "budget", status: "waived", detail: `Budget gate waived by explicit policy waiver for '${limitKey}'` };
      }
      return {
        gate: "budget",
        status: "fail",
        detail: `Budget limit '${limitKey}' has no '${measuredKey}' measurement; unmeasured assets cannot be accepted`,
      };
    }
    if (measured > limit) {
      if (waivedGates.has("budget")) {
        return { gate: "budget", status: "waived", detail: `Budget gate waived by explicit policy waiver ('${measuredKey}'=${measured} > '${limitKey}'=${limit})` };
      }
      return {
        gate: "budget",
        status: "fail",
        detail: `Over budget: '${measuredKey}'=${measured} exceeds '${limitKey}'=${limit}`,
      };
    }
  }
  return { gate: "budget", status: "pass", detail: `All ${limits.length} declared budget limit(s) satisfied by measurements` };
}

function textureFormatGate(record: AssetRecord): GateResult {
  const budget = record.budget as Record<string, unknown>;
  const required = budget["required_texture_format"];
  if (required === undefined || required === null) {
    return { gate: "texture_format", status: "pass", detail: "No required texture format declared" };
  }
  const achieved = budget["texture_format"];
  if (required === "ktx2") {
    if (achieved !== "ktx2") {
      // REQ-BIND-008 / REQ-ASSET-006: silent downgrade from a required KTX2 profile is prohibited.
      return {
        gate: "texture_format",
        status: "blocked",
        detail: `Profile requires KTX2 but achieved texture format is '${String(achievement(achieved))}'; silent downgrade prohibited`,
      };
    }
    if (budget["toktx_preflight"] !== "pass") {
      return {
        gate: "texture_format",
        status: "blocked",
        detail: "KTX2 acceptance requires recorded successful toktx preflight (toktx_preflight=pass)",
      };
    }
    return { gate: "texture_format", status: "pass", detail: "KTX2 achieved with successful toktx preflight" };
  }
  if (required === "webp") {
    if (achieved !== "webp") {
      return {
        gate: "texture_format",
        status: "fail",
        detail: `Profile requires portable baseline WebP but achieved texture format is '${String(achievement(achieved))}'`,
      };
    }
    return { gate: "texture_format", status: "pass", detail: "WebP baseline achieved" };
  }
  return { gate: "texture_format", status: "fail", detail: `Unknown required_texture_format '${String(required)}'` };
}

function achievement(value: unknown): string {
  return value === undefined || value === null ? "none" : String(value);
}

/**
 * Evaluate every project-required gate for one asset record.
 * `production_acceptable` is true only when no gate fails/blocks and the record's
 * acceptance state is accepted (clean) or degraded (explicit recorded waiver).
 */
export function evaluateAsset(
  record: AssetRecord,
  options: AssetGateOptions & { policy?: AssetPolicy } = {}
): AssetGateReport {
  const policy = options.policy ?? DEFAULT_ASSET_POLICY;
  const waivedGates = options.waivedGates ?? new Set<string>();
  const results: GateResult[] = [];

  // Reference-only imagery is never production content (REQ-ASSET-004).
  if (options.referenceOnly) {
    results.push({
      gate: "reference_only",
      status: "blocked",
      detail: "Asset is registered as reference-only imagery and can never be accepted production content",
    });
  }

  // Provenance gate (unknown provenance -> blocked).
  const provenanceViolations = validateProvenanceIntake(record.origin, record.source_provenance);
  if (provenanceViolations.length > 0) {
    results.push({
      gate: "provenance",
      status: "blocked",
      detail: `Unknown or incomplete provenance: ${provenanceViolations.map((v) => `${v.requirement} (${v.detail})`).join("; ")}`,
    });
  } else {
    results.push({ gate: "provenance", status: "pass", detail: "Provenance, license, and source hash present and acceptable" });
  }

  // Collider/LOD policy gate where required.
  if (policy.colliderRequiredRolePattern.test(record.role) && !record.collider_policy) {
    results.push({ gate: "collider_policy", status: "fail", detail: `Role '${record.role}' requires a collider_policy` });
  } else {
    results.push({ gate: "collider_policy", status: "pass", detail: "Collider policy satisfied or not required" });
  }
  if (policy.lodRequiredRolePattern.test(record.role) && !record.lod_policy) {
    results.push({ gate: "lod_policy", status: "fail", detail: `Role '${record.role}' requires a lod_policy` });
  } else {
    results.push({ gate: "lod_policy", status: "pass", detail: "LOD policy satisfied or not required" });
  }

  results.push(budgetGate(record, waivedGates));
  results.push(textureFormatGate(record));

  const blockers = results.filter((r) => r.status === "fail" || r.status === "blocked");
  const stateOk = record.acceptance_state === "accepted" || record.acceptance_state === "degraded";
  return {
    asset_id: record.id,
    acceptance_state: record.acceptance_state,
    production_acceptable: stateOk && blockers.length === 0,
    results,
    blockers,
  };
}
