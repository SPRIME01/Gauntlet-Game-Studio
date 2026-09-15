import { SubsystemBarrier } from "./readiness";
import { SimulationScheduler, type SchedulerOptions } from "./scheduler";
import type { RuntimeMode, RuntimeDiagnostics } from "./types";
import type { RuntimeReadiness } from "@gauntlet/contracts";

export interface KernelOptions {
  mode?: RuntimeMode;
  schedulerOptions?: SchedulerOptions;
}

export class GauntletKernel {
  public readonly mode: RuntimeMode;
  public readonly barrier: SubsystemBarrier;
  public readonly scheduler: SimulationScheduler;

  constructor(options: KernelOptions = {}) {
    this.mode = options.mode ?? "local-authoritative";
    this.barrier = new SubsystemBarrier();
    this.scheduler = new SimulationScheduler(options.schedulerOptions);
  }

  public async boot(timeoutMs = 5000): Promise<RuntimeReadiness> {
    return this.barrier.awaitReady(timeoutMs);
  }

  public getDiagnostics(): RuntimeDiagnostics {
    const readiness = this.barrier.getReadiness();
    return {
      mode: this.mode,
      state: readiness.state,
      tick: this.scheduler.getTick(),
      simulation_time: this.scheduler.getTime(),
      subsystems: this.barrier.getSubsystems(),
    };
  }

  public dispose(): void {
    this.scheduler.stop();
    SimulationScheduler.resetActiveScheduler();
  }
}
