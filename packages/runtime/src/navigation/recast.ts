import {
  init as initRecast,
  NavMesh,
  NavMeshQuery,
  Crowd,
  type Vector3,
  type CrowdAgent,
  type CrowdAgentParams,
} from "recast-navigation";
import { generateSoloNavMesh } from "recast-navigation/generators";
import type * as THREE from "three";
import type { TerrainNavigationGeometry } from "../terrain/projections";
import { SubsystemBarrier } from "../readiness";
import { ProjectionRegistry } from "../projections/registry";
import type { SpatialQueryAccelerator } from "../spatial/bvh";

export interface NavMeshConfig {
  cs?: number; // Cell size (voxel width)
  ch?: number; // Cell height (voxel height)
  walkableSlopeAngle?: number; // Max slope in degrees
  walkableHeight?: number; // Agent height
  walkableClimb?: number; // Max step height
  walkableRadius?: number; // Agent radius
  maxEdgeLen?: number;
  maxSimplificationError?: number;
}

export interface PathResult {
  success: boolean;
  path: Array<{ x: number; y: number; z: number }>;
}

export interface NavigationDiagnostics {
  initialized: boolean;
  hasNavMesh: boolean;
  agentCount: number;
  config: NavMeshConfig;
  version: string;
}

export interface PathVerificationResult {
  valid: boolean;
  blockedSegment?: number;
  hit?: THREE.Intersection;
}

/**
 * RecastNavigationAdapter provides deterministic pathfinding, crowd simulation,
 * and navmesh queries over accepted world geometry.
 * Implements REQ-BIND-003.
 * 
 * Invariants:
 * 1. NavMesh data is an execution projection, not authoritative gameplay state.
 * 2. Path queries are deterministic for identical navmesh and start/end coordinates.
 */
export class RecastNavigationAdapter {
  private static initialized = false;
  public navMesh?: NavMesh;
  public navQuery?: NavMeshQuery;
  public crowd?: Crowd;
  private readonly agentRegistry = new ProjectionRegistry<CrowdAgent>();
  private config: NavMeshConfig = {
    cs: 0.2,
    ch: 0.2,
    walkableSlopeAngle: 45,
    walkableHeight: 2.0,
    walkableClimb: 0.5,
    walkableRadius: 0.5,
  };
  private sourceRevision = 0;

  /**
   * Initializes Recast WASM runtime and integrates with SubsystemBarrier.
   */
  public static async bootSubsystem(barrier: SubsystemBarrier): Promise<void> {
    barrier.register("navigation", true);
    barrier.markBooting("navigation");
    const t0 = performance.now();
    try {
      await RecastNavigationAdapter.initWasm();
      barrier.markReady("navigation", performance.now() - t0);
    } catch (err: any) {
      barrier.markFailed("navigation", err.message ?? String(err));
      throw err;
    }
  }

  /**
   * Initializes Recast WASM runtime.
   */
  public static async initWasm(): Promise<void> {
    if (!RecastNavigationAdapter.initialized) {
      await initRecast();
      RecastNavigationAdapter.initialized = true;
    }
  }

  /**
   * Builds a NavMesh from terrain navigation geometry.
   */
  public buildNavMeshFromTerrain(
    terrainGeometry: TerrainNavigationGeometry,
    config: NavMeshConfig = {}
  ): boolean {
    return this.buildNavMesh(terrainGeometry.vertices, terrainGeometry.indices, config);
  }

  /**
   * Builds a NavMesh directly from positions and indices.
   */
  public buildNavMesh(
    positions: Float32Array,
    indices: Uint32Array,
    config: NavMeshConfig = {}
  ): boolean {
    this.config = { ...this.config, ...config };

    if (this.navQuery) {
      this.navQuery.destroy();
      this.navQuery = undefined;
    }
    if (this.crowd) {
      this.crowd.destroy();
      this.crowd = undefined;
    }
    if (this.navMesh) {
      this.navMesh.destroy();
      this.navMesh = undefined;
    }

    // In recast-navigation-js, generateSoloNavMesh expects numVertices == indices.length.
    // When input geometry is indexed (positions.length / 3 !== indices.length),
    // unroll the indexed geometry into unindexed triangles.
    let buildPositions = positions;
    let buildIndices = indices;

    if (positions.length / 3 !== indices.length) {
      const unindexed = new Float32Array(indices.length * 3);
      const unindexedIdx = new Uint32Array(indices.length);
      for (let i = 0; i < indices.length; i++) {
        const src = indices[i] * 3;
        const dst = i * 3;
        unindexed[dst] = positions[src];
        unindexed[dst + 1] = positions[src + 1];
        unindexed[dst + 2] = positions[src + 2];
        unindexedIdx[i] = i;
      }
      buildPositions = unindexed;
      buildIndices = unindexedIdx;
    }

    const result = generateSoloNavMesh(buildPositions, buildIndices, this.config);
    if (!result.success || !result.navMesh) {
      return false;
    }

    this.navMesh = result.navMesh;
    this.navQuery = new NavMeshQuery(this.navMesh);
    this.sourceRevision++;
    return true;
  }

  /**
   * Computes a deterministic path between start and end coordinates.
   */
  public computePath(
    start: { x: number; y: number; z: number },
    end: { x: number; y: number; z: number }
  ): PathResult {
    if (!this.navQuery) {
      return { success: false, path: [] };
    }

    const result = this.navQuery.computePath(start, end);
    if (!result.success || !result.path) {
      return { success: false, path: [] };
    }

    return {
      success: true,
      path: result.path.map((pt) => ({ x: pt.x, y: pt.y, z: pt.z })),
    };
  }

  /**
   * Checks if a point is on or close to the walkable navmesh.
   */
  public isPointWalkable(
    point: { x: number; y: number; z: number },
    searchHalfExtents = { x: 1, y: 2, z: 1 }
  ): boolean {
    if (!this.navQuery) return false;

    const closest = this.navQuery.findClosestPoint(point, {
      halfExtents: searchHalfExtents,
    });
    return !!closest.success && closest.polyRef > 0;
  }

  /**
   * Initializes a Crowd instance for local avoidance and agent steering.
   */
  public initCrowd(maxAgents = 128, maxAgentRadius = 1.0): Crowd {
    if (!this.navMesh) {
      throw new Error("Cannot initialize crowd before NavMesh is built");
    }
    if (this.crowd) {
      this.crowd.destroy();
    }
    this.crowd = new Crowd(this.navMesh, {
      maxAgents,
      maxAgentRadius,
    });
    return this.crowd;
  }

  /**
   * Steps the crowd simulation forward.
   */
  public stepCrowd(dt: number): void {
    if (this.crowd) {
      this.crowd.update(dt);
    }
  }

  /**
   * Registers and spawns a crowd agent for an authoritative entity ID.
   */
  public addAgentForEntity(
    entityId: string,
    position: { x: number; y: number; z: number },
    params: Partial<CrowdAgentParams> = {}
  ): CrowdAgent {
    if (!this.crowd) {
      throw new Error("Cannot add agent before crowd is initialized");
    }
    const defaultParams: CrowdAgentParams = {
      radius: this.config.walkableRadius ?? 0.5,
      height: this.config.walkableHeight ?? 2.0,
      maxAcceleration: 8.0,
      maxSpeed: 3.5,
      collisionQueryRange: 2.5,
      pathOptimizationRange: 15.0,
      separationWeight: 2.0,
      updateFlags: 7,
      obstacleAvoidanceType: 0,
      queryFilterType: 0,
      userData: entityId,
      ...params,
    };
    const agent = this.crowd.addAgent(position, defaultParams);
    const handleId = `nav-agent-${entityId}`;
    this.agentRegistry.register(entityId, handleId, agent);
    return agent;
  }

  /**
   * Retrieves the crowd agent projection for an authoritative entity ID.
   */
  public getAgentForEntity(entityId: string): CrowdAgent | undefined {
    return this.agentRegistry.get(entityId);
  }

  /**
   * Removes a crowd agent projection for an entity.
   */
  public removeAgentForEntity(entityId: string): boolean {
    const agent = this.agentRegistry.get(entityId);
    if (!agent) return false;
    if (this.crowd) {
      this.crowd.removeAgent(agent);
    }
    this.agentRegistry.unregister(entityId);
    return true;
  }

  /**
   * Returns the agent projection registry.
   */
  public getAgentRegistry(): ProjectionRegistry<CrowdAgent> {
    return this.agentRegistry;
  }

  /**
   * Verifies a navigation corridor/path against fresh obstacle meshes.
   * If an obstacle has blocked the corridor since navmesh generation,
   * detects stale/invalid traversal state without mutating semantic state.
   */
  public verifyPathAgainstObstacles(
    path: Array<{ x: number; y: number; z: number }>,
    spatial: SpatialQueryAccelerator,
    obstacles: THREE.Mesh[],
    elevationOffset = 0.5
  ): PathVerificationResult {
    if (path.length < 2) {
      return { valid: true };
    }
    for (let i = 0; i < path.length - 1; i++) {
      const from: [number, number, number] = [
        path[i].x,
        path[i].y + elevationOffset,
        path[i].z,
      ];
      const to: [number, number, number] = [
        path[i + 1].x,
        path[i + 1].y + elevationOffset,
        path[i + 1].z,
      ];
      const los = spatial.checkLineOfSight(from, to, obstacles);
      if (!los.clear) {
        return {
          valid: false,
          blockedSegment: i,
          hit: los.obstruction,
        };
      }
    }
    return { valid: true };
  }

  /**
   * Returns current source revision counter.
   */
  public getSourceRevision(): number {
    return this.sourceRevision;
  }

  /**
   * Returns diagnostics for observability bridge.
   */
  public getDiagnostics(): NavigationDiagnostics {
    return {
      initialized: RecastNavigationAdapter.initialized,
      hasNavMesh: !!this.navMesh,
      agentCount: this.crowd ? this.crowd.getActiveAgentCount() : 0,
      config: { ...this.config },
      version: "0.43.1",
    };
  }

  /**
   * Cleans up unmanaged WASM resources.
   */
  public dispose(): void {
    if (this.crowd) {
      this.crowd.destroy();
      this.crowd = undefined;
    }
    if (this.navQuery) {
      this.navQuery.destroy();
      this.navQuery = undefined;
    }
    if (this.navMesh) {
      this.navMesh.destroy();
      this.navMesh = undefined;
    }
  }
}
