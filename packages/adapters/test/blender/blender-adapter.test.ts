/**
 * dcc.blender.process adapter unit tests (T18).
 *
 * Covers preflight discovery/version recording, escalation rationale
 * validation (REQ-BLENDER-002), the DCC metadata authority boundary
 * (REQ-BLENDER-005), and the deterministic invocation contract. All Blender
 * interaction is injected — these tests never launch Blender themselves.
 */

import { describe, expect, it } from "bun:test";
import { checkBlenderPreflight, parseBlenderVersionLine } from "../../src/dcc/blender/preflight";
import { blenderBackgroundArgv, runBlenderBackgroundScript } from "../../src/dcc/blender/invoke";
import { validateEscalationRationale } from "../../src/dcc/blender/escalation";
import {
  assertNoGameSemanticsInBlendMetadata,
  listBlendSemanticFindings,
  BlendSemanticAuthorityError,
} from "../../src/dcc/blender/authority";
import { loadServiceDroneDefinition } from "../../src/dcc/blender/pipeline";

describe("blender preflight", () => {
  it("discovers blender and records the version verbatim", async () => {
    const preflight = await checkBlenderPreflight({
      which: () => "/usr/bin/blender",
      probeVersion: async () => ({ ok: true, firstLine: "Blender 5.2.2 LTS (hash d13f752e3b9c built 2026-09-15 01:34:58)" }),
    });
    expect(preflight.available).toBe(true);
    expect(preflight.executable).toBe("/usr/bin/blender");
    expect(preflight.version).toBe("5.2.2 LTS");
  });

  it("reports typed scoped unavailability when blender is absent", async () => {
    const preflight = await checkBlenderPreflight({ which: () => null });
    expect(preflight.available).toBe(false);
    expect(preflight.detail).toContain("regeneration");
    expect(preflight.detail).toContain("without Blender");
  });

  it("refuses an unparseable DCC build", async () => {
    const preflight = await checkBlenderPreflight({
      which: () => "/usr/bin/blender",
      probeVersion: async () => ({ ok: true, firstLine: "mystery builder" }),
    });
    expect(preflight.available).toBe(false);
  });

  it("parses both --version and banner probe line shapes", () => {
    expect(parseBlenderVersionLine("Blender 5.2.2 LTS")).toBe("5.2.2 LTS");
    expect(parseBlenderVersionLine("Blender 5.2.2 LTS (hash d13f752e3b9c built 2026-09-15 01:34:58)")).toBe("5.2.2 LTS");
    expect(parseBlenderVersionLine("")).toBeNull();
  });
});

describe("escalation rationale (REQ-BLENDER-002)", () => {
  it("accepts a rationale that records rejected lighter routes", () => {
    const check = validateEscalationRationale({
      requested_operation: "cross-rig retarget",
      reason: "Constraint retargeting with visual-keying bake needs DCC representational power.",
      rejected_routes: [{ route: "procedural-three-animation", reason: "cannot retarget between rigs" }],
    });
    expect(check.ok).toBe(true);
  });

  it("blocks a request without a rationale or without rejected routes", () => {
    const missing = validateEscalationRationale(undefined);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe("ESCALATION_RATIONALE_REQUIRED");

    const empty = validateEscalationRationale({
      requested_operation: "op",
      reason: "a sufficiently long justification string",
      rejected_routes: [],
    });
    expect(empty.ok).toBe(false);

    const trivial = validateEscalationRationale({
      requested_operation: "op",
      reason: "short",
      rejected_routes: [{ route: "x", reason: "y" }],
    });
    expect(trivial.ok).toBe(false);
  });
});

describe("DCC metadata authority boundary (REQ-BLENDER-005)", () => {
  it("accepts structural provenance metadata", () => {
    expect(() =>
      assertNoGameSemanticsInBlendMetadata({ gw_asset_id: "service-drone", gw_route: "dcc.blender.process" })
    ).not.toThrow();
  });

  it("rejects quest/NPC gameplay semantics with findings", () => {
    try {
      assertNoGameSemanticsInBlendMetadata({
        quest_state: "stage_2_active",
        npc: { drone_hostility: true },
        nested: { objective_marker: "beacon" },
      });
      throw new Error("expected BlendSemanticAuthorityError");
    } catch (err) {
      expect(err).toBeInstanceOf(BlendSemanticAuthorityError);
      const findings = listBlendSemanticFindings({
        quest_state: "stage_2_active",
        npc: { drone_hostility: true },
        nested: { objective_marker: "beacon" },
      });
      expect(findings.length).toBe(3);
      expect(findings.map((f) => f.key).sort()).toEqual(["npc", "objective_marker", "quest_state"]);
    }
  });
});

describe("deterministic invocation contract", () => {
  it("builds the exact background argv", () => {
    const argv = blenderBackgroundArgv({
      executable: "blender",
      scriptPath: "/scripts/gen.py",
      args: ["a.json", "out.blend"],
    });
    expect(argv).toEqual([
      "blender",
      "--background",
      "--factory-startup",
      "--python",
      "/scripts/gen.py",
      "--",
      "a.json",
      "out.blend",
    ]);
  });

  it("captures exit codes from a trivial deterministic subprocess", async () => {
    // Exercises the invocation machinery with /bin/true-shaped behavior via
    // the same spawn path (no Blender needed).
    const result = await runBlenderBackgroundScript({
      executable: "true",
      scriptPath: "unused",
      args: [],
    });
    expect(result.ok).toBe(true);
    expect(result.argv[1]).toBe("--background");
    expect(result.argv[2]).toBe("--factory-startup");
  });
});

describe("source definition intake", () => {
  it("rejects an invalid definition structurally", () => {
    const check = loadServiceDroneDefinition("/nonexistent/service-drone.json");
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.code).toBe("SOURCE_DEFINITION_INVALID");
  });

  it("rejects gameplay semantics before any Blender run", () => {
    const { mkdtempSync, writeFileSync } = require("node:fs");
    const { tmpdir } = require("node:os");
    const { join } = require("node:path");
    const dir = mkdtempSync(join(tmpdir(), "t18-poison-"));
    const poisoned = join(dir, "poison.source.json");
    writeFileSync(
      poisoned,
      JSON.stringify({
        schema: "gauntlet.dcc.blender.retarget_source",
        asset_id: "drone",
        source_rig: { armature: "S" },
        target_rig: { armature: "T" },
        mesh: { parts: [{ name: "m", bone: "b", center: [0, 0, 0], size: [1, 1, 1] }] },
        bake: {},
        export: {},
        dcc_metadata: { quest_state: "active", npc_dialogue: "hostile" },
      })
    );
    const check = loadServiceDroneDefinition(poisoned);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.code).toBe("DCC_METADATA_REJECTED");
  });
});
