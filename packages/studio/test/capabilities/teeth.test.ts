/**
 * T14 preregistered falsifiers (.agents/preregistrations/
 * gauntlet-game-studio-plan-T14.prereg.yaml, frozen before implementation):
 *
 *   TEETH-T14-001: Remove the required reference image and run capability
 *     preparation. Expected: request blocks/asks for allowed reference rather
 *     than silently becoming generic text-to-3D.
 *   TEETH-T14-002: Remove all model credentials/network access and run
 *     deterministic result verification. Expected: committed accepted output is
 *     verified without regeneration.
 *   TEETH-T14-003: Resolve the accepted output against a second Three.js
 *     installation. Expected: compatibility guard fails.
 */

import { describe, expect, it } from "bun:test";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  ASSET_RECONSTRUCT_REFERENCE_IMAGE_CAPABILITY,
  prepareReferenceImageReconstruction,
  resolvePinnedThree,
  verifyImg2ThreeJsResult,
} from "@gauntlet/adapters";
import { defaultCapabilityRegistry } from "@gauntlet/studio";
import { main } from "../../../../apps/studio-cli/src/index";

const REPO_ROOT = path.resolve(import.meta.dir, "../../../..");
const EXAMPLE_ROOT = path.join(REPO_ROOT, "examples", "blackwater-relay");
const REQUEST_PATH = path.join(EXAMPLE_ROOT, ".studio", "requests", "transceiver.yaml");
const RESULT_PATH = path.join(EXAMPLE_ROOT, ".studio", "results", "transceiver.yaml");
const MODULE_PATH = path.join(EXAMPLE_ROOT, "src", "assets", "field-transceiver.ts");

const MODEL_CREDENTIAL_VARS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "HUGGINGFACE_API_KEY",
  "HF_TOKEN",
  "REPLICATE_API_TOKEN",
  "GOOGLE_AI_API_KEY",
  "STABILITY_API_KEY",
  "MESHY_API_KEY",
  "TRIPO_API_KEY",
];

function withTempProject(): { root: string; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "t14-teeth-"));
  fs.mkdirSync(path.join(root, ".studio", "requests"), { recursive: true });
  fs.mkdirSync(path.join(root, ".studio", "results"), { recursive: true });
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

describe("T14 teeth", () => {
  it("TEETH-T14-001: removing the reference blocks preparation and asks for an allowed reference (never generic text-to-3D)", async () => {
    const base = fs.readFileSync(REQUEST_PATH, "utf-8");
    const withoutReferences = base
      .replace(/ {2}references:\n( +.*\n)+/g, "") // drop the inputs.references block
      .replace(/reference_ids:\n( +.*\n)+/g, ""); // and reference_ids

    const { root, cleanup } = withTempProject();
    try {
      // Variant A: no references declared at all.
      const requestPathA = path.join(root, ".studio", "requests", "no-reference.yaml");
      fs.writeFileSync(requestPathA, withoutReferences);
      const exitA = await main(["capability", "prepare", ASSET_RECONSTRUCT_REFERENCE_IMAGE_CAPABILITY, requestPathA, "--json"]);
      expect(exitA).toBe(1);

      // Variant B: reference declared but the image file removed (nonexistent path).
      const requestPathB = path.join(root, ".studio", "requests", "removed-image.yaml");
      fs.writeFileSync(
        requestPathB,
        withoutReferences.replace(
          /inputs:/,
          `inputs:\n  references:\n    - id: field-transceiver-ref\n      path: references/field-transceiver/removed.png\n      provenance_class: project-generated-reference-fixture\n      license: in-house-generated`
        )
      );
      const exitB = await main(["capability", "prepare", ASSET_RECONSTRUCT_REFERENCE_IMAGE_CAPABILITY, requestPathB, "--json"]);
      expect(exitB).toBe(1);
    } finally {
      cleanup();
    }

    // Library-level: the block is typed, names the missing evidence, offers the
    // allowed next references, and never degrades into a generic capability.
    const request = JSON.parse(JSON.stringify(Bun.YAML.parse(base)));
    delete request.inputs.references;
    delete request.reference_ids;
    const capability = defaultCapabilityRegistry.get(ASSET_RECONSTRUCT_REFERENCE_IMAGE_CAPABILITY)!;
    const prep = prepareReferenceImageReconstruction(request, capability, {
      projectRoot: EXAMPLE_ROOT,
      repoRoot: REPO_ROOT,
    });
    expect(prep.status).toBe("blocked");
    if (prep.status !== "blocked") return;
    expect(prep.code).toBe("REFERENCE_REQUIRED");
    expect(prep.allowed_next_steps.join(" ")).toContain("reference");
    expect(prep.capability_id).toBe(ASSET_RECONSTRUCT_REFERENCE_IMAGE_CAPABILITY);
  });

  it("TEETH-T14-002: verification passes with model credentials removed and network poisoned, without regenerating output", async () => {
    const savedEnv: Record<string, string | undefined> = {};
    for (const key of MODEL_CREDENTIAL_VARS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    let networkAttempts = 0;
    const originalFetch = globalThis.fetch;
    const poisonedFetch = ((...args: unknown[]) => {
      networkAttempts++;
      throw new Error("TEETH-T14-002: network access attempted during deterministic verification");
    }) as typeof fetch;
    globalThis.fetch = poisonedFetch;

    const moduleShaBefore = crypto.createHash("sha256").update(fs.readFileSync(MODULE_PATH)).digest("hex");
    try {
      const raw = Bun.YAML.parse(fs.readFileSync(RESULT_PATH, "utf-8"));
      const outcome = await verifyImg2ThreeJsResult(raw, {
        resultPath: RESULT_PATH,
        projectRoot: EXAMPLE_ROOT,
        repoRoot: REPO_ROOT,
        capabilityId: ASSET_RECONSTRUCT_REFERENCE_IMAGE_CAPABILITY,
      });
      const failed = outcome.checks.filter((c) => c.status === "fail").map((c) => c.id);
      expect(failed).toEqual([]);
      expect(outcome.ok).toBe(true);
      expect(networkAttempts).toBe(0);
      // The committed accepted output was verified, not regenerated.
      const moduleShaAfter = crypto.createHash("sha256").update(fs.readFileSync(MODULE_PATH)).digest("hex");
      expect(moduleShaAfter).toBe(moduleShaBefore);
    } finally {
      globalThis.fetch = originalFetch;
      for (const key of MODEL_CREDENTIAL_VARS) {
        if (savedEnv[key] !== undefined) process.env[key] = savedEnv[key];
      }
    }
  });

  it("TEETH-T14-002 (CLI surface): studio capability verify-result succeeds in a credential-stripped subprocess", async () => {
    const env = { ...process.env };
    for (const key of MODEL_CREDENTIAL_VARS) delete env[key];
    const proc = Bun.spawnSync([
      "bun",
      "run",
      "./apps/studio-cli/src/index.ts",
      "capability",
      "verify-result",
      ASSET_RECONSTRUCT_REFERENCE_IMAGE_CAPABILITY,
      "examples/blackwater-relay/.studio/results/transceiver.yaml",
      "--json",
    ], {
      cwd: REPO_ROOT,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(proc.exitCode).toBe(0);
    const stdout = new TextDecoder().decode(proc.stdout);
    const jsonStart = stdout.indexOf("{");
    const parsed = JSON.parse(stdout.slice(jsonStart, stdout.lastIndexOf("}") + 1));
    expect(parsed.status).toBe("success");
    expect(parsed.diagnostics.model_invocation).toBe("none");
    expect(parsed.diagnostics.network_access).toBe("none");
  });

  it("TEETH-T14-003: a second Three.js installation fails the compatibility guard", async () => {
    const { root, cleanup } = withTempProject();
    try {
      // Forge a private second three installation under the project root.
      const secondInstall = path.join(root, "node_modules", "three");
      fs.mkdirSync(secondInstall, { recursive: true });
      fs.writeFileSync(
        path.join(secondInstall, "package.json"),
        JSON.stringify({ name: "three", version: "0.999.9-private", main: "index.js" })
      );
      fs.writeFileSync(path.join(secondInstall, "index.js"), "export const Group = 0;\n");

      // Guard unit level: two distinct installations are rejected.
      const guard = resolvePinnedThree(
        [
          path.join(REPO_ROOT, "templates", "game", "package.json"),
          path.join(EXAMPLE_ROOT, "package.json"),
          path.join(REPO_ROOT, "packages", "runtime", "package.json"),
        ],
        [REPO_ROOT, EXAMPLE_ROOT, path.join(REPO_ROOT, "packages", "runtime"), root]
      );
      expect(guard.ok).toBe(false);
      expect(guard.code).toBe("MULTIPLE_THREE_INSTALLATIONS");

      // Full pipeline level: verification of the committed output fails the guard.
      const raw = Bun.YAML.parse(fs.readFileSync(RESULT_PATH, "utf-8"));
      const outcome = await verifyImg2ThreeJsResult(raw, {
        resultPath: RESULT_PATH,
        projectRoot: EXAMPLE_ROOT,
        repoRoot: REPO_ROOT,
        capabilityId: ASSET_RECONSTRUCT_REFERENCE_IMAGE_CAPABILITY,
        searchRoots: [REPO_ROOT, EXAMPLE_ROOT, path.join(REPO_ROOT, "packages", "runtime"), root],
      });
      expect(outcome.ok).toBe(false);
      const guardCheck = outcome.checks.find((c) => c.id === "THREE_RESOLUTION_GUARD");
      expect(guardCheck?.status).toBe("fail");
      expect(guardCheck?.detail).toContain("MULTIPLE_THREE_INSTALLATIONS");
    } finally {
      cleanup();
    }
  });
});
