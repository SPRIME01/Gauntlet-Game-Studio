import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderAcquireOutcome, ProviderMatch, ProviderSearchOutcome } from "../../src/assets/resolve";
import { AssetResolver } from "../../src/assets/resolve";
import { ReservoirStore } from "../../src/resources/reservoir";
import { ResourceResolver, type ResourceMatch, type ResourceSourceProvider } from "../../src/resources/resolver";
import { recordCreationException, listCreationExceptions, exceptionsPathFor } from "../../src/resources/exceptions";
import { isAssetKind } from "../../src/resources/resolver";

function tmpProject(): string {
  const root = mkdtempSync(join(tmpdir(), "gauntlet-resources-"));
  return root;
}

function writeAcceptedProjectAsset(root: string, id: string): void {
  mkdirSync(join(root, "assets"), { recursive: true });
  writeFileSync(join(root, "assets", "manifest.json"), JSON.stringify({
    schema: "gauntlet.asset.manifest",
    schema_version: "1.0",
    records: [
      {
        id,
        role: "prop",
        origin: "project",
        construction_route: "project/authored",
        source_provenance: { uri: "project://authored", license: "project-owned", sha256: "a".repeat(64) },
        runtime_representation: "glb",
        budget: {},
        acceptance_state: "accepted",
        built_from: 1,
        reads: ["identity"],
      },
    ],
  }));
}

/** Asset-kind provider spy: records every search so we can prove cheaper routes win. */
function makeAssetProviderSpy(): { provider: import("../../src/assets/resolve").AssetSourceProvider; calls: () => number } {
  let searchCalls = 0;
  const provider = {
    id: "spy-asset-source",
    async search(_keywords: string[], _role: string): Promise<ProviderSearchOutcome> {
      searchCalls += 1;
      return {
        status: "success",
        matches: [
          {
            provider: "spy-asset-source",
            assetId: "spy-robot",
            title: "Spy Robot",
            license: "cc0",
            sourceUri: "https://example.org/robot.glb",
            metadata: { polycount: 1000 },
          } satisfies ProviderMatch,
        ],
      };
    },
    async acquire(): Promise<ProviderAcquireOutcome> {
      return { status: "success", assetRecord: {} };
    },
  };
  return { provider, calls: () => searchCalls };
}

interface RecordingResourceProvider extends ResourceSourceProvider {
  searched: number;
}

function makeResourceProvider(id: string, stage: ResourceMatch["stage"], license: string | null): RecordingResourceProvider {
  const provider: RecordingResourceProvider = {
    id,
    kinds: ["audio", "mesh", "animation", "code"],
    stage,
    searched: 0,
    async search(request): Promise<ResourceMatch[]> {
      provider.searched += 1;
      return [
        {
          provider: id,
          stage,
          assetId: `${id}-${request.requested_id}`,
          title: `${id} match`,
          license,
          sourceUri: `https://example.org/${id}`,
          metadata: {},
        },
      ];
    },
    async acquire(match): Promise<{ assetId: string; detail: string }> {
      return { assetId: match.assetId, detail: `acquired from ${id}` };
    },
  };
  return provider;
}

function makeAssetResolver(providers: import("../../src/assets/resolve").AssetSourceProvider[]): AssetResolver {
  return new AssetResolver({ providers, now: () => "2026-10-04T00:00:00Z" });
}

describe("resource contracts", () => {
  test("cascade stages are ordered cheapest first", () => {
    expect(isAssetKind("mesh")).toBe(true);
    expect(isAssetKind("animation")).toBe(false);
  });
});

describe("TEETH-T30-001: cheapest route wins across project, reservoir, and providers", () => {
  test("accepted project asset (R0) wins and providers are untouched", async () => {
    const root = tmpProject();
    writeAcceptedProjectAsset(root, "robot");
    const spy = makeAssetProviderSpy();
    const resourceProvider = makeResourceProvider("free-audio", "acquire", "cc0");
    const resolver = new ResourceResolver({
      providers: [resourceProvider],
      assetResolver: makeAssetResolver([spy.provider]),
      now: () => new Date("2026-10-04T00:00:00Z"),
    });

    const result = await resolver.resolve(
      { requested_id: "robot", kind: "mesh", role: "prop", keywords: ["robot"] },
      root,
    );
    expect(result.status).toBe("resolved");
    expect(result.route).toBe("reuse-accepted");
    expect(spy.calls()).toBe(0);
    expect(resourceProvider.searched).toBe(0);
    const record = JSON.parse(readFileSync(`${root}/.studio/resolutions/resource-robot.1760000000000.json`.replace("1760000000000", String(Date.parse("2026-10-04T00:00:00Z"))), "utf8"));
    expect(record.chosen_route).toBe("reuse-accepted");
    rmSync(root, { recursive: true, force: true });
  });

  test("reservoir (R1) beats available acquire providers (R2+)", async () => {
    const root = tmpProject();
    const reservoir = new ReservoirStore(join(root, "reservoir"));
    reservoir.put({
      id: "alarm-loop",
      kind: "audio",
      source: { license: "cc0", uri: "https://example.org/alarm" },
      content: "RIFF",
      filename: "alarm.wav",
      format: "wav",
    });
    reservoir.markAccepted("alarm-loop");
    const provider = makeResourceProvider("free-audio", "acquire", "cc0");
    const resolver = new ResourceResolver({ providers: [provider], reservoir, now: () => new Date("2026-10-04T00:00:00Z") });
    const result = await resolver.resolve({ requested_id: "alarm-loop", kind: "audio" }, root);
    expect(result.route).toBe("reuse-reservoir");
    expect(provider.searched).toBe(0);
    rmSync(root, { recursive: true, force: true });
  });

  test("cheaper provider stage beats costlier stage", async () => {
    const root = tmpProject();
    const acquireProvider = makeResourceProvider("free-audio", "acquire", "cc0");
    const proceduralProvider = makeResourceProvider("procedural-audio", "procedural", "mit");
    const resolver = new ResourceResolver({
      providers: [proceduralProvider, acquireProvider],
      now: () => new Date("2026-10-04T00:00:00Z"),
    });
    const result = await resolver.resolve({ requested_id: "alarm-loop", kind: "audio" }, root);
    expect(result.route).toBe("acquire");
    expect(proceduralProvider.searched).toBe(0);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("TEETH-T30-002: license evidence gates intake", () => {
  test("provider match without license evidence is typed-rejected before acceptance", async () => {
    const root = tmpProject();
    const provider = makeResourceProvider("shady-audio", "acquire", null);
    const resolver = new ResourceResolver({ providers: [provider], now: () => new Date("2026-10-04T00:00:00Z") });
    const result = await resolver.resolve({ requested_id: "alarm-loop", kind: "audio" }, root);
    expect(result.status).toBe("failed");
    expect(result.statusCode).toBe("PROVIDER_LICENSE_EVIDENCE_MISSING");
    const files = Array.from(new Bun.Glob("resource-*.json").scanSync({ cwd: join(root, ".studio", "resolutions") }));
    const record = JSON.parse(readFileSync(join(root, ".studio", "resolutions", files[0]), "utf8"));
    expect(record.decision).toBe("failed");
    expect(record.status_code).toBe("PROVIDER_LICENSE_EVIDENCE_MISSING");
    rmSync(root, { recursive: true, force: true });
  });

  test("unacceptable license is rejected", async () => {
    const root = tmpProject();
    const provider = makeResourceProvider("shady-audio", "acquire", "unknown");
    const resolver = new ResourceResolver({ providers: [provider], now: () => new Date("2026-10-04T00:00:00Z") });
    const result = await resolver.resolve({ requested_id: "alarm-loop", kind: "audio" }, root);
    expect(result.statusCode).toBe("LICENSE_MISMATCH");
    rmSync(root, { recursive: true, force: true });
  });
});

describe("TEETH-T30-003: scratch creation is a recorded exception, never a default", () => {
  test("scratch without a prior recorded exception is blocked", async () => {
    const root = tmpProject();
    const resolver = new ResourceResolver({ providers: [], now: () => new Date("2026-10-04T00:00:00Z") });
    const result = await resolver.resolve({ requested_id: "hero-rig", kind: "rig" }, root);
    expect(result.status).toBe("blocked");
    expect(result.statusCode).toBe("PROVIDERS_UNAVAILABLE");
    expect(result.attempts.some((a) => a.stage === "scratch" && a.outcome === "rejected")).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  test("recording an exception requires searched routes and failure reasons", () => {
    const root = tmpProject();
    expect(() =>
      recordCreationException(root, { id: "exc-1", what: "hero rig", routes_searched: [], why_failed: ["nothing"] }),
    ).toThrow(/must record the cheaper routes/);
    expect(() =>
      recordCreationException(root, { id: "exc-1", what: "hero rig", routes_searched: [{ stage: "acquire", target: "x", outcome: "unavailable", detail: "none" }], why_failed: [] }),
    ).toThrow(/must state why/);
    rmSync(root, { recursive: true, force: true });
  });

  test("scratch with a recorded exception resolves at R10 with full justification", async () => {
    const root = tmpProject();
    const exception = recordCreationException(root, {
      id: "exc-hero-rig",
      what: "quadruped hero rig with six tail joints",
      routes_searched: [
        { stage: "reuse-accepted", target: "hero-rig", outcome: "unavailable", detail: "no project rig" },
        { stage: "reuse-reservoir", target: "hero-rig", outcome: "unavailable", detail: "reservoir empty" },
        { stage: "acquire", target: "free-rig-sources", outcome: "unavailable", detail: "no permissive quadruped rig found" },
      ],
      why_failed: ["no permissive quadruped rig with tail dynamics exists", "composition cannot satisfy rig topology"],
      partial_reuse: ["standard-humanoid-bone-naming"],
      derivative_id: "hero-rig-v1",
    });
    expect(listCreationExceptions(root).length).toBe(1);
    const resolver = new ResourceResolver({ providers: [], now: () => new Date("2026-10-04T00:00:00Z") });
    const result = await resolver.resolve(
      { requested_id: "hero-rig", kind: "rig", creation_exception: exception },
      root,
    );
    expect(result.status).toBe("resolved");
    expect(result.route).toBe("scratch");
    const files = Array.from(new Bun.Glob("resource-*.json").scanSync({ cwd: join(root, ".studio", "resolutions") }));
    const record = JSON.parse(readFileSync(join(root, ".studio", "resolutions", files[0]), "utf8"));
    expect(record.chosen_route).toBe("scratch");
    expect(record.creation_exception.partial_reuse).toContain("standard-humanoid-bone-naming");
    rmSync(root, { recursive: true, force: true });
  });
});

describe("TEETH-T30-004: reservoir lineage and deduplication", () => {
  test("adapted derivative is discoverable with lineage and the original blob is not duplicated", () => {
    const root = tmpProject();
    const reservoir = new ReservoirStore(join(root, "reservoir"));
    const original = reservoir.put({
      id: "robot-raw",
      kind: "mesh",
      tags: ["robot", "mech"],
      source: { license: "cc0", uri: "https://example.org/robot.glb" },
      content: "RAW-GLB-BYTES",
      filename: "robot.glb",
      format: "glb",
    });
    expect(original.deduplicated).toBe(false);
    reservoir.markAccepted("robot-raw");

    const adapted = reservoir.put({
      id: "robot-normalized",
      kind: "mesh",
      tags: ["robot", "mech", "normalized"],
      source: { license: "cc0", uri: "reservoir://robot-raw" },
      content: "NORMALIZED-GLB-BYTES",
      filename: "robot-normalized.glb",
      format: "glb",
      derived_from: ["robot-raw"],
      metadata: { lods: 3, normalized: true },
    });

    // Fresh store context (next game) resolves the same reservoir.
    const fresh = new ReservoirStore(reservoir.root);
    const hits = fresh.search({ kind: "mesh", keywords: ["robot"] });
    expect(hits.map((h) => h.id)).toContain("robot-normalized");
    expect(hits.find((h) => h.id === "robot-normalized")?.derived_from).toEqual(["robot-raw"]);

    // Identical re-put does not duplicate the blob.
    const again = reservoir.put({
      id: "robot-raw",
      kind: "mesh",
      source: { license: "cc0", uri: "https://example.org/robot.glb" },
      content: "RAW-GLB-BYTES",
      filename: "robot.glb",
      format: "glb",
    });
    expect(again.deduplicated).toBe(true);
    const objectsRoot = join(reservoir.root, "objects");
    const blobDirs = Array.from(new Bun.Glob("*").scanSync({ cwd: objectsRoot, onlyFiles: false }));
    expect(blobDirs.length).toBe(2); // one per distinct content hash, not per put
    expect(existsSync(adapted.blobPath)).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  test("reservoir resolution path is found from a nested project", () => {
    const root = tmpProject();
    const reservoir = new ReservoirStore(join(root, "reservoir"));
    reservoir.put({ id: "x", kind: "font", source: { license: "mit" }, content: "font", filename: "x.ttf", format: "ttf" });
    mkdirSync(join(root, "games", "deep"), { recursive: true });
    const resolved = ReservoirStore.resolveFor(join(root, "games", "deep"));
    expect(resolved.root).toBe(reservoir.root);
    rmSync(root, { recursive: true, force: true });
  });

  test("resolution records are append-only with exclusive-create names", async () => {
    const root = tmpProject();
    const base = new Date("2026-10-04T00:00:00Z");
    const resolver = new ResourceResolver({ providers: [], now: () => base });
    await resolver.resolve({ requested_id: "mystery", kind: "shader" }, root);
    await resolver.resolve({ requested_id: "mystery", kind: "shader" }, root);
    const dir = join(root, ".studio", "resolutions");
    const files = Array.from(new Bun.Glob("resource-mystery.*.json").scanSync({ cwd: dir })).sort();
    expect(files.length).toBe(2);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("T30 correction round 1 — adversarial regression teeth", () => {
  test("H1: reservoir rejects unknown/unacceptable licenses at intake and acceptance", () => {
    const root = tmpProject();
    const reservoir = new ReservoirStore(join(root, "reservoir"));
    expect(() =>
      reservoir.put({ id: "nc-mesh", kind: "mesh", source: { license: "cc-by-nc-4.0" }, content: "x", filename: "a.glb", format: "glb" }),
    ).toThrow(/RESERVOIR_LICENSE_UNACCEPTABLE|unknown or not acceptable/);
    expect(() =>
      reservoir.put({ id: "unknown-mesh", kind: "mesh", source: { license: "unknown" }, content: "x", filename: "a.glb", format: "glb" }),
    ).toThrow(/RESERVOIR_LICENSE_UNACCEPTABLE/);
    // A record with an acceptable license can be accepted; the poisoned path is closed.
    reservoir.put({ id: "ok-mesh", kind: "mesh", source: { license: "cc0" }, content: "y", filename: "b.glb", format: "glb" });
    expect(reservoir.markAccepted("ok-mesh").accepted).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  test("H1b: resolver R1 hit re-examines license and require_license", async () => {
    const root = tmpProject();
    const reservoir = new ReservoirStore(join(root, "reservoir"));
    reservoir.put({ id: "robot-raw", kind: "mesh", source: { license: "cc0" }, content: "R", filename: "r.glb", format: "glb" });
    reservoir.markAccepted("robot-raw");
    const provider = makeResourceProvider("free-audio", "acquire", "cc0");
    // require_license mismatch on an accepted reservoir record keeps looking.
    const resolver = new ResourceResolver({ providers: [provider], reservoir, now: () => new Date("2026-10-04T00:00:00Z") });
    const mismatch = await resolver.resolve({ requested_id: "robot-raw", kind: "audio", require_license: "mit" }, root);
    expect(mismatch.status).toBe("blocked");
    rmSync(root, { recursive: true, force: true });
  });

  test("H2: providers declaring authority-bearing stages are clamped out of the cascade", async () => {
    const root = tmpProject();
    const scratchProvider = makeResourceProvider("sneaky", "scratch", "cc0");
    const reuseProvider = makeResourceProvider("sneaky-reuse", "reuse-accepted", "cc0");
    const resolver = new ResourceResolver({ providers: [scratchProvider, reuseProvider], now: () => new Date("2026-10-04T00:00:00Z") });
    const result = await resolver.resolve({ requested_id: "lonely", kind: "audio" }, root);
    expect(result.route).toBeUndefined(); // nothing satisfied: both providers were skipped
    expect(result.attempts.filter((a) => a.outcome === "skipped").length).toBe(2);
    expect(result.status).toBe("blocked");
    rmSync(root, { recursive: true, force: true });
  });

  test("H3: forged creation exceptions are validated and bound at the resolver boundary", async () => {
    const root = tmpProject();
    const resolver = new ResourceResolver({ providers: [], now: () => new Date("2026-10-04T00:00:00Z") });
    const forged = { id: "exc-forged", what: "nothing", routes_searched: [], why_failed: ["because"], provenance: {}, partial_reuse: [], recorded_at: "2026-10-04T00:00:00Z" };
    expect(() => resolver.resolve({ requested_id: "hero-rig", kind: "rig", creation_exception: forged as never }, root)).toThrow(/CREATION_EXCEPTION_INVALID/);
    // Borrowed exception (references a different id) is rejected too.
    const borrowed = { ...forged, routes_searched: [{ stage: "acquire", target: "x", outcome: "unavailable", detail: "none" }] };
    await expect(resolver.resolve({ requested_id: "hero-rig", kind: "rig", creation_exception: borrowed as never }, root)).rejects.toThrow(/does not reference requested id/);
    rmSync(root, { recursive: true, force: true });
  });

  test("H5: composite declaration alone never records satisfied", async () => {
    const root = tmpProject();
    const resolver = new ResourceResolver({ providers: [], now: () => new Date("2026-10-04T00:00:00Z") });
    const result = await resolver.resolve(
      { requested_id: "composite-thing", kind: "kit", composite_of: ["nonexistent-part"] },
      root,
    );
    const composite = result.attempts.find((a) => a.stage === "composite");
    expect(composite?.outcome).toBe("blocked");
    expect(composite?.detail).toContain("nonexistent-part");
    rmSync(root, { recursive: true, force: true });
  });

  test("H9: identical content under different filenames is deduplicated per content", () => {
    const root = tmpProject();
    const reservoir = new ReservoirStore(join(root, "reservoir"));
    const first = reservoir.put({ id: "a", kind: "texture", source: { license: "mit" }, content: "SAME", filename: "a.png", format: "png" });
    const second = reservoir.put({ id: "b", kind: "texture", source: { license: "mit" }, content: "SAME", filename: "b.png", format: "png" });
    expect(second.deduplicated).toBe(true);
    expect(first.blobPath).toBe(second.blobPath);
    rmSync(root, { recursive: true, force: true });
  });

  test("H4: asset-kind requests consult the reservoir before provider acquisition", async () => {
    const root = tmpProject();
    const reservoir = new ReservoirStore(join(root, "reservoir"));
    reservoir.put({ id: "reservoired-mesh", kind: "mesh", source: { license: "cc0" }, content: "M", filename: "m.glb", format: "glb" });
    reservoir.markAccepted("reservoired-mesh");
    const spy = makeAssetProviderSpy();
    const resolver = new ResourceResolver({
      providers: [],
      reservoir,
      assetResolver: makeAssetResolver([spy.provider]),
      now: () => new Date("2026-10-04T00:00:00Z"),
    });
    const result = await resolver.resolve({ requested_id: "reservoired-mesh", kind: "mesh", role: "prop", keywords: ["x"] }, root);
    expect(result.route).toBe("reuse-reservoir");
    expect(spy.calls()).toBeLessThanOrEqual(1); // only the reuse probe, no acquisition
    rmSync(root, { recursive: true, force: true });
  });
});
