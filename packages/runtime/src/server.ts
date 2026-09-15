import { GauntletKernel } from "./kernel";
import { HeadlessDomLeakError } from "./errors";
import type { RuntimeDiagnostics } from "./types";
import type { RuntimeReadiness } from "@gauntlet/contracts";

/**
 * Validates that no DOM/canvas/WebAudio globals are referenced or required in headless execution.
 */
export function assertHeadlessEnvironment(): void {
  const forbiddenGlobals = ["window", "document", "HTMLCanvasElement", "AudioContext", "webkitAudioContext"];
  for (const g of forbiddenGlobals) {
    if (typeof (globalThis as Record<string, unknown>)[g] !== "undefined") {
      throw new HeadlessDomLeakError(g, `Forbidden browser global '${g}' detected in headless server execution environment.`);
    }
  }
}

export interface ServerRuntimeOptions {
  enablePhysics?: boolean;
  enableNavigation?: boolean;
}

export class ServerRuntime {
  public readonly kernel: GauntletKernel;

  constructor(options: ServerRuntimeOptions = {}) {
    // Assert headless environment cleanliness (TEETH-T07-003)
    assertHeadlessEnvironment();

    this.kernel = new GauntletKernel({ mode: "headless" });

    // Register required server subsystems
    if (options.enablePhysics !== false) {
      this.kernel.barrier.register("physics", true);
    }
    if (options.enableNavigation !== false) {
      this.kernel.barrier.register("navigation", true);
    }
  }

  public async boot(): Promise<RuntimeReadiness> {
    return this.kernel.boot();
  }

  public tick(): number {
    return this.kernel.scheduler.stepSingleTick().tick;
  }

  public getDiagnostics(): RuntimeDiagnostics {
    return this.kernel.getDiagnostics();
  }

  public dispose(): void {
    this.kernel.dispose();
  }
}
