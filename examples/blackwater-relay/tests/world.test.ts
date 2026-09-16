import { describe, expect, it } from "bun:test";
import {
  generateProceduralHeightfield,
  sampleCanonicalHeight,
} from "@gauntlet/runtime";
import {
  WORLD_KITS,
  WORLD_TERRAIN_REFERENCE,
  resolveWorldKitAnchors,
} from "../src/world/environment";
import { TERRAIN } from "../src/game/config";

describe("Blackwater Relay canonical terrain parity (T22, REQ-TERRAIN-001/002/003)", () => {
  const heightfield = generateProceduralHeightfield({
    rows: TERRAIN.rows,
    columns: TERRAIN.columns,
    size_x: TERRAIN.size_x,
    size_z: TERRAIN.size_z,
    seed: TERRAIN.seed,
  });

  it("generates the canonical heightfield declared by the 3dviz composition reference", () => {
    expect(heightfield.rows).toBe(WORLD_TERRAIN_REFERENCE.rows);
    expect(heightfield.columns).toBe(WORLD_TERRAIN_REFERENCE.columns);
    expect(heightfield.size_x).toBe(WORLD_TERRAIN_REFERENCE.size_x);
    expect(heightfield.size_z).toBe(WORLD_TERRAIN_REFERENCE.size_z);
    expect(heightfield.seed).toBe(WORLD_TERRAIN_REFERENCE.seed);
    expect(heightfield.heights).toBeInstanceOf(Float32Array);
    expect(heightfield.heights.length).toBe(TERRAIN.rows * TERRAIN.columns);
  });

  it("samples known canonical points (transposition/inversion detection per REQ-TERRAIN-003)", () => {
    // Frozen scenario anchors: sampled through the canonical bilinear implementation.
    expect(sampleCanonicalHeight(heightfield, 0, 0)).toBeCloseTo(-6.1946, 3);
    expect(sampleCanonicalHeight(heightfield, 10, 4)).toBeCloseTo(-8.5756, 3);
    expect(sampleCanonicalHeight(heightfield, 14, 4)).toBeCloseTo(-9.3569, 3);
    expect(sampleCanonicalHeight(heightfield, 8, -12)).toBeCloseTo(-6.4698, 3);
    // Row/column transposition guard: h(x,z) must differ from h(z,x) here.
    expect(sampleCanonicalHeight(heightfield, 12, 0)).not.toBeCloseTo(
      sampleCanonicalHeight(heightfield, 0, 12),
      2
    );
  });

  it("sockets every composed kit strictly through the canonical sampler (composition never owns elevation)", () => {
    const sample = (x: number, z: number) => sampleCanonicalHeight(heightfield, x, z);
    const anchors = resolveWorldKitAnchors(sample);
    expect(anchors.length).toBe(WORLD_KITS.length);
    for (const anchor of anchors) {
      const kit = WORLD_KITS.find((k) => k.kit_id === anchor.id)!;
      expect(anchor.position.x).toBe(kit.position.x);
      expect(anchor.position.z).toBe(kit.position.z);
      expect(anchor.position.y).toBeCloseTo(sample(kit.position.x, kit.position.z) + kit.position.offset_y, 6);
    }
  });
});
