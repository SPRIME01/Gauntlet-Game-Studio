import { createWorld, type World, type Entity } from "koota";
import {
  EntityId,
  Transform,
  Velocity,
  RenderProjectionHandle,
  PhysicsProjectionHandle,
  NavigationProjectionHandle,
  AudioProjectionHandle,
  AssetBinding,
  PlayerTag,
  EnemyTag,
  ObstacleTag,
  VehicleTag,
  ItemTag,
  type SerializedEntityState,
  type SemanticStateSnapshot,
} from "./traits";

export interface SpawnEntityOptions {
  id: string;
  transform?: {
    position?: [number, number, number];
    rotation?: [number, number, number, number];
    scale?: [number, number, number];
  };
  velocity?: {
    linear?: [number, number, number];
    angular?: [number, number, number];
  };
  renderHandle?: {
    handleId: string;
    visible?: boolean;
    castShadow?: boolean;
    receiveShadow?: boolean;
    layer?: number;
  };
  physicsHandle?: {
    handleId: string;
    bodyType?: "dynamic" | "fixed" | "kinematicPositionBased" | "kinematicVelocityBased";
    mass?: number;
    sensor?: boolean;
  };
  navHandle?: {
    handleId: string;
    radius?: number;
    height?: number;
    speed?: number;
  };
  assetBinding?: {
    assetId: string;
    boundSockets?: Record<string, string>;
    activeColliders?: string[];
    activeDestructionGroups?: string[];
  };
  tags?: ("player" | "enemy" | "obstacle" | "vehicle" | "item")[];
}

/**
 * GameWorld provides the authoritative Koota semantic state container.
 * Implements REQ-GOAL-003, REQ-BIND-002, REQ-RUNTIME-001, REQ-RUNTIME-002.
 */
export class GameWorld {
  public readonly world: World;
  private readonly entityRegistry = new Map<string, Entity>();

  constructor() {
    this.world = createWorld();
  }

  /**
   * Spawns an entity with a unique stable identifier.
   */
  public spawnEntity(options: SpawnEntityOptions): Entity {
    if (this.entityRegistry.has(options.id)) {
      throw new Error(`Entity with ID '${options.id}' already exists in GameWorld`);
    }

    const traitsToApply: any[] = [
      EntityId({ id: options.id }),
    ];

    if (options.transform) {
      traitsToApply.push(
        Transform({
          position: options.transform.position ?? [0, 0, 0],
          rotation: options.transform.rotation ?? [0, 0, 0, 1],
          scale: options.transform.scale ?? [1, 1, 1],
        })
      );
    }

    if (options.velocity) {
      traitsToApply.push(
        Velocity({
          linear: options.velocity.linear ?? [0, 0, 0],
          angular: options.velocity.angular ?? [0, 0, 0],
        })
      );
    }

    if (options.renderHandle) {
      traitsToApply.push(
        RenderProjectionHandle({
          handleId: options.renderHandle.handleId,
          visible: options.renderHandle.visible ?? true,
          castShadow: options.renderHandle.castShadow ?? false,
          receiveShadow: options.renderHandle.receiveShadow ?? false,
          layer: options.renderHandle.layer ?? 0,
        })
      );
    }

    if (options.physicsHandle) {
      traitsToApply.push(
        PhysicsProjectionHandle({
          handleId: options.physicsHandle.handleId,
          bodyType: options.physicsHandle.bodyType ?? "dynamic",
          mass: options.physicsHandle.mass ?? 1.0,
          sensor: options.physicsHandle.sensor ?? false,
        })
      );
    }

    if (options.navHandle) {
      traitsToApply.push(
        NavigationProjectionHandle({
          handleId: options.navHandle.handleId,
          radius: options.navHandle.radius ?? 0.5,
          height: options.navHandle.height ?? 2.0,
          speed: options.navHandle.speed ?? 5.0,
        })
      );
    }

    if (options.assetBinding) {
      traitsToApply.push(
        AssetBinding({
          assetId: options.assetBinding.assetId,
          boundSockets: options.assetBinding.boundSockets ?? {},
          activeColliders: options.assetBinding.activeColliders ?? [],
          activeDestructionGroups: options.assetBinding.activeDestructionGroups ?? [],
        })
      );
    }

    if (options.tags) {
      for (const tag of options.tags) {
        switch (tag) {
          case "player": traitsToApply.push(PlayerTag()); break;
          case "enemy": traitsToApply.push(EnemyTag()); break;
          case "obstacle": traitsToApply.push(ObstacleTag()); break;
          case "vehicle": traitsToApply.push(VehicleTag()); break;
          case "item": traitsToApply.push(ItemTag()); break;
        }
      }
    }

    const entity = this.world.spawn(...traitsToApply);
    this.entityRegistry.set(options.id, entity);
    return entity;
  }

  /**
   * Retrieves an entity by its stable ID.
   */
  public getEntity(id: string): Entity | undefined {
    return this.entityRegistry.get(id);
  }

  /**
   * Checks if an entity exists by ID.
   */
  public hasEntity(id: string): boolean {
    return this.entityRegistry.has(id);
  }

  /**
   * Returns all active entity IDs.
   */
  public getEntityIds(): string[] {
    return Array.from(this.entityRegistry.keys());
  }

  /**
   * Despawns an entity by stable ID.
   */
  public despawnEntity(id: string): boolean {
    const entity = this.entityRegistry.get(id);
    if (!entity) return false;

    entity.destroy();
    this.entityRegistry.delete(id);
    return true;
  }

  /**
   * Queries entities matching the specified trait.
   */
  public query(...traits: any[]): Entity[] {
    return Array.from(this.world.query(...traits));
  }

  /**
   * Captures a pure semantic snapshot of all entities and their traits.
   * Proves state serialization is independent of Three.js / Rapier / DOM representations.
   */
  public takeSemanticSnapshot(): SemanticStateSnapshot {
    const serializedEntities: SerializedEntityState[] = [];

    for (const [id, entity] of this.entityRegistry.entries()) {
      const state: SerializedEntityState = { id };

      if (entity.has(Transform)) {
        const t = entity.get(Transform);
        if (t) {
          state.transform = {
            position: [...t.position] as [number, number, number],
            rotation: [...t.rotation] as [number, number, number, number],
            scale: [...t.scale] as [number, number, number],
          };
        }
      }

      if (entity.has(Velocity)) {
        const v = entity.get(Velocity);
        if (v) {
          state.velocity = {
            linear: [...v.linear] as [number, number, number],
            angular: [...v.angular] as [number, number, number],
          };
        }
      }

      if (entity.has(RenderProjectionHandle)) {
        const rh = entity.get(RenderProjectionHandle);
        if (rh) {
          state.renderHandle = {
            handleId: rh.handleId,
            visible: rh.visible,
            castShadow: rh.castShadow,
            receiveShadow: rh.receiveShadow,
            layer: rh.layer,
          };
        }
      }

      if (entity.has(PhysicsProjectionHandle)) {
        const ph = entity.get(PhysicsProjectionHandle);
        if (ph) {
          state.physicsHandle = {
            handleId: ph.handleId,
            bodyType: ph.bodyType,
            mass: ph.mass,
            sensor: ph.sensor,
          };
        }
      }

      if (entity.has(NavigationProjectionHandle)) {
        const nh = entity.get(NavigationProjectionHandle);
        if (nh) {
          state.navHandle = {
            handleId: nh.handleId,
            radius: nh.radius,
            height: nh.height,
            speed: nh.speed,
          };
        }
      }

      if (entity.has(AssetBinding)) {
        const ab = entity.get(AssetBinding);
        if (ab) {
          state.assetBinding = {
            assetId: ab.assetId,
            boundSockets: { ...ab.boundSockets },
            activeColliders: [...ab.activeColliders],
            activeDestructionGroups: [...ab.activeDestructionGroups],
          };
        }
      }

      const tags: string[] = [];
      if (entity.has(PlayerTag)) tags.push("player");
      if (entity.has(EnemyTag)) tags.push("enemy");
      if (entity.has(ObstacleTag)) tags.push("obstacle");
      if (entity.has(VehicleTag)) tags.push("vehicle");
      if (entity.has(ItemTag)) tags.push("item");
      if (tags.length > 0) state.tags = tags;

      serializedEntities.push(state);
    }

    return {
      version: 1,
      timestamp: Date.now(),
      entities: serializedEntities,
    };
  }

  /**
   * Restores semantic state from snapshot.
   */
  public restoreSemanticSnapshot(snapshot: SemanticStateSnapshot): void {
    // Clear existing entities
    const currentIds = Array.from(this.entityRegistry.keys());
    for (const id of currentIds) {
      this.despawnEntity(id);
    }

    // Recreate entities from snapshot
    for (const entityState of snapshot.entities) {
      this.spawnEntity({
        id: entityState.id,
        transform: entityState.transform,
        velocity: entityState.velocity,
        renderHandle: entityState.renderHandle,
        physicsHandle: entityState.physicsHandle,
        navHandle: entityState.navHandle,
        assetBinding: entityState.assetBinding,
        tags: entityState.tags as any,
      });
    }
  }

  /**
   * Asserts that a given data object does not contain forbidden provider or donor instances.
   * REQ-RUNTIME-001, REQ-DONOR-003.
   */
  public assertValidSemanticData(obj: any, entityId = "state-entity"): void {
    const forbiddenConstructors = [
      "Object3D", "Mesh", "Group", "Scene", "Camera", "PerspectiveCamera",
      "RigidBody", "Collider", "World", "Crowd", "NavMesh",
      "Element", "HTMLElement", "HTMLCanvasElement", "AudioContext",
      "GameObject", "BaseWorld", "Actor", "LivingActor"
    ];
    this.scanForForbiddenObjects(obj, entityId, forbiddenConstructors);
  }

  /**
   * Verifies that no provider or DOM instances have leaked into trait values.
   * REQ-RUNTIME-001 invariant check.
   */
  public assertNoProviderObjectsInState(): void {
    for (const [id, entity] of this.entityRegistry.entries()) {
      const traits = [Transform, Velocity, RenderProjectionHandle, PhysicsProjectionHandle, NavigationProjectionHandle, AssetBinding];
      for (const t of traits) {
        if (entity.has(t)) {
          const val = entity.get(t);
          this.assertValidSemanticData(val, id);
        }
      }
    }
  }

  private scanForForbiddenObjects(obj: any, entityId: string, forbidden: string[]): void {
    if (!obj || typeof obj !== "object") return;

    const proto = Object.getPrototypeOf(obj);
    const constructorName = proto?.constructor?.name;
    if (constructorName && forbidden.includes(constructorName)) {
      throw new Error(`Forbidden provider object '${constructorName}' leaked into entity '${entityId}' semantic state`);
    }

    for (const key of Object.keys(obj)) {
      const prop = obj[key];
      if (prop && typeof prop === "object") {
        const propCtor = Object.getPrototypeOf(prop)?.constructor?.name;
        if (propCtor && forbidden.includes(propCtor)) {
          throw new Error(`Forbidden provider object '${propCtor}' at '${key}' leaked into entity '${entityId}' semantic state`);
        }
      }
    }
  }
}
