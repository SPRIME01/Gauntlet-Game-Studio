import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AssetResolver, type AssetSourceProvider, type ProviderMatch } from "../../src/assets/resolve";
import { AssetRegistry } from "../../src/assets/registry";

function tempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "studio-resolve-"));
}

function writeManifest(projectRoot: string, records: unknown[]): void {
  fs.mkdirSync(path.join(projectRoot, "assets"), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, "assets", "manifest.json"),
    JSON.stringify({ schema: "gauntlet.asset.manifest", schema_version: "1.0", records }, null, 2),
  );
}

function acceptedRecord(id: string): Record<string, unknown> {
  return {
    id,
    role: "prop",
    origin: "cc0",
    construction_route: "asset.source/asset.polyhaven",
    source_provenance: { uri: "https://polyhaven.com/a/" + id, license: "CC0", author: "Poly Haven", sha256: "a".repeat(64), retrieved_at: "2026-09-19T00:00:00Z" },
    runtime_representation: "GLB/glTF",
    acceptance_state: "accepted",
  };
}

function pendingRecord(id: string): Record<string, unknown> {
  return { ...acceptedRecord(id), acceptance_state: "pending" };
}

function match(overrides: Partial<ProviderMatch> = {}): ProviderMatch {
  return { provider: "fake", assetId: "barrel", title: "Barrel", license: null, sourceUri: "https://example.test/barrel", ...overrides };
}

function fakeProvider(overrides: {
  matches?: ProviderMatch[];
  unavailable?: string;
  acquire?: (match: ProviderMatch, role: string, projectRoot: string) => Promise<any>;
}): AssetSourceProvider {
  return {
    id: "fake",
    async search() {
      if (overrides.unavailable) return { status: "unavailable" as const, detail: overrides.unavailable };
      return { status: "success" as const, matches: overrides.matches ?? [] };
    },
    async acquire(m, role, projectRoot) {
      return overrides.acquire
        ? overrides.acquire(m, role, projectRoot)
        : { status: "success" as const, assetRecord: pendingRecord(m.assetId) };
    },
  };
}

const base = { role: "prop", keywords: ["barrel"] };

describe("asset.resolve routing policy (REQ-ASSET-008..012)", () => {
  it("routes provider matches through acquire with per-asset license evidence and an append-only decision", async () => {
    const projectRoot = tempProject();
    try {
      const resolver = new AssetResolver({ providers: [fakeProvider({ matches: [match()] })] });
      const result = await resolver.resolve({ ...base, requestedId: "barrel", projectRoot });
      expect(result.status).toBe("success");
      if (result.status !== "success") return;
      expect(result.result.route).toBe("acquire");
      expect(result.result.decision.reason).toContain("acquire");

      const registry = new AssetRegistry(projectRoot);
      registry.load();
      expect(registry.get("barrel")?.acceptance_state).toBe("pending");

      const resolutions = fs.readdirSync(path.join(projectRoot, ".studio", "resolutions"));
      expect(resolutions.length).toBe(1);
      const decision = JSON.parse(fs.readFileSync(path.join(projectRoot, ".studio", "resolutions", resolutions[0]), "utf-8"));
      expect(decision.schema).toBe("gauntlet.asset.resolution");
      expect(decision.decision.route).toBe("acquire");
      expect(decision.steps.some(s => s.step === "search" && s.target === "project-registry")).toBe(true);
      expect(decision.steps.some(s => s.step === "acquire" && s.provider === "fake")).toBe(true);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("acquire falls through to the next provider match when one candidate cannot be acquired", async () => {
    const projectRoot = tempProject();
    try {
      const calls: string[] = [];
      const resolver = new AssetResolver({
        providers: [
          fakeProvider({
            matches: [match({ assetId: "no-glb" }), match({ assetId: "good-barrel" })],
            acquire: async m => {
              calls.push(m.assetId);
              if (m.assetId === "no-glb") return { status: "failed" as const, code: "UNEXPECTED_PAYLOAD", detail: "no downloadable GLB" };
              return { status: "success" as const, assetRecord: pendingRecord(m.assetId) };
            },
          }),
        ],
      });
      const result = await resolver.resolve({ ...base, requestedId: "barrel", projectRoot });
      expect(result.status).toBe("success");
      if (result.status !== "success") return;
      expect(result.result.asset_id).toBe("good-barrel");
      expect(calls).toEqual(["no-glb", "good-barrel"]);
      const registry = new AssetRegistry(projectRoot);
      registry.load();
      expect(registry.get("good-barrel")?.acceptance_state).toBe("pending");
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("decisions are append-only: repeated resolutions create additional records and never overwrite", async () => {
    const projectRoot = tempProject();
    try {
      let tick = 0;
      const resolver = new AssetResolver({
        providers: [fakeProvider({ matches: [match()] })],
        now: () => new Date(Date.parse("2026-09-19T00:00:0" + tick++ + "Z")).toISOString(),
      });
      await resolver.resolve({ ...base, requestedId: "barrel", projectRoot });
      await resolver.resolve({ ...base, requestedId: "barrel", projectRoot });
      const resolutions = fs.readdirSync(path.join(projectRoot, ".studio", "resolutions"));
      expect(resolutions.length).toBe(2);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("acquired assets without per-asset license evidence are typed-rejected before intake", async () => {
    const projectRoot = tempProject();
    try {
      const badRecord: Record<string, unknown> = pendingRecord("barrel");
      delete (badRecord as any).source_provenance.license;
      const resolver = new AssetResolver({
        providers: [fakeProvider({ matches: [match()], acquire: async () => ({ status: "success" as const, assetRecord: badRecord }) })],
      });
      const result = await resolver.resolve({ ...base, requestedId: "barrel", projectRoot });
      expect(result.status).toBe("failed");
      if (result.status !== "failed") return;
      expect(result.diagnostics.code).toBe("PROVIDER_LICENSE_EVIDENCE_MISSING");

      const registry = new AssetRegistry(projectRoot);
      registry.load();
      expect(registry.get("barrel")).toBeUndefined();
      const resolutions = fs.readdirSync(path.join(projectRoot, ".studio", "resolutions"));
      const decision = JSON.parse(fs.readFileSync(path.join(projectRoot, ".studio", "resolutions", resolutions[0]), "utf-8"));
      expect(decision.steps.some(s => s.outcome === "rejected-license-evidence-missing")).toBe(true);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("declared license requirements that the acquired evidence fails are typed-rejected before intake", async () => {
    const projectRoot = tempProject();
    try {
      const byRecord = { ...pendingRecord("barrel"), source_provenance: { ...(pendingRecord("barrel") as any).source_provenance, license: "CC-BY" } };
      const resolver = new AssetResolver({
        providers: [fakeProvider({ matches: [match()], acquire: async () => ({ status: "success" as const, assetRecord: byRecord }) })],
      });
      const result = await resolver.resolve({ ...base, requestedId: "barrel", projectRoot, requireLicense: "CC0" });
      expect(result.status).toBe("failed");
      if (result.status !== "failed") return;
      expect(result.diagnostics.code).toBe("LICENSE_MISMATCH");
      const registry = new AssetRegistry(projectRoot);
      registry.load();
      expect(registry.get("barrel")).toBeUndefined();
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("no provider match yields a recorded create-fallback decision and never a fabricated asset", async () => {
    const projectRoot = tempProject();
    try {
      const resolver = new AssetResolver({ providers: [fakeProvider({ matches: [] })] });
      const result = await resolver.resolve({ ...base, requestedId: "who-knows", projectRoot });
      expect(result.status).toBe("blocked");
      if (result.status !== "blocked") return;
      expect(result.diagnostics.code).toBe("CREATE_FALLBACK_REQUIRED");
      expect(result.result.route).toBe("create");
      const registry = new AssetRegistry(projectRoot);
      registry.load();
      expect(registry.records.length).toBe(0);
      const resolutions = fs.readdirSync(path.join(projectRoot, ".studio", "resolutions"));
      const decision = JSON.parse(fs.readFileSync(path.join(projectRoot, ".studio", "resolutions", resolutions[0]), "utf-8"));
      expect(decision.decision.route).toBe("create-fallback");
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("all providers unavailable is typed blocked, not a create fallback", async () => {
    const projectRoot = tempProject();
    try {
      const resolver = new AssetResolver({ providers: [fakeProvider({ unavailable: "network down" })] });
      const result = await resolver.resolve({ ...base, requestedId: "barrel", projectRoot });
      expect(result.status).toBe("blocked");
      if (result.status !== "blocked") return;
      expect(result.diagnostics.code).toBe("PROVIDERS_UNAVAILABLE");
      expect(result.result.route).not.toBe("create");
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("an accepted project record routes reuse without touching providers", async () => {
    const projectRoot = tempProject();
    writeManifest(projectRoot, [acceptedRecord("barrel")]);
    try {
      let searched = 0;
      const resolver = new AssetResolver({
        providers: [
          {
            id: "fake",
            async search() {
              searched++;
              return { status: "success" as const, matches: [match()] };
            },
            async acquire() {
              throw new Error("must not acquire when reuse satisfies the request");
            },
          },
        ],
      });
      const result = await resolver.resolve({ ...base, requestedId: "barrel", projectRoot });
      expect(result.status).toBe("success");
      if (result.status !== "success") return;
      expect(result.result.route).toBe("reuse");
      expect(searched).toBe(0);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("a pending project record with no provider match routes adapt-required before create", async () => {
    const projectRoot = tempProject();
    writeManifest(projectRoot, [pendingRecord("barrel")]);
    try {
      const resolver = new AssetResolver({ providers: [fakeProvider({ matches: [] })] });
      const result = await resolver.resolve({ ...base, requestedId: "barrel", projectRoot });
      expect(result.status).toBe("blocked");
      if (result.status !== "blocked") return;
      expect(result.diagnostics.code).toBe("ADAPT_REQUIRED");
      expect(result.result.route).toBe("adapt");
      const resolutions = fs.readdirSync(path.join(projectRoot, ".studio", "resolutions"));
      const decision = JSON.parse(fs.readFileSync(path.join(projectRoot, ".studio", "resolutions", resolutions[0]), "utf-8"));
      expect(decision.decision.route).toBe("adapt");
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects malformed requests before any search or decision write", async () => {
    const projectRoot = tempProject();
    try {
      const resolver = new AssetResolver({ providers: [fakeProvider({ matches: [match()] })] });
      const badId = await resolver.resolve({ ...base, requestedId: "../bad", projectRoot });
      expect(badId.status).toBe("failed");
      expect((badId as any).diagnostics.code).toBe("REQUESTED_ID_INVALID");
      const noRole = await resolver.resolve({ ...base, role: "", requestedId: "barrel", projectRoot });
      expect(noRole.status).toBe("failed");
      expect((noRole as any).diagnostics.code).toBe("ROLE_REQUIRED");
      expect(fs.existsSync(path.join(projectRoot, ".studio", "resolutions"))).toBe(false);
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
