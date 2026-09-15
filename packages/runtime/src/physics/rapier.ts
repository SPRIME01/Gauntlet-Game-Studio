import RAPIER from "@dimforge/rapier3d-compat";
import { SinglePhysicsStepInvariantError } from "../errors";
import type { TerrainHeightfield } from "@gauntlet/contracts";
import { createTerrainPhysicsProjection } from "../terrain/projections";

export interface PhysicsWorldOptions {
  gravity?: { x: number; y: number; z: number };
}

export interface RaycastHitResult {
  hitPoint: [number, number, number];
  normal: [number, number, number];
  timeOfImpact: number;
  colliderHandle: number;
}

/**
 * RapierPhysicsAdapter wraps Rapier physics with singular step ownership per tick.
 * Implements REQ-BIND-015, REQ-RUNTIME-006.
 */
export class RapierPhysicsAdapter {
  private static initialized = false;
  public readonly rapier: typeof RAPIER;
  public world!: RAPIER.World;
  private lastSteppedTick: number = -1;
  private currentStepOwner: string | null = null;

  constructor(rapier: typeof RAPIER = RAPIER) {
    this.rapier = rapier;
  }

  /**
   * Asynchronously initializes the Rapier WASM backend.
   * Suitable for SubsystemBarrier integration.
   */
  public static async initWasm(): Promise<void> {
    if (!RapierPhysicsAdapter.initialized) {
      await RAPIER.init();
      RapierPhysicsAdapter.initialized = true;
    }
  }

  /**
   * Initializes the physics world. Must be called after initWasm().
   */
  public initWorld(options: PhysicsWorldOptions = {}): void {
    const gx = options.gravity?.x ?? 0;
    const gy = options.gravity?.y ?? -9.81;
    const gz = options.gravity?.z ?? 0;
    this.world = new this.rapier.World(new this.rapier.Vector3(gx, gy, gz));
    this.lastSteppedTick = -1;
    this.currentStepOwner = null;
  }

  /**
   * Advances the physics simulation by dt with singular step ownership per authoritative tick.
   * REQ-RUNTIME-006: Exactly one Rapier step per authoritative tick; duplicate steps are strictly rejected.
   */
  public step(dt: number, tick: number, owner = "scheduler"): void {
    if (this.lastSteppedTick === tick) {
      throw new SinglePhysicsStepInvariantError(
        `Duplicate Rapier step attempted on tick ${tick} by '${owner}'. Previous step owner: '${this.currentStepOwner}'.`
      );
    }

    this.world.timestep = dt;
    this.world.step();
    this.lastSteppedTick = tick;
    this.currentStepOwner = owner;
  }

  /**
   * Creates a terrain heightfield collider derived directly from canonical TerrainHeightfield.
   */
  public createTerrainCollider(heightfield: TerrainHeightfield): RAPIER.Collider {
    if (!this.world) {
      throw new Error("Rapier world is not initialized");
    }
    return createTerrainPhysicsProjection(this.rapier, this.world, heightfield);
  }

  /**
   * Casts a ray against the physics world.
   */
  public castRay(
    origin: [number, number, number],
    direction: [number, number, number],
    maxDistance: number,
    solid = true
  ): RaycastHitResult | null {
    if (!this.world) return null;

    const rayOrigin = new this.rapier.Vector3(origin[0], origin[1], origin[2]);
    const rayDir = new this.rapier.Vector3(direction[0], direction[1], direction[2]);
    const ray = new this.rapier.Ray(rayOrigin, rayDir);

    const hit = this.world.castRayAndGetNormal(
      ray,
      maxDistance,
      solid,
      undefined,
      undefined,
      undefined,
      undefined
    );

    if (!hit) return null;

    const hitPoint = ray.pointAt(hit.timeOfImpact);
    return {
      hitPoint: [hitPoint.x, hitPoint.y, hitPoint.z],
      normal: [hit.normal.x, hit.normal.y, hit.normal.z],
      timeOfImpact: hit.timeOfImpact,
      colliderHandle: hit.collider.handle,
    };
  }

  /**
   * Extracts debug wireframe line buffers for rendering without polluting simulation truth.
   */
  public getDebugRenderBuffers(): { vertices: Float32Array; colors: Float32Array } {
    if (!this.world) {
      return { vertices: new Float32Array(0), colors: new Float32Array(0) };
    }
    const buffers = this.world.debugRender();
    return {
      vertices: buffers.vertices,
      colors: buffers.colors,
    };
  }

  public getLastSteppedTick(): number {
    return this.lastSteppedTick;
  }
}
