/**
 * Tone.js browser AudioBackend — the preferred browser audio binding (T17).
 * Implements REQ-BIND-012, REQ-AUDIO-001, REQ-AUDIO-003, REQ-SAFE-007.
 *
 * Lifecycle (real autoplay policy, never bypassed):
 *   locked  — constructed; no AudioContext has been requested yet.
 *   suspended — a context exists (after an unlock attempt) but is NOT running.
 *   ready   — the underlying context reports "running", reached only through a real
 *             user gesture (unlock() invoked inside a trusted gesture handler).
 *
 * Invariants:
 * - unlock() MUST be called from a real user gesture handler in production. Calling it
 *   outside a gesture is policy-honest: the context stays suspended and the backend keeps
 *   reporting locked/suspended. No autoplay-policy bypass flags are used anywhere.
 * - playSound() never throws (REQ-SAFE-007): while not ready, intents are suppressed and
 *   counted; game logic is unaffected.
 * - Gameplay never sees Tone objects: inputs are pure-data AudioEventIntents and sound
 *   specs; outputs are AudioPlaybackHandles from the studio abstraction.
 * - REQ-AUDIO-003: no audio content ships with this adapter. Sample/audio licensing is the
 *   project's responsibility and is NOT covered by Tone.js licensing; synth-based specs are
 *   synthesized locally and carry no content licensing.
 */

import * as Tone from "tone";
import type {
  AudioBackend,
  AudioBackendDiagnostics,
  AudioBackendState,
  AudioEventIntent,
  AudioPlaybackHandle,
} from "@gauntlet/runtime";

/** Pure-data synthesis spec for a sound event (synthesized locally — no sample content). */
export interface ToneSynthSoundSpec {
  readonly kind: "synth";
  /** Note in scientific pitch notation, e.g. "C4". */
  readonly note: string;
  /** Duration as Tone notation, e.g. "16n", "8n". */
  readonly duration: string;
  readonly oscillator?: { readonly type: "sine" | "square" | "sawtooth" | "triangle" };
  readonly attack?: number;
  readonly release?: number;
  /** Output offset in dB applied on top of the intent volume. */
  readonly volumeDb?: number;
}

export type ToneSoundSpec = ToneSynthSoundSpec;

export interface ToneAudioBackendOptions {
  /** Pre-register stable sound-event specs (pure data). */
  readonly sounds?: Readonly<Record<string, ToneSoundSpec>>;
}

/** Minimal diagnostics extension; base fields satisfy the AudioBackend contract. */
export type ToneAudioBackendDiagnostics = AudioBackendDiagnostics & {
  readonly unmapped_events: number;
  readonly registered_sounds: number;
};

const UNLOCK_OBSERVE_WINDOW_MS = 400;

export class ToneAudioBackend implements AudioBackend {
  public readonly kind = "tone" as const;

  private readonly sounds = new Map<string, ToneSoundSpec>();
  private readonly synths = new Map<string, Tone.Synth>();
  private disposed = false;
  private unlockAttempted = false;
  private contextExposed = false;
  private nextHandleId = 1;

  private intentsPlayed = 0;
  private intentsSuppressed = 0;
  private unmappedEvents = 0;
  private activeHandles = 0;

  constructor(options: ToneAudioBackendOptions = {}) {
    for (const [event, spec] of Object.entries(options.sounds ?? {})) {
      this.sounds.set(event, spec);
    }
  }

  public isHeadless(): boolean {
    return false;
  }

  /**
   * Honest lifecycle observation. This method NEVER creates an AudioContext by itself
   * (before any unlock attempt the state is "locked"); after an attempt it mirrors the
   * underlying context state.
   */
  public getState(): AudioBackendState {
    if (this.disposed) return "suspended";
    if (!this.contextExposed) return "locked";
    const ctxState = Tone.getContext().state;
    return ctxState === "running" ? "ready" : "suspended";
  }

  public isReady(): boolean {
    return this.getState() === "ready";
  }

  /**
   * Attempt unlock. MUST be invoked from a real user gesture for the result to become
   * "ready". Outside a gesture the browser keeps the context suspended; the returned state
   * is the observed state (never optimistic). Resolves within a bounded observation window
   * so gameplay code is never left awaiting an un-gestured resume forever.
   */
  public async unlock(): Promise<AudioBackendState> {
    if (this.disposed) return this.getState();
    this.unlockAttempted = true;
    this.contextExposed = true;
    try {
      // Tone.start() resumes the shared context. Without user activation the promise may
      // stay pending; the bounded observe window below returns honest state instead.
      await Promise.race([
        Tone.start().catch(() => {}),
        new Promise<void>((resolve) => setTimeout(resolve, UNLOCK_OBSERVE_WINDOW_MS)),
      ]);
    } catch {
      /* state below reflects reality */
    }
    return this.getState();
  }

  public async suspend(): Promise<void> {
    if (this.disposed) return;
    this.contextExposed = true;
    try {
      // BaseContext typings do not expose suspend; the concrete shared context does.
      const ctx = Tone.getContext() as unknown as { suspend(): Promise<void> };
      await ctx.suspend();
    } catch {
      /* best effort; state remains observable via getState() */
    }
  }

  /**
   * Emit an intent. Suppressed (dead handle) unless the backend is ready — audio being
   * locked NEVER crashes or blocks game logic (REQ-SAFE-007).
   */
  public playSound(intent: AudioEventIntent): AudioPlaybackHandle {
    const id = `tone-${this.nextHandleId++}`;
    if (this.disposed || !this.isReady()) {
      this.intentsSuppressed++;
      return { id, soundEvent: intent.soundEvent, stopped: true, stop: () => {} };
    }

    const spec = this.sounds.get(intent.soundEvent);
    if (!spec) {
      this.unmappedEvents++;
      this.intentsSuppressed++;
      return { id, soundEvent: intent.soundEvent, stopped: true, stop: () => {} };
    }

    const synth = this.getSynth(intent.soundEvent, spec);
    try {
      const volume = clamp01(intent.volume ?? 1);
      const velocity = volume;
      const baseHz = Tone.Frequency(spec.note).toFrequency();
      const hz = Math.max(20, Math.min(20000, baseHz * (intent.pitch ?? 1)));
      synth.volume.value = spec.volumeDb ?? -6;
      synth.triggerAttackRelease(hz, spec.duration, Tone.now(), velocity);

      this.intentsPlayed++;
      this.activeHandles++;
      let stopped = false;
      const durationSec = Math.max(0.05, Tone.Time(spec.duration).toSeconds() + (spec.release ?? 0.2));
      const timer = setTimeout(() => {
        if (!stopped) {
          stopped = true;
          this.activeHandles = Math.max(0, this.activeHandles - 1);
        }
      }, durationSec * 1000 + 50);
      return {
        id,
        soundEvent: intent.soundEvent,
        stopped: false,
        stop: () => {
          if (stopped) return;
          stopped = true;
          clearTimeout(timer);
          try {
            synth.triggerRelease();
          } catch {
            /* already released */
          }
          this.activeHandles = Math.max(0, this.activeHandles - 1);
        },
      };
    } catch {
      // Never let audio synthesis failure crash gameplay (REQ-SAFE-007).
      this.intentsSuppressed++;
      return { id, soundEvent: intent.soundEvent, stopped: true, stop: () => {} };
    }
  }

  public getDiagnostics(): ToneAudioBackendDiagnostics {
    return {
      kind: this.kind,
      state: this.getState(),
      is_headless: false,
      intents_played: this.intentsPlayed,
      intents_suppressed: this.intentsSuppressed,
      active_handles: this.activeHandles,
      unmapped_events: this.unmappedEvents,
      registered_sounds: this.sounds.size,
    };
  }

  /** Register/replace a stable sound-event spec (pure data). */
  public registerSound(soundEvent: string, spec: ToneSoundSpec): void {
    this.sounds.set(soundEvent, spec);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const synth of this.synths.values()) {
      try {
        synth.dispose();
      } catch {
        /* already disposed */
      }
    }
    this.synths.clear();
    this.activeHandles = 0;
  }

  /** True when unlock() has been attempted at least once (diagnostics/proofs). */
  public get unlockWasAttempted(): boolean {
    return this.unlockAttempted;
  }

  /**
   * Observed underlying Web Audio context state for proofs/diagnostics. Never creates the
   * context: before the first unlock attempt this returns "not-created".
   */
  public getUnderlyingContextState(): "not-created" | "running" | "suspended" | "closed" | "error" {
    if (!this.contextExposed) return "not-created";
    try {
      return Tone.getContext().state as "running" | "suspended" | "closed";
    } catch {
      return "error";
    }
  }

  private getSynth(soundEvent: string, spec: ToneSoundSpec): Tone.Synth {
    let synth = this.synths.get(soundEvent);
    if (!synth) {
      synth = new Tone.Synth({
        oscillator: { type: spec.oscillator?.type ?? "sine" },
        envelope: {
          attack: spec.attack ?? 0.005,
          decay: 0.1,
          sustain: 0.3,
          release: spec.release ?? 0.2,
        },
      }).toDestination();
      this.synths.set(soundEvent, synth);
    }
    return synth;
  }
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.min(1, Math.max(0, v));
}
