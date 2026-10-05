/**
 * Production asset ABI: glTF/GLB (REQ-GLB-001, spec v0.5.0).
 *
 * Geometry entering production acceptance must be represented as normalized
 * glTF/GLB (via the settled glTF-Transform route); provider-specific object
 * graphs must not leak downstream of this boundary. The gate reuses the
 * existing asset acceptance evaluation — it adds one gate, it does not create
 * a second verification path.
 */

import type { AssetRecord } from "@gauntlet/contracts";

// Mesh-like geometry only. Environment composition outputs (skies, lighting
// rigs, atmosphere) are world-composition results under the settled 3dviz
// route, not meshes — the World Manifest and lighting intent govern those
// (REQ-GODOT-003), and they are not GLB-ABI subjects.
const GEOMETRY_ROLES = /(hero|character|vehicle|weapon|prop|kit|mesh)/i;

export type GlbAbiErrorCode = "GLB_ABI_VIOLATION";

export class GlbAbiError extends Error {
  constructor(
    readonly code: GlbAbiErrorCode,
    readonly assetId: string,
    message: string,
  ) {
    super(`${code} (${assetId}): ${message}`);
    this.name = "GlbAbiError";
  }
}

export function isGeometryRole(role: string): boolean {
  return GEOMETRY_ROLES.test(role);
}

/** The runtime representation names a glTF/GLB payload. */
export function isGltfRepresentation(runtimeRepresentation: string): boolean {
  return /glb|gltf/i.test(runtimeRepresentation);
}

/**
 * The settled img2threejs route (T14) and the DCC derivative route (T18)
 * produce inspectable first-party code modules consumed directly by the
 * reference runtime — preserved settled evidence under the v0.5.0 amendment.
 * The GLB ABI governs sourced, generated, normalized, and DCC-produced
 * geometry; procedural code-module routes are exempt (REQ-GLB-001 as clarified
 * in v0.5.1).
 */
export function isProceduralCodeRoute(record: Pick<AssetRecord, "construction_route" | "origin">): boolean {
  return record.origin === "procedural" || /procedural[_-]?(three[_-]?)?module|img2threejs/i.test(record.construction_route);
}

/**
 * Enforce the GLB production ABI for geometry-role assets. Textures, HDRIs,
 * audio, and other non-geometry resources keep their own representations
 * (WebP/KTX2 texture sets, wav, ...) — the ABI boundary is for meshes.
 * Construction routes that never converged to normalized GLB (provider object
 * graphs, raw procedural scene dumps) are rejected.
 */
export function assertProductionGlbAbi(record: AssetRecord): void {
  if (!isGeometryRole(record.role)) return;
  if (isProceduralCodeRoute(record)) return;
  if (isGltfRepresentation(record.runtime_representation)) return;
  throw new GlbAbiError(
    "GLB_ABI_VIOLATION",
    record.id,
    `geometry role '${record.role}' must enter production as normalized glTF/GLB via the glTF-Transform route; found '${record.runtime_representation}' — normalize first, never import provider object graphs`,
  );
}
