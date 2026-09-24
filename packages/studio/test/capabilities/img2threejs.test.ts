/**
 * T14: img2threejs reference-reconstruction handoff and deterministic fixture
 * verification (REQ-BIND-006, REQ-ASSET-001, REQ-ASSET-002, REQ-ASSET-004).
 *
 * These are the positive-path settlement checks; the three preregistered
 * falsifiers live in ./teeth.test.ts.
 */

import { describe, expect, it } from "bun:test";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  ASSET_RECONSTRUCT_REFERENCE_IMAGE_CAPABILITY,
  PINNED_SKILL_ENTRYPOINT_REF,
  PINNED_SKILL_METADATA_REF,
  decodePngGrayscale,
  gridIoU,
  normalizePinnedVersion,
  prepareReferenceImageReconstruction,
  resolvePinnedThree,
  silhouetteGridFromGeometry,
  silhouetteGridFromImage,
  verifyImg2ThreeJsResult,
} from "@gauntlet/adapters";
import {
  CAPABILITY_CATALOG,
  defaultCapabilityRegistry,
  lintSkillDescriptor,
  routeCapability,
} from "@gauntlet/studio";
import { validateCapabilityRequest, type CapabilityRequest } from "@gauntlet/contracts";

const REPO_ROOT = path.resolve(import.meta.dir, "../../../..");
const EXAMPLE_ROOT = path.join(REPO_ROOT, "examples", "blackwater-relay");
const REQUEST_PATH = path.join(EXAMPLE_ROOT, ".studio", "requests", "transceiver.yaml");
const RESULT_PATH = path.join(EXAMPLE_ROOT, ".studio", "results", "transceiver.yaml");
const REFERENCE_PATH = path.join(EXAMPLE_ROOT, "references", "field-transceiver", "reference.png");
const MODULE_PATH = path.join(EXAMPLE_ROOT, "src", "assets", "field-transceiver.ts");

function loadRequest(): CapabilityRequest {
  return validateCapabilityRequest(Bun.YAML.parse(fs.readFileSync(REQUEST_PATH, "utf-8")));
}

describe("T14: asset.reconstruct.reference-image capability binding (REQ-BIND-006)", () => {
  it("registers the capability in the catalog with precise boundaries", () => {
    const cap = CAPABILITY_CATALOG.find((c) => c.id === ASSET_RECONSTRUCT_REFERENCE_IMAGE_CAPABILITY);
    expect(cap).toBeDefined();
    expect(cap?.providers).toEqual(["agent-skill.img2threejs"]);
    expect(cap?.requires_user_reference).toBe(true);
    const negatives = (cap?.do_not_use_when ?? []).join(" ").toLowerCase();
    expect(negatives).toContain("text-to-3d");
    expect(negatives).toContain("environment");
    expect(negatives).toContain("terrain");
    const positives = (cap?.use_when ?? []).join(" ").toLowerCase();
    expect(positives).toContain("reference");
    // Routing-description contract holds for the new entry.
    const errors = lintSkillDescriptor(cap!).filter((i) => i.severity === "error");
    expect(errors.length).toBe(0);
    expect(defaultCapabilityRegistry.has(ASSET_RECONSTRUCT_REFERENCE_IMAGE_CAPABILITY)).toBe(true);
  });

  it("binds exclusively to the pinned img2threejs vendor skill content", () => {
    const metadata = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, PINNED_SKILL_METADATA_REF), "utf-8"));
    expect(metadata).toMatchObject({
      id: "img2threejs",
      role: "agent_skill_source",
      version: "2.0.0",
      license: "Apache-2.0",
      revision: "a669e9a97cea4452b1c2310c5cca6aa0f6657c1f",
      entrypoint: "SKILL.md",
    });
    expect(fs.existsSync(path.join(REPO_ROOT, PINNED_SKILL_ENTRYPOINT_REF))).toBe(true);
    expect(fs.existsSync(path.join(REPO_ROOT, "vendor/skills/img2threejs/LICENSE"))).toBe(true);
  });
});

describe("T14: AgentHandoff normalization with validated reference imagery", () => {
  it("normalizes the committed request into a handoff pinned to vendor skill content", () => {
    const request = loadRequest();
    const capability = defaultCapabilityRegistry.get(ASSET_RECONSTRUCT_REFERENCE_IMAGE_CAPABILITY)!;
    const prep = prepareReferenceImageReconstruction(request, capability, {
      projectRoot: EXAMPLE_ROOT,
      repoRoot: REPO_ROOT,
    });
    expect(prep.status).toBe("ready");
    if (prep.status !== "ready") return;
    expect(prep.handoff.skill_id).toBe("img2threejs");
    expect(prep.handoff.instructions_ref).toBe(PINNED_SKILL_ENTRYPOINT_REF);
    expect(prep.handoff.request_id).toBe(request.id);
    expect(prep.handoff.acceptance.length).toBeGreaterThan(0);
    const ref = prep.references[0];
    expect(ref.reference_only).toBe(true);
    expect(ref.provenance_class).toBe("project-generated-reference-fixture");
    const actualSha = crypto.createHash("sha256").update(fs.readFileSync(REFERENCE_PATH)).digest("hex");
    expect(ref.sha256).toBe(actualSha);
  });

  it("routes the request as an agent-skill handoff, never a deterministic route", () => {
    const resolution = routeCapability(loadRequest());
    expect(resolution.status).toBe("routed");
    expect(resolution.capability.id).toBe(ASSET_RECONSTRUCT_REFERENCE_IMAGE_CAPABILITY);
    expect(resolution.provider).toBe("agent-skill.img2threejs");
    expect(resolution.is_agent_handoff).toBe(true);
  });
});

describe("T14: deterministic offline verification of the committed accepted output", () => {
  it("re-derives every claim from disk and passes without model or network", async () => {
    const raw = Bun.YAML.parse(fs.readFileSync(RESULT_PATH, "utf-8"));
    const outcome = await verifyImg2ThreeJsResult(raw, {
      resultPath: RESULT_PATH,
      projectRoot: EXAMPLE_ROOT,
      repoRoot: REPO_ROOT,
      capabilityId: ASSET_RECONSTRUCT_REFERENCE_IMAGE_CAPABILITY,
    });
    const failed = outcome.checks.filter((c) => c.status === "fail");
    expect(failed).toEqual([]);
    expect(outcome.ok).toBe(true);
    expect(outcome.recomputed.similarity).toBeGreaterThanOrEqual(0.5);
    expect(outcome.recomputed.triangles).toBe(128);
    expect(outcome.recomputed.pinned_three?.version).toBe("0.170.0");
  });

  it("instantiates the module against the single pinned three installation", async () => {
    const { importProceduralModuleAgainstPinnedThree, instantiateProceduralModule } = await import("@gauntlet/adapters");
    const resolution = resolvePinnedThree(
      [
        path.join(REPO_ROOT, "templates", "game", "package.json"),
        path.join(EXAMPLE_ROOT, "package.json"),
        path.join(REPO_ROOT, "packages", "runtime", "package.json"),
      ],
      [REPO_ROOT, EXAMPLE_ROOT, path.join(REPO_ROOT, "packages", "runtime")]
    );
    expect(resolution.ok).toBe(true);
    const staged = await importProceduralModuleAgainstPinnedThree(MODULE_PATH, resolution.pinned!.realDir);
    try {
      const asset = instantiateProceduralModule(staged);
      for (const required of ["socket-power", "socket-antenna", "collider-body", "transceiver-body"]) {
        expect(asset.node_names).toContain(required);
      }
      expect(asset.triangles).toBe(128);
    } finally {
      staged.cleanup();
    }
  });
});

describe("T14: reference-comparison evidence primitives", () => {
  it("decodes the committed grayscale PNG and extracts the expected silhouette grid", () => {
    const image = decodePngGrayscale(new Uint8Array(fs.readFileSync(REFERENCE_PATH)));
    expect(image.width).toBe(96);
    expect(image.height).toBe(64);
    const { grid, dark_pixels } = silhouetteGridFromImage(image);
    expect(dark_pixels).toBeGreaterThan(0);
    // Antenna occupies the top-center cells; body the lower full-width rows.
    expect(grid[0][3]).toBe(true);
    expect(grid[0][4]).toBe(true);
    expect(grid[0][0]).toBe(false);
    expect(grid.slice(3).every((row) => row.every((cell) => cell))).toBe(true);
  });

  it("scores identical grids at 1 and disjoint grids at 0", () => {
    const a = [
      [true, false],
      [false, true],
    ];
    expect(gridIoU(a, a)).toBe(1);
    const b = [
      [false, true],
      [true, false],
    ];
    expect(gridIoU(a, b)).toBe(0);
  });

  it("normalizes semver ranges when pinning", () => {
    expect(normalizePinnedVersion("^0.170.0")).toBe("0.170.0");
    expect(normalizePinnedVersion("~1.2.3")).toBe("1.2.3");
    expect(normalizePinnedVersion(">=0.170.0")).toBe("0.170.0");
    expect(normalizePinnedVersion("0.170.0")).toBe("0.170.0");
  });

  it("front-projects geometry samples into a top-down occupancy grid", () => {
    const grid = silhouetteGridFromGeometry(
      Array.from({ length: 50 }, (_, i) => ({ x: i / 50, y: i / 50 }))
    );
    expect(grid.length).toBe(8);
    expect(grid[0][7]).toBe(true); // top-right corner present
  });
});
