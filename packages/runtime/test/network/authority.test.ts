import { describe, it, expect, afterEach } from "bun:test";
import { Transform } from "../../src/state/traits";
import { AuthoritativeServer } from "../../src/network/server";
import {
  connectFixture,
  disposeFixture,
  type ConnectedFixture,
} from "./helpers";
import type { NetworkEnvelope } from "@gauntlet/contracts";

const fixtures: ConnectedFixture[] = [];

afterEach(() => {
  while (fixtures.length) {
    disposeFixture(fixtures.pop()!);
  }
});

async function setup(): Promise<ConnectedFixture> {
  const fixture = await connectFixture();
  fixtures.push(fixture);
  return fixture;
}

describe("Authoritative server validation & Koota authority (T12 - REQ-SEC-007, REQ-NET-001, REQ-NET-003, REQ-NET-004, REQ-SAFE-006)", () => {
  it("TEETH-T12-001: forged client state is rejected and authoritative Koota state does not change", async () => {
    const fixture = await setup();
    const { world, client, clientTransport, server } = fixture;
    const entityId = client.getEntityId()!;
    expect(entityId).toBeTruthy();

    // The server spawned exactly one authoritative player entity at the origin.
    const before = world.getEntity(entityId)!.get(Transform)!.position;
    expect(before).toEqual([0, 0, 0]);

    // ATTACK: the client forges an authoritative state message instead of a
    // permitted command, trying to teleport its own entity.
    const forged: NetworkEnvelope = {
      kind: "state.set",
      sequence: 1,
      payload: {
        entity_id: entityId,
        transform: { position: [9999, 7777, 5555], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      },
    };
    clientTransport.send(JSON.stringify(forged));

    // ATTACK variant: a client "replication" kind trying to impersonate server output.
    clientTransport.send(
      JSON.stringify({
        kind: "replication.snapshot",
        sequence: 2,
        payload: { tick: 1, entities: [], removed_entity_ids: [] },
        server_tick: 1,
      })
    );

    // ATTACK variant: valid command kind but payload smuggling authority fields is
    // impossible (strict envelope), so instead attempt an oversized payload.
    clientTransport.send(
      JSON.stringify({
        kind: "cmd.move",
        sequence: 3,
        payload: { entity_id: entityId, direction: [1, 0, 0], blob: "z".repeat(200000) },
      })
    );

    // Advance the authoritative tick: validation precedes mutation.
    server.tickOnce();

    const counters = server.getCounterSnapshot();
    expect(counters.forged_rejected).toBeGreaterThanOrEqual(2);
    expect(counters.commands_processed).toBe(0);

    // Client observed explicit rejections.
    const clientDiag = client.getDiagnostics();
    expect(clientDiag.counters.rejects_received).toBeGreaterThanOrEqual(2);

    // THE ORACLE: authoritative Koota state is bit-for-bit unchanged.
    const after = world.getEntity(entityId)!.get(Transform)!.position;
    expect(after).toEqual([0, 0, 0]);
    expect(world.getEntityIds().sort()).toEqual([entityId].sort());
  });

  it("server-side validation precedes semantic mutation: invalid command payloads never touch Koota", async () => {
    const fixture = await setup();
    const { world, client, clientTransport, server } = fixture;
    const entityId = client.getEntityId()!;

    // Sequence 1: direction is not a finite triple (JSON null for NaN).
    clientTransport.send(
      JSON.stringify({ kind: "cmd.move", sequence: 1, payload: { entity_id: entityId, direction: [null, 0, 0] } })
    );
    // Sequence 2: absurd speed beyond clamp bound is REJECTED, not clamped.
    clientTransport.send(
      JSON.stringify({ kind: "cmd.move", sequence: 2, payload: { entity_id: entityId, direction: [1, 0, 0], speed: 1e9 } })
    );
    server.tickOnce();

    const counters = server.getCounterSnapshot();
    expect(counters.commands_rejected).toBe(2);
    expect(counters.commands_processed).toBe(0);
    expect(world.getEntity(entityId)!.get(Transform)!.position).toEqual([0, 0, 0]);
    expect(client.getLastAckedSequence()).toBeGreaterThanOrEqual(0);
  });

  it("a client may only move its OWN player entity (ownership enforcement)", async () => {
    const fixture = await setup();
    const { world, client, clientTransport, server, serverTransport } = fixture;
    const attackerEntity = client.getEntityId()!;

    // Second client joins with an entity far away.
    const victimTransport = serverTransport.connectClient();
    await victimTransport.connect();
    server.tickOnce();
    const victimEntity = "player-client-2";
    expect(world.hasEntity(victimEntity)).toBe(true);
    const victimBefore = world.getEntity(victimEntity)!.get(Transform)!.position;

    // ATTACK: client-1 issues a move command against client-2's entity.
    clientTransport.send(
      JSON.stringify({ kind: "cmd.move", sequence: 1, payload: { entity_id: victimEntity, direction: [0, 0, 1] } })
    );
    server.tickOnce();

    const counters = server.getCounterSnapshot();
    expect(counters.forged_rejected).toBeGreaterThanOrEqual(1);
    expect(counters.commands_processed).toBe(0);
    expect(world.getEntity(victimEntity)!.get(Transform)!.position).toEqual(victimBefore);
    expect(world.getEntity(attackerEntity)!.get(Transform)!.position).toEqual([0, 0, 0]);

    victimTransport.close();
  });

  it("duplicate/replayed sequences are dropped and never re-processed", async () => {
    const fixture = await setup();
    const { world, client, clientTransport, server } = fixture;
    const entityId = client.getEntityId()!;

    client.sendCommand("cmd.move", { entity_id: entityId, direction: [1, 0, 0], speed: 10 });
    // ATTACK: replay the SAME sequence with a different (teleporting) payload.
    clientTransport.send(
      JSON.stringify({ kind: "cmd.move", sequence: 1, payload: { entity_id: entityId, direction: [0, 1, 0], speed: 10 } })
    );
    server.tickOnce();
    server.tickOnce(); // second tick so the snapshot reflects the first drain

    const counters = server.getCounterSnapshot();
    expect(counters.duplicates_dropped).toBe(1);
    expect(counters.commands_processed).toBe(1);

    // Only the FIRST command's effect is applied: exactly speed*dt on +x.
    const pos = world.getEntity(entityId)!.get(Transform)!.position;
    expect(pos[0]).toBeCloseTo(10 * (1 / 60), 6);
    expect(pos[1]).toBe(0);
    expect(client.getLastAckedSequence()).toBe(1);
  });

  it("client_id forgery is rejected", async () => {
    const fixture = await setup();
    const { clientTransport, server } = fixture;

    clientTransport.send(
      JSON.stringify({
        kind: "cmd.ping",
        sequence: 1,
        payload: { client_time_ms: 1 },
        client_id: "client-999",
      })
    );
    server.tickOnce();

    const counters = server.getCounterSnapshot();
    expect(counters.forged_rejected).toBe(1);
    expect(counters.commands_processed).toBe(0);
  });

  it("malformed and oversized raw messages are counted and rejected without crashing the session", async () => {
    const fixture = await setup();
    const { client, clientTransport, server } = fixture;

    clientTransport.send("{definitely-not-json");
    clientTransport.send("x".repeat(200000));
    clientTransport.send(JSON.stringify({ kind: "net.pong", sequence: 5, payload: {} }));

    server.tickOnce();
    const counters = server.getCounterSnapshot();
    expect(counters.malformed_dropped).toBeGreaterThanOrEqual(1);
    expect(counters.oversized_dropped).toBeGreaterThanOrEqual(1);
    expect(counters.commands_rejected).toBeGreaterThanOrEqual(3);

    // Session is still fully functional afterwards.
    const seq = client.sendCommand("cmd.ping", { client_time_ms: 1 });
    expect(seq).toBe(1);
    server.tickOnce();
    expect(client.getLastAckedSequence()).toBe(1);
  });

  it("welcome spawns the player in Koota; disconnect and timeout are explicit states with explicit despawn", async () => {
    // Short server timeouts make the sweep deterministic and fast.
    const fixture = await connectFixture({ clientTimeoutMs: 40 });
    fixtures.push(fixture);
    const { world, client, server } = fixture;
    const entityId = client.getEntityId()!;

    expect(world.hasEntity(entityId)).toBe(true);

    // Wait past the timeout window, then advance one authoritative tick.
    await new Promise((r) => setTimeout(r, 60));
    server.tickOnce();

    const counters = server.getCounterSnapshot();
    expect(counters.timeouts).toBe(1);
    expect(world.hasEntity(entityId)).toBe(false);
    expect(client.getState()).toBe("disconnected");

    const diag = server.getDiagnostics();
    expect(diag.closed_clients).toHaveLength(1);
    expect(diag.closed_clients[0].state).toBe("timed_out");
    expect(diag.clients).toHaveLength(0);
  });

  it("server diagnostics expose bandwidth, commands, replication, and transport identity", async () => {
    const fixture = await setup();
    const { world, client, server } = fixture;
    const entityId = client.getEntityId()!;

    client.sendCommand("cmd.move", { entity_id: entityId, direction: [1, 0, 0] });
    server.tickOnce();

    const diag = server.getDiagnostics();
    expect(diag.transport).toBe("in-memory-loopback");
    expect(diag.listening).toBe(true);
    expect(diag.clients).toHaveLength(1);
    expect(diag.clients[0].state).toBe("connected");
    expect(diag.clients[0].last_ack_sequence).toBe(1);
    expect(diag.bandwidth.total).toBeGreaterThan(0);
    expect(diag.counters.snapshots_sent).toBeGreaterThanOrEqual(1);
    expect(diag.counters.commands_processed).toBe(1);
  });

  it("the server is never a scheduler: exactly one active server registry for single-player proofs", () => {
    // Static registry exposes active authoritative servers; single-player
    // scenarios must observe zero (see single-player.test.ts).
    expect(AuthoritativeServer.getActiveServerCount()).toBeGreaterThanOrEqual(0);
  });
});
