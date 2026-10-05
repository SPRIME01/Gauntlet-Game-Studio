/**
 * Godot cross-runtime observability adapter (REQ-GODOT-004, spec v0.5.0).
 *
 * Exposes semantically comparable observations from a Godot production target
 * under the SAME versioned `__GAUNTLET_STUDIO_OBS__` contract the reference
 * runtime uses. The browser Godot build exposes a JS bridge (JavaScriptBridge
 * singleton); native targets use a debug/evidence bridge. This adapter wraps
 * that bridge into the contract shape and reuses the runtime's own validator
 * and production mutation lockout inspector — there is no second verification
 * ontology.
 *
 * The adapter is read-only: it never wraps or exposes privileged control on a
 * production target.
 */

import {
  OBSERVABILITY_CONTRACT_NAME,
  OBSERVABILITY_CONTRACT_VERSION,
  validateObservabilityContract,
  inspectProductionSurface,
} from "@gauntlet/runtime";

/** What the Godot build must expose to the page/native host. */
export interface GodotObservabilityBridge {
  ready(): boolean;
  readiness(): Record<string, unknown>;
  tick(): number;
  entities(): { list(): unknown[]; get(id: string): unknown; snapshot(): unknown };
  errors(): { recent(): unknown[] };
  renderer(): { probe(): unknown; stats(): unknown; capture?(config?: unknown): unknown };
  physics(): { read(): unknown };
  navigation(): { read(): unknown };
  spatial(): { read(): unknown };
  network(): { read(): unknown };
  views(): { list(): unknown[]; get(id: string): unknown; current(): unknown };
}

export interface GodotObservabilityOptions {
  mode: "development" | "test" | "production";
}

export interface GodotObservabilityResult {
  ok: boolean;
  surface?: Record<string, unknown>;
  violations: string[];
  productionViolations: string[];
}

/**
 * Wrap a Godot bridge into the versioned observability contract and verify it
 * with the runtime's own validators. In production mode the wrapped surface is
 * additionally checked with the production mutation lockout inspector — a
 * bridge that smuggles privileged mutation tokens fails exactly as a
 * tampered reference-runtime surface would.
 */
export function createGodotObservabilitySurface(
  bridge: GodotObservabilityBridge,
  options: GodotObservabilityOptions,
): GodotObservabilityResult {
  const surface: Record<string, unknown> = {
    contract: {
      name: OBSERVABILITY_CONTRACT_NAME,
      version: OBSERVABILITY_CONTRACT_VERSION,
      mode: options.mode,
      readonly: true,
      // The Godot bridge adapter is read-only in every mode: production
      // mutation lockout is not negotiable (REQ-GODOT-004).
      privileged_control: false,
    },
    ready: () => bridge.ready(),
    readiness: () => bridge.readiness(),
    tick: () => bridge.tick(),
    entities: {
      list: () => bridge.entities().list(),
      get: (id: string) => bridge.entities().get(id),
      snapshot: () => bridge.entities().snapshot(),
    },
    errors: { recent: () => bridge.errors().recent() },
    renderer: {
      probe: () => bridge.renderer().probe(),
      stats: () => bridge.renderer().stats(),
      capture: (config?: unknown) => bridge.renderer().capture?.(config) ?? null,
    },
    physics: { read: () => bridge.physics().read() },
    navigation: { read: () => bridge.navigation().read() },
    spatial: { read: () => bridge.spatial().read() },
    network: { read: () => bridge.network().read() },
    views: {
      list: () => bridge.views().list(),
      get: (id: string) => bridge.views().get(id),
      current: () => bridge.views().current(),
    },
  };

  const validation = validateObservabilityContract(surface, { mode: options.mode });
  const violations = validation.ok ? [] : validation.violations;

  let productionViolations: string[] = [];
  if (options.mode === "production") {
    // The wrapped surface AND the raw bridge are both inspected: a Godot
    // build smuggling privileged mutation tokens fails exactly as a tampered
    // reference-runtime surface would.
    const surfaceInspection = inspectProductionSurface(surface);
    const bridgeInspection = inspectProductionSurface(bridge);
    productionViolations = [
      ...(surfaceInspection.ok ? [] : surfaceInspection.violations),
      ...(bridgeInspection.ok ? [] : bridgeInspection.violations),
    ];
  }

  return {
    ok: violations.length === 0 && productionViolations.length === 0,
    surface,
    violations,
    productionViolations,
  };
}

/**
 * Typed blockage when no bridge is present (native target without a debug
 * bridge, or the Godot build not exposing the singleton). Honest unavailability
 * — never fabricated reads.
 */
export interface GodotObservabilityBlocked {
  ok: false;
  status: "blocked";
  code: "GODOT_OBSERVABILITY_BRIDGE_UNAVAILABLE";
  detail: string;
}

export function godotObservabilityUnavailable(detail: string): GodotObservabilityBlocked {
  return {
    ok: false,
    status: "blocked",
    code: "GODOT_OBSERVABILITY_BRIDGE_UNAVAILABLE",
    detail,
  };
}
