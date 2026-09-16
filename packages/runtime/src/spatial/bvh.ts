import * as THREE from "three";
import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";

export interface LineOfSightResult {
  clear: boolean;
  distance: number;
  obstruction?: THREE.Intersection;
}

export interface SpatialDiagnostics {
  acceleratedQueries: number;
  fallbackQueries: number;
  indexedMeshes: number;
}

/**
 * SpatialQueryAccelerator provides accelerated raycasting and line-of-sight queries
 * using three-mesh-bvh with strict fallback parity to standard geometric raycasting.
 * Implements REQ-BIND-004.
 */
export class SpatialQueryAccelerator {
  private acceleratedCount = 0;
  private fallbackCount = 0;
  private readonly indexedGeometries = new WeakSet<THREE.BufferGeometry>();

  /**
   * Builds and attaches a MeshBVH bounding volume hierarchy to a geometry.
   */
  public buildBVH(geometry: THREE.BufferGeometry): MeshBVH {
    const bvh = new MeshBVH(geometry);
    (geometry as any).boundsTree = bvh;
    this.indexedGeometries.add(geometry);
    return bvh;
  }

  /**
   * Raycasts against a mesh with optional three-mesh-bvh acceleration.
   * If useAcceleration is false or BVH is absent, cleanly falls back to standard Three.js raycast.
   */
  public raycast(
    mesh: THREE.Mesh,
    raycaster: THREE.Raycaster,
    useAcceleration = true
  ): THREE.Intersection[] {
    const geometry = mesh.geometry;
    const hasBVH = !!(geometry as any).boundsTree;
    const intersects: THREE.Intersection[] = [];

    if (useAcceleration && hasBVH) {
      this.acceleratedCount++;
      // Execute accelerated raycast through three-mesh-bvh
      acceleratedRaycast.call(mesh, raycaster, intersects);
    } else {
      this.fallbackCount++;
      // Execute standard unaccelerated Three.js raycast fallback
      THREE.Mesh.prototype.raycast.call(mesh, raycaster, intersects);
    }

    // Sort by distance ascending
    intersects.sort((a, b) => a.distance - b.distance);
    return intersects;
  }

  /**
   * Raycasts against a collection of meshes and returns the closest intersection.
   */
  public raycastClosest(
    meshes: THREE.Mesh[],
    raycaster: THREE.Raycaster,
    useAcceleration = true
  ): THREE.Intersection | null {
    let closest: THREE.Intersection | null = null;

    for (const mesh of meshes) {
      const hits = this.raycast(mesh, raycaster, useAcceleration);
      if (hits.length > 0) {
        const hit = hits[0];
        if (!closest || hit.distance < closest.distance) {
          closest = hit;
        }
      }
    }

    return closest;
  }

  /**
   * Tests line of sight between two 3D points against an array of obstacle meshes.
   */
  public checkLineOfSight(
    from: [number, number, number],
    to: [number, number, number],
    obstacles: THREE.Mesh[],
    useAcceleration = true,
    epsilon = 0.05
  ): LineOfSightResult {
    const startVec = new THREE.Vector3(from[0], from[1], from[2]);
    const endVec = new THREE.Vector3(to[0], to[1], to[2]);

    const dir = new THREE.Vector3().subVectors(endVec, startVec);
    const targetDistance = dir.length();

    if (targetDistance <= epsilon) {
      return { clear: true, distance: 0 };
    }

    dir.normalize();
    const raycaster = new THREE.Raycaster(startVec, dir, epsilon, targetDistance - epsilon);

    const hit = this.raycastClosest(obstacles, raycaster, useAcceleration);

    if (hit && hit.distance < targetDistance - epsilon) {
      return {
        clear: false,
        distance: hit.distance,
        obstruction: hit,
      };
    }

    return {
      clear: true,
      distance: targetDistance,
    };
  }

  /**
   * Returns spatial diagnostics for the observability bridge.
   */
  public getDiagnostics(): SpatialDiagnostics {
    return {
      acceleratedQueries: this.acceleratedCount,
      fallbackQueries: this.fallbackCount,
      indexedMeshes: this.acceleratedCount + this.fallbackCount,
    };
  }

  /**
   * Resets query counters.
   */
  public resetCounters(): void {
    this.acceleratedCount = 0;
    this.fallbackCount = 0;
  }
}
