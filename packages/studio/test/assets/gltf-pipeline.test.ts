import { describe, it, expect, beforeAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  NodeIO,
  checkToktxPreflight,
  createMinimalGltfDocument,
  planGltfOptimization,
  runGltfPipeline,
} from "@gauntlet/adapters";
import { AssetRegistry } from "../../src/assets/registry";

let workDir: string;

beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "t13-gltf-"));
});

const FAKE_WEBP_BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4]);
const mockWebpEncoder = () => FAKE_WEBP_BYTES;

describe("glTF-Transform normalization/optimization adapter (T13, REQ-BIND-008, REQ-ASSET-006)", () => {
  it("plans WebP as the portable baseline and KTX2 as toktx-dependent", () => {
    const webpPlan = planGltfOptimization({ id: "portable", texture_format: "webp" });
    expect(webpPlan.texture_format).toBe("webp");
    expect(webpPlan.requires_toktx).toBe(false);

    const defaultPlan = planGltfOptimization({ id: "default" });
    expect(defaultPlan.texture_format).toBe("webp"); // baseline when unspecified

    const ktxPlan = planGltfOptimization({ id: "ktx-profile", texture_format: "ktx2" });
    expect(ktxPlan.texture_format).toBe("ktx2");
    expect(ktxPlan.requires_toktx).toBe(true);
  });

  it("reports a typed BLOCKED result when a KTX2 profile runs without toktx and never downgrades", async () => {
    const inputPath = path.join(workDir, "in-ktx.glb");
    const outputPath = path.join(workDir, "out-ktx.glb");
    await new NodeIO().write(inputPath, createMinimalGltfDocument({ textureMime: "image/png" }));

    const result = await runGltfPipeline({
      input_path: inputPath,
      output_path: outputPath,
      profile: { id: "ktx-required", texture_format: "ktx2" },
      encoder: mockWebpEncoder, // even a present encoder cannot substitute for toktx
      which: () => null, // toktx unavailable
    });

    expect(result.status).toBe("blocked");
    expect(result.diagnostics.code).toBe("TOKTX_UNAVAILABLE");
    expect(result.toktx_preflight).toBe("unavailable");
    expect(result.achieved_texture_format).toBeUndefined(); // silent downgrade prohibited
    expect(fs.existsSync(outputPath)).toBe(false); // no silently downgraded output
  });

  it("runs the WebP baseline pipeline end-to-end on a real glTF document", async () => {
    const inputPath = path.join(workDir, "in-webp.glb");
    const outputPath = path.join(workDir, "out-webp.glb");
    await new NodeIO().write(inputPath, createMinimalGltfDocument({ textureMime: "image/png" }));

    const result = await runGltfPipeline({
      input_path: inputPath,
      output_path: outputPath,
      profile: { id: "portable", texture_format: "webp" },
      encoder: mockWebpEncoder,
    });

    expect(result.status).toBe("success");
    expect(result.achieved_texture_format).toBe("webp");
    expect(result.transformations).toContain("dedup");
    expect(result.transformations).toContain("texture:webp");

    const optimized = await new NodeIO().read(outputPath);
    const texture = optimized.getRoot().listTextures()[0];
    expect(texture?.getMimeType()).toBe("image/webp");
    expect(Array.from(texture?.getImage() ?? [])).toEqual(Array.from(FAKE_WEBP_BYTES));
  });

  it("blocks a declared texture format when no encoder is provided instead of copying through", async () => {
    const inputPath = path.join(workDir, "in-noenc.glb");
    const outputPath = path.join(workDir, "out-noenc.glb");
    await new NodeIO().write(inputPath, createMinimalGltfDocument({ textureMime: "image/png" }));

    const result = await runGltfPipeline({
      input_path: inputPath,
      output_path: outputPath,
      profile: { id: "portable", texture_format: "webp" },
      // no encoder
    });

    expect(result.status).toBe("blocked");
    expect(result.diagnostics.code).toBe("TEXTURE_ENCODER_UNAVAILABLE");
    expect(fs.existsSync(outputPath)).toBe(false);
  });

  it("preflight reflects real toktx availability without throwing", () => {
    const preflight = checkToktxPreflight();
    expect(typeof preflight.available).toBe("boolean");
    expect(preflight.detail.length).toBeGreaterThan(0);
  });

  it("binds compiler results to registry acceptance: KTX2-required profiles with achieved WebP are blocked", () => {
    const registry = new AssetRegistry("/tmp/nonexistent-project", {
      manifestPath: `/tmp/nonexistent-project/gltf-${Math.random().toString(36).slice(2)}.json`,
    });
    registry.intake({
      id: "compiler-downgraded",
      role: "background_tree",
      origin: "procedural",
      construction_route: "asset.optimize/asset.gltf-transform",
      source_provenance: { license: "project-owned", sha256: "d".repeat(64) },
      runtime_representation: "GLB/glTF",
      // Compiler was asked for KTX2 but the environment had no toktx; someone tries to
      // record the WebP output anyway. The registry gate must block the downgrade.
      budget: { required_texture_format: "ktx2", texture_format: "webp" },
      acceptance_state: "pending",
    });
    const outcome = registry.accept("compiler-downgraded");
    expect(outcome.state).toBe("blocked");
    expect(outcome.report.blockers[0]?.detail).toContain("silent downgrade prohibited");

    // With recorded toktx preflight + achieved KTX2 the same record class is acceptable.
    registry.intake({
      id: "compiler-ktx2",
      role: "background_tree",
      origin: "procedural",
      construction_route: "asset.optimize/asset.gltf-transform",
      source_provenance: { license: "project-owned", sha256: "d".repeat(64) },
      runtime_representation: "GLB/glTF",
      budget: { required_texture_format: "ktx2", texture_format: "ktx2", toktx_preflight: "pass" },
      acceptance_state: "pending",
    });
    expect(registry.accept("compiler-ktx2").state).toBe("accepted");
  });
});
