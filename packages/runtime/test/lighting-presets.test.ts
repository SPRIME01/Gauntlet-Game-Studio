import { describe, test, expect } from "bun:test";
import * as THREE from "three";
import { applyLightingPreset, LIGHTING_PRESETS } from "../src/index";

describe("reusable lighting presets", () => {
  test("five compositions are finite, provide lights and preserve scene ownership", () => {
    for (const preset of Object.keys(LIGHTING_PRESETS) as Array<keyof typeof LIGHTING_PRESETS>) {
      const scene = new THREE.Scene();
      const backdrop = new THREE.Color(0xffffff);
      scene.background = backdrop;
      const rig = applyLightingPreset(scene, { preset, quality: "mobile" });
      expect(scene.children).toHaveLength(3);
      expect(rig.lights.length).toBe(3);
      const key = rig.lights[1] as THREE.DirectionalLight;
      expect(key.castShadow).toBe(true);
      expect(key.shadow.mapSize.x).toBe(512);
      rig.dispose();
      rig.dispose(); // idempotent release
      expect(scene.children).toHaveLength(0);
      expect(scene.background).toBe(backdrop);
      expect(scene.fog).toBeNull();
    }
  });
  test("invalid styles and radius cannot silently create broken rigs", () => {
    const scene = new THREE.Scene();
    expect(() => applyLightingPreset(scene, { preset: "unavailable" as any })).toThrow("UNKNOWN_LIGHTING_PRESET");
    expect(() => applyLightingPreset(scene, { preset: "neutral-studio", radius: -1 })).toThrow("Invalid");
    expect(scene.children).toHaveLength(0);
  });
});
