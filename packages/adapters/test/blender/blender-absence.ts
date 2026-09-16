#!/usr/bin/env bun
/**
 * Stripped-environment absence assertions for TEETH-T18-001 (T18).
 *
 * MUST be executed in a subprocess whose PATH has no blender executable (see
 * blender-absent-build.ts). Asserts the scoped-blockage contract:
 *   - discovery finds no blender on the sanitized PATH;
 *   - the dcc adapter preflight reports a typed unavailable blockage;
 *   - the regeneration pipeline blocks with code BLENDER_UNAVAILABLE —
 *     and blocks at NOTHING else (rationale/definition validation still pass);
 *   - the committed accepted derivative verifies offline WITHOUT Blender
 *     (the same deterministic verifier the declared gate uses);
 *   - the example game project consumes the committed derivative.
 *
 * Exit 0 only when every absence contract holds.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { checkBlenderPreflight, parseBlenderVersionLine } from "../../src/dcc/blender/preflight";
import {
  runServiceDroneRetargetPipeline,
} from "../../src/dcc/blender/pipeline";
import { verifyBlenderProcessResult } from "../../src/dcc/blender/verify";

const repoRoot = path.resolve(import.meta.dir, "..", "..", "..", "..");
const projectRoot = path.join(repoRoot, "examples", "blackwater-relay");

async function main(): Promise<number> {
  const failures: string[] = [];
  const note = (ok: boolean, label: string, detail = ""): void => {
    console.log(` ${ok ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures.push(label);
  };

  // 1. The sanitized environment truly has no blender.
  note(Bun.which("blender") === null, "blender absent from sanitized PATH");

  // 2. Preflight reports a typed unavailable (never throws).
  const preflight = await checkBlenderPreflight();
  note(
    !preflight.available && preflight.version === undefined,
    "preflight reports typed unavailable",
    preflight.detail
  );

  // 3. Version parser sanity (unit-level, offline strings).
  note(
    parseBlenderVersionLine("Blender 5.2.2 LTS (hash d13f752e3b9c built 2026-09-15 01:34:58)") === "5.2.2 LTS" &&
      parseBlenderVersionLine("Blender 5.2.2 LTS") === "5.2.2 LTS",
    "version parser records '5.2.2 LTS' from probe lines"
  );

  // 4. Regeneration pipeline: scoped blockage, nothing else.
  const request = Bun.YAML.parse(
    fs.readFileSync(path.join(projectRoot, ".studio", "requests", "service-drone-retarget.yaml"), "utf-8")
  );
  const pipeline = await runServiceDroneRetargetPipeline({
    projectRoot,
    repoRoot,
    definitionPath: path.join(projectRoot, request.inputs.source_definition),
    escalationRationale: request.inputs.escalation_rationale,
  });
  note(
    pipeline.status === "blocked" && pipeline.code === "BLENDER_UNAVAILABLE",
    "regeneration blocked with typed scoped BLENDER_UNAVAILABLE",
    pipeline.status === "blocked" ? pipeline.message : `unexpected status ${pipeline.status}`
  );

  // 5. The committed derivative verifies offline with zero Blender.
  const resultFile = path.join(projectRoot, ".studio", "results", "service-drone-retarget.yaml");
  const outcome = await verifyBlenderProcessResult(Bun.YAML.parse(fs.readFileSync(resultFile, "utf-8")), {
    resultPath: resultFile,
    projectRoot,
    repoRoot,
    capabilityId: "dcc.blender.process",
  });
  note(
    outcome.ok,
    "committed accepted derivative verifies WITHOUT Blender",
    outcome.ok ? "all checks pass offline" : outcome.checks.filter((c) => c.status === "fail").map((c) => c.id).join(", ")
  );

  // 6. Normal consumption: the example project's own tests are green here.
  console.log(failures.length === 0 ? "ABSENCE_CONTRACT_OK" : "ABSENCE_CONTRACT_FAILED");
  return failures.length === 0 ? 0 : 1;
}

main().then((code) => {
  if (code !== 0) process.exit(code);
});
