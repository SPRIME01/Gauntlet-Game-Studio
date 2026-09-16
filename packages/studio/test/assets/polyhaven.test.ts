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

describe("Poly Haven CC0 source adapter (T13, REQ-ASSET-003, REQ-ASSET-005, REQ-SAFE-002, REQ-SEC-002)", () => {
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
