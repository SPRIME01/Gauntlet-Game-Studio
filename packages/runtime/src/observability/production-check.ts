#!/usr/bin/env bun
/**
 * Production observability surface inspector (T19).
 * Implements REQ-OUT-004, REQ-OBS-005, REQ-SEC-005.
 *
 * `inspectProductionSurface` recursively inspects a mounted surface and fails
 * when privileged scenario/state mutation APIs are exposed (pause/resume,
 * fixed-step, seed control, scenario reset, view seizure, registration,
 * execution/mutation hooks). This is the detector behind TEETH-T19-002:
 * if a "production" build exposes privileged mutation, the build check fails.
 *
 * Executed directly (`bun run test:production-observability`) this script:
 *   1. constructs a production-mode observability bridge over a minimal
 *      runtime and inspects the mounted production surface (must be clean);
 *   2. runs the simulated regression attacks: a development/test surface
 *      (privileged control namespace present) inspected as production MUST
 *      fail, and a production surface into which a mutation API was injected
 *      MUST fail — proving the check actually bites;
 *   3. exits 0 only when the production surface is clean AND the detector
 *      demonstrably fails both regressions.
 */

import { GauntletKernel } from "../kernel";
import { GameWorld } from "../state/world";
import { createObservabilityBridge } from "./bridge";
import { validateObservabilityContract } from "./validate";
import { OBSERVABILITY_CONTRACT_NAME } from "./contract";

/**
 * Lowercase substrings that mark a method as privileged debug/scenario
 * mutation when found on a production surface. Read-only production method
 * names (ready/readiness/tick/entities.get/errors.recent/renderer.probe/
 * physics.read/views.get/...) intentionally match none of these.
 */
export const PRIVILEGED_MUTATION_TOKENS: readonly string[] = [
  "pause",
  "resume",
  "step",
  "seed",
  "scenario",
  "reset",
  "spawn",
  "despawn",
  "teleport",
  "mutate",
  "setview",
  "register",
  "exec",
  "eval",
  "advance",
  "simulate",
  "restore",
  "control",
];

export interface ProductionSurfaceInspection {
  ok: boolean;
  violations: string[];
  methodsInspected: number;
}

export class ObservabilityProductionViolationError extends Error {
  public readonly violations: string[];
  constructor(violations: string[]) {
    super(
      `Production observability surface exposes privileged mutation APIs: ${violations.join("; ")}`
    );
    this.name = "ObservabilityProductionViolationError";
    this.violations = violations;
  }
}

/**
 * Recursively inspects a surface for privileged mutation APIs.
 * Fails on: any function whose (lowercased) name contains a privileged token,
 * or any property named `control` at any depth.
 */
export function inspectProductionSurface(
  surface: unknown,
  options: { maxDepth?: number } = {}
): ProductionSurfaceInspection {
  const violations: string[] = [];
  let methodsInspected = 0;
  const seen = new WeakSet<object>();
  const maxDepth = options.maxDepth ?? 8;

  const walk = (node: unknown, path: string, depth: number): void => {
    if (node === null || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    if (depth > maxDepth) return;

    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase();
      const childPath = path ? `${path}.${key}` : key;

      if (lowerKey === "control") {
        violations.push(`privileged 'control' namespace exposed at '${childPath}'`);
        // Fall through: the members of the control namespace are inspected too,
        // so each privileged mutation API is reported individually.
      }

      if (typeof value === "function") {
        methodsInspected++;
        const lowerName = (value as { name?: string }).name || key;
        const haystack = `${lowerKey} ${String(lowerName).toLowerCase()}`;
        for (const token of PRIVILEGED_MUTATION_TOKENS) {
          if (haystack.includes(token)) {
            violations.push(
              `privileged mutation API '${childPath}' matches forbidden token '${token}'`
            );
            break;
          }
        }
        continue;
      }

      if (value !== null && typeof value === "object") {
        walk(value, childPath, depth + 1);
      }
    }
  };

  walk(surface, "", 0);
  return { ok: violations.length === 0, violations, methodsInspected };
}

/** Throws ObservabilityProductionViolationError when the surface is not clean. */
export function assertProductionSurfaceSafety(surface: unknown): void {
  const inspection = inspectProductionSurface(surface);
  if (!inspection.ok) {
    throw new ObservabilityProductionViolationError(inspection.violations);
  }
}

// ---------------------------------------------------------------------------
// Script entry point (gate: bun run test:production-observability)
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  console.log("=== Gauntlet Studio Production Observability Surface Check (T19) ===");
  console.log(`Contract: ${OBSERVABILITY_CONTRACT_NAME} v1`);

  // 1. Construct a production-mode bridge over a minimal runtime and inspect
  //    the mounted production surface.
  const kernel = new GauntletKernel({ mode: "local-authoritative" });
  const world = kernel.gameWorld;
  world.spawnEntity({ id: "hero", transform: { position: [1, 0, 0] }, tags: ["player"] });
  kernel.barrier.register("physics", true);
  kernel.barrier.markReady("physics", 1);

  const prodTarget: Record<string, unknown> = {};
  createObservabilityBridge({
    mode: "production",
    kernel,
    target: prodTarget,
    renderCapture: { preserveDrawingBuffer: false },
  });

  const prodSurface = prodTarget[OBSERVABILITY_CONTRACT_NAME];
  if (!prodSurface) {
    console.error("FAIL: production surface was not mounted on the target.");
    return 1;
  }

  const inspection = inspectProductionSurface(prodSurface);
  const contractCheck = validateObservabilityContract(prodSurface, { mode: "production" });

  let ok = true;
  if (!inspection.ok) {
    ok = false;
    console.error(`FAIL: production surface carries privileged mutation APIs:`);
    for (const v of inspection.violations) console.error(`  - ${v}`);
  } else {
    console.log(
      `OK: production surface is clean (${inspection.methodsInspected} methods inspected, zero privileged mutation APIs).`
    );
  }
  if (!contractCheck.ok) {
    ok = false;
    console.error(`FAIL: production surface failed contract validation: ${contractCheck.violations.join("; ")}`);
  } else {
    console.log("OK: production surface satisfies the __GAUNTLET_STUDIO_OBS__ v1 contract (read-only mode).");
  }

  // Reads remain available in production (REQ-OUT-004 allows reads; only
  // privileged mutation is forbidden).
  const readOk =
    typeof (prodSurface as { ready?: unknown }).ready === "function" &&
    (prodSurface as { control?: unknown }).control === undefined;
  if (!readOk) {
    ok = false;
    console.error("FAIL: production surface must expose reads and must not expose 'control'.");
  } else {
    console.log("OK: production surface exposes read-only diagnostics with no 'control' namespace.");
  }

  // 2. TEETH-T19-002 simulated regression A: a development/test surface
  //    (privileged control namespace present) inspected as production.
  const devTarget: Record<string, unknown> = {};
  const devBridge = createObservabilityBridge({ mode: "test", kernel, target: devTarget });
  const devSurface = devTarget[OBSERVABILITY_CONTRACT_NAME];
  const regressionA = inspectProductionSurface(devSurface);
  if (regressionA.ok) {
    ok = false;
    console.error(
      "FAIL (detector inert): a dev/test surface with privileged control passed the production inspection."
    );
  } else {
    console.log(
      `OK (TEETH-T19-002 simulated): exposing the privileged control namespace on a production surface FAILS the inspection (${regressionA.violations.length} violations, e.g. '${regressionA.violations[0]}').`
    );
  }

  // 3. TEETH-T19-002 simulated regression B: a single mutation API injected
  //    into an otherwise production-shaped surface.
  const injected: Record<string, unknown> = {
    ...(prodSurface as Record<string, unknown>),
    pause: () => undefined,
  };
  const regressionB = inspectProductionSurface(injected);
  if (regressionB.ok) {
    ok = false;
    console.error(
      "FAIL (detector inert): an injected pause() mutation API passed the production inspection."
    );
  } else {
    console.log(
      `OK (TEETH-T19-002 simulated): an injected privileged mutation API FAILS the inspection ('${regressionB.violations[0]}').`
    );
  }

  devBridge.dispose();

  if (!ok) {
    console.error("FAIL: production observability surface check did not pass.");
    return 1;
  }
  console.log("SUCCESS: production observability surface carries no privileged debug mutation.");
  return 0;
}

if (import.meta.main) {
  main().then((code) => process.exit(code));
}
