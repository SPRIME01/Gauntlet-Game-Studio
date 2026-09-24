import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import * as fs from "node:fs";
import {
  validateOverlayPolicy,
  checkSkillAgainstOverlay,
  lintSourceAttribution,
  verifySingleThreeVersion,
  ForbiddenUpstreamAuthorityError,
  type SkillOverlayPolicy,
  type AttributionClassManifest,
} from "./overlay";

describe("Third-Party Skills, Overlay Policy & Attribution Classes Suite (T06)", () => {
  const overlayPath = path.resolve(__dirname, "../../../../vendor/skills/threejs-game-skills/overlay.json");
  const attributionPath = path.resolve(__dirname, "../../../../vendor/attribution.json");

  it("validates the committed overlay policy adheres to studio authority (REQ-SOURCE-005)", () => {
    expect(fs.existsSync(overlayPath)).toBe(true);
    const policy: SkillOverlayPolicy = JSON.parse(fs.readFileSync(overlayPath, "utf-8"));
    const report = validateOverlayPolicy(policy);
    expect(report.valid).toBe(true);
    expect(report.errors.length).toBe(0);
    expect(policy.orchestration_authority).toBe("gauntlet-game-studio");
    expect(policy.forbidden_skills).toContain("threejs-game-director");
  });

  it("TEETH-T06-001: REJECTS threejs-game-director as an orchestration skill (Teeth Check)", () => {
    const policy: SkillOverlayPolicy = JSON.parse(fs.readFileSync(overlayPath, "utf-8"));

    // Allowed specialist passes
    expect(() => checkSkillAgainstOverlay("gameplay-camera", policy)).not.toThrow();

    // Competing director is strictly rejected
    expect(() => checkSkillAgainstOverlay("threejs-game-director", policy)).toThrow(ForbiddenUpstreamAuthorityError);
    expect(() => checkSkillAgainstOverlay("director", policy)).toThrow(ForbiddenUpstreamAuthorityError);
  });

  it("validates third-party attribution manifest covers all 5 required classes (REQ-SOURCE-006)", () => {
    expect(fs.existsSync(attributionPath)).toBe(true);
    const manifest: AttributionClassManifest = JSON.parse(fs.readFileSync(attributionPath, "utf-8"));

    const vendorDir = path.resolve(__dirname, "../../../../vendor");
    const lintReport = lintSourceAttribution(vendorDir, manifest);
    expect(lintReport.valid).toBe(true);
    expect(lintReport.errors.length).toBe(0);

    expect(manifest.classes.runtime_dependency.length).toBeGreaterThanOrEqual(5);
    expect(manifest.classes.agent_skill_source.length).toBeGreaterThanOrEqual(3);
    expect(manifest.classes.temporary_donor.length).toBeGreaterThanOrEqual(1);
    expect(manifest.classes.external_asset.length).toBeGreaterThanOrEqual(1);
  });

  it("pins executable img2threejs and 3dviz-pro-max skill sources with matching provenance", () => {
    const manifest: AttributionClassManifest & { classes: { agent_skill_source: Array<Record<string, unknown>> } } = JSON.parse(
      fs.readFileSync(attributionPath, "utf-8")
    );
    const expected = [
      {
        id: "img2threejs",
        vendorPath: "vendor/skills/img2threejs",
        upstream: "https://github.com/img2threejs/img2threejs",
        revision: "a669e9a97cea4452b1c2310c5cca6aa0f6657c1f",
        license: "Apache-2.0",
        capability: "asset.reconstruct.reference-image",
      },
      {
        id: "3dviz-pro-max",
        vendorPath: "vendor/skills/3dviz-pro-max",
        upstream: "https://github.com/viettranx/3dviz-pro-max",
        revision: "d077e0e68915c25be8e71d74684d3144fd1c2aca",
        license: "MIT",
        capability: "world.environment.compose",
      },
    ];

    for (const source of expected) {
      const metadataPath = path.resolve(__dirname, "../../../..", source.vendorPath, "metadata.json");
      const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
      const attribution = manifest.classes.agent_skill_source.find((entry) => entry.id === source.id);
      expect(metadata).toMatchObject({
        id: source.id,
        upstream: source.upstream,
        revision: source.revision,
        license: source.license,
        capability: source.capability,
        entrypoint: "SKILL.md",
      });
      expect(attribution).toMatchObject({
        id: source.id,
        vendor_path: source.vendorPath,
        upstream: source.upstream,
        revision: source.revision,
        license: source.license,
        capability: source.capability,
      });
      expect(fs.existsSync(path.resolve(__dirname, "../../../..", source.vendorPath, "SKILL.md"))).toBe(true);
      expect(fs.existsSync(path.resolve(__dirname, "../../../..", source.vendorPath, "LICENSE"))).toBe(true);
    }
  });

  it("TEETH-T06-002: REJECTS unnecessary vendoring of standard runtime libraries (Teeth Check)", () => {
    const manifest: AttributionClassManifest = JSON.parse(fs.readFileSync(attributionPath, "utf-8"));

    // Create a temporary mock vendor directory containing an unnecessary vendored runtime library
    const mockVendorDir = path.resolve(__dirname, "../../../../.tmp/mock-vendor-teeth");
    if (fs.existsSync(mockVendorDir)) fs.rmSync(mockVendorDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(mockVendorDir, "three"), { recursive: true });

    const lintReport = lintSourceAttribution(mockVendorDir, manifest);
    expect(lintReport.valid).toBe(false);
    expect(lintReport.errors.some((e) => e.includes("must not be vendored in vendor/"))).toBe(true);

    // Cleanup
    fs.rmSync(mockVendorDir, { recursive: true, force: true });
  });

  it("verifies single standard Three.js resolution across package consumers", () => {
    const rootDir = path.resolve(__dirname, "../../../..");
    const packageJsonFiles = [
      path.join(rootDir, "templates/game/package.json"),
      path.join(rootDir, "examples/blackwater-relay/package.json"),
    ];

    const threeResult = verifySingleThreeVersion(packageJsonFiles);
    expect(threeResult.uniform).toBe(true);
    expect(threeResult.version).toBe("^0.170.0");
  });
});
