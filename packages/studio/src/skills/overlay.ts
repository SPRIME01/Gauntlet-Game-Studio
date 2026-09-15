import * as fs from "node:fs";
import * as path from "node:path";

export class ForbiddenUpstreamAuthorityError extends Error {
  public readonly code = "FORBIDDEN_UPSTREAM_AUTHORITY";
  constructor(public readonly skillId: string, message?: string) {
    super(message || `Skill '${skillId}' violates overlay policy: upstream orchestration director cannot compete with studio router.`);
    this.name = "ForbiddenUpstreamAuthorityError";
  }
}

export class UnnecessaryVendoringError extends Error {
  public readonly code = "UNNECESSARY_VENDORING_DETECTED";
  constructor(public readonly packageName: string, message?: string) {
    super(message || `Package '${packageName}' is vendored in vendor/ but should be a pinned package dependency (REQ-SOURCE-001).`);
    this.name = "UnnecessaryVendoringError";
  }
}

export interface SkillOverlayPolicy {
  schema: string;
  schema_version: string;
  upstream: string;
  orchestration_authority: string;
  forbidden_skills: string[];
  allowed_specialists: string[];
  quarantined_skills: string[];
}

export interface AttributionClassManifest {
  schema: string;
  schema_version: string;
  classes: {
    runtime_dependency: Array<{ name: string; version: string; license: string; purpose: string }>;
    agent_skill_source: Array<{ id: string; vendor_path: string; upstream: string; license: string }>;
    temporary_donor: Array<{ id: string; donor_path: string; status: string; purpose: string }>;
    copied_code: Array<{ id: string; original_source: string; target_path: string }>;
    external_asset: Array<{ source: string; license: string; purpose: string }>;
  };
}

/**
 * Validates a skill overlay policy against REQ-SOURCE-005.
 * Prohibits upstream directors (like threejs-game-director) from becoming competing orchestration authorities.
 */
export function validateOverlayPolicy(policy: SkillOverlayPolicy): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (policy.orchestration_authority !== "gauntlet-game-studio") {
    errors.push(`Orchestration authority must be 'gauntlet-game-studio', found '${policy.orchestration_authority}'`);
  }

  const normalizedForbidden = policy.forbidden_skills.map((s) => s.toLowerCase());
  if (!normalizedForbidden.includes("threejs-game-director")) {
    errors.push("threejs-game-director must be explicitly included in forbidden_skills (REQ-SOURCE-005)");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Checks whether a proposed skill is allowed by the overlay policy.
 * Throws ForbiddenUpstreamAuthorityError if the skill violates the policy (Teeth Attack 1).
 */
export function checkSkillAgainstOverlay(skillId: string, policy: SkillOverlayPolicy): void {
  const normalized = skillId.toLowerCase().trim();
  for (const forbidden of policy.forbidden_skills) {
    if (normalized === forbidden.toLowerCase().trim()) {
      throw new ForbiddenUpstreamAuthorityError(
        skillId,
        `Skill '${skillId}' is strictly prohibited: upstream director cannot act as orchestration authority (REQ-SOURCE-005)`
      );
    }
  }
}

/**
 * Lints vendor/ and third-party manifests to prevent unnecessary vendoring of standard runtime libraries (Teeth Attack 2).
 */
export function lintSourceAttribution(vendorDir: string, attribution: AttributionClassManifest): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // 1. Check classes structure
  const requiredClasses = [
    "runtime_dependency",
    "agent_skill_source",
    "temporary_donor",
    "copied_code",
    "external_asset",
  ];

  for (const cls of requiredClasses) {
    if (!(cls in attribution.classes)) {
      errors.push(`Missing required attribution class '${cls}' (REQ-SOURCE-006)`);
    }
  }

  // 2. Scan vendorDir for forbidden runtime library vendoring
  if (fs.existsSync(vendorDir)) {
    const forbiddenVendoredLibs = ["three", "koota", "rapier", "three-mesh-bvh", "tone", "playwright"];
    const vendorEntries = fs.readdirSync(vendorDir);

    for (const entry of vendorEntries) {
      const lower = entry.toLowerCase();
      for (const lib of forbiddenVendoredLibs) {
        if (lower === lib || lower.startsWith(lib + "-")) {
          errors.push(`Runtime library '${entry}' must not be vendored in vendor/. Use pinned package dependency instead (REQ-SOURCE-001).`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates single Three.js dependency resolution across monorepo packages.
 */
export function verifySingleThreeVersion(packageJsonFiles: string[]): { uniform: boolean; version: string; mismatched: Record<string, string> } {
  const versions: Record<string, string> = {};

  for (const pkgPath of packageJsonFiles) {
    if (!fs.existsSync(pkgPath)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const threeVer = parsed.dependencies?.three || parsed.devDependencies?.three;
      if (threeVer) {
        versions[pkgPath] = threeVer;
      }
    } catch {
      // ignore
    }
  }

  const distinct = new Set(Object.values(versions));
  return {
    uniform: distinct.size <= 1,
    version: Array.from(distinct)[0] || "",
    mismatched: versions,
  };
}
