/**
 * Single standard Three.js compatibility guard for accepted img2threejs outputs.
 *
 * Extends the T06 single-Three check (packages/studio verifySingleThreeVersion,
 * manifest-level) with on-disk installation resolution: an accepted procedural
 * module MUST resolve against exactly ONE standard Three.js installation whose
 * version matches the version pinned by the repository package manifests.
 * A second installation (private runtime copy) is a compatibility-guard failure.
 *
 * Depends only on @gauntlet/contracts types and node builtins — no studio import
 * (adapters must not depend on studio; the studio-side T06 check remains the
 * source-manifest authority and this guard is its resolution-side extension).
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface ThreeInstallation {
  /** Directory containing the installed three package.json. */
  dir: string;
  /** Real (symlink-resolved) directory — the dedup key for installations. */
  realDir: string;
  version: string;
}

export type ThreeGuardCode =
  | "THREE_GUARD_OK"
  | "DECLARED_VERSION_MISMATCH"
  | "MULTIPLE_THREE_INSTALLATIONS"
  | "NO_THREE_INSTALLATION"
  | "INSTALLED_VERSION_MISMATCH";

export interface PinnedThreeResolution {
  ok: boolean;
  code: ThreeGuardCode;
  detail: string;
  /** Declared three versions per package manifest that declares one. */
  declared_versions: Record<string, string>;
  pinned_version: string;
  /** Distinct on-disk installations found under the search roots. */
  installations: ThreeInstallation[];
  /** The single pinned installation when ok. */
  pinned?: ThreeInstallation;
}

/** Read the three version declared by each package.json file (T06 manifest level). */
export function declaredThreeVersions(packageJsonFiles: string[]): Record<string, string> {
  const versions: Record<string, string> = {};
  for (const pkgPath of packageJsonFiles) {
    if (!fs.existsSync(pkgPath)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const v = parsed.dependencies?.three ?? parsed.devDependencies?.three;
      if (typeof v === "string" && v.length > 0) versions[pkgPath] = v;
    } catch {
      // unreadable manifest — reported by caller through absence
    }
  }
  return versions;
}

/** Find every distinct on-disk three installation directly under <root>/node_modules/three. */
export function findThreeInstallations(searchRoots: string[]): ThreeInstallation[] {
  const found = new Map<string, ThreeInstallation>();
  for (const root of searchRoots) {
    const dir = path.join(root, "node_modules", "three");
    const pkgPath = path.join(dir, "package.json");
    if (!fs.existsSync(pkgPath)) continue;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const realDir = fs.realpathSync(dir);
      if (!found.has(realDir)) {
        found.set(realDir, { dir, realDir, version: String(pkg.version ?? "unknown") });
      }
    } catch {
      // unreadable installation is still an installation candidate without version
    }
  }
  return Array.from(found.values());
}

/**
 * Normalize a declared semver range to its pinned base version for comparison
 * (e.g. "^0.170.0" -> "0.170.0", "~1.2.3" -> "1.2.3", ">=0.170.0" -> "0.170.0").
 * Exact pins pass through unchanged.
 */
export function normalizePinnedVersion(declared: string): string {
  const stripped = declared.trim().replace(/^[\^~>=<v\s]+/, "");
  // "0.170.0 || ..." or "0.170.0 - 1.x" style ranges keep the first candidate.
  const first = stripped.split(/\s*\|\||\s+-\s+/)[0].trim();
  return first;
}

/**
 * Resolve the pinned single standard Three.js installation.
 * Fails when manifests disagree, when more than one distinct installation
 * exists (private runtime copy — the T14 compatibility-guard tooth), or when
 * the single installation's version does not match the pinned manifest version.
 */
export function resolvePinnedThree(
  packageJsonFiles: string[],
  searchRoots: string[]
): PinnedThreeResolution {
  const declared = declaredThreeVersions(packageJsonFiles);
  const distinctDeclared = Array.from(new Set(Object.values(declared).map(normalizePinnedVersion)));
  const installations = findThreeInstallations(searchRoots);

  if (distinctDeclared.length > 1) {
    return {
      ok: false,
      code: "DECLARED_VERSION_MISMATCH",
      detail: `Package manifests declare inconsistent three versions: ${JSON.stringify(declared)}`,
      declared_versions: declared,
      pinned_version: "",
      installations,
    };
  }

  if (installations.length > 1) {
    return {
      ok: false,
      code: "MULTIPLE_THREE_INSTALLATIONS",
      detail: `Compatibility guard failed: accepted output would resolve against ${installations.length} distinct three installations (${installations.map((i) => i.realDir).join(", ")}); exactly one standard installation is allowed`,
      declared_versions: declared,
      pinned_version: distinctDeclared[0] ?? "",
      installations,
    };
  }

  if (installations.length === 0) {
    return {
      ok: false,
      code: "NO_THREE_INSTALLATION",
      detail: "No on-disk three installation found under the search roots",
      declared_versions: declared,
      pinned_version: distinctDeclared[0] ?? "",
      installations,
    };
  }

  const pinned = installations[0];
  const pinnedVersion = distinctDeclared[0] ?? "";
  if (pinnedVersion && pinned.version !== pinnedVersion) {
    return {
      ok: false,
      code: "INSTALLED_VERSION_MISMATCH",
      detail: `Installed three@${pinned.version} at ${pinned.realDir} does not match pinned manifest version ${pinnedVersion}`,
      declared_versions: declared,
      pinned_version: pinnedVersion,
      installations,
    };
  }

  return {
    ok: true,
    code: "THREE_GUARD_OK",
    detail: `Single standard three installation resolved: ${pinned.realDir} (version ${pinned.version})`,
    declared_versions: declared,
    pinned_version: pinnedVersion || pinned.version,
    installations,
    pinned,
  };
}
