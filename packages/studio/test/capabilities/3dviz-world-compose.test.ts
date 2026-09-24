import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { defaultCapabilityRegistry, routeCapability, lintSkillDescriptor } from "@gauntlet/studio";
import {
  assertWorldCompositionIntentBoundary,
  normalizeWorldCompositionOutput,
  verifyWorldCompositionResultDocument,
  verifyWorldCompositionResultFile,
  WorldCompositionAuthorityError,
  WORLD_ENVIRONMENT_COMPOSE_CAPABILITY,
} from "@gauntlet/adapters";
import { validateCapabilityRequest, type CapabilityRequest } from "@gauntlet/contracts";

/**
 * T15 (REQ-BIND-005) — world.environment.compose handoff integration with terrain/navigation
 * composition. Preregistration: .agents/preregistrations/gauntlet-game-studio-plan-T15.prereg.yaml
 * (frozen before implementation/evidence). Proof level P2, confirmation builder_with_teeth.
 */

const REPO_ROOT = path.resolve(import.meta.dir, "../../../..");
const COMMITTED_RESULT = path.resolve(
  REPO_ROOT,
  "examples/blackwater-relay/.studio/results/world.yaml"
);
const COMMITTED_REQUEST = path.resolve(
  REPO_ROOT,
  "examples/blackwater-relay/.studio/requests/world.yaml"
);

function baseRequest(overrides: Partial<CapabilityRequest> = {}): CapabilityRequest {
  return {
    id: "req-t15-test-001",
    project_id: "blackwater-relay",
    capability_id: WORLD_ENVIRONMENT_COMPOSE_CAPABILITY,
    intent:
      "Compose the island environment: relay compound architecture, shoreline vegetation scatter, and storm-dusk lighting and fog atmosphere composed with the canonical heightfield and runtime navigation geometry",
    acceptance: ["kits reference settled asset records"],
    inputs: {},
    ...overrides,
  };
}

function validAgentOutput(): Record<string, unknown> {
  return {
    composition_id: "bw-test-compose-001",
    terrain_authority: {
      mode: "canonical_heightfield_reference",
      capability: "world.terrain",
      generator: "sinusoidal-octaves",
      seed: 20260915,
      rows: 129,
      columns: 129,
      size_x: 512,
      size_z: 512,
    },
    navigation_derivation: { mode: "runtime_derived", capability: "world.navigation" },
    kits: [
      {
        kit_id: "k-tower",
        asset_id: "kit-relay-tower",
        role: "relay_tower",
        position: { x: 8, z: -12, terrain_socked: true, offset_y: 0 },
      },
    ],
    sockets: [
      {
        socket_id: "s-beacon",
        attaches_to: "k-tower",
        terrain_socked: true,
        height_source: "canonical_heightfield",
        offset_y: 14,
      },
    ],
    colliders: [{ collider_id: "c-tower", attached_to: "k-tower", shape: "cylinder", blocks_navigation: true }],
    scatter: [
      {
        layer_id: "sc-scrub",
        asset_id: "veg-shoreline-scrub",
        placement: "terrain-projected",
        placement_seed: 20260916,
        max_instances: 350,
      },
    ],
    lighting_atmosphere: { preset: "storm-dusk", asset_ids: ["skybox-storm-dusk"] },
  };
}

describe("world.environment.compose capability binding (T15, REQ-BIND-005)", () => {
  it("registers the capability with the agent-skill.3dviz provider and explicit negative affordances", () => {
    expect(defaultCapabilityRegistry.has(WORLD_ENVIRONMENT_COMPOSE_CAPABILITY)).toBe(true);
    const cap = defaultCapabilityRegistry.get(WORLD_ENVIRONMENT_COMPOSE_CAPABILITY)!;
    expect(cap.providers).toContain("agent-skill.3dviz");
    const negatives = cap.do_not_use_when.join("\n").toLowerCase();
    expect(negatives).toContain("reconstructing a specific depicted object");
    expect(negatives).toContain("terrain elevation authority");
    expect(negatives).toContain("navigation authority");
    // Skill metadata contract still holds for the new entry.
    const issues = lintSkillDescriptor(cap).filter((i) => i.severity === "error");
    expect(issues).toHaveLength(0);
  });

  it("prepares a world-composition request into a studio-directed 3dviz AgentHandoff", () => {
    const resolution = routeCapability(baseRequest());
    expect(resolution.status).toBe("routed");
    expect(resolution.capability.id).toBe(WORLD_ENVIRONMENT_COMPOSE_CAPABILITY);
    expect(resolution.is_agent_handoff).toBe(true);
    expect(resolution.handoff).toBeDefined();
    expect(resolution.handoff!.skill_id).toBe("3dviz");
    expect(resolution.handoff!.instructions_ref).toBe("vendor/skills/3dviz-pro-max/SKILL.md");
    expect(resolution.handoff!.expected_outputs).toContain("world_kit_placements");
  });
});

describe("TEETH-T15-001: reconstructing one specific depicted transceiver through the world-composition route", () => {
  it("routing rejects the reconstruction intent and redirects to reference reconstruction", () => {
    let thrown: WorldCompositionAuthorityError | null = null;
    try {
      assertWorldCompositionIntentBoundary(
        "Reconstruct the specific depicted field transceiver from the supplied reference photo"
      );
    } catch (err) {
      thrown = err as WorldCompositionAuthorityError;
    }
    expect(thrown).not.toBeNull();
    expect(thrown!.code).toBe("WORLD_COMPOSITION_AUTHORITY_VIOLATION");
    expect(thrown!.violation).toBe("object_reconstruction");
    expect(thrown!.redirect_capability).toBe("asset.reconstruct");
    expect(thrown!.message).toContain("reference-reconstruction");
  });

  it("intent-based routing redirects a transceiver reconstruction request to the reference-reconstruction capability", () => {
    const resolution = routeCapability(
      baseRequest({
        capability_id: "unresolved",
        intent: "Reconstruct storm-battered field transceiver model from supplied concept artwork",
        reference_ids: ["ref-transceiver-concept"],
      })
    );
    expect(resolution.capability.id).toBe("asset.reconstruct");
    expect(resolution.is_agent_handoff).toBe(true);
    expect(resolution.handoff!.skill_id).toBe("img2threejs");
    expect(resolution.handoff!.instructions_ref).toBe("vendor/skills/img2threejs/SKILL.md");
    expect(resolution.capability.requires_user_reference).toBe(true);
  });

  it("normalization rejects reconstruction-flavored composition output", () => {
    const raw = {
      ...validAgentOutput(),
      requested_route: "img2threejs reconstruction of the depicted field transceiver",
    };
    let thrown: WorldCompositionAuthorityError | null = null;
    try {
      normalizeWorldCompositionOutput(raw);
    } catch (err) {
      thrown = err as WorldCompositionAuthorityError;
    }
    expect(thrown).not.toBeNull();
    expect(thrown!.violation).toBe("object_reconstruction");
    expect(thrown!.redirect_capability).toBe("asset.reconstruct");
  });

  it("the integration gate fails a result document whose composition claims a reconstruction route", () => {
    const doc = JSON.parse(JSON.stringify(Bun.YAML.parse(fs.readFileSync(COMMITTED_RESULT, "utf-8"))));
    doc.accepted_output.composition.kits[0].construction_route = "img2threejs/depicted-transceiver";
    const report = verifyWorldCompositionResultDocument(doc, { projectRoot: REPO_ROOT });
    expect(report.valid).toBe(false);
    const failed = report.checks.filter((c) => !c.pass).map((c) => c.code);
    expect(failed).toContain("NO_OBJECT_RECONSTRUCTION_ROUTE");
  });
});

describe("TEETH-T15-002: 3dviz-created terrain mesh bypassing TerrainHeightfield for physics/navigation", () => {
  it("normalization rejects a competing 3dviz terrain-mesh terrain authority", () => {
    const raw = validAgentOutput();
    (raw as Record<string, unknown>).terrain_authority = {
      mode: "3dviz_terrain_mesh",
      capability: "world.terrain",
      generator: "3dviz-scene-mesh",
      seed: 1,
      rows: 2,
      columns: 2,
      size_x: 512,
      size_z: 512,
    };
    let thrown: WorldCompositionAuthorityError | null = null;
    try {
      normalizeWorldCompositionOutput(raw);
    } catch (err) {
      thrown = err as WorldCompositionAuthorityError;
    }
    expect(thrown).not.toBeNull();
    expect(thrown!.violation).toBe("terrain_authority");
    expect(thrown!.message).toContain("must never bypass TerrainHeightfield");
  });

  it("normalization rejects embedded elevation and navmesh payloads outright", () => {
    const withElevation = { ...validAgentOutput(), terrain_heights: [0.5, 1.5, 2.5] };
    expect(() => normalizeWorldCompositionOutput(withElevation)).toThrow(WorldCompositionAuthorityError);
    try {
      normalizeWorldCompositionOutput(withElevation);
    } catch (err) {
      expect((err as WorldCompositionAuthorityError).violation).toBe("terrain_authority");
    }

    const withNavmesh = { ...validAgentOutput(), navmesh_data: { cells: [1, 0, 1] } };
    expect(() => normalizeWorldCompositionOutput(withNavmesh)).toThrow(WorldCompositionAuthorityError);
    try {
      normalizeWorldCompositionOutput(withNavmesh);
    } catch (err) {
      expect((err as WorldCompositionAuthorityError).violation).toBe("navigation_authority");
    }
  });

  it("sockets claiming a non-canonical height source are rejected", () => {
    const raw = validAgentOutput();
    (raw as Record<string, unknown>).sockets = [
      {
        socket_id: "s-beacon",
        attaches_to: "k-tower",
        terrain_socked: false,
        height_source: "composition_mesh",
        offset_y: 14,
      },
    ];
    expect(() => normalizeWorldCompositionOutput(raw)).toThrow(WorldCompositionAuthorityError);
  });

  it("the integration gate rejects the committed-style document when a 3dviz terrain mesh bypasses TerrainHeightfield", () => {
    const doc = JSON.parse(JSON.stringify(Bun.YAML.parse(fs.readFileSync(COMMITTED_RESULT, "utf-8"))));
    doc.accepted_output.composition.terrain_authority.mode = "3dviz_terrain_mesh";
    doc.accepted_output.composition.terrain_heights = [0.25, 1.75, -0.5];
    const report = verifyWorldCompositionResultDocument(doc, { projectRoot: REPO_ROOT });
    expect(report.valid).toBe(false);
    const failed = report.checks.filter((c) => !c.pass).map((c) => c.code);
    expect(failed).toContain("TERRAIN_AUTHORITY_CANONICAL");
    expect(failed).toContain("NO_COMPETING_AUTHORITY_EMBEDDED");
  });

  it("the integration gate rejects a doctored document that embeds navmesh authority", () => {
    const doc = JSON.parse(JSON.stringify(Bun.YAML.parse(fs.readFileSync(COMMITTED_RESULT, "utf-8"))));
    doc.accepted_output.composition.navmesh_data = { walkable: [1, 1, 0] };
    const report = verifyWorldCompositionResultDocument(doc, { projectRoot: REPO_ROOT });
    expect(report.valid).toBe(false);
    const failed = report.checks.filter((c) => !c.pass).map((c) => c.code);
    expect(failed.length).toBeGreaterThan(0);
    expect(failed.some((c) => c === "NO_COMPETING_AUTHORITY_EMBEDDED" || c === "NAVIGATION_DERIVED_DOWNSTREAM")).toBe(true);
  });
});

describe("deterministic verification of the committed Blackwater Relay world fixture (T15 gate)", () => {
  it("rejects a metadata file in place of the pinned 3dviz executable instructions", () => {
    const doc = JSON.parse(JSON.stringify(Bun.YAML.parse(fs.readFileSync(COMMITTED_RESULT, "utf-8"))));
    doc.handoff.instructions_ref = "vendor/skills/3dviz-pro-max/metadata.json";
    const report = verifyWorldCompositionResultDocument(doc, { projectRoot: REPO_ROOT });
    expect(report.valid).toBe(false);
    expect(report.checks.find((check) => check.code === "HANDOFF_LIFECYCLE_RECORDED")?.pass).toBe(false);
  });

  it("verifies the committed accepted world-composition result with zero model credentials", () => {
    const report = verifyWorldCompositionResultFile(COMMITTED_RESULT);
    expect(report.valid).toBe(true);
    expect(report.capability).toBe(WORLD_ENVIRONMENT_COMPOSE_CAPABILITY);
    expect(report.summary.failed).toBe(0);
    const codes = report.checks.map((c) => c.code);
    expect(codes).toContain("TERRAIN_AUTHORITY_CANONICAL");
    expect(codes).toContain("NAVIGATION_DERIVED_DOWNSTREAM");
    expect(codes).toContain("ASSET_PROVENANCE_BOUND");
    expect(codes).toContain("NO_MODEL_CREDENTIALS");
    const credentialsCheck = report.checks.find((c) => c.code === "NO_MODEL_CREDENTIALS");
    expect(credentialsCheck!.pass).toBe(true);
  });

  it("binds the committed request, handoff, and result into one consistent lifecycle", () => {
    const request = validateCapabilityRequest(Bun.YAML.parse(fs.readFileSync(COMMITTED_REQUEST, "utf-8")));
    const doc = Bun.YAML.parse(fs.readFileSync(COMMITTED_RESULT, "utf-8"));
    expect(doc.handoff.request_id).toBe(request.id);
    expect(doc.result.request_id).toBe(request.id);
    expect(doc.request_ref).toContain(".studio/requests/world.yaml");

    const resolution = routeCapability(request);
    expect(resolution.handoff!.request_id).toBe(request.id);
    expect(resolution.handoff!.skill_id).toBe("3dviz");

    // Normalization of the committed composition reproduces the same canonical terrain reference.
    const normalized = normalizeWorldCompositionOutput(doc.accepted_output.composition);
    expect(normalized.terrain_authority.seed).toBe(20260915);
    expect(normalized.terrain_authority.mode).toBe("canonical_heightfield_reference");
    expect(normalized.navigation_derivation.capability).toBe("world.navigation");
    expect(normalized.kits).toHaveLength(3);
    expect(normalized.sockets.every((s) => s.height_source === "canonical_heightfield")).toBe(true);
  });
});
