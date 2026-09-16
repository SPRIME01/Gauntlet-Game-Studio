/**
 * Provider-neutral VFX effect projection intents (T17, REQ-BIND-009).
 * Pure-data descriptions only: effect definitions and spawn intents are inspectable
 * studio contracts; three.quarks objects stay strictly inside the projection.
 */

/**
 * Factory that materializes one three.quarks ParticleSystem for an effect instance.
 * Called only inside the QuarksVfxProjection (adapter-owned execution projection).
 */
export type QuarksEffectFactory = (scene: import("three").Scene) => import("three.quarks").ParticleSystem;

/** Pure-data spawn intent emitted by gameplay/semantic side. */
export interface EffectSpawnIntent {
  /** Stable registered effect definition id. */
  readonly effectId: string;
  /** Authoritative entity to correlate this instance with (optional). */
  readonly entityId?: string;
  /** World-space spawn position. */
  readonly position: readonly [number, number, number];
  /** Optional Euler rotation in radians. */
  readonly rotationEuler?: readonly [number, number, number];
  /** Optional uniform scale. Default 1. */
  readonly scale?: number;
  /** Stable instance id; auto-generated when omitted. */
  readonly instanceId?: string;
}

/** Pure-data spec for a deterministic one-shot burst effect. */
export interface QuarksBurstEffectSpec {
  readonly particleCount: number;
  /** Effect duration in seconds. */
  readonly duration: number;
  /** Particle lifetime in seconds. */
  readonly startLife: number;
  readonly startSpeed: number;
  readonly startSize: number;
  /** Linear RGB 0..1. */
  readonly color: readonly [number, number, number];
  readonly looping?: boolean;
}
