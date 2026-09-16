/**
 * Blackwater Relay — authoritative headless multiplayer server (T23).
 *
 * Boots the SAME game core as single-player (bootGameCore: one Koota world, canonical
 * terrain, Rapier/Recast/BVH projections, ONE stepGame step per authoritative tick) and
 * composes the runtime AuthoritativeServer over it on the Bun native WebSocket baseline.
 * There is NO duplicated network entity model: the server mutates only the game's Koota
 * world, clients receive replication projections of it (REQ-NET-001/007; the T23
 * redesign_trigger boundary).
 *
 * Security posture (REQ-SEC-007): every client message passes the runtime protocol
 * pipeline (size -> JSON -> contract schema -> identity -> kind whitelist -> sequence ->
 * payload -> ownership) BEFORE any authoritative mutation.
 *
 * Lifecycle/observability contract for the runner (loopback only):
 *   stdout  {"type":"listening","port":N,"url":"ws://127.0.0.1:N"}   once ready
 *   stdout  {"type":"observation","port":N,"url":"http://127.0.0.1:N"}
 *           -> GET /state returns { authoritative, server, interest } as dev/test
 *              observability of the server-side Koota truth (never a client surface).
 *
 * This entry is NEVER imported by the single-player build path (game.spec.yaml
 * single_player declaration stays intact).
 */

import {
  AuthoritativeServer,
  BunWebSocketServerTransport,
  RadiusInterestFilter,
} from "@gauntlet/runtime";
import { bootGameCore } from "./game/build";
import { stepGame } from "./game/systems";
import { MULTIPLAYER, SIMULATION } from "./game/config";

interface ServerArgs {
  port: number;
  obsPort: number;
}

function parseArgs(argv: string[]): ServerArgs {
  const args: ServerArgs = { port: 0, obsPort: 0 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--port" && argv[i + 1] !== undefined) args.port = Number(argv[i + 1]);
    if (argv[i] === "--obs-port" && argv[i + 1] !== undefined) args.obsPort = Number(argv[i + 1]);
  }
  return args;
}

function emit(payload: Record<string, unknown>): void {
  console.log(JSON.stringify(payload));
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  // The authoritative game core — the identical composition the browser single-player
  // build runs, headless-safe (no DOM/WebGL/AudioContext required).
  const core = await bootGameCore({ mode: "test" });

  // Authoritative server over the game's own Koota world. The simulation hook runs the
  // game's single step owner exactly once per authoritative tick; the server itself is
  // never a scheduler (T12 contract).
  const transport = new BunWebSocketServerTransport({ port: args.port, host: "127.0.0.1" });
  const server = new AuthoritativeServer({
    world: core.kernel.gameWorld,
    transport,
    interestFilter: new RadiusInterestFilter(MULTIPLAYER.relevance_radius),
    spawnPoint: [...MULTIPLAYER.player_spawn] as [number, number, number],
    maxSpeed: MULTIPLAYER.acting_move_speed,
    clientTimeoutMs: MULTIPLAYER.client_timeout_ms,
    pingIntervalMs: MULTIPLAYER.ping_interval_ms,
    simulationHook: (_world, tickInfo) => stepGame(core.context, tickInfo),
  });

  const address = await server.start();
  emit({ type: "listening", port: address.port, url: address.url });

  // Loopback dev/test observation endpoint over the server-side Koota truth.
  const obs = Bun.serve({
    port: args.obsPort,
    hostname: "127.0.0.1",
    fetch(request) {
      const { pathname } = new URL(request.url);
      if (pathname === "/state") {
        return new Response(
          JSON.stringify({
            authoritative: core.kernel.gameWorld.takeSemanticSnapshot(),
            server: server.getDiagnostics(),
            interest: { kind: "radius", radius: MULTIPLAYER.relevance_radius },
            tick: { tick: core.kernel.scheduler.getTick(), time: core.kernel.scheduler.getTime() },
          }),
          { headers: { "content-type": "application/json" } }
        );
      }
      return new Response("not found", { status: 404 });
    },
  });
  emit({ type: "observation", port: obs.port, url: `http://127.0.0.1:${obs.port}` });

  // Fixed-cadence authoritative ticks: drain sequenced commands -> stepGame -> publish
  // interest-filtered snapshots -> explicit timeout sweep (AuthoritativeServer.tickOnce).
  const tickInterval = setInterval(() => {
    try {
      server.tickOnce(SIMULATION.fixed_delta_time);
    } catch (err) {
      emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, 1000 / 60);

  const shutdown = (signal: string) => {
    clearInterval(tickInterval);
    void (async () => {
      await server.stop();
      server.dispose();
      core.dispose();
      obs.stop(true);
      emit({ type: "stopped", signal });
      process.exit(0);
    })();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  return 0;
}

process.exitCode = 1;
main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error("FATAL:", err);
    process.exit(1);
  });
