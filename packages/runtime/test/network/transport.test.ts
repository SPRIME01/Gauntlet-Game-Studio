import { describe, it, expect, afterEach } from "bun:test";
import {
  InMemoryServerTransport,
  LatencyImpairedTransport,
  describeOptionalWebRTCNote,
} from "../../src/network/transport";
import { BunWebSocketClientTransport, BunWebSocketServerTransport } from "../../src/network/bun-websocket";
import type { TransportCharacteristics } from "../../src/network/types";
import { sleep } from "./helpers";

const activeTransports: Array<{ stop: () => Promise<void> }> = [];

afterEach(async () => {
  for (const t of activeTransports.splice(0)) {
    await t.stop();
  }
});

function assertWebsocketBaselineCharacteristics(c: TransportCharacteristics): void {
  expect(c.reliable).toBe(true);
  expect(c.ordered).toBe(true);
  expect(c.supportsUnreliable).toBe(false);
  expect(c.supportsUnordered).toBe(false);
  expect(c.maxMessageBytes).toBeGreaterThan(0);
  expect(c.note).toContain("WebRTC");
  expect(c.note).toContain("NOT a baseline");
}

describe("Transport abstraction & material characteristics (T12 - REQ-BIND-013, REQ-NET-002, REQ-NET-009)", () => {
  it("exposes explicit material characteristics for the WebSocket-class baseline", () => {
    const serverTransport = new InMemoryServerTransport();
    assertWebsocketBaselineCharacteristics(serverTransport.characteristics);
    assertWebsocketBaselineCharacteristics(new BunWebSocketServerTransport().characteristics);
    assertWebsocketBaselineCharacteristics(new BunWebSocketClientTransport().characteristics);
    expect(describeOptionalWebRTCNote()).toContain("optional advanced transport");
  });

  it("REJECTS delivery options the transport does not support (no silent semantic downgrade)", async () => {
    const serverTransport = new InMemoryServerTransport();
    await serverTransport.listen();
    const client = serverTransport.connectClient();
    await client.connect();

    // Reliable + ordered (supported) works.
    expect(client.send("hello", { reliable: true, ordered: true }).accepted).toBe(true);
    // Unreliable/unordered are WebRTC-class capabilities, NOT WebSocket-class.
    expect(client.send("hello", { reliable: false }).accepted).toBe(false);
    expect(client.send("hello", { reliable: false }).reason).toBe("unreliable_not_supported");
    expect(client.send("hello", { ordered: false }).accepted).toBe(false);
    expect(client.send("hello", { ordered: false }).reason).toBe("unordered_not_supported");

    client.close();
    await serverTransport.stop();
  });

  it("surfaces explicit connection states including disconnect (in-memory)", async () => {
    const serverTransport = new InMemoryServerTransport();
    await serverTransport.listen();
    const client = serverTransport.connectClient();

    expect(client.getState()).toBe("connecting");
    await client.connect();
    expect(client.getState()).toBe("connected");

    // Server-side close is an explicit observable state on the client.
    const id = "client-1";
    serverTransport.closeConnection(id);
    expect(client.getState()).toBe("disconnected");

    await serverTransport.stop();
  });

  it("LatencyImpairedTransport reports honest characteristics and observable impairment", async () => {
    const serverTransport = new InMemoryServerTransport();
    await serverTransport.listen();
    const inner = serverTransport.connectClient();
    await inner.connect();

    const impaired = new LatencyImpairedTransport(inner, {
      fixedLatencyMs: 5,
      jitterMs: 10,
      packetLossRatio: 1.0, // drop everything, deterministically
    });

    expect(impaired.characteristics.name).toContain("latency-sim");
    expect(impaired.characteristics.reliable).toBe(false);
    expect(impaired.characteristics.ordered).toBe(false);

    const result = impaired.send("payload");
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe("simulated_packet_loss");

    const stats = impaired.getLatencySimulator().getStats();
    expect(stats.droppedCount).toBe(1);
    expect(stats.dropRateObserved).toBe(1);

    impaired.close();
    await serverTransport.stop();
  });

  it("Bun native WebSocket transport carries a real loopback message with zero new dependencies", async () => {
    const serverTransport = new BunWebSocketServerTransport({ port: 0 });
    activeTransports.push(serverTransport);

    const received: string[] = [];
    const closed: string[] = [];
    serverTransport.onConnectionMessage((_id, data) => {
      received.push(data);
    });
    serverTransport.onConnectionEvent((event) => {
      if (event.type === "close") closed.push(event.connection.id);
      if (event.type === "open") {
        event.connection.send("welcome-from-server");
      }
    });

    const address = await serverTransport.listen();
    expect(address.port).toBeGreaterThan(0);
    expect(address.url.startsWith("ws://127.0.0.1:")).toBe(true);

    const client = new BunWebSocketClientTransport(address.url);
    const clientReceived: string[] = [];
    client.onMessage((data) => clientReceived.push(data));
    await client.connect();
    expect(client.getState()).toBe("connected");

    client.send("hello-from-client");
    await sleep(50);
    expect(received).toEqual(["hello-from-client"]);
    expect(clientReceived).toEqual(["welcome-from-server"]);

    // Backpressure surface exists and is numeric.
    expect(typeof client.getBackpressure().pendingBytes).toBe("number");
    // WebSockets expose no transport-level RTT; protocol-level ping covers it.
    expect(client.getTransportRttMs()).toBeNull();

    client.close();
    await sleep(50);
    expect(closed.length).toBe(1);
    expect(client.getState()).toBe("closed");
  }, 15000);
});
