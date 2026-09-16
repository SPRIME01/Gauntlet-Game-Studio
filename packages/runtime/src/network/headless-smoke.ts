#!/usr/bin/env bun
/**
 * Network headless smoke verification (DOM-free).
 * Proves: Bun native WebSocket server + client complete a validated sequenced
 * command round-trip with authoritative Koota mutation, interest-filtered
 * replication, client reconciliation, ping/RTT, and bandwidth diagnostics.
 * Exit code 0 proves the loop; any failure exits non-zero.
 * Implements REQ-BIND-013, REQ-NET-001..006.
 */

import { GameWorld } from "../state/world";
import { Transform } from "../state/traits";
import { GauntletKernel } from "../kernel";
import {
  AuthoritativeServer,
  NetworkClient,
  BunWebSocketServerTransport,
  BunWebSocketClientTransport,
  RadiusInterestFilter,
  bootNetworkSubsystem,
} from "./index";

async function main(): Promise<number> {
  console.log("=== Gauntlet Runtime Network Headless Smoke Verification ===");

  // Single authoritative Koota world (sole semantic authority).
  const world = new GameWorld();
  world.spawnEntity({
    id: "landmark-1",
    transform: { position: [1000, 0, 1000] },
    tags: ["obstacle"],
  });

  const kernel = new GauntletKernel({ mode: "headless" });

  // Authoritative server with an authoritative Koota-side simulation hook.
  const serverTransport = new BunWebSocketServerTransport({ port: 0 });
  const server = new AuthoritativeServer({
    world,
    transport: serverTransport,
    interestFilter: new RadiusInterestFilter(50),
    clientTimeoutMs: 5000,
    simulationHook: (w, tickInfo) => {
      // Example authoritative hook: no-op marker step (never a second scheduler).
      void w;
      void tickInfo;
    },
  });

  // Optional network subsystem, registered on the readiness barrier.
  await bootNetworkSubsystem(kernel.barrier, server, true);
  if (!kernel.barrier.isReady()) {
    console.error("FAIL: network subsystem failed readiness barrier.");
    return 1;
  }
  const address = serverTransport.getAddress();
  if (!address) {
    console.error("FAIL: server transport did not report an address.");
    return 1;
  }
  console.log(`OK: authoritative server listening on ${address.url} (transport: ${server.getTransportName()})`);

  // Client connects over the real Bun WebSocket transport.
  const projection = new GameWorld(); // client-side projection world (NOT authority)
  const clientTransport = new BunWebSocketClientTransport(address.url);
  const client = new NetworkClient({ transport: clientTransport, projectionWorld: projection });
  await client.connect();
  console.log("OK: client connected over Bun native WebSocket transport.");

  // Wait for welcome (server assigns client/player ids).
  const deadline = Date.now() + 3000;
  while (client.getClientId() === null && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10));
    server.tickOnce();
  }
  if (!client.getClientId() || !client.getEntityId()) {
    console.error("FAIL: client never received net.welcome.");
    return 1;
  }
  console.log(`OK: welcome received (client_id=${client.getClientId()}, entity_id=${client.getEntityId()})`);

  // Send validated sequenced movement commands.
  client.sendCommand("cmd.move", { entity_id: client.getEntityId(), direction: [1, 0, 0], speed: 10 });
  client.sendCommand("cmd.ping", { client_time_ms: performance.now() });

  // Drive authoritative ticks; snapshots + acks flow back; client reconciles.
  for (let i = 0; i < 30; i++) {
    server.tickOnce(1 / 60);
    await new Promise((r) => setTimeout(r, 5));
  }

  const serverDiag = server.getDiagnostics();
  const clientDiag = client.getDiagnostics();

  const entity = world.getEntity("player-" + client.getClientId());
  const pos = entity?.get(Transform)?.position ?? [0, 0, 0];

  const checks: Array<[string, boolean, string]> = [
    ["commands processed >= 2", serverDiag.counters.commands_processed >= 2, `processed=${serverDiag.counters.commands_processed}`],
    ["zero forged rejections", serverDiag.counters.forged_rejected === 0, `forged=${serverDiag.counters.forged_rejected}`],
    ["server mutated Koota position", pos[0] > 0, `player.x=${pos[0].toFixed(4)}`],
    ["acks advanced", clientDiag.last_acked_sequence >= 2, `acked=${clientDiag.last_acked_sequence}`],
    ["client received snapshots", clientDiag.counters.snapshots_received > 0, `snapshots=${clientDiag.counters.snapshots_received}`],
    ["client reconciled projection", projection.hasEntity("player-" + client.getClientId()), `projection entities=${projection.getEntityIds().length}`],
    ["landmark filtered by interest", !projection.hasEntity("landmark-1"), "far landmark excluded"],
    ["RTT measured", clientDiag.rtt_ms !== null, `rtt=${clientDiag.rtt_ms?.toFixed(2) ?? "null"}ms`],
    ["bandwidth observed", serverDiag.bandwidth.total > 0, `bytes=${serverDiag.bandwidth.total}`],
    ["connection state connected", clientDiag.connection_state === "connected", `state=${clientDiag.connection_state}`],
  ];

  let failed = false;
  for (const [name, ok, detail] of checks) {
    console.log(`${ok ? "OK:  " : "FAIL:"} ${name} (${detail})`);
    if (!ok) failed = true;
  }

  client.close();
  await server.stop();
  server.dispose();
  kernel.dispose();

  if (failed) {
    console.error("SUCCESS CRITERIA NOT MET.");
    return 1;
  }
  console.log("SUCCESS: Network headless smoke verification passed.");
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
