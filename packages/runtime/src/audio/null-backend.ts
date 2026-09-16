/**
 * NullAudioBackend: the mandatory audio backend for headless servers, pure tests, and any
 * environment without a user agent. Implements REQ-BIND-012, REQ-AUDIO-002, REQ-SAFE-007.
 *
 * Guarantees:
 * - ZERO Web Audio and ZERO Tone.js dependencies: this module imports nothing at all.
 *   Importing or constructing it MUST NOT require a window AudioContext global or a DOM.
 * - playSound is a counted no-op that returns a dead handle; it never throws.
 * - There is no autoplay policy headless, so the backend reports "ready" immediately and
 *   unlock() resolves to "ready" as a no-op.
 */

import type {
  AudioBackend,
  AudioBackendDiagnostics,
  AudioBackendState,
  AudioEventIntent,
  AudioPlaybackHandle,
} from "./backend";

class NullPlaybackHandle implements AudioPlaybackHandle {
  public stopped = true;
  constructor(public readonly id: string, public readonly soundEvent: string) {}
  public stop(): void {
    this.stopped = true;
  }
}

export class NullAudioBackend implements AudioBackend {
  public readonly kind = "null" as const;

  private state: AudioBackendState = "ready";
  private disposed = false;
  private nextHandleId = 1;

  private intentsPlayed = 0;
  private intentsSuppressed = 0;
  private activeHandles = 0;

  public isHeadless(): boolean {
    return true;
  }

  public getState(): AudioBackendState {
    return this.disposed ? "suspended" : this.state;
  }

  public isReady(): boolean {
    return !this.disposed && this.state === "ready";
  }

  /**
   * No-op unlock: headless audio has no autoplay policy, so the backend is already ready.
   * Counts as a played-intent sink with zero side effects.
   */
  public async unlock(): Promise<AudioBackendState> {
    if (!this.disposed) {
      this.state = "ready";
    }
    return this.getState();
  }

  public async suspend(): Promise<void> {
    if (!this.disposed) {
      this.state = "suspended";
    }
  }

  public playSound(_intent: AudioEventIntent): AudioPlaybackHandle {
    if (this.disposed || !this.isReady()) {
      this.intentsSuppressed++;
      return new NullPlaybackHandle(`null-suppressed-${this.nextHandleId++}`, _intent.soundEvent);
    }
    this.intentsPlayed++;
    const handle = new NullPlaybackHandle(`null-${this.nextHandleId++}`, _intent.soundEvent);
    handle.stopped = false;
    // One-shot semantics: a null one-shot naturally completes on the next microtask
    // (no real output exists to outlive the call).
    this.activeHandles++;
    queueMicrotask(() => {
      this.activeHandles = Math.max(0, this.activeHandles - 1);
      if (!handle.stopped) {
        handle.stop();
      }
    });
    return handle;
  }

  public getDiagnostics(): AudioBackendDiagnostics {
    return {
      kind: this.kind,
      state: this.getState(),
      is_headless: true,
      intents_played: this.intentsPlayed,
      intents_suppressed: this.intentsSuppressed,
      active_handles: this.activeHandles,
    };
  }

  public dispose(): void {
    this.disposed = true;
    this.activeHandles = 0;
  }
}
