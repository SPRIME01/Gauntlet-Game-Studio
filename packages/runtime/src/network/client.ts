/**
 * NetworkClient: client-side session for server-authoritative play.
 *
 * The client NEVER authors authoritative state. It sends validated sequenced
 * command intents ("cmd.*"), tracks the server's acknowledgement window, and
 * reconciles authoritative snapshots into a client-side PROJECTION world
 * (client-side prediction replays only on that projection; REQ-SAFE-006).
 * All client-side buffers are bounded (REQ-NET-004).
 *
 * Implements REQ-BIND-013, REQ-NET-002..006, REQ-SEC-007.
 */

import type { NetworkEnvelope } from "@gauntlet/contracts";
import { BandwidthTracker } from "../diagnostics/bandwidth";
import type { LatencySimulatorStats } from "../diagnostics/latency-sim";
import type { GameWorld } from "../state/world";
import {
  clientCommandEnvelope,
  controlEnvelope,
  decodeEnvelope,
  encodeEnvelope,
  type ClientCommandKind,
} from "./protocol";
import {
  cloneCounters,
  createNetworkCounters,
  RttEstimator,
  type NetworkClientDiagnostics,
  type NetworkCounters,
} from "./diagnostics";
import { reconcileSnapshot, type SnapshotView } from "./replication";
import type { ConnectionTransport, ConnectionState } from "./types";

export interface NetworkClientOptions {
  transport: ConnectionTransport;
  /** Client-side projection world for reconciliation. Optional; diagnostics-only without it. */
  projectionWorld?: GameWorld;
  /** Bound on unacknowledged pending commands. Default 128. */
  maxPendingCommands?: number;
  /** Automatically echo server liveness pings for RTT measurement. Default true. */
  autoRespondToServerPing?: boolean;
  /** Max commands replayed per reconciliation. Default 64. */
  maxReplayCommands?: number;
}

interface PendingCommand {
  envelope: NetworkEnvelope;
  sentAtMs: number;
}

export class NetworkClient {
  private readonly transport: ConnectionTransport;
  private readonly projection: GameWorld | null;
  private readonly maxPendingCommands: number;
  private readonly autoRespondToServerPing: boolean;
  private readonly maxReplayCommands: number;

  private readonly bandwidth = new BandwidthTracker();
  private readonly counters: NetworkCounters = createNetworkCounters();
  private readonly rtt = new RttEstimator();
  private readonly pending = new Map<number, PendingCommand>();

  private clientId: string | null = null;
  private entityId: string | null = null;
  private lastServerTick = 0;
  private lastAckedSequence = 0;
  private nextSequence = 0;
  private stateOverride: ConnectionState | null = null;
  private connected = false;

  constructor(options: NetworkClientOptions) {
    this.transport = options.transport;
    this.projection = options.projectionWorld ?? null;
    this.maxPendingCommands = Math.max(1, options.maxPendingCommands ?? 128);
    this.autoRespondToServerPing = options.autoRespondToServerPing ?? true;
    this.maxReplayCommands = Math.max(0, options.maxReplayCommands ?? 64);

    this.transport.onMessage((data) => this.handleRaw(data));
  }

  public async connect(): Promise<void> {
    await this.transport.connect();
    this.connected = true;
  }

  /**
   * Sends one validated sequenced command intent. The client assigns the
   * monotonically increasing sequence; the server acknowledges contiguity.
   */
  public sendCommand(kind: ClientCommandKind, payload: Record<string, unknown>): number {
    if (!this.connected) throw new Error("NetworkClient is not connected");
    const sequence = ++this.nextSequence;
    const envelope = clientCommandEnvelope(kind, sequence, payload);
    this.pending.set(sequence, { envelope, sentAtMs: performance.now() });

    // Bounded pending window (REQ-NET-004): drop the oldest unacknowledged.
    if (this.pending.size > this.maxPendingCommands) {
      const lowest = Math.min(...this.pending.keys());
      this.pending.delete(lowest);
      this.counters.pending_overflow_dropped++;
    }

    const raw = encodeEnvelope(envelope);
    const result = this.transport.send(raw);
    if (result.accepted) {
      this.bandwidth.recordSent("server", result.bytes);
    }
    return sequence;
  }

  public close(): void {
    this.transport.close();
    this.connected = false;
  }

  public getState(): ConnectionState {
    if (this.stateOverride) return this.stateOverride;
    return this.transport.getState();
  }

  public getClientId(): string | null {
    return this.clientId;
  }

  public getEntityId(): string | null {
    return this.entityId;
  }

  public getLastAckedSequence(): number {
    return this.lastAckedSequence;
  }

  public getPendingCount(): number {
    return this.pending.size;
  }

  /** Ordered unacknowledged command envelopes (bounded). */
  public getPendingCommands(): NetworkEnvelope[] {
    return Array.from(this.pending.values())
      .map((p) => p.envelope)
      .sort((a, b) => a.sequence - b.sequence);
  }

  /** LatencySimulator stats when the bound transport is latency-impaired. */
  private getLatencySimStats(): LatencySimulatorStats | null {
    const maybe = this.transport as { getLatencySimulator?: () => { getStats(): LatencySimulatorStats } };
    if (typeof maybe.getLatencySimulator === "function") {
      return maybe.getLatencySimulator().getStats();
    }
    return null;
  }

  public getDiagnostics(): NetworkClientDiagnostics {
    return {
      connection_state: this.getState(),
      client_id: this.clientId,
      entity_id: this.entityId,
      last_server_tick: this.lastServerTick,
      last_acked_sequence: this.lastAckedSequence,
      pending_commands: this.pending.size,
      next_sequence: this.nextSequence,
      rtt_ms: this.rtt.getLastMs(),
      rtt_ewma_ms: this.rtt.getEwmaMs(),
      counters: cloneCounters(this.counters),
      bandwidth: this.bandwidth.getTotalUsage(),
      latency_simulation: this.getLatencySimStats(),
    };
  }

  // -------------------------------------------------------------------------
  // Inbound path
  // -------------------------------------------------------------------------

  private handleRaw(data: string): void {
    const bytes = new TextEncoder().encode(data).byteLength;
    this.bandwidth.recordReceived("server", bytes);

    const decoded = decodeEnvelope(data);
    if (!decoded.ok) {
      this.counters.invalid_envelopes++;
      return;
    }
    const envelope = decoded.envelope;

    switch (envelope.kind) {
      case "net.welcome": {
        this.clientId =
          typeof envelope.payload.client_id === "string" ? envelope.payload.client_id : null;
        this.entityId =
          typeof envelope.payload.entity_id === "string" ? envelope.payload.entity_id : null;
        if (typeof envelope.payload.server_tick === "number") {
          this.lastServerTick = envelope.payload.server_tick;
        }
        break;
      }
      case "net.pong": {
        const clientTimeMs = envelope.payload.client_time_ms;
        if (typeof clientTimeMs === "number" && Number.isFinite(clientTimeMs)) {
          this.rtt.sample(Math.max(0, performance.now() - clientTimeMs));
        }
        break;
      }
      case "net.ping": {
        if (this.autoRespondToServerPing) {
          const raw = encodeEnvelope(
            controlEnvelope("net.pong", { server_time_ms: envelope.payload.server_time_ms })
          );
          const result = this.transport.send(raw);
          if (result.accepted) this.bandwidth.recordSent("server", result.bytes);
        }
        break;
      }
      case "net.reject": {
        this.counters.rejects_received++;
        break;
      }
      case "net.disconnect": {
        // Explicit server-driven disconnect (e.g. timeout): observable state.
        this.stateOverride = "disconnected";
        this.connected = false;
        break;
      }
      case "replication.snapshot": {
        this.handleSnapshot(envelope);
        break;
      }
      default:
        // Unknown server kind: ignore, counted.
        this.counters.invalid_envelopes++;
        break;
    }
  }

  private handleSnapshot(envelope: NetworkEnvelope): void {
    this.counters.snapshots_received++;

    // Acknowledgement window: drop pending commands the server processed.
    const ack = envelope.ack_sequence;
    if (typeof ack === "number" && ack >= 0) {
      for (const seq of Array.from(this.pending.keys())) {
        if (seq <= ack) this.pending.delete(seq);
      }
      this.lastAckedSequence = Math.max(this.lastAckedSequence, ack);
    }

    if (typeof envelope.server_tick === "number") {
      this.lastServerTick = envelope.server_tick;
    }

    if (!this.projection) return;

    const payload = envelope.payload as unknown as SnapshotView;
    if (!payload || !Array.isArray(payload.entities)) return;

    const result = reconcileSnapshot(
      this.projection,
      {
        tick: payload.tick ?? this.lastServerTick,
        entities: payload.entities,
        removed_entity_ids: Array.isArray(payload.removed_entity_ids) ? payload.removed_entity_ids : [],
      },
      this.getPendingCommands(),
      this.maxReplayCommands
    );
    this.counters.reconciliations++;
    void result;
  }
}
