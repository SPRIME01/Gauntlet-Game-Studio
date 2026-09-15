import type { RuntimeReadiness } from "@gauntlet/contracts";
import type { SubsystemId, SubsystemDescriptor } from "./types";
import { RuntimeNotReadyError, SubsystemBootError } from "./errors";

export class SubsystemBarrier {
  private subsystems = new Map<SubsystemId, SubsystemDescriptor>();
  private readyPromise: Promise<RuntimeReadiness>;
  private resolveReady!: (val: RuntimeReadiness) => void;
  private rejectReady!: (err: Error) => void;
  private settled = false;
  private startedAt: string;
  private readyAt?: string;

  constructor() {
    this.startedAt = new Date().toISOString();
    this.readyPromise = new Promise<RuntimeReadiness>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.readyPromise.catch(() => {});
  }

  public register(id: SubsystemId, required = true): void {
    if (this.settled) {
      throw new Error(`Cannot register subsystem '${id}' after readiness barrier has settled.`);
    }
    this.subsystems.set(id, {
      id,
      required,
      state: "uninitialized",
    });
  }

  public markBooting(id: SubsystemId): void {
    const sub = this.subsystems.get(id);
    if (!sub) throw new Error(`Unknown subsystem '${id}'`);
    sub.state = "booting";
  }

  public markReady(id: SubsystemId, bootDurationMs?: number): void {
    const sub = this.subsystems.get(id);
    if (!sub) throw new Error(`Unknown subsystem '${id}'`);
    sub.state = "ready";
    sub.bootDurationMs = bootDurationMs;
    this.checkSettlement();
  }

  public markFailed(id: SubsystemId, error: string): void {
    const sub = this.subsystems.get(id);
    if (!sub) throw new Error(`Unknown subsystem '${id}'`);
    sub.state = "failed";
    sub.error = error;
    this.checkSettlement();
  }

  private checkSettlement(): void {
    if (this.settled) return;

    let allRequiredReady = true;
    let anyRequiredFailed = false;
    let failedReason = "";
    let failedId = "unknown";

    for (const sub of this.subsystems.values()) {
      if (sub.required) {
        if (sub.state === "failed") {
          anyRequiredFailed = true;
          failedReason = sub.error || `Subsystem '${sub.id}' failed to boot.`;
          failedId = sub.id;
          break;
        }
        if (sub.state !== "ready") {
          allRequiredReady = false;
        }
      }
    }

    if (anyRequiredFailed) {
      this.settled = true;
      this.rejectReady(new SubsystemBootError(failedId, failedReason));
    } else if (allRequiredReady && this.subsystems.size > 0) {
      this.settled = true;
      this.readyAt = new Date().toISOString();
      this.resolveReady(this.getReadiness());
    }
  }

  public getReadiness(): RuntimeReadiness {
    const list = Array.from(this.subsystems.values());
    const hasFailed = list.some((s) => s.required && s.state === "failed");
    const allReady = list.length > 0 && list.every((s) => !s.required || s.state === "ready");

    let state: "created" | "booting" | "ready" | "failed" = "booting";
    if (hasFailed) state = "failed";
    else if (allReady) state = "ready";
    else if (list.length === 0 || list.every((s) => s.state === "uninitialized")) state = "created";

    const subsystemStates: Record<string, "uninitialized" | "booting" | "ready" | "failed"> = {};
    for (const s of list) {
      subsystemStates[s.id] = s.state;
    }

    const failedSub = list.find((s) => s.required && s.state === "failed");

    return {
      state,
      required_subsystems: list.filter((s) => s.required).map((s) => s.id),
      subsystem_states: subsystemStates,
      failure: failedSub?.error,
      started_at: this.startedAt,
      ready_at: this.readyAt,
    };
  }

  public isReady(): boolean {
    const r = this.getReadiness();
    return r.state === "ready";
  }

  public async awaitReady(timeoutMs = 5000): Promise<RuntimeReadiness> {
    if (this.isReady()) {
      return this.getReadiness();
    }

    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new RuntimeNotReadyError(`Readiness barrier timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([this.readyPromise, timeoutPromise]);
      return result;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  public startScenario<T>(scenarioFn: () => T): T {
    if (!this.isReady()) {
      const r = this.getReadiness();
      const notReady = Array.from(this.subsystems.values())
        .filter((s) => s.required && s.state !== "ready")
        .map((s) => `${s.id} (${s.state})`);
      throw new RuntimeNotReadyError(
        `Cannot start scenario: runtime state is '${r.state}'. Subsystems not ready: ${notReady.join(", ")}`
      );
    }
    return scenarioFn();
  }

  public getSubsystems(): Record<SubsystemId, SubsystemDescriptor> {
    return Object.fromEntries(this.subsystems.entries());
  }
}
