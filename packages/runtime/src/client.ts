import { GauntletKernel } from "./kernel";
import { RenderProjectionManager } from "./projections/render";
import type { RuntimeDiagnostics } from "./types";
import type { RuntimeReadiness } from "@gauntlet/contracts";

export interface ClientRuntimeOptions {
  canvas?: unknown; // HTMLCanvasElement in browser, neutral in definitions
  enableAudio?: boolean;
  fixedDeltaTime?: number;
}

export class ClientRuntime {
  public readonly kernel: GauntletKernel;
  public readonly canvas?: unknown;
  public readonly renderProjections: RenderProjectionManager;

  constructor(options: ClientRuntimeOptions = {}) {
    this.canvas = options.canvas;
    this.renderProjections = new RenderProjectionManager();
    this.kernel = new GauntletKernel({
      mode: "client",
      schedulerOptions: { fixedDeltaTime: options.fixedDeltaTime },
    });

    // Register browser client subsystems
    this.kernel.barrier.register("rendering", true);
    this.kernel.barrier.register("physics", true);
    if (options.enableAudio) {
      this.kernel.barrier.register("audio", false);
    }
  }

  public async boot(): Promise<RuntimeReadiness> {
    return this.kernel.boot();
  }

  public render(alpha: number): void {
    // Render loop decoupled from authoritative simulation ticks
    // Synchronize latest authoritative state into visual projections
    this.renderProjections.syncFromState(this.kernel.gameWorld);
  }

  public getDiagnostics(): RuntimeDiagnostics {
    return this.kernel.getDiagnostics();
  }

  public dispose(): void {
    this.kernel.dispose();
  }
}
