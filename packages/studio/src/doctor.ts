import * as fs from "node:fs";
import * as path from "node:path";
import { loadStudioConfig, ConfigSecretLeakError, DonorDependencyError } from "./config";
import type { StudioResult } from "@gauntlet/contracts";

export interface DoctorCheckResult {
  name: string;
  status: "pass" | "fail" | "warn";
  details: string;
  code?: string;
}

export interface DoctorReport {
  status: "success" | "blocked" | "failed" | "degraded";
  checks: DoctorCheckResult[];
  environment: {
    bun_version: string;
    platform: string;
    arch: string;
    cwd: string;
  };
}

/**
 * Executes comprehensive doctor preflight diagnostics.
 */
export async function runDoctor(cwd: string = process.cwd()): Promise<DoctorReport> {
  const checks: DoctorCheckResult[] = [];
  let overallFailed = false;

  // 1. Check Bun baseline (REQ-CONFIG-007, REQ-BIND-014)
  const bunVer = process.versions.bun || "0.0.0";
  const [major, minor] = bunVer.split(".").map(Number);
  if (major > 1 || (major === 1 && minor >= 4)) {
    checks.push({
      name: "bun_version",
      status: "pass",
      details: `Bun v${bunVer} satisfies baseline (>= 1.4.0)`,
    });
  } else {
    overallFailed = true;
    checks.push({
      name: "bun_version",
      status: "fail",
      code: "BUN_VERSION_INCOMPATIBLE",
      details: `Bun v${bunVer} is below required baseline (>= 1.4.0)`,
    });
  }

  // 2. Check Gitignore and Donor Isolation (REQ-REPO-005)
  const gitignorePath = path.join(cwd, ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    const gitignore = fs.readFileSync(gitignorePath, "utf-8");
    if (gitignore.includes(".tmp/") || gitignore.includes(".tmp")) {
      checks.push({
        name: "donor_isolation_gitignore",
        status: "pass",
        details: ".tmp/ is properly gitignored in .gitignore",
      });
    } else {
      overallFailed = true;
      checks.push({
        name: "donor_isolation_gitignore",
        status: "fail",
        code: "DONOR_NOT_GITIGNORED",
        details: ".tmp/ is missing from .gitignore; donor isolation compromised",
      });
    }
  } else {
    checks.push({
      name: "donor_isolation_gitignore",
      status: "warn",
      details: "No .gitignore found in current directory",
    });
  }

  // Check if .tmp/donor is referenced as dependency in package.json
  const rootPkgPath = path.join(cwd, "package.json");
  if (fs.existsSync(rootPkgPath)) {
    try {
      const pkgContent = fs.readFileSync(rootPkgPath, "utf-8");
      if (pkgContent.includes(".tmp/donor") || pkgContent.includes("mavon")) {
        overallFailed = true;
        checks.push({
          name: "donor_dependency_check",
          status: "fail",
          code: "DONOR_DEPENDENCY_DETECTED",
          details: "package.json references disallowed .tmp/donor or donor source",
        });
      } else {
        checks.push({
          name: "donor_dependency_check",
          status: "pass",
          details: "Zero donor dependencies detected in root package manifest",
        });
      }
    } catch {
      // ignore
    }
  }

  // 3. Check Configuration and Secret Hygiene (REQ-CONFIG-009, REQ-SEC-001)
  try {
    loadStudioConfig(cwd);
    checks.push({
      name: "configuration_integrity",
      status: "pass",
      details: "Configuration parsed cleanly and adheres to secret hygiene rules",
    });
  } catch (err: unknown) {
    overallFailed = true;
    if (err instanceof ConfigSecretLeakError) {
      checks.push({
        name: "configuration_integrity",
        status: "fail",
        code: err.code,
        details: err.message,
      });
    } else if (err instanceof DonorDependencyError) {
      checks.push({
        name: "configuration_integrity",
        status: "fail",
        code: err.code,
        details: err.message,
      });
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      checks.push({
        name: "configuration_integrity",
        status: "fail",
        code: "CONFIG_ERROR",
        details: msg,
      });
    }
  }

  // 4. Check Core Packages Presence
  const requiredPkgs = ["packages/contracts", "packages/studio", "packages/runtime", "packages/adapters", "apps/studio-cli"];
  const missingPkgs = requiredPkgs.filter((p) => !fs.existsSync(path.join(cwd, p, "package.json")));
  if (missingPkgs.length === 0) {
    checks.push({
      name: "workspace_packages",
      status: "pass",
      details: `All 5 required workspace packages present (${requiredPkgs.join(", ")})`,
    });
  } else {
    overallFailed = true;
    checks.push({
      name: "workspace_packages",
      status: "fail",
      code: "MISSING_PACKAGES",
      details: `Missing required workspace packages: ${missingPkgs.join(", ")}`,
    });
  }

  return {
    status: overallFailed ? "failed" : "success",
    checks,
    environment: {
      bun_version: bunVer,
      platform: process.platform,
      arch: process.arch,
      cwd,
    },
  };
}

/**
 * Returns DoctorReport wrapped as a normalized StudioResult.
 */
export async function getDoctorStudioResult(cwd: string = process.cwd()): Promise<StudioResult> {
  const report = await runDoctor(cwd);
  return {
    status: report.status,
    operation: "studio.doctor",
    result: report,
    diagnostics: {
      total_checks: report.checks.length,
      passed_checks: report.checks.filter((c) => c.status === "pass").length,
      failed_checks: report.checks.filter((c) => c.status === "fail").length,
      environment: report.environment,
    },
  };
}
