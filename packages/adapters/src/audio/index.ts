/**
 * Audio adapter modules (T17).
 *
 * The Tone.js browser backend is deliberately NOT re-exported here. It is a browser-only
 * module (REQ-BIND-012): headless, server, and pure-test code must never instantiate
 * Tone.js, so the entry point is the explicit direct path
 * `@gauntlet/adapters/src/audio/tone` consumed by browser bundles and browser proofs only.
 * Anything importing this index stays free of Tone.js/Web Audio dependencies.
 */

export type {
  AudioBackend,
  AudioBackendDiagnostics,
  AudioBackendState,
  AudioEventIntent,
  AudioPlaybackHandle,
} from "@gauntlet/runtime";
