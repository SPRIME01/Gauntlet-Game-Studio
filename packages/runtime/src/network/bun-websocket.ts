/**
 * Bun native WebSocket baseline transport binding (REQ-BIND-013).
 * Server side uses Bun.serve's built-in WebSocket support; client side uses the
 * standard WebSocket API available in Bun. No new npm dependency is required.
 * WebRTC/geckos.io remains an OPTIONAL advanced transport and is intentionally
 * not implemented here (documented, not-baseline; REQ-BIND-013, REQ-NET-002).
 */

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
import { WEBSOCKET_CHARACTERISTICS, describeOptionalWebRTCNote, evaluateSendOptions } from "./transport";

const decoder = new TextDecoder();

function asText(data: string | Uint8Array): string {
  return typeof data === "string" ? data : decoder.decode(data);
}

function byteSize(s: string): number {
  return new TextEncoder().encode(s).byteLength;
}

interface SocketData {
  connId: string;
}

// ---------------------------------------------------------------------------
// Server transport (Bun.serve built-in WebSockets)
// ---------------------------------------------------------------------------

export interface BunWebSocketServerTransportOptions {
  port?: number; // 0 => OS-assigned ephemeral port
  host?: string;
}

export class BunWebSocketServerTransport implements ServerTransport {
  public readonly characteristics: TransportCharacteristics = {
    name: "bun-websocket",
    ...WEBSOCKET_CHARACTERISTICS,
    note: describeOptionalWebRTCNote(),
  };

  private bunServer: ReturnType<typeof Bun.serve> | null = null;
  private address: { port: number; url: string } | null = null;
  private nextConnId = 0;
  private readonly options: BunWebSocketServerTransportOptions;
  private readonly sockets = new Map<string, import("bun").ServerWebSocket<SocketData>>();
  private connectionEventHandler: ((event: ServerConnectionEvent) => void) | null = null;
  private messageHandler: ((connectionId: string, data: string) => void) | null = null;

  constructor(options: BunWebSocketServerTransportOptions = {}) {
    this.options = options;
  }

  async listen(): Promise<{ port: number; url: string }> {
    if (this.bunServer) throw new Error("BunWebSocketServerTransport is already listening");

    const hostname = this.options.host ?? "127.0.0.1";
    this.bunServer = Bun.serve<SocketData>({
      port: this.options.port ?? 0,
      hostname,
      fetch: (req, server) => {
        const connId = `client-${++this.nextConnId}`;
        const upgraded = server.upgrade(req, { data: { connId } });
        if (upgraded) return undefined;
        return new Response("WebSocket upgrade required", { status: 426 });
      },
      websocket: {
        idleTimeout: 255,
        maxPayloadLength: 128 * 1024,
        open: (ws) => {
          this.sockets.set(ws.data.connId, ws);
          this.connectionEventHandler?.({ type: "open", connection: this.wrap(ws.data.connId, ws) });
        },
        message: (ws, message) => {
          this.messageHandler?.(ws.data.connId, asText(message as string | Uint8Array));
        },
        close: (ws, code, reason) => {
          this.sockets.delete(ws.data.connId);
          this.connectionEventHandler?.({
            type: "close",
            connection: this.wrap(ws.data.connId, ws),
            code,
            reason,
          });
        },
      },
    });

    const port = this.bunServer.port;
    if (typeof port !== "number") {
      throw new Error("Bun server did not report a port");
    }
    this.address = { port, url: `ws://${hostname}:${port}` };
    return this.address;
  }

  async stop(closeActiveConnections = true): Promise<void> {
    if (!this.bunServer) return;
    const server = this.bunServer;
    this.bunServer = null;
    this.address = null;
    this.sockets.clear();
    server.stop(closeActiveConnections);
    await Promise.resolve();
  }

  getAddress(): { port: number; url: string } | null {
    return this.address;
  }

  onConnectionEvent(handler: (event: ServerConnectionEvent) => void): void {
    this.connectionEventHandler = handler;
  }

  onConnectionMessage(handler: (connectionId: string, data: string) => void): void {
    this.messageHandler = handler;
  }

  private wrap(connId: string, ws: import("bun").ServerWebSocket<SocketData>): ServerConnection {
    const characteristics = this.characteristics;
    return {
      id: connId,
      getBackpressure(): BackpressureInfo {
        const pendingBytes = typeof ws.getBufferedAmount === "function" ? ws.getBufferedAmount() : 0;
        return { pendingBytes, pendingMessages: 0 };
      },
      send(data: string, options?: SendOptions): SendResult {
        const bytes = byteSize(data);
        const rejected = evaluateSendOptions(options, characteristics);
        if (rejected) return { accepted: false, bytes, reason: rejected };
        if (ws.readyState !== WebSocket.OPEN) {
          return { accepted: false, bytes, reason: "not_connected" };
        }
        ws.send(data);
        return { accepted: true, bytes };
      },
      close(code?: number, reason?: string): void {
        ws.close(code ?? 1000, reason ?? "");
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Client transport (standard WebSocket API as provided by Bun)
// ---------------------------------------------------------------------------

export class BunWebSocketClientTransport implements ConnectionTransport {
  public readonly characteristics: TransportCharacteristics = {
    name: "bun-websocket",
    ...WEBSOCKET_CHARACTERISTICS,
    note: describeOptionalWebRTCNote(),
  };

  private ws: WebSocket | null = null;
  private url: string | null = null;
  private state: ConnectionState = "new";
  private stateHandler: ((state: ConnectionState, detail?: string) => void) | null = null;
  private messageHandler: ((data: string) => void) | null = null;
  private pendingBytes = 0;

  constructor(url?: string) {
    this.url = url ?? null;
  }

  async connect(): Promise<void> {
    if (!this.url) throw new Error("BunWebSocketClientTransport requires a url (constructor or targetUrl)");
    if (this.ws) throw new Error("BunWebSocketClientTransport is already connected or connecting");
    const url = this.url;
    this.setState("connecting");
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      let settled = false;
      ws.onopen = () => {
        if (!settled) {
          settled = true;
          this.setState("connected");
          resolve();
        }
      };
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          this.setState("failed", "connection_error");
          reject(new Error(`WebSocket connection to ${url} failed`));
        } else {
          this.setState("failed", "connection_error");
        }
      };
      ws.onclose = (ev) => {
        this.setState("closed", `code=${ev.code}`);
        this.ws = null;
      };
      ws.onmessage = (ev) => {
        const data: unknown = ev.data;
        if (typeof data === "string") {
          this.messageHandler?.(data);
        } else if (data instanceof ArrayBuffer) {
          this.messageHandler?.(decoder.decode(data));
        } else if (data instanceof Uint8Array) {
          this.messageHandler?.(decoder.decode(data));
        }
        // Blob frames are not part of this text protocol and are ignored.
      };
    });
  }

  /** Overrides the URL set at construction (must be called before connect). */
  setTargetUrl(url: string): void {
    if (this.ws) throw new Error("Cannot change target url while connected");
    this.url = url;
  }

  send(data: string, options?: SendOptions): SendResult {
    const ws = this.ws;
    const bytes = byteSize(data);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return { accepted: false, bytes, reason: "not_connected" };
    }
    const rejected = evaluateSendOptions(options, this.characteristics);
    if (rejected) return { accepted: false, bytes, reason: rejected };
    if (bytes > this.characteristics.maxMessageBytes) {
      return { accepted: false, bytes, reason: "message_too_large" };
    }
    ws.send(data);
    this.pendingBytes = typeof ws.bufferedAmount === "number" ? ws.bufferedAmount : 0;
    return { accepted: true, bytes };
  }

  close(code?: number, reason?: string): void {
    this.ws?.close(code ?? 1000, reason ?? "");
    this.ws = null;
    this.setState("closed", "client_close");
  }

  getState(): ConnectionState {
    return this.state;
  }

  getBackpressure(): BackpressureInfo {
    return { pendingBytes: this.pendingBytes, pendingMessages: 0 };
  }

  getTransportRttMs(): number | null {
    // WebSockets do not expose a transport-level RTT; protocol-level ping/RTT
    // is measured by the NetworkClient/AuthoritativeServer diagnostics.
    return null;
  }

  onMessage(handler: (data: string) => void): void {
    this.messageHandler = handler;
  }

  onStateChange(handler: (state: ConnectionState, detail?: string) => void): void {
    this.stateHandler = handler;
    if (this.state !== "new") handler(this.state);
  }

  private setState(state: ConnectionState, detail?: string): void {
    this.state = state;
    this.stateHandler?.(state, detail);
  }
}
