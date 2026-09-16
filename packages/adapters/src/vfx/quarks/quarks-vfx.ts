/**
 * QuarksVfxProjection: three.quarks particle effects strictly behind a game/runtime effect
 * projection (T17, REQ-BIND-009).
 *
 * Invariants (execution projection, never semantic authority):
 * 1. Effect definitions/spawn intents arrive as pure data; three.quarks and Three.js objects
 *    are created only inside this projection.
 * 2. Correlation with authoritative entities runs over stable IDs through the shared
 *    ProjectionRegistry (REQ-RUNTIME-002), exactly like render/physics projections.
 * 3. Mutations to projection objects NEVER back-propagate into Koota; syncFromState is
 *    one-way (Transform -> emitter).
 * 4. Projections are disposable/recreatable at any time; destroying an effect instance never
 *    touches authoritative state.
 * 5. Unknown effect ids degrade (suppressed, counted) instead of crashing gameplay
 *    (REQ-SAFE-007 discipline applied to VFX).
 *
 * Headless capability: stepping the renderer is pure CPU (no WebGL context required), so
 * deterministic projection tests run under Bun with no DOM/GPU.
 */

import * as THREE from "three";
import { BatchedParticleRenderer, ConstantColor, ConstantValue, ParticleSystem, RenderMode, Vector4 } from "three.quarks";
import type { BatchedRenderer, ParticleEmitter } from "three.quarks";
import { EntityId, ProjectionRegistry, Transform } from "@gauntlet/runtime";
import type { GameWorld } from "@gauntlet/runtime";
import type { EffectSpawnIntent, QuarksBurstEffectSpec, QuarksEffectFactory } from "./effect-intents";

export interface QuarksVfxStats {
  readonly defined_effects: number;
  readonly active_instances: number;
  readonly particle_count: number;
  /** Spawn intents rejected because the effect id was unknown. */
  readonly suppressed_spawns: number;
}

export class QuarksVfxProjection {
  /** Stable-ID correlation registry: instanceId -> emitter projection. */
  public readonly registry = new ProjectionRegistry<ParticleEmitter>();

  private readonly definitions = new Map<string, QuarksEffectFactory>();
  private readonly systems = new Map<string, ParticleSystem>();
  private readonly scene: THREE.Scene;
  private readonly renderer: BatchedRenderer;
  private nextInstanceId = 1;
  private suppressedSpawns = 0;
  private disposed = false;

  constructor(options: { scene?: THREE.Scene } = {}) {
    this.scene = options.scene ?? new THREE.Scene();
    this.renderer = new BatchedParticleRenderer();
    this.scene.add(this.renderer);
  }

  /** Register a stable effect definition (factory stays adapter-side). */
  public defineEffect(effectId: string, factory: QuarksEffectFactory): void {
    this.definitions.set(effectId, factory);
  }

  public hasEffect(effectId: string): boolean {
    return this.definitions.has(effectId);
  }

  /**
   * Spawn an effect instance from a pure-data intent. Returns null when the effect id is
   * unknown (suppressed + counted; never throws).
   */
  public spawnEffect(intent: EffectSpawnIntent): { instanceId: string; emitter: ParticleEmitter } | null {
    if (this.disposed) return null;
    const factory = this.definitions.get(intent.effectId);
    if (!factory) {
      this.suppressedSpawns++;
      return null;
    }

    const instanceId = intent.instanceId ?? `vfx-${intent.effectId}-${this.nextInstanceId++}`;
    // Recreating over an existing instance id is a registry-level replace.
    this.destroyEffect(instanceId);

    const system = factory(this.scene);
    const emitter = system.emitter;

    emitter.position.set(intent.position[0], intent.position[1], intent.position[2]);
    if (intent.rotationEuler) {
      emitter.rotation.set(intent.rotationEuler[0], intent.rotationEuler[1], intent.rotationEuler[2]);
    }
    const s = intent.scale ?? 1;
    emitter.scale.set(s, s, s);

    // three.quarks steps systems only when the emitter chain resolves to a Scene root.
    this.scene.add(emitter);
    this.renderer.addSystem(system);

    this.systems.set(instanceId, system);
    this.registry.register(intent.entityId ?? instanceId, instanceId, emitter);
    return { instanceId, emitter };
  }

  /** One-way authoritative Transform -> emitter projection sync (never the reverse). */
  public syncFromState(gameWorld: GameWorld): { syncedCount: number } {
    let syncedCount = 0;
    for (const entity of gameWorld.query(EntityId, Transform)) {
      const idTrait = entity.get(EntityId);
      const transform = entity.get(Transform);
      if (!idTrait || !transform) continue;
      const emitter = this.registry.get(idTrait.id);
      if (!emitter) continue;
      emitter.position.set(transform.position[0], transform.position[1], transform.position[2]);
      emitter.quaternion.set(transform.rotation[0], transform.rotation[1], transform.rotation[2], transform.rotation[3]);
      emitter.scale.set(transform.scale[0], transform.scale[1], transform.scale[2]);
      syncedCount++;
    }
    return { syncedCount };
  }

  /**
   * Deterministically advance all effect instances by dt (pure CPU; no GPU/DOM required).
   */
  public update(dt: number): { activeInstances: number; particleCount: number } {
    if (this.disposed) return { activeInstances: 0, particleCount: 0 };
    this.renderer.update(dt);
    let particleCount = 0;
    for (const system of this.systems.values()) {
      particleCount += system.particleNum;
    }
    return { activeInstances: this.systems.size, particleCount };
  }

  /** Destroy one effect instance. Authoritative state is untouched. */
  public destroyEffect(instanceId: string): boolean {
    const system = this.systems.get(instanceId);
    if (!system) return false;
    this.renderer.deleteSystem(system);
    const emitter = system.emitter;
    if (emitter.parent) {
      emitter.parent.remove(emitter);
    }
    this.registry.unregisterByHandle(instanceId);
    this.systems.delete(instanceId);
    system.dispose();
    return true;
  }

  /** Pure-data, inspectable projection stats (no provider objects). */
  public getStats(): QuarksVfxStats {
    let particleCount = 0;
    for (const system of this.systems.values()) {
      particleCount += system.particleNum;
    }
    return {
      defined_effects: this.definitions.size,
      active_instances: this.systems.size,
      particle_count: particleCount,
      suppressed_spawns: this.suppressedSpawns,
    };
  }

  /** Destroy all instances and release projection resources. */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const instanceId of Array.from(this.systems.keys())) {
      this.destroyEffect(instanceId);
    }
    this.scene.remove(this.renderer);
  }
}

/**
 * Build a deterministic burst-effect factory from a pure-data spec (REQ-BIND-009:
 * three.quarks as the preferred particle/VFX binding where its representation fits).
 */
export function defineBurstEffect(spec: QuarksBurstEffectSpec): QuarksEffectFactory {
  return (scene: THREE.Scene) => {
    const material = new THREE.MeshBasicMaterial();
    void scene; // scene kept in signature for richer factory contracts
    return new ParticleSystem({
      material,
      renderMode: RenderMode.BillBoard,
      looping: spec.looping ?? false,
      duration: spec.duration,
      emissionBursts: [
        {
          time: 0,
          count: new ConstantValue(spec.particleCount),
          cycle: 1,
          interval: 0.00001,
          probability: 1,
        },
      ],
      startLife: new ConstantValue(spec.startLife),
      startSpeed: new ConstantValue(spec.startSpeed),
      startSize: new ConstantValue(spec.startSize),
      startRotation: new ConstantValue(0),
      startColor: new ConstantColor(new Vector4(spec.color[0], spec.color[1], spec.color[2], 1)),
    });
  };
}
