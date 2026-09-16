/**
 * dcc.blender.process capability surface tests (T18).
 *
 * Validates the catalog descriptor (contracts-strict), routing registration,
 * and the prepare contract end to end through the same modules the CLI uses:
 * rationale required (REQ-BLENDER-002), DCC metadata authority boundary
 * (REQ-BLENDER-005), and typed scoped BLENDER_UNAVAILABLE blockage
 * (REQ-BLENDER-007) — all without launching Blender.
 */

import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { defaultCapabilityRegistry } from "@gauntlet/studio";
import { validateCapabilityRequest } from "@gauntlet/contracts";
import {
  DCC_BLENDER_PROCESS_CAPABILITY,
  prepareBlenderProcess,
} from "@gauntlet/adapters";

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..", "..");
const projectRoot = path.join(repoRoot, "examples", "blackwater-relay");

function loadCommittedRequest(): ReturnType<typeof validateCapabilityRequest> {
  const raw = Bun.YAML.parse(
    fs.readFileSync(path.join(projectRoot, ".studio", "requests", "service-drone-retarget.yaml"), "utf-8")
  );
  return validateCapabilityRequest(raw);
}

describe("dcc.blender.process capability surface", () => {
  it("is registered with a contracts-valid descriptor bound to dcc.blender", () => {
    expect(defaultCapabilityRegistry.has(DCC_BLENDER_PROCESS_CAPABILITY)).toBe(true);
    const capability = defaultCapabilityRegistry.get(DCC_BLENDER_PROCESS_CAPABILITY)!;
    expect(capability.providers).toContain("dcc.blender");
    expect(capability.do_not_use_when.length).toBeGreaterThan(0);
    expect(capability.summary.length).toBeLessThanOrEqual(1024);
  });

  it("prepares ready against the committed request when preflight allows", async () => {
    const request = loadCommittedRequest();
    const capability = defaultCapabilityRegistry.get(DCC_BLENDER_PROCESS_CAPABILITY)!;
    const prep = await prepareBlenderProcess(request, capability, { projectRoot, repoRoot });
    if (Bun.which("blender")) {
      expect(prep.status).toBe("ready");
      if (prep.status === "ready") {
        expect(prep.blender.version).toBe("5.2.2 LTS");
        expect(prep.plan.invocation_form).toContain("--factory-startup");
        expect(prep.plan.steps.length).toBe(4);
      }
    } else {
      expect(prep.status).toBe("blocked");
      if (prep.status === "blocked") expect(prep.code).toBe("BLENDER_UNAVAILABLE");
    }
  });

  it("blocks preparation with PROVIDER_MISMATCH on a foreign provider", async () => {
    const request = loadCommittedRequest();
    const capability = defaultCapabilityRegistry.get(DCC_BLENDER_PROCESS_CAPABILITY)!;
    const prep = await prepareBlenderProcess(
      { ...request, preferred_provider: "asset.gltf-transform" },
      capability,
      { projectRoot, repoRoot }
    );
    expect(prep.status).toBe("blocked");
    if (prep.status === "blocked") expect(prep.code).toBe("PROVIDER_MISMATCH");
  });

  it("blocks preparation when the escalation rationale is missing (REQ-BLENDER-002)", async () => {
    const request = loadCommittedRequest();
    const capability = defaultCapabilityRegistry.get(DCC_BLENDER_PROCESS_CAPABILITY)!;
    const inputs = { ...(request.inputs as Record<string, unknown>) };
    delete inputs["escalation_rationale"];
    const prep = await prepareBlenderProcess({ ...request, inputs }, capability, { projectRoot, repoRoot });
    expect(prep.status).toBe("blocked");
    if (prep.status === "blocked") {
      expect(prep.code).toBe("ESCALATION_RATIONALE_REQUIRED");
      expect(prep.message).toContain("REQ-BLENDER-002");
    }
  });

  it("blocks with typed scoped BLENDER_UNAVAILABLE when blender is absent (REQ-BLENDER-007)", async () => {
    const request = loadCommittedRequest();
    const capability = defaultCapabilityRegistry.get(DCC_BLENDER_PROCESS_CAPABILITY)!;
    const prep = await prepareBlenderProcess(request, capability, {
      projectRoot,
      repoRoot,
      preflight: { which: () => null },
    });
    expect(prep.status).toBe("blocked");
    if (prep.status === "blocked") {
      expect(prep.code).toBe("BLENDER_UNAVAILABLE");
      expect(prep.allowed_next_steps.some((s) => s.includes("committed accepted derivatives"))).toBe(true);
    }
  });
});
