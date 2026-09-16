/**
 * Studio-owned AudioBackend abstraction.
 * Implements REQ-BIND-012, REQ-AUDIO-001, REQ-AUDIO-002, REQ-SAFE-007.
 *
 * Invariants:
 * 1. Core semantic systems and headless server code interact with audio ONLY through this
 *    abstraction and pure-data intents. No Tone.js objects, AudioContext instances, or any
 *    Web Audio handle may appear in this interface or its inputs/outputs.
 * 2. Browser backends model the real autoplay lifecycle: locked/suspended until a real user
 *    gesture unlocks them, then ready. Autoplay-policy bypasses are forbidden (REQ-AUDIO-001).
 * 3. NullAudioBackend is the mandatory backend for headless, server, and pure tests
 *    (REQ-BIND-012). Importing this module MUST NOT require a window AudioContext global.
 * 4. An unavailable or still-locked backend degrades only audio-dependent behavior: playSound
 *    MUST NOT throw and MUST NOT crash unrelated game logic (REQ-SAFE-007).
 */

/** Lifecycle state of an audio backend. Browser backends start locked/suspended. */
export type AudioBackendState = "locked" | "suspended" | "ready";

/** Backend identity class. "null" is the headless/server-safe no-op backend. */
export type AudioBackendKind = "null" | (string & {});

/**
 * Provider-neutral audio intent. Pure data only: stable semantic sound-event ids plus
 * presentation-level parameters. No node handles, no library types (redesign_trigger guard).
 */
export interface AudioEventIntent {
  /** Stable semantic sound-event id, e.g. "weapon.laser_fire" or "ui.click". */
  readonly soundEvent: string;
  /** Linear volume 0..1 (clamped by backends). */
  readonly volume?: number;
  /** Pitch multiplier, 1.0 = natural pitch. */
  readonly pitch?: number;
  /** World-space emitter position for spatialized playback (null/omitted = UI/global). */
  readonly position?: readonly [number, number, number] | null;
  /** Looping intent; non-looping one-shots are the default. */
  readonly loop?: boolean;
}

/**
 * Handle for a started playback. Pure data identity plus stop(); never a Web Audio node.
 * Stopping an already-stopped or suppressed handle is always safe.
 */
export interface AudioPlaybackHandle {
  readonly id: string;
  readonly soundEvent: string;
  /** True when the handle was suppressed (backend not ready) or explicitly stopped. */
  readonly stopped: boolean;
  stop(): void;
}

/** Pure-data diagnostics snapshot for observability. No library objects. */
export interface AudioBackendDiagnostics {
  readonly kind: AudioBackendKind;
  readonly state: AudioBackendState;
  readonly is_headless: boolean;
  /** Total playSound intents accepted for playback. */
  readonly intents_played: number;
  /** Total playSound intents suppressed because audio was unavailable/locked (REQ-SAFE-007). */
  readonly intents_suppressed: number;
  /** Handles currently active. */
  readonly active_handles: number;
}

/**
 * The AudioBackend contract. Implementations:
 * - packages/runtime/src/audio/null-backend (NullAudioBackend): mandatory headless/server/test backend.
 * - packages/adapters/src/audio/tone (ToneAudioBackend): browser implementation obeying the
 *   real user-gesture unlock lifecycle.
 */
export interface AudioBackend {
  readonly kind: AudioBackendKind;

  /** True when the backend is for headless/server environments (no user agent). */
  isHeadless(): boolean;

  /** Current lifecycle state (locked | suspended | ready). */
  getState(): AudioBackendState;

  isReady(): boolean;

  /**
   * Attempt to unlock/resume audio. In browser implementations this MUST be invoked from a
   * real user gesture handler and returns "ready" only when the underlying context actually
   * reached the running state. Resolves to the observed state; it never bypasses policy.
   */
  unlock(): Promise<AudioBackendState>;

  /** Suspend audio output. Safe to call in any state; resolves when settled. */
  suspend(): Promise<void>;

  /**
   * Emit an abstract audio intent. When the backend is unavailable or not yet unlocked the
   * intent is suppressed (counted, dead handle returned) and unrelated game logic is never
   * affected. This method MUST NOT throw for policy/lifecycle reasons (REQ-SAFE-007).
   */
  playSound(intent: AudioEventIntent): AudioPlaybackHandle;

  /** Pure-data diagnostics snapshot. */
  getDiagnostics(): AudioBackendDiagnostics;

  /** Release backend resources. Idempotent. */
  dispose(): void;
}
