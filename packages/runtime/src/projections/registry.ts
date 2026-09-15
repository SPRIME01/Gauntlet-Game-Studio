/**
 * Generic ProjectionRegistry for correlating authoritative entity IDs with runtime projections.
 * Implements REQ-RUNTIME-002 (stable IDs for render, physics, navigation, audio, asset projections).
 */
export class ProjectionRegistry<T> {
  private readonly entityToEntry = new Map<string, { handleId: string; instance: T }>();
  private readonly handleToEntity = new Map<string, string>();

  /**
   * Registers a projection instance associated with an entity ID and handle ID.
   */
  public register(entityId: string, handleId: string, instance: T): void {
    if (this.entityToEntry.has(entityId)) {
      this.unregister(entityId);
    }
    this.entityToEntry.set(entityId, { handleId, instance });
    this.handleToEntity.set(handleId, entityId);
  }

  /**
   * Gets the projection instance by entity ID.
   */
  public get(entityId: string): T | undefined {
    return this.entityToEntry.get(entityId)?.instance;
  }

  /**
   * Gets the projection instance by handle ID.
   */
  public getByHandle(handleId: string): T | undefined {
    const entityId = this.handleToEntity.get(handleId);
    if (!entityId) return undefined;
    return this.get(entityId);
  }

  /**
   * Gets the handle ID associated with an entity ID.
   */
  public getHandleId(entityId: string): string | undefined {
    return this.entityToEntry.get(entityId)?.handleId;
  }

  /**
   * Gets the entity ID associated with a handle ID.
   */
  public getEntityId(handleId: string): string | undefined {
    return this.handleToEntity.get(handleId);
  }

  /**
   * Returns whether an entity ID is registered.
   */
  public has(entityId: string): boolean {
    return this.entityToEntry.has(entityId);
  }

  /**
   * Returns whether a handle ID is registered.
   */
  public hasHandle(handleId: string): boolean {
    return this.handleToEntity.has(handleId);
  }

  /**
   * Unregisters an entity's projection.
   */
  public unregister(entityId: string): T | undefined {
    const entry = this.entityToEntry.get(entityId);
    if (!entry) return undefined;

    this.entityToEntry.delete(entityId);
    this.handleToEntity.delete(entry.handleId);
    return entry.instance;
  }

  /**
   * Unregisters by handle ID.
   */
  public unregisterByHandle(handleId: string): T | undefined {
    const entityId = this.handleToEntity.get(handleId);
    if (!entityId) return undefined;
    return this.unregister(entityId);
  }

  /**
   * Clears all registered projections.
   */
  public clear(): void {
    this.entityToEntry.clear();
    this.handleToEntity.clear();
  }

  /**
   * Returns the count of registered projections.
   */
  public size(): number {
    return this.entityToEntry.size;
  }

  /**
   * Returns all entries.
   */
  public entries(): Array<{ entityId: string; handleId: string; instance: T }> {
    return Array.from(this.entityToEntry.entries()).map(([entityId, entry]) => ({
      entityId,
      handleId: entry.handleId,
      instance: entry.instance,
    }));
  }
}

export interface EntityProjections<TRender = any, TPhysics = any, TNav = any, TAudio = any> {
  entityId: string;
  render?: TRender;
  physics?: TPhysics;
  navigation?: TNav;
  audio?: TAudio;
}

/**
 * MultiProjectionCoordinator coordinates all projection domains across an authoritative entity ID.
 * REQ-RUNTIME-002
 */
export class MultiProjectionCoordinator<TRender = any, TPhysics = any, TNav = any, TAudio = any> {
  public readonly render = new ProjectionRegistry<TRender>();
  public readonly physics = new ProjectionRegistry<TPhysics>();
  public readonly navigation = new ProjectionRegistry<TNav>();
  public readonly audio = new ProjectionRegistry<TAudio>();

  /**
   * Correlates all projection instances for a given entity ID.
   */
  public correlate(entityId: string): EntityProjections<TRender, TPhysics, TNav, TAudio> {
    return {
      entityId,
      render: this.render.get(entityId),
      physics: this.physics.get(entityId),
      navigation: this.navigation.get(entityId),
      audio: this.audio.get(entityId),
    };
  }

  /**
   * Unregisters all projections for an entity (e.g. on despawn).
   */
  public unregisterAll(entityId: string): EntityProjections<TRender, TPhysics, TNav, TAudio> {
    const render = this.render.unregister(entityId);
    const physics = this.physics.unregister(entityId);
    const navigation = this.navigation.unregister(entityId);
    const audio = this.audio.unregister(entityId);

    return {
      entityId,
      render,
      physics,
      navigation,
      audio,
    };
  }

  /**
   * Clears all projection registries.
   */
  public clear(): void {
    this.render.clear();
    this.physics.clear();
    this.navigation.clear();
    this.audio.clear();
  }
}
