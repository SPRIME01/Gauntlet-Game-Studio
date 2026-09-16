/**
 * LatencySimulator
 * Network latency, jitter, and packet loss simulation for Gauntlet Runtime.
 * Adapted from donor mechanism concepts without adopting donor semantics.
 * Implements REQ-DONOR-005 and REQ-NET-003.
 */

export interface LatencySimulatorOptions {
  /** Fixed minimum latency in milliseconds */
  fixedLatencyMs?: number;
  /** Latency jitter amplitude (+/- jitterMs / 2) */
  jitterMs?: number;
  /** Packet loss ratio between 0.0 (no drop) and 1.0 (drop all) */
  packetLossRatio?: number;
  /** Optional deterministic random number generator for test reproducibility */
  randomFn?: () => number;
}

export interface LatencySimulatorStats {
  scheduledCount: number;
  droppedCount: number;
  completedCount: number;
  dropRateObserved: number;
}

export class LatencySimulator {
  private readonly options: Required<LatencySimulatorOptions>;
  private scheduledCount = 0;
  private droppedCount = 0;
  private completedCount = 0;
  private pendingTimeouts = new Set<ReturnType<typeof setTimeout>>();

  constructor(options: LatencySimulatorOptions = {}) {
    this.options = {
      fixedLatencyMs: options.fixedLatencyMs ?? 0,
      jitterMs: options.jitterMs ?? 0,
      packetLossRatio: Math.max(0, Math.min(1, options.packetLossRatio ?? 0)),
      randomFn: options.randomFn ?? Math.random,
    };
  }

  /**
   * Schedules execution of a callback subject to simulated latency, jitter, and drop probability.
   * Returns true if packet was scheduled, or false if dropped.
   */
  public handle<T>(payload: T, callback: (payload: T) => void): boolean {
    const roll = this.options.randomFn();
    if (roll < this.options.packetLossRatio) {
      this.droppedCount++;
      return false;
    }

    this.scheduledCount++;
    const jitter = (this.options.randomFn() - 0.5) * this.options.jitterMs;
    const delay = Math.max(0, this.options.fixedLatencyMs + jitter);

    if (delay === 0) {
      this.completedCount++;
      callback(payload);
      return true;
    }

    const timer = setTimeout(() => {
      this.pendingTimeouts.delete(timer);
      this.completedCount++;
      callback(payload);
    }, delay);

    this.pendingTimeouts.add(timer);
    return true;
  }

  /**
   * Returns current simulation statistics.
   */
  public getStats(): LatencySimulatorStats {
    const total = this.scheduledCount + this.droppedCount;
    return {
      scheduledCount: this.scheduledCount,
      droppedCount: this.droppedCount,
      completedCount: this.completedCount,
      dropRateObserved: total > 0 ? this.droppedCount / total : 0,
    };
  }

  /**
   * Cancels all pending simulated packets and cleans up timers.
   */
  public reset(): void {
    for (const timer of this.pendingTimeouts) {
      clearTimeout(timer);
    }
    this.pendingTimeouts.clear();
    this.scheduledCount = 0;
    this.droppedCount = 0;
    this.completedCount = 0;
  }
}
