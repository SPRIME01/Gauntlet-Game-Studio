/**
 * Network type contracts for Gauntlet Runtime.
 * Transport-neutral material characteristics, explicit connection states,
 * and session diagnostics. Implements REQ-BIND-013, REQ-NET-002, REQ-NET-009.
 */

/**
 * Material transport characteristics.
 * Callers MUST inspect these instead of assuming WebSocket and WebRTC (or any
 * other transport) share equivalent semantics. Implements REQ-BIND-013/REQ-NET-002.
 */
export interface TransportCharacteristics {
  /** Stable transport binding name, e.g. "bun-websocket", "in-memory-loopback". */
  readonly name: string;
  /** Every accepted send is eventually delivered exactly once (no silent loss). */
  readonly reliable: boolean;
  /** Messages arrive in send order. */
  readonly ordered: boolean;
  /** Transport can additionally deliver unreliable (lossy) messages, e.g. WebRTC data channels. */
  readonly supportsUnreliable: boolean;
  /** Transport can additionally deliver unordered messages, e.g. WebRTC data channels. */
  readonly supportsUnordered: boolean;
  /** Hard upper bound for a single serialized message, in bytes. */
  readonly maxMessageBytes: number;
  /**
   * Routing/boundary note. The baseline binding is Bun native WebSockets.
   * WebRTC/geckos.io is an OPTIONAL advanced transport for unreliable/unordered
   * delivery and is intentionally NOT a baseline dependency (REQ-BIND-013).
   */
  readonly note: string;
}

/**
 * Explicit observable connection states (REQ-NET-009).
 * Disconnect, timeout, and transport failure are first-class states; they are
 * never silently collapsed into "connected" and never silently mutate semantic
 * authority.
 */
export type ConnectionState =
  | "new"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "timed_out"
  | "failed"
  | "closed";

/** Terminal connection states. */
export const TERMINAL_CONNECTION_STATES: ReadonlySet<ConnectionState> = new Set([
  "disconnected",
  "timed_out",
  "failed",
  "closed",
]);

/** Backpressure snapshot exposed by a transport (REQ-BIND-013). */
export interface BackpressureInfo {
  /** Bytes queued by the transport but not yet flushed to the wire. */
  readonly pendingBytes: number;
  /** Messages queued by the transport but not yet flushed to the wire. */
  readonly pendingMessages: number;
}

export interface SendOptions {
  /** Request reliable delivery (default true). Must be supported or the send is rejected. */
  reliable?: boolean;
  /** Request ordered delivery (default per-transport). Must be supported or the send is rejected. */
  ordered?: boolean;
}

export interface SendResult {
  accepted: boolean;
  bytes: number;
  /** Populated when accepted is false, e.g. "unreliable_not_supported". */
  reason?: string;
}

/**
 * Client-side transport for a single logical connection.
 * Implementations MUST NOT interpret envelope contents; they move serialized
 * messages and expose material characteristics only.
 */
export interface ConnectionTransport {
  readonly characteristics: TransportCharacteristics;
  connect(): Promise<void>;
  send(data: string, options?: SendOptions): SendResult;
  close(code?: number, reason?: string): void;
  getState(): ConnectionState;
  getBackpressure(): BackpressureInfo;
  /** Transport-level measured RTT in ms, or null when the transport cannot measure one. */
  getTransportRttMs(): number | null;
  onMessage(handler: (data: string) => void): void;
  onStateChange(handler: (state: ConnectionState, detail?: string) => void): void;
}

/** One accepted server-side connection. */
export interface ServerConnection {
  /** Server-assigned stable connection id (also used as the client_id). */
  readonly id: string;
  getBackpressure(): BackpressureInfo;
  send(data: string, options?: SendOptions): SendResult;
  close(code?: number, reason?: string): void;
}

export type ServerConnectionEvent =
  | { type: "open"; connection: ServerConnection }
  | { type: "close"; connection: ServerConnection; code: number; reason: string };

/**
 * Server-side transport accepting client connections.
 * Implementations MUST remain replaceable behind this boundary (REQ-NET-002).
 */
export interface ServerTransport {
  readonly characteristics: TransportCharacteristics;
  listen(): Promise<{ port: number; url: string }>;
  stop(closeActiveConnections?: boolean): Promise<void>;
  getAddress(): { port: number; url: string } | null;
  onConnectionEvent(handler: (event: ServerConnectionEvent) => void): void;
  onConnectionMessage(handler: (connectionId: string, data: string) => void): void;
}
