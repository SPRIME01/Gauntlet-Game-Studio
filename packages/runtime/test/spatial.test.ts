import { describe, it, expect, beforeEach } from "bun:test";
import * as THREE from "three";
import { SpatialQueryAccelerator } from "../src/spatial/bvh";
import { generateProceduralHeightfield } from "../src/terrain/heightfield";
import { createTerrainRenderProjection } from "../src/terrain/projections";

describe("SpatialQueryAccelerator (T11 / REQ-BIND-004)", () => {
  let spatial: SpatialQueryAccelerator;

  beforeEach(() => {
    spatial = new SpatialQueryAccelerator();
  });

  it("initializes with zero queries and empty diagnostics", () => {
    const diag = spatial.getDiagnostics();
    expect(diag.acceleratedQueries).toBe(0);
    expect(diag.fallbackQueries).toBe(0);
    expect(diag.indexedMeshes).toBe(0);
  });

  it("builds and binds MeshBVH to geometry", () => {
    const geometry = new THREE.BoxGeometry(2, 2, 2);
    const bvh = spatial.buildBVH(geometry);

    expect(bvh).toBeDefined();
    expect((geometry as any).boundsTree).toBe(bvh);
  });

  it("performs accelerated raycast against indexed mesh", () => {
    const geometry = new THREE.BoxGeometry(2, 2, 2);
    spatial.buildBVH(geometry);
    const material = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(0, 0, 0);
    mesh.updateMatrixWorld(true);

    const raycaster = new THREE.Raycaster(
      new THREE.Vector3(0, 10, 0),
      new THREE.Vector3(0, -1, 0),
      0.1,
      100
    );

    const hits = spatial.raycast(mesh, raycaster, true);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].distance).toBeCloseTo(9.0, 4); // Box top is at y = 1.0; 10 - 1 = 9
    expect(hits[0].point.y).toBeCloseTo(1.0, 4);

    const diag = spatial.getDiagnostics();
    expect(diag.acceleratedQueries).toBe(1);
    expect(diag.fallbackQueries).toBe(0);
  });

  it("detects line of sight obstruction", () => {
    const obstacleGeometry = new THREE.BoxGeometry(2, 4, 2);
    spatial.buildBVH(obstacleGeometry);
    const obstacle = new THREE.Mesh(obstacleGeometry, new THREE.MeshBasicMaterial());
    obstacle.position.set(0, 0, 0);
    obstacle.updateMatrixWorld(true);

    // Test 1: Clear line of sight (points above obstacle)
    const clearLos = spatial.checkLineOfSight([-5, 5, 0], [5, 5, 0], [obstacle]);
    expect(clearLos.clear).toBe(true);
    expect(clearLos.distance).toBeCloseTo(10, 4);
    expect(clearLos.obstruction).toBeUndefined();

    // Test 2: Blocked line of sight (passing through obstacle center)
    const blockedLos = spatial.checkLineOfSight([-5, 0, 0], [5, 0, 0], [obstacle]);
    expect(blockedLos.clear).toBe(false);
    expect(blockedLos.distance).toBeCloseTo(4.0, 4); // From x = -5 to box face at x = -1 -> distance = 4
    expect(blockedLos.obstruction).toBeDefined();
  });

  it("TEETH-T11-002: verifies strict fallback parity when BVH acceleration is disabled or bypassed", () => {
    // Construct representative non-trivial terrain geometry
    const heightfield = generateProceduralHeightfield({
      rows: 16,
      columns: 16,
      size_x: 32,
      size_z: 32,
      seed: 42,
      amplitude: 2.0,
    });
    const { mesh, geometry } = createTerrainRenderProjection(heightfield);
    spatial.buildBVH(geometry);
    mesh.updateMatrixWorld(true);

    // Test a grid of probe rays across the terrain surface
    const probeRayOrigins: [number, number, number][] = [
      [0, 20, 0],
      [-10, 20, -10],
      [10, 20, 10],
      [-5, 20, 8],
      [7, 20, -6],
      [12, 20, -12],
    ];

    spatial.resetCounters();

    for (const origin of probeRayOrigins) {
      const rayOrigin = new THREE.Vector3(...origin);
      const rayDir = new THREE.Vector3(0.05, -1, 0.05).normalize();

      const raycasterAccel = new THREE.Raycaster(rayOrigin, rayDir, 0.1, 100);
      const raycasterFallback = new THREE.Raycaster(rayOrigin, rayDir, 0.1, 100);

      // Accelerated query
      const hitsAccel = spatial.raycast(mesh, raycasterAccel, true);

      // Unaccelerated fallback query
      const hitsFallback = spatial.raycast(mesh, raycasterFallback, false);

      // Parity assertions:
      expect(hitsAccel.length).toBe(hitsFallback.length);
      if (hitsAccel.length > 0) {
        expect(hitsAccel[0].distance).toBeCloseTo(hitsFallback[0].distance, 5);
        expect(hitsAccel[0].point.x).toBeCloseTo(hitsFallback[0].point.x, 5);
        expect(hitsAccel[0].point.y).toBeCloseTo(hitsFallback[0].point.y, 5);
        expect(hitsAccel[0].point.z).toBeCloseTo(hitsFallback[0].point.z, 5);
      }
    }

    const diag = spatial.getDiagnostics();
    expect(diag.acceleratedQueries).toBe(probeRayOrigins.length);
    expect(diag.fallbackQueries).toBe(probeRayOrigins.length);
  });
});
