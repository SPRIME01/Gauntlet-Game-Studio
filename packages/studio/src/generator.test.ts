import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { createGameProject } from "./generator";

describe("Independent Game Project Template & Scaffold Suite (T05)", () => {
  const smokeDir = path.resolve(process.cwd(), ".tmp/test-generator-smoke");

  it("creates a well-formed independent game project from template (REQ-OUT-001, REQ-REPO-002)", () => {
    if (fs.existsSync(smokeDir)) {
      fs.rmSync(smokeDir, { recursive: true, force: true });
    }

    const res = createGameProject(smokeDir, { name: "test-smoke-game" });
    expect(res.project_name).toBe("test-smoke-game");
    expect(fs.existsSync(smokeDir)).toBe(true);

    // Required files according to REQ-OUT-001
    const requiredFiles = [
      "package.json",
      "tsconfig.json",
      "studio.lock.yaml",
      ".agents/specs/game.spec.yaml",
      ".agents/CURRENT_STATUS.yml",
      "AGENTS.md",
      "assets/manifest.json",
      "src/index.ts",
      "tests/game.test.ts",
    ];

    for (const file of requiredFiles) {
      const fullPath = path.join(smokeDir, file);
      expect(fs.existsSync(fullPath)).toBe(true);
    }

    // Verify package.json name customized
    const pkg = JSON.parse(fs.readFileSync(path.join(smokeDir, "package.json"), "utf-8"));
    expect(pkg.name).toBe("test-smoke-game");

    // Verify game spec customized
    const spec = fs.readFileSync(path.join(smokeDir, ".agents/specs/game.spec.yaml"), "utf-8");
    expect(spec).toContain('game_id: "test-smoke-game"');

    // Verify studio lock manifest structure
    const lock = fs.readFileSync(path.join(smokeDir, "studio.lock.yaml"), "utf-8");
    expect(lock).toContain("schema: gauntlet.studio.lock");
    expect(lock).toContain("world.composition:");
    expect(lock).toContain("asset.reconstruct:");
  });

  it("executes tests successfully inside generated project", () => {
    const testOut = execSync("bun test 2>&1", {
      cwd: smokeDir,
      encoding: "utf-8",
    });
    expect(testOut).toContain("pass");
  });

  it("TEETH-T05-001: Remains independently buildable when moved outside the studio monorepo (Teeth Check)", () => {
    const outsideDir = path.resolve(process.cwd(), ".tmp/outside-repo-test-game");
    if (fs.existsSync(outsideDir)) {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }

    // Copy to outside-repo location
    fs.cpSync(smokeDir, outsideDir, { recursive: true });
    expect(fs.existsSync(outsideDir)).toBe(true);

    // Run test directly in the decoupled location
    const testOut = execSync("bun test 2>&1", {
      cwd: outsideDir,
      encoding: "utf-8",
    });
    expect(testOut).toContain("pass");

    // Cleanup
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  it("TEETH-T05-002: Zero private relative-path dependencies into studio monorepo (Teeth Check)", () => {
    // Read package.json and tsconfig.json of the smoke project
    const pkgContent = fs.readFileSync(path.join(smokeDir, "package.json"), "utf-8");
    const tsconfigContent = fs.readFileSync(path.join(smokeDir, "tsconfig.json"), "utf-8");
    const srcContent = fs.readFileSync(path.join(smokeDir, "src/index.ts"), "utf-8");

    // Check for private relative paths or repository leakages
    expect(pkgContent).not.toContain("../packages");
    expect(pkgContent).not.toContain("workspace:");
    expect(tsconfigContent).not.toContain("../packages");
    expect(tsconfigContent).not.toContain("../../");
    expect(srcContent).not.toContain("@gauntlet/studio");
    expect(srcContent).not.toContain("../../../");
  });

  it("verifies examples/blackwater-relay conforms to the same contract (REQ-REPO-003)", () => {
    const exampleDir = path.resolve(process.cwd(), "examples/blackwater-relay");
    expect(fs.existsSync(exampleDir)).toBe(true);
    expect(fs.existsSync(path.join(exampleDir, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(exampleDir, "studio.lock.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(exampleDir, ".agents/specs/game.spec.yaml"))).toBe(true);

    const testOut = execSync("bun test 2>&1", {
      cwd: exampleDir,
      encoding: "utf-8",
    });
    expect(testOut).toContain("pass");
  });
});
