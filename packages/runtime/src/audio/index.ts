/**
 * @gauntlet/runtime audio boundary (T17).
 * Studio-owned AudioBackend abstraction, NullAudioBackend, and the semantic AudioSystem.
 * Core semantic systems and headless server code MUST import only from this module —
 * never from browser audio providers (REQ-BIND-012, REQ-AUDIO-002).
 */

export * from "./backend";
export * from "./null-backend";
export * from "./audio-system";
