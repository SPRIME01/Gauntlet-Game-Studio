/**
 * Observability bridge for Gauntlet Runtime (T19).
 * Implements REQ-OUT-004, REQ-OBS-001..005, REQ-SEC-005.
 *
 * `createObservabilityBridge({ mode, kernel, ... })` builds and mounts the
 * versioned surface (`__GAUNTLET_STUDIO_OBS__` v1) on the runtime target
 * (browser: `window.__GAUNTLET_STUDIO_OBS__`; default target: globalThis).
 *
 * - mode "development" | "test": full surface including the privileged
 *   `control` namespace (pause/resume, bounded fixed-step, seed, scenario
 *   reset, view selection, error clearing).
 * - mode "production": read-only surface ONLY. The privileged control
 *   namespace is never installed (REQ-OUT-004, REQ-OBS-005, REQ-SEC-005).
 *
 * The bridge is a read/projection and controlled-invocation layer. Koota
 * (`GameWorld`) remains the sole semantic authority; scenario hooks are
 * game-owned functions the bridge merely invokes.
 */

import type { RuntimeReadiness } from "@gauntlet/contracts";
import type { GauntletKernel } from "../kernel";
import type { GameWorld } from "../state/world";
import type { SerializedEntityState, SemanticStateSnapshot } from "../state/traits";
import type { RapierPhysicsAdapter } from "../physics/rapier";
import type { RecastNavigationAdapter, NavigationDiagnostics } from "../navigation/recast";
import type { SpatialQueryAccelerator, SpatialDiagnostics } from "../spatial/bvh";
import type { NetworkClient } from "../network/client";
import type {
  NetworkClientDiagnostics,
  NetworkServerDiagnostics,
} from "../network/diagnostics";
import type { TransportCharacteristics } from "../network/types";
import {
  OBSERVABILITY_CONTRACT_NAME,
  OBSERVABILITY_CONTRACT_VERSION,
  type ObservabilityMode,
  type ObservabilityContractHeader,
  type ObservabilityEntityRead,
  type ObservabilityErrorEntry,
  type ObservabilityRendererProbe,
  type ObservabilityRendererStats,
  type ObservabilityRenderCaptureConfig,
  type ObservabilityPhysicsRead,
  type ObservabilityNavigationRead,
  type ObservabilitySpatialRead,
  type ObservabilityNetworkRead,
  type ObservabilityCameraView,
  type ObservabilityTickRead,
  type ObservabilityControlNamespace,
  type ObservabilitySurface,
  type ProductionObservabilitySurface,
} from "./contract";

/** Wiring-facing renderer probe: identity/capabilities of the actual renderer. */
export type RendererProbeFn = () => {
  identity?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
};

/** Wiring-facing renderer stats sampler (fps, draw calls, ...). */
export type RendererStatsFn = () => Record<string, number> | null;

/** Game-owned reseed handler notified by `control.setSeed`. */
export type SeedHandler = (seed: number) => void;

/** Game-owned scenario hook; the bridge invokes it, it owns state rebuild. */
export type ObservabilityScenarioHook = (ctx: {
  world: GameWorld;
  kernel: GauntletKernel;
}) => void;

/** Named camera/view: static descriptor or lazy accessor. */
export type ObservabilityViewProvider =
  | ObservabilityCameraView
  | (() => ObservabilityCameraView);

/** Read-only network diagnostics wiring (reuses T12 diagnostics contracts). */
export interface ObservabilityNetworkWiring {
  client?: NetworkClient;
  server?: { getDiagnostics(): NetworkServerDiagnostics };
  characteristics?: TransportCharacteristics;
}

export interface ObservabilityBridgeOptions {
  mode: ObservabilityMode;
  kernel: GauntletKernel;
  /**
   * Mount target. Browser builds pass/resolve to `window`; defaults to
   * `globalThis`. Tests pass an isolated object for hermetic mounting.
   */
  target?: Record<string, unknown>;
  /** Capture-only preserveDrawingBuffer configuration. Default: false. */
  renderCapture?: { preserveDrawingBuffer?: boolean };
  /** Bounded step ceiling per `control.step` call. Default: 240. */
  maxStepTicks?: number;
  /** Error log ring capacity. Default: 100. */
  errorBufferSize?: number;
  /** Mount onto the target immediately. Default: true. */
  mount?: boolean;
}

/**
 * Wiring-side handle returned to game/boot code. The mounted window surface is
 * deliberately narrower than this handle: registration and privileged control
 * never leak through the production surface.
 */
export interface ObservabilityBridge {
  readonly mode: ObservabilityMode;
  /** The mounted surface (full surface in dev/test; read-only in production). */
  readonly surface: ObservabilitySurface | ProductionObservabilitySurface;
  registerScenario(
    name: string,
    hook: ObservabilityScenarioHook,
    opts?: { default?: boolean }
  ): void;
  registerView(name: string, provider: ObservabilityViewProvider): void;
  recordError(err: unknown, context?: string): void;
  setRendererProbe(probe: RendererProbeFn): void;
  setRendererStats(stats: RendererStatsFn): void;
  setSeedHandler(handler: SeedHandler): void;
  attachPhysics(adapter: RapierPhysicsAdapter): void;
  attachNavigation(adapter: RecastNavigationAdapter): void;
  attachSpatial(accelerator: SpatialQueryAccelerator): void;
  attachNetwork(wiring: ObservabilityNetworkWiring): void;
  /** Unmounts the surface (dev/test only; production mounts are permanent). */
  dispose(): void;
}

interface BridgeInternals {
  options: ObservabilityBridgeOptions;
  scenarios: Map<string, ObservabilityScenarioHook>;
  defaultScenario: string | null;
  views: Map<string, ObservabilityViewProvider>;
  currentView: string | null;
  errors: ObservabilityErrorEntry[];
  rendererProbe: RendererProbeFn | null;
  rendererStats: RendererStatsFn | null;
  seedHandler: SeedHandler | null;
  seed: number | null;
  physics: RapierPhysicsAdapter | null;
  navigation: RecastNavigationAdapter | null;
  spatial: SpatialQueryAccelerator | null;
  network: ObservabilityNetworkWiring | null;
}

function normalizeErrorMessage(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function copyView(view: ObservabilityCameraView): ObservabilityCameraView {
  return {
    ...view,
    position: [...view.position] as [number, number, number],
    target: [...view.target] as [number, number, number],
  };
}

function buildReads(internals: BridgeInternals) {
  const kernel = internals.options.kernel;

  return {
    ready(): boolean {
      return kernel.barrier.isReady();
    },
    readiness(): RuntimeReadiness {
      return kernel.barrier.getReadiness();
    },
    tick(): ObservabilityTickRead {
      const scheduler = kernel.scheduler;
      return {
        tick: scheduler.getTick(),
        time: scheduler.getTime(),
        running: scheduler.isRunning(),
        paused: !scheduler.isRunning(),
        fixed_delta_time: scheduler.fixedDeltaTime,
        alpha: scheduler.getAlpha(),
      };
    },
    entities: {
      list(): string[] {
        return kernel.gameWorld.getEntityIds();
      },
      /** Stable Koota-backed semantic read — never a DOM/provider lookup. */
      get(id: string): ObservabilityEntityRead {
        if (!kernel.gameWorld.hasEntity(id)) {
          return { id, source: "koota", state: null };
        }
        const snapshot = kernel.gameWorld.takeSemanticSnapshot();
        const state: SerializedEntityState | undefined = snapshot.entities.find(
          (e) => e.id === id
        );
        return { id, source: "koota", state: state ?? null };
      },
      snapshot(): SemanticStateSnapshot {
        return kernel.gameWorld.takeSemanticSnapshot();
      },
    },
    errors: {
      recent(): ObservabilityErrorEntry[] {
        return internals.errors.map((e) => ({ ...e }));
      },
    },
    renderer: {
      probe(): ObservabilityRendererProbe {
        if (!internals.rendererProbe) {
          return { present: false, reason: "not_registered" };
        }
        const result = internals.rendererProbe();
        return { present: true, ...result };
      },
      stats(): ObservabilityRendererStats {
        if (!internals.rendererStats) {
          return { present: false, reason: "not_registered" };
        }
        const stats = internals.rendererStats();
        if (!stats) return { present: false, reason: "unavailable" };
        return { present: true, stats };
      },
      capture(): ObservabilityRenderCaptureConfig {
        return {
          preserveDrawingBuffer:
            internals.options.renderCapture?.preserveDrawingBuffer ?? false,
          purpose: "capture-only",
        };
      },
    },
    physics: {
      read(): ObservabilityPhysicsRead {
        const adapter = internals.physics;
        if (!adapter || !(adapter as { world?: unknown }).world) {
          return { present: false, reason: "not_registered" };
        }
        return { present: true, last_stepped_tick: adapter.getLastSteppedTick() };
      },
    },
    navigation: {
      read(): ObservabilityNavigationRead {
        const adapter = internals.navigation;
        if (!adapter) return { present: false, reason: "not_registered" };
        const diagnostics: NavigationDiagnostics = adapter.getDiagnostics();
        return { present: true, diagnostics };
      },
    },
    spatial: {
      read(): ObservabilitySpatialRead {
        const accelerator = internals.spatial;
        if (!accelerator) return { present: false, reason: "not_registered" };
        const diagnostics: SpatialDiagnostics = accelerator.getDiagnostics();
        return { present: true, diagnostics };
      },
    },
    network: {
      read(): ObservabilityNetworkRead {
        const wiring = internals.network;
        if (!wiring) return { present: false, reason: "not_registered" };
        const client: NetworkClientDiagnostics | undefined = wiring.client
          ? wiring.client.getDiagnostics()
          : undefined;
        const server: NetworkServerDiagnostics | undefined = wiring.server
          ? wiring.server.getDiagnostics()
          : undefined;
        if (!client && !server && !wiring.characteristics) {
          return { present: false, reason: "not_connected" };
        }
        return {
          present: true,
          client,
          server,
          transport: wiring.characteristics,
        };
      },
    },
    views: {
      list(): string[] {
        return Array.from(internals.views.keys());
      },
      get(name: string): ObservabilityCameraView | null {
        const provider = internals.views.get(name);
        if (!provider) return null;
        return copyView(typeof provider === "function" ? provider() : provider);
      },
      current(): ObservabilityCameraView | null {
        if (!internals.currentView) return null;
        return this.get(internals.currentView);
      },
    },
  };
}

/**
 * Creates and (by default) mounts the versioned observability surface.
 * Production mode installs a read-only surface and never the privileged
 * control namespace.
 */
export function createObservabilityBridge(
  options: ObservabilityBridgeOptions
): ObservabilityBridge {
  if (options.mode !== "development" && options.mode !== "test" && options.mode !== "production") {
    throw new Error(`Invalid observability mode '${String(options.mode)}'.`);
  }

  const internals: BridgeInternals = {
    options,
    scenarios: new Map(),
    defaultScenario: null,
    views: new Map(),
    currentView: null,
    errors: [],
    rendererProbe: null,
    rendererStats: null,
    seedHandler: null,
    seed: null,
    physics: null,
    navigation: null,
    spatial: null,
    network: null,
  };

  const maxStepTicks = options.maxStepTicks ?? 240;
  const errorBufferSize = options.errorBufferSize ?? 100;
  const reads = buildReads(internals);
  const isProduction = options.mode === "production";

  const header: ObservabilityContractHeader = Object.freeze(
    isProduction
      ? {
          name: OBSERVABILITY_CONTRACT_NAME,
          version: OBSERVABILITY_CONTRACT_VERSION,
          mode: "production",
          readonly: true,
          privileged_control: false,
        }
      : {
          name: OBSERVABILITY_CONTRACT_NAME,
          version: OBSERVABILITY_CONTRACT_VERSION,
          mode: options.mode,
          readonly: false,
          privileged_control: true,
        }
  );

  // -------------------------------------------------------------------------
  // PRIVILEGED control namespace — constructed ONLY for development/test.
  // In production this object is never created, so no privileged mutation
  // method can appear on the mounted surface (REQ-OUT-004, REQ-SEC-005).
  // -------------------------------------------------------------------------
  const control: ObservabilityControlNamespace | undefined = isProduction
    ? undefined
    : {
        pause(): void {
          internals.options.kernel.scheduler.stop();
        },
        resume(): void {
          internals.options.kernel.scheduler.start();
        },
        isPaused(): boolean {
          return !internals.options.kernel.scheduler.isRunning();
        },
        step(ticks = 1): number {
          if (!Number.isInteger(ticks) || ticks < 1 || ticks > maxStepTicks) {
            throw new RangeError(
              `control.step requires an integer in [1, ${maxStepTicks}]; received ${String(ticks)}.`
            );
          }
          for (let i = 0; i < ticks; i++) {
            internals.options.kernel.scheduler.stepSingleTick();
          }
          return ticks;
        },
        maxStepTicks(): number {
          return maxStepTicks;
        },
        setSeed(seed: number): void {
          if (!Number.isFinite(seed)) {
            throw new TypeError("control.setSeed requires a finite numeric seed.");
          }
          internals.seed = seed;
          internals.seedHandler?.(seed);
        },
        seed(): number | null {
          return internals.seed;
        },
        setView(name: string): boolean {
          if (!internals.views.has(name)) return false;
          internals.currentView = name;
          return true;
        },
        listScenarios(): string[] {
          return Array.from(internals.scenarios.keys());
        },
        resetScenario(name?: string): void {
          const target = name ?? internals.defaultScenario;
          if (!target || !internals.scenarios.has(target)) {
            throw new Error(
              `Scenario '${String(name ?? "<default>")}' is not registered. Registered: ${Array.from(
                internals.scenarios.keys()
              ).join(", ") || "<none>"}.`
            );
          }
          const hook = internals.scenarios.get(target);
          if (hook) {
            hook({ world: internals.options.kernel.gameWorld, kernel: internals.options.kernel });
          }
        },
        clearErrors(): void {
          internals.errors.length = 0;
        },
      };

  const surface = isProduction
    ? ({ contract: header, ...reads } as ProductionObservabilitySurface)
    : ({ contract: header, ...reads, control } as ObservabilitySurface);

  const bridge: ObservabilityBridge = {
    mode: options.mode,
    surface,

    registerScenario(name, hook, opts): void {
      if (internals.scenarios.has(name)) {
        throw new Error(`Scenario '${name}' is already registered.`);
      }
      internals.scenarios.set(name, hook);
      if (opts?.default || internals.defaultScenario === null) {
        internals.defaultScenario = name;
      }
    },

    registerView(name, provider): void {
      internals.views.set(name, provider);
    },

    recordError(err, context): void {
      internals.errors.push({
        at: new Date().toISOString(),
        message: normalizeErrorMessage(err),
        ...(context !== undefined ? { context } : {}),
      });
      if (internals.errors.length > errorBufferSize) {
        internals.errors.splice(0, internals.errors.length - errorBufferSize);
      }
    },

    setRendererProbe(probe): void {
      internals.rendererProbe = probe;
    },

    setRendererStats(stats): void {
      internals.rendererStats = stats;
    },

    setSeedHandler(handler): void {
      internals.seedHandler = handler;
    },

    attachPhysics(adapter): void {
      internals.physics = adapter;
    },

    attachNavigation(adapter): void {
      internals.navigation = adapter;
    },

    attachSpatial(accelerator): void {
      internals.spatial = accelerator;
    },

    attachNetwork(wiring): void {
      internals.network = wiring;
    },

    dispose(): void {
      if (isProduction) {
        throw new Error(
          "The production observability surface is intentionally permanent and cannot be unmounted."
        );
      }
      unmount(options);
    },
  };

  if (options.mount !== false) {
    mountSurface(options, surface, isProduction);
  }

  return bridge;
}

function resolveTarget(options: ObservabilityBridgeOptions): Record<string, unknown> {
  if (options.target) return options.target;
  return globalThis as unknown as Record<string, unknown>;
}

function mountSurface(
  options: ObservabilityBridgeOptions,
  surface: ObservabilitySurface | ProductionObservabilitySurface,
  isProduction: boolean
): void {
  const target = resolveTarget(options);
  Object.defineProperty(target, OBSERVABILITY_CONTRACT_NAME, {
    value: surface,
    enumerable: true,
    // Production mounts are immutable and permanent: the surface cannot be
    // silently replaced or removed at runtime (REQ-SEC-005).
    writable: !isProduction,
    configurable: !isProduction,
  });
}

function unmount(options: ObservabilityBridgeOptions): void {
  const target = resolveTarget(options);
  if (OBSERVABILITY_CONTRACT_NAME in target) {
    delete (target as { [key: string]: unknown })[OBSERVABILITY_CONTRACT_NAME];
  }
}
