import { describe, it, expect, beforeAll } from "bun:test";
import * as THREE from "three";
import { RecastNavigationAdapter } from "../src/navigation/recast";
import { SpatialQueryAccelerator } from "../src/spatial/bvh";
import { SubsystemBarrier } from "../src/readiness";
import { generateProceduralHeightfield } from "../src/terrain/heightfield";
import { createTerrainNavigationGeometry } from "../src/terrain/projections";

describe("RecastNavigationAdapter (T11 / REQ-BIND-003)", () => {
  beforeAll(async () => {
    await RecastNavigationAdapter.initWasm();
  });

  it("integrates with SubsystemBarrier to signal readiness", async () => {
    const barrier = new SubsystemBarrier();
    await RecastNavigationAdapter.bootSubsystem(barrier);

    const readiness = barrier.getReadiness();
    expect(readiness.state).toBe("ready");
    expect(readiness.subsystem_states.navigation).toBe("ready");
  });

  it("generates NavMesh from canonical terrain navigation geometry", () => {
    const heightfield = generateProceduralHeightfield({
      rows: 16,
      columns: 16,
      size_x: 30,
      size_z: 30,
      amplitude: 0.0, // Flat terrain for clear navigation bounds
    });

    const terrainGeo = createTerrainNavigationGeometry(heightfield);
    const adapter = new RecastNavigationAdapter();

    const success = adapter.buildNavMeshFromTerrain(terrainGeo, {
      cs: 0.2,
      ch: 0.2,
      walkableSlopeAngle: 45,
    });

    expect(success).toBe(true);
    expect(adapter.navMesh).toBeDefined();
    expect(adapter.navQuery).toBeDefined();
    expect(adapter.getSourceRevision()).toBe(1);

    const diag = adapter.getDiagnostics();
    expect(diag.initialized).toBe(true);
    expect(diag.hasNavMesh).toBe(true);

    adapter.dispose();
  });

  it("computes deterministic paths across traversable terrain", () => {
    const heightfield = generateProceduralHeightfield({
      rows: 16,
      columns: 16,
      size_x: 30,
      size_z: 30,
      amplitude: 0.0,
    });
    const terrainGeo = createTerrainNavigationGeometry(heightfield);
    const adapter = new RecastNavigationAdapter();
    adapter.buildNavMeshFromTerrain(terrainGeo);

    const start = { x: -10, y: 0, z: -10 };
    const end = { x: 10, y: 0, z: 10 };

    const result1 = adapter.computePath(start, end);
    const result2 = adapter.computePath(start, end);

    expect(result1.success).toBe(true);
    expect(result1.path.length).toBeGreaterThan(1);

    // Invariant: Path queries are deterministic for identical input
    expect(result1.path).toEqual(result2.path);

    // Endpoint reached within close tolerance
    const lastPoint = result1.path[result1.path.length - 1];
    expect(lastPoint.x).toBeCloseTo(end.x, 0.5);
    expect(lastPoint.z).toBeCloseTo(end.z, 0.5);

    adapter.dispose();
  });

  it("identifies walkable vs unwalkable coordinates", () => {
    const heightfield = generateProceduralHeightfield({
      rows: 16,
      columns: 16,
      size_x: 30,
      size_z: 30,
      amplitude: 0.0,
    });
    const terrainGeo = createTerrainNavigationGeometry(heightfield);
    const adapter = new RecastNavigationAdapter();
    adapter.buildNavMeshFromTerrain(terrainGeo);

    expect(adapter.isPointWalkable({ x: 0, y: 0, z: 0 })).toBe(true);
    expect(adapter.isPointWalkable({ x: 5, y: 0, z: -5 })).toBe(true);

    // Far outside world boundaries
    expect(adapter.isPointWalkable({ x: 100, y: 0, z: 100 })).toBe(false);

    adapter.dispose();
  });

  it("manages crowd agent projections correlated with authoritative entity IDs", () => {
    const heightfield = generateProceduralHeightfield({
      rows: 16,
      columns: 16,
      size_x: 30,
      size_z: 30,
      amplitude: 0.0,
    });
    const terrainGeo = createTerrainNavigationGeometry(heightfield);
    const adapter = new RecastNavigationAdapter();
    adapter.buildNavMeshFromTerrain(terrainGeo);
    adapter.initCrowd(32, 1.0);

    const entityId = "npc-sentinel-42";
    const spawnPos = { x: 0, y: 0, z: 0 };
    const agent = adapter.addAgentForEntity(entityId, spawnPos, {
      maxSpeed: 4.0,
    });

    expect(agent).toBeDefined();
    expect(adapter.getAgentForEntity(entityId)).toBe(agent);
    expect(adapter.getDiagnostics().agentCount).toBe(1);

    // Test steering target request and simulation step
    agent.requestMoveTarget({ x: 5, y: 0, z: 5 });
    adapter.stepCrowd(0.1);

    // Entity registry retains agent reference
    const registry = adapter.getAgentRegistry();
    expect(registry.has(entityId)).toBe(true);
    expect(registry.getEntityId(`nav-agent-${entityId}`)).toBe(entityId);

    // Remove agent
    const removed = adapter.removeAgentForEntity(entityId);
    expect(removed).toBe(true);
    expect(adapter.getAgentForEntity(entityId)).toBeUndefined();
    expect(adapter.getDiagnostics().agentCount).toBe(0);

    adapter.dispose();
  });

  it("TEETH-T11-001: detects stale traversal state when a corridor is blocked without navmesh update", () => {
    const heightfield = generateProceduralHeightfield({
      rows: 16,
      columns: 16,
      size_x: 30,
      size_z: 30,
      amplitude: 0.0,
    });
    const terrainGeo = createTerrainNavigationGeometry(heightfield);
    const adapter = new RecastNavigationAdapter();
    adapter.buildNavMeshFromTerrain(terrainGeo);

    const start = { x: -8, y: 0, z: 0 };
    const end = { x: 8, y: 0, z: 0 };

    // Initially, corridor is open and traversable in navmesh
    const initialPath = adapter.computePath(start, end);
    expect(initialPath.success).toBe(true);
    expect(initialPath.path.length).toBeGreaterThan(1);

    const spatial = new SpatialQueryAccelerator();

    // Verify initial corridor traversal with no obstacles
    const clearVerification = adapter.verifyPathAgainstObstacles(
      initialPath.path,
      spatial,
      []
    );
    expect(clearVerification.valid).toBe(true);

    // ATTACK: An obstacle (e.g. wall/barricade) blocks the corridor in the world,
    // but the navigation source / navmesh has NOT been regenerated.
    const obstacleGeometry = new THREE.BoxGeometry(2, 4, 10);
    spatial.buildBVH(obstacleGeometry);
    const obstacleMesh = new THREE.Mesh(obstacleGeometry, new THREE.MeshBasicMaterial());
    obstacleMesh.position.set(0, 1, 0); // Directly straddling x = 0 corridor
    obstacleMesh.updateMatrixWorld(true);

    // Fresh verification detects stale/incorrect traversal state along the cached path!
    const staleVerification = adapter.verifyPathAgainstObstacles(
      initialPath.path,
      spatial,
      [obstacleMesh]
    );

    expect(staleVerification.valid).toBe(false);
    expect(staleVerification.blockedSegment).toBeDefined();
    expect(staleVerification.hit).toBeDefined();
    expect(staleVerification.hit?.distance).toBeLessThan(10);

    adapter.dispose();
  });
});
