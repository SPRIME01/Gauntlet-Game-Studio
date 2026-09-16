import { describe, it, expect } from "bun:test";
import { AssetRegistry } from "../../src/assets/registry";
import type { AssetRecord } from "@gauntlet/contracts";

const SHA = "c".repeat(64);

function asset(overrides: Partial<AssetRecord> = {}): AssetRecord {
  return {
    id: "external-prop",
    role: "prop_crate",
    origin: "cc0",
    construction_route: "asset.source/asset.polyhaven",
    source_provenance: {
      uri: "https://polyhaven.com/a/external-prop",
      license: "CC0",
      author: "Poly Haven",
      sha256: SHA,
      retrieved_at: "2026-09-15T00:00:00Z",
    },
    runtime_representation: "GLB/glTF",
    budget: {},
    collider_policy: "mesh-exact",
    lod_policy: "2-step",
    acceptance_state: "pending",
    ...overrides,
  };
}

function freshRegistry(): AssetRegistry {
  return new AssetRegistry("/tmp/nonexistent-project", {
    manifestPath: `/tmp/nonexistent-project/teeth-${Math.random().toString(36).slice(2)}.json`,
  });
}

/**
 * T13 preregistered falsifiers (.agents/preregistrations/gauntlet-game-studio-plan-T13.prereg.yaml).
 * These tests ARE the teeth: if they pass while the underlying gates are removed,
 * the task claim is falsified.
 */
describe("T13 Teeth: no production acceptance without provenance and budget gates", () => {
  it("TEETH-T13-001: importing an asset with unknown/unacceptable license state blocks production acceptance", () => {
    const registry = freshRegistry();

    // The attack: import an asset claiming an unknown license.
    const outcome = registry.intake(
      asset({
        id: "mystery-asset",
        source_provenance: { uri: "https://unknown.example/mystery.glb", license: "unknown", sha256: SHA },
      })
    );

    // Production acceptance is blocked at intake, not silently dropped or accepted.
    expect(outcome.state).toBe("blocked");
    expect(registry.get("mystery-asset")?.acceptance_state).toBe("blocked");
    expect(outcome.provenance_violations.join(" ")).toContain("license");

    // Attempting acceptance anyway cannot promote it to production content.
    const acceptance = registry.accept("mystery-asset");
    expect(acceptance.state).toBe("blocked");
    expect(acceptance.report.production_acceptable).toBe(false);
    expect(registry.get("mystery-asset")?.acceptance_state).toBe("blocked");

    // The release check reports it as not production-acceptable.
    const report = registry.verifyAll();
    expect(report.status).toBe("failed");
    expect(report.totals.blocked).toBe(1);
    expect(report.totals.not_acceptable).toBe(1);

    // Evidence of the violation is preserved, not erased (REQ-ASSET-007).
    expect(registry.history.some((e) => e.kind === "block" && e.asset_id === "mystery-asset")).toBe(true);

    // An unacceptable-but-named license is blocked identically.
    const registry2 = freshRegistry();
    const outcome2 = registry2.intake(asset({ id: "shady-asset", source_provenance: { sha256: SHA, license: "you-must-buy-something" } }));
    expect(outcome2.state).toBe("blocked");
    expect(registry2.accept("shady-asset").report.production_acceptable).toBe(false);
  });

  it("TEETH-T13-002: an over-budget asset cannot be marked accepted solely because it looks correct", () => {
    const registry = freshRegistry();
    registry.intake(
      asset({
        id: "over-budget-prop",
        budget: { max_triangles: 5000, measured_triangles: 42000 },
      })
    );

    // The attack: accept it because it looks right. The budget gate must reject.
    const outcome = registry.accept("over-budget-prop");
    expect(outcome.state).toBe("rejected");
    expect(outcome.waiver_applied).toBe(false);
    expect(outcome.report.blockers.map((b) => b.gate)).toContain("budget");
    expect(outcome.report.blockers.find((b) => b.gate === "budget")?.detail).toContain("exceeds");
    expect(registry.get("over-budget-prop")?.acceptance_state).toBe("rejected");

    // The release check refuses to certify it.
    const report = registry.verifyAll();
    expect(report.status).toBe("failed");
    expect(report.totals.rejected).toBe(1);

    // The ONLY path back is an explicit recorded policy waiver -> degraded, visibly.
    const registry2 = freshRegistry();
    registry2.intake(asset({ id: "waivered", budget: { max_triangles: 5000, measured_triangles: 42000 } }));
    const accepted = registry2.accept("waivered");
    expect(accepted.state).toBe("rejected"); // without a waiver it stays rejected

    const waived = registry2.accept("waivered", {
      waiver: { gate: "budget", reason: "hero set-piece approved for one scene", author: "studio-lead", ref: "DEC-T13-001" },
    });
    expect(waived.state).toBe("degraded");
    expect(waived.waiver_applied).toBe(true);
    expect(registry2.get("waivered")?.acceptance_state).toBe("degraded");

    // The waiver is reconstructable from history with author + reason.
    const waiverEvent = registry2.history.find((e) => e.kind === "waiver");
    expect(waiverEvent?.reason).toContain("hero set-piece");
    expect(waiverEvent?.data?.["author"]).toBe("studio-lead");
    expect(waiverEvent?.data?.["gate"]).toBe("budget");

    // And the reject evidence from the first attempt is preserved append-only.
    expect(registry2.history.filter((e) => e.kind === "reject").length).toBe(1);
    expect(registry2.history.some((e) => e.kind === "degrade")).toBe(true);
  });
});
