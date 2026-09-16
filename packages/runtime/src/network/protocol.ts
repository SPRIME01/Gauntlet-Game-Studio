/**
 * Wire protocol for Gauntlet Runtime networking.
 * Envelopes reuse the authoritative @gauntlet/contracts NetworkEnvelope schema.
 * Kinds are strictly namespaced: client -> server user commands MUST use the
 * "cmd." prefix; server -> client messages use "net."/"replication." prefixes.
 * Sequence 0 is reserved for unsequenced control envelopes.
 * Implements REQ-NET-003, REQ-NET-004, REQ-NET-007, REQ-SEC-007.
 */

import {
  validateNetworkEnvelope,
  type NetworkEnvelope,
} from "@gauntlet/contracts";

/** Unsequenced control envelope marker. */
export const CONTROL_SEQUENCE = 0;

/** Client -> server permitted command kinds (closed whitelist). */
export const CLIENT_COMMAND_KINDS = ["cmd.move", "cmd.ping"] as const;
export type ClientCommandKind = (typeof CLIENT_COMMAND_KINDS)[number];

/** Server -> client message kinds. */
export const SERVER_MESSAGE_KINDS = [
  "net.welcome",
  "net.pong",
  "net.ping",
  "net.reject",
  "net.disconnect",
  "replication.snapshot",
] as const;
export type ServerMessageKind = (typeof SERVER_MESSAGE_KINDS)[number];

/** Bounded wire limits enforced before and after decode (REQ-SEC-007). */
export const WIRE_LIMITS = {
  /** Maximum serialized envelope size accepted on receive. */
  maxMessageBytes: 64 * 1024,
  /** Maximum serialized payload size inside a client command. */
  maxCommandPayloadBytes: 4 * 1024,
  /** Maximum replication entities per snapshot. */
  maxSnapshotEntities: 512,
} as const;

export interface DecodedEnvelope {
  ok: true;
  envelope: NetworkEnvelope;
}

export interface DecodedFailure {
  ok: false;
  reason: string;
}

/**
 * Decodes a raw wire message into a contract-validated NetworkEnvelope.
 * Size, JSON, and schema failures are explicit (never thrown) so callers can
 * count and reject without crashing the server loop.
 */
export function decodeEnvelope(raw: string): DecodedEnvelope | DecodedFailure {
  if (typeof raw !== "string" || raw.length === 0) {
    return { ok: false, reason: "empty_message" };
  }
  if (byteLength(raw) > WIRE_LIMITS.maxMessageBytes) {
    return { ok: false, reason: "message_too_large" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "malformed_json" };
  }

  try {
    // Contracts NetworkEnvelope schema is the single validation authority.
    const envelope = validateNetworkEnvelope(parsed);
    return { ok: true, envelope };
  } catch (error) {
    return { ok: false, reason: `invalid_envelope: ${describeZodError(error)}` };
  }
}

/** Serializes an envelope onto the wire, enforcing the message size limit. */
export function encodeEnvelope(envelope: NetworkEnvelope): string {
  const raw = JSON.stringify(envelope);
  if (byteLength(raw) > WIRE_LIMITS.maxMessageBytes) {
    throw new Error(
      `Serialized envelope exceeds maxMessageBytes (${byteLength(raw)} > ${WIRE_LIMITS.maxMessageBytes})`
    );
  }
  return raw;
}

export function byteLength(s: string): number {
  return new TextEncoder().encode(s).byteLength;
}

function describeZodError(error: unknown): string {
  if (error && typeof error === "object" && "issues" in error) {
    const issues = (error as { issues: Array<{ path: (string | number)[]; message: string }> }).issues;
    return issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Command payload validation (server-side, before any semantic mutation).
// ---------------------------------------------------------------------------

export interface MoveCommandPayload {
  entity_id: string;
  direction: [number, number, number];
  speed?: number;
}

export interface PingCommandPayload {
  client_time_ms: number;
}

const MAX_ENTITY_ID_LENGTH = 128;
const MAX_SPEED = 100;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function validateStringId(v: unknown): string | null {
  if (typeof v !== "string" || v.length === 0 || v.length > MAX_ENTITY_ID_LENGTH) return null;
  if (!/^[A-Za-z0-9._:-]+$/.test(v)) return null;
  return v;
}

/**
 * Validates a client command payload against its kind whitelist.
 * Returns a structured rejection reason instead of throwing (REQ-SEC-007:
 * server-side validation precedes authoritative semantic mutation).
 */
export function validateCommandPayload(
  kind: string,
  payload: Record<string, unknown>
): { ok: true } | { ok: false; reason: string } {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return { ok: false, reason: "payload_not_object" };
  }

  switch (kind) {
    case "cmd.move": {
      const entity_id = validateStringId(payload.entity_id);
      if (!entity_id) return { ok: false, reason: "invalid_entity_id" };
      const dir = payload.direction;
      if (
        !Array.isArray(dir) ||
        dir.length !== 3 ||
        !dir.every(isFiniteNumber)
      ) {
        return { ok: false, reason: "invalid_direction" };
      }
      if (payload.speed !== undefined && (!isFiniteNumber(payload.speed) || payload.speed < 0 || payload.speed > MAX_SPEED)) {
        return { ok: false, reason: "invalid_speed" };
      }
      return { ok: true };
    }
    case "cmd.ping": {
      if (!isFiniteNumber(payload.client_time_ms)) return { ok: false, reason: "invalid_client_time_ms" };
      return { ok: true };
    }
    default:
      return { ok: false, reason: "kind_not_permitted" };
  }
}

/** Narrowing helper after validateCommandPayload succeeds. */
export function asMovePayload(payload: Record<string, unknown>): MoveCommandPayload {
  return {
    entity_id: payload.entity_id as string,
    direction: payload.direction as [number, number, number],
    speed: payload.speed as number | undefined,
  };
}

export function asPingPayload(payload: Record<string, unknown>): PingCommandPayload {
  return { client_time_ms: payload.client_time_ms as number };
}

// ---------------------------------------------------------------------------
// Envelope builders (typed, contract-shaped).
// ---------------------------------------------------------------------------

export function clientCommandEnvelope(
  kind: ClientCommandKind,
  sequence: number,
  payload: Record<string, unknown>
): NetworkEnvelope {
  return { kind, sequence, payload };
}

export function controlEnvelope(kind: ServerMessageKind, payload: Record<string, unknown>): NetworkEnvelope {
  return { kind, sequence: CONTROL_SEQUENCE, payload };
}

export function welcomeEnvelope(clientId: string, entityId: string, serverTick: number, spawn: [number, number, number]): NetworkEnvelope {
  return {
    kind: "net.welcome",
    sequence: CONTROL_SEQUENCE,
    payload: { client_id: clientId, entity_id: entityId, server_tick: serverTick, spawn },
    server_tick: serverTick,
  };
}

export function pongEnvelope(serverTimeMs: number, clientTimeMs?: number): NetworkEnvelope {
  const payload: Record<string, unknown> = { server_time_ms: serverTimeMs };
  if (clientTimeMs !== undefined) payload.client_time_ms = clientTimeMs;
  return controlEnvelope("net.pong", payload);
}

export function serverPingEnvelope(serverTimeMs: number): NetworkEnvelope {
  return controlEnvelope("net.ping", { server_time_ms: serverTimeMs });
}

export function rejectEnvelope(reason: string, rejectedKind?: string, rejectedSequence?: number): NetworkEnvelope {
  const payload: Record<string, unknown> = { reason };
  if (rejectedKind !== undefined) payload.rejected_kind = rejectedKind;
  if (rejectedSequence !== undefined) payload.rejected_sequence = rejectedSequence;
  return controlEnvelope("net.reject", payload);
}

export function disconnectEnvelope(reason: string): NetworkEnvelope {
  return controlEnvelope("net.disconnect", { reason });
}

export interface SnapshotPayload {
  tick: number;
  entities: Record<string, unknown>[];
  removed_entity_ids: string[];
}

export function snapshotEnvelope(
  tick: number,
  ackSequence: number,
  payload: SnapshotPayload
): NetworkEnvelope {
  return {
    kind: "replication.snapshot",
    sequence: CONTROL_SEQUENCE,
    payload: payload as unknown as Record<string, unknown>,
    server_tick: tick,
    ack_sequence: ackSequence,
  };
}
