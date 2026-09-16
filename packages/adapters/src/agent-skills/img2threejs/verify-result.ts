/**
 * Deterministic offline verification of committed accepted img2threejs results.
 *
 * REQ-BIND-006 / REQ-ASSET-001 / REQ-ASSET-002 / REQ-ASSET-004 settlement:
 * CI verifies committed accepted outputs WITHOUT model credentials and without
 * replaying the agent generation step. Every claim in the recorded result is
 * re-derived from disk:
 *   - module syntax + runtime import against the SINGLE pinned three install;
 *   - import hygiene (only `three`; no network APIs; no gameplay/state imports);
 *   - provenance: reference-only imagery stays a distinct provenance class and
 *     never appears as production content (REQ-ASSET-004);
 *   - reference comparison: silhouette occupancy IoU between the committed
 *     reference image and the module's front-projected geometry, recomputed;
 *   - semantic affordances: named nodes/sockets/colliders exist structurally in
 *     the instantiated graph and are normalized into AssetRecord affordance
 *     metadata only — never gameplay semantics;
 *   - budgets: triangle measurements recomputed against declared limits.
 *
 * This module contains NO model invocation and NO network access of any kind.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  validateCapabilityResult,
  type CapabilityRequest,
  type CapabilityResult,
} from "@gauntlet/contracts";
import {
  checkModuleSyntax,
  gridIoU,
  importProceduralModuleAgainstPinnedThree,
  instantiateProceduralModule,
  PINNED_THREE_SPECIFIER,
  PROCEDURAL_MODULE_SCHEMA,
  scanModuleImports,
  silhouetteGridFromGeometry,
  silhouetteGridFromImage,
  type OccupancyGrid,
} from "./module-contract";
import { resolvePinnedThree, type PinnedThreeResolution } from "./three-resolution";
import { decodePngGrayscale } from "./png";

export interface VerifyImg2ThreeJsOptions {
  /** Path of the committed result file (used to locate the sibling request). */
  resultPath: string;
  /** Project root used to resolve artifact/reference/manifest paths. */
  projectRoot: string;
  /** Repository root (pinned vendor skill content, default manifest pins). */
  repoRoot: string;
  /** Expected capability id (defaults to any; recorded value must be consistent). */
  capabilityId?: string;
  /**
   * Search roots for on-disk three installations. Defaults cover the monorepo
   * plus the project's own node_modules (a private copy there fails the guard).
   */
  searchRoots?: string[];
  /** Package manifests defining the pinned version (T06 set by default). */
  pinnedPackageJsonFiles?: string[];
}

export interface VerificationCheck {
  id: string;
  status: "pass" | "fail";
  detail: string;
}

export interface VerifyImg2ThreeJsOutcome {
  ok: boolean;
  checks: VerificationCheck[];
  recomputed: {
    triangles?: number;
    similarity?: number;
    recorded_similarity?: number;
    node_names?: string[];
    reference_sha256?: string;
    pinned_three?: { version: string; realDir: string } | null;
  };
}

const SIMILARITY_EPSILON = 0.01;
const DEFAULT_MIN_SIMILARITY = 0.5;

function sha256File(absPath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(absPath)).digest("hex");
}

interface RequestRefSpec {
  id: string;
  path: string;
  provenance_class?: string;
  license?: string;
}

function requestReferences(request: CapabilityRequest | null): RequestRefSpec[] {
  if (!request) return [];
  const refs = (request.inputs as Record<string, unknown> | undefined)?.["references"];
  if (!Array.isArray(refs)) return [];
  return refs
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
    .map((r) => ({
      id: String(r["id"] ?? ""),
      path: String(r["path"] ?? ""),
      provenance_class: r["provenance_class"] !== undefined ? String(r["provenance_class"]) : undefined,
      license: r["license"] !== undefined ? String(r["license"]) : undefined,
    }))
    .filter((r) => r.id.length > 0 && r.path.length > 0);
}

function defaultSearchRoots(projectRoot: string, repoRoot: string): string[] {
  const roots = [projectRoot, repoRoot];
  const pkgDirs = ["packages", "apps", "templates"];
  for (const dir of pkgDirs) {
    const abs = path.join(repoRoot, dir);
    if (!fs.existsSync(abs)) continue;
    for (const entry of fs.readdirSync(abs)) {
      roots.push(path.join(abs, entry));
    }
  }
  return roots;
}

function defaultPinnedPackageJsonFiles(repoRoot: string, projectRoot: string): string[] {
  return [
    path.join(repoRoot, "templates", "game", "package.json"),
    path.join(projectRoot, "package.json"),
    path.join(repoRoot, "packages", "runtime", "package.json"),
  ];
}

/**
 * Verify one committed accepted result deterministically and offline.
 * Never regenerates the asset; never calls a model; never touches the network.
 */
export async function verifyImg2ThreeJsResult(
  rawResult: unknown,
  options: VerifyImg2ThreeJsOptions
): Promise<VerifyImg2ThreeJsOutcome> {
  const checks: VerificationCheck[] = [];
  const recomputed: VerifyImg2ThreeJsOutcome["recomputed"] = { pinned_three: null };
  const record = (id: string, status: "pass" | "fail", detail: string): void => {
    checks.push({ id, status, detail });
  };

  // --- 1. Result schema (studio contract) ---------------------------------
  let result: CapabilityResult;
  try {
    result = validateCapabilityResult(rawResult);
    record("RESULT_SCHEMA", "pass", `CapabilityResult '${result.id}' satisfies studio contracts`);
  } catch (err) {
    record("RESULT_SCHEMA", "fail", `not a valid CapabilityResult: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, checks, recomputed };
  }

  // --- 2. Request correlation ---------------------------------------------
  let request: CapabilityRequest | null = null;
  {
    const requestPath = path.resolve(
      path.dirname(path.resolve(options.resultPath)),
      "..",
      "requests",
      path.basename(options.resultPath)
    );
    if (!fs.existsSync(requestPath)) {
      record("REQUEST_CORRELATION", "fail", `sibling request file not found at ${requestPath}`);
    } else {
      try {
        const raw = Bun.YAML.parse(fs.readFileSync(requestPath, "utf-8"));
        const { validateCapabilityRequest } = await import("@gauntlet/contracts");
        request = validateCapabilityRequest(raw);
        const recordedCapability = (result.diagnostics as Record<string, unknown>)["capability_id"];
        const capabilityOk =
          options.capabilityId === undefined ||
          (request.capability_id === options.capabilityId &&
            (recordedCapability === undefined || recordedCapability === options.capabilityId));
        if (result.request_id !== request.id) {
          record("REQUEST_CORRELATION", "fail", `result request_id '${result.request_id}' != request id '${request.id}'`);
        } else if (!capabilityOk) {
          record(
            "REQUEST_CORRELATION",
            "fail",
            `capability mismatch: expected '${options.capabilityId}', request '${request.capability_id}', result recorded '${String(recordedCapability)}'`
          );
        } else {
          record(
            "REQUEST_CORRELATION",
            "pass",
            `result '${result.id}' correlates with request '${request.id}' (capability ${request.capability_id})`
          );
        }
      } catch (err) {
        record("REQUEST_CORRELATION", "fail", `request file invalid: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // --- 3. Provider binding --------------------------------------------------
  if (result.provider !== "agent-skill.img2threejs") {
    record("PROVIDER_BINDING", "fail", `provider '${result.provider}' is not the pinned img2threejs route`);
  } else if (result.status !== "success") {
    record("PROVIDER_BINDING", "fail", `result status '${result.status}' is not an accepted output`);
  } else {
    record("PROVIDER_BINDING", "pass", "accepted output bound to agent-skill.img2threejs");
  }

  // --- 4. Artifact integrity ----------------------------------------------
  const artifacts = result.artifacts ?? [];
  const moduleArtifact = artifacts.find((a) => a.role === "procedural_three_module");
  let moduleAbsPath: string | null = null;
  if (!moduleArtifact) {
    record("ARTIFACT_INTEGRITY", "fail", "no artifact with role 'procedural_three_module'");
  } else {
    moduleAbsPath = path.isAbsolute(moduleArtifact.path)
      ? moduleArtifact.path
      : path.resolve(options.projectRoot, moduleArtifact.path);
    if (!fs.existsSync(moduleAbsPath) || !fs.statSync(moduleAbsPath).isFile()) {
      record("ARTIFACT_INTEGRITY", "fail", `module artifact missing on disk: ${moduleArtifact.path}`);
      moduleAbsPath = null;
    } else if (moduleArtifact.sha256 && moduleArtifact.sha256 !== sha256File(moduleAbsPath)) {
      record("ARTIFACT_INTEGRITY", "fail", `module artifact sha256 mismatch for ${moduleArtifact.path}`);
      moduleAbsPath = null;
    } else {
      record(
        "ARTIFACT_INTEGRITY",
        "pass",
        `committed module artifact present${moduleArtifact.sha256 ? " and hash-verified" : ""}: ${moduleArtifact.path}`
      );
    }
  }

  // Stages 5-8 depend on the module; stop early if it is unavailable.
  let moduleCode: string | null = null;
  if (moduleAbsPath) {
    moduleCode = fs.readFileSync(moduleAbsPath, "utf-8");

    // --- 5. Syntax ----------------------------------------------------------
    const syntax = checkModuleSyntax(moduleCode);
    record(
      "MODULE_SYNTAX",
      syntax.ok ? "pass" : "fail",
      syntax.ok ? "module parses cleanly (TypeScript)" : `syntax error: ${syntax.error ?? "unknown"}`
    );

    // --- 6. Import hygiene ---------------------------------------------------
    const scan = scanModuleImports(moduleCode);
    record(
      "MODULE_IMPORTS",
      scan.ok ? "pass" : "fail",
      scan.ok
        ? `imports resolve against '${PINNED_THREE_SPECIFIER}' only; no network APIs; no gameplay/state imports`
        : `import violations: ${scan.violations.join("; ")}`
    );

    // --- 7. Single standard Three.js resolution guard (tooth 3) -------------
    const searchRoots = options.searchRoots ?? defaultSearchRoots(options.projectRoot, options.repoRoot);
    const pkgFiles = options.pinnedPackageJsonFiles ?? defaultPinnedPackageJsonFiles(options.repoRoot, options.projectRoot);
    const pinned: PinnedThreeResolution = resolvePinnedThree(pkgFiles, searchRoots);
    if (!pinned.ok || !pinned.pinned) {
      record("THREE_RESOLUTION_GUARD", "fail", `${pinned.code}: ${pinned.detail}`);
    } else {
      recomputed.pinned_three = { version: pinned.pinned.version, realDir: pinned.pinned.realDir };
      record("THREE_RESOLUTION_GUARD", "pass", pinned.detail);

      // --- 8. Runtime import + structural instantiation ---------------------
      try {
        const staged = await importProceduralModuleAgainstPinnedThree(moduleAbsPath, pinned.pinned.realDir);
        try {
          const meta = staged.meta;
          if (meta.schema !== PROCEDURAL_MODULE_SCHEMA) {
            record("MODULE_RUNTIME", "fail", `module meta schema '${String(meta.schema)}' != '${PROCEDURAL_MODULE_SCHEMA}'`);
          } else if (meta.three_import !== PINNED_THREE_SPECIFIER) {
            record("MODULE_RUNTIME", "fail", `module meta three_import '${String(meta.three_import)}' != '${PINNED_THREE_SPECIFIER}'`);
          } else {
            const asset = instantiateProceduralModule(staged);
            recomputed.triangles = asset.triangles;
            recomputed.node_names = asset.node_names;

            // Semantic affordances: declared structure must exist; recorded as
            // AssetRecord affordance metadata only (never gameplay semantics).
            const affordances = meta.affordances;
            let affordanceDetail = "no affordances declared";
            let affordancesOk = true;
            if (affordances) {
              const missing = [
                ...(affordances.named_nodes ?? []),
                ...Object.values(affordances.sockets ?? {}).map((s) => s.node),
                ...(affordances.colliders ?? []).map((c) => c.node),
              ].filter((n) => !asset.node_names.includes(n));
              if (missing.length > 0) {
                affordancesOk = false;
                affordanceDetail = `declared affordance nodes missing from instantiated graph: ${missing.join(", ")}`;
              } else {
                affordanceDetail = `${affordances.named_nodes.length} named node(s), ${Object.keys(affordances.sockets ?? {}).length} socket(s), ${(affordances.colliders ?? []).length} collider(s) all exist structurally; recorded as AssetRecord affordance metadata only`;
              }
            }
            record("SEMANTIC_AFFORDANCES", affordancesOk ? "pass" : "fail", affordanceDetail);

            record(
              "MODULE_RUNTIME",
              "pass",
              `module imports and instantiates against pinned three@${pinned.pinned.version}; ${asset.triangles} triangle(s), ${asset.node_names.length} named node(s)`
            );

            // --- Reference comparison (recomputed) --------------------------
            await verifyReferenceComparison(request, meta, asset.projected_points, options, record, recomputed);
            // --- Budgets (recomputed) ----------------------------------------
            verifyBudgets(request, result, asset.triangles, record);
          }
        } finally {
          staged.cleanup();
        }
      } catch (err) {
        record("MODULE_RUNTIME", "fail", `runtime import/instantiation failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } else {
    record("MODULE_SYNTAX", "fail", "module source unavailable");
    record("MODULE_IMPORTS", "fail", "module source unavailable");
    record("THREE_RESOLUTION_GUARD", "fail", "module source unavailable");
    record("MODULE_RUNTIME", "fail", "module source unavailable");
    record("SEMANTIC_AFFORDANCES", "fail", "module source unavailable");
    record("REFERENCE_COMPARISON", "fail", "module source unavailable");
    record("REFERENCE_PROVENANCE", "fail", "module source unavailable");
    record("BUDGET", "fail", "module source unavailable");
  }

  // --- Offline declaration (evidence recorded by the run) ------------------
  {
    const verification = (result.diagnostics as Record<string, unknown>)["verification"] as
      | Record<string, unknown>
      | undefined;
    const modelInvocation = verification?.["model_invocation"];
    const networkAccess = verification?.["network_access"];
    if (modelInvocation === "none" && networkAccess === "none") {
      record(
        "OFFLINE_VERIFICATION",
        "pass",
        "recorded run declares zero model invocation and zero network access; verification path is offline by construction (no network imports, no credential reads)"
      );
    } else {
      record(
        "OFFLINE_VERIFICATION",
        "fail",
        `result must declare diagnostics.verification.model_invocation='none' and network_access='none'; got '${String(modelInvocation)}'/'${String(networkAccess)}'`
      );
    }
  }

  // --- 9. Reference-only provenance class (REQ-ASSET-004) ------------------
  verifyReferenceProvenance(request, options, record);

  return { ok: checks.every((c) => c.status === "pass"), checks, recomputed };
}

type RecordFn = (id: string, status: "pass" | "fail", detail: string) => void;

async function verifyReferenceComparison(
  request: CapabilityRequest | null,
  meta: { reference_evidence?: { method?: string; reference_sha256?: string; similarity?: number } },
  projectedPoints: Array<{ x: number; y: number }>,
  options: VerifyImg2ThreeJsOptions,
  record: RecordFn,
  recomputed: VerifyImg2ThreeJsOutcome["recomputed"]
): Promise<void> {
  const refs = requestReferences(request);
  if (!request || refs.length === 0) {
    record("REFERENCE_COMPARISON", "fail", "request declares no reference imagery");
    return;
  }
  const ref = refs[0];
  const refAbs = path.isAbsolute(ref.path) ? ref.path : path.resolve(options.projectRoot, ref.path);
  if (!fs.existsSync(refAbs)) {
    record("REFERENCE_COMPARISON", "fail", `reference image missing: ${ref.path}`);
    return;
  }

  recomputed.reference_sha256 = sha256File(refAbs);

  try {
    const image = decodePngGrayscale(new Uint8Array(fs.readFileSync(refAbs)));
    const refGrid = silhouetteGridFromImage(image);
    const geoGrid: OccupancyGrid = silhouetteGridFromGeometry(projectedPoints);
    const similarity = gridIoU(refGrid.grid, geoGrid);
    recomputed.similarity = similarity;

    const inputs = (request.inputs ?? {}) as Record<string, unknown>;
    const minSimilarity =
      typeof inputs["min_reference_similarity"] === "number"
        ? (inputs["min_reference_similarity"] as number)
        : DEFAULT_MIN_SIMILARITY;

    const recorded = meta.reference_evidence?.similarity;
    const recordedOk =
      typeof recorded === "number" && Math.abs(recorded - similarity) <= SIMILARITY_EPSILON;
    const evidenceHashOk =
      !meta.reference_evidence?.reference_sha256 ||
      meta.reference_evidence.reference_sha256 === recomputed.reference_sha256;

    if (similarity < minSimilarity) {
      record(
        "REFERENCE_COMPARISON",
        "fail",
        `recomputed silhouette IoU ${similarity.toFixed(4)} < required ${minSimilarity} (grid 8x8, method '${String(meta.reference_evidence?.method ?? "unknown")}')`
      );
    } else if (!recordedOk) {
      record(
        "REFERENCE_COMPARISON",
        "fail",
        `recorded similarity ${String(recorded)} is inconsistent with recomputed ${similarity.toFixed(4)} (epsilon ${SIMILARITY_EPSILON})`
      );
    } else if (!evidenceHashOk) {
      record("REFERENCE_COMPARISON", "fail", "module reference_evidence.reference_sha256 does not match the committed reference image");
    } else {
      record(
        "REFERENCE_COMPARISON",
        "pass",
        `recomputed silhouette IoU ${similarity.toFixed(4)} >= required ${minSimilarity}; recorded evidence consistent (${ref.id})`
      );
    }
  } catch (err) {
    record("REFERENCE_COMPARISON", "fail", `reference comparison failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function verifyBudgets(
  request: CapabilityRequest | null,
  result: CapabilityResult,
  measuredTriangles: number,
  record: RecordFn
): void {
  const inputs = (request?.inputs ?? {}) as Record<string, unknown>;
  const limits = (inputs["budget_limits"] ?? {}) as Record<string, unknown>;
  const maxKeys = Object.keys(limits).filter((k) => k.startsWith("max_"));
  if (maxKeys.length === 0) {
    record("BUDGET", "fail", "request declares no budget_limits; reconstruction acceptance requires a declared triangle budget");
    return;
  }
  const problems: string[] = [];
  for (const key of maxKeys) {
    const limit = limits[key];
    if (typeof limit !== "number") {
      problems.push(`limit '${key}' is not numeric`);
      continue;
    }
    const suffix = key.slice("max_".length);
    if (suffix !== "triangles") {
      problems.push(`unsupported budget dimension '${suffix}' (only 'triangles' is deterministically recomputable here)`);
      continue;
    }
    if (measuredTriangles > limit) {
      problems.push(`measured_triangles=${measuredTriangles} exceeds max_triangles=${limit}`);
    }
  }
  const verification = (result.diagnostics as Record<string, unknown>)["verification"] as
    | Record<string, unknown>
    | undefined;
  const recordedBudget = (verification?.["budget_measurements"] ?? {}) as Record<string, unknown>;
  const recordedTriangles = recordedBudget["measured_triangles"];
  if (typeof recordedTriangles === "number" && recordedTriangles !== measuredTriangles) {
    problems.push(`recorded measured_triangles=${recordedTriangles} != recomputed ${measuredTriangles}`);
  }
  if (problems.length > 0) {
    record("BUDGET", "fail", problems.join("; "));
  } else {
    record("BUDGET", "pass", `recomputed measured_triangles=${measuredTriangles} within declared limits; recorded measurements consistent`);
  }
}

function verifyReferenceProvenance(
  request: CapabilityRequest | null,
  options: VerifyImg2ThreeJsOptions,
  record: RecordFn
): void {
  const refs = requestReferences(request);
  if (!request || refs.length === 0) {
    record("REFERENCE_PROVENANCE", "fail", "request declares no reference imagery; provenance class cannot be established");
    return;
  }
  const ref = refs[0];
  const problems: string[] = [];
  if (!ref.provenance_class || ref.provenance_class === "unspecified") {
    problems.push("reference provenance_class not recorded (REQ-ASSET-004: reference-only imagery must stay distinguishable)");
  }
  if (!ref.license || ref.license === "unspecified") {
    problems.push("reference license/authorization state not recorded");
  }

  const manifestPath = path.join(options.projectRoot, "assets", "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    problems.push(`asset manifest missing at ${manifestPath}`);
  } else {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      const references = Array.isArray(manifest.references) ? manifest.references : [];
      const records = Array.isArray(manifest.records) ? manifest.records : [];
      const asReference = references.find((r: Record<string, unknown>) => r["id"] === ref.id);
      if (!asReference) {
        problems.push(`reference '${ref.id}' is not registered as reference-only imagery in the asset manifest`);
      } else if (asReference["reference_only_note"] !== undefined && asReference["reference_only_note"] === false) {
        problems.push(`reference '${ref.id}' is not marked reference-only`);
      }
      const asProduction = records.find((r: Record<string, unknown>) => r["id"] === ref.id);
      if (asProduction) {
        problems.push(`reference '${ref.id}' also appears as a production asset record; reference-only imagery must never ship as content (REQ-ASSET-004)`);
      }
    } catch (err) {
      problems.push(`asset manifest unreadable: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (problems.length > 0) {
    record("REFERENCE_PROVENANCE", "fail", problems.join("; "));
  } else {
    record(
      "REFERENCE_PROVENANCE",
      "pass",
      `reference '${ref.id}' provenance class '${ref.provenance_class}' registered reference-only and distinct from production records (REQ-ASSET-004)`
    );
  }
}
