import { describe, it, expect } from "bun:test";
import {
  CapabilityDescriptorSchema,
  CapabilityRequestSchema,
  CapabilityResultSchema,
  AgentHandoffSchema,
  AssetRecordSchema,
  TerrainHeightfieldSchema,
  RuntimeReadinessSchema,
  NetworkEnvelopeSchema,
  ObservationRunSchema,
  EvidenceManifestSchema,
  SettlementRecordSchema,
  validateCapabilityRequest,
  validateEvidenceManifest,
  validateTerrainHeightfield,
  validateRuntimeReadiness,
} from "./index";

describe("Studio Contracts & Schemas Validation Suite", () => {
  describe("CapabilityDescriptor", () => {
    it("validates a well-formed capability descriptor", () => {
      const valid = {
        id: "world.heightfield",
        summary: "Deterministic mathematical elevation generation producing canonical height arrays.",
        use_when: ["terrain elevation is needed", "procedural island heightfield"],
        do_not_use_when: ["importing pre-modeled static GLB scenery"],
        inputs: ["seed", "dimensions", "octaves"],
        outputs: ["TerrainHeightfield"],
        verification: ["unit_test", "visual_inspection"],
        providers: ["procedural_generator"],
      };
      expect(() => CapabilityDescriptorSchema.parse(valid)).not.toThrow();
    });

    it("rejects capability descriptor with invalid ID pattern or missing triggers", () => {
      const invalid = {
        id: "INVALID_CAPABILITY",
        summary: "Too short",
        use_when: [],
        inputs: [],
        outputs: [],
        verification: [],
        providers: [],
      };
      expect(() => CapabilityDescriptorSchema.parse(invalid)).toThrow();
    });
  });

  describe("CapabilityRequest & Provider Isolation (Teeth Attack 1)", () => {
    it("accepts valid provider-neutral capability request", () => {
      const valid = {
        id: "req-101",
        project_id: "blackwater-relay",
        capability_id: "world.heightfield",
        intent: "Generate coastal island terrain with high central ridge",
        acceptance: ["Elevation range between -5.0m and 45.0m", "Deterministic seed reproduction"],
        inputs: { seed: 1337, size_x: 256, size_z: 256 },
      };
      expect(() => validateCapabilityRequest(valid)).not.toThrow();
    });

    it("REJECTS provider authority leaks: mavonGameObject in root request (Teeth Check)", () => {
      const leaking = {
        id: "req-102",
        project_id: "blackwater-relay",
        capability_id: "world.heightfield",
        intent: "Generate island",
        acceptance: ["Elevation bounds"],
        inputs: {},
        mavonGameObject: { id: "mavon_node_99", components: ["MavonMesh"] },
      };
      expect(() => validateCapabilityRequest(leaking)).toThrow();
    });

    it("REJECTS provider authority leaks: needleComponent in root request (Teeth Check)", () => {
      const leaking = {
        id: "req-103",
        project_id: "blackwater-relay",
        capability_id: "asset.reconstruct",
        intent: "Reconstruct radio transceiver",
        acceptance: ["Valid glTF export"],
        inputs: {},
        needleComponent: "NeedleBridgeComponent",
      };
      expect(() => validateCapabilityRequest(leaking)).toThrow();
    });

    it("REJECTS capability request missing acceptance criteria", () => {
      const noAcceptance = {
        id: "req-104",
        project_id: "blackwater-relay",
        capability_id: "world.heightfield",
        intent: "Generate island",
        acceptance: [],
        inputs: {},
      };
      expect(() => validateCapabilityRequest(noAcceptance)).toThrow();
    });
  });

  describe("CapabilityResult", () => {
    it("validates well-formed capability result", () => {
      const valid = {
        id: "res-101",
        request_id: "req-101",
        provider: "procedural_generator",
        status: "success" as const,
        artifacts: [{ path: "terrain/heightfield.bin", role: "canonical_heightfield" }],
        diagnostics: { elapsed_ms: 14 },
      };
      expect(() => CapabilityResultSchema.parse(valid)).not.toThrow();
    });

    it("rejects capability result with extra unquarantined provider roots", () => {
      const leaking = {
        id: "res-102",
        request_id: "req-101",
        provider: "mavon_legacy_importer",
        status: "success",
        artifacts: [],
        diagnostics: {},
        mavonWorldHandle: 0xdeadbeef,
      };
      expect(() => CapabilityResultSchema.parse(leaking)).toThrow();
    });
  });

  describe("AgentHandoff", () => {
    it("validates agent handoff contract", () => {
      const valid = {
        request_id: "req-201",
        skill_id: "img2threejs",
        instructions_ref: "vendor/img2threejs/SKILL.md",
        expected_outputs: ["assets/models/transceiver.glb"],
        acceptance: ["GLB passes glTF-Transform validation", "Poly count <= 15000 triangles"],
      };
      expect(() => AgentHandoffSchema.parse(valid)).not.toThrow();
    });
  });

  describe("AssetRecord & Provenance", () => {
    it("validates asset record with full provenance", () => {
      const valid = {
        id: "rover_chassis",
        role: "hero_vehicle",
        origin: "project" as const,
        construction_route: "dcc.blender",
        source_provenance: {
          uri: "assets/source/rover.blend",
          license: "Project First-Party MIT",
          sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        },
        runtime_representation: "GLB",
        budget: { max_triangles: 25000, max_texture_dim: 2048 },
        acceptance_state: "accepted" as const,
      };
      expect(() => AssetRecordSchema.parse(valid)).not.toThrow();
    });

    it("rejects asset record with invalid ID naming convention", () => {
      const invalid = {
        id: "INVALID VEHICLE ID WITH SPACES",
        role: "hero_vehicle",
        origin: "project",
        construction_route: "manual",
        runtime_representation: "GLB",
        acceptance_state: "accepted",
      };
      expect(() => AssetRecordSchema.parse(invalid)).toThrow();
    });
  });

  describe("TerrainHeightfield", () => {
    it("validates heightfield with array heights", () => {
      const valid = {
        rows: 4,
        columns: 4,
        heights: new Array(16).fill(10.5),
        size_x: 100,
        size_z: 100,
        orientation: "+X row, +Z column",
        seed: 42,
      };
      expect(() => validateTerrainHeightfield(valid)).not.toThrow();
    });

    it("validates heightfield with Float32Array heights", () => {
      const valid = {
        rows: 4,
        columns: 4,
        heights: new Float32Array(16),
        size_x: 100,
        size_z: 100,
        orientation: "+X row, +Z column",
      };
      expect(() => validateTerrainHeightfield(valid)).not.toThrow();
    });

    it("rejects invalid dimensions or negative sizes", () => {
      const invalid = {
        rows: 1, // must be >= 2
        columns: 4,
        heights: [0, 0, 0, 0],
        size_x: -10, // must be positive
        size_z: 100,
        orientation: "+X row",
      };
      expect(() => validateTerrainHeightfield(invalid)).toThrow();
    });
  });

  describe("RuntimeReadiness", () => {
    it("accepts ready state when all required subsystems are ready", () => {
      const ready = {
        state: "ready" as const,
        required_subsystems: ["physics_rapier", "navigation_recast", "audio"],
        subsystem_states: {
          physics_rapier: "ready" as const,
          navigation_recast: "ready" as const,
          audio: "ready" as const,
        },
      };
      expect(() => validateRuntimeReadiness(ready)).not.toThrow();
    });

    it("REJECTS ready state when a required subsystem is still booting or failed", () => {
      const unready = {
        state: "ready" as const,
        required_subsystems: ["physics_rapier", "navigation_recast"],
        subsystem_states: {
          physics_rapier: "ready" as const,
          navigation_recast: "booting" as const,
        },
      };
      expect(() => validateRuntimeReadiness(unready)).toThrow();
    });
  });

  describe("NetworkEnvelope", () => {
    it("validates client command envelope with non-negative sequence", () => {
      const envelope = {
        kind: "input.move",
        sequence: 42,
        payload: { forward: 1.0, steering: -0.25 },
        client_id: "client-abc",
      };
      expect(() => NetworkEnvelopeSchema.parse(envelope)).not.toThrow();
    });

    it("rejects negative sequence numbers", () => {
      const negativeSeq = {
        kind: "input.move",
        sequence: -1,
        payload: {},
      };
      expect(() => NetworkEnvelopeSchema.parse(negativeSeq)).toThrow();
    });
  });

  describe("ObservationRun & EvidenceManifest (Teeth Attack 2)", () => {
    it("validates complete ObservationRun", () => {
      const run = {
        id: "run-20260915-001",
        project_revision: "9dd5a03",
        scenario_id: "blackwater-relay-single-player",
        environment: { browser: "chromium", headless: true, width: 1920, height: 1080 },
        channels: ["state", "pixels", "telemetry"],
        seed: 42,
      };
      expect(() => ObservationRunSchema.parse(run)).not.toThrow();
    });

    it("validates complete EvidenceManifest bound to run and revision", () => {
      const manifest = {
        id: "ev-20260915-001",
        run_id: "run-20260915-001",
        project_revision: "9dd5a03",
        requirement_ids: ["REQ-TERRAIN-001", "REQ-PHYS-001"],
        artifacts: [
          { path: "artifacts/plan/T02/state.json", role: "state_snapshot" },
          { path: "artifacts/plan/T02/render.webp", role: "pixel_capture" },
        ],
        result: "pass" as const,
        confirmation_mode: "peer" as const,
      };
      expect(() => validateEvidenceManifest(manifest)).not.toThrow();
    });

    it("REJECTS EvidenceManifest without project_revision or run_id (Teeth Check)", () => {
      const unlinked = {
        id: "ev-orphan",
        requirement_ids: ["REQ-TERRAIN-001"],
        artifacts: [{ path: "artifacts/orphan.png" }],
        result: "pass",
      };
      expect(() => validateEvidenceManifest(unlinked)).toThrow();
    });

    it("REJECTS EvidenceManifest with empty artifacts list (Teeth Check)", () => {
      const emptyArtifacts = {
        id: "ev-empty",
        run_id: "run-001",
        project_revision: "9dd5a03",
        requirement_ids: ["REQ-TERRAIN-001"],
        artifacts: [],
        result: "pass",
      };
      expect(() => validateEvidenceManifest(emptyArtifacts)).toThrow();
    });
  });

  describe("SettlementRecord", () => {
    it("validates settlement decision citing evidence manifests", () => {
      const settlement = {
        id: "set-REQ-OUT-005",
        requirement_ids: ["REQ-OUT-005"],
        decision: "settled" as const,
        evidence_manifest_ids: ["ev-20260915-001"],
        reason: "Strict schemas reject provider leaks; all domain entities verified through test suite.",
      };
      expect(() => SettlementRecordSchema.parse(settlement)).not.toThrow();
    });

    it("rejects settlement record without evidence manifest citations", () => {
      const noEvidence = {
        id: "set-REQ-OUT-005",
        requirement_ids: ["REQ-OUT-005"],
        decision: "settled",
        evidence_manifest_ids: [],
        reason: "Claimed settled without evidence",
      };
      expect(() => SettlementRecordSchema.parse(noEvidence)).toThrow();
    });
  });
});
