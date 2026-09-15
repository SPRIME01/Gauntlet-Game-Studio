import * as THREE from "three";
import { ProjectionRegistry } from "./registry";
import type { GameWorld } from "../state/world";
import { Transform, RenderProjectionHandle, EntityId } from "../state/traits";

/**
 * RenderProjectionManager manages Three.js Object3D visual projections.
 * Implements REQ-GOAL-003, REQ-RUNTIME-001, REQ-RUNTIME-002.
 * 
 * Invariants:
 * 1. Three.js scene objects are strictly derived visual projections; they never own gameplay semantics.
 * 2. Mutations to Object3D (position, rotation, scale, user data) do NOT back-propagate into Koota.
 * 3. Projections can be destroyed and recreated at any time from authoritative Koota state.
 */
export class RenderProjectionManager {
  public readonly registry = new ProjectionRegistry<THREE.Object3D>();

  /**
   * Binds a Three.js Object3D to an authoritative entity ID.
   */
  public bind(entityId: string, handleId: string, object: THREE.Object3D): void {
    // Store handleId on object's userData for debug observability without altering game truth
    object.userData = object.userData || {};
    object.userData.__gauntlet_entity_id = entityId;
    object.userData.__gauntlet_handle_id = handleId;

    this.registry.register(entityId, handleId, object);
  }

  /**
   * Unbinds an entity's render projection.
   */
  public unbind(entityId: string): THREE.Object3D | undefined {
    return this.registry.unregister(entityId);
  }

  /**
   * Destroys an entity's render projection, removing it from parent scene graph.
   * Game entity in Koota remains alive and unaffected.
   */
  public destroyProjection(entityId: string): boolean {
    const object = this.registry.unregister(entityId);
    if (!object) return false;

    if (object.parent) {
      object.parent.remove(object);
    }
    return true;
  }

  /**
   * Unidirectional sync from authoritative Koota state into Three.js Object3D projections.
   */
  public syncFromState(gameWorld: GameWorld): { syncedCount: number } {
    let syncedCount = 0;
    const queryEntities = gameWorld.query(EntityId, Transform, RenderProjectionHandle);

    for (const entity of queryEntities) {
      const idTrait = entity.get(EntityId);
      if (!idTrait) continue;
      const entityId = idTrait.id;
      const object = this.registry.get(entityId);
      if (!object) continue;

      const transform = entity.get(Transform);
      const renderHandle = entity.get(RenderProjectionHandle);
      if (!transform || !renderHandle) continue;

      // Sync position
      object.position.set(
        transform.position[0],
        transform.position[1],
        transform.position[2]
      );

      // Sync rotation quaternion
      object.quaternion.set(
        transform.rotation[0],
        transform.rotation[1],
        transform.rotation[2],
        transform.rotation[3]
      );

      // Sync scale
      object.scale.set(
        transform.scale[0],
        transform.scale[1],
        transform.scale[2]
      );

      // Sync visibility and shadow flags
      object.visible = renderHandle.visible;
      object.castShadow = renderHandle.castShadow;
      object.receiveShadow = renderHandle.receiveShadow;

      syncedCount++;
    }

    return { syncedCount };
  }

  /**
   * Recreates a destroyed or missing render projection from authoritative Koota state.
   */
  public recreateProjection(
    entityId: string,
    factory: () => THREE.Object3D,
    gameWorld: GameWorld,
    parent?: THREE.Object3D
  ): THREE.Object3D {
    const entity = gameWorld.getEntity(entityId);
    if (!entity) {
      throw new Error(`Cannot recreate projection: entity '${entityId}' not found in GameWorld`);
    }

    if (!entity.has(RenderProjectionHandle)) {
      throw new Error(`Cannot recreate projection: entity '${entityId}' has no RenderProjectionHandle`);
    }

    const renderHandle = entity.get(RenderProjectionHandle);
    if (!renderHandle) {
      throw new Error(`Cannot recreate projection: entity '${entityId}' render handle is empty`);
    }
    const object = factory();

    if (parent) {
      parent.add(object);
    }

    this.bind(entityId, renderHandle.handleId, object);

    // Synchronize transform immediately
    if (entity.has(Transform)) {
      const transform = entity.get(Transform);
      if (transform) {
        object.position.set(transform.position[0], transform.position[1], transform.position[2]);
        object.quaternion.set(transform.rotation[0], transform.rotation[1], transform.rotation[2], transform.rotation[3]);
        object.scale.set(transform.scale[0], transform.scale[1], transform.scale[2]);
      }
    }

    object.visible = renderHandle.visible;
    return object;
  }
}
