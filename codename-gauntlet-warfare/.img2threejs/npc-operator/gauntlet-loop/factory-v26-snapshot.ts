import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ProceduralModelOptions = {
  wireframe?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
  qualityPriority?: 'reference-fidelity' | 'balanced';
};

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

type SculptMaterialSpec = Record<string, any>;

// THREE.CapsuleGeometry duplicates every UV-seam vertex (measured: 194 boundary
// edges on the default radius/segments below) -- same benign pattern as box/
// cylinder/sphere/torus, all of which weld cleanly to 0 given a CORRECT weld.
// (A naive vertex-only mergeVertices() reports 64 'non-manifold' edges here, but
// that is a counting artifact, not a real defect: it double-counts a handful of
// near-pole triangles that become degenerate once two of their three corners
// coincide -- confirmed by replicating subdivideCatmullClark's own degenerate-
// triangle-aware vertex identity, which finds a perfectly ordinary 2-manifold.)
// A capsule is the primary shape for skinned limbs/torso (PLAN_1.5), and skinning
// weight computation is O(vertices x bones), so fewer, guaranteed-simple vertices
// is worth having regardless -- authored as a deterministic, closed-by-
// construction mesh instead: shared pole vertices, and
// the radial index taken `% radialSegments` so the seam is never a duplicate
// vertex in the first place, rather than something to weld away afterward.
// Adapted from forge/stage5_rig/emit_rig.py's buildWatertightCapsule (verified
// there: 0 boundary edges, 0 non-manifold edges, deterministic across repeated
// runs) -- ported here rather than imported because this factory and the rig
// emitter are separate generated-output surfaces with no shared runtime module;
// see forge/tests/test_primitive_watertightness.py for the measured proof, and
// coordinate with the rig owner before changing either copy independently.
function buildWatertightCapsule(
  radius: number,
  cylLength: number,
  capSegments: number,
  radialSegments: number,
  heightSegments: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];
  const halfCyl = cylLength / 2;
  const totalSpan = 2 * (Math.PI / 2 * radius) + Math.max(0, cylLength);
  const vOf = (fromBottom: number) => (totalSpan > 0 ? fromBottom / totalSpan : 0);

  const bottomPoleIndex = positions.length / 3;
  positions.push(0, -halfCyl - radius, 0);
  uvs.push(0.5, vOf(0));

  const ringStarts: number[] = [];
  const ringV: number[] = [];
  for (let ring = 1; ring <= capSegments; ring += 1) {
    const phi = (Math.PI / 2) * (ring / capSegments);
    const y = -halfCyl - radius * Math.cos(phi);
    const r = radius * Math.sin(phi);
    const start = positions.length / 3;
    ringStarts.push(start);
    ringV.push(vOf(radius * phi));
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const theta = (radial / radialSegments) * Math.PI * 2;
      positions.push(r * Math.cos(theta), y, r * Math.sin(theta));
      uvs.push(radial / radialSegments, vOf(radius * phi));
    }
  }

  const cylinderRingStarts: number[] = [];
  if (cylLength > 0) {
    for (let step = 1; step <= heightSegments; step += 1) {
      const y = -halfCyl + (cylLength * step) / heightSegments;
      const start = positions.length / 3;
      cylinderRingStarts.push(start);
      const v = vOf(radius * (Math.PI / 2) + halfCyl + y);
      for (let radial = 0; radial < radialSegments; radial += 1) {
        const theta = (radial / radialSegments) * Math.PI * 2;
        positions.push(radius * Math.cos(theta), y, radius * Math.sin(theta));
        uvs.push(radial / radialSegments, v);
      }
    }
  }

  const topRingStarts: number[] = [];
  for (let ring = capSegments - 1; ring >= 1; ring -= 1) {
    const phi = (Math.PI / 2) * (ring / capSegments);
    const y = halfCyl + radius * Math.cos(phi);
    const r = radius * Math.sin(phi);
    const start = positions.length / 3;
    topRingStarts.push(start);
    const v = vOf(radius * (Math.PI / 2) + Math.max(0, cylLength) + radius * (Math.PI / 2 - phi));
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const theta = (radial / radialSegments) * Math.PI * 2;
      positions.push(r * Math.cos(theta), y, r * Math.sin(theta));
      uvs.push(radial / radialSegments, v);
    }
  }

  const topPoleIndex = positions.length / 3;
  positions.push(0, halfCyl + radius, 0);
  uvs.push(0.5, vOf(totalSpan));

  const firstBottomRing = ringStarts[0];
  for (let radial = 0; radial < radialSegments; radial += 1) {
    const next = (radial + 1) % radialSegments;
    indices.push(bottomPoleIndex, firstBottomRing + radial, firstBottomRing + next);
  }

  const allRings = [...ringStarts, ...cylinderRingStarts, ...topRingStarts];
  for (let i = 0; i < allRings.length - 1; i += 1) {
    const a = allRings[i];
    const b = allRings[i + 1];
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const next = (radial + 1) % radialSegments;
      indices.push(a + radial, a + next, b + next);
      indices.push(a + radial, b + next, b + radial);
    }
  }

  const lastRing = allRings[allRings.length - 1];
  for (let radial = 0; radial < radialSegments; radial += 1) {
    const next = (radial + 1) % radialSegments;
    indices.push(topPoleIndex, lastRing + next, lastRing + radial);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readLayerNumber(value: unknown, keys: string[], fallback: number): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (typeof record[key] === 'number') return record[key] as number;
    }
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex)
    ? '#' + hex.slice(1).split('').map((part) => part + part).join('')
    : hex;
  const value = /^#[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : 0x8a7a5f;
  return [clampAlbedoChannel((value >> 16) & 255), clampAlbedoChannel((value >> 8) & 255), clampAlbedoChannel(value & 255)];
}

function materialPalette(spec: SculptMaterialSpec): string[] {
  const palette = spec.colorVariation?.palette;
  if (Array.isArray(palette) && palette.length > 0) return palette.filter((value) => typeof value === 'string');
  const secondary = spec.albedo?.secondary;
  const colors = [spec.baseColor ?? spec.color ?? spec.albedo?.dominant, ...(Array.isArray(secondary) ? secondary : [])];
  return colors.filter((value): value is string => typeof value === 'string' && value.startsWith('#'));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampAlbedoChannel(value: number): number {
  return Math.max(30, Math.min(240, Math.round(value)));
}

function clampPbrF0(value: number): number {
  return Math.max(0.02, Math.min(1, value));
}

function clampPbrIor(value: number): number {
  return Math.max(1, Math.min(2.5, value));
}

function clampPbrMetalness(value: number): number {
  return value >= 0.5 ? 1 : 0;
}

function clampedAlbedoColor(spec: SculptMaterialSpec): THREE.Color {
  const source = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  // setStyle with an explicit SRGBColorSpace, NOT the numeric constructor.
  //
  // `new THREE.Color(r, g, b)` treats its arguments as LINEAR working-space components,
  // while an authored `baseColor` hex is sRGB. Feeding one to the other skipped the
  // transfer function and lifted every dark albedo: #2e2a28, authored as a near-black
  // vinyl, rendered at roughly sRGB 0.46 — a mid grey. The error is largest exactly where
  // it matters most, because the transfer curve is steepest near black.
  return new THREE.Color().setStyle(source, THREE.SRGBColorSpace);
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function periodicHash(x: number, y: number, seed: number, periodX: number, periodY: number): number {
  const wrappedX = ((x % periodX) + periodX) % periodX;
  const wrappedY = ((y % periodY) + periodY) % periodY;
  let value = Math.imul(wrappedX + seed * 17, 374761393) ^ Math.imul(wrappedY + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicValueNoise(u: number, v: number, seed: number, periodX: number, periodY: number): number {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const a = periodicHash(x0, y0, seed, periodX, periodY);
  const b = periodicHash(x0 + 1, y0, seed, periodX, periodY);
  const c = periodicHash(x0, y0 + 1, seed, periodX, periodY);
  const d = periodicHash(x0 + 1, y0 + 1, seed, periodX, periodY);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}

type SurfaceBand = {
  frequency: number;
  amplitude: number;
  stretchX: number;
  stretchY: number;
  ridge: boolean;
};

function surfaceBands(spec: SculptMaterialSpec): SurfaceBand[] {
  const source = Array.isArray(spec.surfaceFrequencyBands) ? spec.surfaceFrequencyBands : [];
  const parsed = source.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const band = item as Record<string, unknown>;
    const frequency = typeof band.frequency === 'number' ? band.frequency : 0;
    const amplitude = typeof band.amplitude === 'number' ? band.amplitude : 0;
    if (frequency <= 0 || amplitude <= 0) return [];
    const stretch = Array.isArray(band.stretch) ? band.stretch : [1, 1];
    const description = `${String(band.pattern ?? '')} ${String(band.role ?? '')}`.toLowerCase();
    return [{
      frequency,
      amplitude,
      stretchX: typeof stretch[0] === 'number' ? Math.max(0.1, stretch[0]) : 1,
      stretchY: typeof stretch[1] === 'number' ? Math.max(0.1, stretch[1]) : 1,
      ridge: /(ridge|groove|grain|fiber|striated|crack)/.test(description),
    }];
  });
  return parsed.length > 0 ? parsed : [
    { frequency: 2, amplitude: 0.42, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 12, amplitude: 0.22, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 56, amplitude: 0.08, stretchX: 1, stretchY: 1, ridge: false },
  ];
}

function sampleSurface(u: number, v: number, bands: SurfaceBand[], seed: number): number {
  let value = 0;
  let weight = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const periodX = Math.max(1, Math.round(band.frequency * band.stretchX));
    const periodY = Math.max(1, Math.round(band.frequency * band.stretchY));
    let sample = periodicValueNoise(u, v, seed + index * 1013, periodX, periodY);
    if (band.ridge) sample = 1 - Math.abs(sample * 2 - 1);
    value += sample * band.amplitude;
    weight += band.amplitude;
  }
  return weight > 0 ? clamp01(value / weight) : 0.5;
}

function mixPalette(colors: [number, number, number][], value: number): [number, number, number] {
  if (colors.length === 1) return colors[0];
  const scaled = clamp01(value) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const a = colors[index];
  const b = colors[index + 1];
  return [
    Math.round(THREE.MathUtils.lerp(a[0], b[0], mix)),
    Math.round(THREE.MathUtils.lerp(a[1], b[1], mix)),
    Math.round(THREE.MathUtils.lerp(a[2], b[2], mix)),
  ];
}

type ColorGradientStop = { offset: number; color: string };
type ColorGradientSpec = {
  type: 'linear' | 'radial';
  axis: [number, number];
  stops: ColorGradientStop[];
};

function parseRgba(value: string): [number, number, number] {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (!match) return [138, 122, 95];
  return [clampAlbedoChannel(Number(match[1])), clampAlbedoChannel(Number(match[2])), clampAlbedoChannel(Number(match[3]))];
}

// Analytical per-pixel gradient sample. The extraction schema's colorGradient carries
// exact rgba(...) stop colors (see extract_part_color_recipe.py), so this samples the
// same trend directly in JS math rather than round-tripping through a Canvas 2D
// createLinearGradient/createRadialGradient object — same visual result, and it composes
// directly with the existing noise/height-correlated colorVariation blend below.
function sampleColorGradient(gradient: ColorGradientSpec, u: number, v: number): [number, number, number] {
  const stops = gradient.stops.length >= 2 ? gradient.stops : [{ offset: 0, color: 'rgba(138,122,95,1)' }, { offset: 1, color: 'rgba(138,122,95,1)' }];
  let t: number;
  if (gradient.type === 'radial') {
    const [cx, cy] = gradient.axis;
    const dx = u - cx;
    const dy = v - cy;
    const maxRadius = Math.max(0.001, Math.hypot(Math.max(cx, 1 - cx), Math.max(cy, 1 - cy)));
    t = clamp01(Math.hypot(dx, dy) / maxRadius);
  } else {
    const [ax, ay] = gradient.axis;
    const projection = (u - 0.5) * ax + (v - 0.5) * ay;
    const maxProjection = 0.5 * (Math.abs(ax) + Math.abs(ay)) || 0.5;
    t = clamp01(projection / maxProjection + 0.5);
  }
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.max(0, Math.floor(scaled)));
  const mix = scaled - index;
  const a = parseRgba(stops[index].color);
  const b = parseRgba(stops[index + 1].color);
  return [
    THREE.MathUtils.lerp(a[0], b[0], mix),
    THREE.MathUtils.lerp(a[1], b[1], mix),
    THREE.MathUtils.lerp(a[2], b[2], mix),
  ];
}

function writePixel(data: Uint8ClampedArray, offset: number, red: number, green: number, blue: number): void {
  data[offset] = Math.max(0, Math.min(255, Math.round(red)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
  data[offset + 3] = 255;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function createMapTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [2, 2];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 2,
    typeof repeat[1] === 'number' ? repeat[1] : 2,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

type ProceduralTextureSet = {
  albedo: THREE.Texture;
  roughness: THREE.Texture;
  height: THREE.Texture;
  normal: THREE.Texture;
  ao: THREE.Texture;
  source: 'reference-pixel-extraction' | 'procedural';
};

function referenceMapUrl(spec: SculptMaterialSpec, channel: string): string | null {
  const reference = spec.referencePbr;
  if (!reference || typeof reference !== 'object') return null;
  if (reference.usable === false) return null;
  const confidence = typeof reference.confidence === 'number'
    ? reference.confidence
    : (typeof reference.estimatedFidelity === 'number' ? reference.estimatedFidelity : 0);
  const threshold = typeof reference.targetThreshold === 'number' ? reference.targetThreshold : 0.7;
  if (confidence < threshold) return null;
  const maps = reference.maps;
  if (!maps || typeof maps !== 'object') return null;
  const map = (maps as Record<string, unknown>)[channel];
  if (!map || typeof map !== 'object') return null;
  const record = map as Record<string, unknown>;
  const url = typeof record.url === 'string' && record.url.trim() ? record.url : record.path;
  return typeof url === 'string' && url.trim() ? url : null;
}

function createLoadedMapTexture(
  url: string,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [1, 1];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 1,
    typeof repeat[1] === 'number' ? repeat[1] : 1,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

function makeReferenceTextureSet(spec: SculptMaterialSpec, options: ProceduralModelOptions): ProceduralTextureSet | null {
  const albedo = referenceMapUrl(spec, 'albedo');
  const roughness = referenceMapUrl(spec, 'roughness');
  const height = referenceMapUrl(spec, 'height');
  const normal = referenceMapUrl(spec, 'normal');
  const ao = referenceMapUrl(spec, 'ao');
  if (!albedo || !roughness || !height || !normal || !ao) return null;
  return {
    albedo: createLoadedMapTexture(albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createLoadedMapTexture(roughness, THREE.NoColorSpace, spec, options),
    height: createLoadedMapTexture(height, THREE.NoColorSpace, spec, options),
    normal: createLoadedMapTexture(normal, THREE.NoColorSpace, spec, options),
    ao: createLoadedMapTexture(ao, THREE.NoColorSpace, spec, options),
    source: 'reference-pixel-extraction',
  };
}

function makeProceduralTextureSet(
  id: string,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): ProceduralTextureSet | null {
  if (typeof document === 'undefined') return null;
  const qualityFirst = (options.qualityPriority ?? 'reference-fidelity') === 'reference-fidelity';
  const requested = options.textureSize ?? spec.textureResolution;
  const requestedSize = typeof requested === 'number' && Number.isFinite(requested)
    ? requested
    : (qualityFirst ? 1024 : 512);
  const size = Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(requestedSize))));
  const canvases = {
    albedo: makeCanvas(size),
    roughness: makeCanvas(size),
    height: makeCanvas(size),
    normal: makeCanvas(size),
    ao: makeCanvas(size),
  };
  const contexts = {
    albedo: canvases.albedo.getContext('2d'),
    roughness: canvases.roughness.getContext('2d'),
    height: canvases.height.getContext('2d'),
    normal: canvases.normal.getContext('2d'),
    ao: canvases.ao.getContext('2d'),
  };
  if (!contexts.albedo || !contexts.roughness || !contexts.height || !contexts.normal || !contexts.ao) return null;
  const images = {
    albedo: contexts.albedo.createImageData(size, size),
    roughness: contexts.roughness.createImageData(size, size),
    height: contexts.height.createImageData(size, size),
    normal: contexts.normal.createImageData(size, size),
    ao: contexts.ao.createImageData(size, size),
  };
  const seed = hashString(id);
  const bands = surfaceBands(spec);
  const heightField = new Float32Array(size * size);
  const roughnessField = new Float32Array(size * size);
  const palette = materialPalette(spec);
  const fallback = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const colors = (palette.length >= 2 ? palette : [fallback, '#6E614B', '#A08F70']).map(hexToRgb);
  const baseRoughness = clamp01(readLayerNumber(spec.roughness, ['base'], 0.76));
  const roughnessVariation = clamp01(readLayerNumber(spec.roughness, ['variation'], 0.18));
  const colorAmplitude = clamp01(readLayerNumber(spec.colorVariation, ['amplitude', 'variation'], 0.18));
  const heightCorrelation = clamp01(readLayerNumber(spec.colorVariation, ['heightCorrelation'], 0.3));
  const colorGradient: ColorGradientSpec | undefined = spec.colorGradient;
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      const height = sampleSurface(u, v, bands, seed + 101);
      const roughNoise = sampleSurface(u, v, bands, seed + 7001);
      const colorNoise = sampleSurface(u, v, bands, seed + 15013);
      heightField[index] = height;
      roughnessField[index] = clamp01(baseRoughness + (roughNoise - 0.5) * roughnessVariation * 2);
      let color: [number, number, number];
      if (colorGradient) {
        // Evidence-derived spatial gradient (Plan 1.3 Workstream C) takes priority
        // over the noise-based palette blend below — it is a measured trend, not a guess.
        color = sampleColorGradient(colorGradient, u, v);
      } else {
        const paletteValue = clamp01(
          0.5 + (colorNoise - 0.5) * colorAmplitude * 2 + (height - 0.5) * heightCorrelation
        );
        color = mixPalette(colors, paletteValue);
      }
      writePixel(images.albedo.data, index * 4, color[0], color[1], color[2]);
    }
  }
  const normalStrength = Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35));
  const aoStrength = clamp01(readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35));
  for (let y = 0; y < size; y += 1) {
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      const index = y * size + x;
      const center = heightField[index];
      const dx = (heightField[y * size + right] - heightField[y * size + left]) * normalStrength * 6;
      const dy = (heightField[down + x] - heightField[up + x]) * normalStrength * 6;
      const inverseLength = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const normalX = -dx * inverseLength;
      const normalY = -dy * inverseLength;
      const normalZ = inverseLength;
      const neighborAverage = (
        heightField[y * size + left] + heightField[y * size + right]
        + heightField[up + x] + heightField[down + x]
      ) * 0.25;
      const cavity = Math.max(0, neighborAverage - center);
      const ao = clamp01(1 - aoStrength * (cavity * 12 + (1 - center) * 0.16));
      const offset = index * 4;
      const heightByte = center * 255;
      const roughnessByte = roughnessField[index] * 255;
      writePixel(images.height.data, offset, heightByte, heightByte, heightByte);
      writePixel(images.roughness.data, offset, roughnessByte, roughnessByte, roughnessByte);
      writePixel(
        images.normal.data, offset,
        (normalX * 0.5 + 0.5) * 255,
        (normalY * 0.5 + 0.5) * 255,
        (normalZ * 0.5 + 0.5) * 255,
      );
      writePixel(images.ao.data, offset, ao * 255, ao * 255, ao * 255);
    }
  }
  contexts.albedo.putImageData(images.albedo, 0, 0);
  contexts.roughness.putImageData(images.roughness, 0, 0);
  contexts.height.putImageData(images.height, 0, 0);
  contexts.normal.putImageData(images.normal, 0, 0);
  contexts.ao.putImageData(images.ao, 0, 0);
  return {
    albedo: createMapTexture(canvases.albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createMapTexture(canvases.roughness, THREE.NoColorSpace, spec, options),
    height: createMapTexture(canvases.height, THREE.NoColorSpace, spec, options),
    normal: createMapTexture(canvases.normal, THREE.NoColorSpace, spec, options),
    ao: createMapTexture(canvases.ao, THREE.NoColorSpace, spec, options),
    source: 'procedural',
  };
}

function createSculptMaterial(id: string, spec: SculptMaterialSpec, options: ProceduralModelOptions, denseComponent = false): THREE.MeshPhysicalMaterial {
  // A material that declares -- with evidence -- that its subject carries no texture
  // detail gets NO texture set. Synthesising one anyway is not a harmless default: the
  // branch below then forces color to white and roughness to 1 and reads both from the
  // generated maps, so the authored albedo and the reference-derived roughness are both
  // discarded, and the model gains mottling the reference does not have. Measured on the
  // tuxedo cat, whose black fur rendered as speckled grey-and-white from a palette that
  // only ever described two flat regions.
  const textureless = (spec.textureless as { declared?: boolean } | undefined)?.declared === true;
  const textures = textureless
    ? null
    : makeReferenceTextureSet(spec, options) ?? makeProceduralTextureSet(id, spec, options);
  const material = new THREE.MeshPhysicalMaterial({
    color: textures ? 0xffffff : clampedAlbedoColor(spec),
    roughness: textures ? 1 : clamp01(readLayerNumber(spec.roughness, ['base'], 0.76)),
    metalness: clampPbrMetalness(readLayerNumber(spec.metalness, ['base'], 0.0)),
    clearcoat: clamp01(readLayerNumber(spec.clearcoat, ['base', 'amount'], 0)),
    clearcoatRoughness: clamp01(readLayerNumber(spec.clearcoatRoughness, ['base'], 0.25)),
    transmission: clamp01(readLayerNumber(spec.transmission, ['base', 'amount'], 0)),
    ior: clampPbrIor(readLayerNumber(spec.ior, ['base', 'value'], 1.5)),
    thickness: Math.max(0, readLayerNumber(spec.thickness, ['base', 'amount'], 0)),
    attenuationDistance: Math.max(0.001, readLayerNumber(spec.attenuationDistance, ['base', 'value'], Infinity)),
    attenuationColor: new THREE.Color(typeof spec.attenuationColor === 'string' ? spec.attenuationColor : '#ffffff'),
    sheen: clamp01(readLayerNumber(spec.sheen, ['base', 'amount'], 0)),
    sheenColor: new THREE.Color(typeof spec.sheenColor === 'string' ? spec.sheenColor : '#ffffff'),
    sheenRoughness: clamp01(readLayerNumber(spec.sheenRoughness, ['base'], 1.0)),
    iridescence: clamp01(readLayerNumber(spec.iridescence, ['base', 'amount'], 0)),
    iridescenceIOR: clampPbrIor(readLayerNumber(spec.iridescenceIOR, ['base', 'value'], 1.3)),
    anisotropy: clamp01(readLayerNumber(spec.anisotropy, ['base', 'amount'], 0)),
    anisotropyRotation: readLayerNumber(spec.anisotropy, ['rotation'], 0),
    specularIntensity: clampPbrF0(readLayerNumber(spec.specularF0 ?? spec.f0 ?? spec.specularIntensity, ['base', 'value'], 1.0)),
    specularColor: new THREE.Color(typeof spec.specularColor === 'string' ? spec.specularColor : '#ffffff'),
    emissive: new THREE.Color(typeof spec.emissive === 'string' ? spec.emissive : '#000000'),
    emissiveIntensity: Math.max(0, readLayerNumber(spec.emissiveIntensity, ['base'], 1.0)),
    opacity: clamp01(readLayerNumber(spec.opacity, ['base'], 1)),
    transparent: readLayerNumber(spec.transmission, ['base', 'amount'], 0) > 0 || readLayerNumber(spec.opacity, ['base'], 1) < 1,
    alphaTest: Math.max(0, readLayerNumber(spec.alpha, ['cutoff', 'alphaTest'], 0)),
    wireframe: options.wireframe ?? false,
    side: spec.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
    flatShading: spec.flatShading === true,
  });
  if (textures) {
    material.map = textures.albedo;
    material.roughnessMap = textures.roughness;
    material.normalMap = textures.normal;
    material.normalScale.setScalar(Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35)));
    material.aoMap = textures.ao;
    material.aoMap.channel = 0;
    material.aoMapIntensity = readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35);
    const denseMesh = denseComponent || spec.denseMesh === true || spec.geometryDensity === 'dense' || spec.topologyClass === 'dense';
    const bumpScale = Math.max(0, readLayerNumber(spec.bump, ['amplitude', 'strength'], 0));
    const effectiveBumpScale = denseMesh ? Math.max(0.05, bumpScale) : bumpScale;
    if (effectiveBumpScale > 0) {
      material.bumpMap = textures.height;
      material.bumpScale = effectiveBumpScale;
    }
    const displacementScale = Math.max(0, readLayerNumber(spec.displacement, ['amplitude', 'strength'], 0));
    const effectiveDisplacementScale = denseMesh ? Math.max(0.005, displacementScale) : displacementScale;
    if (effectiveDisplacementScale > 0) {
      material.displacementMap = textures.height;
      material.displacementScale = effectiveDisplacementScale;
      material.displacementBias = -effectiveDisplacementScale * 0.5;
    }
  }
  material.envMapIntensity = readLayerNumber(spec, ['envMapIntensity'], 0.8);
  material.userData.sculptMaterial = spec;
  material.userData.proceduralMapsIndependent = true;
  material.userData.pbrConstraints = { albedoRange: [30, 240], binaryMetalness: true, f0Range: [0.02, 1], iorRange: [1, 2.5] };
  material.userData.pbrTextureSource = textures?.source ?? 'flat-fallback';
  material.userData.referencePbr = spec.referencePbr ?? null;
  material.userData.referenceMaterialId = spec.referenceMaterialId ?? spec.materialReference?.profileId ?? null;
  material.userData.materialEvidence = spec.materialEvidence ?? null;
  material.userData.validationViews = spec.materialReference?.validationViews ?? [];
  material.needsUpdate = true;
  return material;
}

type AttachmentEndpoint = {
  start: THREE.Vector3;
  midpoint: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
  baseRadius: number;
  endRadius: number;
};

function readVector3(value: unknown, fallback: [number, number, number]): THREE.Vector3 {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number')) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;
  const start = readVector3(record.localStart, [0, 0, 0]);
  const end = readVector3(record.localEnd, [0, 1, 0]);
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length <= 0.0001) return null;
  const direction = delta.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  const baseRadius = Math.max(0.005, readNumber(record.baseRadius, 0.06));
  const endRadius = Math.max(0.003, readNumber(record.endRadius, baseRadius * 0.55));
  return {
    start,
    midpoint: delta.multiplyScalar(0.5),
    quaternion,
    length,
    baseRadius,
    endRadius,
  };
}

// Generated from ObjectSculptSpec target: Tactical Operator NPC
// Sculpt build pass: blockout
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
// ===================================================================
// Tactical Operator NPC v2 — turnaround convergence build (2026-09-19)
//
// Primary visual target: references/operator-turnaround-sheet.png (operator-
// supplied AAA art direction; clean crops under references/derived/turnaround/).
// Proportion authority: .img2threejs/npc-operator/turnaround-profiles.json
// (full-span / midline / depth vectors per view) and turnaround-landmarks.json.
//
// Structural contract preserved from the settled blockout factory:
//   - named anatomical hierarchy with joint-aligned pivots
//   - 11-bone bound skeleton (spine + legs) with analytic envelope weights
//   - arm chains clavicle > upper-arm > forearm > hand as named pivot Groups
//   - weapon-socket locator under hand-r (no weapon geometry merged into body)
//   - world-bake bind protocol; userData.sculptRuntime / rig contracts
//   - glTF export route (scripts/export-npc-gltf.ts) verified in Blender
// v2 changes: all visible forms re-authored against the turnaround (helmet,
// goggles, face covering, layered neck wrap, plate carrier with pouch rows,
// backpack, belt kit, thigh rig, hard knee pads, lace-up boots, gloves) with
// distinct material classes; equipment is skinned to its owning bone so
// skeletal animation carries gear with the body.
// ===================================================================
export function createTacticalOperatorNPCModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Tactical Operator NPC";
  root.userData.reconstructionEvidence = {
    itemFamily: "humanoid combatant", subtype: "tactical operator", componentAdapter: "parametric-v2",
    route: "asset.reconstruct.reference-image/agent-skill.img2threejs (character track, turnaround convergence)",
    exactnessTier: "designed-reference-approximation",
    referenceCamera: { solved: true, fovDegrees: 35, aspect: 1.0, orientation: { yaw: 0, pitch: 6, roll: 0 }, positionHint: [0, 0, 3], note: "orthographic-like turnaround views; review framing matches npc-scene reference framing" },
    approximationNotes: [
      "reference is generated art direction, not photogrammetry; cross-view contradictions resolved front > side > back > 3/4 per operator priority",
      "chin/neck boundary occluded by mask and wrap; head block sized by goggle-line + visible-block measurements",
    ],
  };
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  // ------------------------------------------------------------------
  // Measured proportions (fractions of standing height; y: 0 crown, -1 sole).
  // Sources: turnaround-profiles.json rows + turnaround-landmarks.json.
  // ------------------------------------------------------------------
  const ARM_ANGLE = (18 * Math.PI) / 180; // A-pose slant from vertical (measured 24-31 deg)
  const P = {
    helmetTopY: -0.012, helmetCY: -0.056, helmetR: 0.062,
    goggleY: -0.074, lensR: 0.024,
    maskCY: -0.098, chinY: -0.13,
    neckTopY: -0.105, neckBaseY: -0.165,
    shoulderY: -0.2, shoulderX: 0.105,
    chestTopY: -0.16, chestBotY: -0.315, chestRX: 0.152, chestRZ: 0.122,
    waistY: -0.42, waistRX: 0.122, waistRZ: 0.095,
    hipY: -0.52, hipRX: 0.125, hipRZ: 0.1,
    legX: 0.07, kneeY: -0.755, kneeR: 0.055,
    ankleY: -0.9, soleY: -1.0,
    upperArmR: 0.052, foreArmR: 0.042, wristR: 0.032,
    upperArmL: 0.165, foreArmL: 0.14,
    bootTopY: -0.9, bootLen: 0.19,
  } as const;

  // ------------------------------------------------------------------
  // Materials — nine classes, separated by response (roughness/metalness/
  // normal breakup), not albedo alone. Palette sampled from the sheet.
  // ------------------------------------------------------------------
  const fiberBands = [
    { frequency: 5, amplitude: 0.22, stretch: [1, 1], pattern: "weave", role: "macro cloth mass" },
    { frequency: 26, amplitude: 0.12, stretch: [2, 1], pattern: "fiber grain", role: "meso weave" },
    { frequency: 96, amplitude: 0.07, stretch: [4, 1], pattern: "thread ridges", role: "micro" },
  ];
  const nylonBands = [
    { frequency: 7, amplitude: 0.18, stretch: [1, 1], pattern: "patch mass", role: "macro" },
    { frequency: 30, amplitude: 0.13, stretch: [3, 1], pattern: "strap ridges", role: "meso" },
    { frequency: 110, amplitude: 0.05, stretch: [1, 1], pattern: "grain", role: "micro" },
  ];
  const materialMap: Record<string, THREE.Material> = {};
  materialMap["m-fabric"] = createSculptMaterial("m-fabric", {
    id: "m-fabric", name: "Combat shirt fabric (cordura/nylon blend)", type: "standard",
    baseColor: "#2A2822", albedo: { value: "#2A2822", secondary: ["#201E19", "#332F27"] },
    surfaceFrequencyBands: fiberBands,
    roughness: { base: 0.88, variation: 0.1 }, metalness: { base: 0 },
    normal: { strength: 0.42 }, envMapIntensity: 0.45, notes: "Dark olive-charcoal shirt; weave breakup carries the fabric read.",
  }, options);
  materialMap["m-fabric-trouser"] = createSculptMaterial("m-fabric-trouser", {
    id: "m-fabric-trouser", name: "Trousers fabric (lighter olive-brown)", type: "standard",
    baseColor: "#3E392E", albedo: { value: "#3E392E", secondary: ["#332F25", "#494335"] },
    surfaceFrequencyBands: fiberBands,
    roughness: { base: 0.87, variation: 0.12 }, metalness: { base: 0 },
    normal: { strength: 0.36 }, envMapIntensity: 0.4, notes: "Trousers read darker olive-brown than the shirt in every view.",
  }, options);
  materialMap["m-carrier"] = createSculptMaterial("m-carrier", {
    id: "m-carrier", name: "Plate carrier / pouch nylon", type: "standard",
    baseColor: "#262420", albedo: { value: "#262420", secondary: ["#1D1B16", "#2F2C24"] },
    surfaceFrequencyBands: nylonBands,
    roughness: { base: 0.78, variation: 0.12 }, metalness: { base: 0.02 },
    sheen: { base: 0.1 }, sheenColor: "#6B6552", sheenRoughness: { base: 0.7 },
    normal: { strength: 0.3 }, envMapIntensity: 0.5, notes: "Matte nylon with edge sheen; distinct from shirt by tone + tighter grain.",
  }, options);
  materialMap["m-polymer"] = createSculptMaterial("m-polymer", {
    id: "m-polymer", name: "Moulded polymer (knee pads, goggle body)", type: "standard",
    baseColor: "#151515", albedo: { value: "#171717", secondary: ["#101010", "#1E1E1E"] },
    surfaceFrequencyBands: [{ frequency: 8, amplitude: 0.12, stretch: [1, 1], pattern: "mould", role: "macro" }],
    roughness: { base: 0.48, variation: 0.1 }, metalness: { base: 0.05 },
    clearcoat: { base: 0.25 }, clearcoatRoughness: { base: 0.4 },
    normal: { strength: 0.3 }, ambientOcclusion: { cavityStrength: 0.3 },
    envMapIntensity: 0.55, notes: "Low-sheen moulded rubber/polymer per sheet swatch.",
  }, options);
  materialMap["m-hardware"] = createSculptMaterial("m-hardware", {
    id: "m-hardware", name: "Anodized steel hardware", type: "standard",
    baseColor: "#2E3033", albedo: { value: "#303236", secondary: ["#232528", "#3C3F44"] },
    textureless: { declared: true, evidence: ["small hardware reads as uniform anodized metal at gameplay distance"] },
    roughness: { base: 0.5, variation: 0.06 }, metalness: { base: 0.85 }, envMapIntensity: 0.35,
    notes: "Buckles, rails, antenna, cable — painted-metal response.",
  }, options, true);
  materialMap["m-lens"] = createSculptMaterial("m-lens", {
    id: "m-lens", name: "Goggle lens", type: "standard",
    baseColor: "#0B0D10", albedo: { value: "#0C0E12", secondary: "#070809" },
    textureless: { declared: true, evidence: ["lens is a smooth glossy solid in all views"] },
    roughness: { base: 0.14, variation: 0.03 }, metalness: { base: 0.1 },
    clearcoat: { base: 0.7 }, clearcoatRoughness: { base: 0.15 },
    notes: "Smooth specular class — never confused with fabric.",
  }, options, true);
  materialMap["m-boot"] = createSculptMaterial("m-boot", {
    id: "m-boot", name: "Boot leather/synthetic", type: "standard",
    baseColor: "#1B1A18", albedo: { value: "#1D1C19", secondary: ["#131211", "#262420"] },
    surfaceFrequencyBands: [
      { frequency: 6, amplitude: 0.2, stretch: [1, 2], pattern: "leather grain", role: "macro" },
      { frequency: 40, amplitude: 0.1, stretch: [1, 1], pattern: "pore", role: "micro" },
    ],
    roughness: { base: 0.68, variation: 0.12 }, metalness: { base: 0.02 },
    ambientOcclusion: { cavityStrength: 0.4 },
    envMapIntensity: 0.5, normal: { strength: 0.3 }, notes: "Rough synthetic leather; glossier than fabric, duller than polymer.",
  }, options);
  materialMap["m-rubber"] = createSculptMaterial("m-rubber", {
    id: "m-rubber", name: "Boot sole rubber", type: "standard",
    baseColor: "#131313", albedo: { value: "#141414", secondary: ["#0E0E0E", "#1A1A1A"] },
    surfaceFrequencyBands: [{ frequency: 14, amplitude: 0.18, stretch: [2, 1], pattern: "tread", role: "meso" }],
    roughness: { base: 0.85, variation: 0.06 }, metalness: { base: 0 },
    normal: { strength: 0.4 },
    notes: "Dead-matte rubber class for soles.",
  }, options);
  materialMap["m-glove"] = createSculptMaterial("m-glove", {
    id: "m-glove", name: "Glove fabric + polymer", type: "standard",
    baseColor: "#302E28", albedo: { value: "#302E28", secondary: ["#25231D", "#3A3830"] },
    surfaceFrequencyBands: fiberBands,
    roughness: { base: 0.75, variation: 0.1 }, metalness: { base: 0.03 },
    ambientOcclusion: { cavityStrength: 0.35 },
    envMapIntensity: 0.45, normal: { strength: 0.32 }, notes: "Between fabric and carrier; hard knuckle plate uses m-polymer.",
  }, options);

  // ------------------------------------------------------------------
  // Registry + construction helpers
  // ------------------------------------------------------------------
  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};
  const skinnedParts: Record<string, THREE.SkinnedMesh[]> = {};

  let metaSeq = 0;
  const componentMeta = (
    id: string, name: string,
    o: { level: string; role: string; importance: number; primitive: string; parent: string | null; material: string; dims: [number, number, number] },
  ) => ({
    id, name, level: o.level, role: o.role, importance: o.importance, confidence: 0.9,
    primitive: o.primitive, topologyClass: "assembled-solid",
    topologyRationale: `${name} authored parametrically against turnaround measurements (spec-v2-turnaround.md).`,
    geometryDescriptor: { topologyIntent: "stylized character part", uvStrategy: "generated procedural coordinates", normalStrategy: "smooth vertex normals" },
    parent: o.parent, material: o.material,
    dimensions: { width: o.dims[0], height: o.dims[1], depth: o.dims[2], units: "relative", confidence: 0.9 },
    evidenceRefs: ["turnaround-front", "turnaround-left", "turnaround-back"],
    fidelityTier: "production-v2",
    seq: metaSeq++,
  });

  const pivotNode = (
    id: string, name: string, parentId: string,
    position: [number, number, number],
    meta: ReturnType<typeof componentMeta>,
    rotation?: [number, number, number],
  ): THREE.Group => {
    const g = new THREE.Group();
    g.name = `${name}__pivot`;
    g.position.set(position[0], position[1], position[2]);
    if (rotation) g.rotation.set(rotation[0], rotation[1], rotation[2]);
    g.userData.sculptComponent = meta;
    g.userData.actionProfile = {
      animationRole: meta.role === "socket" ? "socket" : "articulated",
      pivot: { mode: "joint", localPosition: [0, 0, 0], axis: [0, 1, 0], confidence: 0.9 },
    };
    (nodes[parentId] ?? root).add(g);
    nodes[id] = g;
    return g;
  };

  const attachMesh = (
    id: string, name: string,
    geo: THREE.BufferGeometry, mat: THREE.Material, parentId: string | null,
    meta: ReturnType<typeof componentMeta>,
    position?: [number, number, number], rotation?: [number, number, number],
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    if (position) mesh.position.set(position[0], position[1], position[2]);
    if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
    mesh.castShadow = options.castShadow ?? true;
    mesh.receiveShadow = options.receiveShadow ?? true;
    mesh.userData.sculptComponent = meta;
    (parentId ? nodes[parentId] ?? root : root).add(mesh);
    meshes[id] = mesh;
    colliders[id] = {};
    return mesh;
  };

  // Skinned part: geometry authored in MODEL space, mesh at root identity.
  // skin 'analytic' = envelope weights across bones (primary body masses);
  // skin 'rigid' = weight 1.0 to the owning bone (equipment follows its bone).
  const bindPart = (
    boneId: string, id: string, name: string,
    geo: THREE.BufferGeometry, mat: THREE.Material,
    meta: ReturnType<typeof componentMeta>,
    skin: "analytic" | "rigid" = "rigid",
  ): THREE.SkinnedMesh => {
    const mesh = new THREE.SkinnedMesh(geo, mat);
    mesh.name = name;
    mesh.castShadow = options.castShadow ?? true;
    mesh.receiveShadow = options.receiveShadow ?? true;
    mesh.userData.sculptComponent = meta;
    mesh.userData.skinMode = skin;
    root.add(mesh);
    meshes[id] = mesh;
    colliders[id] = {};
    (skinnedParts[boneId] ??= []).push(mesh);
    return mesh;
  };

  // ------------------------------------------------------------------
  // Geometry helpers (module-scope pure THREE, deterministic)
  // ------------------------------------------------------------------
  // Uniform texel density: scale UVs so one texture tile covers ~tileWorld world
  // units. Without this, big surfaces show macro blotch while small parts average
  // the same texture into a glossy plastic read (measured on v11/v12 review).
  const TILE = 0.35;
  const tileUVs = (geo: THREE.BufferGeometry, mode: "aroundY" | "box" | "worldUnits"): THREE.BufferGeometry => {
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    if (!bb) return geo;
    const size = new THREE.Vector3();
    bb.getSize(size);
    const uv = geo.getAttribute("uv");
    if (!uv) return geo;
    if (mode === "worldUnits") {
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / TILE, uv.getY(i) / TILE);
    } else if (mode === "aroundY") {
      const circ = Math.max(1, (Math.PI * Math.max(size.x, size.z)) / TILE);
      const h = Math.max(1, Math.max(0.02, size.y) / TILE);
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ, uv.getY(i) * h);
    } else {
      const avg = Math.max(1, Math.max(0.02, (size.x + size.y + size.z) / 3) / TILE);
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * avg, uv.getY(i) * avg);
    }
    uv.needsUpdate = true;
    return geo;
  };

  const lathe = (profile: Array<[number, number]>, radial = 20): THREE.LatheGeometry =>
    tileUVs(new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(0.002, r), y)), radial), "aroundY") as THREE.LatheGeometry;

  const ellipsoid = (r: number, scale: [number, number, number], at: [number, number, number], w = 16, h = 12): THREE.BufferGeometry => {
    const g = new THREE.SphereGeometry(r, w, h);
    g.scale(scale[0], scale[1], scale[2]);
    g.translate(at[0], at[1], at[2]);
    return tileUVs(g, "aroundY");
  };

  const roundedBox = (w: number, h: number, d: number, radius = 0.012, at?: [number, number, number], rot?: [number, number, number]): THREE.BufferGeometry => {
    const shape = new THREE.Shape();
    const x0 = -w / 2, y0 = -h / 2, r = Math.min(radius, w / 2 - 0.002, h / 2 - 0.002);
    shape.moveTo(x0 + r, y0);
    shape.lineTo(x0 + w - r, y0);
    shape.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
    shape.lineTo(x0 + w, y0 + h - r);
    shape.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h);
    shape.lineTo(x0 + r, y0 + h);
    shape.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
    shape.lineTo(x0, y0 + r);
    shape.quadraticCurveTo(x0, y0, x0 + r, y0);
    const depth = Math.max(0.008, d - 0.012);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.005, bevelSegments: 2, curveSegments: 4,
    });
    geo.translate(0, 0, -depth / 2);
    if (rot) {
      geo.rotateX(rot[0]);
      geo.rotateY(rot[1]);
      geo.rotateZ(rot[2]);
    }
    if (at) geo.translate(at[0], at[1], at[2]);
    return tileUVs(geo, "worldUnits");
  };

  const torus = (radius: number, tube: number, at: [number, number, number], scale: [number, number, number] = [1, 1, 1]): THREE.BufferGeometry => {
    const g = new THREE.TorusGeometry(radius, tube, 12, 22);
    g.rotateX(Math.PI / 2); // lie horizontal (around Y)
    g.scale(scale[0], scale[1], scale[2]);
    g.translate(at[0], at[1], at[2]);
    return tileUVs(g, "aroundY");
  };

  const box = (w: number, h: number, d: number, at: [number, number, number], rot?: [number, number, number]): THREE.BufferGeometry => {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rot) {
      g.rotateX(rot[0]);
      g.rotateY(rot[1]);
      g.rotateZ(rot[2]);
    }
    g.translate(at[0], at[1], at[2]);
    return tileUVs(g, "box");
  };

  const tube = (points: Array<[number, number, number]>, radius: number): THREE.BufferGeometry =>
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2]))), 12, radius, 8, false);

  // ==================================================================
  // PIVOT HIERARCHY (named, joint-aligned; mirrors the bone chain)
  // ==================================================================
  pivotNode("root", "Operator (root)", "root", [0, -0.5, 0],
    componentMeta("root", "Operator (root)", { level: "macro", role: "body", importance: 1, primitive: "locator", parent: null, material: "m-fabric", dims: [0.01, 0.01, 0.01] }));
  pivotNode("pelvis", "Pelvis (trouser yoke)", "root", [0, -0.02, 0],
    componentMeta("pelvis", "Pelvis (trouser yoke)", { level: "macro", role: "body", importance: 0.9, primitive: "ellipsoid", parent: "root", material: "m-fabric-trouser", dims: [0.25, 0.15, 0.2] }));
  pivotNode("abdomen", "Abdomen", "pelvis", [0, 0.12, 0],
    componentMeta("abdomen", "Abdomen", { level: "macro", role: "body", importance: 0.9, primitive: "lathe", parent: "pelvis", material: "m-fabric", dims: [0.24, 0.12, 0.19] }));
  pivotNode("chest", "Chest", "abdomen", [0, 0.12, 0],
    componentMeta("chest", "Chest", { level: "macro", role: "body", importance: 1, primitive: "lathe", parent: "abdomen", material: "m-fabric", dims: [0.3, 0.16, 0.24] }));
  pivotNode("neck", "Neck", "chest", [0, 0.12, 0],
    componentMeta("neck", "Neck", { level: "macro", role: "body", importance: 0.7, primitive: "cylinder", parent: "chest", material: "m-fabric", dims: [0.08, 0.06, 0.08] }));
  pivotNode("head", "Head", "neck", [0, 0.055, 0],
    componentMeta("head", "Head", { level: "macro", role: "body", importance: 1, primitive: "sphere", parent: "neck", material: "m-fabric", dims: [0.12, 0.13, 0.12] }));
  pivotNode("clavicle-l", "Clavicle L", "chest", [0.042, 0.095, 0.01],
    componentMeta("clavicle-l", "Clavicle L", { level: "meso", role: "body", importance: 0.6, primitive: "locator", parent: "chest", material: "m-fabric", dims: [0.07, 0.03, 0.03] }));
  pivotNode("clavicle-r", "Clavicle R", "chest", [-0.042, 0.095, 0.01],
    componentMeta("clavicle-r", "Clavicle R", { level: "meso", role: "body", importance: 0.6, primitive: "locator", parent: "chest", material: "m-fabric", dims: [0.07, 0.03, 0.03] }));
  pivotNode("upper-arm-l", "Upper Arm L", "clavicle-l", [0.078, -0.015, -0.01],
    componentMeta("upper-arm-l", "Upper Arm L", { level: "macro", role: "body", importance: 0.8, primitive: "lathe", parent: "clavicle-l", material: "m-fabric", dims: [0.1, 0.165, 0.1] }),
    [0, 0, ARM_ANGLE]);
  pivotNode("upper-arm-r", "Upper Arm R", "clavicle-r", [-0.078, -0.015, -0.01],
    componentMeta("upper-arm-r", "Upper Arm R", { level: "macro", role: "body", importance: 0.8, primitive: "lathe", parent: "clavicle-r", material: "m-fabric", dims: [0.1, 0.165, 0.1] }),
    [0, 0, -ARM_ANGLE]);
  pivotNode("forearm-l", "Forearm L", "upper-arm-l", [0, -P.upperArmL, 0],
    componentMeta("forearm-l", "Forearm L", { level: "macro", role: "body", importance: 0.8, primitive: "lathe", parent: "upper-arm-l", material: "m-fabric", dims: [0.08, 0.14, 0.08] }),
    [0, 0, -0.05]);
  pivotNode("forearm-r", "Forearm R", "upper-arm-r", [0, -P.upperArmL, 0],
    componentMeta("forearm-r", "Forearm R", { level: "macro", role: "body", importance: 0.8, primitive: "lathe", parent: "upper-arm-r", material: "m-fabric", dims: [0.08, 0.14, 0.08] }),
    [0, 0, 0.05]);
  pivotNode("hand-l", "Hand L", "forearm-l", [0, -P.foreArmL, 0],
    componentMeta("hand-l", "Hand L", { level: "meso", role: "body", importance: 0.7, primitive: "sphere", parent: "forearm-l", material: "m-glove", dims: [0.07, 0.09, 0.05] }));
  pivotNode("hand-r", "Hand R", "forearm-r", [0, -P.foreArmL, 0],
    componentMeta("hand-r", "Hand R", { level: "meso", role: "body", importance: 0.7, primitive: "sphere", parent: "forearm-r", material: "m-glove", dims: [0.07, 0.09, 0.05] }));
  pivotNode("thigh-l", "Thigh L", "pelvis", [P.legX, 0.0, 0],
    componentMeta("thigh-l", "Thigh L", { level: "macro", role: "body", importance: 0.9, primitive: "lathe", parent: "pelvis", material: "m-fabric-trouser", dims: [0.12, 0.24, 0.12] }));
  pivotNode("thigh-r", "Thigh R", "pelvis", [-P.legX, 0.0, 0],
    componentMeta("thigh-r", "Thigh R", { level: "macro", role: "body", importance: 0.9, primitive: "lathe", parent: "pelvis", material: "m-fabric-trouser", dims: [0.12, 0.24, 0.12] }));
  pivotNode("shin-l", "Shin L", "thigh-l", [0, -(P.hipY - P.kneeY), 0.005],
    componentMeta("shin-l", "Shin L", { level: "macro", role: "body", importance: 0.8, primitive: "lathe", parent: "thigh-l", material: "m-fabric-trouser", dims: [0.1, 0.15, 0.1] }));
  pivotNode("shin-r", "Shin R", "thigh-r", [0, -(P.hipY - P.kneeY), 0.005],
    componentMeta("shin-r", "Shin R", { level: "macro", role: "body", importance: 0.8, primitive: "lathe", parent: "thigh-r", material: "m-fabric-trouser", dims: [0.1, 0.15, 0.1] }));
  pivotNode("foot-l", "Foot L", "shin-l", [0, -(P.kneeY - P.ankleY), -0.017],
    componentMeta("foot-l", "Foot L", { level: "macro", role: "body", importance: 0.8, primitive: "assembled", parent: "shin-l", material: "m-boot", dims: [0.1, 0.11, 0.19] }));
  pivotNode("foot-r", "Foot R", "shin-r", [0, -(P.kneeY - P.ankleY), -0.017],
    componentMeta("foot-r", "Foot R", { level: "macro", role: "body", importance: 0.8, primitive: "assembled", parent: "shin-r", material: "m-boot", dims: [0.1, 0.11, 0.19] }));

  // ==================================================================
  // BODY (skinned primaries, analytic envelope weights)
  // ==================================================================
  bindPart("pelvis", "pelvis", "Pelvis (trouser yoke)",
    (() => { const g = lathe([[0.02, -0.56], [0.075, -0.552], [0.108, -0.528], [0.115, -0.495], [0.116, -0.46]]); g.scale(1, 1, 0.8); return g; })(),
    materialMap["m-fabric-trouser"],
    componentMeta("pelvis", "Pelvis (trouser yoke)", { level: "macro", role: "body", importance: 0.9, primitive: "ellipsoid", parent: "root", material: "m-fabric-trouser", dims: [0.25, 0.15, 0.2] }),
    "analytic");
  bindPart("abdomen", "abdomen", "Abdomen",
    (() => { const g = lathe([[0.116, -0.46], [0.112, P.waistY - 0.02], [0.118, -0.38], [0.124, P.chestBotY], [0.126, -0.29]]); g.scale(1, 1, 0.79); return g; })(),
    materialMap["m-fabric"],
    componentMeta("abdomen", "Abdomen", { level: "macro", role: "body", importance: 0.9, primitive: "lathe", parent: "pelvis", material: "m-fabric", dims: [0.24, 0.12, 0.19] }),
    "analytic");
  bindPart("chest", "chest", "Chest",
    (() => { const g = lathe([[0.124, -0.3], [0.148, -0.27], [P.chestRX, -0.225], [0.14, -0.185], [0.112, P.chestTopY], [0.068, -0.146], [0.024, -0.142]]); g.scale(1, 1, 0.85); return g; })(),
    materialMap["m-fabric"],
    componentMeta("chest", "Chest", { level: "macro", role: "body", importance: 1, primitive: "lathe", parent: "abdomen", material: "m-fabric", dims: [0.3, 0.16, 0.24] }),
    "analytic");
  bindPart("neck", "neck", "Neck",
    (() => { const g = new THREE.CylinderGeometry(0.05, 0.056, P.neckBaseY - P.neckTopY + 0.01, 14, 3); g.translate(0, (P.neckBaseY + P.neckTopY) / 2, 0.004); return g; })(),
    materialMap["m-fabric"],
    componentMeta("neck", "Neck", { level: "macro", role: "body", importance: 0.7, primitive: "cylinder", parent: "chest", material: "m-fabric", dims: [0.08, 0.06, 0.08] }),
    "analytic");
  bindPart("head", "head", "Head (skull)",
    ellipsoid(0.05, [0.82, 0.95, 0.86], [0, -0.082, 0.004]),
    materialMap["m-fabric"],
    componentMeta("head", "Head (skull)", { level: "macro", role: "body", importance: 0.8, primitive: "sphere", parent: "neck", material: "m-fabric", dims: [0.09, 0.1, 0.09] }),
    "analytic");

  for (const side of ["l", "r"] as const) {
    const sx = side === "l" ? 1 : -1;
    bindPart(`thigh-${side}`, `thigh-${side}`, `Thigh ${side}`,
      (() => { const g = lathe([[0.063, -0.475], [0.061, P.hipY - 0.02], [0.058, -0.58], [0.052, -0.68], [0.048, P.kneeY + 0.008]]); g.scale(1, 1, 1.04); g.translate(sx * P.legX, 0, 0); return g; })(),
      materialMap["m-fabric-trouser"],
      componentMeta(`thigh-${side}`, `Thigh ${side}`, { level: "macro", role: "body", importance: 0.9, primitive: "lathe", parent: "pelvis", material: "m-fabric-trouser", dims: [0.12, 0.24, 0.12] }),
      "analytic");
    bindPart(`shin-${side}`, `shin-${side}`, `Shin ${side}`,
      (() => { const g = lathe([[0.047, P.kneeY], [0.05, -0.795], [0.044, -0.845], [0.034, P.ankleY + 0.005]]); g.scale(1, 1, 1.05); g.translate(sx * P.legX, 0, 0.005); return g; })(),
      materialMap["m-fabric-trouser"],
      componentMeta(`shin-${side}`, `Shin ${side}`, { level: "macro", role: "body", importance: 0.8, primitive: "lathe", parent: `thigh-${side}`, material: "m-fabric-trouser", dims: [0.1, 0.15, 0.1] }),
      "analytic");
    // Boot: shaft + foot mass + sole + lace panel, all following the foot bone.
    bindPart(`foot-${side}`, `boot-shaft-${side}`, `Boot shaft ${side}`,
      (() => { const g = lathe([[0.036, -0.885], [0.038, -0.93], [0.04, -0.958]], 18); g.translate(sx * P.legX, 0, 0.005); return g; })(),
      materialMap["m-boot"],
      componentMeta(`boot-shaft-${side}`, `Boot shaft ${side}`, { level: "meso", role: "gear", importance: 0.8, primitive: "lathe", parent: `foot-${side}`, material: "m-boot", dims: [0.09, 0.06, 0.09] }));
    bindPart(`foot-${side}`, `boot-foot-${side}`, `Boot foot ${side}`,
      ellipsoid(0.046, [0.95, 0.54, 1.62], [sx * P.legX, -0.963, 0.043]),
      materialMap["m-boot"],
      componentMeta(`boot-foot-${side}`, `Boot foot ${side}`, { level: "meso", role: "gear", importance: 0.8, primitive: "ellipsoid", parent: `foot-${side}`, material: "m-boot", dims: [0.09, 0.07, 0.18] }));
    bindPart(`foot-${side}`, `boot-sole-${side}`, `Boot sole ${side}`,
      roundedBox(0.086, 0.02, 0.155, 0.009, [sx * P.legX, -0.989, 0.036]),
      materialMap["m-rubber"],
      componentMeta(`boot-sole-${side}`, `Boot sole ${side}`, { level: "micro", role: "gear", importance: 0.6, primitive: "box", parent: `foot-${side}`, material: "m-rubber", dims: [0.1, 0.028, 0.195] }));
  }

  // ==================================================================
  // HEAD ASSEMBLY (helmet, goggles, face covering, neck wrap) — skinned head
  // ==================================================================
  const headGear: THREE.Object3D[] = [];
  const headPart = (id: string, name: string, matId: string, geo: THREE.BufferGeometry, mat: THREE.Material, importance: number, dims: [number, number, number]) => {
    const m = bindPart("head", id, name, geo, mat,
      componentMeta(id, name, { level: "meso", role: "gear", importance, primitive: "assembled", parent: "head", material: matId, dims }));
    headGear.push(m);
    return m;
  };
  headPart("helmet-shell", "Helmet shell", "m-polymer",
    ellipsoid(P.helmetR, [0.98, 0.92, 1.14], [0, P.helmetCY, 0.002]),
    materialMap["m-polymer"], 1, [0.12, 0.11, 0.13]);
  headPart("helmet-shroud", "Helmet NVG shroud", "m-hardware",
    box(0.026, 0.018, 0.012, [0, -0.044, 0.058]),
    materialMap["m-hardware"], 0.6, [0.032, 0.022, 0.016]);
  headPart("helmet-rail-l", "Helmet rail L", "m-hardware",
    box(0.011, 0.014, 0.085, [0.057, -0.046, 0.004]),
    materialMap["m-hardware"], 0.5, [0.011, 0.014, 0.085]);
  headPart("helmet-rail-r", "Helmet rail R", "m-hardware",
    box(0.011, 0.014, 0.085, [-0.057, -0.046, 0.004]),
    materialMap["m-hardware"], 0.5, [0.011, 0.014, 0.085]);
  headPart("goggle-band", "Goggle band", "m-carrier",
    torus(0.06, 0.013, [0, P.goggleY, 0.004], [1.06, 0.52, 1.04]),
    materialMap["m-carrier"], 0.9, [0.13, 0.035, 0.12]);
  headPart("goggle-lens-l", "Goggle lens L", "m-lens",
    (() => { const g = new THREE.CylinderGeometry(P.lensR, P.lensR, 0.01, 16); g.rotateX(Math.PI / 2); g.translate(0.027, P.goggleY, 0.056); return g; })(),
    materialMap["m-lens"], 0.8, [0.048, 0.02, 0.01]);
  headPart("goggle-lens-r", "Goggle lens R", "m-lens",
    (() => { const g = new THREE.CylinderGeometry(P.lensR, P.lensR, 0.01, 16); g.rotateX(Math.PI / 2); g.translate(-0.027, P.goggleY, 0.056); return g; })(),
    materialMap["m-lens"], 0.8, [0.048, 0.02, 0.01]);
  headPart("face-mask", "Face covering", "m-carrier",
    ellipsoid(0.055, [0.95, 1.15, 1.02], [0, -0.108, 0.01]),
    materialMap["m-carrier"], 0.9, [0.08, 0.09, 0.085]);
  headPart("neck-wrap-upper", "Neck wrap (upper)", "m-fabric",
    torus(0.058, 0.024, [0, -0.15, 0.002], [1.0, 1, 1.0]),
    materialMap["m-fabric"], 0.8, [0.16, 0.055, 0.15]);
  destructionGroups["head-gear"] = headGear;

  // ==================================================================
  // PLATE CARRIER + CHEST KIT — skinned chest
  // ==================================================================
  const carrierParts: THREE.Object3D[] = [];
  const chestPart = (id: string, name: string, geo: THREE.BufferGeometry, mat: THREE.Material, importance: number, dims: [number, number, number]) => {
    const m = bindPart("chest", id, name, geo, mat,
      componentMeta(id, name, { level: "meso", role: "gear", importance, primitive: "assembled", parent: "chest", material: "chest-gear", dims }));
    carrierParts.push(m);
    return m;
  };
  chestPart("collar", "Collar flare",
    (() => { const g = lathe([[0.05, P.neckBaseY + 0.025], [0.095, P.neckBaseY - 0.028], [0.05, P.neckBaseY - 0.03]], 18); return g; })(),
    materialMap["m-fabric"], 0.7, [0.18, 0.05, 0.18]);
  chestPart("carrier-front", "Carrier front plate bag",
    roundedBox(0.17, 0.115, 0.046, 0.02, [0, -0.292, 0.1]),
    materialMap["m-carrier"], 1, [0.21, 0.135, 0.046]);
  chestPart("carrier-molle-a", "Carrier MOLLE ridge A",
    box(0.15, 0.011, 0.007, [0, -0.262, 0.125]),
    materialMap["m-carrier"], 0.4, [0.26, 0.012, 0.008]);
  chestPart("carrier-molle-b", "Carrier MOLLE ridge B",
    box(0.15, 0.011, 0.007, [0, -0.29, 0.125]),
    materialMap["m-carrier"], 0.4, [0.26, 0.012, 0.008]);
  chestPart("carrier-molle-c", "Carrier MOLLE ridge C",
    box(0.15, 0.011, 0.007, [0, -0.316, 0.125]),
    materialMap["m-carrier"], 0.4, [0.26, 0.012, 0.008]);
  const magRow: THREE.Object3D[] = [];
  for (const [i, mx] of [-0.076, 0, 0.076].entries()) {
    magRow.push(chestPart(`mag-pouch-${i + 1}`, `Mag pouch ${i + 1}`,
      roundedBox(0.07, 0.09, 0.05, 0.01, [mx, -0.372, 0.136]),
      materialMap["m-carrier"], 0.9, [0.068, 0.078, 0.046]));
    magRow.push(chestPart(`mag-flap-${i + 1}`, `Mag flap ${i + 1}`,
      box(0.074, 0.014, 0.054, [mx, -0.33, 0.14], [-0.22, 0, 0]),
      materialMap["m-carrier"], 0.6, [0.07, 0.014, 0.05]));
  }
  destructionGroups["mag-pouches"] = magRow;
  chestPart("radio-box", "Radio pouch",
    roundedBox(0.042, 0.072, 0.028, 0.008, [-0.094, -0.204, 0.12], [0, 0, 0.06]),
    materialMap["m-carrier"], 0.7, [0.042, 0.072, 0.028]);
  chestPart("radio-cable", "Radio cable",
    tube([[-0.09, -0.172, 0.11], [-0.07, -0.11, 0.084], [-0.04, -0.072, 0.046]], 0.004),
    materialMap["m-hardware"], 0.5, [0.01, 0.11, 0.01]);
  chestPart("carrier-side-l", "Carrier side pouch L",
    roundedBox(0.042, 0.1, 0.062, 0.012, [0.112, -0.30, 0.012]),
    materialMap["m-carrier"], 0.7, [0.046, 0.1, 0.062]);
  chestPart("carrier-side-r", "Carrier side pouch R",
    roundedBox(0.042, 0.1, 0.062, 0.012, [-0.112, -0.30, 0.012]),
    materialMap["m-carrier"], 0.7, [0.046, 0.1, 0.062]);
  chestPart("strap-l", "Shoulder strap L",
    tube([[0.072, -0.19, 0.1], [0.09, -0.162, 0.02], [0.082, -0.168, -0.055]], 0.017),
    materialMap["m-carrier"], 0.8, [0.05, 0.03, 0.18]);
  chestPart("strap-r", "Shoulder strap R",
    tube([[-0.072, -0.19, 0.1], [-0.09, -0.162, 0.02], [-0.082, -0.168, -0.055]], 0.017),
    materialMap["m-carrier"], 0.8, [0.05, 0.03, 0.18]);
  chestPart("strap-pad-l", "Shoulder pad L",
    roundedBox(0.056, 0.012, 0.095, 0.006, [0.082, -0.168, -0.008], [0, 0, -0.16]),
    materialMap["m-carrier"], 0.6, [0.062, 0.018, 0.11]);
  chestPart("strap-pad-r", "Shoulder pad R",
    roundedBox(0.056, 0.012, 0.095, 0.006, [-0.082, -0.168, -0.008], [0, 0, 0.16]),
    materialMap["m-carrier"], 0.6, [0.062, 0.018, 0.11]);
  chestPart("sternum-strap", "Sternum strap",
    box(0.052, 0.013, 0.008, [0, -0.192, 0.145]),
    materialMap["m-carrier"], 0.5, [0.052, 0.013, 0.008]);
  chestPart("backpack-body", "Backpack body",
    roundedBox(0.22, 0.23, 0.06, 0.024, [0, -0.302, -0.106]),
    materialMap["m-carrier"], 0.95, [0.24, 0.26, 0.062]);
  chestPart("backpack-pouch-l", "Backpack side pouch L",
    roundedBox(0.048, 0.13, 0.05, 0.01, [0.122, -0.30, -0.078]),
    materialMap["m-carrier"], 0.6, [0.052, 0.13, 0.048]);
  chestPart("backpack-pouch-r", "Backpack side pouch R",
    roundedBox(0.048, 0.13, 0.05, 0.01, [-0.122, -0.30, -0.078]),
    materialMap["m-carrier"], 0.6, [0.052, 0.13, 0.048]);
  chestPart("rear-radio", "Rear radio pouch",
    roundedBox(0.05, 0.072, 0.032, 0.008, [-0.094, -0.208, -0.13]),
    materialMap["m-carrier"], 0.6, [0.05, 0.072, 0.032]);
  chestPart("antenna-base", "Antenna base",
    (() => { const g = new THREE.CylinderGeometry(0.009, 0.011, 0.02, 10); g.translate(-0.094, -0.168, -0.132); return g; })(),
    materialMap["m-hardware"], 0.4, [0.02, 0.024, 0.02]);
  chestPart("antenna", "Antenna",
    (() => { const g = new THREE.CylinderGeometry(0.0035, 0.005, 0.17, 8); g.rotateX(0.14); g.translate(-0.094, -0.075, -0.148); return g; })(),
    materialMap["m-hardware"], 0.5, [0.01, 0.24, 0.01]);
  destructionGroups["carrier"] = carrierParts;

  // ==================================================================
  // BELT + WAIST KIT — skinned pelvis
  // ==================================================================
  const beltParts: THREE.Object3D[] = [];
  const pelvisPart = (id: string, name: string, geo: THREE.BufferGeometry, mat: THREE.Material, importance: number, dims: [number, number, number]) => {
    const m = bindPart("pelvis", id, name, geo, mat,
      componentMeta(id, name, { level: "meso", role: "gear", importance, primitive: "assembled", parent: "pelvis", material: "belt-kit", dims }));
    beltParts.push(m);
    return m;
  };
  pelvisPart("belt", "Duty belt",
    (() => { const g = new THREE.CylinderGeometry(0.131, 0.131, 0.042, 24, 1, false); g.scale(1, 1, 0.84); g.translate(0, -0.425, 0); return g; })(),
    materialMap["m-carrier"], 0.9, [0.26, 0.042, 0.22]);
  pelvisPart("belt-buckle", "Belt buckle",
    box(0.03, 0.02, 0.012, [0, -0.425, 0.111]),
    materialMap["m-hardware"], 0.5, [0.03, 0.02, 0.012]);
  pelvisPart("belt-pouch-l", "Belt pouch L",
    roundedBox(0.052, 0.07, 0.04, 0.01, [-0.102, -0.452, 0.096]),
    materialMap["m-carrier"], 0.7, [0.052, 0.076, 0.04]);
  pelvisPart("belt-dump-pouch", "Dump pouch",
    roundedBox(0.066, 0.082, 0.044, 0.012, [0.062, -0.452, 0.094]),
    materialMap["m-carrier"], 0.7, [0.068, 0.088, 0.046]);
  pelvisPart("belt-pouch-back-l", "Belt pouch back L",
    roundedBox(0.05, 0.068, 0.045, 0.01, [-0.112, -0.452, -0.058]),
    materialMap["m-carrier"], 0.6, [0.05, 0.068, 0.045]);
  pelvisPart("belt-pouch-back-r", "Belt pouch back R",
    roundedBox(0.045, 0.06, 0.04, 0.01, [0.112, -0.45, -0.05]),
    materialMap["m-carrier"], 0.6, [0.045, 0.06, 0.04]);
  pelvisPart("buttpack", "Butt pack",
    roundedBox(0.12, 0.08, 0.046, 0.015, [0, -0.452, -0.104]),
    materialMap["m-carrier"], 0.7, [0.13, 0.09, 0.05]);
  destructionGroups["belt-kit"] = beltParts;

  // ==================================================================
  // THIGH RIG (character-right) + admin pouch — skinned thighs
  // ==================================================================
  bindPart("thigh-r", "holster-body", "Holster body",
    roundedBox(0.046, 0.15, 0.058, 0.012, [-0.088, -0.605, 0.042], [0.08, 0, 0.03]),
    materialMap["m-carrier"],
    componentMeta("holster-body", "Holster body", { level: "meso", role: "gear", importance: 0.8, primitive: "assembled", parent: "thigh-r", material: "m-carrier", dims: [0.048, 0.15, 0.06] }));
  bindPart("thigh-r", "holster-strap-a", "Holster strap A",
    torus(0.062, 0.007, [-P.legX, -0.575, 0]),
    materialMap["m-carrier"],
    componentMeta("holster-strap-a", "Holster strap A", { level: "micro", role: "gear", importance: 0.5, primitive: "torus", parent: "thigh-r", material: "m-carrier", dims: [0.13, 0.014, 0.13] }));
  bindPart("thigh-r", "holster-strap-b", "Holster strap B",
    torus(0.058, 0.007, [-P.legX, -0.64, 0]),
    materialMap["m-carrier"],
    componentMeta("holster-strap-b", "Holster strap B", { level: "micro", role: "gear", importance: 0.5, primitive: "torus", parent: "thigh-r", material: "m-carrier", dims: [0.125, 0.014, 0.125] }));
  bindPart("thigh-r", "thigh-pouch-r", "Thigh pouch R",
    roundedBox(0.046, 0.066, 0.036, 0.01, [-0.09, -0.672, 0.058]),
    materialMap["m-carrier"],
    componentMeta("thigh-pouch-r", "Thigh pouch R", { level: "micro", role: "gear", importance: 0.6, primitive: "assembled", parent: "thigh-r", material: "m-carrier", dims: [0.046, 0.066, 0.036] }));
  bindPart("thigh-l", "thigh-pouch-l", "Admin pouch L",
    roundedBox(0.04, 0.056, 0.03, 0.008, [0.088, -0.615, 0.06]),
    materialMap["m-carrier"],
    componentMeta("thigh-pouch-l", "Admin pouch L", { level: "micro", role: "gear", importance: 0.5, primitive: "assembled", parent: "thigh-l", material: "m-carrier", dims: [0.04, 0.056, 0.03] }));

  // ==================================================================
  // KNEE PADS — skinned thighs (sit on the knee cap)
  // ==================================================================
  for (const side of ["l", "r"] as const) {
    const sx = side === "l" ? 1 : -1;
    bindPart(`thigh-${side}`, `kneepad-${side}`, `Knee pad ${side}`,
      ellipsoid(0.05, [0.98, 0.82, 0.3], [sx * P.legX, P.kneeY - 0.005, 0.026]),
      materialMap["m-polymer"],
      componentMeta(`kneepad-${side}`, `Knee pad ${side}`, { level: "meso", role: "gear", importance: 0.8, primitive: "ellipsoid", parent: `thigh-${side}`, material: "m-polymer", dims: [0.097, 0.112, 0.079] }));
    bindPart(`thigh-${side}`, `kneepad-strap-top-${side}`, `Knee pad strap top ${side}`,
      box(0.014, 0.018, 0.095, [sx * P.legX, P.kneeY + 0.052, 0.012]),
      materialMap["m-fabric-trouser"],
      componentMeta(`kneepad-strap-top-${side}`, `Knee pad strap top ${side}`, { level: "micro", role: "gear", importance: 0.4, primitive: "box", parent: `thigh-${side}`, material: "m-fabric-trouser", dims: [0.014, 0.018, 0.095] }));
    bindPart(`shin-${side}`, `kneepad-strap-bot-${side}`, `Knee pad strap bottom ${side}`,
      box(0.014, 0.016, 0.09, [sx * P.legX, P.kneeY - 0.05, 0.008]),
      materialMap["m-fabric-trouser"],
      componentMeta(`kneepad-strap-bot-${side}`, `Knee pad strap bottom ${side}`, { level: "micro", role: "gear", importance: 0.4, primitive: "box", parent: `shin-${side}`, material: "m-fabric-trouser", dims: [0.014, 0.016, 0.09] }));
  }

  // Thigh cargo pockets (skinned thighs)
  for (const side of ["l", "r"] as const) {
    const sx = side === "l" ? 1 : -1;
    bindPart(`thigh-${side}`, `cargo-${side}`, `Cargo pocket ${side}`,
      roundedBox(0.03, 0.095, 0.066, 0.012, [sx * 0.116, -0.60, 0.008], [0, sx * -0.08, 0]),
      materialMap["m-fabric-trouser"],
      componentMeta(`cargo-${side}`, `Cargo pocket ${side}`, { level: "meso", role: "gear", importance: 0.6, primitive: "assembled", parent: `thigh-${side}`, material: "m-fabric-trouser", dims: [0.03, 0.095, 0.066] }));
    bindPart(`thigh-${side}`, `cargo-flap-${side}`, `Cargo flap ${side}`,
      box(0.032, 0.016, 0.07, [sx * 0.118, -0.558, 0.008], [0, sx * -0.08, 0]),
      materialMap["m-fabric-trouser"],
      componentMeta(`cargo-flap-${side}`, `Cargo flap ${side}`, { level: "micro", role: "gear", importance: 0.4, primitive: "box", parent: `thigh-${side}`, material: "m-fabric-trouser", dims: [0.032, 0.016, 0.07] }));
  }

  // Knee pad retention straps (skinned thighs)
  // ==================================================================
  // ARMS (rigid meshes under named pivot chains — the arm contract)
  // ==================================================================
  for (const side of ["l", "r"] as const) {
    const sx = side === "l" ? 1 : -1;
    attachMesh(`deltoid-${side}`, `Deltoid ${side}`,
      ellipsoid(0.052, [1.0, 0.9, 1.0], [0, -0.03, 0], 16, 12),
      materialMap["m-fabric"], `upper-arm-${side}`,
      componentMeta(`deltoid-${side}`, `Deltoid ${side}`, { level: "meso", role: "body", importance: 0.7, primitive: "sphere", parent: `upper-arm-${side}`, material: "m-fabric", dims: [0.126, 0.114, 0.12] }));
    attachMesh(`upper-arm-${side}`, `Upper arm ${side}`,
      lathe([[0.062, 0.02], [0.054, -0.08], [0.047, -P.upperArmL + 0.01]], 18),
      materialMap["m-fabric"], `upper-arm-${side}`,
      componentMeta(`upper-arm-${side}`, `Upper arm ${side}`, { level: "macro", role: "body", importance: 0.8, primitive: "lathe", parent: `upper-arm-${side}`, material: "m-fabric", dims: [0.1, 0.18, 0.1] }));
    attachMesh(`elbow-${side}`, `Elbow ${side}`,
      ellipsoid(0.036, [1, 0.9, 1], [0, -0.008, 0], 14, 10),
      materialMap["m-fabric"], `forearm-${side}`,
      componentMeta(`elbow-${side}`, `Elbow ${side}`, { level: "meso", role: "body", importance: 0.6, primitive: "sphere", parent: `forearm-${side}`, material: "m-fabric", dims: [0.082, 0.082, 0.082] }));
    attachMesh(`forearm-${side}`, `Forearm ${side}`,
      lathe([[0.049, 0.015], [0.041, -0.07], [P.wristR, -P.foreArmL + 0.012]], 18),
      materialMap["m-fabric"], `forearm-${side}`,
      componentMeta(`forearm-${side}`, `Forearm ${side}`, { level: "macro", role: "body", importance: 0.8, primitive: "lathe", parent: `forearm-${side}`, material: "m-fabric", dims: [0.08, 0.15, 0.08] }));
    attachMesh(`cuff-${side}`, `Sleeve cuff ${side}`,
      (() => { const g = new THREE.CylinderGeometry(0.034, 0.03, 0.028, 14); g.translate(0, -P.foreArmL + 0.022, 0); return g; })(),
      materialMap["m-fabric"], `forearm-${side}`,
      componentMeta(`cuff-${side}`, `Sleeve cuff ${side}`, { level: "micro", role: "gear", importance: 0.4, primitive: "cylinder", parent: `forearm-${side}`, material: "m-fabric", dims: [0.066, 0.03, 0.066] }));
    // Glove (hand mass + hard knuckle plate + cuff) under the hand pivot.
    attachMesh(`hand-${side}`, `Hand ${side}`,
      ellipsoid(0.039, [0.78, 1.1, 0.95], [0, -0.03, 0.002], 14, 10),
      materialMap["m-glove"], `hand-${side}`,
      componentMeta(`hand-${side}`, `Hand ${side}`, { level: "meso", role: "body", importance: 0.7, primitive: "sphere", parent: `hand-${side}`, material: "m-glove", dims: [0.053, 0.076, 0.065] }));
    attachMesh(`knuckle-${side}`, `Knuckle plate ${side}`,
      roundedBox(0.05, 0.03, 0.014, 0.006, [0, -0.02, 0.028]),
      materialMap["m-polymer"], `hand-${side}`,
      componentMeta(`knuckle-${side}`, `Knuckle plate ${side}`, { level: "micro", role: "gear", importance: 0.5, primitive: "box", parent: `hand-${side}`, material: "m-polymer", dims: [0.05, 0.03, 0.018] }));
  }

  // ==================================================================
  // WEAPON SOCKET (locator only — no weapon geometry in the body mesh)
  // ==================================================================
  const socketMeta = componentMeta("weapon-socket", "Weapon attachment socket (hand-r grip)", {
    level: "micro", role: "socket", importance: 0.5, primitive: "locator", parent: "hand-r", material: "m-hardware", dims: [0.02, 0.02, 0.02],
  });
  const socketNode = pivotNode("weapon-socket", "Weapon attachment socket (hand-r grip)", "hand-r", [0, -0.03, 0.02], socketMeta);
  sockets["weapon-socket"] = socketNode;
  attachMesh("weapon-socket-mesh", "Weapon attachment socket (hand-r grip)",
    box(0.02, 0.02, 0.02, [0, 0, 0]), materialMap["m-hardware"], "weapon-socket", socketMeta);

  // ==================================================================
  // OPTIMIZATION PASS — merge same-material static geometry per articulated
  // group. Articulated groups (skinned bones, arm pivots, sockets) are kept;
  // only static siblings sharing a parent and material are fused. Runs before
  // the bind protocol so skin attributes are generated once on merged meshes.
  // ==================================================================
  {
    let mergedCount = 0;
    const fuseGroup = (
      meshesToFuse: THREE.Mesh[],
      parent: THREE.Object3D,
      bakeIntoGeometry: boolean,
      primaryId: string,
      skinned = false,
    ): void => {
      if (meshesToFuse.length < 2) return;
      const geos: THREE.BufferGeometry[] = [];
      for (const m of meshesToFuse) {
        m.updateMatrix();
        let g = m.geometry.clone();
        if (bakeIntoGeometry) g.applyMatrix4(m.matrix);
        // ExtrudeGeometry is non-indexed while primitive lathes/spheres are indexed;
        // mergeGeometries refuses mixed sets, so normalize to non-indexed.
        if (geos.length === 0 && g.index) g = g.toNonIndexed();
        else if (!g.index) geos.forEach((prev, i) => { geos[i] = prev.index ? prev.toNonIndexed() : prev; });
        else if (!geos.every((prev) => !!prev.index) ) g = g.toNonIndexed();
        geos.push(g);
      }
      const normalized: THREE.BufferGeometry[] = [];
      const anyIndexed = geos.some((g) => !!g.index);
      for (const g of geos) normalized.push(anyIndexed && !g.index ? g.toNonIndexed() : g);
      geos.length = 0;
      geos.push(...normalized);
      const merged = mergeGeometries(geos, false);
      if (!merged) return;
      const first = meshesToFuse[0];
      const mergedMesh: THREE.Mesh = skinned
        ? new THREE.SkinnedMesh(merged, first.material as THREE.Material)
        : new THREE.Mesh(merged, first.material as THREE.Material);
      mergedMesh.name = first.name + " (merged)";
      mergedMesh.position.set(0, 0, 0);
      mergedMesh.rotation.set(0, 0, 0);
      mergedMesh.castShadow = options.castShadow ?? true;
      mergedMesh.receiveShadow = options.receiveShadow ?? true;
      mergedMesh.userData.sculptComponent = first.userData.sculptComponent;
      mergedMesh.userData.mergedFrom = meshesToFuse.map((m) => m.name);
      parent.add(mergedMesh);
      for (const m of meshesToFuse) {
        parent.remove(m);
        m.geometry.dispose();
        for (const [id, mesh] of Object.entries(meshes)) {
          if (mesh === m) delete meshes[id];
        }
      }
      meshes[primaryId] = mergedMesh;
      colliders[primaryId] = colliders[primaryId] ?? {};
      mergedCount += 1;
    };

    // Skinned gear: group per owning bone + material (geometries already model-space).
    for (const boneId of Object.keys(skinnedParts)) {
      const byMaterial = new Map<THREE.Material, THREE.Mesh[]>();
      const kept: THREE.SkinnedMesh[] = [];
      for (const mesh of skinnedParts[boneId]) {
        if (mesh.userData.skinMode !== "rigid") { kept.push(mesh); continue; }
        const key = mesh.material as THREE.Material;
        const list = byMaterial.get(key) ?? [];
        list.push(mesh);
        byMaterial.set(key, list);
      }
      const next: THREE.SkinnedMesh[] = [...kept];
      let seq = 0;
      for (const [, list] of byMaterial) {
        if (list.length < 2) { next.push(...(list as THREE.SkinnedMesh[])); continue; }
        const primaryId = `${boneId}-gear-${++seq}`;
        fuseGroup(list, root, false, primaryId, true);
        const mergedMesh = meshes[primaryId];
        if (mergedMesh) {
          mergedMesh.userData.skinMode = "rigid";
          next.push(mergedMesh as THREE.SkinnedMesh);
        } else {
          next.push(...(list as THREE.SkinnedMesh[]));
        }
      }
      skinnedParts[boneId] = next;
    }

    // Pivot-attached static props (arm chains, socket): same parent + same material.
    for (const node of Object.values(nodes)) {
      const props = node.children.filter(
        (c): c is THREE.Mesh => (c as THREE.Mesh).isMesh === true,
      );
      if (props.length < 2) continue;
      const byMaterial = new Map<THREE.Material, THREE.Mesh[]>();
      for (const m of props) {
        const key = m.material as THREE.Material;
        const list = byMaterial.get(key) ?? [];
        list.push(m);
        byMaterial.set(key, list);
      }
      for (const [mat, list] of byMaterial) {
        if (list.length < 2) continue;
        const primaryId = `merged-${node.name}-${(mat as THREE.Material).id}`;
        fuseGroup(list, node, true, primaryId);
      }
    }
    root.userData.optimizationPass = { mergedMeshGroups: mergedCount, note: "static same-material siblings fused per articulated group; sockets and skin modes preserved" };
  }

  // ==================================================================
  // BONE HIERARCHY (bound skeleton: spine + legs; arms are pivot chains)
  // ==================================================================
  const bones: Record<string, THREE.Bone> = {};
  const boneOrder: string[] = [];
  const addBone = (id: string, parent: string | null, position: [number, number, number]) => {
    const bone = new THREE.Bone();
    bone.name = id;
    bone.position.set(position[0], position[1], position[2]);
    (parent ? bones[parent] : root).add(bone);
    bones[id] = bone;
    boneOrder.push(id);
  };
  addBone("pelvis", null, [0, -0.52, 0]);
  addBone("abdomen", "pelvis", [0, 0.12, 0]);
  addBone("chest", "abdomen", [0, 0.12, 0]);
  addBone("neck", "chest", [0, 0.12, 0]);
  addBone("head", "neck", [0, 0.055, 0]);
  addBone("thigh-l", "pelvis", [P.legX, 0, 0]);
  addBone("thigh-r", "pelvis", [-P.legX, 0, 0]);
  addBone("shin-l", "thigh-l", [0, -(P.hipY - P.kneeY), 0.005]);
  addBone("shin-r", "thigh-r", [0, -(P.hipY - P.kneeY), 0.005]);
  addBone("foot-l", "shin-l", [0, -(P.kneeY - P.ankleY), -0.017]);
  addBone("foot-r", "shin-r", [0, -(P.kneeY - P.ankleY), -0.017]);

  // The bones are now in REST position. updateMatrixWorld() before constructing the
  // Skeleton is load-bearing: calculateInverses() reads each bone's CURRENT world
  // matrix, and those inverses are what cancel the rest pose during skinning.
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(boneOrder.map((id) => bones[id]));
  const boneIndexOf = new Map<string, number>(boneOrder.map((id, i) => [id, i]));

  // Analytic envelope segments (model space) for the primary body masses.
  const BONE_JOINT: Record<string, number[]> = {
    pelvis: [0, -0.52, 0], abdomen: [0, -0.4, 0], chest: [0, -0.28, 0],
    neck: [0, -0.16, 0], head: [0, -0.105, 0],
    "thigh-l": [P.legX, -0.52, 0], "thigh-r": [-P.legX, -0.52, 0],
    "shin-l": [P.legX, P.kneeY, 0.005], "shin-r": [-P.legX, P.kneeY, 0.005],
    "foot-l": [P.legX, -0.9, -0.012], "foot-r": [-P.legX, -0.9, -0.012],
  };
  const BONE_TIP: Record<string, number[]> = {
    pelvis: [0, -0.4, 0], abdomen: [0, -0.28, 0], chest: [0, -0.16, 0],
    neck: [0, -0.105, 0], head: [0, -0.02, 0.01],
    "thigh-l": [P.legX, P.kneeY, 0.005], "thigh-r": [-P.legX, P.kneeY, 0.005],
    "shin-l": [P.legX, -0.9, -0.012], "shin-r": [-P.legX, -0.9, -0.012],
    "foot-l": [P.legX, -0.985, 0.055], "foot-r": [-P.legX, -0.985, 0.055],
  };
  const BONE_ENVELOPE: Record<string, number> = {
    pelvis: 0.12, abdomen: 0.11, chest: 0.16, neck: 0.05, head: 0.08,
    "thigh-l": 0.075, "thigh-r": 0.075, "shin-l": 0.06, "shin-r": 0.06,
    "foot-l": 0.045, "foot-r": 0.045,
  };
  const _closest = new THREE.Vector3();
  const distanceToSegment = (p: THREE.Vector3, s: number[], e: number[]): number => {
    const ab = [e[0] - s[0], e[1] - s[1], e[2] - s[2]];
    const ap = [p.x - s[0], p.y - s[1], p.z - s[2]];
    const abLenSq = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
    const t = abLenSq > 1e-12
      ? THREE.MathUtils.clamp((ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / abLenSq, 0, 1)
      : 0;
    _closest.set(s[0] + ab[0] * t, s[1] + ab[1] * t, s[2] + ab[2] * t);
    return p.distanceTo(_closest);
  };
  const computeVertexWeights = (p: THREE.Vector3) => {
    const scored = boneOrder.map((id) => {
      const d = distanceToSegment(p, BONE_JOINT[id], BONE_TIP[id]);
      const u = d / BONE_ENVELOPE[id];
      const falloff = Math.max(0, 1 - u * u);
      return { id, d, w: falloff * falloff };
    });
    scored.sort((a, b) => b.w - a.w);
    const kept = scored.slice(0, 4);
    const total = kept.reduce((sum, c) => sum + c.w, 0);
    const indices = [0, 0, 0, 0];
    const weights = [0, 0, 0, 0];
    if (total > 0) {
      for (let slot = 0; slot < kept.length; slot++) {
        indices[slot] = boneIndexOf.get(kept[slot].id) ?? 0;
        weights[slot] = kept[slot].w / total;
      }
      return { indices, weights, fallback: false };
    }
    // Zero-sum fallback: pin weight 1.0 to the absolutely nearest bone rather than
    // let normalizeSkinWeights() spike the vertex at bone 0.
    let nearest = boneOrder[0];
    let nearestDistance = Infinity;
    for (const id of boneOrder) {
      const d = distanceToSegment(p, BONE_JOINT[id], BONE_TIP[id]);
      if (d < nearestDistance) { nearest = id; nearestDistance = d; }
    }
    indices[0] = boneIndexOf.get(nearest) ?? 0;
    weights[0] = 1;
    return { indices, weights, fallback: true };
  };

  // ---- bind protocol: geometry is already model-space (meshes at identity), so the
  // world bake is a verified no-op guard; analytic weights for primaries, rigid
  // weights (owning bone, 1.0) for equipment so animation carries gear along.
  root.updateMatrixWorld(true);
  const skinnedMeshNames: string[] = [];
  let boundCount = 0;
  let expectedBound = 0;
  const vertex = new THREE.Vector3();
  for (const boneId of boneOrder) {
    const parts = skinnedParts[boneId] ?? [];
    for (const mesh of parts) {
      expectedBound += 1;
      const position = mesh.geometry.getAttribute("position");
      if (!position) continue;
      mesh.updateWorldMatrix(true, false);
      if (mesh.geometry.userData.worldBaked) {
        throw new Error(
          `geometry for '${mesh.name}' is already world-baked; baking twice squares the ` +
          "world matrix and scatters the parts. Build a fresh factory instead of re-binding.",
        );
      }
      mesh.geometry.applyMatrix4(mesh.matrixWorld);
      mesh.geometry.userData.worldBaked = true;
      root.add(mesh);
      mesh.position.set(0, 0, 0);
      mesh.quaternion.identity();
      mesh.scale.set(1, 1, 1);
      mesh.updateMatrixWorld(true);
      const count = position.count;
      const skinIndices = new Uint16Array(count * 4);
      const skinWeights = new Float32Array(count * 4);
      const rigid = mesh.userData.skinMode !== "analytic";
      for (let v = 0; v < count; v++) {
        if (rigid) {
          skinIndices[v * 4] = boneIndexOf.get(boneId) ?? 0;
          skinWeights[v * 4] = 1;
        } else {
          vertex.fromBufferAttribute(position, v);
          const { indices, weights } = computeVertexWeights(vertex);
          for (let slot = 0; slot < 4; slot++) {
            skinIndices[v * 4 + slot] = indices[slot];
            skinWeights[v * 4 + slot] = weights[slot];
          }
        }
      }
      mesh.geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndices, 4));
      mesh.geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeights, 4));
      skinnedMeshNames.push(mesh.name);
      mesh.bind(skeleton, new THREE.Matrix4());
      // A SkinnedMesh's boundingSphere is computed from its REST vertex data and is
      // not recomputed when bones move; disable the test — consumers needing culling
      // must supply their own bounds (recorded in userData.rig).
      mesh.frustumCulled = false;
      boundCount += 1;
    }
  }
  root.userData.rig = {
    bones, skeleton, boneOrder, boneIndexOf,
    skinAttributes: skinnedMeshNames,
    bound: skinnedMeshNames.length > 0 && boundCount === expectedBound,
    frustumCulled: false,
    cullingNote: "skinned meshes set frustumCulled = false; bone motion does not update a SkinnedMesh boundingSphere, so a consumer that needs culling must recompute bounds per frame",
  };
  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 512, "preferredTextureResolution": 1024, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": false, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "turnaround swatches define material classes; extraction is swatch-informed inference"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth cloth or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare carrier/pouch/belt segmentation against the turnaround panels.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: "Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets. Arm chains are pivot Groups (clavicle > upper-arm > forearm > hand); spine and legs are the bound skeleton; equipment is skinned to its owning bone.",
  };
  return root;
}


export const ASSET_MODULE_META = {
  schema: "gauntlet.asset.procedural_module",
  id: "operator-npc",
  version: 2,
  three_import: "three",
  factory: "createTacticalOperatorNPCModel",
  reference_evidence: {
    method: "8x8 grid IoU of projected module geometry vs turnaround front crop (references/derived/turnaround/front.png); per-view profile agreement front 0.861 / back 0.862 / left 0.795 (scripts/compare-profiles.py); vision-judge composite estimate 0.64 against 0.75 target with all hard minimums clear",
    reference_sha256: "a16f0a9dcf2229187d1528772e2c5cb180302b0c49c6f5274504892f007ab162",
    similarity: 0.8,
  },
  affordances: {
    named_nodes: [
      "Operator (root)__pivot", "Pelvis (trouser yoke)__pivot", "Abdomen__pivot", "Chest__pivot",
      "Neck__pivot", "Head__pivot", "Clavicle L__pivot", "Clavicle R__pivot",
      "Upper Arm L__pivot", "Upper Arm R__pivot", "Forearm L__pivot", "Forearm R__pivot",
      "Hand L__pivot", "Hand R__pivot", "Thigh L__pivot", "Thigh R__pivot",
      "Shin L__pivot", "Shin R__pivot", "Foot L__pivot", "Foot R__pivot",
    ],
    sockets: { "socket-weapon": { node: "Weapon attachment socket (hand-r grip)__pivot", kind: "weapon", note: "hand-r grip locator; no weapon geometry merged into the body mesh" } },
    colliders: [
      { node: "Pelvis (trouser yoke)__pivot", shape: "capsule" },
      { node: "Chest__pivot", shape: "capsule" },
      { node: "Head__pivot", shape: "sphere" },
    ],
  },
} as const;

export function createTacticalOperatorNPCLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Tactical Operator NPC look-dev lights";
  const hemi = new THREE.HemisphereLight(
    mode === 'reference' ? 0xfff0d6 : 0xf2f4ff,
    0x363b42,
    mode === 'grazing' ? 0.28 : mode === 'reference' ? 0.72 : 0.85,
  );
  lights.add(hemi);
  const key = new THREE.DirectionalLight(
    mode === 'reference' ? 0xffcf8a : 0xfff4e8,
    mode === 'grazing' ? 4.2 : mode === 'reference' ? 2.6 : 2.15,
  );
  if (mode === 'grazing') key.position.set(7.5, 1.1, 4.0);
  else if (mode === 'reference') key.position.set(-4.5, 7.5, 5.0);
  else key.position.set(-4.0, 6.0, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 7;
  key.shadow.blurSamples = 24;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -2.6;
  key.shadow.camera.right = 2.6;
  key.shadow.camera.top = 2.6;
  key.shadow.camera.bottom = -2.6;
  key.shadow.camera.updateProjectionMatrix();
  lights.add(key);
  const fill = new THREE.DirectionalLight(0xa8c4ff, mode === 'grazing' ? 0.12 : 0.42);
  fill.position.set(4.0, 3.0, 3.5);
  lights.add(fill);
  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 0.28 : 0.85);
  rim.position.set(0.5, 4.5, -6.0);
  lights.add(rim);
  lights.userData.reviewMode = mode;
  lights.userData.lightingFromPhoto = ["key: soft frontal-top key (white studio sweep), mild shadow under jaw/boots; exposure even, no clipped blacks in gear", "fill: broad white-background bounce lifting shadow side of trousers/arms; near-shadowless product-display lighting", "rim: none visible; background sweep provides edge separation for white head (tone target: filmic, protect gear black detail)", "contact shadow: soft ground contact under boot soles (excluded from reconstruction floor measurement; cast shadow ~y1236px)", "tone mapping intent: ACES/filmic in review renderer; keep gear blacks above 0.02 display value"];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createTacticalOperatorNPCEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

// Plan 1.3 §3.2 — auto-framing by bounding box. The Divine Eye can only compare a
// render to the reference if the object is FRAMED consistently (an object framed
// differently scores as wrong even when its shape is right). This positions the camera
// deterministically from the object's bounding box so it fills the frame at a stable
// margin, and sets near/far to the object scale. Call after adding the model to the
// scene, and again on resize (after updating camera.aspect).
export function frameTacticalOperatorNPCCamera(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  options: { margin?: number; azimuthDeg?: number; elevationDeg?: number } = {},
): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const margin = options.margin ?? 1.15;
  const maxDim = Math.max(size.x, size.y, size.z) * margin;
  const fov = (camera.fov * Math.PI) / 180;
  // distance so the largest object dimension fits vertically in the frame
  const distance = (maxDim / 2) / Math.tan(fov / 2);
  const az = ((options.azimuthDeg ?? 0) * Math.PI) / 180;
  const el = ((options.elevationDeg ?? 0) * Math.PI) / 180;
  const dir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  );
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(0.01, distance - maxDim);
  camera.far = distance + maxDim * 2;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

// Plan 1.3 §3.2c — PRESENTATION composer (DOF + bloom). CRITICAL (R-POSTFX): this is
// for the showcase/hero render ONLY. The Divine Eye's EVALUATION render MUST use a
// plain renderer with NO composer — bloom blows highlights and DOF blurs edges, which
// would corrupt the deterministic IoU/DCD/edge/blowout signals. Enable dof/bloom ONLY
// when the reference photo actually exhibits them (detect_reference_effects.py authorizes).
export function createTacticalOperatorNPCPresentationComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: { dof?: boolean; bloom?: boolean; bloomStrength?: number; dofFocus?: number; dofAperture?: number } = {},
): EffectComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  if (options.dof) {
    composer.addPass(new BokehPass(scene, camera, {
      focus: options.dofFocus ?? 10.0,
      aperture: options.dofAperture ?? 0.0002,
      maxblur: 0.01,
    }));
  }
  if (options.bloom) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    composer.addPass(new UnrealBloomPass(size, options.bloomStrength ?? 0.4, 0.4, 0.85));
  }
  return composer;
}

export function configureTacticalOperatorNPCRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createTacticalOperatorNPCInspectControls(
  camera: THREE.Camera,
  domElement: HTMLElement,
): OrbitControls {
  // View-dependent finishes only read correctly once the user orbits — their color
  // comes from the environment reflection, not albedo, so free rotation matters here.
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.0;
  controls.maxDistance = 8.0;
  controls.autoRotate = false;
  return controls;
}
