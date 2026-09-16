import { describe, it, expect } from "bun:test";
import {
  defaultCapabilityRegistry,
  routeCapability,
  settleAgentHandoff,
  lintSkillDescriptor,
  lintSkillRegistry,
  RoutingError,
  PrematureSettlementError,
} from "../index";
import type { CapabilityRequest, CapabilityDescriptor, AgentHandoff } from "@gauntlet/contracts";

describe("Capability Registry, Routing, Skill Metadata & AgentHandoff Suite", () => {
  describe("Capability Registry", () => {
    it("contains all normative studio capabilities (baseline 13, plus later plan additions)", () => {
      const caps = defaultCapabilityRegistry.list();
      // The catalog grows only by normative plan settlement (e.g. T14 added
      // asset.reconstruct.reference-image); the baseline must always remain present.
      expect(caps.length).toBeGreaterThanOrEqual(13);
      expect(defaultCapabilityRegistry.has("world.composition")).toBe(true);
      expect(defaultCapabilityRegistry.has("asset.reconstruct")).toBe(true);
      expect(defaultCapabilityRegistry.has("asset.reconstruct.reference-image")).toBe(true);
      expect(defaultCapabilityRegistry.has("world.terrain")).toBe(true);
      expect(defaultCapabilityRegistry.has("world.physics")).toBe(true);
      expect(defaultCapabilityRegistry.has("world.navigation")).toBe(true);
      expect(defaultCapabilityRegistry.has("network.multiplayer")).toBe(true);
    });
  });

  describe("Capability Router & Disambiguation (Teeth Attack 1)", () => {
    it("routes depicted object reconstruction from reference image to img2threejs (Teeth Check)", () => {
      const request: CapabilityRequest = {
        id: "req-transceiver",
        project_id: "blackwater-relay",
        capability_id: "asset.reconstruct",
        intent: "Reconstruct storm-battered field transceiver model from supplied concept artwork",
        acceptance: ["GLB derivative produced", "Triangles <= 15000"],
        inputs: { reference_uri: "references/transceiver.png" },
        reference_ids: ["ref-transceiver-01"],
      };

      const resolution = routeCapability(request);
      expect(resolution.status).toBe("routed");
      expect(resolution.capability.id).toBe("asset.reconstruct");
      expect(resolution.provider).toBe("agent-skill.img2threejs");
      expect(resolution.is_agent_handoff).toBe(true);
      expect(resolution.handoff).toBeDefined();
      expect(resolution.handoff?.skill_id).toBe("img2threejs");
    });

    it("routes scene and world composition to 3dviz (Teeth Check)", () => {
      const request: CapabilityRequest = {
        id: "req-environment",
        project_id: "blackwater-relay",
        capability_id: "world.composition",
        intent: "Compose island environment with storm-dusk lighting setup and dense coastal vegetation",
        acceptance: ["Complete scene graph", "Draw calls <= 150"],
        inputs: {},
      };

      const resolution = routeCapability(request);
      expect(resolution.status).toBe("routed");
      expect(resolution.capability.id).toBe("world.composition");
      expect(resolution.provider).toBe("agent-skill.3dviz");
      expect(resolution.is_agent_handoff).toBe(true);
    });

    it("REJECTS ambiguous intent when it violates negative affordances (Teeth Check)", () => {
      // Intent says "scene composition", but targets asset.reconstruct whose negative affordance explicitly forbids scene composition
      const conflictingRequest: CapabilityRequest = {
        id: "req-conflict",
        project_id: "blackwater-relay",
        capability_id: "asset.reconstruct",
        intent: "Perform world environment layout and scene composition",
        acceptance: ["Finished scene"],
        inputs: {},
      };

      expect(() => routeCapability(conflictingRequest)).toThrow(RoutingError);
    });
  });

  describe("Skill Metadata Linter (Teeth Attack 2)", () => {
    it("validates all built-in catalog skills against description and affordance contracts", () => {
      const report = lintSkillRegistry(defaultCapabilityRegistry.list());
      expect(report.valid).toBe(true);
      const errors = report.issues.filter((i) => i.severity === "error");
      expect(errors.length).toBe(0);
    });

    it("REJECTS skill with description > 1024 characters (Teeth Check)", () => {
      const bloatedSkill: CapabilityDescriptor = {
        id: "custom.bloated",
        summary: "A".repeat(1050),
        use_when: ["valid trigger"],
        do_not_use_when: ["valid negative affordance"],
        inputs: ["input1"],
        outputs: ["output1"],
        verification: ["test"],
        providers: ["provider1"],
      };

      const issues = lintSkillDescriptor(bloatedSkill);
      const error = issues.find((i) => i.code === "SKILL_DESCRIPTION_TOO_LONG");
      expect(error).toBeDefined();
      expect(error?.severity).toBe("error");
    });

    it("REJECTS skill missing negative affordances (Teeth Check)", () => {
      const missingNegative: CapabilityDescriptor = {
        id: "custom.unbounded",
        summary: "A skill that does something useful within a normal description length range.",
        use_when: ["do work"],
        do_not_use_when: [],
        inputs: ["input1"],
        outputs: ["output1"],
        verification: ["test"],
        providers: ["provider1"],
      };

      const issues = lintSkillDescriptor(missingNegative);
      const error = issues.find((i) => i.code === "SKILL_MISSING_NEGATIVE_AFFORDANCES");
      expect(error).toBeDefined();
      expect(error?.severity).toBe("error");
    });
  });

  describe("AgentHandoff Lifecycle & Premature Settlement (Teeth Attack 3)", () => {
    const sampleHandoff: AgentHandoff = {
      request_id: "req-rover-01",
      skill_id: "img2threejs",
      instructions_ref: "skills/img2threejs/SKILL.md",
      expected_outputs: ["assets/models/rover.glb"],
      acceptance: ["Passes glTF validation"],
    };

    it("settles cleanly when accepted artifacts are provided", () => {
      const artifacts = [{ path: "assets/models/rover.glb", role: "hero_vehicle" }];
      const result = settleAgentHandoff(sampleHandoff, "agent-skill.img2threejs", artifacts);
      expect(result.status).toBe("success");
      expect(result.request_id).toBe("req-rover-01");
      expect(result.artifacts.length).toBe(1);
    });

    it("REJECTS premature settlement without accepted artifacts (Teeth Check)", () => {
      // Passing empty artifacts array must throw PrematureSettlementError
      expect(() => {
        settleAgentHandoff(sampleHandoff, "agent-skill.img2threejs", []);
      }).toThrow(PrematureSettlementError);
    });
  });
});
