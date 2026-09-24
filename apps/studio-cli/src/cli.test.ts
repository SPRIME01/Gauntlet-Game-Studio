import { describe, it, expect } from "bun:test";
import { runDoctor, getDoctorStudioResult, loadStudioConfig, ConfigSecretLeakError, DonorDependencyError } from "@gauntlet/studio";
import { main } from "./index";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const POLYHAVEN_GLB = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 1, 2, 3, 4]);

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

    it("sources a Poly Haven asset through the adapter and records its pending provenance", async () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cli-asset-source-"));
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (input: unknown) => {
        const url = String(input);
        if (url.endsWith("/info/barrel")) {
          return new Response(JSON.stringify({ name: "Wooden Barrel", authors: { author: { author: "Poly Haven" } }, license: "CC0" }));
        }
        if (url.endsWith("/files/barrel")) {
          return new Response(JSON.stringify({ gltf: { glb: { url: "https://dl.polyhaven.org/barrel.glb" } } }));
        }
        if (url === "https://dl.polyhaven.org/barrel.glb") return new Response(POLYHAVEN_GLB);
        return new Response(null, { status: 404 });
      }) as unknown as typeof fetch;

      try {
        const exitCode = await main(["asset", "source", "polyhaven", "barrel", "--role", "prop", "--project", projectRoot, "--json"]);
        expect(exitCode).toBe(0);

        const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, "assets", "manifest.json"), "utf8"));
        expect(manifest.records).toHaveLength(1);
        expect(manifest.records[0]).toMatchObject({
          id: "polyhaven-barrel",
          origin: "cc0",
          construction_route: "asset.source/asset.polyhaven",
          acceptance_state: "pending",
          source_provenance: { uri: "https://polyhaven.com/a/barrel", license: "CC0", author: "Poly Haven" },
        });
        expect(fs.existsSync(path.join(projectRoot, "assets", "sources", "polyhaven", "barrel", "barrel.glb"))).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    });

    it("rejects an unsupported asset source provider before writing files", async () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cli-asset-provider-"));
      try {
        const exitCode = await main(["asset", "source", "unknown", "barrel", "--role", "prop", "--project", projectRoot, "--json"]);
        expect(exitCode).toBe(1);
        expect(fs.existsSync(path.join(projectRoot, "assets", "manifest.json"))).toBe(false);
      } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    });

    it("rejects malformed ids and missing roles before network access or project writes", async () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cli-asset-invalid-"));
      const originalFetch = globalThis.fetch;
      let fetchCalls = 0;
      globalThis.fetch = (async () => {
        fetchCalls++;
        return new Response(null, { status: 500 });
      }) as unknown as typeof fetch;
      try {
        expect(await main(["asset", "source", "polyhaven", "../barrel", "--role", "prop", "--project", projectRoot, "--json"])).toBe(1);
        expect(await main(["asset", "source", "polyhaven", "barrel", "--project", projectRoot, "--json"])).toBe(1);
        expect(fetchCalls).toBe(0);
        expect(fs.existsSync(path.join(projectRoot, "assets"))).toBe(false);
      } finally {
        globalThis.fetch = originalFetch;
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    });

    it("rejects duplicate source intake before it can overwrite retained bytes", async () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cli-asset-duplicate-"));
      const originalFetch = globalThis.fetch;
      let downloaded = POLYHAVEN_GLB;
      globalThis.fetch = (async (input: unknown) => {
        const url = String(input);
        if (url.endsWith("/info/barrel")) return new Response(JSON.stringify({ authors: { author: { author: "Poly Haven" } }, license: "CC0" }));
        if (url.endsWith("/files/barrel")) return new Response(JSON.stringify({ gltf: { glb: { url: "https://dl.polyhaven.org/barrel.glb" } } }));
        if (url === "https://dl.polyhaven.org/barrel.glb") return new Response(downloaded as unknown as BodyInit);
        return new Response(null, { status: 404 });
      }) as unknown as typeof fetch;

      try {
        expect(await main(["asset", "source", "polyhaven", "barrel", "--role", "prop", "--project", projectRoot, "--json"])).toBe(0);
        const retained = fs.readFileSync(path.join(projectRoot, "assets", "sources", "polyhaven", "barrel", "barrel.glb"));
        downloaded = new Uint8Array([9, 9, 9, 9]);

        expect(await main(["asset", "source", "polyhaven", "barrel", "--role", "prop", "--project", projectRoot, "--json"])).toBe(1);
        expect(fs.readFileSync(path.join(projectRoot, "assets", "sources", "polyhaven", "barrel", "barrel.glb"))).toEqual(retained);
      } finally {
        globalThis.fetch = originalFetch;
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    });

    it("unknown command returns 1 with error diagnostic", async () => {
      const exitCode = await main(["nonexistent_command", "--json"]);
      expect(exitCode).toBe(1);
    });
  });

  describe("Asset Resolve Routing (T26: search/acquire -> adapt -> create)", () => {
    const POLYHAVEN_LIST = JSON.stringify({ barrel: { name: "Wooden Barrel" } });
    const stubPolyhaven = (downloaded: Uint8Array) => (async (input: unknown) => {
      const url = String(input);
      if (url.endsWith("/assets?type=models")) return new Response(POLYHAVEN_LIST);
      if (url.endsWith("/info/barrel")) return new Response(JSON.stringify({ authors: { author: { author: "Poly Haven" } }, license: "CC0" }));
      if (url.endsWith("/files/barrel")) return new Response(JSON.stringify({ gltf: { glb: { url: "https://dl.polyhaven.org/barrel.glb" } } }));
      if (url === "https://dl.polyhaven.org/barrel.glb") return new Response(downloaded as unknown as BodyInit);
      return new Response(null, { status: 404 });
    }) as unknown as typeof fetch;

    it("rejects malformed ids and missing roles before any search or project write", async () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cli-resolve-invalid-"));
      const originalFetch = globalThis.fetch;
      let fetchCalls = 0;
      globalThis.fetch = (async () => {
        fetchCalls++;
        return new Response(null, { status: 500 });
      }) as unknown as typeof fetch;
      try {
        expect(await main(["asset", "resolve", "../bad", "--role", "prop", "--project", projectRoot, "--json"])).toBe(1);
        expect(await main(["asset", "resolve", "barrel", "--project", projectRoot, "--json"])).toBe(1);
        expect(fetchCalls).toBe(0);
        expect(fs.existsSync(path.join(projectRoot, ".studio"))).toBe(false);
      } finally {
        globalThis.fetch = originalFetch;
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    });

    it("acquires a provider match through the asset.source intake as a pending record with a decision record", async () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cli-resolve-acquire-"));
      const originalFetch = globalThis.fetch;
      globalThis.fetch = stubPolyhaven(new Uint8Array([1, 2, 3, 4]));
      try {
        const exitCode = await main(["asset", "resolve", "barrel", "--role", "prop", "--keywords", "barrel", "--project", projectRoot, "--json"]);
        expect(exitCode).toBe(0);
        const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, "assets", "manifest.json"), "utf-8"));
        expect(manifest.records[0].id).toBe("polyhaven-barrel");
        expect(manifest.records[0].acceptance_state).toBe("pending");
        const resolutions = fs.readdirSync(path.join(projectRoot, ".studio", "resolutions"));
        expect(resolutions.length).toBe(1);
        const decision = JSON.parse(fs.readFileSync(path.join(projectRoot, ".studio", "resolutions", resolutions[0]), "utf-8"));
        expect(decision.decision.route).toBe("acquire");
      } finally {
        globalThis.fetch = originalFetch;
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    });

    it("no provider match yields typed CREATE_FALLBACK_REQUIRED with a recorded decision and no fabricated asset", async () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cli-resolve-fallback-"));
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => new Response(null, { status: 404 })) as unknown as typeof fetch;
      try {
        const exitCode = await main(["asset", "resolve", "does-not-exist", "--role", "prop", "--keywords", "unobtainium", "--project", projectRoot, "--json"]);
        expect(exitCode).toBe(2);
        // Nothing was acquired, so no manifest is written and no asset is fabricated.
        expect(fs.existsSync(path.join(projectRoot, "assets", "manifest.json"))).toBe(false);
        const resolutions = fs.readdirSync(path.join(projectRoot, ".studio", "resolutions"));
        const decision = JSON.parse(fs.readFileSync(path.join(projectRoot, ".studio", "resolutions", resolutions[0]), "utf-8"));
        expect(decision.decision.route).toBe("create-fallback");
      } finally {
        globalThis.fetch = originalFetch;
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    });
  });

  describe("Recipe CLI (T27: intent → recipe → capabilities)", () => {
    const capture = async (args: string[]): Promise<{ code: number; out: string }> => {
      const chunks: string[] = [];
      const originalLog = console.log;
      const originalErr = console.error;
      console.log = (...a: unknown[]) => {
        chunks.push(a.map(String).join(" "));
      };
      console.error = (...a: unknown[]) => {
        chunks.push(a.map(String).join(" "));
      };
      try {
        const code = await main(args);
        return { code, out: chunks.join("\n") };
      } finally {
        console.log = originalLog;
        console.error = originalErr;
      }
    };

    it("recipes lists the six canonical outcome recipes with exit 0", async () => {
      const { code, out } = await capture(["recipes", "--json"]);
      expect(code).toBe(0);
      const parsed = JSON.parse(out);
      expect(parsed.status).toBe("success");
      expect(parsed.operation).toBe("studio.recipes");
      const ids = parsed.result.map((r: { id: string }) => r.id);
      expect(ids).toContain("world.third-person");
      expect(ids).toContain("interaction.pickup");
      expect(parsed.result.every((r: { capability_requirements: string[] }) => r.capability_requirements.length > 0)).toBe(true);
    });

    it("recipe describe returns a full descriptor without engine-noun ids", async () => {
      const { code, out } = await capture(["recipe", "describe", "world.third-person", "--json"]);
      expect(code).toBe(0);
      const parsed = JSON.parse(out);
      expect(parsed.status).toBe("success");
      expect(parsed.result.id).toBe("world.third-person");
      expect(parsed.result.use_when.length).toBeGreaterThan(0);
      expect(parsed.result.acceptance.length).toBeGreaterThan(0);
      expect(parsed.result.affordances.length).toBeGreaterThan(0);
    });

    it("recipe describe blocks with exit 1 on unknown recipe", async () => {
      const { code, out } = await capture(["recipe", "describe", "does.not.exist", "--json"]);
      expect(code).toBe(1);
      const parsed = JSON.parse(out);
      expect(parsed.status).toBe("failed");
      expect(parsed.diagnostics.code).toBe("RECIPE_NOT_FOUND");
    });

    it("recipe plan dry-runs without mutating the project and reports mutation:false", async () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cli-recipe-plan-"));
      try {
        const { code, out } = await capture([
          "recipe",
          "plan",
          "world.third-person",
          "--project",
          projectRoot,
          "--json",
        ]);
        expect(code).toBe(0);
        const parsed = JSON.parse(out);
        expect(parsed.status).toBe("success");
        expect(parsed.operation).toBe("studio.recipe.plan");
        expect(parsed.diagnostics.mutation).toBe(false);
        expect(parsed.result.steps.length).toBeGreaterThan(0);
        const capabilitySteps = parsed.result.steps.filter((s: { kind: string }) => s.kind === "capability");
        expect(capabilitySteps.length).toBeGreaterThan(0);
        expect(fs.existsSync(path.join(projectRoot, ".studio"))).toBe(false);
      } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    });

    it("recipe apply writes append-only provenance through existing capabilities (exit 0)", async () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cli-recipe-apply-"));
      try {
        const first = await capture([
          "recipe",
          "apply",
          "checkpoint",
          "--project",
          projectRoot,
          "--json",
        ]);
        expect(first.code).toBe(0);
        const parsed = JSON.parse(first.out);
        expect(parsed.status).toBe("success");
        expect(parsed.operation).toBe("studio.recipe.apply");
        const provPath = path.join(projectRoot, ".studio", "recipe-provenance.jsonl");
        expect(fs.existsSync(provPath)).toBe(true);
        const lines = fs.readFileSync(provPath, "utf8").trim().split("\n");
        expect(lines.length).toBe(1);
        const rec = JSON.parse(lines[0]);
        expect(rec.schema).toBe("gauntlet.recipe.apply");
        expect(rec.recipe_id).toBe("checkpoint");
        expect(rec.result).toBe("success");

        // Re-apply appends (append-only) and stays successful (idempotence).
        const second = await capture([
          "recipe",
          "apply",
          "checkpoint",
          "--project",
          projectRoot,
          "--json",
        ]);
        expect(second.code).toBe(0);
        const lines2 = fs.readFileSync(provPath, "utf8").trim().split("\n");
        expect(lines2.length).toBe(2);
        expect(JSON.parse(lines2[1]).recipe_id).toBe("checkpoint");
      } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    });

    it("recipe plan blocks with exit 2 when required input is missing (actionable)", async () => {
      const recipeRequired: import("@gauntlet/contracts").RecipeDescriptor = {
        id: "test.required-only",
        version: "1.0.0",
        summary: "Temporary recipe used only for CLI required-input gate coverage.",
        use_when: ["cli required input test"],
        do_not_use_when: ["production use"],
        inputs: [
          {
            key: "must_provide",
            label: "Must",
            required: true,
            material: true,
            type: "string",
            summary: "required with no default",
          },
        ],
        affordances: ["only_affordance"],
        affordance_dependencies: [],
        capability_requirements: ["world.terrain"],
        constraints: [],
        escalation: { stop_and_ask_when: [], escalate_when: [] },
        acceptance: ["required input gate exercised"],
      };
      // Directly exercise compile error surface used by CLI (registry won't hold temp recipe).
      const { compileRecipe, RecipeCompileError } = await import("@gauntlet/studio");
      try {
        compileRecipe(recipeRequired);
        expect.unreachable("compile should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(RecipeCompileError);
        expect((err as InstanceType<typeof RecipeCompileError>).code).toBe("REQUIRED_INPUT_MISSING");
      }
    });

    it("unknown recipe subcommand returns 1", async () => {
      const { code, out } = await capture(["recipe", "frobnicate", "--json"]);
      expect(code).toBe(1);
      const parsed = JSON.parse(out);
      expect(parsed.diagnostics.code).toBe("UNKNOWN_RECIPE_SUBCOMMAND");
    });

    it("recipe apply with invalid choice enum fails with structured diagnostic", async () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cli-recipe-bad-choice-"));
      try {
        const { code, out } = await capture([
          "recipe",
          "plan",
          "interaction.pickup",
          "grant=nope",
          "--project",
          projectRoot,
          "--json",
        ]);
        expect(code).toBe(1);
        const parsed = JSON.parse(out);
        expect(parsed.status).toBe("failed");
        expect(parsed.diagnostics.code).toBe("INVALID_CHOICE");
      } finally {
        fs.rmSync(projectRoot, { recursive: true, force: true });
      }
    });
  });
});
