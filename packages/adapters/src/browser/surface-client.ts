/**
 * Stable-surface client for the Playwright proof harness (T20, REQ-OBS-004, REQ-BIND-010).
 *
 * ALL semantic reads travel through the versioned `__GAUNTLET_STUDIO_OBS__` v1 stable
 * methods mounted by the runtime. This module deliberately exposes NO escape hatch for
 * reading semantic state from DOM selectors or provider-internal object names — the
 * TEETH-T19-001 boundary is preserved at the type level and at runtime.
 */

import type { Page } from "playwright";
import {
  OBSERVABILITY_CONTRACT_NAME,
  OBSERVABILITY_CONTRACT_VERSION,
} from "@gauntlet/runtime";

/** Stable method paths every contract-v1 surface MUST expose (structural check). */
export const REQUIRED_SURFACE_METHODS: readonly string[] = [
  "ready",
  "readiness",
  "tick",
  "entities.list",
  "entities.get",
  "entities.snapshot",
  "errors.recent",
  "renderer.probe",
  "renderer.stats",
  "renderer.capture",
  "physics.read",
  "navigation.read",
  "spatial.read",
  "network.read",
  "views.list",
  "views.get",
  "views.current",
  "control.pause",
  "control.resume",
  "control.isPaused",
  "control.step",
  "control.maxStepTicks",
  "control.setSeed",
  "control.seed",
  "control.setView",
  "control.listScenarios",
  "control.resetScenario",
  "control.clearErrors",
];

export interface MountedSurfaceHeader {
  name: string;
  version: number;
  mode: string;
  readonly: boolean;
  privileged_control: boolean;
}

export interface SurfaceValidation {
  valid: boolean;
  problems: string[];
}

function surfaceExpr(): string {
  return `globalThis[${JSON.stringify(OBSERVABILITY_CONTRACT_NAME)}]`;
}

/** Evaluates a function body with the surface in scope; throws if the surface is absent. */
function withSurface(body: string): string {
  return `(() => {
    const surface = ${surfaceExpr()};
    if (!surface) throw new Error("stable observability surface ${OBSERVABILITY_CONTRACT_NAME} not mounted");
    return (${body})(surface);
  })()`;
}

/** Waits until the stable surface is mounted; returns its contract header. */
export async function waitForSurface(page: Page, timeoutMs: number): Promise<MountedSurfaceHeader> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const header = await page
      .evaluate(`(() => {
        const s = ${surfaceExpr()};
        return s ? { name: s.contract.name, version: s.contract.version, mode: s.contract.mode, readonly: s.contract.readonly, privileged_control: s.contract.privileged_control } : null;
      })()`)
      .catch(() => null);
    if (header) return header as MountedSurfaceHeader;
    if (Date.now() > deadline) {
      throw new Error(`stable observability surface not mounted within ${timeoutMs}ms`);
    }
    await page.waitForTimeout(100);
  }
}

/**
 * Structural contract-v1 validation of the mounted surface: header identity plus
 * presence of every required stable method. Reads are exercised behaviorally by
 * the harness afterwards; a surface with only transient DOM access fails here.
 */
export async function validateMountedSurface(page: Page): Promise<SurfaceValidation> {
  const problems: string[] = await page.evaluate(`(() => {
    const s = ${surfaceExpr()};
    if (!s) return ["surface not mounted"];
    const problems = [];
    const c = s.contract || {};
    if (c.name !== ${JSON.stringify(OBSERVABILITY_CONTRACT_NAME)}) problems.push("contract name mismatch: " + String(c.name));
    if (c.version !== ${OBSERVABILITY_CONTRACT_VERSION}) problems.push("contract version mismatch: " + String(c.version));
    const has = (path) => {
      let cur = s;
      for (const part of path.split(".")) {
        if (cur == null || typeof cur !== "object" || !(part in cur)) return false;
        cur = cur[part];
      }
      return typeof cur === "function";
    };
    for (const path of ${JSON.stringify(REQUIRED_SURFACE_METHODS)}) {
      if (!has(path)) problems.push("missing stable method '" + path + "()'");
    }
    return problems;
  })()`);
  return { valid: problems.length === 0, problems };
}

/**
 * Client over the mounted surface. Every method maps 1:1 to a stable contract
 * method; there is intentionally no generic evaluate-for-semantics API.
 */
export class StableSurfaceClient {
  constructor(private readonly page: Page) {}

  ready(): Promise<boolean> {
    return this.page.evaluate(withSurface(`(s) => s.ready()`)) as Promise<boolean>;
  }

  readiness(): Promise<Record<string, unknown>> {
    return this.page.evaluate(withSurface(`(s) => s.readiness()`)) as Promise<Record<string, unknown>>;
  }

  tick(): Promise<Record<string, unknown>> {
    return this.page.evaluate(withSurface(`(s) => s.tick()`)) as Promise<Record<string, unknown>>;
  }

  /** Koota-backed semantic snapshot via the stable `entities.snapshot()` method. */
  stateSnapshot(): Promise<Record<string, unknown>> {
    return this.page.evaluate(withSurface(`(s) => s.entities.snapshot()`)) as Promise<
      Record<string, unknown>
    >;
  }

  errorsRecent(): Promise<Array<Record<string, unknown>>> {
    return this.page.evaluate(withSurface(`(s) => s.errors.recent()`)) as Promise<
      Array<Record<string, unknown>>
    >;
  }

  rendererProbe(): Promise<Record<string, unknown>> {
    return this.page.evaluate(withSurface(`(s) => s.renderer.probe()`)) as Promise<Record<string, unknown>>;
  }

  networkRead(): Promise<Record<string, unknown>> {
    return this.page.evaluate(withSurface(`(s) => s.network.read()`)) as Promise<Record<string, unknown>>;
  }

  viewsList(): Promise<string[]> {
    return this.page.evaluate(withSurface(`(s) => s.views.list()`)) as Promise<string[]>;
  }

  async controlResetScenario(name?: string): Promise<void> {
    await this.page.evaluate(withSurface(`(s) => s.control.resetScenario(${JSON.stringify(name ?? null)}) `));
  }

  async controlSetSeed(seed: number): Promise<void> {
    await this.page.evaluate(withSurface(`(s) => s.control.setSeed(${JSON.stringify(seed)})`));
  }

  controlSeed(): Promise<number | null> {
    return this.page.evaluate(withSurface(`(s) => s.control.seed()`)) as Promise<number | null>;
  }

  async controlSetView(name: string): Promise<boolean> {
    return this.page.evaluate(withSurface(`(s) => s.control.setView(${JSON.stringify(name)})`)) as Promise<boolean>;
  }

  /** Bounded fixed-step through the privileged control namespace (dev/test only). */
  async controlStep(ticks: number): Promise<number> {
    return this.page.evaluate(withSurface(`(s) => s.control.step(${JSON.stringify(ticks)})`)) as Promise<number>;
  }

  async controlPause(): Promise<void> {
    await this.page.evaluate(withSurface(`(s) => s.control.pause()`));
  }

  controlIsPaused(): Promise<boolean> {
    return this.page.evaluate(withSurface(`(s) => s.control.isPaused()`)) as Promise<boolean>;
  }

  /** Renders one animation frame; used to settle the frame before pixel capture. */
  async settleFrame(): Promise<void> {
    await this.page.evaluate(
      `() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))))`
    );
  }
}
