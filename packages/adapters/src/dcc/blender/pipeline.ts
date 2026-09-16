/**
 * dcc.blender.process pipeline (T18).
 *
 * Orchestrates the isolated Blender DCC escalation route for the Blackwater
 * Relay service-drone animation retarget/bake:
 *
 *   1. validate the recorded escalation rationale (REQ-BLENDER-002);
 *   2. load the committed deterministic source definition and REJECT any
 *      quest/NPC gameplay semantics in its DCC metadata (REQ-BLENDER-005);
 *   3. Blender preflight — typed scoped blockage when absent (REQ-BLENDER-007);
 *   4. blender --background --factory-startup: generate source rig .blend;
 *   5. blender --background --factory-startup: retarget + bake + export GLB;
 *   6. glTF-Transform normalization (T13 adapter) onto the committed
 *      derivative path (REQ-BLENDER-004 — the derivative is a standard asset,
 *      never a Blender-owned artifact).
 *
 * Every invocation's exact argv is captured for regeneration provenance.
 * This module is the ONLY monorepo code that executes Blender.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { runGltfPipeline } from "../../assets/gltf";
import { assertNoGameSemanticsInBlendMetadata } from "./authority";
import { validateEscalationRationale, type EscalationRationale } from "./escalation";
import {
  runBlenderBackgroundScript,
  type BlenderInvocationRecord,
} from "./invoke";
import { checkBlenderPreflight, type BlenderPreflightDeps } from "./preflight";

export const SERVICE_DRONE_ASSET_ID = "service-drone";
export const BLENDER_VERSION_EXPECTED_IN_PROVENANCE = "5.2.2 LTS";

export interface ServiceDroneSourceDefinition {
  schema: string;
  asset_id: string;
  source_rig: { armature: string };
  target_rig: { armature: string };
  dcc_metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ServiceDronePipelineOptions {
  projectRoot: string;
  repoRoot: string;
  /** Path of the committed source rig/animation definition (JSON). */
  definitionPath: string;
  /** Recorded escalation rationale (REQ-BLENDER-002). */
  escalationRationale: unknown;
  /** Where .blend/raw GLB intermediates go; default <repoRoot>/.tmp/dcc-blender/<asset_id>. */
  workDir?: string;
  /** Committed derivative output path; default <projectRoot>/assets/<asset_id>.glb. */
  outputGlbPath?: string;
  /** Committed bake report path; default <projectRoot>/assets/dcc/<asset_id>/<asset_id>.bake-report.json. */
  bakeReportPath?: string;
  preflight?: BlenderPreflightDeps;
  log?: (line: string) => void;
}

export type ServiceDronePipelineResult =
  | {
      status: "blocked";
      code:
        | "BLENDER_UNAVAILABLE"
        | "ESCALATION_RATIONALE_REQUIRED"
        | "SOURCE_DEFINITION_INVALID"
        | "DCC_METADATA_REJECTED";
      message: string;
      details?: string[];
    }
  | {
      status: "failed";
      code: "BLENDER_INVOCATION_FAILED" | "NORMALIZATION_FAILED";
      message: string;
      invocations: BlenderInvocationRecord[];
    }
  | {
      status: "success";
      asset_id: string;
      blender: { executable: string; version: string };
      escalation_rationale: EscalationRationale;
      source_definition: { path: string; sha256: string };
      source_blend: { path: string; sha256: string };
      raw_glb: { path: string; sha256: string; bytes: number };
      normalized_glb: {
        path: string;
        sha256: string;
        bytes: number;
        triangles: number;
        animations: string[];
        nodes: string[];
      };
      bake_report: { path: string; sha256: string };
      invocations: BlenderInvocationRecord[];
      normalization: { transformations: string[]; profile_id: string };
    };

export class ServiceDronePipelineError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ServiceDronePipelineError";
    this.code = code;
  }
}

function sha256File(absPath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(absPath)).digest("hex");
}

function scriptPath(name: string): string {
  // Committed bpy scripts ship inside this adapter (import.meta.dir = src/dcc/blender).
  return path.join(import.meta.dir, "scripts", name);
}

/**
 * Loads and structurally validates the committed source definition, and
 * enforces the DCC metadata authority boundary BEFORE any Blender run.
 */
export function loadServiceDroneDefinition(definitionPath: string):
  | { ok: true; definition: ServiceDroneSourceDefinition }
  | { ok: false; code: "SOURCE_DEFINITION_INVALID" | "DCC_METADATA_REJECTED"; message: string; details?: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(definitionPath, "utf-8"));
  } catch (err) {
    return {
      ok: false,
      code: "SOURCE_DEFINITION_INVALID",
      message: `source definition unreadable at ${definitionPath}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const def = raw as Record<string, unknown>;
  const problems: string[] = [];
  if (def["schema"] !== "gauntlet.dcc.blender.retarget_source") {
    problems.push(`schema '${String(def["schema"])}' != 'gauntlet.dcc.blender.retarget_source'`);
  }
  const sourceRig = def["source_rig"] as { armature?: string } | undefined;
  const targetRig = def["target_rig"] as { armature?: string } | undefined;
  const mesh = def["mesh"] as { parts?: unknown[] } | undefined;
  if (!sourceRig?.armature) problems.push("source_rig.armature missing");
  if (!targetRig?.armature) problems.push("target_rig.armature missing");
  if (!Array.isArray(mesh?.parts) || mesh.parts.length === 0) problems.push("mesh.parts missing/empty");
  if (def["bake"] === undefined) problems.push("bake settings missing");
  if (def["export"] === undefined) problems.push("export settings missing");
  if (problems.length > 0) {
    return { ok: false, code: "SOURCE_DEFINITION_INVALID", message: "source definition invalid", details: problems };
  }
  // REQ-BLENDER-005: reject gameplay semantics in DCC metadata up front.
  try {
    assertNoGameSemanticsInBlendMetadata(def["dcc_metadata"] ?? {}, `source definition '${path.basename(definitionPath)}' dcc_metadata`);
  } catch (err) {
    return {
      ok: false,
      code: "DCC_METADATA_REJECTED",
      message: err instanceof Error ? err.message : String(err),
    };
  }
  return { ok: true, definition: raw as ServiceDroneSourceDefinition };
}

/** Runs the full retarget/bake/normalize chain. See module docstring. */
export async function runServiceDroneRetargetPipeline(
  options: ServiceDronePipelineOptions
): Promise<ServiceDronePipelineResult> {
  const log = options.log ?? (() => {});

  // 1. Escalation rationale (REQ-BLENDER-002).
  const rationaleCheck = validateEscalationRationale(options.escalationRationale);
  if (!rationaleCheck.ok) {
    return {
      status: "blocked",
      code: rationaleCheck.code,
      message: rationaleCheck.message,
      details: rationaleCheck.details,
    };
  }

  // 2. Source definition + DCC metadata authority boundary.
  const defCheck = loadServiceDroneDefinition(options.definitionPath);
  if (!defCheck.ok) {
    return { status: "blocked", code: defCheck.code, message: defCheck.message, details: defCheck.details };
  }
  const definition = defCheck.definition;
  const assetId = String(definition.asset_id ?? SERVICE_DRONE_ASSET_ID);

  // 3. Blender preflight — typed scoped blockage when absent.
  const preflight = await checkBlenderPreflight(options.preflight);
  if (!preflight.available || !preflight.executable || !preflight.version) {
    return {
      status: "blocked",
      code: "BLENDER_UNAVAILABLE",
      message: preflight.detail,
    };
  }
  log(`preflight: ${preflight.detail}`);

  const absDefinition = path.resolve(options.definitionPath);
  const workDir = options.workDir ?? path.join(options.repoRoot, ".tmp", "dcc-blender", assetId);
  fs.mkdirSync(workDir, { recursive: true });
  const sourceBlend = path.join(workDir, `${assetId}.source.blend`);
  const rawGlb = path.join(workDir, `${assetId}.raw.glb`);
  const outputGlb = path.resolve(
    options.outputGlbPath ?? path.join(options.projectRoot, "assets", `${assetId}.glb`)
  );
  const bakeReport = path.resolve(
    options.bakeReportPath ??
      path.join(options.projectRoot, "assets", "dcc", assetId, `${assetId}.bake-report.json`)
  );
  fs.mkdirSync(path.dirname(bakeReport), { recursive: true });

  const invocations: BlenderInvocationRecord[] = [];

  // 4. Generate the deterministic source rig .blend.
  const generate = await runBlenderBackgroundScript({
    executable: preflight.executable,
    scriptPath: scriptPath("generate_service_drone_source.py"),
    args: [absDefinition, sourceBlend],
    timeoutMs: 180_000,
  });
  invocations.push(generate);
  if (!generate.ok || !fs.existsSync(sourceBlend)) {
    return {
      status: "failed",
      code: "BLENDER_INVOCATION_FAILED",
      message: `source rig generation failed (exit ${generate.exit_code}): ${generate.stderr_tail || generate.stdout_tail}`,
      invocations,
    };
  }
  log(`source rig generated: ${sourceBlend}`);

  // 5. Retarget + bake + export raw GLB (+ bake report with regeneration metadata).
  const retarget = await runBlenderBackgroundScript({
    executable: preflight.executable,
    scriptPath: scriptPath("retarget_bake_service_drone.py"),
    args: [sourceBlend, absDefinition, rawGlb, bakeReport],
    timeoutMs: 300_000,
  });
  invocations.push(retarget);
  if (!retarget.ok || !fs.existsSync(rawGlb)) {
    return {
      status: "failed",
      code: "BLENDER_INVOCATION_FAILED",
      message: `retarget/bake/export failed (exit ${retarget.exit_code}): ${retarget.stderr_tail || retarget.stdout_tail}`,
      invocations,
    };
  }
  log(`retarget/bake complete; raw GLB at ${rawGlb}`);

  // 6. glTF-Transform normalization onto the committed derivative path.
  const normalization = await runGltfPipeline({
    input_path: rawGlb,
    output_path: outputGlb,
    profile: { id: "dcc-blender-baseline", texture_format: "webp" },
    // This derivative ships zero textures; if a future derivative adds one,
    // a real WebP encoder must be provided instead of this guard.
    encoder: (bytes, mime) => {
      throw new Error(
        `dcc-blender-baseline derivative unexpectedly contains texture bytes (${bytes.byteLength}) for '${mime}'; provide a real WebP encoder through the asset.optimize route`
      );
    },
  });
  if (normalization.status !== "success" || !normalization.output_path) {
    return {
      status: "failed",
      code: "NORMALIZATION_FAILED",
      message: `glTF-Transform normalization failed: ${normalization.diagnostics.error ?? normalization.status}`,
      invocations,
    };
  }
  log(`normalized derivative written: ${outputGlb} (${normalization.transformations.join(", ")})`);

  // 7. Re-derive committed derivative stats from disk (single source of truth).
  const io = new NodeIO();
  const doc = await io.read(outputGlb);
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

  return {
    status: "success",
    asset_id: assetId,
    blender: { executable: preflight.executable, version: preflight.version },
    escalation_rationale: rationaleCheck.rationale,
    source_definition: { path: absDefinition, sha256: sha256File(absDefinition) },
    source_blend: { path: sourceBlend, sha256: sha256File(sourceBlend) },
    raw_glb: { path: rawGlb, sha256: sha256File(rawGlb), bytes: fs.statSync(rawGlb).size },
    normalized_glb: {
      path: outputGlb,
      sha256: sha256File(outputGlb),
      bytes: fs.statSync(outputGlb).size,
      triangles,
      animations,
      nodes,
    },
    bake_report: { path: bakeReport, sha256: sha256File(bakeReport) },
    invocations,
    normalization: {
      transformations: normalization.transformations,
      profile_id: normalization.plan.profile_id,
    },
  };
}
