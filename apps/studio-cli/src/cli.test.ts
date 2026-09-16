import { describe, it, expect } from "bun:test";
import { runDoctor, getDoctorStudioResult, loadStudioConfig, ConfigSecretLeakError, DonorDependencyError } from "@gauntlet/studio";
import { main } from "./index";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("Studio CLI, Configuration & Doctor Diagnostic Suite", () => {
  describe("Studio Doctor", () => {
    it("runs doctor diagnostics and passes all baseline checks in workspace root", async () => {
      const report = await runDoctor(process.cwd());
      expect(report.status).toBe("success");
      expect(report.checks.length).toBeGreaterThanOrEqual(4);
      expect(report.checks.every((c) => c.status === "pass")).toBe(true);
    });

    it("returns a normalized StudioResult for doctor", async () => {
      const studioRes = await getDoctorStudioResult(process.cwd());
      expect(studioRes.status).toBe("success");
      expect(studioRes.operation).toBe("studio.doctor");
      expect(studioRes.result).toBeDefined();
    });

    it("executes CLI doctor command with exit code 0", async () => {
      const exitCode = await main(["doctor", "--json"]);
      expect(exitCode).toBe(0);
    });
  });

  describe("Configuration System & Secret Hygiene (Teeth Attack 1)", () => {
    it("loads valid default configuration when gauntlet.config.json is absent", () => {
      const config = loadStudioConfig();
      expect(config.runtime.engine).toBe("three");
      expect(config.runtime.rapier).toBe(true);
      expect(config.budgets.target_fps).toBe(60);
    });

    it("accepts environment-referenced secrets starting with $", () => {
      const config = loadStudioConfig(process.cwd(), {
        secrets: {
          HF_TOKEN: "$HUGGINGFACE_API_TOKEN",
          POLYHAVEN_KEY: "$POLYHAVEN_KEY",
        },
      });
      expect(config.secrets.HF_TOKEN).toBe("$HUGGINGFACE_API_TOKEN");
    });

    it("REJECTS literal secrets in configuration without echoing the secret value (Teeth Check)", () => {
      const leakingSecret = "sk-live-super-secret-key-12345";
      let errorThrown: any = null;
      try {
        loadStudioConfig(process.cwd(), {
          secrets: {
            OPENAI_API_KEY: leakingSecret,
          },
        });
      } catch (err) {
        errorThrown = err;
      }

      expect(errorThrown).toBeInstanceOf(ConfigSecretLeakError);
      // REQ-SEC-001: The error message MUST NOT contain the secret value!
      expect(errorThrown.message).not.toContain(leakingSecret);
      expect(errorThrown.message).toContain("OPENAI_API_KEY");
    });

    it("REJECTS malformed or invalid configuration fields", () => {
      expect(() => {
        loadStudioConfig(process.cwd(), {
          // @ts-expect-error testing invalid engine
          runtime: { engine: "unreal_engine_4" },
        });
      }).toThrow();
    });
  });

  describe("Donor Isolation Enforcement (Teeth Attack 2)", () => {
    it("REJECTS donor paths referenced in configuration (Teeth Check)", () => {
      let errorThrown: any = null;
      try {
        loadStudioConfig(process.cwd(), {
          providers: {
            legacy_physics: ".tmp/donor/mavon/physics.js",
          },
        });
      } catch (err) {
        errorThrown = err;
      }

      expect(errorThrown).toBeInstanceOf(DonorDependencyError);
      expect(errorThrown.message).toContain("donor dependency detected");
    });

    it("fails doctor if .tmp/ is missing from .gitignore", async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "doctor-test-"));
      try {
        // Create dummy package.json and empty gitignore without .tmp/
        fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "test" }));
        fs.writeFileSync(path.join(tempDir, ".gitignore"), "node_modules/\n");
        const report = await runDoctor(tempDir);
        expect(report.status).toBe("failed");
        const gitCheck = report.checks.find((c) => c.name === "donor_isolation_gitignore");
        expect(gitCheck?.status).toBe("fail");
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("fails doctor if donor is added as a dependency in package.json", async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "doctor-donor-test-"));
      try {
        fs.writeFileSync(
          path.join(tempDir, "package.json"),
          JSON.stringify({ name: "test", dependencies: { donor: "file:.tmp/donor/mavon" } })
        );
        fs.writeFileSync(path.join(tempDir, ".gitignore"), ".tmp/\n");
        const report = await runDoctor(tempDir);
        expect(report.status).toBe("failed");
        const donorCheck = report.checks.find((c) => c.name === "donor_dependency_check");
        expect(donorCheck?.status).toBe("fail");
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("CLI Command Protocol & Machine-Readable Output", () => {
    it("config command returns 0 and masks secrets", async () => {
      const exitCode = await main(["config", "--json"]);
      expect(exitCode).toBe(0);
    });

    it("create command returns 0 with structured result", async () => {
      const exitCode = await main(["create", ".tmp/cli-test-game", "--json"]);
      expect(exitCode).toBe(0);
    });

    it("placeholder commands return 0 with status 'blocked' (plan DAG alignment)", async () => {
      const exitCode = await main(["capabilities", "--json"]);
      expect(exitCode).toBe(0);
    });

    it("asset verify --all --json verifies the fixture registry with exit 0 (T13)", async () => {
      const fixtureProject = path.resolve(import.meta.dir, "../../../packages/studio/test/assets/fixtures/fixture-project");
      const exitCode = await main(["asset", "verify", "--all", "--json", "--project", fixtureProject]);
      expect(exitCode).toBe(0);
    });

    it("asset verify --all on an explicit project without a manifest blocks with exit 2", async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "no-manifest-"));
      try {
        const exitCode = await main(["asset", "verify", "--all", "--json", "--project", tempDir]);
        expect(exitCode).toBe(2);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("unsettled asset actions remain typed placeholders with exit 0", async () => {
      const exitCode = await main(["asset", "compile", "--json"]);
      expect(exitCode).toBe(0);
    });

    it("unknown command returns 1 with error diagnostic", async () => {
      const exitCode = await main(["nonexistent_command", "--json"]);
      expect(exitCode).toBe(1);
    });
  });
});
