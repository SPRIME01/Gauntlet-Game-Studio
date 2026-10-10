import * as THREE from "three";

/** Curated deterministic visual starting points; no changes to Koota or navigation. */
export type LightingPreset =
  | "neutral-studio" | "stylized-daylight" | "golden-hour"
  | "moonlit-forest" | "cinematic-interior";
export type LightingQuality = "mobile" | "desktop";

export interface LightingPresetOptions {
  preset: LightingPreset;
  quality?: LightingQuality;
  /** Scene world-space distance illuminated and shadowed by the main key light. */
  radius?: number;
}

export interface LightingRig {
  preset: LightingPreset;
  lights: readonly THREE.Light[];
  dispose(): void;
}
interface PresetSpec {
  background: number;
  fog: number;
  fogDensity: number;
  hemisphereSky: number;
  hemisphereGround: number;
  hemisphereIntensity: number;
  keyColor: number;
  keyIntensity: number;
  keyPosition: [number, number, number];
  fillColor: number;
  fillIntensity: number;
  fillPosition: [number, number, number];
}

export const LIGHTING_PRESETS: Readonly<Record<LightingPreset, Readonly<PresetSpec>>> = {
  "neutral-studio": {
    background: 0xcbd7e0, fog: 0xcbd7e0, fogDensity: 0,
    hemisphereSky: 0xffffff, hemisphereGround: 0x939da0, hemisphereIntensity: 2.2,
    keyColor: 0xffffff, keyIntensity: 2.8, keyPosition: [10, 18, 8],
    fillColor: 0xa5c7ff, fillIntensity: 0.8, fillPosition: [-8, 7, -10],
  },
  "stylized-daylight": {
    background: 0x96cdef, fog: 0xd6eced, fogDensity: 0.003,
    hemisphereSky: 0xe4f5ff, hemisphereGround: 0x9bb38b, hemisphereIntensity: 2.1,
    keyColor: 0xffe6b7, keyIntensity: 3.1, keyPosition: [16, 24, 12],
    fillColor: 0xb3d3ff, fillIntensity: 0.9, fillPosition: [-12, 8, -10],
  },
  "golden-hour": {
    background: 0xf8bc85, fog: 0xebbb9a, fogDensity: 0.005,
    hemisphereSky: 0xffce95, hemisphereGround: 0x675565, hemisphereIntensity: 1.4,
    keyColor: 0xffa455, keyIntensity: 3.8, keyPosition: [-20, 8, -4],
    fillColor: 0x7b9fd4, fillIntensity: 1.0, fillPosition: [8, 8, 12],
  },
  "moonlit-forest": {
    background: 0x0c1925, fog: 0x101f2e, fogDensity: 0.015,
    hemisphereSky: 0x58769e, hemisphereGround: 0x1f2e2c, hemisphereIntensity: 0.7,
    keyColor: 0x90b8ff, keyIntensity: 1.8, keyPosition: [13, 20, -11],
    fillColor: 0x88b8b0, fillIntensity: 0.25, fillPosition: [-8, 5, 9],
  },
  "cinematic-interior": {
    background: 0x141923, fog: 0x151720, fogDensity: 0.002,
    hemisphereSky: 0xb3c4d8, hemisphereGround: 0x514b45, hemisphereIntensity: 0.7,
    keyColor: 0xffd8b2, keyIntensity: 3.2, keyPosition: [5, 10, 4],
    fillColor: 0x628ee8, fillIntensity: 1.1, fillPosition: [-5, 5, -7],
  },
};

/** Adds an owned and removable rig; preserves prior scene background and fog. */
export function applyLightingPreset(scene: THREE.Scene, options: LightingPresetOptions): LightingRig {
  const spec = LIGHTING_PRESETS[options.preset];
  if (!spec) throw new Error("UNKNOWN_LIGHTING_PRESET: " + options.preset);
  const radius = options.radius ?? 24;
  if (!Number.isFinite(radius) || radius <= 0) throw new Error("Invalid lighting radius");
  const originalBackground = scene.background;
  const originalFog = scene.fog;
  const hemisphere = new THREE.HemisphereLight(spec.hemisphereSky, spec.hemisphereGround, spec.hemisphereIntensity);
  hemisphere.name = "gauntlet:foundation:hemisphere";
  const key = new THREE.DirectionalLight(spec.keyColor, spec.keyIntensity);
  key.name = "gauntlet:foundation:key";
  key.position.set(...spec.keyPosition);
  key.castShadow = true;
  const resolution = options.quality === "mobile" ? 512 : 1024;
  key.shadow.mapSize.set(resolution, resolution);
  key.shadow.camera.left = -radius;
  key.shadow.camera.right = radius;
  key.shadow.camera.top = radius;
  key.shadow.camera.bottom = -radius;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = Math.max(70, radius * 4);
  key.shadow.bias = -0.0001;
  key.shadow.normalBias = 0.02;
  const fill = new THREE.DirectionalLight(spec.fillColor, spec.fillIntensity);
  fill.name = "gauntlet:foundation:fill";
  fill.position.set(...spec.fillPosition);
  fill.castShadow = false;
  const lights: THREE.Light[] = [hemisphere, key, fill];
  scene.add(...lights);
  scene.background = new THREE.Color(spec.background);
  if (spec.fogDensity) scene.fog = new THREE.FogExp2(spec.fog, spec.fogDensity);
  else scene.fog = null;
  let disposed = false;
  return {
    preset: options.preset, lights,
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.remove(...lights);
      key.shadow.dispose();
      scene.background = originalBackground;
      scene.fog = originalFog;
    },
  };
}
