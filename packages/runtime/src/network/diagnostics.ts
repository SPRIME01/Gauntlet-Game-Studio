/**
 * Network diagnostics for Gauntlet Runtime (REQ-NET-006).
 * Ping/RTT, bandwidth, connection state, command/replication counters, and
 * latency-simulation impairment exposure. Uses the first-party BandwidthTracker
 * and LatencySimulator from ../diagnostics.
 */

import type { LatencySimulatorStats } from "../diagnostics/latency-sim";
import type { BandwidthUsage } from "../diagnostics/bandwidth";
import type { ConnectionState } from "./types";

/** Monotonic behavior counters for one networked runtime. */
export interface NetworkCounters {
  connections_accepted: number;
  disconnections: number;
  timeouts: number;
  commands_processed: number;
  commands_rejected: number;
  forged_rejected: number;
  duplicates_dropped: number;
  oversized_dropped: number;
  malformed_dropped: number;
  invalid_envelopes: number;
  out_of_order_buffered: number;
  out_of_order_processed: number;
  buffered_overflow_dropped: number;
  sequence_skips: number;
  snapshots_sent: number;
  snapshots_received: number;
  reconciliations: number;
  pending_overflow_dropped: number;
  rejects_received: number;
}

export function createNetworkCounters(): NetworkCounters {
  return {
    connections_accepted: 0,
    disconnections: 0,
    timeouts: 0,
    commands_processed: 0,
    commands_rejected: 0,
    forged_rejected: 0,
    duplicates_dropped: 0,
    oversized_dropped: 0,
    malformed_dropped: 0,
    invalid_envelopes: 0,
    out_of_order_buffered: 0,
    out_of_order_processed: 0,
    buffered_overflow_dropped: 0,
    sequence_skips: 0,
    snapshots_sent: 0,
    snapshots_received: 0,
    reconciliations: 0,
    pending_overflow_dropped: 0,
    rejects_received: 0,
  };
}

export function cloneCounters(c: NetworkCounters): NetworkCounters {
  return { ...c };
}

/** Exponentially-weighted moving average helper for RTT (ms). */
export class RttEstimator {
  private ewma: number | null = null;
  private last: number | null = null;

  public constructor(private readonly alpha = 0.2) {}

  public sample(rttMs: number): void {
    if (!Number.isFinite(rttMs) || rttMs < 0) return;
    this.last = rttMs;
    this.ewma = this.ewma === null ? rttMs : this.ewma + this.alpha * (rttMs - this.ewma);
  }

  public getEwmaMs(): number | null {
    return this.ewma;
  }

  public getLastMs(): number | null {
    return this.last;
  }
}

export interface NetworkClientSummary {
  client_id: string;
  state: ConnectionState;
  entity_id: string | null;
  last_ack_sequence: number;
  buffered_commands: number;
  rtt_ms: number | null;
  bandwidth: BandwidthUsage;
}

export interface NetworkServerDiagnostics {
  listening: boolean;
  tick: number;
  transport: string;
  clients: NetworkClientSummary[];
  closed_clients: NetworkClientSummary[];
  counters: NetworkCounters;
  bandwidth: { sent: number; received: number; total: number };
  latency_simulation: LatencySimulatorStats | null;
}

export interface NetworkClientDiagnostics {
  connection_state: ConnectionState;
  client_id: string | null;
  entity_id: string | null;
  last_server_tick: number;
  last_acked_sequence: number;
  pending_commands: number;
  next_sequence: number;
  rtt_ms: number | null;
  rtt_ewma_ms: number | null;
  counters: NetworkCounters;
  bandwidth: { sent: number; received: number; total: number };
  latency_simulation: LatencySimulatorStats | null;
}
