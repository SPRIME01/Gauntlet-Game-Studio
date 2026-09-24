import { describe, it, expect } from "bun:test";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PolyHavenAssetSource, safeIntakePath, PolyHavenPathError, type HttpResponse } from "@gauntlet/adapters";
import { AssetRegistry } from "../../src/assets/registry";

// Deterministic fixtures — no test in this suite ever touches the real network.
const GLB_BYTES = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 1, 2, 3, 4, 5, 6, 7, 8]);
const GLB_SHA256 = crypto.createHash("sha256").update(GLB_BYTES).digest("hex");
const INFO = {
  name: "Wooden Barrel",
  authors: { someone: { author: "Poly Haven" } },
  license: "CC0",
  tags: ["wood", "barrel"],
};
const FILES = {
  gltf: { glb: { url: "https://dl.polyhaven.org/barrel.glb", md5: 12345, size: GLB_BYTES.byteLength } },
};

function fixtureFetcher(options: { fail?: boolean; status?: number } = {}) {
  return async (url: string): Promise<HttpResponse> => {
    if (options.fail) {
      throw new Error("getaddrinfo ENOTFOUND api.polyhaven.com");
    }
    const status = options.status ?? 200;
    if (url.endsWith("/info/barrel")) {
      return { ok: status === 200, status, json: async () => INFO, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    if (url.endsWith("/files/barrel")) {
      return { ok: status === 200, status, json: async () => FILES, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    if (url === FILES.gltf.glb.url) {
      const copy = new Uint8Array(GLB_BYTES);
      const buf = copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength);
      return { ok: status === 200, status, json: async () => ({}), arrayBuffer: async () => buf };
    }
    return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
  };
}

function newProjectRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "t13-polyhaven-"));
}

// Minimal stored (uncompressed) zip writer so texture intake is exercised end to end.
function crc32(data: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < data.length; i++) {
    c ^= data[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function buildStoredZip(files: Record<string, Uint8Array>): Uint8Array {
  const enc = new TextEncoder();
  const u16 = (v: number) => [v & 255, (v >>> 8) & 255];
  const u32 = (v: number) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const local = new Uint8Array([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0), ...nameBytes]);
    parts.push(local, data);
    central.push(new Uint8Array([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...nameBytes]));
    offset += local.length + data.length;
  }
  const centralBytes = central.flatMap(c => Array.from(c));
  const eocd = new Uint8Array([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(Object.keys(files).length), ...u16(Object.keys(files).length), ...u32(centralBytes.length), ...u32(offset), ...u16(0)]);
  return new Uint8Array([...parts.flatMap(p => Array.from(p)), ...centralBytes, ...eocd]);
}

describe("Poly Haven CC0 source adapter (T13, REQ-ASSET-003, REQ-ASSET-005, REQ-SAFE-002, REQ-SEC-002)", () => {
  it("intakes a live-shape resolution-nested glTF scene bundle with included textures", async () => {
    const projectRoot = newProjectRoot();
    const scene = new Uint8Array([0x7b, 0x7d]); // {}
    const tex = new Uint8Array([1, 2, 3, 4]);
    const fetcher: (url: string) => Promise<HttpResponse> = async (url) => {
      if (url.endsWith("/info/wallkit")) return { ok: true, status: 200, json: async () => INFO, arrayBuffer: async () => new ArrayBuffer(0) };
      if (url.endsWith("/files/wallkit")) return { ok: true, status: 200, json: async () => ({ gltf: { "2k": { gltf: { url: "https://dl.polyhaven.org/wallkit_2k.gltf", include: { "textures/wallkit_diff_2k.jpg": { url: "https://dl.polyhaven.org/wallkit_diff_2k.jpg" } } } } } }), arrayBuffer: async () => new ArrayBuffer(0) };
      if (url.endsWith("wallkit_2k.gltf")) return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => scene.buffer.slice(scene.byteOffset, scene.byteOffset + scene.byteLength) };
      if (url.endsWith("wallkit_diff_2k.jpg")) return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => tex.buffer.slice(tex.byteOffset, tex.byteOffset + tex.byteLength) };
      return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    };
    const source = new PolyHavenAssetSource({ fetcher, now: () => "2026-09-19T00:00:00Z" });
    const result = await source.intakeAsset("wallkit", { role: "environment", projectRoot });
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.data.asset_record.runtime_representation).toBe("glTF scene bundle");
    expect(result.data.files.length).toBe(2);
    expect(result.data.files.some(f => f.path.endsWith("wallkit_2k.gltf"))).toBe(true);
    expect(result.data.files.some(f => f.path.endsWith("textures/wallkit_diff_2k.jpg"))).toBe(true);
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it("intakes a PBR texture set from per-map resolution zips and reports the texture set", async () => {
    const projectRoot = newProjectRoot();
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    // Each map's zip contains only its own map at several resolutions, matching
    // the real per-map zips; non-preferred resolutions must be ignored.
    const zipFor = (map: string) => buildStoredZip({
      [`concrete_${map}_1k.jpg`]: jpg,
      [`concrete_${map}_2k.png`]: jpg,
    });
    const fetcher: (url: string) => Promise<HttpResponse> = async (url) => {
      if (url.endsWith("/info/concrete_worn")) return { ok: true, status: 200, json: async () => INFO, arrayBuffer: async () => new ArrayBuffer(0) };
      if (url.endsWith("/files/concrete_worn")) return { ok: true, status: 200, json: async () => ({ diff: { "1k": { zip: { url: "https://dl.polyhaven.org/cd.zip" } }, "2k": { zip: { url: "https://dl.polyhaven.org/cd2.zip" } } }, nor_gl: { "1k": { zip: { url: "https://dl.polyhaven.org/cn.zip" } } }, arm: { "1k": { zip: { url: "https://dl.polyhaven.org/ca.zip" } } } }), arrayBuffer: async () => new ArrayBuffer(0) };
      for (const [map, suffix] of [["diff", "cd"], ["nor_gl", "cn"], ["arm", "ca"]] as const) {
        if (url.endsWith(`/${suffix}.zip`)) {
          const z = zipFor(map);
          return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => z.buffer.slice(z.byteOffset, z.byteLength) };
        }
      }
      if (url.endsWith(".zip")) return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
      return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    };
    const source = new PolyHavenAssetSource({ fetcher, now: () => "2026-09-19T00:00:00Z" });
    const result = await source.intakeAsset("concrete_worn", { role: "environment", projectRoot, textureResolution: "1k" });
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.data.asset_record.runtime_representation).toBe("Texture set (JPG: diff,nor_gl,arm)");
    expect(result.data.texture_set?.albedo).toContain("concrete_diff_1k.jpg");
    expect(result.data.texture_set?.normal).toContain("concrete_nor_gl_1k.jpg");
    expect(result.data.texture_set?.arm).toContain("concrete_arm_1k.jpg");
    // Zips are intermediates: only extracted images are retained.
    expect(result.data.files.every(f => !f.path.endsWith(".zip"))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, result.data.texture_set!.albedo))).toBe(true);
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it("intakes an asset with full CC0 provenance capture and writes it into the project tree", async () => {
    const projectRoot = newProjectRoot();
    const source = new PolyHavenAssetSource({ fetcher: fixtureFetcher(), now: () => "2026-09-15T00:00:00Z" });
    const result = await source.intakeAsset("barrel", { role: "prop_crate", projectRoot });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;

    const record = result.data.asset_record;
    expect(record.id).toBe("polyhaven-barrel");
    expect(record.origin).toBe("cc0");
    expect(record.construction_route).toBe("asset.source/asset.polyhaven");
    expect(record.source_provenance.uri).toBe("https://polyhaven.com/a/barrel");
    expect(record.source_provenance.license).toBe("CC0");
    expect(record.source_provenance.author).toBe("Poly Haven");
    expect(record.source_provenance.retrieved_at).toBe("2026-09-15T00:00:00Z");
    expect(record.source_provenance.sha256).toBe(GLB_SHA256);
    expect(record.acceptance_state).toBe("pending"); // acceptance is the registry's decision, not the source's

    const written = path.join(projectRoot, "assets", "sources", "polyhaven", "barrel", "barrel.glb");
    expect(fs.existsSync(written)).toBe(true);
    const onDisk = new Uint8Array(fs.readFileSync(written));
    expect(crypto.createHash("sha256").update(onDisk).digest("hex")).toBe(GLB_SHA256);
    expect(result.data.files[0]?.sha256).toBe(GLB_SHA256);
  });

  it("degrades to a typed blocked result when the network is unavailable (REQ-SAFE-002)", async () => {
    const projectRoot = newProjectRoot();
    const source = new PolyHavenAssetSource({ fetcher: fixtureFetcher({ fail: true }) });
    const result = await source.intakeAsset("barrel", { role: "prop_crate", projectRoot });

    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect(result.code).toBe("NETWORK_UNAVAILABLE");
      expect(result.detail).toContain("ENOTFOUND");
    }
    // Failure did not write anything into the project.
    expect(fs.existsSync(path.join(projectRoot, "assets", "sources", "polyhaven", "barrel"))).toBe(false);
  });

  it("blocks scoped for missing assets and remote errors", async () => {
    const projectRoot = newProjectRoot();
    const source = new PolyHavenAssetSource({ fetcher: fixtureFetcher() });
    const missing = await source.intakeAsset("does-not-exist", { role: "prop", projectRoot });
    expect(missing.status).toBe("blocked");
    if (missing.status === "blocked") expect(missing.code).toBe("ASSET_NOT_FOUND");

    const serverError = new PolyHavenAssetSource({ fetcher: fixtureFetcher({ status: 500 }) });
    const errored = await serverError.intakeAsset("barrel", { role: "prop", projectRoot });
    expect(errored.status).toBe("blocked");
    if (errored.status === "blocked") expect(errored.code).toBe("REMOTE_ERROR");
  });

  it("rejects traversal paths and unsafe file types before any write (REQ-SEC-002)", () => {
    const projectRoot = newProjectRoot();
    expect(() => safeIntakePath(projectRoot, "../../escape", "evil.glb")).toThrow(PolyHavenPathError);
    expect(() => safeIntakePath(projectRoot, "asset-id", "payload.sh")).toThrow(/Unsafe file type/);
    expect(() => safeIntakePath(projectRoot, "asset-id", "payload.exe")).toThrow(PolyHavenPathError);
    const ok = safeIntakePath(projectRoot, "barrel", "barrel.glb");
    expect(ok.startsWith(path.resolve(projectRoot, "assets", "sources", "polyhaven"))).toBe(true);
  });

  it("never clobbers retained source bytes when an intake races an existing target", async () => {
    const projectRoot = newProjectRoot();
    const retainedPath = path.join(projectRoot, "assets", "sources", "polyhaven", "barrel", "barrel.glb");
    fs.mkdirSync(path.dirname(retainedPath), { recursive: true });
    fs.writeFileSync(retainedPath, new Uint8Array([9, 9, 9]));

    const source = new PolyHavenAssetSource({ fetcher: fixtureFetcher() });
    const result = await source.intakeAsset("barrel", { role: "prop_crate", projectRoot });
    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.code).toBe("SOURCE_EXISTS");
    expect(fs.readFileSync(retainedPath)).toEqual(Buffer.from([9, 9, 9]));
  });

  it("hands the produced record to the registry where acceptance gates decide", async () => {
    const projectRoot = newProjectRoot();
    const source = new PolyHavenAssetSource({ fetcher: fixtureFetcher(), now: () => "2026-09-15T00:00:00Z" });
    const result = await source.intakeAsset("barrel", { role: "prop_crate", projectRoot });
    expect(result.status).toBe("success");
    if (result.status !== "success") return;

    const registry = new AssetRegistry("/tmp/nonexistent-project", {
      manifestPath: `/tmp/nonexistent-project/polyhaven-${Math.random().toString(36).slice(2)}.json`,
    });
    registry.intake(result.data.asset_record);

    // Without budget evidence the crate cannot be accepted (collider policy required for props).
    const strict = registry.accept("polyhaven-barrel");
    expect(strict.state).toBe("rejected");

    // Complete the required runtime evidence, then acceptance succeeds.
    const completed = { ...result.data.asset_record };
    completed.collider_policy = "mesh-exact";
    completed.lod_policy = "2-step";
    completed.budget = { max_triangles: 8000, measured_triangles: 4210 };
    const registry2 = new AssetRegistry("/tmp/nonexistent-project", {
      manifestPath: `/tmp/nonexistent-project/polyhaven2-${Math.random().toString(36).slice(2)}.json`,
    });
    registry2.intake(completed);
    const accepted = registry2.accept("polyhaven-barrel");
    expect(accepted.state).toBe("accepted");
    expect(accepted.report.production_acceptable).toBe(true);
  });
});
