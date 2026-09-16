/**
 * Transport bindings for Gauntlet Runtime networking.
 * - InMemoryTransportPair: deterministic loopback transport for pure tests and
 *   diagnostics harnesses (no sockets, no timers beyond caller control).
 * - LatencyImpairedTransport: wraps any ConnectionTransport and routes sends
 *   through the first-party LatencySimulator to produce realistic delay,
 *   jitter, reordering, and packet loss under test.
 * The Bun native WebSocket baseline binding lives in bun-websocket.ts.
 * Implements REQ-BIND-013, REQ-NET-002, REQ-NET-006.
 */

import { LatencySimulator } from "../diagnostics/latency-sim";
import type {
  BackpressureInfo,
  ConnectionTransport,
  ConnectionState,
  SendOptions,
  SendResult,
  ServerConnection,
  ServerConnectionEvent,
  ServerTransport,
  TransportCharacteristics,
} from "./types";

/** Shared baseline WebSocket characteristic facts (REQ-BIND-013). */
export const WEBSOCKET_CHARACTERISTICS: Omit<TransportCharacteristics, "name" | "note"> = {
  reliable: true,
  ordered: true,
  supportsUnreliable: false,
  supportsUnordered: false,
  maxMessageBytes: 64 * 1024,
};

export function describeOptionalWebRTCNote(): string {
  return (
    "Baseline binding: Bun native WebSockets (reliable, ordered). " +
    "WebRTC/geckos.io is an optional advanced transport for unreliable/unordered delivery " +
    "and is intentionally NOT a baseline dependency (REQ-BIND-013)."
  );
}

/**
 * Delivery options are explicit contract surface: requesting a delivery mode a
 * transport does not support is REJECTED (never silently degraded), so callers
 * can branch on characteristics instead of assuming WebSocket/WebRTC semantic
 * equivalence (REQ-NET-002). Returns a rejection reason or null.
 */
export function evaluateSendOptions(
  options: SendOptions | undefined,
  characteristics: TransportCharacteristics
): string | null {
  if (options?.reliable === false && !characteristics.supportsUnreliable) {
    return "unreliable_not_supported";
  }
  if (options?.ordered === false && !characteristics.supportsUnordered) {
    return "unordered_not_supported";
  }
  return null;
}

// ---------------------------------------------------------------------------
// In-memory loopback transport (deterministic; no sockets).
// ---------------------------------------------------------------------------

const IN_MEMORY_NOTE =
  "Deterministic in-memory loopback for pure tests; not a network transport. " + describeOptionalWebRTCNote();

class InMemoryServerConnection implements ServerConnection {
  constructor(
    public readonly id: string,
    private readonly incoming: (data: string) => void,
    private readonly serverRef: InMemoryServerTransport
  ) {}

  getBackpressure(): BackpressureInfo {
    return { pendingBytes: 0, pendingMessages: 0 };
  }

  send(data: string, options?: SendOptions): SendResult {
    const rejected = evaluateSendOptions(options, this.serverRef.characteristics);
    if (rejected) return { accepted: false, bytes: byteSize(data), reason: rejected };
    if (byteSize(data) > this.serverRef.characteristics.maxMessageBytes) {
      return { accepted: false, bytes: byteSize(data), reason: "message_too_large" };
    }
    this.serverRef.deliverToClient(this.id, data);
    return { accepted: true, bytes: byteSize(data) };
  }

  close(): void {
    this.serverRef.connectionClosed(this.id);
  }

  /** Test/diagnostic seam: client -> server direction. */
  emitFromClient(data: string): void {
    this.incoming(data);
  }
}

/**
 * Server-side in-memory transport. Clients connect via connectInMemoryClient().
 */
export class InMemoryServerTransport implements ServerTransport {
  public readonly characteristics: TransportCharacteristics = {
    name: "in-memory-loopback",
    ...WEBSOCKET_CHARACTERISTICS,
    maxMessageBytes: Number.MAX_SAFE_INTEGER,
    note: IN_MEMORY_NOTE,
  };

  private listening = false;
  private nextId = 0;
  private readonly connections = new Map<string, InMemoryServerConnection>();
  private readonly clientSinks = new Map<string, (data: string) => void>();
  private readonly closedClients = new Map<string, () => void>();
  private connectionEventHandler: ((event: ServerConnectionEvent) => void) | null = null;
  private messageHandler: ((connectionId: string, data: string) => void) | null = null;

  async listen(): Promise<{ port: number; url: string }> {
    this.listening = true;
    return { port: 0, url: "in-memory://loopback" };
  }

  async stop(): Promise<void> {
    this.listening = false;
    for (const id of Array.from(this.connections.keys())) this.connectionClosed(id);
  }

  getAddress(): { port: number; url: string } | null {
    return this.listening ? { port: 0, url: "in-memory://loopback" } : null;
  }

  onConnectionEvent(handler: (event: ServerConnectionEvent) => void): void {
    this.connectionEventHandler = handler;
  }

  onConnectionMessage(handler: (connectionId: string, data: string) => void): void {
    this.messageHandler = handler;
  }

  /** Creates a client-side ConnectionTransport wired to this server. */
  connectClient(): ConnectionTransport {
    const id = `client-${++this.nextId}`;
    let state: ConnectionState = "connecting";
    let stateHandler: ((state: ConnectionState, detail?: string) => void) | null = null;
    let messageSink: ((data: string) => void) | null = null;

    this.clientSinks.set(id, (data) => messageSink?.(data));
    this.closedClients.set(id, () => {
      if (state !== "closed" && state !== "disconnected") {
        state = "disconnected";
        stateHandler?.(state, "server_closed_connection");
      }
    });

    const connection = new InMemoryServerConnection(id, (data) => this.messageHandler?.(id, data), this);
    this.connections.set(id, connection);

    const transport: ConnectionTransport = {
      characteristics: this.characteristics,
      connect: async () => {
        if (!this.listening) throw new Error("In-memory server transport is not listening");
        state = "connected";
        stateHandler?.(state);
        this.connectionEventHandler?.({ type: "open", connection });
      },
      send: (data: string, options?: SendOptions) => {
        if (state !== "connected") return { accepted: false, bytes: byteSize(data), reason: "not_connected" };
        const rejected = evaluateSendOptions(options, this.characteristics);
        if (rejected) return { accepted: false, bytes: byteSize(data), reason: rejected };
        connection.emitFromClient(data);
        return { accepted: true, bytes: byteSize(data) };
      },
      close: () => {
        if (state === "connected") {
          state = "closed";
          stateHandler?.(state, "client_closed");
          this.connectionEventHandler?.({ type: "close", connection, code: 1000, reason: "client_close" });
          this.connections.delete(id);
          this.clientSinks.delete(id);
          this.closedClients.delete(id);
        }
      },
      getState: () => state,
      getBackpressure: () => ({ pendingBytes: 0, pendingMessages: 0 }),
      getTransportRttMs: () => null,
      onMessage: (handler) => {
        messageSink = handler;
      },
      onStateChange: (handler) => {
        stateHandler = handler;
      },
    };
    return transport;
  }

  /** Server-side close of one connection (client observes "disconnected"). */
  closeConnection(id: string): void {
    const conn = this.connections.get(id);
    if (!conn) return;
    this.connectionEventHandler?.({ type: "close", connection: conn, code: 1000, reason: "server_close" });
    this.connections.delete(id);
    const sink = this.closedClients.get(id);
    sink?.();
    this.clientSinks.delete(id);
    this.closedClients.delete(id);
  }

  /** @internal */
  deliverToClient(id: string, data: string): void {
    this.clientSinks.get(id)?.(data);
  }

  /** @internal */
  connectionClosed(id: string): void {
    const conn = this.connections.get(id);
    if (!conn) return;
    this.connectionEventHandler?.({ type: "close", connection: conn, code: 1005, reason: "no_status" });
    this.connections.delete(id);
    this.closedClients.get(id)?.();
    this.clientSinks.delete(id);
    this.closedClients.delete(id);
  }
}

function byteSize(s: string): number {
  return new TextEncoder().encode(s).byteLength;
}

// ---------------------------------------------------------------------------
// Latency-impaired transport wrapper (diagnostics-driven impairment).
// ---------------------------------------------------------------------------

/**
 * Wraps a ConnectionTransport and subjects every outbound send to the
 * first-party LatencySimulator: configurable fixed latency, jitter (which can
 * reorder messages), and packet loss. Impairment statistics remain observable
 * for evidence (REQ-NET-006). This wrapper NEVER rewrites envelope contents.
 */
export class LatencyImpairedTransport implements ConnectionTransport {
  public readonly characteristics: TransportCharacteristics;
  private readonly inner: ConnectionTransport;
  private readonly simulator: LatencySimulator;
  private messageHandler: ((data: string) => void) | null = null;
  private deliveredAfterClose = 0;

  constructor(inner: ConnectionTransport, simulatorOptions = {}) {
    this.inner = inner;
    this.simulator = new LatencySimulator(simulatorOptions);
    this.characteristics = {
      ...inner.characteristics,
      name: `${inner.characteristics.name}+latency-sim`,
      // The simulator introduces loss and reordering; surface that honestly.
      reliable: false,
      ordered: false,
      note:
        "Impaired test wrapper: outbound messages pass through LatencySimulator " +
        "(delay/jitter/reorder/loss). " +
        describeOptionalWebRTCNote(),
    };
    inner.onMessage((data) => this.messageHandler?.(data));
  }

  /** Direct access for diagnostics/evidence (REQ-NET-006). */
  getLatencySimulator(): LatencySimulator {
    return this.simulator;
  }

  connect(): Promise<void> {
    return this.inner.connect();
  }

  send(data: string, options?: SendOptions): SendResult {
    // Delivery decision (drop) happens immediately; accepted sends are
    // scheduled through the simulator so delay/jitter can reorder them.
    const rejected = evaluateSendOptions(options, this.characteristics);
    if (rejected) return { accepted: false, bytes: byteSize(data), reason: rejected };
    const accepted = this.simulator.handle(data, (payload) => {
      if (this.inner.getState() === "connected") {
        this.inner.send(payload, options);
      } else {
        this.deliveredAfterClose++;
      }
    });
    if (!accepted) {
      return { accepted: false, bytes: byteSize(data), reason: "simulated_packet_loss" };
    }
    return { accepted: true, bytes: byteSize(data) };
  }

  close(code?: number, reason?: string): void {
    this.simulator.reset();
    this.inner.close(code, reason);
  }

  getState(): ConnectionState {
    return this.inner.getState();
  }

  getBackpressure(): BackpressureInfo {
    return this.inner.getBackpressure();
  }

  getTransportRttMs(): number | null {
    return this.inner.getTransportRttMs();
  }

  onMessage(handler: (data: string) => void): void {
    this.messageHandler = handler;
  }

  onStateChange(handler: (state: ConnectionState, detail?: string) => void): void {
    this.inner.onStateChange(handler);
  }

  /** Count of simulator callbacks that arrived after the inner transport closed. */
  getDeliveredAfterClose(): number {
    return this.deliveredAfterClose;
  }
}
