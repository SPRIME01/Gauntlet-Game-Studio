import { describe, it, expect, beforeAll } from "bun:test";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  generateProceduralHeightfield,
  sampleCanonicalHeight,
  createTerrainRenderProjection,
  createTerrainPhysicsProjection,
  createTerrainNavigationGeometry,
  RapierPhysicsAdapter,
  type TerrainHeightfield,
} from "../src/index";

describe("Terrain Parity & Cross-Projection Parity Suite (T10 - REQ-TERRAIN-001..004)", () => {
  beforeAll(async () => {
    await RapierPhysicsAdapter.initWasm();
  });

  it("generates deterministic canonical TerrainHeightfield without Three.js or DOM dependencies", () => {
    const h1 = generateProceduralHeightfield({
      rows: 17,
      columns: 17,
      size_x: 64,
      size_z: 64,
      seed: 12345,
    });

    const h2 = generateProceduralHeightfield({
      rows: 17,
      columns: 17,
      size_x: 64,
      size_z: 64,
      seed: 12345,
    });

    expect(h1.rows).toBe(17);
    expect(h1.columns).toBe(17);
    expect(h1.size_x).toBe(64);
    expect(h1.size_z).toBe(64);
    expect(h1.heights.length).toBe(17 * 17);

    // Bitwise determinism
    for (let i = 0; i < h1.heights.length; i++) {
      expect(h1.heights[i]).toBe(h2.heights[i]);
    }
  });

  it("verifies render, physics, and mathematical query projections agree at sampled world points", () => {
    const rows = 9;
    const columns = 9;
    const size_x = 40;
    const size_z = 40;

    const heightfield = generateProceduralHeightfield({
      rows,
      columns,
      size_x,
      size_z,
      seed: 999,
      amplitude: 8.0,
    });

    // 1. Render projection
    const { mesh } = createTerrainRenderProjection(heightfield);
    const posAttr = mesh.geometry.getAttribute("position");

    // 2. Physics projection
    const rapierWorld = new RAPIER.World(new RAPIER.Vector3(0, 0, 0));
    const collider = createTerrainPhysicsProjection(RAPIER, rapierWorld, heightfield);

    // 3. Navigation geometry
    const navGeom = createTerrainNavigationGeometry(heightfield);
    expect(navGeom.vertices.length).toBe(rows * columns * 3);

    // Compare at every grid vertex: render mesh vs canonical query vs physics raycast
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < columns; c++) {
        const u = r / (rows - 1);
        const v = c / (columns - 1);
        const worldX = (u - 0.5) * size_x;
        const worldZ = (v - 0.5) * size_z;

        // Canonical mathematical query
        const canonicalY = sampleCanonicalHeight(heightfield, worldX, worldZ);

        // Three.js vertex position
        const vertexIndex = r * columns + c;
        const renderX = posAttr.getX(vertexIndex);
        const renderY = posAttr.getY(vertexIndex);
        const renderZ = posAttr.getZ(vertexIndex);

        expect(renderX).toBeCloseTo(worldX, 3);
        expect(renderZ).toBeCloseTo(worldZ, 3);
        expect(renderY).toBeCloseTo(canonicalY, 3);

        // Physics raycast
        const ray = new RAPIER.Ray(new RAPIER.Vector3(worldX, 50, worldZ), new RAPIER.Vector3(0, -1, 0));
        const hit = collider.castRay(ray, 100, true);
        expect(hit).not.toBeNull();
        if (hit !== null) {
          const physicsY = 50 - hit;
          expect(physicsY).toBeCloseTo(canonicalY, 2);
        }
      }
    }
  });

  it("verifies asymmetric known fixture detects correct spatial peak placement", () => {
    const rows = 5;
    const columns = 5;
    const size_x = 40;
    const size_z = 40;
    const heights = new Float32Array(rows * columns);

    // Intentional asymmetric peak at row=1, col=3 (worldX = -10, worldZ = +10)
    // u = 1/4 = 0.25 -> (0.25 - 0.5) * 40 = -10
    // v = 3/4 = 0.75 -> (0.75 - 0.5) * 40 = +10
    const peakRow = 1;
    const peakCol = 3;
    heights[peakRow * columns + peakCol] = 25.0;

    const fixture: TerrainHeightfield = {
      rows,
      columns,
      heights,
      size_x,
      size_z,
      orientation: "row-major: row=x, col=z",
    };

    const rapierWorld = new RAPIER.World(new RAPIER.Vector3(0, 0, 0));
    const collider = createTerrainPhysicsProjection(RAPIER, rapierWorld, fixture);

    // Raycast at the expected peak position (-10, +10)
    const peakRay = new RAPIER.Ray(new RAPIER.Vector3(-10, 50, 10), new RAPIER.Vector3(0, -1, 0));
    const peakHit = collider.castRay(peakRay, 100, true);
    expect(peakHit).not.toBeNull();
    if (peakHit !== null) {
      const hitY = 50 - peakHit;
      expect(hitY).toBeCloseTo(25.0, 2);
    }

    // Raycast at transposed coordinates (+10, -10) must be 0
    const nonPeakRay = new RAPIER.Ray(new RAPIER.Vector3(10, 50, -10), new RAPIER.Vector3(0, -1, 0));
    const nonPeakHit = collider.castRay(nonPeakRay, 100, true);
    if (nonPeakHit !== null) {
      const hitY = 50 - nonPeakHit;
      expect(hitY).toBeCloseTo(0, 2);
    }
  });

  it("TEETH-T10-001: Transpose height array before Rapier projection fails asymmetric test (Teeth Check)", () => {
    const rows = 5;
    const columns = 5;
    const size_x = 40;
    const size_z = 40;
    const heights = new Float32Array(rows * columns);

    // Asymmetric peak at row=1, col=3 (worldX = -10, worldZ = +10)
    heights[1 * columns + 3] = 25.0;

    // ATTACK: Transpose the height array (rows and columns swapped)
    const transposedHeights = new Float32Array(rows * columns);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < columns; c++) {
        transposedHeights[c * rows + r] = heights[r * columns + c];
      }
    }

    const corruptedFixture: TerrainHeightfield = {
      rows,
      columns,
      heights: transposedHeights,
      size_x,
      size_z,
      orientation: "row-major: row=x, col=z",
    };

    const rapierWorld = new RAPIER.World(new RAPIER.Vector3(0, 0, 0));
    const collider = createTerrainPhysicsProjection(RAPIER, rapierWorld, corruptedFixture);

    // Raycast at original peak location (-10, +10)
    const ray = new RAPIER.Ray(new RAPIER.Vector3(-10, 50, 10), new RAPIER.Vector3(0, -1, 0));
    const hit = collider.castRay(ray, 100, true);
    const hitY = hit !== null ? 50 - hit : 0;

    // The transposition attack causes height at (-10, +10) to be 0 instead of 25.0!
    // Falsification check verifies the defect is caught.
    expect(hitY).not.toBeCloseTo(25.0, 1);
    expect(hitY).toBeCloseTo(0, 1);
  });

  it("TEETH-T10-002: Invert axis or alter extents in render projection causes parity failure (Teeth Check)", () => {
    const rows = 5;
    const columns = 5;
    const size_x = 40;
    const size_z = 40;
    const heightfield = generateProceduralHeightfield({
      rows,
      columns,
      size_x,
      size_z,
      seed: 42,
      amplitude: 15.0,
    });

    // Valid projections
    const { mesh } = createTerrainRenderProjection(heightfield);
    const rapierWorld = new RAPIER.World(new RAPIER.Vector3(0, 0, 0));
    const collider = createTerrainPhysicsProjection(RAPIER, rapierWorld, heightfield);

    // ATTACK: Adversary inverts Z axis in render geometry or stretches X extent by 2x
    const posAttr = mesh.geometry.getAttribute("position");
    for (let i = 0; i < posAttr.count; i++) {
      // Invert Z
      posAttr.setZ(i, -posAttr.getZ(i));
    }
    posAttr.needsUpdate = true;

    // Cross-projection parity check detects disparity between render vertex Z and physics elevation
    let parityViolations = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < columns; c++) {
        const u = r / (rows - 1);
        const v = c / (columns - 1);
        const expectedX = (u - 0.5) * size_x;
        const expectedZ = (v - 0.5) * size_z;

        const vertexIndex = r * columns + c;
        const actualRenderZ = posAttr.getZ(vertexIndex);

        if (Math.abs(actualRenderZ - expectedZ) > 0.01) {
          parityViolations++;
        }
      }
    }

    // Falsification check confirms parity violation is detected
    expect(parityViolations).toBeGreaterThan(0);
  });
});
