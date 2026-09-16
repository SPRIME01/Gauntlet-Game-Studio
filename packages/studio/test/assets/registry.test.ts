import { describe, it, expect } from "bun:test";
import { AssetRegistry, AssetRegistryError } from "../../src/assets/registry";
import {
  DEFAULT_ASSET_POLICY,
  evaluateAsset,
  isAcceptableLicense,
  validateProvenanceIntake,
} from "../../src/assets/gates";
import type { AssetRecord } from "@gauntlet/contracts";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

function validAsset(overrides: Partial<AssetRecord> = {}): AssetRecord {
  return {
    id: "test-asset",
    role: "background_tree",
    origin: "cc0",
    construction_route: "asset.source/asset.polyhaven",
    source_provenance: {
      uri: "https://polyhaven.com/a/test-asset",
      license: "CC0",
      author: "Poly Haven",
      sha256: SHA_A,
      retrieved_at: "2026-09-15T00:00:00Z",
    },
    runtime_representation: "GLB/glTF",
    budget: {},
    acceptance_state: "pending",
    ...overrides,
  };
}

function freshRegistry(): AssetRegistry {
  return new AssetRegistry("/tmp/nonexistent-project", {
    manifestPath: `/tmp/nonexistent-project/manifest-${Math.random().toString(36).slice(2)}.json`,
  });
}

describe("Asset Registry, Provenance Gates & Acceptance History (T13)", () => {
  describe("Provenance/license/source-hash intake per origin class (REQ-ASSET-003, REQ-SEC-004)", () => {
    it("accepts a fully provenanced CC0 intake into pending state with an intake event", () => {
      const registry = freshRegistry();
      const outcome = registry.intake(validAsset());
      expect(outcome.state).toBe("pending");
      expect(outcome.provenance_violations).toHaveLength(0);
      expect(registry.records).toHaveLength(1);
      expect(registry.history[0]?.kind).toBe("intake");
    });

    it("requires uri/license/hash for external cc0 and licensed origins", () => {
      for (const origin of ["cc0", "licensed"] as const) {
        const violations = validateProvenanceIntake(origin, {});
        const requirements = violations.map((v) => v.requirement);
        expect(requirements).toContain("license");
        expect(requirements).toContain("source_uri");
        expect(requirements).toContain("author");
        expect(requirements).toContain("retrieval_metadata");
        expect(requirements).toContain("source_hash");
      }
    });

    it("requires user assets to carry the supplied reference and distinguishable authorization", () => {
      const ok = validateProvenanceIntake("user", { uri: "user://reference.png", license: "user-authorized", sha256: SHA_A });
      expect(ok).toHaveLength(0);
      const noUri = validateProvenanceIntake("user", { license: "user-authorized", sha256: SHA_A });
      expect(noUri.map((v) => v.requirement)).toContain("source_uri");
    });

    it("records generated/blender/procedural assets as derived with route + hash evidence", () => {
      for (const origin of ["generated", "blender", "procedural"] as const) {
        const violations = validateProvenanceIntake(origin, { license: "in-house-generated", sha256: SHA_A });
        expect(violations).toHaveLength(0);
        const noHash = validateProvenanceIntake(origin, { license: "in-house-generated" });
        expect(noHash.map((v) => v.requirement)).toContain("source_hash");
      }
    });

    it("blocks unknown and unacceptable license states at intake instead of dropping or accepting them", () => {
      for (const license of ["unknown", "see-website", "some-eula", undefined]) {
        const registry = freshRegistry();
        const outcome = registry.intake(validAsset({ id: "bad-license", source_provenance: { sha256: SHA_A, license: license as string | undefined } }));
        expect(outcome.state).toBe("blocked");
        expect(outcome.provenance_violations.join(" ")).toContain("license");
      }
    });

    it("validates sha256 hash format strictly", () => {
      const complete = { uri: "https://example.com/a", license: "CC0", author: "A", retrieved_at: "2026-09-15T00:00:00Z" };
      expect(validateProvenanceIntake("cc0", { ...complete, sha256: "not-a-hash" }).map((v) => v.requirement)).toContain("source_hash");
      expect(validateProvenanceIntake("cc0", { ...complete, sha256: SHA_A.toUpperCase() })).toHaveLength(0);
    });

    it("recognizes only allow-listed licenses per origin", () => {
      expect(isAcceptableLicense("cc0", "CC0")).toBe(true);
      expect(isAcceptableLicense("user", "user-authorized")).toBe(true);
      expect(isAcceptableLicense("generated", "in-house-generated")).toBe(true);
      expect(isAcceptableLicense("licensed", "CC-BY-4.0")).toBe(true);
      expect(isAcceptableLicense("cc0", "unknown")).toBe(false);
      expect(isAcceptableLicense("cc0", undefined)).toBe(false);
      expect(isAcceptableLicense("cc0", "")).toBe(false);
    });

    it("refuses intake into an accepted state with invalid provenance", () => {
      const registry = freshRegistry();
      expect(() =>
        registry.intake(validAsset({ acceptance_state: "accepted", source_provenance: { sha256: SHA_A, license: "unknown" } }))
      ).toThrow(AssetRegistryError);
    });

    it("rejects duplicate ids and contract-invalid records", () => {
      const registry = freshRegistry();
      registry.intake(validAsset());
      expect(() => registry.intake(validAsset())).toThrow(AssetRegistryError);
      expect(() => registry.intake({ id: "BAD ID" })).toThrow(AssetRegistryError);
    });
  });

  describe("Acceptance state machine and project gates (REQ-OUT-002, REQ-ASSET-006)", () => {
    it("accepts a fully compliant asset and records the accept event", () => {
      const registry = freshRegistry();
      registry.intake(validAsset());
      const outcome = registry.accept("test-asset");
      expect(outcome.state).toBe("accepted");
      expect(outcome.report.production_acceptable).toBe(true);
      expect(registry.get("test-asset")?.acceptance_state).toBe("accepted");
      expect(registry.history.map((e) => e.kind)).toEqual(["intake", "accept"]);
    });

    it("requires collider policy for roles that need it", () => {
      const report = evaluateAsset(validAsset({ role: "hero_vehicle" }), { policy: DEFAULT_ASSET_POLICY });
      expect(report.blockers.map((b) => b.gate)).toContain("collider_policy");
    });

    it("requires LOD policy for roles that need it", () => {
      const report = evaluateAsset(validAsset({ role: "environment_cliff", collider_policy: "mesh-exact" }), { policy: DEFAULT_ASSET_POLICY });
      expect(report.blockers.map((b) => b.gate)).toContain("lod_policy");
    });

    it("rejects an over-budget asset and an unmeasured budget limit", () => {
      const registry = freshRegistry();
      registry.intake(validAsset({ id: "over-budget", budget: { max_triangles: 5000, measured_triangles: 9000 } }));
      const outcome = registry.accept("over-budget");
      expect(outcome.state).toBe("rejected");
      expect(registry.get("over-budget")?.acceptance_state).toBe("rejected");
      expect(registry.history.at(-1)?.kind).toBe("reject");

      const registry2 = freshRegistry();
      registry2.intake(validAsset({ id: "unmeasured", budget: { max_triangles: 5000 } }));
      const outcome2 = registry2.accept("unmeasured");
      expect(outcome2.state).toBe("rejected");
      expect(outcome2.report.blockers[0]?.detail).toContain("no 'measured_triangles' measurement");
    });

    it("accepts assets within measured budget", () => {
      const registry = freshRegistry();
      registry.intake(validAsset({ budget: { max_triangles: 5000, measured_triangles: 3120 } }));
      const outcome = registry.accept("test-asset");
      expect(outcome.state).toBe("accepted");
    });

    it("blocks KTX2-required assets without toktx preflight evidence and accepts with it", () => {
      const registry = freshRegistry();
      registry.intake(
        validAsset({ id: "ktx2-nopreflight", budget: { required_texture_format: "ktx2", texture_format: "webp" } })
      );
      const outcome = registry.accept("ktx2-nopreflight");
      expect(outcome.state).toBe("blocked");
      expect(outcome.report.blockers[0]?.status).toBe("blocked");
      expect(outcome.report.blockers[0]?.detail).toContain("silent downgrade prohibited");

      const registry2 = freshRegistry();
      registry2.intake(
        validAsset({
          id: "ktx2-ok",
          budget: { required_texture_format: "ktx2", texture_format: "ktx2", toktx_preflight: "pass" },
        })
      );
      expect(registry2.accept("ktx2-ok").state).toBe("accepted");
    });

    it("requires portable baseline WebP when the profile demands it", () => {
      const ok = evaluateAsset(validAsset({ budget: { required_texture_format: "webp", texture_format: "webp" } }));
      expect(ok.blockers).toHaveLength(0);
      const bad = evaluateAsset(validAsset({ budget: { required_texture_format: "webp", texture_format: "jpeg" } }));
      expect(bad.blockers.map((b) => b.gate)).toContain("texture_format");
    });
  });

  describe("Reference-only imagery stays a distinct provenance class (REQ-ASSET-004)", () => {
    it("registers references separately and never allows their production acceptance", () => {
      const registry = freshRegistry();
      registry.registerReference({ id: "ref-shot-01", uri: "user://photo01.jpg", retrieved_at: "2026-09-15T00:00:00Z" });
      expect(registry.isReferenceOnly("ref-shot-01")).toBe(true);
      expect(() => registry.intake(validAsset({ id: "ref-shot-01" }))).toThrow(AssetRegistryError);

      const report = evaluateAsset(validAsset({ id: "ref-shot-01" }), { referenceOnly: true });
      expect(report.blockers[0]?.gate).toBe("reference_only");
      expect(report.production_acceptable).toBe(false);
    });

    it("keeps the reference list distinct from records", () => {
      const registry = freshRegistry();
      registry.registerReference({ id: "ref-shot-02", uri: "user://photo02.jpg" });
      registry.intake(validAsset());
      expect(registry.references).toHaveLength(1);
      expect(registry.records).toHaveLength(1);
      expect(registry.records[0]?.id).not.toBe(registry.references[0]?.id);
    });
  });

  describe("Append-only rejection/supersession history (REQ-ASSET-007)", () => {
    it("preserves the full accept->supersede->replace chain reconstructably", () => {
      const registry = freshRegistry();
      registry.intake(validAsset({ id: "tree-v1" }));
      registry.accept("tree-v1");
      const { next } = registry.supersede("tree-v1", validAsset({ id: "tree-v2" }), "higher-poly budget freed");
      expect(next.id).toBe("tree-v2");

      expect(registry.get("tree-v1")?.acceptance_state).toBe("rejected");
      expect(registry.get("tree-v2")?.acceptance_state).toBe("pending");
      const events = registry.history;
      expect(events.map((e) => e.kind)).toEqual(["intake", "accept", "intake", "supersede", "reject"]);
      const supersedeEvent = events.find((e) => e.kind === "supersede");
      expect(supersedeEvent?.data?.["superseded_by"]).toBe("tree-v2");
      expect(events.find((e) => e.kind === "reject")?.reason).toContain("superseded_by:tree-v2");
      // why v1 was accepted remains reconstructable
      expect(events.find((e) => e.kind === "accept")?.asset_id).toBe("tree-v1");
    });

    it("refuses a successor that failed provenance intake", () => {
      const registry = freshRegistry();
      registry.intake(validAsset({ id: "old-asset" }));
      expect(() =>
        registry.supersede("old-asset", validAsset({ id: "new-asset", source_provenance: { sha256: SHA_B, license: "unknown" } }))
      ).toThrow(AssetRegistryError);
    });

    it("appends history monotonically with no truncation surface", () => {
      const registry = freshRegistry();
      registry.intake(validAsset({ id: "a" }));
      registry.reject("a", "welding artifacts");
      registry.intake(validAsset({ id: "b" }));
      expect(registry.history.map((e) => e.seq)).toEqual([0, 1, 2]);
      expect(registry.records.map((r) => r.id).sort()).toEqual(["a", "b"]);
      expect(registry.records.find((r) => r.id === "a")?.acceptance_state).toBe("rejected");
    });
  });

  describe("Release/asset checks (verifyAll)", () => {
    it("passes clean pending + accepted assets and totals accurately", () => {
      const registry = freshRegistry();
      registry.intake(validAsset({ id: "accepted-one", budget: { max_draw_calls: 4, measured_draw_calls: 2 } }));
      registry.accept("accepted-one");
      registry.intake(validAsset({ id: "pending-one" }));
      const report = registry.verifyAll();
      expect(report.status).toBe("success");
      expect(report.totals).toEqual({ total: 2, accepted: 1, degraded: 0, pending: 1, rejected: 0, blocked: 0, not_acceptable: 0 });
    });

    it("fails when any asset is blocked, rejected, or breaks current gates", () => {
      const registry = freshRegistry();
      registry.intake(validAsset({ id: "bad-license", source_provenance: { sha256: SHA_A, license: "unknown" } }));
      let report = registry.verifyAll();
      expect(report.status).toBe("failed");
      expect(report.totals.not_acceptable).toBe(1);

      registry.intake(validAsset({ id: "rejected-one" }));
      registry.reject("rejected-one", "wrong scale");
      report = registry.verifyAll();
      expect(report.status).toBe("failed");
      expect(report.totals.not_acceptable).toBe(2);
    });

    it("counts explicit-waiver degraded assets as production-acceptable but visible", () => {
      const registry = freshRegistry();
      registry.intake(validAsset({ id: "waived", budget: { max_draw_calls: 4, measured_draw_calls: 9 } }));
      const outcome = registry.accept("waived", {
        waiver: { gate: "budget", reason: "skybox atlas fits shared pass", author: "studio-lead" },
      });
      expect(outcome.state).toBe("degraded");
      expect(outcome.waiver_applied).toBe(true);
      const report = registry.verifyAll();
      expect(report.status).toBe("success");
      expect(report.totals.degraded).toBe(1);
      expect(report.assets.find((a) => a.asset_id === "waived")?.blockers).toHaveLength(0);
    });

    it("does not extend waivers to non-budget gate failures", () => {
      const registry = freshRegistry();
      registry.intake(validAsset({ id: "provenance-broken", source_provenance: { sha256: SHA_A, license: "unknown" } }));
      const outcome = registry.accept("provenance-broken", {
        waiver: { gate: "budget", reason: "irrelevant", author: "studio-lead" },
      });
      expect(outcome.state).toBe("blocked");
      expect(outcome.waiver_applied).toBe(false);
    });
  });

  describe("Storage: atomic save/load and corruption safety (REQ-SAFE-001)", () => {
    it("round-trips manifest + history + references through save/load", () => {
      const dir = `/tmp/t13-registry-${Math.random().toString(36).slice(2)}`;
      const registry = new AssetRegistry(dir);
      registry.load();
      registry.intake(validAsset({ budget: { max_triangles: 100, measured_triangles: 50 } }));
      registry.accept("test-asset");
      registry.registerReference({ id: "ref-1", uri: "user://x.png" });
      registry.save();

      const reloaded = new AssetRegistry(dir);
      reloaded.load();
      expect(reloaded.get("test-asset")?.acceptance_state).toBe("accepted");
      expect(reloaded.history.map((e) => e.kind)).toEqual(["intake", "accept", "reference"]);
      expect(reloaded.references).toHaveLength(1);
    });

    it("loads template-style manifests with records only", () => {
      const dir = `/tmp/t13-registry-${Math.random().toString(36).slice(2)}`;
      require("node:fs").mkdirSync(`${dir}/assets`, { recursive: true });
      require("node:fs").writeFileSync(
        `${dir}/assets/manifest.json`,
        JSON.stringify({ schema: "gauntlet.asset.manifest", schema_version: "1.0", records: [] })
      );
      const registry = new AssetRegistry(dir);
      registry.load();
      expect(registry.records).toHaveLength(0);
      registry.intake(validAsset());
      registry.save();
      expect(new AssetRegistry(dir).exists()).toBe(true);
    });

    it("refuses to save before load and detects corrupt manifests", () => {
      const dir = `/tmp/t13-registry-${Math.random().toString(36).slice(2)}`;
      const registry = new AssetRegistry(dir);
      expect(() => registry.save()).toThrow(AssetRegistryError);
      require("node:fs").mkdirSync(`${dir}/assets`, { recursive: true });
      require("node:fs").writeFileSync(`${dir}/assets/manifest.json`, "{not json");
      expect(() => new AssetRegistry(dir).load()).toThrow(/not valid JSON/);
    });

    it("leaves no temp file behind after atomic save", () => {
      const dir = `/tmp/t13-registry-${Math.random().toString(36).slice(2)}`;
      const registry = new AssetRegistry(dir);
      registry.load();
      registry.intake(validAsset());
      registry.save();
      const fs = require("node:fs");
      expect(fs.existsSync(`${dir}/assets/manifest.json`)).toBe(true);
      expect(fs.existsSync(`${dir}/assets/manifest.json.tmp`)).toBe(false);
    });
  });
});
