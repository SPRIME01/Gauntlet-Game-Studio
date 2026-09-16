/**
 * Shared deterministic helpers for network module tests.
 */
import type { ConnectionTransport } from "../../src/network/types";
import { AuthoritativeServer } from "../../src/network/server";
import { NetworkClient } from "../../src/network/client";
import { InMemoryServerTransport } from "../../src/network/transport";
import { GameWorld } from "../../src/state/world";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Deterministic RNG returning values from a fixed cycle. Cycle values are
 * consumed in order, then the cycle repeats. Useful to force exact drop and
 * delay decisions in LatencySimulator.
 */
export function cycleRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

export interface ConnectedFixture {
  world: GameWorld;
  serverTransport: InMemoryServerTransport;
  server: AuthoritativeServer;
  clientTransport: ConnectionTransport;
  client: NetworkClient;
  projection: GameWorld;
}

// Koota caps worlds per process (max 16), so fixture worlds are pooled and
// fully despawned between tests instead of freshly allocated every time.
const worldPool: GameWorld[] = [];

function acquireWorld(): GameWorld {
  const pooled = worldPool.pop();
  if (pooled) {
    for (const id of pooled.getEntityIds()) {
      pooled.despawnEntity(id);
    }
    return pooled;
  }
  return new GameWorld();
}

function releaseWorld(world: GameWorld): void {
  for (const id of world.getEntityIds()) {
    world.despawnEntity(id);
  }
  worldPool.push(world);
}

/** Test-world reuse under Koota's per-process world cap. */
export const pooledWorld = { acquire: acquireWorld, release: releaseWorld };

export interface FixtureOptions {
  clientTimeoutMs?: number;
  interestFilter?: ConstructorParameters<typeof AuthoritativeServer>[0]["interestFilter"];
  maxBufferedCommands?: number;
  maxSequenceWindow?: number;
  maxPendingCommands?: number;
  snapshotEveryNTicks?: number;
  /** Decorates the raw client transport BEFORE the client binds to it. */
  wrapTransport?: (transport: ConnectionTransport) => ConnectionTransport;
}

/**
 * Builds a fully connected authoritative server + client over the deterministic
 * in-memory transport. Caller MUST dispose in finally: fixture.server.dispose().
 */
export async function connectFixture(options: FixtureOptions = {}): Promise<ConnectedFixture> {
  const world = acquireWorld();
  const serverTransport = new InMemoryServerTransport();
  await serverTransport.listen();

  const server = new AuthoritativeServer({
    world,
    transport: serverTransport,
    clientTimeoutMs: options.clientTimeoutMs ?? 0,
    interestFilter: options.interestFilter,
    maxBufferedCommands: options.maxBufferedCommands,
    maxSequenceWindow: options.maxSequenceWindow,
    snapshotEveryNTicks: options.snapshotEveryNTicks,
  });
  await server.start();

  const projection = acquireWorld();
  const rawTransport = serverTransport.connectClient();
  const clientTransport = options.wrapTransport ? options.wrapTransport(rawTransport) : rawTransport;
  const client = new NetworkClient({
    transport: clientTransport,
    projectionWorld: projection,
    maxPendingCommands: options.maxPendingCommands,
  });
  await client.connect();

  return { world, serverTransport, server, clientTransport, client, projection };
}

export function disposeFixture(fixture: ConnectedFixture): void {
  fixture.client.close();
  fixture.server.dispose();
  releaseWorld(fixture.world);
  releaseWorld(fixture.projection);
}
