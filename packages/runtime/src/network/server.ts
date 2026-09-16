/**
 * AuthoritativeServer: headless server-authoritative multiplayer over any
 * ServerTransport. Koota (GameWorld) remains the SOLE semantic authority;
 * network envelopes and replication projections are never authoritative state.
 *
 * Security posture (REQ-SEC-007, REQ-NET-003, REQ-SAFE-006):
 * - Client messages are untrusted input. Size, JSON, schema, client identity,
 *   kind whitelist, payload shape, ownership, and sequence validation ALL run
 *   server-side BEFORE any semantic mutation.
 * - Permitted client commands form a closed whitelist ("cmd.*"); any envelope
 *   that attempts to author authoritative state (e.g. a client "state.*" or
 *   "replication.*" kind) is rejected and counted, and Koota is untouched.
 * - Disconnect/timeout are explicit observable states; their handling performs
 *   only explicit, recorded transitions (player entity despawn), never silent
 *   mutation.
 *
 * Sequencing (REQ-NET-004): commands are buffered per client and applied in
 * strict sequence order on authoritative ticks; the last contiguously
 * processed sequence is acknowledged to the client on every snapshot.
 * All buffers are bounded.
 *
 * Implements REQ-BIND-013, REQ-NET-001..006, REQ-NET-009.
 */

import type { NetworkEnvelope } from "@gauntlet/contracts";
import { BandwidthTracker } from "../diagnostics/bandwidth";
import { Transform, EntityId } from "../state/traits";
import type { GameWorld } from "../state/world";
import type { SubsystemBarrier } from "../readiness";
import type { SimulationTick } from "../types";
import {
  asMovePayload,
  asPingPayload,
  controlEnvelope,
  decodeEnvelope,
  disconnectEnvelope,
  encodeEnvelope,
  rejectEnvelope,
  serverPingEnvelope,
  snapshotEnvelope,
  welcomeEnvelope,
  WIRE_LIMITS,
  validateCommandPayload,
  CONTROL_SEQUENCE,
} from "./protocol";
import {
  cloneCounters,
  createNetworkCounters,
  type NetworkCounters,
  type NetworkServerDiagnostics,
} from "./diagnostics";
import { AllInterestFilter, projectEntities, type InterestFilter } from "./replication";
import type {
  ServerTransport,
  ServerConnection,
  ServerConnectionEvent,
  ConnectionState,
} from "./types";

export interface AuthoritativeServerOptions {
  /** Authoritative Koota world. Sole semantic authority. */
  world: GameWorld;
  transport: ServerTransport;
  interestFilter?: InterestFilter;
  /** Clients silent longer than this are timed out (explicit state). 0 disables. Default 5000. */
  clientTimeoutMs?: number;
  /** Per-client out-of-order buffer bound. Default 256. */
  maxBufferedCommands?: number;
  /** Reject sequences further than this beyond the acked sequence. Default 1024. */
  maxSequenceWindow?: number;
  /** Publish replication snapshots every N authoritative ticks. Default 1. */
  snapshotEveryNTicks?: number;
  /** Automatic server->client ping interval in ms. 0 disables (manual pingClients). Default 0. */
  pingIntervalMs?: number;
  /**
   * Authoritative Koota-side simulation hook, executed once per tick after
   * buffered command application. This is where physics/AI step handlers bind;
   * the server never becomes a second scheduler.
   */
  simulationHook?: (world: GameWorld, tick: SimulationTick) => void;
  /** Bounded recovery: ticks a session may sit on a sequence gap before the gap is explicitly skipped. Default 5. */
  gapSkipAfterTicks?: number;
  /** Command speed clamp for cmd.move. Default 50. */
  maxSpeed?: number;
  spawnPoint?: [number, number, number];
}

interface ServerSession {
  clientId: string;
  entityId: string;
  state: Extract<ConnectionState, "connected" | "disconnected" | "timed_out">;
  lastContiguousSequence: number;
  buffered: Map<number, NetworkEnvelope>;
  /** Sequences that arrived out of order and were buffered before processing. */
  outOfOrderSeqs: Set<number>;
  /** Consecutive drain attempts (ticks) where the head sequence was missing. */
  stuckTicks: number;
  lastActivityMs: number;
  awaitingPingServerMs: number | null;
  lastRttMs: number | null;
  lastSeenEntityIds: Set<string>;
}

interface ClosedClientRecord {
  clientId: string;
  entityId: string;
  state: "disconnected" | "timed_out";
  lastAckSequence: number;
  closedAtMs: number;
}

const MAX_CLOSED_RECORDS = 64;

/**
 * The authoritative multiplayer server. One per GameWorld; never a scheduler.
 */
export class AuthoritativeServer {
  private static activeServers = 0;

  private readonly world: GameWorld;
  private readonly transport: ServerTransport;
  private readonly interestFilter: InterestFilter;
  private readonly clientTimeoutMs: number;
  private readonly maxBufferedCommands: number;
  private readonly maxSequenceWindow: number;
  private readonly gapSkipAfterTicks: number;
  private readonly snapshotEveryNTicks: number;
  private readonly pingIntervalMs: number;
  private readonly simulationHook: ((world: GameWorld, tick: SimulationTick) => void) | null;
  private readonly maxSpeed: number;
  private readonly spawnPoint: [number, number, number];

  private readonly sessions = new Map<string, ServerSession>();
  private readonly connections = new Map<string, ServerConnection>();
  private readonly closedRecords: ClosedClientRecord[] = [];
  private readonly bandwidth = new BandwidthTracker();
  private readonly counters: NetworkCounters = createNetworkCounters();

  private listening = false;
  private tick = 0;
  private simTime = 0;
  private lastPingMs = 0;
  private readonly startedAtMs = performance.now();

  constructor(options: AuthoritativeServerOptions) {
    this.world = options.world;
    this.transport = options.transport;
    this.interestFilter = options.interestFilter ?? new AllInterestFilter();
    this.clientTimeoutMs = options.clientTimeoutMs ?? 5000;
    this.maxBufferedCommands = Math.max(1, options.maxBufferedCommands ?? 256);
    this.maxSequenceWindow = Math.max(1, options.maxSequenceWindow ?? 1024);
    this.gapSkipAfterTicks = Math.max(1, options.gapSkipAfterTicks ?? 5);
    this.snapshotEveryNTicks = Math.max(1, options.snapshotEveryNTicks ?? 1);
    this.pingIntervalMs = options.pingIntervalMs ?? 0;
    this.simulationHook = options.simulationHook ?? null;
    this.maxSpeed = options.maxSpeed ?? 50;
    this.spawnPoint = options.spawnPoint ?? [0, 0, 0];
    AuthoritativeServer.activeServers++;
  }

  /** Observable for single-player network-freedom proof (TEETH-T12-003). */
  public static getActiveServerCount(): number {
    return AuthoritativeServer.activeServers;
  }

  public getTransportName(): string {
    return this.transport.characteristics.name;
  }

  public isListening(): boolean {
    return this.listening;
  }

  /** Binds the underlying transport and begins accepting connections. */
  public async start(): Promise<{ port: number; url: string }> {
    this.transport.onConnectionEvent((event) => this.handleConnectionEvent(event));
    this.transport.onConnectionMessage((connId, data) => this.handleMessage(connId, data));
    const address = await this.transport.listen();
    this.listening = true;
    return address;
  }

  public async stop(): Promise<void> {
    this.listening = false;
    // Explicit, recorded teardown of every session (never silent).
    for (const session of Array.from(this.sessions.values())) {
      this.closeSession(session, session.state === "timed_out" ? "timed_out" : "disconnected", "server_stop");
    }
    await this.transport.stop(true);
  }

  public dispose(): void {
    if (this.listening) void this.stop();
    AuthoritativeServer.activeServers = Math.max(0, AuthoritativeServer.activeServers - 1);
  }

  /**
   * Advances one authoritative tick: drain buffered commands in sequence order,
   * run the simulation hook, then publish interest-filtered snapshots.
   * Called by the runtime scheduler's step handler; the server never owns time.
   */
  public tickOnce(dt = 1 / 60): SimulationTick {
    const nowMs = performance.now();
    this.tick++;
    this.simTime += dt;

    // 1. Apply buffered commands in strict sequence order (REQ-NET-004).
    for (const session of this.sessions.values()) {
      this.drainBuffered(session, dt);
    }

    // 2. Authoritative Koota-side simulation hook.
    const tickInfo: SimulationTick = { tick: this.tick, time: this.simTime, dt };
    if (this.simulationHook) {
      this.simulationHook(this.world, tickInfo);
    }

    // 3. Optional server->client liveness pings (REQ-NET-006).
    if (this.pingIntervalMs > 0 && nowMs - this.lastPingMs >= this.pingIntervalMs) {
      this.lastPingMs = nowMs;
      this.pingClients();
    }

    // 4. Publish interest-filtered replication snapshots (REQ-NET-005).
    if (this.tick % this.snapshotEveryNTicks === 0) {
      this.publishSnapshots();
    }

    // 5. Explicit timeout sweep (REQ-NET-009).
    if (this.clientTimeoutMs > 0) {
      for (const session of Array.from(this.sessions.values())) {
        if (nowMs - session.lastActivityMs > this.clientTimeoutMs) {
          this.timeoutSession(session, nowMs);
        }
      }
    }

    return tickInfo;
  }

  /** Sends a liveness ping to every connected client (RTT measurement). */
  public pingClients(): void {
    const nowMs = performance.now();
    for (const session of this.sessions.values()) {
      if (session.state !== "connected") continue;
      session.awaitingPingServerMs = nowMs;
      this.send(session.clientId, serverPingEnvelope(nowMs));
    }
  }

  public getDiagnostics(): NetworkServerDiagnostics {
    const clients = Array.from(this.sessions.values()).map((s) => ({
      client_id: s.clientId,
      state: s.state,
      entity_id: s.entityId,
      last_ack_sequence: s.lastContiguousSequence,
      buffered_commands: s.buffered.size,
      rtt_ms: s.lastRttMs,
      bandwidth: this.bandwidth.getBandwidthUsage(s.clientId),
    }));

    const closed = this.closedRecords.map((r) => ({
      client_id: r.clientId,
      state: r.state as ConnectionState,
      entity_id: r.entityId,
      last_ack_sequence: r.lastAckSequence,
      buffered_commands: 0,
      rtt_ms: null,
      bandwidth: this.bandwidth.getBandwidthUsage(r.clientId),
    }));

    return {
      listening: this.listening,
      tick: this.tick,
      transport: this.transport.characteristics.name,
      clients,
      closed_clients: closed,
      counters: cloneCounters(this.counters),
      bandwidth: this.bandwidth.getTotalUsage(),
      latency_simulation: null,
    };
  }

  // -------------------------------------------------------------------------
  // Connection lifecycle (explicit states; REQ-NET-009)
  // -------------------------------------------------------------------------

  private handleConnectionEvent(event: ServerConnectionEvent): void {
    if (event.type === "open") {
      this.connections.set(event.connection.id, event.connection);
      this.acceptConnection(event.connection.id);
    } else {
      this.connections.delete(event.connection.id);
      const session = this.sessions.get(event.connection.id);
      if (session) {
        this.closeSession(session, "disconnected", `peer_close code=${event.code}`);
      }
    }
  }

  private acceptConnection(clientId: string): void {
    const entityId = `player-${clientId}`;
    const nowMs = performance.now();

    // Explicit semantic transition: spawn the client's player entity in the
    // authoritative Koota world (recorded via counters, observable via state).
    this.world.spawnEntity({
      id: entityId,
      transform: { position: [...this.spawnPoint] as [number, number, number] },
      velocity: { linear: [0, 0, 0] },
      tags: ["player"],
    });
    // Bind the stable EntityId trait so projections correlate by stable id.
    const entity = this.world.getEntity(entityId);
    if (entity) {
      entity.set(EntityId, { id: entityId });
    }

    const session: ServerSession = {
      clientId,
      entityId,
      state: "connected",
      lastContiguousSequence: 0,
      buffered: new Map(),
      outOfOrderSeqs: new Set(),
      stuckTicks: 0,
      lastActivityMs: nowMs,
      awaitingPingServerMs: null,
      lastRttMs: null,
      lastSeenEntityIds: new Set(),
    };
    this.sessions.set(clientId, session);
    this.counters.connections_accepted++;
    this.send(clientId, welcomeEnvelope(clientId, entityId, this.tick, this.spawnPoint));
  }

  private closeSession(session: ServerSession, state: "disconnected" | "timed_out", detail: string): void {
    if (session.state !== "connected") return;
    session.state = state;

    // Explicit, recorded semantic transition: despawn the player entity.
    if (this.world.hasEntity(session.entityId)) {
      this.world.despawnEntity(session.entityId);
    }

    this.sessions.delete(session.clientId);
    this.closedRecords.push({
      clientId: session.clientId,
      entityId: session.entityId,
      state,
      lastAckSequence: session.lastContiguousSequence,
      closedAtMs: performance.now(),
    });
    if (this.closedRecords.length > MAX_CLOSED_RECORDS) this.closedRecords.shift();

    if (state === "timed_out") {
      this.counters.timeouts++;
    } else {
      this.counters.disconnections++;
    }
    this.send(session.clientId, disconnectEnvelope(`${state}: ${detail}`));
  }

  private timeoutSession(session: ServerSession, nowMs: number): void {
    session.lastActivityMs = nowMs; // avoid double-processing within same sweep
    this.closeSession(session, "timed_out", `no activity for ${this.clientTimeoutMs}ms`);
  }

  // -------------------------------------------------------------------------
  // Inbound path: validation strictly precedes mutation (REQ-SEC-007)
  // -------------------------------------------------------------------------

  private handleMessage(connId: string, data: string): void {
    const bytes = new TextEncoder().encode(data).byteLength;
    this.bandwidth.recordReceived(connId, bytes);

    const session = this.sessions.get(connId);
    if (!session) {
      // Message for an unknown/closed connection: counted, ignored.
      this.counters.malformed_dropped++;
      return;
    }

    if (bytes > WIRE_LIMITS.maxMessageBytes) {
      this.counters.oversized_dropped++;
      this.rejectSession(session, "message_too_large");
      return;
    }

    const decoded = decodeEnvelope(data);
    if (!decoded.ok) {
      if (decoded.reason === "message_too_large") {
        this.counters.oversized_dropped++;
      } else if (decoded.reason === "malformed_json" || decoded.reason === "empty_message") {
        this.counters.malformed_dropped++;
      } else {
        this.counters.invalid_envelopes++;
      }
      this.rejectSession(session, decoded.reason);
      return;
    }

    const envelope = decoded.envelope;
    session.lastActivityMs = performance.now();

    // Identity forgery check: a client may never claim another client's id.
    if (envelope.client_id !== undefined && envelope.client_id !== session.clientId) {
      this.counters.forged_rejected++;
      this.rejectSession(session, "client_id_forgery", envelope.kind, envelope.sequence);
      return;
    }

    // Control reply path: net.pong (server RTT measurement).
    if (envelope.kind === "net.pong") {
      if (envelope.sequence !== CONTROL_SEQUENCE) {
        this.rejectSession(session, "control_requires_sequence_0", envelope.kind, envelope.sequence);
        return;
      }
      const serverTimeMs = envelope.payload.server_time_ms;
      if (typeof serverTimeMs === "number" && Number.isFinite(serverTimeMs) && session.awaitingPingServerMs !== null) {
        session.lastRttMs = Math.max(0, performance.now() - serverTimeMs);
        session.awaitingPingServerMs = null;
      }
      return;
    }

    // Closed whitelist: only "cmd.*" kinds may ever cause semantic effects.
    if (!envelope.kind.startsWith("cmd.")) {
      this.counters.forged_rejected++;
      this.rejectSession(session, "kind_not_permitted", envelope.kind, envelope.sequence);
      return;
    }

    // Sequence validation (REQ-NET-003/REQ-NET-004).
    if (envelope.sequence <= CONTROL_SEQUENCE) {
      this.rejectSession(session, "sequence_required", envelope.kind, envelope.sequence);
      return;
    }
    if (envelope.sequence <= session.lastContiguousSequence || session.buffered.has(envelope.sequence)) {
      // Duplicate/replay: bounded, counted, never re-processed.
      this.counters.duplicates_dropped++;
      return;
    }
    if (envelope.sequence > session.lastContiguousSequence + this.maxSequenceWindow) {
      this.rejectSession(session, "sequence_gap_too_large", envelope.kind, envelope.sequence);
      return;
    }
    if (envelope.sequence !== session.lastContiguousSequence + 1) {
      this.counters.out_of_order_buffered++;
      session.outOfOrderSeqs.add(envelope.sequence);
    }
    if (!session.buffered.has(envelope.sequence)) {
      // Bounded buffer: when full, refuse the NEW arrival (backpressure) so
      // already-received lower sequences are never discarded behind a gap.
      if (session.buffered.size >= this.maxBufferedCommands) {
        this.counters.buffered_overflow_dropped++;
        this.rejectSession(session, "command_buffer_full", envelope.kind, envelope.sequence);
        return;
      }
      session.buffered.set(envelope.sequence, envelope);
    }
  }

  /**
   * Applies contiguous buffered commands in order on the authoritative tick.
   * Bounded recovery: a session stuck behind a missing head sequence is either
   * relieved by pressure (full buffer) or, after gapSkipAfterTicks, the gap is
   * explicitly skipped and recorded. The session never wedges silently.
   */
  private drainBuffered(session: ServerSession, dt: number): void {
    while (true) {
      // Contiguous drain in strict sequence order.
      while (true) {
        const next = session.lastContiguousSequence + 1;
        const envelope = session.buffered.get(next);
        if (!envelope) break;
        this.applyCommand(session, envelope, dt);
        session.buffered.delete(next);
        if (session.outOfOrderSeqs.has(next)) {
          this.counters.out_of_order_processed++;
          session.outOfOrderSeqs.delete(next);
        }
        session.lastContiguousSequence = next;
        session.stuckTicks = 0;
      }

      if (session.buffered.size === 0) break;

      // Head gap with higher sequences waiting: bounded skip policy.
      session.stuckTicks++;
      const pressure = session.buffered.size >= this.maxBufferedCommands;
      if (pressure || session.stuckTicks >= this.gapSkipAfterTicks) {
        const lowest = Math.min(...session.buffered.keys());
        this.counters.sequence_skips += lowest - 1 - session.lastContiguousSequence;
        session.lastContiguousSequence = lowest - 1;
        continue;
      }
      break;
    }
  }

  /** Final per-command validation and authoritative application. */
  private applyCommand(session: ServerSession, envelope: NetworkEnvelope, dt: number): void {
    const validation = validateCommandPayload(envelope.kind, envelope.payload);
    if (!validation.ok) {
      this.rejectSession(session, validation.reason, envelope.kind, envelope.sequence);
      return;
    }

    if (envelope.kind === "cmd.ping") {
      const payload = asPingPayload(envelope.payload);
      this.counters.commands_processed++;
      this.send(session.clientId, controlEnvelope("net.pong", {
        server_time_ms: performance.now(),
        client_time_ms: payload.client_time_ms,
      }));
      return;
    }

    // cmd.move: ownership check — a client may move ONLY its own player entity.
    const move = asMovePayload(envelope.payload);
    if (move.entity_id !== session.entityId) {
      this.counters.forged_rejected++;
      this.rejectSession(session, "entity_not_owned", envelope.kind, envelope.sequence);
      return;
    }
    const entity = this.world.getEntity(move.entity_id);
    if (!entity || !entity.has(Transform)) {
      this.rejectSession(session, "entity_unknown", envelope.kind, envelope.sequence);
      return;
    }

    const t = entity.get(Transform);
    if (!t) return;
    const len = Math.hypot(move.direction[0], move.direction[1], move.direction[2]);
    if (len === 0) {
      this.counters.commands_processed++;
      return;
    }
    const speed = Math.min(move.speed ?? 5, this.maxSpeed);
    const position: [number, number, number] = [
      t.position[0] + (move.direction[0] / len) * speed * dt,
      t.position[1] + (move.direction[1] / len) * speed * dt,
      t.position[2] + (move.direction[2] / len) * speed * dt,
    ];
    entity.set(Transform, { position, rotation: t.rotation, scale: t.scale });
    this.counters.commands_processed++;
  }

  // -------------------------------------------------------------------------
  // Replication publishing (REQ-NET-004, REQ-NET-005)
  // -------------------------------------------------------------------------

  private publishSnapshots(): void {
    for (const session of this.sessions.values()) {
      if (session.state !== "connected") continue;

      const relevant = this.interestFilter.selectEntityIds({
        clientId: session.clientId,
        entityId: session.entityId,
        world: this.world,
      });

      const capped = relevant.slice(0, WIRE_LIMITS.maxSnapshotEntities);
      const entities = projectEntities(this.world, capped);

      // Delta: previously-relevant entities that vanished from relevance
      // (despawned or filtered out) so clients can stop tracking them.
      const relevantSet = new Set(capped);
      const removed = Array.from(session.lastSeenEntityIds).filter((id) => !relevantSet.has(id));
      session.lastSeenEntityIds = relevantSet;

      const envelope = snapshotEnvelope(this.tick, session.lastContiguousSequence, {
        tick: this.tick,
        entities: entities as unknown as Record<string, unknown>[],
        removed_entity_ids: removed,
      });
      this.send(session.clientId, envelope);
      this.counters.snapshots_sent++;
    }
  }

  // -------------------------------------------------------------------------
  // Outbound plumbing
  // -------------------------------------------------------------------------

  private send(clientId: string, envelope: NetworkEnvelope): void {
    const raw = encodeEnvelope(envelope);
    const conn = this.connections.get(clientId);
    if (!conn) return;
    const result = conn.send(raw);
    if (result.accepted) {
      this.bandwidth.recordSent(clientId, result.bytes);
    }
  }

  private rejectSession(
    session: ServerSession,
    reason: string,
    kind?: string,
    sequence?: number
  ): void {
    this.counters.commands_rejected++;
    this.send(session.clientId, rejectEnvelope(reason, kind, sequence));
  }

  public getCounterSnapshot(): NetworkCounters {
    return cloneCounters(this.counters);
  }
}

/**
 * Binds the server to a SubsystemBarrier as the optional "network" subsystem
 * (REQ-NET-001). Single-player runtimes simply never call this, so the barrier
 * contains no network subsystem and no transport is ever constructed.
 */
export async function bootNetworkSubsystem(
  barrier: SubsystemBarrier,
  server: AuthoritativeServer,
  required = true
): Promise<void> {
  barrier.register("network", required);
  barrier.markBooting("network");
  await server.start();
  barrier.markReady("network");
}
