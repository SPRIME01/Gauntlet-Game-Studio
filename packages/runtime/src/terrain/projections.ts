import * as THREE from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import type { TerrainHeightfield } from "@gauntlet/contracts";

export interface TerrainMeshProjection {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
}

export interface TerrainNavigationGeometry {
  vertices: Float32Array;
  indices: Uint32Array;
}

/**
 * Builds Three.js render geometry derived directly from canonical TerrainHeightfield.
 * Implements REQ-TERRAIN-002, REQ-TERRAIN-004.
 */
export function createTerrainRenderProjection(
  heightfield: TerrainHeightfield
): TerrainMeshProjection {
  const { rows, columns, size_x, size_z, heights } = heightfield;
  const geometry = new THREE.BufferGeometry();

  const vertexCount = rows * columns;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  // Derive vertices directly from canonical heights
  for (let r = 0; r < rows; r++) {
    const u = r / (rows - 1);
    const x = (u - 0.5) * size_x;

    for (let c = 0; c < columns; c++) {
      const v = c / (columns - 1);
      const z = (v - 0.5) * size_z;

      const index = r * columns + c;
      const y = heights[index];

      const pIdx = index * 3;
      positions[pIdx] = x;
      positions[pIdx + 1] = y;
      positions[pIdx + 2] = z;

      const uvIdx = index * 2;
      uvs[uvIdx] = u;
      uvs[uvIdx + 1] = v;
    }
  }

  // Derive quad indices (2 triangles per cell)
  const quadCount = (rows - 1) * (columns - 1);
  const indices = new Uint32Array(quadCount * 6);
  let idxOffset = 0;

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < columns - 1; c++) {
      const i00 = r * columns + c;
      const i10 = (r + 1) * columns + c;
      const i01 = r * columns + (c + 1);
      const i11 = (r + 1) * columns + (c + 1);

      // First triangle
      indices[idxOffset++] = i00;
      indices[idxOffset++] = i10;
      indices[idxOffset++] = i01;

      // Second triangle
      indices[idxOffset++] = i01;
      indices[idxOffset++] = i10;
      indices[idxOffset++] = i11;
    }
  }

  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: 0x4a7c59,
    roughness: 0.8,
    metalness: 0.1,
    flatShading: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "TerrainRenderProjection";
  mesh.receiveShadow = true;
  mesh.castShadow = false;

  return { mesh, geometry };
}

/**
 * Creates Rapier heightfield collider derived directly from canonical TerrainHeightfield.
 * Implements REQ-TERRAIN-002, REQ-TERRAIN-004, REQ-BIND-015.
 */
export function createTerrainPhysicsProjection(
  rapier: typeof RAPIER,
  world: RAPIER.World,
  heightfield: TerrainHeightfield
): RAPIER.Collider {
  const { rows, columns, size_x, size_z, heights } = heightfield;

  const heightsArray = heights instanceof Float32Array ? heights : new Float32Array(heights);

  // Rapier takes (nrows, ncols) as number of subdivisions: (rows - 1, cols - 1)
  const nrows = rows - 1;
  const ncols = columns - 1;
  const scale = new rapier.Vector3(size_x, 1.0, size_z);

  const colliderDesc = rapier.ColliderDesc.heightfield(
    nrows,
    ncols,
    heightsArray,
    scale,
    0 as unknown as RAPIER.HeightFieldFlags
  );

  colliderDesc.setTranslation(0, 0, 0);

  const collider = world.createCollider(colliderDesc);
  return collider;
}

/**
 * Extracts navigation-source triangle geometry derived directly from canonical TerrainHeightfield.
 * Ready for Recast navmesh builder (T11).
 * Implements REQ-TERRAIN-002.
 */
export function createTerrainNavigationGeometry(
  heightfield: TerrainHeightfield
): TerrainNavigationGeometry {
  const { rows, columns, size_x, size_z, heights } = heightfield;
  const vertexCount = rows * columns;
  const vertices = new Float32Array(vertexCount * 3);

  for (let r = 0; r < rows; r++) {
    const u = r / (rows - 1);
    const x = (u - 0.5) * size_x;
    for (let c = 0; c < columns; c++) {
      const v = c / (columns - 1);
      const z = (v - 0.5) * size_z;
      const index = r * columns + c;
      const pIdx = index * 3;
      vertices[pIdx] = x;
      vertices[pIdx + 1] = heights[index];
      vertices[pIdx + 2] = z;
    }
  }

  const quadCount = (rows - 1) * (columns - 1);
  const indices = new Uint32Array(quadCount * 6);
  let idxOffset = 0;

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < columns - 1; c++) {
      const i00 = r * columns + c;
      const i10 = (r + 1) * columns + c;
      const i01 = r * columns + (c + 1);
      const i11 = (r + 1) * columns + (c + 1);

      indices[idxOffset++] = i00;
      indices[idxOffset++] = i10;
      indices[idxOffset++] = i01;

      indices[idxOffset++] = i01;
      indices[idxOffset++] = i10;
      indices[idxOffset++] = i11;
    }
  }

  return { vertices, indices };
}
