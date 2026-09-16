#!/usr/bin/env bun
/**
 * Blackwater Relay — T23 multiplayer teeth (falsification checks).
 *
 * TEETH-T23-001  Forge client-side authoritative gate/objective state.
 *   A RAW adversarial WebSocket client (no game code involved) attempts client-authored
 *   authoritative state: a non-"cmd." state-authoring kind, a move command targeting an
 *   entity it does not own, and a forged client identity. Expected: every attempt is
 *   rejected server-side BEFORE mutation (forged/rejected counters advance, net.reject
 *   reasons observed) and the server-side authoritative Koota snapshot of all static
 *   entities is byte-identical before and after the attack window.
 *
 * TEETH-T23-002  Inject latency/jitter and command reorder.
 *   The acting client's transport passes through LatencyImpairedTransport (fixed 5ms +
 *   30ms jitter, seeded RNG, zero loss) so the 30-command window arrives reordered.
 *   Expected: the server buffers and applies commands in strict sequence order
 *   (out_of_order counters advance), the authoritative position and the client's
 *   reconciled projection converge to the exact declared value, and diagnostics expose
 *   the impairment (latency_simulation stats, RTT, honest characteristic downgrade).
 *
 * TEETH-T23-003  Disconnect the authoritative transport mid-scenario.
 *   The server side drops the transport while commands are in flight. Expected: explicit
 *   disconnected state on BOTH ends, the authoritative player entity despawned, the
 *   client projection FROZEN at the last authoritative snapshot (no local simulation, no
 *   silent authority takeover), and a bounded reconnect opening a new session that
 *   never trusted client-authored state.
 *
 * Exit code 0 proves all three teeth bite as specified; any failure exits non-zero.
 */

import * as path from "node:path";
import { GameWorld, Transform } from "@gauntlet/runtime";
import {
  AuthoritativeServer,
  InMemoryServerTransport,
  LatencyImpairedTransport,
  NetworkClient,
  type ConnectionTransport,
} from "@gauntlet/runtime";
import { spawnHeadlessServer } from "./observer";

let failures = 0;
function report(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? "OK:  " : "FAIL:"} ${name} (${detail})`);
  if (!ok) failures++;
}

function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

interface StaticState {
  entities: Array<{ id: string; transform?: { position?: number[] } }>;
}

/**
 * Fingerprint of the forge-relevant authoritative entities: the attack targets and all
 * non-simulated entities. The bw-rover (dynamic Rapier body) and bw-service-drone
 * (crowd patrol) are deliberately excluded: they are LEGITIMATELY driven by the
 * authoritative server-side simulation step each tick; their motion is server
 * authority at work, never client-authored mutation.
 */
function staticFingerprint(state: StaticState): string {
  const ids = ["bw-relay-gate", "bw-power-cell", "bw-field-transceiver", "bw-beacon"];
  const parts = state.entities
    .filter((e) => ids.includes(e.id) || e.id.startsWith("player-"))
    .map((e) => `${e.id}:${JSON.stringify(e.transform?.position ?? null)}`)
    .sort();
  return parts.join("|");
}

interface ServerStateResponse {
  authoritative: StaticState;
  server: { counters: Record<string, number>; closed_clients: Array<{ client_id: string; state: string; entity_id: string }>; clients: Array<{ client_id: string; state: string; entity_id: string }> };
  interest: { kind: string; radius: number };
}

async function fetchServerState(obsUrl: string): Promise<ServerStateResponse> {
  const res = await fetch(`${obsUrl}/state`);
  if (!res.ok) throw new Error(`/state failed: ${res.status}`);
  return (await res.json()) as ServerStateResponse;
}

// ---------------------------------------------------------------------------
// TEETH-T23-001: forge client-side authoritative state (raw WebSocket client).
// ---------------------------------------------------------------------------

async function tooth1ForgeAuthority(): Promise<void> {
  console.log("\n=== TEETH-T23-001: forge client-side authoritative gate/objective state ===");
  const projectRoot = path.resolve(import.meta.dir, "..", "..");
  const server = await spawnHeadlessServer(projectRoot, path.join(projectRoot, "src", "server.ts"));

  try {
    await fetchServerState(server.obsUrl);

    const ws = new WebSocket(server.wsUrl);
    const rejects: Array<{ reason?: string; rejected_kind?: string }> = [];
    let welcome = false;
    let open = false;
    ws.onopen = () => {
      open = true;
    };
    ws.onmessage = (ev) => {
      try {
        const envelope = JSON.parse(String(ev.data));
        if (envelope.kind === "net.welcome") welcome = true;
        if (envelope.kind === "net.reject") rejects.push(envelope.payload);
      } catch {
        /* ignore */
      }
    };
    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 10_000;
      const poll = () => {
        if (open && welcome) return resolve();
        if (Date.now() > deadline) return reject(new Error("raw client never welcomed"));
        setTimeout(poll, 25);
      };
      poll();
    });
    await sleep(120); // let the authoritative spawn settle

    const clean = (await fetchServerState(server.obsUrl)).authoritative;
    const fingerprintBefore = staticFingerprint(clean);

    // Attack 1: client-authored authoritative state under a non-"cmd." kind.
    ws.send(JSON.stringify({
      kind: "state.set",
      sequence: 1,
      payload: { entity_id: "bw-relay-gate", position: [14, -3.357, 4] },
    }));
    // Attack 2: move command targeting an entity the client does not own (the gate).
    ws.send(JSON.stringify({
      kind: "cmd.move",
      sequence: 2,
      payload: { entity_id: "bw-relay-gate", direction: [0, 1, 0], speed: 50 },
    }));
    // Attack 3: forged client identity claiming another session.
    ws.send(JSON.stringify({
      kind: "cmd.move",
      sequence: 3,
      client_id: "client-999",
      payload: { entity_id: "player-client-999", direction: [1, 0, 0], speed: 50 },
    }));
    // Attack 4: replication kind from the client side (snapshot spoofing attempt).
    ws.send(JSON.stringify({
      kind: "replication.snapshot",
      sequence: 4,
      payload: { tick: 1, entities: [{ id: "bw-relay-gate", transform: { position: [0, 100, 0] } }], removed_entity_ids: [] },
    }));

    // Pump the server long enough to drain any window; wait for the rejections.
    await sleep(700);
    const after = await fetchServerState(server.obsUrl);
    const fingerprintAfter = staticFingerprint(after.authoritative);

    report(
      "T1 forged state-authoring kind rejected",
      rejects.some((r) => r.reason === "kind_not_permitted" && r.rejected_kind === "state.set"),
      `rejects=${JSON.stringify(rejects.map((r) => `${r.rejected_kind}:${r.reason}`))}`
    );
    report(
      "T1 entity ownership violation rejected",
      rejects.some((r) => r.reason === "entity_not_owned"),
      "cmd.move targeting bw-relay-gate refused (entity_not_owned)"
    );
    report(
      "T1 client identity forgery rejected",
      rejects.some((r) => r.reason === "client_id_forgery"),
      "forged client_id refused before any validation of the claimed state"
    );
    report(
      "T1 client replication spoof rejected",
      rejects.some((r) => r.rejected_kind === "replication.snapshot"),
      "client-side replication.snapshot refused (closed server->client namespace)"
    );
    report(
      "T1 server Koota state byte-identical across the attack window",
      fingerprintBefore === fingerprintAfter,
      "forge-target and non-simulated authoritative entities (gate/cell/transceiver/beacon/players) unchanged; simulated bodies (rover/drone) excluded as legitimate server authority"
    );
    report(
      "T1 counters expose the rejected authority attempts",
      after.server.counters.forged_rejected >= 2 && after.server.counters.commands_rejected >= 3,
      `forged_rejected=${after.server.counters.forged_rejected} commands_rejected=${after.server.counters.commands_rejected}`
    );
    ws.close();
  } finally {
    await server.stop();
  }
}

// ---------------------------------------------------------------------------
// TEETH-T23-002: latency/jitter + command reorder (bounded reconciliation).
// ---------------------------------------------------------------------------

async function tooth2LatencyReorder(): Promise<void> {
  console.log("\n=== TEETH-T23-002: inject latency/jitter and command reorder ===");
  const world = new GameWorld();
  const serverTransport = new InMemoryServerTransport();
  const server = new AuthoritativeServer({
    world,
    transport: serverTransport,
    maxSpeed: 50,
    spawnPoint: [0, 0, 0],
  });
  await server.start();

  const projection = new GameWorld();
  let base: ConnectionTransport = serverTransport.connectClient();
  const impaired = new LatencyImpairedTransport(base, {
    fixedLatencyMs: 5,
    jitterMs: 30,
    packetLossRatio: 0,
    randomFn: seededRandom(20260915),
  });
  const client = new NetworkClient({ transport: impaired, projectionWorld: projection });
  await client.connect();

  const deadline = Date.now() + 5000;
  while (client.getClientId() === null && Date.now() < deadline) {
    server.tickOnce(1 / 60);
    await sleep(5);
  }
  const entityId = client.getEntityId();
  if (!entityId) {
    report("T2 welcome received", false, "no entity id assigned");
    return;
  }

  // Burst 30 commands (+x, speed 50 => +25.0 exactly); heavy jitter reorders arrival.
  for (let i = 0; i < 30; i++) {
    client.sendCommand("cmd.move", { entity_id: entityId, direction: [1, 0, 0], speed: 50 });
  }
  client.sendCommand("cmd.ping", { client_time_ms: performance.now() });

  const deadline2 = Date.now() + 15_000;
  while (Date.now() < deadline2) {
    server.tickOnce(1 / 60);
    const entity = world.getEntity(entityId);
    const pos = entity?.get(Transform)?.position ?? [0, 0, 0];
    const acked = client.getLastAckedSequence();
    if (acked >= 30 && Math.abs(pos[0] - 25) < 1e-6) break;
    await sleep(5);
  }
  // Let the final snapshots reconcile the projection.
  for (let i = 0; i < 10; i++) {
    server.tickOnce(1 / 60);
    await sleep(10);
  }

  const serverDiag = server.getDiagnostics();
  const clientDiag = client.getDiagnostics();
  const authoritative = world.getEntity(entityId)?.get(Transform)?.position ?? [0, 0, 0];
  const projected = projection.getEntity(entityId)?.get(Transform)?.position ?? [0, 0, 0];
  const stats = impaired.getLatencySimulator().getStats();

  report(
    "T2 commands arrived reordered and were buffered",
    serverDiag.counters.out_of_order_buffered > 0,
    `out_of_order_buffered=${serverDiag.counters.out_of_order_buffered} (fixed 5ms + jitter 30ms, seeded)`
  );
  report(
    "T2 strict-sequence drain processed the reordered window",
    serverDiag.counters.out_of_order_processed > 0,
    `out_of_order_processed=${serverDiag.counters.out_of_order_processed}`
  );
  report(
    "T2 authoritative position exactly preserved",
    Math.abs(authoritative[0] - 25) < 1e-6,
    `authoritative x=${authoritative[0]} (declared 25.0)`
  );
  report(
    "T2 client projection reconciled to authoritative truth",
    Math.abs(projected[0] - 25) < 1e-6,
    `projection x=${projected[0]}`
  );
  report(
    "T2 impairment exposed in client diagnostics",
    stats.scheduledCount >= 30 && clientDiag.latency_simulation !== null,
    `latency_simulation=${JSON.stringify(clientDiag.latency_simulation)}`
  );
  report(
    "T2 transport characteristics honestly downgraded",
    impaired.characteristics.reliable === false && impaired.characteristics.ordered === false,
    `characteristics=${impaired.characteristics.name} reliable=${impaired.characteristics.reliable} ordered=${impaired.characteristics.ordered}`
  );
  report(
    "T2 acks advanced through the impaired window",
    clientDiag.last_acked_sequence >= 30,
    `last_acked_sequence=${clientDiag.last_acked_sequence}`
  );

  client.close();
  await server.stop();
}

// ---------------------------------------------------------------------------
// TEETH-T23-003: disconnect the authoritative transport mid-scenario.
// ---------------------------------------------------------------------------

async function tooth3Disconnect(): Promise<void> {
  console.log("\n=== TEETH-T23-003: disconnect the authoritative transport mid-scenario ===");
  const world = new GameWorld();
  const serverTransport = new InMemoryServerTransport();
  const server = new AuthoritativeServer({
    world,
    transport: serverTransport,
    maxSpeed: 50,
    spawnPoint: [0, 0, 0],
  });
  await server.start();

  const projection = new GameWorld();
  const transport = serverTransport.connectClient();
  const client = new NetworkClient({ transport, projectionWorld: projection });
  await client.connect();

  const deadline = Date.now() + 5000;
  while (client.getClientId() === null && Date.now() < deadline) {
    server.tickOnce(1 / 60);
    await sleep(5);
  }
  const entityId = client.getEntityId();
  if (!entityId) {
    report("T3 session established", false, "no entity id assigned");
    return;
  }

  client.sendCommand("cmd.move", { entity_id: entityId, direction: [1, 0, 0], speed: 10 });
  for (let i = 0; i < 5; i++) {
    server.tickOnce(1 / 60);
    await sleep(5);
  }
  const frozenAt = projection.getEntity(entityId)?.get(Transform)?.position ?? [0, 0, 0];

  // Server-side drop of the authoritative transport mid-scenario.
  serverTransport.closeConnection(client.getClientId() as string);
  for (let i = 0; i < 5; i++) {
    server.tickOnce(1 / 60);
    await sleep(5);
  }

  report(
    "T3 explicit client disconnect state",
    client.getState() === "disconnected" || client.getState() === "closed",
    `connection_state=${client.getState()} (explicit, observable)`
  );
  report(
    "T3 authoritative player entity despawned",
    !world.hasEntity(entityId),
    `${entityId} removed from the authoritative Koota world by the explicit close path`
  );
  report(
    "T3 server recorded the closed session",
    server.getDiagnostics().closed_clients.some((c) => c.client_id === client.getClientId() && c.state === "disconnected"),
    "closed_clients records the explicit disconnected session"
  );

  // The frozen projection: pump more ticks; the client projection must not move.
  for (let i = 0; i < 10; i++) {
    server.tickOnce(1 / 60);
    await sleep(5);
  }
  const stillAt = projection.getEntity(entityId)?.get(Transform)?.position ?? null;
  report(
    "T3 client never becomes silent semantic authority",
    stillAt !== null && Math.abs(stillAt[0] - frozenAt[0]) < 1e-9 && Math.abs(stillAt[1] - frozenAt[1]) < 1e-9,
    `projection frozen at [${frozenAt.join(", ")}]; no local simulation started after the drop`
  );

  // Bounded reconnect: a NEW session; no client-authored state was trusted.
  const transport2 = serverTransport.connectClient();
  const client2 = new NetworkClient({ transport: transport2, projectionWorld: projection });
  await client2.connect();
  const deadline2 = Date.now() + 5000;
  while (client2.getClientId() === null && Date.now() < deadline2) {
    server.tickOnce(1 / 60);
    await sleep(5);
  }
  const newEntity = client2.getEntityId();
  report(
    "T3 bounded reconnect opens a fresh authoritative session",
    client2.getClientId() !== client.getClientId() &&
      newEntity !== null &&
      newEntity !== entityId &&
      world.hasEntity(newEntity ?? ""),
    `new session ${String(client2.getClientId())} (${String(newEntity)}; old ${entityId} stays despawned)`
  );

  client.close();
  client2.close();
  await server.stop();
}

// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  console.log("=== Blackwater Relay T23 multiplayer teeth ===");
  await tooth1ForgeAuthority();
  await tooth2LatencyReorder();
  await tooth3Disconnect();
  if (failures > 0) {
    console.error(`\nTEETH FAILED: ${failures} check(s) did not bite as specified.`);
    return 1;
  }
  console.log("\nSUCCESS: all three T23 teeth bite as specified.");
  return 0;
}

process.exitCode = 1;
main()
  .then((code) => {
    process.exit(code);
  })
  .catch((err) => {
    console.error("FATAL:", err);
    process.exit(1);
  });
