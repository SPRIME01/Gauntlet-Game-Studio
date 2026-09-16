import { describe, it, expect } from "bun:test";
import {
  decodeEnvelope,
  encodeEnvelope,
  validateCommandPayload,
  clientCommandEnvelope,
  controlEnvelope,
  snapshotEnvelope,
  welcomeEnvelope,
  rejectEnvelope,
  WIRE_LIMITS,
  CONTROL_SEQUENCE,
  CLIENT_COMMAND_KINDS,
} from "../../src/network/protocol";
import { validateNetworkEnvelope } from "@gauntlet/contracts";

describe("Network protocol & envelope validation (T12 - REQ-NET-003, REQ-NET-007, REQ-SEC-007)", () => {
  it("round-trips a contract-valid envelope through encode/decode", () => {
    const envelope = clientCommandEnvelope("cmd.move", 7, {
      entity_id: "player-client-1",
      direction: [1, 0, 0],
      speed: 5,
    });
    const decoded = decodeEnvelope(encodeEnvelope(envelope));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.envelope.kind).toBe("cmd.move");
      expect(decoded.envelope.sequence).toBe(7);
      expect(decoded.envelope.payload).toEqual(envelope.payload);
    }
  });

  it("reuses the authoritative @gauntlet/contracts NetworkEnvelope schema", () => {
    const envelope = welcomeEnvelope("client-1", "player-client-1", 42, [0, 0, 0]);
    // Direct contract validation accepts protocol-built envelopes.
    expect(() => validateNetworkEnvelope(envelope)).not.toThrow();
    expect(envelope.sequence).toBe(CONTROL_SEQUENCE);
    expect(envelope.server_tick).toBe(42);
  });

  it("rejects malformed JSON, empty messages, and oversized messages explicitly", () => {
    expect(decodeEnvelope("{not json")).toEqual({ ok: false, reason: "malformed_json" });
    expect(decodeEnvelope("")).toEqual({ ok: false, reason: "empty_message" });

    const oversized = "x".repeat(WIRE_LIMITS.maxMessageBytes + 1);
    const result = decodeEnvelope(oversized);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("message_too_large");
  });

  it("rejects contract schema violations (strict envelope shape)", () => {
    // Missing payload.
    expect(decodeEnvelope(JSON.stringify({ kind: "cmd.move", sequence: 1 })).ok).toBe(false);
    // Negative sequence.
    expect(decodeEnvelope(JSON.stringify({ kind: "cmd.move", sequence: -1, payload: {} })).ok).toBe(false);
    // Non-integer sequence.
    expect(decodeEnvelope(JSON.stringify({ kind: "cmd.move", sequence: 1.5, payload: {} })).ok).toBe(false);
    // Unknown extra field (strict schema).
    expect(
      decodeEnvelope(JSON.stringify({ kind: "cmd.move", sequence: 1, payload: {}, forged_state: true })).ok
    ).toBe(false);
    // Payload is not an object.
    expect(decodeEnvelope(JSON.stringify({ kind: "cmd.move", sequence: 1, payload: 5 })).ok).toBe(false);
  });

  it("validates command payloads against the closed kind whitelist (server-side)", () => {
    expect(CLIENT_COMMAND_KINDS).toEqual(["cmd.move", "cmd.ping"]);

    // Permitted move command.
    expect(validateCommandPayload("cmd.move", { entity_id: "player-c1", direction: [0, 1, 0] })).toEqual({ ok: true });

    // Forged state-authoring kind is not permitted.
    expect(validateCommandPayload("state.set", { entity_id: "player-c1", transform: { position: [9, 9, 9] } })).toEqual({
      ok: false,
      reason: "kind_not_permitted",
    });
    expect(validateCommandPayload("replication.snapshot", { entities: [] })).toEqual({
      ok: false,
      reason: "kind_not_permitted",
    });

    // Shape violations.
    expect(validateCommandPayload("cmd.move", { entity_id: "player-c1", direction: [1, 0] })).toEqual({
      ok: false,
      reason: "invalid_direction",
    });
    expect(
      validateCommandPayload("cmd.move", { entity_id: "player-c1", direction: [Number("oops"), 0, 1] })
    ).toEqual({ ok: false, reason: "invalid_direction" });
    expect(validateCommandPayload("cmd.move", { entity_id: "player-c1", direction: [1, 0, 0], speed: 999 })).toEqual({
      ok: false,
      reason: "invalid_speed",
    });
    expect(validateCommandPayload("cmd.move", { entity_id: "bad id!", direction: [1, 0, 0] })).toEqual({
      ok: false,
      reason: "invalid_entity_id",
    });
    expect(validateCommandPayload("cmd.ping", {})).toEqual({ ok: false, reason: "invalid_client_time_ms" });

    // Note: JSON cannot carry NaN, but a hostile numeric string payload fails too.
    expect(
      validateCommandPayload("cmd.move", { entity_id: "p", direction: ["1", 0, 0] } as unknown as Record<string, unknown>)
    ).toEqual({ ok: false, reason: "invalid_direction" });
  });

  it("builds bounded, well-typed server envelopes", () => {
    const snap = snapshotEnvelope(10, 4, { tick: 10, entities: [], removed_entity_ids: ["gone"] });
    expect(snap.server_tick).toBe(10);
    expect(snap.ack_sequence).toBe(4);
    expect(snap.payload.removed_entity_ids).toEqual(["gone"]);

    const reject = rejectEnvelope("kind_not_permitted", "state.set", 3);
    expect(reject.kind).toBe("net.reject");
    expect(reject.payload.reason).toBe("kind_not_permitted");
    expect(reject.payload.rejected_kind).toBe("state.set");
    expect(reject.payload.rejected_sequence).toBe(3);

    expect(controlEnvelope("net.ping", { server_time_ms: 1 }).sequence).toBe(0);
  });

  it("throws when encoding an envelope beyond the wire size limit", () => {
    const huge = clientCommandEnvelope("cmd.move", 1, {
      entity_id: "p",
      direction: [1, 0, 0],
      blob: "y".repeat(WIRE_LIMITS.maxMessageBytes + 10),
    });
    expect(() => encodeEnvelope(huge)).toThrow(/maxMessageBytes/);
  });
});
