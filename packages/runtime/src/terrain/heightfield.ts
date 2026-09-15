import {
  type TerrainHeightfield,
  validateTerrainHeightfield,
} from "@gauntlet/contracts";

export interface GenerateTerrainOptions {
  rows: number;
  columns: number;
  size_x: number;
  size_z: number;
  seed?: number;
  base_frequency?: number;
  octaves?: number;
  amplitude?: number;
  min_height?: number;
  max_height?: number;
}

/**
 * Deterministic pseudo-random number generator (Mulberry32).
 * Headless-safe, zero external dependencies.
 */
function createMulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Procedurally generates canonical TerrainHeightfield through deterministic mathematical elevation.
 * Implements REQ-TERRAIN-001 and REQ-TERRAIN-003.
 * Zero Three.js/DOM/GPU readback authority.
 */
export function generateProceduralHeightfield(
  options: GenerateTerrainOptions
): TerrainHeightfield {
  const {
    rows,
    columns,
    size_x,
    size_z,
    seed = 42,
    base_frequency = 1.0,
    octaves = 4,
    amplitude = 10.0,
  } = options;

  if (rows < 2 || columns < 2) {
    throw new Error("Terrain must have at least 2 rows and 2 columns");
  }

  const rng = createMulberry32(seed);
  // Generate random phase offsets for each octave
  const phaseX: number[] = [];
  const phaseZ: number[] = [];
  for (let o = 0; o < octaves; o++) {
    phaseX.push(rng() * Math.PI * 2);
    phaseZ.push(rng() * Math.PI * 2);
  }

  const totalSamples = rows * columns;
  const heights = new Float32Array(totalSamples);

  let calculatedMin = Number.POSITIVE_INFINITY;
  let calculatedMax = Number.NEGATIVE_INFINITY;

  for (let r = 0; r < rows; r++) {
    const u = r / (rows - 1); // [0, 1] maps to X axis
    for (let c = 0; c < columns; c++) {
      const v = c / (columns - 1); // [0, 1] maps to Z axis

      let elevation = 0;
      let freq = base_frequency;
      let amp = amplitude;

      for (let o = 0; o < octaves; o++) {
        const nx = (u - 0.5) * Math.PI * 2 * freq + phaseX[o];
        const nz = (v - 0.5) * Math.PI * 2 * freq + phaseZ[o];
        elevation += (Math.sin(nx) * Math.cos(nz)) * amp;
        freq *= 2.0;
        amp *= 0.5;
      }

      // Indexing convention: row-major where row corresponds to X axis and col to Z axis
      const index = r * columns + c;
      heights[index] = elevation;

      if (elevation < calculatedMin) calculatedMin = elevation;
      if (elevation > calculatedMax) calculatedMax = elevation;
    }
  }

  const rawHeightfield: TerrainHeightfield = {
    rows,
    columns,
    heights,
    size_x,
    size_z,
    orientation: "row-major: row=x, col=z",
    seed,
    min_height: calculatedMin,
    max_height: calculatedMax,
    generator_metadata: {
      type: "sinusoidal-octaves",
      octaves,
      amplitude,
      base_frequency,
    },
  };

  return validateTerrainHeightfield(rawHeightfield);
}

/**
 * Samples elevation at an arbitrary world position (worldX, worldZ) using bilinear interpolation.
 * REQ-TERRAIN-004
 */
export function sampleCanonicalHeight(
  heightfield: TerrainHeightfield,
  worldX: number,
  worldZ: number
): number {
  const { rows, columns, size_x, size_z, heights } = heightfield;

  // World coordinates are centered at (0, 0)
  // X spans [-size_x / 2, size_x / 2], mapped to row [0, rows - 1]
  // Z spans [-size_z / 2, size_z / 2], mapped to col [0, columns - 1]
  const halfX = size_x / 2;
  const halfZ = size_z / 2;

  const clampedX = Math.max(-halfX, Math.min(halfX, worldX));
  const clampedZ = Math.max(-halfZ, Math.min(halfZ, worldZ));

  const u = (clampedX + halfX) / size_x; // [0, 1]
  const v = (clampedZ + halfZ) / size_z; // [0, 1]

  const rowFloat = u * (rows - 1);
  const colFloat = v * (columns - 1);

  const r0 = Math.floor(rowFloat);
  const r1 = Math.min(rows - 1, r0 + 1);
  const c0 = Math.floor(colFloat);
  const c1 = Math.min(columns - 1, c0 + 1);

  const fracR = rowFloat - r0;
  const fracC = colFloat - c0;

  const h00 = heights[r0 * columns + c0];
  const h10 = heights[r1 * columns + c0];
  const h01 = heights[r0 * columns + c1];
  const h11 = heights[r1 * columns + c1];

  // Bilinear interpolation
  const top = h00 * (1 - fracC) + h01 * fracC;
  const bottom = h10 * (1 - fracC) + h11 * fracC;

  return top * (1 - fracR) + bottom * fracR;
}
