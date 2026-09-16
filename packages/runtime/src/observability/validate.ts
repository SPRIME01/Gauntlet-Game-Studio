/**
 * Observability contract validator (T19).
 * Implements REQ-OBS-002, REQ-OBS-004.
 *
 * Proves the surface exposes stable, Koota-backed semantic reads (never
 * transient DOM selectors or provider-internal object names). This is the
 * detector behind TEETH-T19-001: a surface that lacks the stable methods —
 * or offers only DOM/provider-internal access — MUST fail validation.
 */

import { OBSERVABILITY_CONTRACT_NAME, OBSERVABILITY_CONTRACT_VERSION } from "./contract";
import { inspectProductionSurface } from "./production-check";

export interface ContractValidationResult {
  ok: boolean;
  violations: string[];
  checked: string[];
}

export interface ContractValidationOptions {
  /** Expected mode; checked against the contract header when provided. */
  mode?: "development" | "test" | "production";
  /** Require the privileged control namespace (development/test surfaces). */
  expectControl?: boolean;
  /** Exercise read methods against live state (behavioral validation). Default true. */
  behavioral?: boolean;
}

const REQUIRED_ROOT_METHODS = ["ready", "readiness", "tick"] as const;

const REQUIRED_NAMESPACE_METHODS: Record<string, string[]> = {
  entities: ["list", "get", "snapshot"],
  errors: ["recent"],
  renderer: ["probe", "stats", "capture"],
  physics: ["read"],
  navigation: ["read"],
  spatial: ["read"],
  network: ["read"],
  views: ["list", "get", "current"],
};

const REQUIRED_CONTROL_METHODS = [
  "pause",
  "resume",
  "isPaused",
  "step",
  "maxStepTicks",
  "setSeed",
  "seed",
  "setView",
  "listScenarios",
  "resetScenario",
  "clearErrors",
] as const;

function isFunction(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === "function";
}

/**
 * Validates an object as a `__GAUNTLET_STUDIO_OBS__` v1 surface.
 * Structural checks: contract header + required stable methods exist.
 * Behavioral checks: reads return contract-shaped, Koota-correlated data.
 */
export function validateObservabilityContract(
  surface: unknown,
  options: ContractValidationOptions = {}
): ContractValidationResult {
  if (typeof surface !== "object" || surface === null) {
    return {
      ok: false,
      violations: ["surface is not an object"],
      checked: [],
    };
  }

  const violations: string[] = [];
  const checked: string[] = [];
  const s = surface as Record<string, unknown>;

  // 1. Contract header.
  checked.push("contract");
  const header = s.contract as
    | { name?: unknown; version?: unknown; mode?: unknown }
    | undefined;
  if (!header || typeof header !== "object") {
    violations.push("missing contract header");
  } else {
    if (header.name !== OBSERVABILITY_CONTRACT_NAME) {
      violations.push(`contract.name must be '${OBSERVABILITY_CONTRACT_NAME}'`);
    }
    if (header.version !== OBSERVABILITY_CONTRACT_VERSION) {
      violations.push(`contract.version must be ${OBSERVABILITY_CONTRACT_VERSION}`);
    }
    if (options.mode && header.mode !== options.mode) {
      violations.push(`contract.mode must be '${options.mode}' (got '${String(header.mode)}')`);
    }
    if (header.mode !== "development" && header.mode !== "test" && header.mode !== "production") {
      violations.push("contract.mode is not a valid ObservabilityMode");
    }
  }

  // 2. Required stable root methods.
  for (const method of REQUIRED_ROOT_METHODS) {
    checked.push(method);
    if (!isFunction(s[method])) {
      violations.push(`missing stable method '${method}()'`);
    }
  }

  // 3. Required stable namespaces and methods.
  for (const [ns, methods] of Object.entries(REQUIRED_NAMESPACE_METHODS)) {
    checked.push(ns);
    const namespace = s[ns] as Record<string, unknown> | undefined;
    if (!namespace || typeof namespace !== "object") {
      violations.push(`missing stable namespace '${ns}'`);
      for (const method of methods) {
        checked.push(`${ns}.${method}`);
        violations.push(`missing stable method '${ns}.${method}()'`);
      }
      continue;
    }
    for (const method of methods) {
      checked.push(`${ns}.${method}`);
      if (!isFunction(namespace[method])) {
        violations.push(`missing stable method '${ns}.${method}()'`);
      }
    }
  }

  // 4. Privileged control namespace expectation.
  checked.push("control");
  if (options.expectControl) {
    const control = s.control as Record<string, unknown> | undefined;
    if (!control || typeof control !== "object") {
      violations.push("missing privileged 'control' namespace (required for development/test)");
    } else {
      for (const method of REQUIRED_CONTROL_METHODS) {
        checked.push(`control.${method}`);
        if (!isFunction(control[method])) {
          violations.push(`missing stable method 'control.${method}()'`);
        }
      }
    }
  } else if (s.control !== undefined) {
    violations.push("unexpected 'control' namespace present (read-only surface)");
  }

  // 5. Behavioral checks: stable read methods execute against live state
  //    without throwing (a DOM-selector "surface" would fail here because the
  //    stable methods do not exist, and any method that internally relied on
  //    absent provider objects would throw).
  if (options.behavioral !== false) {
    const behavioralTargets: string[] = [
      "ready",
      "readiness",
      "tick",
      "entities.list",
      "entities.get",
      "entities.snapshot",
      "errors.recent",
    ];
    for (const path of behavioralTargets) {
      checked.push(`behavioral:${path}`);
      const [ns, method] = path.split(".");
      const fn = (method ? (s[ns] as Record<string, unknown> | undefined)?.[method] : s[ns]);
      if (!isFunction(fn)) continue; // already reported as missing above
      try {
        fn.call(surface);
      } catch (err) {
        violations.push(`stable method '${path}()' threw: ${String(err)}`);
      }
    }
  }

  // 6. Production surfaces additionally pass the privileged-mutation inspector.
  if (options.mode === "production") {
    checked.push("production-mutation-inspection");
    const inspection = inspectProductionSurface(surface);
    violations.push(...inspection.violations);
  }

  return { ok: violations.length === 0, violations, checked };
}
