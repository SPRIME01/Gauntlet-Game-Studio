/**
 * Capability preparation for dcc.blender.process (T18).
 *
 * Preparation validates BEFORE any Blender run:
 *   - provider binding (the route is exclusively dcc.blender);
 *   - the recorded escalation rationale (REQ-BLENDER-002) — a request that
 *     cannot say why lighter routes are insufficient is blocked;
 *   - the committed source definition, including the DCC metadata authority
 *     boundary (REQ-BLENDER-005);
 *   - Blender preflight (REQ-BLENDER-007) — absence yields a typed, SCOPED
 *     blockage of this regeneration route only; unrelated game/runtime
 *     verification never depends on it, and committed accepted derivatives
 *     stay fully consumable.
 *
 * Creating the preparation never reports capability success; settlement
 * requires the committed accepted derivative, and deterministic verify-result
 * re-derives all evidence offline.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { CapabilityDescriptor, CapabilityRequest } from "@gauntlet/contracts";
import { validateEscalationRationale } from "./escalation";
import { DCC_BLENDER_PROCESS_CAPABILITY, DCC_BLENDER_PROVIDER, checkBlenderPreflight, type BlenderPreflightDeps } from "./preflight";
import { loadServiceDroneDefinition } from "./pipeline";

export { DCC_BLENDER_PROCESS_CAPABILITY };

export interface BlenderProcessPreparationOptions {
  projectRoot: string;
  repoRoot: string;
  preflight?: BlenderPreflightDeps;
}

export type BlenderProcessPreparation =
  | {
      status: "ready";
      capability_id: string;
      provider: string;
      blender: { executable: string; version: string; detail: string };
      plan: {
        steps: string[];
        invocation_form: string;
        source_definition: string;
        output_glb: string;
        bake_report: string;
      };
    }
  | {
      status: "blocked";
      capability_id: string;
      provider: string;
      code:
        | "PROVIDER_MISMATCH"
        | "ESCALATION_RATIONALE_REQUIRED"
        | "SOURCE_DEFINITION_INVALID"
        | "DCC_METADATA_REJECTED"
        | "BLENDER_UNAVAILABLE";
      message: string;
      details?: string[];
      allowed_next_steps: string[];
    };

function extractInput(request: CapabilityRequest, key: string): unknown {
  return (request.inputs ?? {})[key];
}

/** Normalize a dcc.blender.process request into a validated execution plan — or a typed block. */
export async function prepareBlenderProcess(
  request: CapabilityRequest,
  capability: CapabilityDescriptor,
  options: BlenderProcessPreparationOptions
): Promise<BlenderProcessPreparation> {
  const provider = request.preferred_provider ?? capability.providers[0];

  if (provider !== DCC_BLENDER_PROVIDER) {
    // The route is EXCLUSIVE: an explicitly declared foreign provider is a
    // mismatch, never a silent redirect onto dcc.blender.
    return {
      status: "blocked",
      capability_id: capability.id,
      provider,
      code: "PROVIDER_MISMATCH",
      message: `Capability '${capability.id}' binds exclusively to provider '${DCC_BLENDER_PROVIDER}'; got '${provider}'.`,
      allowed_next_steps: [],
    };
  }

  // REQ-BLENDER-002: record why lighter routes are insufficient first.
  const rationale = validateEscalationRationale(extractInput(request, "escalation_rationale"));
  if (!rationale.ok) {
    return {
      status: "blocked",
      capability_id: capability.id,
      provider,
      code: rationale.code,
      message: rationale.message,
      details: rationale.details,
      allowed_next_steps: [
        "record inputs.escalation_rationale { requested_operation, reason, rejected_routes[] } proving lighter routes are insufficient, or travel a lighter route",
      ],
    };
  }

  // Committed source definition + DCC metadata authority boundary.
  const definitionPath = extractInput(request, "source_definition");
  if (typeof definitionPath !== "string" || definitionPath.length === 0) {
    return {
      status: "blocked",
      capability_id: capability.id,
      provider,
      code: "SOURCE_DEFINITION_INVALID",
      message: "inputs.source_definition is required (deterministic rig/animation definition consumed by the committed bpy scripts).",
      allowed_next_steps: [],
    };
  }
  const absDefinition = path.isAbsolute(definitionPath)
    ? definitionPath
    : path.resolve(options.projectRoot, definitionPath);
  if (!fs.existsSync(absDefinition)) {
    return {
      status: "blocked",
      capability_id: capability.id,
      provider,
      code: "SOURCE_DEFINITION_INVALID",
      message: `source definition not found at ${definitionPath}.`,
      allowed_next_steps: [],
    };
  }
  const defCheck = loadServiceDroneDefinition(absDefinition);
  if (!defCheck.ok) {
    return {
      status: "blocked",
      capability_id: capability.id,
      provider,
      code: defCheck.code,
      message: defCheck.message,
      details: defCheck.details,
      allowed_next_steps:
        defCheck.code === "DCC_METADATA_REJECTED"
          ? ["remove gameplay semantics from DCC metadata; quest/NPC state belongs to the game's Koota model (REQ-BLENDER-005)"]
          : ["repair the committed source definition"],
    };
  }

  // REQ-BLENDER-007: Blender required ONLY for this regeneration/proof job.
  const preflight = await checkBlenderPreflight(options.preflight);
  if (!preflight.available || !preflight.executable || !preflight.version) {
    return {
      status: "blocked",
      capability_id: capability.id,
      provider,
      code: "BLENDER_UNAVAILABLE",
      message: preflight.detail,
      allowed_next_steps: [
        "install Blender 5.2.2 LTS (or compatible) on this host to regenerate",
        "produce the derivative on a donor host through dcc.blender.process and commit it with regeneration metadata",
        "continue without regeneration: committed accepted derivatives build/test/run with zero Blender presence (REQ-BLENDER-006)",
      ],
    };
  }

  const outputGlb = extractInput(request, "output_glb_path");
  const bakeReport = extractInput(request, "bake_report_path");

  return {
    status: "ready",
    capability_id: capability.id,
    provider,
    blender: { executable: preflight.executable, version: preflight.version, detail: preflight.detail },
    plan: {
      steps: [
        `generate source rig .blend from ${definitionPath} (generate_service_drone_source.py)`,
        "retarget onto the delivery rig, bake keyframes, export raw GLB (retarget_bake_service_drone.py)",
        "normalize through glTF-Transform onto the committed derivative path",
        "intake + accept through the project Asset Registry as a blender-origin derived asset",
      ],
      invocation_form: "blender --background --factory-startup --python <script> -- <args>",
      source_definition: definitionPath,
      output_glb: typeof outputGlb === "string" ? outputGlb : `assets/${String(defCheck.definition.asset_id)}.glb`,
      bake_report: typeof bakeReport === "string" ? bakeReport : `assets/dcc/${String(defCheck.definition.asset_id)}/${String(defCheck.definition.asset_id)}.bake-report.json`,
    },
  };
}
