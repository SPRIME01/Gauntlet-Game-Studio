import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  validateOverlayPolicy,
  checkSkillAgainstOverlay,
  loadSkillOverlayPolicy,
  lintOverlayRouting,
  lintStudioSkillSurface,
  assertDiscoverableSkillSurface,
  assertSkillNotQuarantined,
  buildSpecialistRouteEntries,
  resolveSpecialistDisclosure,
  specialistRouteEntryId,
  evaluateProviderPreference,
  OverlaySkillRegistry,
  ForbiddenUpstreamAuthorityError,
  QuarantinedSkillError,
  OverlayPolicyError,
  CANONICAL_OVERLAY_SPECIALISTS,
  QUARANTINED_GENERATOR_SKILLS,
  type SkillOverlayPolicy,
  type SpecialistRouteEntry,
  type SpecialistBinding,
} from "../../src/index";
import { CAPABILITY_CATALOG } from "../../src/capabilities/catalog";
import { defaultCapabilityRegistry } from "../../src/capabilities/registry";
import { validateCapabilityDescriptor } from "@gauntlet/contracts";

const ROOT = path.resolve(import.meta.dir, "../../../..");

/** Clones the committed policy so attacks never mutate the shared object. */
function clonePolicy(): SkillOverlayPolicy {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "vendor/skills/threejs-game-skills/overlay.json"), "utf-8"));
}

function makePolicyWithMutatedBinding(skillId: string, mutate: (b: SpecialistBinding) => void): SkillOverlayPolicy {
  const policy = clonePolicy();
  const binding = (policy.specialist_bindings || []).find((b) => b.skill_id === skillId);
  if (!binding) throw new Error(`missing binding ${skillId}`);
  mutate(binding);
  return policy;
}

function makeDirectorDescriptor(id: string, providers: string[]) {
  return {
    id,
    summary: "Upstream game director that orchestrates every gameplay, graphics, UI, debug, and QA workflow end to end.",
    use_when: ["directing the whole game project"],
    do_not_use_when: [],
    inputs: ["world_brief"],
    outputs: ["scene_graph_spec"],
    verification: ["visual_capture"],
    providers,
  };
}

describe("Studio-Owned Specialist Overlay Routing (T16, REQ-BIND-007)", () => {
  const policy = loadSkillOverlayPolicy(ROOT);

  it("loads and validates the committed overlay policy with the canonical specialist set", () => {
    const report = validateOverlayPolicy(policy);
    expect(report.errors).toEqual([]);
    expect(report.valid).toBe(true);
    expect(policy.orchestration_authority).toBe("gauntlet-game-studio");
    expect(policy.forbidden_skills).toContain("threejs-game-director");
    for (const specialist of CANONICAL_OVERLAY_SPECIALISTS) {
      expect(policy.allowed_specialists).toContain(specialist);
    }
    for (const generator of QUARANTINED_GENERATOR_SKILLS) {
      expect(policy.quarantined_skills).toContain(generator);
    }
    expect(policy.quarantine_policy?.enabled).toBe(false);
  });

  it("binds exactly the five specialists to real studio capability contracts with confined disclosure pointers", () => {
    const entries = buildSpecialistRouteEntries(policy);
    expect(entries.length).toBe(5);

    const catalogIds = new Set(CAPABILITY_CATALOG.map((c) => c.id));
    const entryIds = new Set<string>();
    for (const entry of entries) {
      expect(entryIds.has(entry.id)).toBe(false);
      entryIds.add(entry.id);
      expect(entry.id).toBe(specialistRouteEntryId(entry.skill_id));
      expect(entry.providers).toEqual([`agent-skill.${entry.skill_id}`]);
      expect(entry.capability_ids.length).toBeGreaterThanOrEqual(1);
      for (const capId of entry.capability_ids) {
        expect(catalogIds.has(capId)).toBe(true);
      }
      expect(entry.disclosure_ref.startsWith("skills/threejs-game-skills/")).toBe(true);
      expect(fs.existsSync(path.join(ROOT, entry.disclosure_ref))).toBe(true);
      // Entries stay schema-conformant studio routing records.
      expect(() =>
        validateCapabilityDescriptor({
          id: entry.id,
          summary: entry.summary,
          use_when: entry.use_when,
          do_not_use_when: entry.do_not_use_when,
          inputs: ["capability_request"],
          outputs: ["agent_handoff"],
          verification: ["overlay_routing_lint"],
          providers: entry.providers,
        })
      ).not.toThrow();
    }
    expect(entryIds.has("overlay.gameplay-systems")).toBe(true);
    expect(entryIds.has("overlay.qa-release")).toBe(true);
  });

  it("progressively discloses: routing surface is separated from on-demand disclosure content", () => {
    const disclosure = resolveSpecialistDisclosure(policy, "threejs-gameplay-systems");
    expect(disclosure.disclosure_ref).toBe("skills/threejs-game-skills/threejs-gameplay-systems/SKILL.md");
    expect(disclosure.capability_ids).toContain("world.physics");

    // Only declared specialists are resolvable; the forbidden director is never disclosable.
    expect(() => resolveSpecialistDisclosure(policy, "threejs-game-director")).toThrow(OverlayPolicyError);
    expect(() => resolveSpecialistDisclosure(policy, "threejs-3d-generator")).toThrow(OverlayPolicyError);

    // Disclosure content is NOT loaded into the routing surface (layer 1 stays lightweight).
    const pointer = fs.readFileSync(path.join(ROOT, disclosure.disclosure_ref), "utf-8");
    expect(pointer).toContain("Gauntlet routing glue");
    const serialized = JSON.stringify(buildSpecialistRouteEntries(policy));
    expect(serialized).not.toContain("Gauntlet routing glue");
  });

  it("passes routing collision lint for the committed catalog and keeps the director undiscoverable", () => {
    const routing = lintOverlayRouting(policy, CAPABILITY_CATALOG);
    const errors = routing.issues.filter((i) => i.severity === "error");
    expect(errors).toEqual([]);
    expect(routing.valid).toBe(true);

    const surface = lintStudioSkillSurface(CAPABILITY_CATALOG, policy);
    expect(surface.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(surface.valid).toBe(true);

    // Live registered surface: clean of forbidden and quarantined references (enforced, not documented).
    expect(() => assertDiscoverableSkillSurface(defaultCapabilityRegistry.list(), policy)).not.toThrow();
    const registered = defaultCapabilityRegistry.list();
    const quarantinedNames = QUARANTINED_GENERATOR_SKILLS as readonly string[];
    for (const cap of registered) {
      expect(cap.id).not.toContain("threejs-game-director");
      for (const provider of cap.providers) {
        expect(provider).not.toContain("threejs-game-director");
        for (const quarantined of [...quarantinedNames, "generic-text-to-3d"]) {
          expect(provider).not.toBe(`agent-skill.${quarantined}`);
        }
      }
    }
  });

  it("detects uncoordinated routing collisions between specialist descriptions and studio capabilities", () => {
    // Attack A: specialist claims a trigger owned by an unbound studio capability.
    const attacked = makePolicyWithMutatedBinding("threejs-gameplay-systems", (b) => {
      b.capability_ids = ["world.physics"];
      b.use_when = ["navmesh generation", ...b.use_when.slice(1)];
    });
    const reportA = lintOverlayRouting(attacked, CAPABILITY_CATALOG);
    expect(reportA.valid).toBe(false);
    expect(reportA.issues.some((i) => i.code === "OVERLAY_ROUTING_COLLISION" && i.message.includes("world.navigation"))).toBe(true);

    // Coordinated variant: the same trigger under its bound capability is a warning, not an error.
    const coordinated = makePolicyWithMutatedBinding("threejs-gameplay-systems", (b) => {
      b.use_when = ["navmesh generation", ...b.use_when.slice(1)];
    });
    const reportB = lintOverlayRouting(coordinated, CAPABILITY_CATALOG);
    expect(reportB.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(reportB.issues.some((i) => i.code === "SKILL_TRIGGER_COLLISION")).toBe(true);

    // Attack B: two specialists claim the identical trigger.
    const duplicated = makePolicyWithMutatedBinding("threejs-qa-release", (b) => {
      b.use_when = ["frame time profiling", ...b.use_when.slice(1)];
    });
    const reportC = lintOverlayRouting(duplicated, CAPABILITY_CATALOG);
    expect(reportC.valid).toBe(false);
    expect(reportC.issues.some((i) => i.code === "OVERLAY_SPECIALIST_TRIGGER_COLLISION")).toBe(true);

    // Attack C: binding anchors to a capability that is not a real studio contract.
    const unanchored = makePolicyWithMutatedBinding("threejs-debug-profiler", (b) => {
      b.capability_ids = ["verify.browser", "world.teleportation"];
    });
    const reportD = lintOverlayRouting(unanchored, CAPABILITY_CATALOG);
    expect(reportD.valid).toBe(false);
    expect(reportD.issues.some((i) => i.code === "OVERLAY_BINDING_UNKNOWN_CAPABILITY")).toBe(true);
  });

  it("TEETH-T16-001: upstream director discoverable alongside game-studio-director fails skill/routing lint", () => {
    // Attack at the discoverable-surface level: register the upstream director next to the studio director.
    const directorSurface = [
      ...CAPABILITY_CATALOG,
      makeDirectorDescriptor("game.director", ["agent-skill.threejs-game-director"]),
    ];
    const report = lintStudioSkillSurface(directorSurface, policy);
    expect(report.valid).toBe(false);
    expect(report.issues.some((i) => i.code === "FORBIDDEN_UPSTREAM_AUTHORITY")).toBe(true);

    // The same attack through id-only discovery (no provider reference) is also caught.
    const idOnly = [{ ...makeDirectorDescriptor("skill.threejs-game-director", []) }];
    expect(() => assertDiscoverableSkillSurface(idOnly, policy)).toThrow(ForbiddenUpstreamAuthorityError);
    expect(() => assertDiscoverableSkillSurface(directorSurface, policy)).toThrow(ForbiddenUpstreamAuthorityError);

    // Registration-time enforcement: the overlay registry refuses the director outright.
    const registry = new OverlaySkillRegistry(policy, CAPABILITY_CATALOG);
    const directorEntry: SpecialistRouteEntry = {
      id: "overlay.director",
      providers: ["agent-skill.threejs-game-director"],
      skill_id: "threejs-game-director",
      capability_ids: ["world.physics"],
      disclosure_ref: "skills/threejs-game-skills/threejs-gameplay-systems/SKILL.md",
      summary: "Upstream orchestration director attempting to compete with the Gauntlet studio director.",
      use_when: ["directing the whole game project"],
      do_not_use_when: ["nothing"],
    };
    expect(() => registry.register(directorEntry)).toThrow(ForbiddenUpstreamAuthorityError);
    expect(registry.list().length).toBe(0);
    expect(() => checkSkillAgainstOverlay("threejs-game-director", policy)).toThrow(ForbiddenUpstreamAuthorityError);
  });

  it("TEETH-T16-002: generic generator as preferred provider merely because credentials exist is rejected", () => {
    // Quarantined generator, even with credentials configured.
    const quarantined = evaluateProviderPreference(
      {
        capability_id: "asset.reconstruct",
        requested_provider: "agent-skill.threejs-3d-generator",
        credentials_present: true,
        justification: "vendor API credentials are configured in the environment",
      },
      policy,
      CAPABILITY_CATALOG
    );
    expect(quarantined.allowed).toBe(false);
    expect(quarantined.code).toBe("QUARANTINED_SKILL");
    expect(quarantined.reason).toContain("credential");

    // Credential-only preference for an undeclared provider is rejected on principle.
    const credentialOnly = evaluateProviderPreference(
      {
        capability_id: "world.composition",
        requested_provider: "agent-skill.some-credentialed-tool",
        credentials_present: true,
      },
      policy,
      CAPABILITY_CATALOG
    );
    expect(credentialOnly.allowed).toBe(false);
    expect(credentialOnly.code).toBe("CREDENTIAL_PREFERENCE_REJECTED");

    // The forbidden director can never be preferred either.
    const director = evaluateProviderPreference(
      { capability_id: "world.composition", requested_provider: "agent-skill.threejs-game-director", credentials_present: true },
      policy,
      CAPABILITY_CATALOG
    );
    expect(director.allowed).toBe(false);
    expect(director.code).toBe("FORBIDDEN_UPSTREAM_AUTHORITY");

    // Positive control: a declared, non-quarantined provider remains selectable by studio policy.
    const declared = evaluateProviderPreference(
      { capability_id: "asset.reconstruct", requested_provider: "agent-skill.img2threejs" },
      policy,
      CAPABILITY_CATALOG
    );
    expect(declared.allowed).toBe(true);
    expect(declared.code).toBe("ALLOWED");

    // Quarantine enforcement throws at registration/reference time too.
    expect(() => assertSkillNotQuarantined("threejs-image-generator", policy)).toThrow(QuarantinedSkillError);
    expect(() => assertSkillNotQuarantined("agent-skill.threejs-audio-generator", policy)).toThrow(QuarantinedSkillError);

    // Generators may only ever be enabled by explicit declared project policy, never implicitly.
    const enabledImplicitly = clonePolicy();
    enabledImplicitly.quarantine_policy = { enabled: true };
    expect(validateOverlayPolicy(enabledImplicitly).valid).toBe(false);
    const enabledExplicitly = clonePolicy();
    enabledExplicitly.quarantine_policy = { enabled: true, enablement_declared_by: "project.optional-fallback-policy" };
    expect(validateOverlayPolicy(enabledExplicitly).errors.filter((e) => e.includes("enablement_declared_by"))).toEqual([]);
  });
});
