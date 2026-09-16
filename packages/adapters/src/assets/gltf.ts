/**
 * glTF-Transform normalization/optimization adapter (REQ-BIND-008, REQ-ASSET-006).
 *
 * WebP is the portable baseline texture optimization path. KTX2/Basis Universal is
 * an OPTIONAL, profile-specific path that requires a successful toktx preflight:
 * if a quality profile explicitly requires KTX2 and toktx is unavailable, the
 * pipeline reports a typed BLOCKED result. Silent downgrade is prohibited.
 */

import { Document, NodeIO } from "@gltf-transform/core";
import { dedup, prune } from "@gltf-transform/functions";

// Re-exported so downstream consumers (including cross-package tests under the
// isolated linker) can exercise the pipeline without a direct transitive import.
export { Document, NodeIO };

export const GLTF_ADAPTER_VERSION = "0.2.0";

export type TextureFormat = "webp" | "ktx2";

export interface QualityProfile {
  id: string;
  texture_format?: TextureFormat;
}

export interface GltfOptimizationPlan {
  profile_id: string;
  texture_format: TextureFormat;
  requires_toktx: boolean;
  transformations: string[];
}

/**
 * Decide the deterministic transformation plan for a quality profile.
 * Pure function: no I/O, no network, no tool availability assumptions.
 */
export function planGltfOptimization(profile: QualityProfile): GltfOptimizationPlan {
  const format: TextureFormat = profile.texture_format ?? "webp";
  return {
    profile_id: profile.id,
    texture_format: format,
    requires_toktx: format === "ktx2",
    transformations: ["dedup", "prune", `texture:${format}`],
  };
}

export interface ToktxPreflight {
  available: boolean;
  detail: string;
}

/**
 * toktx (KTX-Software) availability preflight. Injectable `which` keeps this
 * deterministic under test; production uses Bun.which.
 */
export function checkToktxPreflight(which: (name: string) => string | null = (n) => Bun.which(n)): ToktxPreflight {
  const resolved = which("toktx");
  if (resolved) {
    return { available: true, detail: `toktx available at ${resolved}` };
  }
  return { available: false, detail: "toktx (KTX-Software) not found on PATH; KTX2 profile cannot run" };
}

export interface TextureEncoder {
  /** Encode raw texture bytes into the target mime (e.g. image/webp, image/ktx2). */
  (image: Uint8Array, mimeType: string): Promise<Uint8Array> | Uint8Array;
}

export interface GltfPipelineOptions {
  input_path: string;
  output_path: string;
  profile: QualityProfile;
  /** Encoder for the target texture format. Required whenever the profile declares one. */
  encoder?: TextureEncoder;
  /** Injectable IO for tests; defaults to a dependency-free NodeIO. */
  io?: NodeIO;
  /** Injectable which() for toktx preflight; defaults to Bun.which. */
  which?: (name: string) => string | null;
  prune_meshes?: boolean;
}

export type GltfPipelineStatus = "success" | "blocked" | "failed";

export interface GltfPipelineResult {
  status: GltfPipelineStatus;
  input_path: string;
  output_path?: string;
  plan: GltfOptimizationPlan;
  achieved_texture_format?: TextureFormat;
  toktx_preflight: "pass" | "unavailable" | "skipped";
  transformations: string[];
  diagnostics: {
    code?: string;
    error?: string;
  };
}

export const GLTF_PIPELINE_BLOCKED_CODES = {
  TOKTX_UNAVAILABLE: "TOKTX_UNAVAILABLE",
  TEXTURE_ENCODER_UNAVAILABLE: "TEXTURE_ENCODER_UNAVAILABLE",
} as const;

async function transformTextures(document: Document, encoder: TextureEncoder, format: TextureFormat): Promise<number> {
  const targetMime = format === "ktx2" ? "image/ktx2" : "image/webp";
  let count = 0;
  for (const texture of document.getRoot().listTextures()) {
    const source = texture.getImage();
    if (!source) continue;
    if (texture.getMimeType() === targetMime) continue;
    const encoded = await encoder(source, targetMime);
    texture.setImage(new Uint8Array(encoded));
    texture.setMimeType(targetMime);
    count += 1;
  }
  return count;
}

/**
 * Run the normalization/optimization pipeline. Failure modes are typed:
 *  - KTX2 profile without toktx -> blocked TOKTX_UNAVAILABLE (no downgrade);
 *  - declared texture format without encoder -> blocked TEXTURE_ENCODER_UNAVAILABLE;
 *  - load/write errors -> failed with the underlying error message.
 */
export async function runGltfPipeline(options: GltfPipelineOptions): Promise<GltfPipelineResult> {
  const plan = planGltfOptimization(options.profile);
  const base = {
    input_path: options.input_path,
    plan,
    transformations: plan.transformations,
    diagnostics: {} as GltfPipelineResult["diagnostics"],
  };

  let toktx_preflight: GltfPipelineResult["toktx_preflight"] = "skipped";
  if (plan.requires_toktx) {
    const preflight = checkToktxPreflight(options.which);
    if (!preflight.available) {
      // REQ-BIND-008: report blocked rather than silently downgrading.
      return {
        ...base,
        status: "blocked",
        toktx_preflight: "unavailable",
        diagnostics: { code: GLTF_PIPELINE_BLOCKED_CODES.TOKTX_UNAVAILABLE, error: preflight.detail },
      };
    }
    toktx_preflight = "pass";
  }

  if (options.encoder === undefined) {
    return {
      ...base,
      status: "blocked",
      toktx_preflight,
      diagnostics: {
        code: GLTF_PIPELINE_BLOCKED_CODES.TEXTURE_ENCODER_UNAVAILABLE,
        error: `Quality profile '${plan.profile_id}' requires ${plan.texture_format} texture encoding but no encoder was provided`,
      },
    };
  }

  try {
    const io = options.io ?? new NodeIO();
    const document = await io.read(options.input_path);

    const applied: string[] = [];
    // glTF-Transform v4 exposes curried transform functions applied via Document.transform.
    const transforms: Array<(doc: Document) => Promise<void> | void> = [dedup()];
    applied.push("dedup");
    if (options.prune_meshes !== false) {
      transforms.push(prune());
      applied.push("prune");
    }
    await document.transform(...transforms);
    const textureCount = await transformTextures(document, options.encoder, plan.texture_format);
    if (textureCount > 0) applied.push(`texture:${plan.texture_format}`);

    await io.write(options.output_path, document);
    return {
      status: "success",
      input_path: options.input_path,
      output_path: options.output_path,
      plan,
      achieved_texture_format: plan.texture_format,
      toktx_preflight,
      transformations: applied,
      diagnostics: { code: undefined, error: undefined },
    };
  } catch (err) {
    return {
      ...base,
      status: "failed",
      toktx_preflight,
      diagnostics: { error: err instanceof Error ? err.message : String(err) },
    };
  }
}

/** Build a minimal in-memory glTF document (for fixtures and deterministic tests). */
export function createMinimalGltfDocument(options: { textureMime?: string; textureBytes?: Uint8Array } = {}): Document {
  const doc = new Document();
  const buffer = doc.createBuffer("buffer");
  const positions = doc
    .createAccessor("positions")
    .setType("VEC3")
    .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
    .setBuffer(buffer);
  const indices = doc.createAccessor("indices").setType("SCALAR").setArray(new Uint32Array([0, 1, 2])).setBuffer(buffer);
  const prim = doc.createPrimitive().setAttribute("POSITION", positions).setIndices(indices);
  const material = doc.createMaterial("material");
  if (options.textureMime) {
    const texture = doc
      .createTexture("texture")
      .setMimeType(options.textureMime)
      .setImage(options.textureBytes ?? new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    material.setBaseColorTexture(texture);
  }
  prim.setMaterial(material);
  const mesh = doc.createMesh("mesh").addPrimitive(prim);
  const node = doc.createNode("node").setMesh(mesh);
  doc.createScene("scene").addChild(node);
  return doc;
}
