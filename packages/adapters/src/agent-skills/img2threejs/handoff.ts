/**
 * AgentHandoff normalization for the img2threejs reference-reconstruction route.
 *
 * REQ-BIND-006: this route REQUIRES suitable reference imagery. Preparation
 * validates the referenced imagery on disk (existence, type, size, hash) and
 * records provenance class evidence; if the reference is missing or invalid the
 * preparation BLOCKS and asks for an allowed reference — it must never silently
 * become generic text-to-3D (REQ-ASSET-001 user-supplied preferred,
 * REQ-ASSET-002 project-owned/authorized next).
 *
 * The handoff points the current coding agent at the PINNED vendor skill
 * content (vendor/skills/img2threejs/SKILL.md) and the validated
 * project/reference inputs. Creating the handoff never reports capability
 * success; settlement requires real accepted artifacts, and deterministic
 * verify-result re-derives the evidence offline (CI without model credentials).
 *
 * No model invocation, no network access anywhere in this module.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentHandoff, CapabilityDescriptor, CapabilityRequest } from "@gauntlet/contracts";

export const IMG2THREEJS_SKILL_ID = "img2threejs";
export const IMG2THREEJS_PROVIDER = `agent-skill.${IMG2THREEJS_SKILL_ID}`;
export const ASSET_RECONSTRUCT_REFERENCE_IMAGE_CAPABILITY = "asset.reconstruct.reference-image";
export const PINNED_SKILL_METADATA_REF = "vendor/skills/img2threejs/metadata.json";
export const PINNED_SKILL_ENTRYPOINT_REF = "vendor/skills/img2threejs/SKILL.md";
export const REFERENCE_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];
const MAX_REFERENCE_BYTES = 32 * 1024 * 1024;

export interface ReferenceInputSpec {
  id: string;
  path: string;
  provenance_class?: string;
  license?: string;
}

export interface NormalizedReference {
  id: string;
  /** Path as recorded in the request (project-root-relative when relative). */
  recorded_path: string;
  /** Absolute path validated on disk. */
  resolved_path: string;
  sha256: string;
  bytes: number;
  provenance_class: string;
  license: string;
  /** Reference imagery is ALWAYS reference-only (REQ-ASSET-004). */
  reference_only: true;
}

export type ReferenceImagePreparation =
  | {
      status: "ready";
      capability_id: string;
      provider: string;
      handoff: AgentHandoff;
      references: NormalizedReference[];
    }
  | {
      status: "blocked";
      capability_id: string;
      provider: string;
      code:
        | "REFERENCE_REQUIRED"
        | "REFERENCE_INVALID"
        | "PROVIDER_MISMATCH"
        | "SKILL_CONTENT_MISSING";
      message: string;
      /** Explicit asks; preparation never silently becomes generic text-to-3D. */
      allowed_next_steps: string[];
      details?: string[];
    };

export interface PreparationOptions {
  projectRoot: string;
  repoRoot: string;
}

function sha256File(absPath: string): { hash: string; bytes: number } {
  const content = fs.readFileSync(absPath);
  const hash = crypto.createHash("sha256").update(content).digest("hex");
  return { hash, bytes: content.byteLength };
}

function extractReferenceSpecs(request: CapabilityRequest): ReferenceInputSpec[] {
  const inputs = (request.inputs ?? {}) as Record<string, unknown>;
  const refs = inputs["references"];
  if (Array.isArray(refs)) {
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
  return [];
}

function validateReferenceList(
  specs: ReferenceInputSpec[],
  projectRoot: string
): { ok: true; references: NormalizedReference[] } | { ok: false; code: "REFERENCE_REQUIRED" | "REFERENCE_INVALID"; message: string; details: string[] } {
  if (specs.length === 0) {
    return {
      ok: false,
      code: "REFERENCE_REQUIRED",
      message:
        "The reference-image reconstruction route requires suitable reference imagery before routing. Supply a user-provided image (preferred), or a project-owned/authorized or clearly licensed/public-domain reference. The request cannot silently become generic text-to-3D.",
      details: [],
    };
  }

  const details: string[] = [];
  const references: NormalizedReference[] = [];
  for (const spec of specs) {
    const abs = path.isAbsolute(spec.path) ? spec.path : path.resolve(projectRoot, spec.path);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      details.push(`reference '${spec.id}' does not exist at ${path.relative(projectRoot, abs) || abs}`);
      continue;
    }
    const ext = path.extname(abs).toLowerCase();
    if (!REFERENCE_IMAGE_EXTENSIONS.includes(ext)) {
      details.push(`reference '${spec.id}' has unsupported image type '${ext}' (allowed: ${REFERENCE_IMAGE_EXTENSIONS.join(", ")})`);
      continue;
    }
    const { hash, bytes } = sha256File(abs);
    if (bytes === 0) {
      details.push(`reference '${spec.id}' is empty`);
      continue;
    }
    if (bytes > MAX_REFERENCE_BYTES) {
      details.push(`reference '${spec.id}' exceeds ${MAX_REFERENCE_BYTES} bytes`);
      continue;
    }
    references.push({
      id: spec.id,
      recorded_path: spec.path,
      resolved_path: abs,
      sha256: hash,
      bytes,
      provenance_class: spec.provenance_class ?? "unspecified",
      license: spec.license ?? "unspecified",
      reference_only: true,
    });
  }

  if (details.length > 0) {
    return {
      ok: false,
      code: "REFERENCE_REQUIRED",
      message:
        "Referenced imagery failed validation (missing or unreadable). Supply a suitable user-provided, project-owned/authorized, or clearly licensed/public-domain reference image; the request cannot silently become generic text-to-3D.",
      details,
    };
  }

  return { ok: true, references };
}

/**
 * Normalize a reference-image reconstruction request into a validated
 * AgentHandoff pointing at the pinned skill content — or a typed block.
 */
export function prepareReferenceImageReconstruction(
  request: CapabilityRequest,
  capability: CapabilityDescriptor,
  options: PreparationOptions
): ReferenceImagePreparation {
  const provider = request.preferred_provider && capability.providers.includes(request.preferred_provider)
    ? request.preferred_provider
    : capability.providers[0];

  if (provider !== IMG2THREEJS_PROVIDER) {
    return {
      status: "blocked",
      capability_id: capability.id,
      provider,
      code: "PROVIDER_MISMATCH",
      message: `Capability '${capability.id}' binds exclusively to provider '${IMG2THREEJS_PROVIDER}'; got '${provider}'.`,
      allowed_next_steps: [],
    };
  }

  const refs = validateReferenceList(extractReferenceSpecs(request), options.projectRoot);
  if (!refs.ok) {
    return {
      status: "blocked",
      capability_id: capability.id,
      provider,
      code: refs.code,
      message: refs.message,
      details: refs.details,
      allowed_next_steps: [
        "supply a user-provided suitable reference image (preferred, REQ-ASSET-001)",
        "select a project-owned/authorized or clearly licensed/public-domain reference (REQ-ASSET-002)",
      ],
    };
  }

  const metadataPath = path.join(options.repoRoot, PINNED_SKILL_METADATA_REF);
  let pinnedSkill: { id: string; version: string; license: string; capability?: string; entrypoint: string };
  try {
    const raw = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
    pinnedSkill = {
      id: String(raw.id ?? IMG2THREEJS_SKILL_ID),
      version: String(raw.version ?? "unknown"),
      license: String(raw.license ?? "unknown"),
      capability: raw.capability !== undefined ? String(raw.capability) : undefined,
      entrypoint: String(raw.entrypoint ?? ""),
    };
  } catch (err) {
    return {
      status: "blocked",
      capability_id: capability.id,
      provider,
      code: "SKILL_CONTENT_MISSING",
      message: `Pinned img2threejs skill content could not be loaded from ${PINNED_SKILL_METADATA_REF}: ${err instanceof Error ? err.message : String(err)}`,
      allowed_next_steps: [],
    };
  }
  const entrypointPath = path.join(options.repoRoot, PINNED_SKILL_ENTRYPOINT_REF);
  if (pinnedSkill.id !== IMG2THREEJS_SKILL_ID || pinnedSkill.entrypoint !== "SKILL.md" || !fs.existsSync(entrypointPath)) {
    return {
      status: "blocked",
      capability_id: capability.id,
      provider,
      code: "SKILL_CONTENT_MISSING",
      message: `Pinned skill content requires ${PINNED_SKILL_METADATA_REF} to declare id '${IMG2THREEJS_SKILL_ID}' and entrypoint 'SKILL.md', with ${PINNED_SKILL_ENTRYPOINT_REF} present.`,
      allowed_next_steps: [],
    };
  }

  const inputs = (request.inputs ?? {}) as Record<string, unknown>;
  const expectedOutputs: string[] = [...capability.outputs];
  const moduleOutputPath = inputs["module_output_path"];
  if (typeof moduleOutputPath === "string" && moduleOutputPath.length > 0 && !expectedOutputs.includes(moduleOutputPath)) {
    expectedOutputs.push(moduleOutputPath);
  }

  const handoff: AgentHandoff = {
    request_id: request.id,
    skill_id: IMG2THREEJS_SKILL_ID,
    instructions_ref: PINNED_SKILL_ENTRYPOINT_REF,
    expected_outputs: expectedOutputs,
    acceptance: [...request.acceptance],
    reference_ids: request.reference_ids ?? referencesToIds(refs.references),
    provider_context: {
      capability_id: capability.id,
      provider,
      project_root: path.basename(options.projectRoot),
      pinned_skill: { ...pinnedSkill, source_ref: PINNED_SKILL_METADATA_REF, instructions_ref: PINNED_SKILL_ENTRYPOINT_REF },
      references: refs.references,
      reference_policy: {
        reference_only: true,
        note: "Reference imagery is reference-only provenance (REQ-ASSET-004) and must never ship as production content.",
      },
      execution_mode: "current coding agent fulfills the handoff; deterministic verify-result re-derives all evidence offline (no model invocation, no network) so CI can verify committed accepted outputs without replaying generation",
    },
  };

  return {
    status: "ready",
    capability_id: capability.id,
    provider,
    handoff,
    references: refs.references,
  };
}

function referencesToIds(refs: NormalizedReference[]): string[] {
  return refs.map((r) => r.id);
}
