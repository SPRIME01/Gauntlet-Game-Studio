export class RuntimeNotReadyError extends Error {
  public readonly code = "RUNTIME_NOT_READY";
  constructor(message?: string) {
    super(message || "Operation cannot proceed: runtime is still booting or has failed readiness barriers.");
    this.name = "RuntimeNotReadyError";
  }
}

export class SubsystemBootError extends Error {
  public readonly code = "SUBSYSTEM_BOOT_FAILED";
  constructor(public readonly subsystemId: string, message?: string) {
    super(message || `Subsystem '${subsystemId}' failed to initialize within the readiness barrier.`);
    this.name = "SubsystemBootError";
  }
}

export class MultipleSchedulerError extends Error {
  public readonly code = "MULTIPLE_SCHEDULERS_FORBIDDEN";
  constructor(message?: string) {
    super(message || "Invariant violation: exactly one authoritative simulation scheduler is permitted per runtime.");
    this.name = "MultipleSchedulerError";
  }
}

export class DuplicateStepOwnerError extends Error {
  public readonly code = "DUPLICATE_STEP_OWNER";
  constructor(message?: string) {
    super(message || "Invariant violation: simulation step owner cannot be invoked more than once per tick.");
    this.name = "DuplicateStepOwnerError";
  }
}

export class HeadlessDomLeakError extends Error {
  public readonly code = "HEADLESS_DOM_LEAK_DETECTED";
  constructor(public readonly symbol: string, message?: string) {
    super(message || `DOM or browser global '${symbol}' was referenced in headless server execution.`);
    this.name = "HeadlessDomLeakError";
  }
}

export class SinglePhysicsStepInvariantError extends Error {
  public readonly code = "SINGLE_PHYSICS_STEP_INVARIANT_VIOLATION";
  constructor(message?: string) {
    super(message || "Invariant violation: exactly one physics step is permitted per authoritative tick.");
    this.name = "SinglePhysicsStepInvariantError";
  }
}

