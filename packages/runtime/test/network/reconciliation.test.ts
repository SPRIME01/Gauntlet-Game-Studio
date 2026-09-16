import { describe, it, expect, afterEach } from "bun:test";
import { Transform } from "../../src/state/traits";
import { RadiusInterestFilter } from "../../src/network/replication";
import { LatencyImpairedTransport } from "../../src/network/transport";
import {
  connectFixture,
  disposeFixture,
  sleep,
  type ConnectedFixture,
} from "./helpers";

const fixtures: ConnectedFixture[] = [];

afterEach(() => {
  while (fixtures.length) {
    disposeFixture(fixtures.pop()!);
  }
});

/**
 * Deterministic latency rng: delay decisions vary per message so that in-flight
 * reordering genuinely occurs, with zero packet loss.
 */
function reorderRng(): () => number {
  let i = 0;
  const values = [0.05, 0.95, 0.2, 0.9, 0.35, 0.6, 0.5, 0.8, 0.15, 0.99];
  return () => values[i++ % values.length];
}

/**
 * Deterministic loss rng: the first `dropCalls` invocations roll a drop under
 * packetLossRatio 0.5; every later call survives with delay 0.
 */
function lossyRng(dropCalls: number): () => number {
  let i = 0;
  return () => (i++ < dropCalls ? 0.01 : 0.99);
}

describe("Sequencing, acknowledgement, reconciliation under impairment (T12 - REQ-NET-004, REQ-NET-005, REQ-NET-006, REQ-SAFE-006)", () => {
  it("TEETH-T12-002: reordered/delayed commands through the latency simulator keep sequence/ack/reconciliation bounded and diagnostics expose the impairment", async () => {
    const fixture = await connectFixture({
      maxPendingCommands: 64,
      wrapTransport: (t) =>
        new LatencyImpairedTransport(t, {
          fixedLatencyMs: 4,
          jitterMs: 24,
          packetLossRatio: 0,
          randomFn: reorderRng(),
        }),
    });
    fixtures.push(fixture);
    const { world, client, server, projection } = fixture;
    const entityId = client.getEntityId()!;

    const total = 24;
    for (let i = 0; i < total; i++) {
      client.sendCommand("cmd.move", { entity_id: entityId, direction: [1, 0, 0], speed: 6 });
    }

    // While in flight, the client's pending window must remain bounded.
    expect(client.getPendingCount()).toBeLessThanOrEqual(64);

    // Flush the simulated in-flight delay window, then settle authority.
    await sleep(120);
    server.tickOnce();
    server.tickOnce();

    const serverCounters = server.getCounterSnapshot();
    // Impairment is real: commands arrived out of order and were buffered.
    expect(serverCounters.out_of_order_buffered).toBeGreaterThan(0);
    expect(serverCounters.out_of_order_processed).toBeGreaterThan(0);
    // Bounded recovery: every command ultimately applied exactly once, in order.
    expect(serverCounters.commands_processed).toBe(total);
    expect(serverCounters.duplicates_dropped).toBe(0);

    // Acknowledgement window advanced to the final contiguous sequence.
    expect(client.getLastAckedSequence()).toBe(total);
    expect(client.getPendingCount()).toBe(0);

    // Deterministic authority outcome: total displacement equals N * speed * dt
    // regardless of arrival order (proves strict sequence application).
    const pos = world.getEntity(entityId)!.get(Transform)!.position;
    expect(pos[0]).toBeCloseTo(total * 6 * (1 / 60), 5);

    // Client reconciled the authoritative projection.
    expect(projection.hasEntity(entityId)).toBe(true);
    const projected = projection.getEntity(entityId)!.get(Transform)!.position;
    expect(projected[0]).toBeCloseTo(pos[0], 5);

    // DIAGNOSTICS EXPOSE IMPAIRMENT (REQ-NET-006):
    const clientDiag = client.getDiagnostics();
    expect(clientDiag.latency_simulation).not.toBeNull();
    expect(clientDiag.latency_simulation!.scheduledCount).toBe(total);
    expect(clientDiag.latency_simulation!.completedCount).toBe(total);
    expect(clientDiag.latency_simulation!.droppedCount).toBe(0);

    const serverDiag = server.getDiagnostics();
    expect(serverDiag.counters.out_of_order_buffered).toBeGreaterThan(0);
    expect(serverDiag.bandwidth.total).toBeGreaterThan(0);
  });

  it("client pending window is bounded under a silent server (no unbounded memory)", async () => {
    const fixture = await connectFixture({ maxPendingCommands: 32 });
    fixtures.push(fixture);
    const { client } = fixture;
    const entityId = client.getEntityId()!;

    // The server is never ticked, so NOTHING is acked; client must stay bounded.
    for (let i = 0; i < 200; i++) {
      client.sendCommand("cmd.move", { entity_id: entityId, direction: [1, 0, 0] });
    }

    expect(client.getPendingCount()).toBeLessThanOrEqual(32);
    const counters = client.getDiagnostics().counters;
    expect(counters.pending_overflow_dropped).toBe(200 - 32);
  });

  it("packet loss recovers with explicit bounded sequence skips, never a wedged session", async () => {
    const fixture = await connectFixture({
      maxBufferedCommands: 4,
      wrapTransport: (t) =>
        new LatencyImpairedTransport(t, {
          fixedLatencyMs: 0,
          jitterMs: 0,
          packetLossRatio: 0.5,
          randomFn: lossyRng(2),
        }),
    });
    fixtures.push(fixture);
    const { world, client, server } = fixture;
    const entityId = client.getEntityId()!;

    // Sequences 1..2 are deterministically destroyed in flight; 3..6 buffer;
    // 7..12 are explicitly REFUSED at the full buffer (backpressure, never
    // discarding already-received lower sequences).
    for (let i = 0; i < 12; i++) {
      client.sendCommand("cmd.move", { entity_id: entityId, direction: [1, 0, 0], speed: 6 });
    }
    await sleep(20);
    // Tick 1: buffer pressure triggers the explicit skip over the lost gap,
    // then the surviving contiguous run 3..6 drains in order.
    server.tickOnce();
    server.tickOnce();

    let counters = server.getCounterSnapshot();
    expect(counters.sequence_skips).toBe(2);
    expect(counters.buffered_overflow_dropped).toBe(6);
    expect(counters.commands_processed).toBe(4);
    expect(client.getLastAckedSequence()).toBe(6);
    expect(client.getDiagnostics().counters.rejects_received).toBe(6);

    // Session remains fully live: a post-recovery command processes normally
    // once the new gap is explicitly skipped after the bounded tick window.
    client.sendCommand("cmd.move", { entity_id: entityId, direction: [1, 0, 0], speed: 6 }); // sequence 13
    for (let i = 0; i < 5; i++) {
      server.tickOnce();
    }

    counters = server.getCounterSnapshot();
    expect(counters.commands_processed).toBe(5);
    expect(client.getLastAckedSequence()).toBe(13);

    // Authority reflects exactly the surviving commands.
    const pos = world.getEntity(entityId)!.get(Transform)!.position;
    expect(pos[0]).toBeCloseTo(5 * 6 * (1 / 60), 5);
  });

  it("ping/RTT diagnostics measure the command round trip (client-initiated)", async () => {
    const fixture = await connectFixture();
    fixtures.push(fixture);
    const { client, server } = fixture;

    client.sendCommand("cmd.ping", { client_time_ms: performance.now() });
    server.tickOnce();

    const diag = client.getDiagnostics();
    expect(diag.rtt_ms).not.toBeNull();
    expect(diag.rtt_ms!).toBeGreaterThanOrEqual(0);
    expect(diag.counters.pending_overflow_dropped).toBe(0);
  });

  it("interest/relevance filtering: clients receive only nearby entities (REQ-NET-005)", async () => {
    const fixture = await connectFixture({ interestFilter: new RadiusInterestFilter(50) });
    fixtures.push(fixture);
    const { world, serverTransport, server, projection } = fixture;

    // Second player far away, plus a static landmark even farther.
    const farTransport = serverTransport.connectClient();
    await farTransport.connect();
    const farEntity = world.getEntity("player-client-2")!;
    const farTransform = farEntity.get(Transform)!;
    farEntity.set(Transform, {
      position: [500, 0, 0],
      rotation: farTransform.rotation,
      scale: farTransform.scale,
    });
    world.spawnEntity({ id: "landmark-far", transform: { position: [10000, 0, 0] }, tags: ["obstacle"] });
    server.tickOnce();
    server.tickOnce();

    expect(world.getEntity("player-client-1")!.get(Transform)!.position[0]).toBe(0);
    expect(world.getEntity("player-client-2")!.get(Transform)!.position[0]).toBe(500);

    // Client-1's projection contains its own entity but NOT the far player or landmark.
    expect(projection.hasEntity("player-client-1")).toBe(true);
    expect(projection.hasEntity("player-client-2")).toBe(false);
    expect(projection.hasEntity("landmark-far")).toBe(false);

    const counters = server.getCounterSnapshot();
    expect(counters.snapshots_sent).toBeGreaterThanOrEqual(2);

    farTransport.close();
  });

  it("reconciliation applies server truth over local prediction and replays only unacked commands", async () => {
    const fixture = await connectFixture();
    fixtures.push(fixture);
    const { world, client, server, projection } = fixture;
    const entityId = client.getEntityId()!;

    // One acked command (server applied), one unacked (server never ticked after).
    client.sendCommand("cmd.move", { entity_id: entityId, direction: [1, 0, 0], speed: 6 });
    server.tickOnce();
    const serverPos = world.getEntity(entityId)!.get(Transform)!.position[0];
    expect(serverPos).toBeCloseTo(6 * (1 / 60), 5);

    client.sendCommand("cmd.move", { entity_id: entityId, direction: [1, 0, 0], speed: 6 });
    // No tick yet: sequence 2 is unacked prediction.
    expect(client.getPendingCount()).toBe(1);

    // Next server tick processes sequence 2 and publishes; the client reconciles.
    server.tickOnce();
    const finalServerPos = world.getEntity(entityId)!.get(Transform)!.position[0];
    const projectedPos = projection.getEntity(entityId)!.get(Transform)!.position[0];

    expect(client.getLastAckedSequence()).toBe(2);
    expect(client.getPendingCount()).toBe(0);
    expect(projectedPos).toBeCloseTo(finalServerPos, 5);
    expect(client.getDiagnostics().counters.reconciliations).toBeGreaterThanOrEqual(1);
  });
});
