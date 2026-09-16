/**
 * AudioSystem: the semantic-side interaction point for gameplay and server code.
 * Implements REQ-BIND-012, REQ-AUDIO-002, REQ-SAFE-007, and the audio leg of
 * "VFX/audio/UI participate in gameplay consequences".
 *
 * Invariants:
 * - Core semantic systems hold an AudioSystem (or the bare AudioBackend interface), never a
 *   Tone.js/AudioContext object. All payloads crossing this boundary are pure data
 *   (AudioEventIntent) — the redesign_trigger boundary is enforced structurally.
 * - With NullAudioBackend (headless/server/tests), emitting audio is a counted no-op:
 *   simulation and unrelated game logic are never blocked or crashed by audio state.
 * - AudioProjectionHandle (Koota trait) carries the semantic intent; this system drains it
 *   one-way into backend intents and marks the intent consumed in authoritative state.
 */

import type { SubsystemBarrier } from "../readiness";
import { AudioProjectionHandle, EntityId } from "../state/traits";
import type { GameWorld } from "../state/world";
import type {
  AudioBackend,
  AudioBackendDiagnostics,
  AudioEventIntent,
  AudioPlaybackHandle,
} from "./backend";

/** Pure-data record of one emitted audio intent (bounded ring, observable). */
export interface AudioEventRecord {
  readonly seq: number;
  readonly soundEvent: string;
  readonly volume: number;
  readonly pitch: number;
  readonly position: readonly [number, number, number] | null;
  readonly loop: boolean;
  readonly suppressed: boolean;
  readonly entityId: string | null;
  readonly tick: number | null;
}

export interface AudioSystemOptions {
  /** Bounded event-log capacity (oldest dropped). Default 256. */
  readonly maxLogEntries?: number;
}

export class AudioSystem {
  public readonly backend: AudioBackend;

  private readonly maxLogEntries: number;
  private readonly log: AudioEventRecord[] = [];
  private nextSeq = 1;
  private lastTick: number | null = null;

  constructor(backend: AudioBackend, options: AudioSystemOptions = {}) {
    this.backend = backend;
    this.maxLogEntries = options.maxLogEntries ?? 256;
  }

  /**
   * Observation hook so semantic records can correlate with the authoritative tick.
   * Pure bookkeeping; never affects simulation.
   */
  public observeTick(tick: number): void {
    this.lastTick = tick;
  }

  /**
   * Emit an abstract audio intent from gameplay semantics. NEVER throws for audio
   * lifecycle/policy reasons: locked or unavailable backends suppress the intent and
   * gameplay continues untouched (REQ-SAFE-007).
   */
  public emitSound(
    intent: AudioEventIntent,
    context: { entityId?: string } = {}
  ): AudioPlaybackHandle {
    const normalized: Required<Pick<AudioEventIntent, "volume" | "pitch" | "loop">> & {
      position: readonly [number, number, number] | null;
    } = {
      volume: clamp01(intent.volume ?? 1),
      pitch: intent.pitch ?? 1,
      position: intent.position ?? null,
      loop: intent.loop ?? false,
    };

    let handle: AudioPlaybackHandle;
    let suppressed = false;
    try {
      handle = this.backend.playSound({
        soundEvent: intent.soundEvent,
        volume: normalized.volume,
        pitch: normalized.pitch,
        position: normalized.position,
        loop: normalized.loop,
      });
      suppressed = !this.backend.isReady();
    } catch {
      // Even a misbehaving backend must never crash gameplay (REQ-SAFE-007).
      suppressed = true;
      handle = {
        id: `suppressed-${this.nextSeq}`,
        soundEvent: intent.soundEvent,
        stopped: true,
        stop: () => {},
      };
    }

    this.pushRecord({
      seq: this.nextSeq++,
      soundEvent: intent.soundEvent,
      volume: normalized.volume,
      pitch: normalized.pitch,
      position: normalized.position,
      loop: normalized.loop,
      suppressed,
      entityId: context.entityId ?? null,
      tick: this.lastTick,
    });

    return handle;
  }

  /**
   * One-way drain of semantic AudioProjectionHandle intents into backend intents.
   * Entities mark the intent by setting AudioProjectionHandle.playing = true; this system
   * emits through the abstraction and records consumption back into authoritative state
   * (playing = false). Pure semantic bookkeeping — no provider objects cross this line.
   */
  public syncFromState(gameWorld: GameWorld): { emitted: number; suppressed: number } {
    let emitted = 0;
    let suppressed = 0;

    for (const entity of gameWorld.query(EntityId, AudioProjectionHandle)) {
      const idTrait = entity.get(EntityId);
      const handleTrait = entity.get(AudioProjectionHandle);
      if (!idTrait || !handleTrait || !handleTrait.playing) continue;

      const before = this.backend.isReady();
      this.emitSound(
        {
          soundEvent: handleTrait.soundEvent,
          volume: handleTrait.volume,
        },
        { entityId: idTrait.id }
      );
      // Mark the semantic intent consumed in authoritative state.
      entity.set(AudioProjectionHandle, { playing: false });

      if (before) emitted++;
      else suppressed++;
    }

    return { emitted, suppressed };
  }

  /** Bounded, oldest-dropped pure-data event log. */
  public getEventLog(): readonly AudioEventRecord[] {
    return this.log;
  }

  public getDiagnostics(): AudioBackendDiagnostics & { events_logged: number } {
    return {
      ...this.backend.getDiagnostics(),
      events_logged: this.log.length,
    };
  }

  public dispose(): void {
    this.backend.dispose();
  }

  private pushRecord(record: AudioEventRecord): void {
    this.log.push(record);
    if (this.log.length > this.maxLogEntries) {
      this.log.splice(0, this.log.length - this.maxLogEntries);
    }
  }
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

/**
 * Binds the optional "audio" subsystem to the SubsystemBarrier using the provided backend.
 * Audio is optional by default (REQ-SAFE-007): an unavailable audio subsystem never blocks
 * runtime readiness. Headless/server code passes a NullAudioBackend.
 */
export function registerAudioSubsystem(
  barrier: SubsystemBarrier,
  backend: AudioBackend,
  options: { required?: boolean } = {}
): { subsystemId: "audio"; backend: AudioBackend } {
  barrier.register("audio", options.required ?? false);
  barrier.markBooting("audio");
  // Backend construction is synchronous and side-effect free for supported backends;
  // audio "readiness" (browser gesture unlock) is orthogonal to subsystem boot.
  barrier.markReady("audio", 0);
  return { subsystemId: "audio", backend };
}
