/**
 * Deterministic offline verification of committed accepted dcc.blender.process
 * results (T18, REQ-BLENDER-004/006/007).
 *
 * CI verifies the committed accepted derivative WITHOUT Blender installed and
 * without replaying the DCC run. Every claim in the recorded result is
 * re-derived from disk:
 *   - CapabilityResult studio-contract validity + request correlation;
 *   - committed GLB + bake report artifact presence and sha256;
 *   - GLB validity via glTF-Transform (scene, animation clips, nodes,
 *     recomputed triangle count) — pure TypeScript, no Blender;
 *   - declared budgets against recomputed measurements;
 *   - regeneration metadata: Blender version record ("5.2.2 LTS"), exact
 *     invocation argv records, committed script paths, source-definition hash;
 *   - provenance: accepted `blender`-origin AssetRecord wired to the derivative;
 *   - authority boundary: bake report + GLB node extras carry NO quest/NPC
 *     gameplay semantics (REQ-BLENDER-005).
 *
 * This module contains NO Blender invocation, NO network access, and NO model
 * invocation of any kind.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import {
  validateCapabilityRequest,
  validateCapabilityResult,
  type CapabilityRequest,
  type CapabilityResult,
} from "@gauntlet/contracts";
import { listBlendSemanticFindings } from "./authority";
import { DCC_BLENDER_PROCESS_CAPABILITY, DCC_BLENDER_PROVIDER } from "./preflight";

export interface VerifyBlenderProcessOptions {
  resultPath: string;
  projectRoot: string;
  repoRoot: string;
  capabilityId?: string;
}

export interface BlenderProcessVerificationCheck {
  id: string;
  status: "pass" | "fail";
  detail: string;
}

export interface VerifyBlenderProcessOutcome {
  ok: boolean;
  checks: BlenderProcessVerificationCheck[];
  recomputed: {
    triangles?: number;
    animations?: string[];
    file_bytes?: number;
    glb_sha256?: string;
    blender_version_recorded?: string;
  };
}

function sha256File(absPath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(absPath)).digest("hex");
}

function resolveAgainst(base: string, p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(base, p);
}

interface GlbStats {
  triangles: number;
  animations: string[];
  nodes: string[];
  extras: Array<Record<string, unknown>>;
}

async function readGlbStats(glbPath: string): Promise<GlbStats> {
  const io = new NodeIO();
  const doc = await io.read(glbPath);
  const root = doc.getRoot();
  let triangles = 0;
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      const position = prim.getAttribute("POSITION");
      const count = indices ? indices.getCount() : (position?.getCount() ?? 0);
      triangles += Math.floor(count / 3);
    }
  }
  const animations = root.listAnimations().map((a) => a.getName());
  const nodes = root.listNodes().map((n) => n.getName());
  const extras = root
    .listNodes()
    .map((n) => n.getExtras())
    .filter((e): e is Record<string, unknown> => e !== undefined && e !== null);
  return { triangles, animations, nodes, extras };
}

/**
 * Verify one committed accepted dcc.blender.process result deterministically
 * and offline. Never regenerates the derivative; never launches Blender.
 */
export async function verifyBlenderProcessResult(
  rawResult: unknown,
  options: VerifyBlenderProcessOptions
): Promise<VerifyBlenderProcessOutcome> {
  const checks: BlenderProcessVerificationCheck[] = [];
  const recomputed: VerifyBlenderProcessOutcome["recomputed"] = {};
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
        request = validateCapabilityRequest(Bun.YAML.parse(fs.readFileSync(requestPath, "utf-8")));
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
  if (result.provider !== DCC_BLENDER_PROVIDER) {
    record("PROVIDER_BINDING", "fail", `provider '${result.provider}' is not the pinned '${DCC_BLENDER_PROVIDER}' route`);
  } else if (result.status !== "success") {
    record("PROVIDER_BINDING", "fail", `result status '${result.status}' is not an accepted output`);
  } else {
    record("PROVIDER_BINDING", "pass", `accepted output bound to ${DCC_BLENDER_PROVIDER}`);
  }

  // --- 4. Artifact integrity (committed derivative + bake report) -----------
  const artifacts = result.artifacts ?? [];
  const glbArtifact = artifacts.find((a) => a.role === "committed_glb_derivative");
  const reportArtifact = artifacts.find((a) => a.role === "regeneration_metadata");
  let glbAbsPath: string | null = null;
  let reportAbsPath: string | null = null;

  const checkArtifact = (
    artifact: (typeof artifacts)[number] | undefined,
    role: string
  ): { path: string | null; ok: boolean } => {
    if (!artifact) {
      record("ARTIFACT_INTEGRITY", "fail", `no artifact with role '${role}'`);
      return { path: null, ok: false };
    }
    const abs = resolveAgainst(options.projectRoot, artifact.path);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      record("ARTIFACT_INTEGRITY", "fail", `${role} artifact missing on disk: ${artifact.path}`);
      return { path: null, ok: false };
    }
    if (artifact.sha256 && artifact.sha256 !== sha256File(abs)) {
      record("ARTIFACT_INTEGRITY", "fail", `${role} artifact sha256 mismatch for ${artifact.path}`);
      return { path: null, ok: false };
    }
    record(
      "ARTIFACT_INTEGRITY",
      "pass",
      `committed ${role} artifact present${artifact.sha256 ? " and hash-verified" : ""}: ${artifact.path}`
    );
    return { path: abs, ok: true };
  };

  const glbChecked = checkArtifact(glbArtifact, "committed_glb_derivative");
  const reportChecked = checkArtifact(reportArtifact, "regeneration_metadata");
  glbAbsPath = glbChecked.path;
  reportAbsPath = reportChecked.path;

  // --- 5-9 depend on the derivative; stop early if unavailable --------------
  let glbStats: GlbStats | null = null;
  if (glbAbsPath) {
    recomputed.file_bytes = fs.statSync(glbAbsPath).size;
    recomputed.glb_sha256 = sha256File(glbAbsPath);
    try {
      glbStats = await readGlbStats(glbAbsPath);
      recomputed.triangles = glbStats.triangles;
      recomputed.animations = glbStats.animations;
      record(
        "GLB_VALIDITY",
        "pass",
        `standard glTF 2.0 GLB parses: ${glbStats.triangles} triangle(s), ${glbStats.nodes.length} node(s), animation clip(s) [${glbStats.animations.join(", ")}]`
      );
    } catch (err) {
      record("GLB_VALIDITY", "fail", `committed GLB failed glTF-Transform parse: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    record("GLB_VALIDITY", "fail", "committed GLB derivative unavailable");
  }

  // --- 6. Budgets (recomputed against the committed derivative) -------------
  {
    const inputs = (request?.inputs ?? {}) as Record<string, unknown>;
    const limits = (inputs["budget_limits"] ?? {}) as Record<string, unknown>;
    const maxKeys = Object.keys(limits).filter((k) => k.startsWith("max_"));
    if (maxKeys.length === 0) {
      record("BUDGET", "fail", "request declares no budget_limits; derivatives require declared budgets before acceptance");
    } else {
      const problems: string[] = [];
      for (const key of maxKeys) {
        const limit = limits[key];
        const suffix = key.slice("max_".length);
        if (typeof limit !== "number") {
          problems.push(`limit '${key}' is not numeric`);
          continue;
        }
        const measured =
          suffix === "triangles" ? recomputed.triangles : suffix === "file_bytes" ? recomputed.file_bytes : undefined;
        if (measured === undefined) {
          problems.push(`unsupported budget dimension '${suffix}'`);
          continue;
        }
        if (measured > limit) {
          problems.push(`measured_${suffix}=${measured} exceeds max_${suffix}=${limit}`);
        }
      }
      if (problems.length > 0) {
        record("BUDGET", "fail", problems.join("; "));
      } else {
        record("BUDGET", "pass", `recomputed measurements (${recomputed.triangles} triangles, ${recomputed.file_bytes} bytes) within declared limits`);
      }
    }
  }

  // --- 7. Regeneration metadata (Blender provenance, no Blender required) ---
  let definitionAbsPath: string | null = null;
  {
    const regeneration = (result.diagnostics as Record<string, unknown>)["regeneration"] as
      | Record<string, unknown>
      | undefined;
    const problems: string[] = [];
    const version = regeneration?.["blender_version"];
    if (typeof version !== "string" || version.length === 0) {
      problems.push("diagnostics.regeneration.blender_version missing");
    } else {
      recomputed.blender_version_recorded = version;
    }
    const invocations = regeneration?.["invocations"];
    const invocationCount = Array.isArray(invocations) ? invocations.length : 0;
    if (!Array.isArray(invocations) || invocations.length === 0) {
      problems.push("diagnostics.regeneration.invocations missing/empty");
    } else {
      invocations.forEach((inv, i) => {
        const argv = (inv as Record<string, unknown>)?.["argv"];
        if (!Array.isArray(argv) || argv.length < 6) {
          problems.push(`invocations[${i}].argv missing/short`);
          return;
        }
        const joined = argv.map(String).join(" ");
        for (const requiredFlag of ["--background", "--factory-startup", "--python"]) {
          if (!joined.includes(requiredFlag)) {
            problems.push(`invocations[${i}] argv lacks '${requiredFlag}'`);
          }
        }
      });
    }
    const scripts = regeneration?.["scripts"];
    if (!Array.isArray(scripts) || scripts.length === 0) {
      problems.push("diagnostics.regeneration.scripts missing/empty");
    } else {
      for (const script of scripts) {
        const abs = resolveAgainst(options.repoRoot, String(script));
        if (!fs.existsSync(abs)) problems.push(`committed regeneration script missing: ${script}`);
      }
    }
    const defSha = (regeneration?.["source_definition"] as Record<string, unknown> | undefined)?.["sha256"];
    const defPath = (regeneration?.["source_definition"] as Record<string, unknown> | undefined)?.["path"];
    if (typeof defPath !== "string" || typeof defSha !== "string") {
      problems.push("diagnostics.regeneration.source_definition {path, sha256} missing");
    } else {
      definitionAbsPath = resolveAgainst(options.projectRoot, defPath);
      if (!fs.existsSync(definitionAbsPath)) {
        problems.push(`source definition missing: ${defPath}`);
      } else if (sha256File(definitionAbsPath) !== defSha.toLowerCase()) {
        problems.push(`source definition sha256 mismatch for ${defPath}`);
      }
    }
    if (problems.length > 0) {
      record("REGENERATION_METADATA", "fail", problems.join("; "));
    } else {
      record(
        "REGENERATION_METADATA",
        "pass",
        `regeneration provenance complete: Blender ${String(version)}, ${invocationCount} recorded invocation(s) with deterministic background argv, committed scripts present, source definition hash verified`
      );
    }
  }

  // --- 8. Provenance/acceptance through the Asset Registry -------------------
  {
    const manifestPath = path.join(options.projectRoot, "assets", "manifest.json");
    const problems: string[] = [];
    if (!fs.existsSync(manifestPath)) {
      problems.push(`asset manifest missing at ${manifestPath}`);
    } else {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
        const records = Array.isArray(manifest.records) ? manifest.records : [];
        const assetIds = result.asset_ids ?? [];
        if (assetIds.length === 0) {
          problems.push("result declares no asset_ids");
        }
        for (const assetId of assetIds) {
          const rec = records.find((r: Record<string, unknown>) => r["id"] === assetId);
          if (!rec) {
            problems.push(`asset '${assetId}' not found in the asset manifest`);
            continue;
          }
          if (rec["origin"] !== "blender") {
            problems.push(`asset '${assetId}' origin '${String(rec["origin"])}' != 'blender' (derived assets must stay distinguishable)`);
          }
          if (rec["acceptance_state"] !== "accepted") {
            problems.push(`asset '${assetId}' acceptance_state '${String(rec["acceptance_state"])}' is not accepted`);
          }
          const provenance = (rec["source_provenance"] ?? {}) as Record<string, unknown>;
          if (definitionAbsPath && typeof provenance["sha256"] === "string") {
            if (fs.existsSync(definitionAbsPath) && sha256File(definitionAbsPath) !== provenance["sha256"].toLowerCase()) {
              problems.push(`asset '${assetId}' source_provenance.sha256 does not match the committed source definition`);
            }
          } else {
            problems.push(`asset '${assetId}' source_provenance.sha256 missing`);
          }
          const runtime = String(rec["runtime_representation"] ?? "");
          if (glbArtifact && !runtime.includes(path.basename(glbArtifact.path))) {
            problems.push(`asset '${assetId}' runtime_representation '${runtime}' does not reference the committed derivative`);
          }
        }
      } catch (err) {
        problems.push(`asset manifest unreadable: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (problems.length > 0) {
      record("PROVENANCE_ACCEPTANCE", "fail", problems.join("; "));
    } else {
      record(
        "PROVENANCE_ACCEPTANCE",
        "pass",
        `accepted blender-origin AssetRecord(s) [${(result.asset_ids ?? []).join(", ")}] wired to the committed derivative with verified source hash (REQ-BLENDER-004)`
      );
    }
  }

  // --- 9. Authority boundary (REQ-BLENDER-005) -------------------------------
  {
    const problems: string[] = [];
    const findings: string[] = [];
    if (reportAbsPath) {
      try {
        const report = JSON.parse(fs.readFileSync(reportAbsPath, "utf-8"));
        for (const f of listBlendSemanticFindings(report["dcc_metadata"] ?? {}, "bake_report.dcc_metadata")) {
          findings.push(`${f.path} (matched ${f.pattern})`);
        }
      } catch (err) {
        problems.push(`bake report unreadable: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      problems.push("bake report unavailable for authority scan");
    }
    if (glbStats) {
      glbStats.extras.forEach((extra, i) => {
        for (const f of listBlendSemanticFindings(extra, `glb.node_extras[${i}]`)) {
          findings.push(`${f.path} (matched ${f.pattern})`);
        }
      });
    }
    if (problems.length > 0 || findings.length > 0) {
      record(
        "AUTHORITY_BOUNDARY",
        "fail",
        [...problems, ...findings.map((f) => `gameplay semantics found in DCC metadata: ${f}`)].join("; ")
      );
    } else {
      record(
        "AUTHORITY_BOUNDARY",
        "pass",
        "DCC-side metadata (bake report + GLB node extras) carries structural provenance only; no quest/NPC gameplay semantics (Koota stays the sole semantic authority)"
      );
    }
  }

  // --- 10. Offline declaration ------------------------------------------------
  {
    const verification = (result.diagnostics as Record<string, unknown>)["verification"] as
      | Record<string, unknown>
      | undefined;
    const modelInvocation = verification?.["model_invocation"];
    const networkAccess = verification?.["network_access"];
    const blenderAtVerify = verification?.["blender_required_at_verify"];
    if (modelInvocation === "none" && networkAccess === "none" && blenderAtVerify === false) {
      record(
        "OFFLINE_VERIFICATION",
        "pass",
        "recorded run declares zero model invocation, zero network access, and no Blender requirement at verify time; this verifier invokes no Blender by construction"
      );
    } else {
      record(
        "OFFLINE_VERIFICATION",
        "fail",
        `result must declare diagnostics.verification model_invocation='none', network_access='none', blender_required_at_verify=false; got '${String(modelInvocation)}'/'${String(networkAccess)}'/'${String(blenderAtVerify)}'`
      );
    }
  }

  return { ok: checks.every((c) => c.status === "pass"), checks, recomputed };
}
