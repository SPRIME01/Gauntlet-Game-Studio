/**
 * Service drone — committed Blender-derived asset consumption (T18).
 *
 * Produced through the isolated `dcc.blender.process` escalation route
 * (Blender 5.2.2 LTS, deterministic background scripts) and accepted through
 * the Asset Registry as a blender-origin derived asset:
 *   source definition (assets/dcc/service-drone/service-drone.source.json)
 *     -> bpy retarget/bake -> GLB -> glTF-Transform normalization
 *     -> assets/service-drone.glb (committed).
 *
 * Boundaries held by this module:
 *  - The game consumes ONLY the committed accepted GLB derivative; the .blend
 *    and DCC metadata are never runtime inputs and never semantic authority
 *    (REQ-BLENDER-004/005/006).
 *  - Zero runtime dependency on Blender: consumption works on any host
 *    (verified by test:blender-absent-build with Blender removed from PATH).
 *  - The GLB validation here reads the glTF 2.0 container (JSON chunk) with
 *    plain DataView — no renderer, no DOM, deterministic everywhere.
 *  - Animation clips and named nodes are structural affordances; the game
 *    model (Koota) owns any semantics bound to them (REQ-RUNTIME-003).
 */

export const SERVICE_DRONE_ASSET = {
  id: "service-drone",
  glbPath: "assets/service-drone.glb",
  origin: "blender",
  constructionRoute: "dcc.blender.process",
  animationClip: "hover_cycle",
  frameRange: [1, 24],
  requiredNodes: [
    "DroneRigTarget",
    "tgt_body",
    "tgt_hull",
    "tgt_rotor_a",
    "tgt_rotor_b",
    "tgt_rotor_c",
    "tgt_rotor_d",
    "drone-body",
    "drone-hull",
    "drone-sensor-mast",
    "drone-rotor-a",
    "drone-rotor-b",
    "drone-rotor-c",
    "drone-rotor-d",
  ],
} as const;

export const GLB_MAGIC = 0x46546c67; // "glTF"
const GLB_JSON_CHUNK_TYPE = 0x4e4f534a; // "JSON"

export interface ParsedGlbContainer {
  version: string;
  generator?: string;
  animations: Array<{ name?: string; channels: unknown[] }>;
  nodes: Array<{ name?: string; extras?: Record<string, unknown> }>;
  meshes: unknown[];
  scenes: unknown[];
  assetExtras: Record<string, unknown>;
}

/**
 * Parses a committed GLB's JSON chunk. Throws typed errors on container
 * damage so a corrupted derivative can never silently enter the game.
 */
export function parseGlbContainer(bytes: Uint8Array): ParsedGlbContainer {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20 || view.getUint32(0, true) !== GLB_MAGIC) {
    throw new Error("service-drone asset is not a GLB container (bad magic)");
  }
  const jsonLength = view.getUint32(12, true);
  const jsonType = view.getUint32(16, true);
  if (jsonType !== GLB_JSON_CHUNK_TYPE) {
    throw new Error("service-drone GLB first chunk is not JSON");
  }
  const jsonText = new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength));
  const json = JSON.parse(jsonText) as {
    asset?: { version?: string; generator?: string; extras?: Record<string, unknown> };
    animations?: Array<{ name?: string; channels: unknown[] }>;
    nodes?: Array<{ name?: string; extras?: Record<string, unknown> }>;
    meshes?: unknown[];
    scenes?: unknown[];
  };
  return {
    version: json.asset?.version ?? "unknown",
    generator: json.asset?.generator,
    animations: json.animations ?? [],
    nodes: json.nodes ?? [],
    meshes: json.meshes ?? [],
    scenes: json.scenes ?? [],
    assetExtras: json.asset?.extras ?? {},
  };
}

/**
 * Asserts the committed derivative satisfies the accepted asset contract:
 * valid glTF 2.0 GLB, the hover_cycle clip, all named rig/mesh nodes. These
 * are structural affordances only — never auto-promoted gameplay semantics.
 */
export function assertServiceDroneDerivativeConsumable(glb: ParsedGlbContainer): void {
  if (glb.version !== "2.0") {
    throw new Error(`service-drone derivative is glTF ${glb.version}; expected 2.0`);
  }
  const animationNames = glb.animations.map((a) => a.name);
  if (!animationNames.includes(SERVICE_DRONE_ASSET.animationClip)) {
    throw new Error(
      `service-drone derivative lacks the accepted '${SERVICE_DRONE_ASSET.animationClip}' clip (found: ${animationNames.join(", ")})`
    );
  }
  const nodeNames = new Set(glb.nodes.map((n) => n.name));
  const missing = SERVICE_DRONE_ASSET.requiredNodes.filter((n) => !nodeNames.has(n));
  if (missing.length > 0) {
    throw new Error(`service-drone derivative is missing accepted node(s): ${missing.join(", ")}`);
  }
}
