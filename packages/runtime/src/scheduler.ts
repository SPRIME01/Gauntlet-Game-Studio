import type { SimulationTick, SimulationStepHandler } from "./types";
import { MultipleSchedulerError, DuplicateStepOwnerError } from "./errors";

export interface SchedulerOptions {
  fixedDeltaTime?: number; // e.g. 1/60
  maxSubSteps?: number;
}

export class SimulationScheduler {
  private static activeScheduler: SimulationScheduler | null = null;

  public readonly fixedDeltaTime: number;
  public readonly maxSubSteps: number;

  private currentTick = 0;
  private currentTime = 0;
  private accumulator = 0;
  private running = false;
  private registeredHandlers: SimulationStepHandler[] = [];
  private steppedThisTick = false;

  constructor(options: SchedulerOptions = {}) {
    if (SimulationScheduler.activeScheduler !== null && SimulationScheduler.activeScheduler !== this) {
      throw new MultipleSchedulerError("A simulation scheduler is already registered and active in the runtime.");
    }
    this.fixedDeltaTime = options.fixedDeltaTime ?? 1 / 60;
    this.maxSubSteps = options.maxSubSteps ?? 5;
    SimulationScheduler.activeScheduler = this;
  }

  public static resetActiveScheduler(): void {
    SimulationScheduler.activeScheduler = null;
  }

  public registerStepHandler(handler: SimulationStepHandler): void {
    this.registeredHandlers.push(handler);
  }

  /**
   * Advances simulation by wall clock delta time.
   * Performs fixed-timestep sub-steps up to maxSubSteps.
   */
  public advance(deltaTime: number): number {
    this.accumulator += Math.min(deltaTime, this.fixedDeltaTime * this.maxSubSteps);
    let steps = 0;

    while (this.accumulator >= this.fixedDeltaTime && steps < this.maxSubSteps) {
      this.stepSingleTick();
      this.accumulator -= this.fixedDeltaTime;
      steps++;
    }

    return steps;
  }

  /**
   * Performs exactly one authoritative simulation tick.
   */
  public stepSingleTick(): SimulationTick {
    this.steppedThisTick = false;
    this.currentTick++;
    this.currentTime += this.fixedDeltaTime;

    const tickInfo: SimulationTick = {
      tick: this.currentTick,
      time: this.currentTime,
      dt: this.fixedDeltaTime,
    };

    // Execute step owner handlers
    for (const handler of this.registeredHandlers) {
      handler(tickInfo);
    }
    this.steppedThisTick = true;

    return tickInfo;
  }

  /**
   * Directly invokes step owner for the current tick, with invariant enforcement (TEETH-T07-002).
   */
  public executeStepOwner(ownerName: string, stepFn: () => void): void {
    if (this.steppedThisTick) {
      throw new DuplicateStepOwnerError(`Step owner '${ownerName}' was already executed for tick #${this.currentTick}. Duplicate step forbidden.`);
    }
    stepFn();
    this.steppedThisTick = true;
  }

  public getTick(): number {
    return this.currentTick;
  }

  public getTime(): number {
    return this.currentTime;
  }

  public getAlpha(): number {
    return this.accumulator / this.fixedDeltaTime;
  }

  public start(): void {
    this.running = true;
  }

  public stop(): void {
    this.running = false;
  }

  public isRunning(): boolean {
    return this.running;
  }
}
