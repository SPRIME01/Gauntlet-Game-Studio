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
// v27 changes (turnaround correction loop, iteration 1): shoulders/chest/waist/hips
// narrowed ~15-20% with the shoulder joints tucked inboard and the arm slant raised so
// elbows flare at rib height (the reference silhouette's widest row); thighs +40% at
// the top / calves +30% with the reference's steep lower taper; boots shrunk ~30%
// (length kept in z); chest kit densified with a second tan mag row, utility pouch and
// coyote-tan/olive-drab pouch classes; knee-pad silhouette-metric hazards (key-lit
// pouch faces, thigh-gap-bridging strap ring) corrected.
// v29 changes (vision-verifier fidelity loop, iteration 3): v28 still FAILED
// independent visual review at 58% (< 70% bar). Every finding is corrected here:
//   1. HEAD — the robotic "egg + screen + top box" is replaced by the reference
//      stack: matte ballistic helmet dome, a horizontal GOGGLE BAND wrapping the
//      helmet with a small lens block at the front, dark SHOOTING GLASSES over the
//      eyes, and a BLACK BALACLAVA (skull + lower-face volumes) covering the face.
//   2. NECK — the smooth pressure-seal ring is replaced by a BULKY wrapped SCARF:
//      three offset torus wraps with a hanging tail, warm brown-olive fabric.
//   3. PROPORTIONS — legs are 52% of standing height (hip -0.48), longer and
//      thinner (thigh top r 0.06 vs 0.084), torso SHORTER (shoulder -0.198),
//      head cluster scaled ~15% down (dome max r 0.0645 vs 0.076).
//   4. HIPS/THIGHS — the wide flare panels are gone (pelvis yoke 0.086, thigh
//      outer edge 0.112); slim thighs carry a thin drop-leg strap rig with HOLSTER
//      + PISTOL on the character-right thigh.
//   5. ARMS — hang nearly straight (upper arm 10 deg, forearm net -7 deg), no
//      outward bow; the forearm "screen" patch (elbow pad box) is REMOVED.
//   6. BOOTS — tall laced combat boots with an ANKLE BREAK (shaft flare), defined
//      sole + heel; the light-gray ankle gap band is closed (shaft meets foot).
//   7. MATERIALS — weathered olive-brown-gray with value separation: fatigues
//      ~#4a4438, carrier #33352e, pouches alternate #3d3a2c/#2c2b22; procedural
//      fabric micro-noise (canvas noise set) on every large surface.
//   8. STRAY ACCENTS — the tan hip dump pouch and tan thigh patch are REMOVED
//      (m-pouch-tan class deleted).
//   9. MISSING GEAR — pistol in the right-thigh holster, cargo pockets on both
//      trouser thighs, radio BODY (face plate + knob + coiled cable) on the
//      shoulder strap under the antenna.
//  10. RUCKSACK — reads PACKED: rounded bulge under a lid, vertical + horizontal
//      compression straps with small buckles, side pouches; the duplicated shin
//      slabs are gone (boots rebuilt as single integrated lathes + boxes).
// v30 changes (vision-verifier fidelity loop, iteration 4; verifier scored v29 62%,
// fixing ALL findings):
//   1. GOGGLES — the strap + single block is replaced by a real GOGGLE: dark
//      strap wrapping the dome plus a gray-framed housing across the helmet
//      front with a center divider and TWO flat dark lens plates.
//   2. HELMET BAND — recolored from green m-carrier to charcoal m-polymer;
//      dome profile lowered ~0.005 (top -0.012, max r 0.0625); NVG mount kept;
//      subtle side-rail strips added along the dome flanks.
//   3. GLOVES — m-glove dropped to near-black (#23201a) with the sleeve cuff
//      recolored into the glove class, giving a hard VALUE BREAK at the hands
//      (dark glove vs mid-tone sleeve).
//   4. SCARF — rebuilt as the reference's LARGE TAN-OLIVE draped shawl: bulky
//      neck wrap + a shoulder-cape lathe mass + three overlapping hanging
//      chest panels with staggered/rotated irregular edges + a back drape
//      panel. Material lifted to tan-olive #7c7054 (lightest note in the kit).
//   5. RUCKSACK — enlarged to a LARGE ruck: body 0.185 x 0.245 spanning upper
//      back (-0.18) to the belt (-0.425), packed bulge, lid over the shoulder
//      line, MOLLE rows, vertical + horizontal compression straps with
//      buckles, side pouches that read from the FRONT view, rear radio + whip.
//   6. VEST — desaturated to gray-green #383a35 (sat -~40%), dark velcro PATCH
//      PANEL added, MOLLE webbing 3 thin rows, single DISTINCT three-mag row
//      with deeper pouches + flaps (the cluttering second mini mag row is
//      removed).
//   7. PALETTE — whole kit shifted toward weathered olive-brown-GRAY; value
//      separation widened (dark helmet/boots/gloves/carrier vs mid uniform vs
//      tan scarf); weathering mottling raised on every large surface
//      (colorVariation amplitude 0.24-0.3, height-correlated).
//   8. BACK VALUE — fatigues/trousers/carrier albedo lifted ~12-15% so the
//      rear render separates instead of reading as one dark mass.
//   9. ARMS — bicep swell in the sleeve lathe + larger deltoid caps and
//      shoulder pads (gear-broadened shoulders); arms stay near-straight.
//  10. BOOTS — the flared bell cuff is gone: near-straight narrow shaft
//      lathe, five proud lace rungs up the front, trouser hem bloused over
//      the boot top, defined sole + heel kept.
// v31 changes (vision-verifier fidelity loop, iteration 5; verifier scored v30
// 62%, this pass REBALANCES without redoing settled work — tan-olive shawl,
// dark gloves, weathering, value separation, tall laced boots, dark-on-dark
// gear all preserved):
//   1. GOGGLES WORN, NOT PERCHED — the light-gray crown housing is REMOVED;
//      a wide DARK visor band (dark frame, two dark lens plates) sits on the
//      balaclava face at the eye line under the dome brim, strap wrapping the
//      head; the face below reads masked.
//   2. BULK — shoulders ~+15% (shoulderX 0.076, chestRX 0.108), upper arms and
//      legs ~+20% (bicep 0.042, thigh top 0.07, shin 0.05), hips +12%, helmet
//      ~+8%; head cluster grown to the ~1/7-of-height read (crown -0.008,
//      chin -0.148).
//   3. RUCKSACK — shrunk ~25% (0.14 x 0.175 x 0.078) and ROUNDED into a
//      barrel-like bulge; sits mid-back to waist, top edge below the shoulder
//      line; MOLLE rows, lid, straps, buckles, side pouches kept.
//   4. CARRIER DEPTH — thick 0.05 plate bag proud of the chest in side view;
//      LARGE blank velcro patch panel on the chest upper; triple mag row kept
//      at the lower chest; TWO waist pouches make the waistline read busy.
//   5. PALETTE — warm-brown shifted to COOL OLIVE-GRAY; value separation
//      strengthened: near-black helmet/carrier/boots/gloves vs mid uniform vs
//      tan-olive shawl.
//   6. DETAIL — L-shaped drop-leg slabs replaced by a real holster (body +
//      flap + snap + raked grip + slide) plus a thigh mag pouch; gloves get
//      hard knuckle plates; knee pads become prominent strapped hard shells
//      (top/bottom strap rings read from the rear).
//   7. ANTENNA — moved to the character-LEFT pack corner beside the helmet
//      (reference front view), with the radio unit on the left chest strap.
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
  // Sources: turnaround-profiles.json rows + turnaround-landmarks.json, corrected
  // in v28 against the verifier's fidelity findings (tall 7.5-head figure, long
  // legs, slim V-taper torso, dark-on-dark gear).
  // ------------------------------------------------------------------
  // v29: hip joint at -0.48 so leg length (hip->sole) is 52% of height; arms hang
  // nearly straight (10 deg slant).
  // v31 (r5 rebalance): the reference is BULKY and layered — shoulders ~+15%
  // (shoulderX 0.076, chestRX 0.108), upper arms/legs ~+20%, pelvis/hips +12%,
  // helmet enlarged ~8% relative to the body, and the head cluster grown so
  // crown->chin is ~0.14 of standing height (the 1/7 read). Goggle line moved
  // DOWN to the eye line (worn, not perched).
  const ARM_ANGLE = (10 * Math.PI) / 180; // near-vertical hang with a slight natural bend
  const FOREARM_DRIFT = 0.09; // rad — forearm nets ~+5 deg outward so the hands clear the hips
  const P = {
    helmetTopY: -0.008, helmetCY: -0.056,
    goggleBandY: -0.092, // goggle strap wraps the head AT the eye line, under the dome brim
    goggleY: -0.092, // dark visor band worn OVER the eyes on the balaclava face
    maskCY: -0.118, chinY: -0.148,
    neckTopY: -0.148, neckBaseY: -0.172,
    shoulderY: -0.198, shoulderX: 0.076,
    chestTopY: -0.172, chestBotY: -0.31, chestRX: 0.108, chestRZ: 0.078,
    waistY: -0.372, waistRX: 0.086, waistRZ: 0.062,
    hipY: -0.48, hipRX: 0.094, hipRZ: 0.068,
    legX: 0.064, kneeX: 0.053, kneeY: -0.735, kneeR: 0.046,
    ankleX: 0.036, ankleY: -0.893, soleY: -1.0,
    upperArmR: 0.04, foreArmR: 0.031, wristR: 0.022,
    upperArmL: 0.15, foreArmL: 0.125,
    bootTopY: -0.828,
  } as const;

  // ------------------------------------------------------------------
  // Materials — weathered COOL OLIVE-GRAY kit (v31 verifier finding 5):
  // warm-brown shifted out; value separation STRENGTHENED — near-black
  // helmet/carrier/boots/gloves vs mid olive-gray uniform vs tan-olive
  // shawl (the shawl is protected: v30's settled read, kept).
  // ------------------------------------------------------------------
  const fiberBands = [
    { frequency: 5, amplitude: 0.3, stretch: [1, 1], pattern: "weave", role: "macro cloth mass" },
    { frequency: 26, amplitude: 0.14, stretch: [2, 1], pattern: "fiber grain", role: "meso weave" },
    { frequency: 96, amplitude: 0.09, stretch: [4, 1], pattern: "thread ridges", role: "micro" },
  ];
  const nylonBands = [
    { frequency: 7, amplitude: 0.24, stretch: [1, 1], pattern: "patch mass", role: "macro" },
    { frequency: 30, amplitude: 0.13, stretch: [3, 1], pattern: "strap ridges", role: "meso" },
    { frequency: 110, amplitude: 0.06, stretch: [1, 1], pattern: "grain", role: "micro" },
  ];
  const weathering = { amplitude: 0.3, heightCorrelation: 0.45 };
  const materialMap: Record<string, THREE.Material> = {};
  materialMap["m-fabric"] = createSculptMaterial("m-fabric", {
    id: "m-fabric", name: "Combat shirt fabric (weathered olive-gray cordura)", type: "standard",
    baseColor: "#46483F", albedo: { value: "#46483F", secondary: ["#3B3D35", "#515349"] },
    surfaceFrequencyBands: fiberBands,
    colorVariation: weathering,
    roughness: { base: 0.93, variation: 0.06 }, metalness: { base: 0 },
    specularF0: { base: 0.45 },
    normal: { strength: 0.42 }, envMapIntensity: 0.06, notes: "v31: fatigues cooled to gray-olive #46483f (warm cast removed) — the MID tone between the near-black gear and the tan shawl; amplitude-0.3 mottling kept.",
  }, options);
  materialMap["m-fabric-trouser"] = createSculptMaterial("m-fabric-trouser", {
    id: "m-fabric-trouser", name: "Trousers fabric (weathered olive-gray)", type: "standard",
    baseColor: "#41433A", albedo: { value: "#41433A", secondary: ["#363831", "#4C4E43"] },
    surfaceFrequencyBands: fiberBands,
    colorVariation: weathering,
    roughness: { base: 0.93, variation: 0.06 }, metalness: { base: 0 },
    specularF0: { base: 0.45 },
    normal: { strength: 0.36 }, envMapIntensity: 0.06, notes: "v31: trousers cooled with the shirt (#403a2e -> #41433a); one step darker than the shirt, well above the near-black gear.",
  }, options);
  materialMap["m-carrier"] = createSculptMaterial("m-carrier", {
    id: "m-carrier", name: "Plate carrier / pack nylon", type: "standard",
    baseColor: "#31332E", albedo: { value: "#31332E", secondary: ["#292B26", "#3B3D37"] },
    surfaceFrequencyBands: nylonBands,
    colorVariation: { amplitude: 0.24, heightCorrelation: 0.4 },
    roughness: { base: 0.88, variation: 0.08 }, metalness: { base: 0 },
    specularF0: { base: 0.45 },
    normal: { strength: 0.3 }, envMapIntensity: 0.07, notes: "v31: carrier dropped to near-dark gray-green #31332e (was mid #3e403a) so the plate bag/belt kit read as the DARK gear tier against the mid uniform.",
  }, options);
  materialMap["m-pouch-olive"] = createSculptMaterial("m-pouch-olive", {
    id: "m-pouch-olive", name: "Light pouch nylon", type: "standard",
    baseColor: "#3F413A", albedo: { value: "#3F413A", secondary: ["#35372F", "#494B44"] },
    surfaceFrequencyBands: nylonBands,
    colorVariation: { amplitude: 0.22, heightCorrelation: 0.35 },
    roughness: { base: 0.88, variation: 0.08 }, metalness: { base: 0 },
    specularF0: { base: 0.45 },
    normal: { strength: 0.3 }, envMapIntensity: 0.06,
    notes: "v31: pouches cooled (#443f30 -> #3f413a), one step LIGHTER than the carrier so stacked rows still separate.",
  }, options);
  materialMap["m-pouch-dark"] = createSculptMaterial("m-pouch-dark", {
    id: "m-pouch-dark", name: "Dark pouch nylon", type: "standard",
    baseColor: "#26281F", albedo: { value: "#26281F", secondary: ["#1F211A", "#2F3128"] },
    surfaceFrequencyBands: nylonBands,
    colorVariation: { amplitude: 0.22, heightCorrelation: 0.35 },
    roughness: { base: 0.88, variation: 0.08 }, metalness: { base: 0 },
    specularF0: { base: 0.45 },
    normal: { strength: 0.3 }, envMapIntensity: 0.06,
    notes: "v31: dark pouches dropped further (#302e24 -> #26281f); no tan accent anywhere in the kit.",
  }, options);
  materialMap["m-scarf"] = createSculptMaterial("m-scarf", {
    id: "m-scarf", name: "Draped shawl (tan-olive woven wrap)", type: "standard",
    baseColor: "#6C6450", albedo: { value: "#6C6450", secondary: ["#5F5846", "#7A7159"] },
    surfaceFrequencyBands: [
      { frequency: 9, amplitude: 0.24, stretch: [1, 1], pattern: "knit ridges", role: "macro wrap" },
      { frequency: 34, amplitude: 0.14, stretch: [2, 1], pattern: "yarn fiber", role: "meso" },
      { frequency: 120, amplitude: 0.08, stretch: [3, 1], pattern: "thread", role: "micro" },
    ],
    colorVariation: { amplitude: 0.26, heightCorrelation: 0.4 },
    roughness: { base: 0.96, variation: 0.05 }, metalness: { base: 0 },
    specularF0: { base: 0.4 },
    normal: { strength: 0.5 }, envMapIntensity: 0.05, notes: "v30: the shawl is the TAN-OLIVE accent keyed to the reference's muted gray-tan (~lum 90 sampled) — clearly the LIGHTEST large mass in the kit but not cream (finding 7 value separation).",
  }, options);
  materialMap["m-balaclava"] = createSculptMaterial("m-balaclava", {
    id: "m-balaclava", name: "Balaclava fabric (near-black cotton knit)", type: "standard",
    baseColor: "#26231F", albedo: { value: "#26231F", secondary: ["#1E1C18", "#2E2B26"] },
    surfaceFrequencyBands: [
      { frequency: 10, amplitude: 0.16, stretch: [1, 1], pattern: "knit mass", role: "macro" },
      { frequency: 48, amplitude: 0.1, stretch: [2, 1], pattern: "stitch", role: "meso" },
      { frequency: 140, amplitude: 0.05, stretch: [1, 1], pattern: "thread", role: "micro" },
    ],
    roughness: { base: 0.94, variation: 0.05 }, metalness: { base: 0 },
    specularF0: { base: 0.4 },
    normal: { strength: 0.4 }, envMapIntensity: 0.04, notes: "v29: the balaclava covers the whole face below the glasses line — fabric, not a screen.",
  }, options);
  materialMap["m-polymer"] = createSculptMaterial("m-polymer", {
    id: "m-polymer", name: "Moulded polymer (helmet, knee pads, goggle body, radio)", type: "standard",
    baseColor: "#1B1D1F", albedo: { value: "#1C1E20", secondary: ["#151719", "#232527"] },
    surfaceFrequencyBands: [{ frequency: 8, amplitude: 0.12, stretch: [1, 1], pattern: "mould", role: "macro" }],
    roughness: { base: 0.9, variation: 0.05 }, metalness: { base: 0.0 },
    normal: { strength: 0.28 }, ambientOcclusion: { cavityStrength: 0.3 },
    envMapIntensity: 0.1, notes: "v31: helmet/pads dropped to NEAR-BLACK #1b1d1f — the darkest tier of the value ladder (helmet/carrier/boots/gloves dark, uniform mid, shawl light).",
  }, options);
  materialMap["m-hardware"] = createSculptMaterial("m-hardware", {
    id: "m-hardware", name: "Anodized steel hardware", type: "standard",
    baseColor: "#2E3033", albedo: { value: "#303236", secondary: ["#232528", "#3C3F44"] },
    textureless: { declared: true, evidence: ["small hardware reads as uniform anodized metal at gameplay distance"] },
    roughness: { base: 0.5, variation: 0.06 }, metalness: { base: 0.85 }, envMapIntensity: 0.15,
    notes: "Buckles, rails, antenna, cable, NVG block, radio knobs — painted-metal response.",
  }, options, true);
  materialMap["m-lens"] = createSculptMaterial("m-lens", {
    id: "m-lens", name: "Goggle/shooting-glass lens", type: "standard",
    baseColor: "#0B0D10", albedo: { value: "#0C0E12", secondary: "#070809" },
    textureless: { declared: true, evidence: ["lens is a smooth glossy solid in all views"] },
    roughness: { base: 0.14, variation: 0.03 }, metalness: { base: 0.1 },
    clearcoat: { base: 0.7 }, clearcoatRoughness: { base: 0.15 },
    notes: "Smooth specular class — never confused with fabric.",
  }, options, true);
  materialMap["m-boot"] = createSculptMaterial("m-boot", {
    id: "m-boot", name: "Boot leather/synthetic", type: "standard",
    baseColor: "#1D1E1A", albedo: { value: "#1E1F1B", secondary: ["#161713", "#262722"] },
    surfaceFrequencyBands: [
      { frequency: 6, amplitude: 0.2, stretch: [1, 2], pattern: "leather grain", role: "macro" },
      { frequency: 40, amplitude: 0.1, stretch: [1, 1], pattern: "pore", role: "micro" },
    ],
    roughness: { base: 0.82, variation: 0.08 }, metalness: { base: 0.0 },
    ambientOcclusion: { cavityStrength: 0.4 },
    envMapIntensity: 0.05, normal: { strength: 0.3 }, notes: "v31: boots cooled to near-black #1d1e1a — dark gear tier; laces still read via the proud rungs.",
  }, options);
  materialMap["m-rubber"] = createSculptMaterial("m-rubber", {
    id: "m-rubber", name: "Boot sole rubber", type: "standard",
    baseColor: "#131313", albedo: { value: "#141414", secondary: ["#0E0E0E", "#1A1A1A"] },
    surfaceFrequencyBands: [{ frequency: 14, amplitude: 0.18, stretch: [2, 1], pattern: "tread", role: "meso" }],
    roughness: { base: 0.88, variation: 0.05 }, metalness: { base: 0 },
    envMapIntensity: 0.02,
    normal: { strength: 0.4 },
    notes: "Dead-matte rubber class for soles; env clamped so soles stop reading grey.",
  }, options);
  materialMap["m-glove"] = createSculptMaterial("m-glove", {
    id: "m-glove", name: "Tactical glove (near-black leather/fabric)", type: "standard",
    baseColor: "#22241F", albedo: { value: "#22241F", secondary: ["#1B1D18", "#2B2D27"] },
    surfaceFrequencyBands: fiberBands,
    roughness: { base: 0.9, variation: 0.06 }, metalness: { base: 0 },
    specularF0: { base: 0.45 },
    ambientOcclusion: { cavityStrength: 0.35 },
    envMapIntensity: 0.05, normal: { strength: 0.32 }, notes: "v31: gloves kept near-black but cooled (#23201a -> #22241f); hard VALUE BREAK against the mid-tone sleeve preserved; knuckle plates added in the m-polymer class.",
  }, options);
  materialMap["m-goggle-frame"] = createSculptMaterial("m-goggle-frame", {
    id: "m-goggle-frame", name: "Goggle frame (dark impact polymer)", type: "standard",
    baseColor: "#2A2D30", albedo: { value: "#2C2F32", secondary: ["#232628", "#35393C"] },
    surfaceFrequencyBands: [{ frequency: 8, amplitude: 0.12, stretch: [1, 1], pattern: "mould", role: "macro" }],
    roughness: { base: 0.6, variation: 0.08 }, metalness: { base: 0 },
    specularF0: { base: 0.5 },
    envMapIntensity: 0.12, normal: { strength: 0.25 }, notes: "v31 finding 1: the light-GRAY frame is GONE — the visor band frame is dark charcoal so the goggle reads as worn dark gear over the eyes (reference detail-head-front), one hair lighter than the lenses only.",
  }, options, true);

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

  // LatheGeometry winding follows the profile order: a profile authored top-to-bottom
  // (decreasing y) produces INVERTED normals, so a FrontSide tube renders its lit
  // interior backfaces — the v27/v28-early "grey boots / bright shin stripes" that no
  // material change could fix. Order every profile bottom-to-top before building.
  const lathe = (profile: Array<[number, number]>, radial = 16): THREE.LatheGeometry => {
    const ordered = profile[0][1] > profile[profile.length - 1][1] ? [...profile].reverse() : profile;
    return tileUVs(new THREE.LatheGeometry(ordered.map(([r, y]) => new THREE.Vector2(Math.max(0.002, r), y)), radial), "aroundY") as THREE.LatheGeometry;
  };

  const ellipsoid = (r: number, scale: [number, number, number], at: [number, number, number], w = 14, h = 10): THREE.BufferGeometry => {
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
    const g = new THREE.TorusGeometry(radius, tube, 8, 18);
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
  pivotNode("pelvis", "Pelvis (trouser yoke)", "root", [0, 0.035, 0],
    componentMeta("pelvis", "Pelvis (trouser yoke)", { level: "macro", role: "body", importance: 0.9, primitive: "ellipsoid", parent: "root", material: "m-fabric-trouser", dims: [0.2, 0.16, 0.15] }));
  pivotNode("abdomen", "Abdomen", "pelvis", [0, 0.105, 0],
    componentMeta("abdomen", "Abdomen", { level: "macro", role: "body", importance: 0.9, primitive: "lathe", parent: "pelvis", material: "m-fabric", dims: [0.17, 0.11, 0.13] }));
  pivotNode("chest", "Chest", "abdomen", [0, 0.115, 0],
    componentMeta("chest", "Chest", { level: "macro", role: "body", importance: 1, primitive: "lathe", parent: "abdomen", material: "m-fabric", dims: [0.21, 0.15, 0.15] }));
  pivotNode("neck", "Neck", "chest", [0, 0.115, 0],
    componentMeta("neck", "Neck", { level: "macro", role: "body", importance: 0.7, primitive: "cylinder", parent: "chest", material: "m-fabric", dims: [0.08, 0.05, 0.08] }));
  pivotNode("head", "Head", "neck", [0, 0.05, 0],
    componentMeta("head", "Head", { level: "macro", role: "body", importance: 1, primitive: "sphere", parent: "neck", material: "m-fabric", dims: [0.11, 0.12, 0.11] }));
  pivotNode("clavicle-l", "Clavicle L", "chest", [0.04, 0.078, 0.008],
    componentMeta("clavicle-l", "Clavicle L", { level: "meso", role: "body", importance: 0.6, primitive: "locator", parent: "chest", material: "m-fabric", dims: [0.07, 0.03, 0.03] }));
  pivotNode("clavicle-r", "Clavicle R", "chest", [-0.04, 0.078, 0.008],
    componentMeta("clavicle-r", "Clavicle R", { level: "meso", role: "body", importance: 0.6, primitive: "locator", parent: "chest", material: "m-fabric", dims: [0.07, 0.03, 0.03] }));
  pivotNode("upper-arm-l", "Upper Arm L", "clavicle-l", [0.044, -0.018, -0.008],
    componentMeta("upper-arm-l", "Upper Arm L", { level: "macro", role: "body", importance: 0.8, primitive: "lathe", parent: "clavicle-l", material: "m-fabric", dims: [0.084, 0.15, 0.084] }),
    [0, 0, ARM_ANGLE]);
  pivotNode("upper-arm-r", "Upper Arm R", "clavicle-r", [-0.044, -0.018, -0.008],
    componentMeta("upper-arm-r", "Upper Arm R", { level: "macro", role: "body", importance: 0.8, primitive: "lathe", parent: "clavicle-r", material: "m-fabric", dims: [0.084, 0.15, 0.084] }),
    [0, 0, -ARM_ANGLE]);
  pivotNode("forearm-l", "Forearm L", "upper-arm-l", [0, -P.upperArmL, 0],
    componentMeta("forearm-l", "Forearm L", { level: "macro", role: "body", importance: 0.8, primitive: "lathe", parent: "upper-arm-l", material: "m-fabric", dims: [0.06, 0.12, 0.06] }),
    [0, 0, -(ARM_ANGLE - FOREARM_DRIFT)]);
  pivotNode("forearm-r", "Forearm R", "upper-arm-r", [0, -P.upperArmL, 0],
    componentMeta("forearm-r", "Forearm R", { level: "macro", role: "body", importance: 0.8, primitive: "lathe", parent: "upper-arm-r", material: "m-fabric", dims: [0.06, 0.12, 0.06] }),
    [0, 0, ARM_ANGLE - FOREARM_DRIFT]);
  pivotNode("hand-l", "Hand L", "forearm-l", [0, -P.foreArmL, 0],
    componentMeta("hand-l", "Hand L", { level: "meso", role: "body", importance: 0.7, primitive: "assembled", parent: "forearm-l", material: "m-glove", dims: [0.035, 0.09, 0.045] }));
  pivotNode("hand-r", "Hand R", "forearm-r", [0, -P.foreArmL, 0],
    componentMeta("hand-r", "Hand R", { level: "meso", role: "body", importance: 0.7, primitive: "assembled", parent: "forearm-r", material: "m-glove", dims: [0.035, 0.09, 0.045] }));
  pivotNode("thigh-l", "Thigh L", "pelvis", [P.legX, 0.0, 0],
    componentMeta("thigh-l", "Thigh L", { level: "macro", role: "body", importance: 0.9, primitive: "lathe", parent: "pelvis", material: "m-fabric-trouser", dims: [0.14, 0.25, 0.14] }));
  pivotNode("thigh-r", "Thigh R", "pelvis", [-P.legX, 0.0, 0],
    componentMeta("thigh-r", "Thigh R", { level: "macro", role: "body", importance: 0.9, primitive: "lathe", parent: "pelvis", material: "m-fabric-trouser", dims: [0.14, 0.25, 0.14] }));
  pivotNode("shin-l", "Shin L", "thigh-l", [0, -(P.hipY - P.kneeY), 0.005],
    componentMeta("shin-l", "Shin L", { level: "macro", role: "body", importance: 0.8, primitive: "lathe", parent: "thigh-l", material: "m-fabric-trouser", dims: [0.1, 0.16, 0.1] }));
  pivotNode("shin-r", "Shin R", "thigh-r", [0, -(P.hipY - P.kneeY), 0.005],
    componentMeta("shin-r", "Shin R", { level: "macro", role: "body", importance: 0.8, primitive: "lathe", parent: "thigh-r", material: "m-fabric-trouser", dims: [0.1, 0.16, 0.1] }));
  pivotNode("foot-l", "Foot L", "shin-l", [0, -(P.kneeY - P.ankleY), -0.012],
    componentMeta("foot-l", "Foot L", { level: "macro", role: "body", importance: 0.8, primitive: "assembled", parent: "shin-l", material: "m-boot", dims: [0.07, 0.2, 0.15] }));
  pivotNode("foot-r", "Foot R", "shin-r", [0, -(P.kneeY - P.ankleY), -0.012],
    componentMeta("foot-r", "Foot R", { level: "macro", role: "body", importance: 0.8, primitive: "assembled", parent: "shin-r", material: "m-boot", dims: [0.07, 0.2, 0.15] }));

  // ==================================================================
  // BODY (skinned primaries, analytic envelope weights)
  // v31: BULK pass — chest 0.108 / waist 0.086 / hips 0.094 (+12-15% over
  // v29/v30), depth scales lifted to 0.72-0.76, thighs top r 0.07 and shins
  // 0.05 (+20%), head cluster grown to the 1/7-of-height read.
  // ==================================================================
  bindPart("pelvis", "pelvis", "Pelvis (trouser yoke)",
    (() => { const g = lathe([[0.017, -0.595], [0.056, -0.58], [0.08, -0.556], [0.092, -0.52], [0.096, -0.484], [0.092, -0.458]]); g.scale(1, 1, 0.76); return g; })(),
    materialMap["m-fabric-trouser"],
    componentMeta("pelvis", "Pelvis (trouser yoke)", { level: "macro", role: "body", importance: 0.9, primitive: "ellipsoid", parent: "root", material: "m-fabric-trouser", dims: [0.19, 0.16, 0.15] }),
    "analytic");
  bindPart("abdomen", "abdomen", "Abdomen",
    (() => { const g = lathe([[0.088, -0.46], [0.084, -0.425], [0.082, P.waistY - 0.005], [0.086, P.waistY + 0.005], [0.096, -0.315]]); g.scale(1, 1, 0.74); return g; })(),
    materialMap["m-fabric"],
    componentMeta("abdomen", "Abdomen", { level: "macro", role: "body", importance: 0.9, primitive: "lathe", parent: "pelvis", material: "m-fabric", dims: [0.19, 0.15, 0.14] }),
    "analytic");
  bindPart("chest", "chest", "Chest",
    (() => { const g = lathe([[0.096, -0.315], [0.103, -0.285], [P.chestRX, -0.252], [0.1, -0.218], [0.086, -0.19], [0.052, -0.174], [0.027, -0.164]]); g.scale(1, 1, 0.72); return g; })(),
    materialMap["m-fabric"],
    componentMeta("chest", "Chest", { level: "macro", role: "body", importance: 1, primitive: "lathe", parent: "abdomen", material: "m-fabric", dims: [0.22, 0.16, 0.16] }),
    "analytic");
  bindPart("neck", "neck", "Neck (under scarf)",
    (() => { const g = new THREE.CylinderGeometry(0.037, 0.042, P.neckBaseY - P.neckTopY + 0.014, 12, 3); g.translate(0, (P.neckBaseY + P.neckTopY) / 2, 0.004); return g; })(),
    materialMap["m-balaclava"],
    componentMeta("neck", "Neck (under scarf)", { level: "macro", role: "body", importance: 0.7, primitive: "cylinder", parent: "chest", material: "m-balaclava", dims: [0.08, 0.05, 0.08] }),
    "analytic");
  // v31: skull is the BALACLAVA (fabric, not skin) — grown with the helmet to the
  // 1/7-of-height head read; the face below the goggle line stays covered.
  bindPart("head", "head", "Head (balaclava skull)",
    ellipsoid(0.049, [0.9, 1.0, 0.92], [0, -0.09, 0.004]),
    materialMap["m-balaclava"],
    componentMeta("head", "Head (balaclava skull)", { level: "macro", role: "body", importance: 0.8, primitive: "sphere", parent: "neck", material: "m-balaclava", dims: [0.088, 0.098, 0.09] }),
    "analytic");

  for (const side of ["l", "r"] as const) {
    const sx = side === "l" ? 1 : -1;
    bindPart(`thigh-${side}`, `thigh-${side}`, `Thigh ${side}`,
      // v31: BULK thigh (hip -0.48 -> knee -0.735); top r 0.07 with a full taper;
      // legs stay long, the layered trouser mass reads heavy like the reference.
      (() => { const g = lathe([[0.07, -0.5], [0.066, -0.53], [0.06, -0.58], [0.054, -0.64], [0.049, -0.69], [0.046, P.kneeY + 0.006]]); g.scale(1, 1, 0.98); g.translate(sx * P.legX, 0, 0); return g; })(),
      materialMap["m-fabric-trouser"],
      componentMeta(`thigh-${side}`, `Thigh ${side}`, { level: "macro", role: "body", importance: 0.9, primitive: "lathe", parent: "pelvis", material: "m-fabric-trouser", dims: [0.14, 0.24, 0.14] }),
      "analytic");
    bindPart(`shin-${side}`, `shin-${side}`, `Shin ${side}`,
      (() => { const g = lathe([[0.048, P.kneeY], [0.05, -0.775], [0.045, -0.815], [0.041, -0.852]]); g.scale(1, 1, 1.0); g.translate(sx * P.kneeX, 0, 0.004); return g; })(),
      materialMap["m-fabric-trouser"],
      componentMeta(`shin-${side}`, `Shin ${side}`, { level: "macro", role: "body", importance: 0.8, primitive: "lathe", parent: `thigh-${side}`, material: "m-fabric-trouser", dims: [0.1, 0.12, 0.1] }),
      "analytic");
    // Boot (v30 finding 10): the v29 shaft lathe flared outward toward the sole
    // (r 0.032 -> 0.0425) and read as a blocky bell cuff. The shaft is now a
    // near-STRAIGHT narrow column (r 0.0375 -> 0.040) that only eases out at the
    // very bottom where it meets the foot; five PROUD lace rungs run up the
    // front (z past the shaft surface); trouser hem blouses over the boot top;
    // defined sole + heel unchanged.
    bindPart(`foot-${side}`, `boot-shaft-${side}`, `Boot shaft ${side}`,
      (() => { const g = lathe([[0.043, -0.824], [0.044, -0.852], [0.044, -0.878], [0.0455, -0.9], [0.05, -0.916]], 14); g.translate(sx * P.ankleX, 0, 0.004); return g; })(),
      materialMap["m-boot"],
      componentMeta(`boot-shaft-${side}`, `Boot shaft ${side}`, { level: "meso", role: "gear", importance: 0.8, primitive: "lathe", parent: `foot-${side}`, material: "m-boot", dims: [0.09, 0.092, 0.09] }));
    bindPart(`foot-${side}`, `boot-foot-${side}`, `Boot foot ${side}`,
      roundedBox(0.058, 0.05, 0.124, 0.012, [sx * P.ankleX, -0.944, 0.028]),
      materialMap["m-boot"],
      componentMeta(`boot-foot-${side}`, `Boot foot ${side}`, { level: "meso", role: "gear", importance: 0.8, primitive: "assembled", parent: `foot-${side}`, material: "m-boot", dims: [0.058, 0.05, 0.124] }));
    bindPart(`foot-${side}`, `boot-toe-${side}`, `Boot toe cap ${side}`,
      roundedBox(0.05, 0.038, 0.04, 0.011, [sx * P.ankleX, -0.951, 0.084]),
      materialMap["m-boot"],
      componentMeta(`boot-toe-${side}`, `Boot toe cap ${side}`, { level: "micro", role: "gear", importance: 0.5, primitive: "assembled", parent: `foot-${side}`, material: "m-boot", dims: [0.05, 0.038, 0.04] }));
    bindPart(`foot-${side}`, `boot-sole-${side}`, `Boot sole ${side}`,
      roundedBox(0.06, 0.016, 0.142, 0.005, [sx * P.ankleX, -0.982, 0.028]),
      materialMap["m-rubber"],
      componentMeta(`boot-sole-${side}`, `Boot sole ${side}`, { level: "micro", role: "gear", importance: 0.6, primitive: "box", parent: `foot-${side}`, material: "m-rubber", dims: [0.06, 0.016, 0.142] }));
    bindPart(`foot-${side}`, `boot-heel-${side}`, `Boot heel ${side}`,
      roundedBox(0.052, 0.02, 0.032, 0.006, [sx * P.ankleX, -0.984, -0.034]),
      materialMap["m-rubber"],
      componentMeta(`boot-heel-${side}`, `Boot heel ${side}`, { level: "micro", role: "gear", importance: 0.5, primitive: "box", parent: `foot-${side}`, material: "m-rubber", dims: [0.052, 0.02, 0.032] }));
    for (const [li, ly] of [-0.836, -0.854, -0.872, -0.89, -0.906].entries()) {
      bindPart(`foot-${side}`, `boot-lace-${side}-${li}`, `Boot lace ${side} ${li}`,
        box(0.016, 0.01, 0.01, [sx * P.ankleX, ly, 0.0485]),
        materialMap["m-boot"],
        componentMeta(`boot-lace-${side}-${li}`, `Boot lace ${side} ${li}`, { level: "micro", role: "gear", importance: 0.3, primitive: "box", parent: `foot-${side}`, material: "m-boot", dims: [0.016, 0.01, 0.01] }));
    }
  }

  // ==================================================================
  // HEAD ASSEMBLY (helmet + NVG + side rails + eye-line GOGGLE VISOR +
  // balaclava) and NECK SCARF — skinned head/neck
  // v31 (finding 1): the goggle assembly is WORN, not perched — the
  // light-gray housing on the helmet crown is REMOVED and replaced by a
  // wide DARK visor band (dark frame, two dark lens plates) sitting ON
  // the balaclava face at the eye line, directly under the dome brim
  // (reference detail-head-front); the face below reads as masked.
  // v31 (finding 2): dome enlarged ~8% with the bulk pass.
  // ==================================================================
  const headGear: THREE.Object3D[] = [];
  const headPart = (id: string, name: string, matId: string, geo: THREE.BufferGeometry, mat: THREE.Material, importance: number, dims: [number, number, number]) => {
    const m = bindPart("head", id, name, geo, mat,
      componentMeta(id, name, { level: "meso", role: "gear", importance, primitive: "assembled", parent: "head", material: matId, dims }));
    headGear.push(m);
    return m;
  };
  headPart("helmet-shell", "Helmet shell", "m-polymer",
    (() => { const g = lathe([
      [0.023, -0.008], [0.035, -0.014], [0.048, -0.024], [0.06, -0.036],
      [0.0665, -0.05], [0.0675, -0.064], [0.0635, -0.076], [0.055, -0.084], [0.04, -0.089],
    ], 18); g.scale(1, 1, 0.94); return g; })(),
    materialMap["m-polymer"], 1, [0.135, 0.081, 0.127]);
  headPart("helmet-nvg-plate", "Helmet NVG plate", "m-polymer",
    box(0.028, 0.03, 0.006, [0, -0.046, 0.059]),
    materialMap["m-polymer"], 0.6, [0.028, 0.03, 0.006]);
  headPart("helmet-nvg-block", "Helmet NVG mount block", "m-hardware",
    box(0.019, 0.017, 0.012, [0, -0.045, 0.066]),
    materialMap["m-hardware"], 0.6, [0.019, 0.017, 0.012]);
  // Side rails: thin strips riding the dome flanks.
  for (const sx of [1, -1]) {
    headPart(`helmet-rail-${sx > 0 ? "l" : "r"}`, `Helmet side rail ${sx > 0 ? "L" : "R"}`, "m-polymer",
      box(0.008, 0.052, 0.076, [sx * 0.0655, -0.06, 0.001]),
      materialMap["m-polymer"], 0.5, [0.008, 0.052, 0.076]);
  }
  // Goggle STRAP (v31 finding 1): dark elastic band around the HEAD at the eye
  // line, hugging the balaclava skull under the dome brim — it anchors the
  // visor as WORN gear (it wraps behind the head, visible from the rear too).
  headPart("goggle-band", "Goggle strap", "m-polymer",
    torus(0.051, 0.0058, [0, P.goggleBandY, 0], [1.02, 1, 1.0]),
    materialMap["m-polymer"], 0.8, [0.108, 0.012, 0.106]);
  // Goggle VISOR (v31 finding 1): wide dark-framed band worn OVER the eyes on
  // the balaclava face — center divider + TWO flat dark lens plates. NO
  // light-gray housing on the helmet crown anywhere.
  headPart("goggle-housing", "Goggle visor frame", "m-goggle-frame",
    roundedBox(0.098, 0.032, 0.022, 0.01, [0, P.goggleY, 0.048]),
    materialMap["m-goggle-frame"], 0.95, [0.098, 0.032, 0.022]);
  headPart("goggle-divider", "Goggle center divider", "m-goggle-frame",
    box(0.008, 0.026, 0.008, [0, P.goggleY, 0.056]),
    materialMap["m-goggle-frame"], 0.8, [0.008, 0.026, 0.008]);
  headPart("goggle-lens-l", "Goggle lens L", "m-lens",
    box(0.039, 0.02, 0.005, [0.0245, P.goggleY, 0.0565]),
    materialMap["m-lens"], 0.9, [0.039, 0.02, 0.005]);
  headPart("goggle-lens-r", "Goggle lens R", "m-lens",
    box(0.039, 0.02, 0.005, [-0.0245, P.goggleY, 0.0565]),
    materialMap["m-lens"], 0.9, [0.039, 0.02, 0.005]);
  // Balaclava lower face: fabric volume over nose/mouth/jaw BELOW the visor.
  headPart("balaclava-face", "Balaclava lower face", "m-balaclava",
    ellipsoid(0.043, [0.92, 0.92, 1.05], [0, -0.118, 0.012]),
    materialMap["m-balaclava"], 0.9, [0.079, 0.079, 0.09]);
  destructionGroups["head-gear"] = headGear;

  // Neck SCARF (v30 finding 4): the reference carries a LARGE TAN-OLIVE draped
  // shawl over the shoulders and chest — not a thin neck roll. Built as:
  //   - a bulky neck WRAP torus anchoring the mass at the collar;
  //   - a SHOULDER CAPE: a flared lathe bell from the collar spreading over the
  //     shoulder line and curling back in at the chest (the draped mass);
  //   - THREE hanging chest panels with staggered lengths/rotations so the
  //     bottom edge reads IRREGULAR, hanging OVER the carrier top;
  //   - a BACK drape panel behind the collar over the ruck lid.
  // The tan-olive material is the lightest large mass in the kit (finding 7).
  const scarfParts: THREE.Object3D[] = [];
  const scarfPart = (id: string, name: string, geo: THREE.BufferGeometry, importance: number, dims: [number, number, number]) => {
    const m = bindPart("neck", id, name, geo, materialMap["m-scarf"],
      componentMeta(id, name, { level: "meso", role: "gear", importance, primitive: "assembled", parent: "neck", material: "m-scarf", dims }));
    scarfParts.push(m);
    return m;
  };
  scarfPart("scarf-wrap", "Scarf neck wrap",
    torus(0.056, 0.016, [0, -0.168, -0.001], [1.12, 1, 1.0]), 0.9, [0.14, 0.036, 0.128]);
  scarfPart("scarf-cape", "Scarf shoulder cape",
    (() => { const g = lathe([
      [0.03, -0.156], [0.054, -0.166], [0.078, -0.18], [0.094, -0.196],
      [0.0995, -0.214], [0.093, -0.228], [0.076, -0.237], [0.055, -0.241],
    ], 20); g.scale(1, 1, 0.74); return g; })(), 1, [0.199, 0.085, 0.147]);
  // Panels hang to ~-0.225 and STOP above the carrier patch panel so the vest
  // readout stays clean (the r4 first pass had panels overlapping the patch,
  // which read as a dark arch cut into the shawl).
  scarfPart("scarf-panel-a", "Scarf chest panel A",
    roundedBox(0.05, 0.05, 0.016, 0.009, [0.023, -0.198, 0.076], [0.05, 0, 0.05]), 0.9, [0.05, 0.05, 0.016]);
  scarfPart("scarf-panel-b", "Scarf chest panel B",
    roundedBox(0.04, 0.042, 0.014, 0.008, [-0.029, -0.194, 0.074], [-0.06, 0, -0.07]), 0.9, [0.04, 0.042, 0.014]);
  scarfPart("scarf-panel-c", "Scarf chest panel C",
    roundedBox(0.028, 0.036, 0.012, 0.006, [-0.003, -0.186, 0.08], [0.04, 0, 0.01]), 0.8, [0.028, 0.036, 0.012]);
  scarfPart("scarf-back-drape", "Scarf back drape",
    roundedBox(0.08, 0.056, 0.016, 0.01, [0.004, -0.21, -0.05], [0.04, 0, -0.02]), 0.7, [0.08, 0.056, 0.016]);
  destructionGroups["neck-scarf"] = scarfParts;

  // ==================================================================
  // PLATE CARRIER + CHEST KIT — skinned chest
  // v31 (finding 4): the carrier gains REAL DEPTH — a thick plate bag proud
  // of the chest in side view — plus a LARGE blank velcro patch panel on the
  // chest upper; the distinct three-mag row stays at the lower chest. Radio +
  // whip antenna moved to the character-LEFT strap/pack side (finding 7;
  // reference front view has them on his left).
  // ==================================================================
  const carrierParts: THREE.Object3D[] = [];
  const chestPart = (id: string, name: string, geo: THREE.BufferGeometry, mat: THREE.Material, importance: number, dims: [number, number, number]) => {
    const m = bindPart("chest", id, name, geo, mat,
      componentMeta(id, name, { level: "meso", role: "gear", importance, primitive: "assembled", parent: "chest", material: "chest-gear", dims }));
    carrierParts.push(m);
    return m;
  };
  chestPart("collar", "Collar flare",
    (() => { const g = lathe([[0.034, P.neckBaseY + 0.02], [0.058, P.neckBaseY - 0.02], [0.034, P.neckBaseY - 0.024]], 14); return g; })(),
    materialMap["m-fabric"], 0.7, [0.13, 0.05, 0.13]);
  // Plate bag (v31 finding 4): THICK — 0.05 deep so the side view reads a real
  // plate carrier volume standing proud of the chest, not a flat slab.
  chestPart("carrier-front", "Carrier front plate bag",
    roundedBox(0.132, 0.102, 0.05, 0.016, [0, -0.25, 0.066]),
    materialMap["m-carrier"], 1, [0.132, 0.102, 0.05]);
  // Velcro PATCH PANEL (v31 finding 4): LARGE blank rectangle, proud of the
  // plate bag face on the chest UPPER, with a thin carrier-tone frame lip.
  chestPart("carrier-patch", "Carrier patch panel",
    roundedBox(0.07, 0.05, 0.01, 0.005, [0, -0.228, 0.089]),
    materialMap["m-polymer"], 0.9, [0.07, 0.05, 0.01]);
  chestPart("carrier-patch-frame", "Carrier patch frame",
    box(0.076, 0.007, 0.011, [0, -0.256, 0.0895]),
    materialMap["m-carrier"], 0.4, [0.076, 0.007, 0.011]);
  // MOLLE webbing: three thin horizontal rows between the patch and the mag row.
  chestPart("carrier-molle-a", "Carrier MOLLE row A",
    box(0.116, 0.009, 0.006, [0, -0.266, 0.0905]),
    materialMap["m-carrier"], 0.5, [0.116, 0.009, 0.006]);
  chestPart("carrier-molle-b", "Carrier MOLLE row B",
    box(0.116, 0.009, 0.006, [0, -0.281, 0.0905]),
    materialMap["m-carrier"], 0.5, [0.116, 0.009, 0.006]);
  chestPart("carrier-molle-c", "Carrier MOLLE row C",
    box(0.116, 0.009, 0.006, [0, -0.296, 0.0905]),
    materialMap["m-carrier"], 0.5, [0.116, 0.009, 0.006]);
  // Mag row — ONE distinct three-pouch row with flaps at the lower chest.
  const magRow: THREE.Object3D[] = [];
  for (const [i, mx] of [-0.044, 0, 0.044].entries()) {
    magRow.push(chestPart(`mag-pouch-${i + 1}`, `Mag pouch ${i + 1}`,
      roundedBox(0.038, 0.06, 0.032, 0.008, [mx, -0.328, 0.072]),
      i % 2 === 0 ? materialMap["m-pouch-olive"] : materialMap["m-pouch-dark"], 0.95, [0.038, 0.06, 0.032]));
    magRow.push(chestPart(`mag-flap-${i + 1}`, `Mag flap ${i + 1}`,
      box(0.042, 0.011, 0.036, [mx, -0.302, 0.075], [-0.2, 0, 0]),
      materialMap["m-carrier"], 0.6, [0.042, 0.011, 0.036]));
  }
  magRow.push(chestPart("carrier-util-pouch", "Carrier utility pouch",
    roundedBox(0.038, 0.048, 0.022, 0.007, [0.062, -0.212, 0.048], [0, 0, -0.05]),
    materialMap["m-pouch-dark"], 0.6, [0.038, 0.048, 0.022]));
  destructionGroups["mag-pouches"] = magRow;
  // Radio BODY on the character-LEFT shoulder strap (v31 finding 7) with face
  // plate + channel knob + coiled cable; the pack whip rises beside it.
  chestPart("radio-body", "Radio body",
    roundedBox(0.032, 0.058, 0.022, 0.006, [0.06, -0.206, 0.052], [0, 0, -0.06]),
    materialMap["m-polymer"], 0.9, [0.032, 0.058, 0.022]);
  chestPart("radio-face", "Radio face plate",
    box(0.023, 0.032, 0.004, [0.062, -0.198, 0.063], [0, 0, -0.06]),
    materialMap["m-hardware"], 0.7, [0.023, 0.032, 0.004]);
  chestPart("radio-knob", "Radio channel knob",
    (() => { const g = new THREE.CylinderGeometry(0.005, 0.005, 0.006, 8); g.rotateX(Math.PI / 2); g.rotateZ(-0.06); g.translate(0.062, -0.179, 0.063); return g; })(),
    materialMap["m-hardware"], 0.5, [0.01, 0.006, 0.01]);
  chestPart("radio-cable", "Radio coiled cable",
    tube([[0.056, -0.186, 0.048], [0.044, -0.174, 0.032], [0.032, -0.16, 0.016]], 0.003),
    materialMap["m-hardware"], 0.5, [0.008, 0.07, 0.008]);
  chestPart("carrier-side-l", "Carrier side pouch L",
    roundedBox(0.026, 0.082, 0.048, 0.009, [0.09, -0.258, 0.004]),
    materialMap["m-carrier"], 0.7, [0.026, 0.082, 0.048]);
  chestPart("carrier-side-r", "Carrier side pouch R",
    roundedBox(0.026, 0.082, 0.048, 0.009, [-0.09, -0.258, 0.004]),
    materialMap["m-carrier"], 0.7, [0.026, 0.082, 0.048]);
  chestPart("strap-l", "Shoulder strap L",
    tube([[0.05, -0.192, 0.05], [0.066, -0.17, 0.006], [0.054, -0.18, -0.046]], 0.013),
    materialMap["m-carrier"], 0.8, [0.04, 0.026, 0.13]);
  chestPart("strap-r", "Shoulder strap R",
    tube([[-0.05, -0.192, 0.05], [-0.066, -0.17, 0.006], [-0.054, -0.18, -0.046]], 0.013),
    materialMap["m-carrier"], 0.8, [0.04, 0.026, 0.13]);
  chestPart("sternum-strap", "Sternum strap",
    box(0.04, 0.01, 0.006, [0, -0.226, 0.088]),
    materialMap["m-carrier"], 0.5, [0.04, 0.01, 0.006]);
  // ---- Rucksack (v31 finding 3): shrunk ~25% from the v30 ruck and ROUNDED —
  // a barrel-like packed bulge under the lid. Sits from MID-BACK to the WAIST
  // (top edge clearly BELOW the shoulder line), NOT above the shoulders.
  // Keeps MOLLE rows, lid, compression straps + buckles, side pouches; the
  // rear radio pouch + whip antenna ride the pack's character-LEFT corner
  // (finding 7).
  chestPart("rucksack-body", "Rucksack body",
    roundedBox(0.14, 0.175, 0.078, 0.032, [0, -0.315, -0.078]),
    materialMap["m-carrier"], 0.95, [0.14, 0.175, 0.078]);
  // Barrel bulge: a full-width rounded swell that rounds the pack in side AND
  // rear view while staying inside the back-detail z (straps/MOLLE still read).
  chestPart("rucksack-bulge", "Rucksack packed bulge",
    ellipsoid(0.074, [1.0, 1.08, 0.52], [0, -0.315, -0.092]),
    materialMap["m-carrier"], 0.8, [0.148, 0.16, 0.077]);
  // Lid rides proud of the body back face below the shoulder line.
  chestPart("rucksack-lid", "Rucksack lid",
    roundedBox(0.148, 0.046, 0.082, 0.014, [0, -0.243, -0.082]),
    materialMap["m-carrier"], 0.85, [0.148, 0.046, 0.082]);
  chestPart("rucksack-lid-strap", "Rucksack lid strap",
    box(0.1, 0.012, 0.006, [0, -0.243, -0.127]),
    materialMap["m-carrier"], 0.5, [0.1, 0.012, 0.006]);
  chestPart("rucksack-lid-buckle", "Rucksack lid buckle",
    box(0.016, 0.014, 0.01, [0, -0.243, -0.132]),
    materialMap["m-hardware"], 0.5, [0.016, 0.014, 0.01]);
  chestPart("rucksack-molle-a", "Rucksack MOLLE row A",
    box(0.1, 0.009, 0.006, [0, -0.288, -0.1325]),
    materialMap["m-carrier"], 0.5, [0.1, 0.009, 0.006]);
  chestPart("rucksack-molle-b", "Rucksack MOLLE row B",
    box(0.1, 0.009, 0.006, [0, -0.314, -0.1325]),
    materialMap["m-carrier"], 0.5, [0.1, 0.009, 0.006]);
  chestPart("rucksack-vert-pouch", "Rucksack vertical pouch",
    roundedBox(0.046, 0.07, 0.022, 0.008, [0, -0.352, -0.13]),
    materialMap["m-pouch-olive"], 0.6, [0.046, 0.07, 0.022]);
  chestPart("rucksack-strap-l", "Rucksack compression strap L",
    box(0.011, 0.15, 0.006, [0.042, -0.315, -0.133]),
    materialMap["m-carrier"], 0.5, [0.011, 0.15, 0.006]);
  chestPart("rucksack-strap-r", "Rucksack compression strap R",
    box(0.011, 0.15, 0.006, [-0.042, -0.315, -0.133]),
    materialMap["m-carrier"], 0.5, [0.011, 0.15, 0.006]);
  chestPart("rucksack-strap-h", "Rucksack compression strap H",
    box(0.09, 0.011, 0.006, [0, -0.384, -0.1335]),
    materialMap["m-carrier"], 0.5, [0.09, 0.011, 0.006]);
  for (const [bi, bx] of [-0.042, 0.042].entries()) {
    chestPart(`rucksack-buckle-${bi + 1}`, `Rucksack buckle ${bi + 1}`,
      box(0.015, 0.013, 0.009, [bx, -0.384, -0.138]),
      materialMap["m-hardware"], 0.4, [0.015, 0.013, 0.009]);
  }
  chestPart("backpack-pouch-l", "Backpack side pouch L",
    roundedBox(0.024, 0.066, 0.034, 0.008, [0.082, -0.318, -0.052]),
    materialMap["m-pouch-olive"], 0.6, [0.024, 0.066, 0.034]);
  chestPart("backpack-pouch-r", "Backpack side pouch R",
    roundedBox(0.024, 0.066, 0.034, 0.008, [-0.082, -0.318, -0.052]),
    materialMap["m-pouch-dark"], 0.6, [0.024, 0.066, 0.034]);
  chestPart("rear-radio", "Rear radio pouch",
    roundedBox(0.032, 0.052, 0.022, 0.007, [0.068, -0.262, -0.122]),
    materialMap["m-pouch-dark"], 0.6, [0.032, 0.052, 0.022]);
  // Antenna (v31 finding 7): character-LEFT pack corner, whip rising beside
  // the LEFT side of the helmet (reference front view). Was on the right.
  chestPart("antenna-base", "Antenna base",
    (() => { const g = new THREE.CylinderGeometry(0.008, 0.009, 0.016, 8); g.translate(0.07, -0.23, -0.124); return g; })(),
    materialMap["m-hardware"], 0.4, [0.017, 0.016, 0.017]);
  chestPart("antenna", "Antenna",
    (() => { const g = new THREE.CylinderGeometry(0.003, 0.0045, 0.15, 6); g.rotateX(-0.07); g.translate(0.07, -0.152, -0.126); return g; })(),
    materialMap["m-hardware"], 0.5, [0.009, 0.15, 0.009]);
  destructionGroups["carrier"] = carrierParts;

  // ==================================================================
  // BELT + WAIST KIT — skinned pelvis
  // v31 (finding 4): TWO waist pouches added at the belt front-sides so the
  // waistline reads BUSY like the reference; belt widened with the hips.
  // ==================================================================
  const beltParts: THREE.Object3D[] = [];
  const pelvisPart = (id: string, name: string, geo: THREE.BufferGeometry, mat: THREE.Material, importance: number, dims: [number, number, number]) => {
    const m = bindPart("pelvis", id, name, geo, mat,
      componentMeta(id, name, { level: "meso", role: "gear", importance, primitive: "assembled", parent: "pelvis", material: "belt-kit", dims }));
    beltParts.push(m);
    return m;
  };
  pelvisPart("belt", "Duty belt",
    (() => { const g = new THREE.CylinderGeometry(0.096, 0.096, 0.034, 20, 1, false); g.scale(1, 1, 0.76); g.translate(0, -0.428, 0); return g; })(),
    materialMap["m-carrier"], 0.9, [0.192, 0.034, 0.146]);
  pelvisPart("belt-buckle", "Belt buckle",
    box(0.026, 0.017, 0.01, [0, -0.428, 0.075]),
    materialMap["m-hardware"], 0.5, [0.026, 0.017, 0.01]);
  pelvisPart("belt-util-pouch", "Belt utility pouch",
    roundedBox(0.042, 0.054, 0.028, 0.008, [0.06, -0.466, 0.062]),
    materialMap["m-pouch-olive"], 0.7, [0.042, 0.054, 0.028]);
  pelvisPart("waist-pouch-l", "Waist pouch L",
    roundedBox(0.036, 0.058, 0.03, 0.009, [0.084, -0.442, 0.038], [0, 0.12, 0.06]),
    materialMap["m-pouch-dark"], 0.8, [0.036, 0.058, 0.03]);
  pelvisPart("waist-pouch-r", "Waist pouch R",
    roundedBox(0.036, 0.058, 0.03, 0.009, [-0.084, -0.442, 0.038], [0, -0.12, 0.06]),
    materialMap["m-pouch-olive"], 0.8, [0.036, 0.058, 0.03]);
  pelvisPart("buttpack", "Butt pack",
    roundedBox(0.088, 0.058, 0.032, 0.012, [0, -0.468, -0.062]),
    materialMap["m-pouch-dark"], 0.7, [0.088, 0.058, 0.032]);
  destructionGroups["belt-kit"] = beltParts;

  // ==================================================================
  // THIGH RIG (character-right) — skinned thigh-r
  // v31 (finding 6): the two L-shaped drop-leg slabs are REPLACED by a proper
  // rig: one belt-to-thigh strap, a real HOLSTER (body + FLAP with snap +
  // raked pistol grip + slide visible), and a MAG POUCH beside it on the
  // thigh.
  // ==================================================================
  bindPart("thigh-r", "holster-strap", "Drop-leg strap",
    box(0.026, 0.11, 0.012, [-0.066, -0.498, 0.05], [0.12, 0, 0.05]),
    materialMap["m-carrier"],
    componentMeta("holster-strap", "Drop-leg strap", { level: "micro", role: "gear", importance: 0.5, primitive: "box", parent: "thigh-r", material: "m-carrier", dims: [0.026, 0.11, 0.012] }));
  bindPart("thigh-r", "holster-body", "Holster body",
    roundedBox(0.034, 0.088, 0.044, 0.012, [-0.082, -0.59, 0.04], [0.03, 0, 0.05]),
    materialMap["m-carrier"],
    componentMeta("holster-body", "Holster body", { level: "meso", role: "gear", importance: 0.8, primitive: "assembled", parent: "thigh-r", material: "m-carrier", dims: [0.034, 0.088, 0.044] }));
  // Holster FLAP (v31): a distinct cap folded over the holster mouth with a
  // snap stud — reads as a covered holster, not a bare slab.
  bindPart("thigh-r", "holster-flap", "Holster flap",
    roundedBox(0.036, 0.042, 0.046, 0.01, [-0.082, -0.548, 0.041], [0.03, 0, 0.05]),
    materialMap["m-pouch-dark"],
    componentMeta("holster-flap", "Holster flap", { level: "meso", role: "gear", importance: 0.8, primitive: "assembled", parent: "thigh-r", material: "m-pouch-dark", dims: [0.036, 0.042, 0.046] }));
  bindPart("thigh-r", "holster-flap-snap", "Holster flap snap",
    box(0.014, 0.012, 0.008, [-0.082, -0.564, 0.062], [0.03, 0, 0.05]),
    materialMap["m-hardware"],
    componentMeta("holster-flap-snap", "Holster flap snap", { level: "micro", role: "gear", importance: 0.3, primitive: "box", parent: "thigh-r", material: "m-hardware", dims: [0.014, 0.012, 0.008] }));
  // The PISTOL in the holster: raked grip poking proud of the flap + rear slide
  // above it, dark polymer — no bright accents.
  bindPart("thigh-r", "holster-pistol-grip", "Pistol grip",
    roundedBox(0.021, 0.046, 0.015, 0.005, [-0.078, -0.53, 0.062], [-0.4, 0, 0.05]),
    materialMap["m-polymer"],
    componentMeta("holster-pistol-grip", "Pistol grip", { level: "micro", role: "gear", importance: 0.7, primitive: "assembled", parent: "thigh-r", material: "m-polymer", dims: [0.021, 0.046, 0.015] }));
  bindPart("thigh-r", "holster-pistol-slide", "Pistol slide",
    box(0.022, 0.024, 0.048, [-0.078, -0.502, 0.052]),
    materialMap["m-polymer"],
    componentMeta("holster-pistol-slide", "Pistol slide", { level: "micro", role: "gear", importance: 0.7, primitive: "box", parent: "thigh-r", material: "m-polymer", dims: [0.022, 0.024, 0.048] }));
  // Thigh MAG POUCH (v31 finding 6): inboard of the holster on the same strap
  // line, with a flap — the paired readout that makes the rig a RIG.
  bindPart("thigh-r", "thigh-mag-pouch", "Thigh mag pouch",
    roundedBox(0.032, 0.054, 0.03, 0.008, [-0.05, -0.606, 0.052], [0.05, 0, 0.04]),
    materialMap["m-pouch-dark"],
    componentMeta("thigh-mag-pouch", "Thigh mag pouch", { level: "meso", role: "gear", importance: 0.7, primitive: "assembled", parent: "thigh-r", material: "m-pouch-dark", dims: [0.032, 0.054, 0.03] }));
  bindPart("thigh-r", "thigh-mag-flap", "Thigh mag flap",
    box(0.036, 0.011, 0.034, [-0.05, -0.584, 0.055], [0.05, 0, 0.04]),
    materialMap["m-carrier"],
    componentMeta("thigh-mag-flap", "Thigh mag flap", { level: "micro", role: "gear", importance: 0.4, primitive: "box", parent: "thigh-r", material: "m-carrier", dims: [0.036, 0.011, 0.034] }));

  // ==================================================================
  // KNEE PADS — skinned thighs
  // v31 (finding 6): PROMINENT strapped hard shells — a large domed polymer
  // cap proud of the knee plus top/bottom STRAP rings that wrap the limb, so
  // the pads read from the REAR view too (the straps ring the leg).
  // ==================================================================
  for (const side of ["l", "r"] as const) {
    const sx = side === "l" ? 1 : -1;
    bindPart(`thigh-${side}`, `kneepad-${side}`, `Knee pad shell ${side}`,
      roundedBox(0.064, 0.08, 0.03, 0.013, [sx * P.kneeX, -0.738, 0.038]),
      materialMap["m-polymer"],
      componentMeta(`kneepad-${side}`, `Knee pad shell ${side}`, { level: "meso", role: "gear", importance: 0.8, primitive: "assembled", parent: `thigh-${side}`, material: "m-polymer", dims: [0.064, 0.08, 0.03] }));
    bindPart(`thigh-${side}`, `kneepad-dome-${side}`, `Knee pad dome ${side}`,
      ellipsoid(0.034, [1.02, 1.12, 0.66], [sx * P.kneeX, -0.738, 0.05]),
      materialMap["m-polymer"],
      componentMeta(`kneepad-dome-${side}`, `Knee pad dome ${side}`, { level: "meso", role: "gear", importance: 0.7, primitive: "sphere", parent: `thigh-${side}`, material: "m-polymer", dims: [0.069, 0.076, 0.045] }));
    bindPart(`thigh-${side}`, `kneepad-strap-top-${side}`, `Knee pad strap top ${side}`,
      torus(0.046, 0.008, [sx * P.kneeX, -0.694, 0.002], [1.0, 1, 0.96]),
      materialMap["m-carrier"],
      componentMeta(`kneepad-strap-top-${side}`, `Knee pad strap top ${side}`, { level: "micro", role: "gear", importance: 0.5, primitive: "torus", parent: `thigh-${side}`, material: "m-carrier", dims: [0.1, 0.016, 0.1] }));
    bindPart(`thigh-${side}`, `kneepad-strap-bottom-${side}`, `Knee pad strap bottom ${side}`,
      torus(0.05, 0.008, [sx * P.kneeX, -0.784, 0.004], [1.0, 1, 0.96]),
      materialMap["m-carrier"],
      componentMeta(`kneepad-strap-bottom-${side}`, `Knee pad strap bottom ${side}`, { level: "micro", role: "gear", importance: 0.5, primitive: "torus", parent: `thigh-${side}`, material: "m-carrier", dims: [0.1, 0.016, 0.1] }));
    for (const [ri, rv] of [[-0.017, 0.016], [-0.017, -0.016], [0.017, 0.016], [0.017, -0.016]].entries()) {
      bindPart(`thigh-${side}`, `kneepad-rivet-${side}-${ri}`, `Knee pad rivet ${side} ${ri}`,
        (() => { const g = new THREE.CylinderGeometry(0.0035, 0.0035, 0.006, 6); g.rotateX(Math.PI / 2); g.translate(sx * (P.kneeX + rv[0]), -0.738 + rv[1], 0.0705); return g; })(),
        materialMap["m-polymer"],
        componentMeta(`kneepad-rivet-${side}-${ri}`, `Knee pad rivet ${side} ${ri}`, { level: "micro", role: "gear", importance: 0.25, primitive: "cylinder", parent: `thigh-${side}`, material: "m-polymer", dims: [0.007, 0.006, 0.007] }));
    }
  }

  // Trouser cargo pockets on BOTH thighs (v29 verifier finding 9), skinned thighs.
  // The right-thigh pocket sits lower/rear so it does not jumble with the drop-leg
  // holster rig occupying the outer-front of that thigh.
  for (const side of ["l", "r"] as const) {
    const sx = side === "l" ? 1 : -1;
    const cy = side === "l" ? -0.605 : -0.67;
    const cz = side === "l" ? 0.002 : -0.012;
    bindPart(`thigh-${side}`, `cargo-${side}`, `Cargo pocket ${side}`,
      roundedBox(0.022, 0.078, 0.05, 0.009, [sx * 0.108, cy, cz], [0, sx * -0.14, 0]),
      materialMap["m-fabric-trouser"],
      componentMeta(`cargo-${side}`, `Cargo pocket ${side}`, { level: "meso", role: "gear", importance: 0.6, primitive: "assembled", parent: `thigh-${side}`, material: "m-fabric-trouser", dims: [0.024, 0.078, 0.052] }));
    bindPart(`thigh-${side}`, `cargo-flap-${side}`, `Cargo flap ${side}`,
      box(0.024, 0.012, 0.054, [sx * 0.109, cy + 0.035, cz], [0, sx * -0.14, 0]),
      materialMap["m-fabric-trouser"],
      componentMeta(`cargo-flap-${side}`, `Cargo flap ${side}`, { level: "micro", role: "gear", importance: 0.4, primitive: "box", parent: `thigh-${side}`, material: "m-fabric-trouser", dims: [0.026, 0.012, 0.056] }));
  }
  // ==================================================================
  // ARMS (rigid meshes under named pivot chains — the arm contract)
  // v30 (findings 3/9): sleeve SHAPING (bicep swell in the lathe) + larger
  // deltoid caps and shoulder pads so the shoulders read gear-broadened; arms
  // stay near-straight. The sleeve cuff is recolored into the near-black glove
  // class so the wrist carries the glove VALUE BREAK.
  // ==================================================================
  for (const side of ["l", "r"] as const) {
    const sx = side === "l" ? 1 : -1;
    attachMesh(`deltoid-${side}`, `Sleeve cap ${side}`,
      ellipsoid(0.047, [1.2, 1.45, 1.05], [0, -0.03, 0], 14, 10),
      materialMap["m-fabric"], `upper-arm-${side}`,
      componentMeta(`deltoid-${side}`, `Sleeve cap ${side}`, { level: "meso", role: "body", importance: 0.7, primitive: "sphere", parent: `upper-arm-${side}`, material: "m-fabric", dims: [0.113, 0.136, 0.099] }));
    attachMesh(`shoulder-pad-${side}`, `Shoulder pad ${side}`,
      roundedBox(0.056, 0.012, 0.066, 0.005, [0.001, 0.016, 0.001], [0.1, 0, sx * 0.2]),
      materialMap["m-polymer"], `upper-arm-${side}`,
      componentMeta(`shoulder-pad-${side}`, `Shoulder pad ${side}`, { level: "micro", role: "gear", importance: 0.4, primitive: "box", parent: `upper-arm-${side}`, material: "m-polymer", dims: [0.062, 0.013, 0.074] }));
    attachMesh(`upper-arm-${side}`, `Upper arm ${side}`,
      // v31: THICK sleeve — bicep swell at r 0.042 (+20% over v30).
      lathe([[0.043, 0.008], [0.041, -0.048], [0.036, -0.098], [0.031, -P.upperArmL + 0.01]], 14),
      materialMap["m-fabric"], `upper-arm-${side}`,
      componentMeta(`upper-arm-${side}`, `Upper arm ${side}`, { level: "macro", role: "body", importance: 0.8, primitive: "lathe", parent: `upper-arm-${side}`, material: "m-fabric", dims: [0.086, 0.15, 0.086] }));
    attachMesh(`elbow-${side}`, `Elbow ${side}`,
      ellipsoid(0.034, [1.0, 1.0, 0.9], [0, 0.006, 0], 12, 9),
      materialMap["m-fabric"], `forearm-${side}`,
      componentMeta(`elbow-${side}`, `Elbow ${side}`, { level: "meso", role: "body", importance: 0.6, primitive: "sphere", parent: `forearm-${side}`, material: "m-fabric", dims: [0.068, 0.06, 0.068] }));
    attachMesh(`forearm-${side}`, `Forearm ${side}`,
      lathe([[0.031, 0.01], [0.0275, -0.055], [P.wristR + 0.001, -P.foreArmL + 0.012]], 14),
      materialMap["m-fabric"], `forearm-${side}`,
      componentMeta(`forearm-${side}`, `Forearm ${side}`, { level: "macro", role: "body", importance: 0.8, primitive: "lathe", parent: `forearm-${side}`, material: "m-fabric", dims: [0.066, 0.12, 0.066] }));
    attachMesh(`cuff-${side}`, `Glove cuff ${side}`,
      (() => { const g = new THREE.CylinderGeometry(0.0245, 0.021, 0.019, 12); g.translate(0, -P.foreArmL + 0.017, 0); return g; })(),
      materialMap["m-glove"], `forearm-${side}`,
      componentMeta(`cuff-${side}`, `Glove cuff ${side}`, { level: "micro", role: "gear", importance: 0.4, primitive: "cylinder", parent: `forearm-${side}`, material: "m-glove", dims: [0.049, 0.019, 0.049] }));
    // Tactical glove (dark, tapered boxes) under the hand pivot.
    attachMesh(`hand-${side}`, `Hand ${side}`,
      roundedBox(0.04, 0.058, 0.048, 0.011, [0, -0.026, 0.002]),
      materialMap["m-glove"], `hand-${side}`,
      componentMeta(`hand-${side}`, `Hand ${side}`, { level: "meso", role: "body", importance: 0.7, primitive: "assembled", parent: `hand-${side}`, material: "m-glove", dims: [0.04, 0.058, 0.048] }));
    // Hard KNUCKLE PLATE (v31 finding 6): small dark shell across the back of
    // the hand — the reference gloves carry moulded knuckle guards.
    attachMesh(`knuckle-${side}`, `Knuckle plate ${side}`,
      roundedBox(0.028, 0.024, 0.008, 0.004, [0, -0.022, 0.026]),
      materialMap["m-polymer"], `hand-${side}`,
      componentMeta(`knuckle-${side}`, `Knuckle plate ${side}`, { level: "micro", role: "gear", importance: 0.5, primitive: "assembled", parent: `hand-${side}`, material: "m-polymer", dims: [0.028, 0.024, 0.008] }));
    attachMesh(`fingers-${side}`, `Finger block ${side}`,
      roundedBox(0.03, 0.042, 0.034, 0.007, [0, -0.062, -0.002]),
      materialMap["m-glove"], `hand-${side}`,
      componentMeta(`fingers-${side}`, `Finger block ${side}`, { level: "meso", role: "body", importance: 0.6, primitive: "assembled", parent: `hand-${side}`, material: "m-glove", dims: [0.03, 0.042, 0.034] }));
    attachMesh(`thumb-${side}`, `Thumb ${side}`,
      roundedBox(0.013, 0.03, 0.015, 0.004, [sx * 0.02, -0.03, 0.008], [0, 0, sx * -0.35]),
      materialMap["m-glove"], `hand-${side}`,
      componentMeta(`thumb-${side}`, `Thumb ${side}`, { level: "micro", role: "body", importance: 0.4, primitive: "assembled", parent: `hand-${side}`, material: "m-glove", dims: [0.013, 0.03, 0.015] }));
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
  addBone("pelvis", null, [0, P.hipY, 0]);
  addBone("abdomen", "pelvis", [0, 0.105, 0]);
  addBone("chest", "abdomen", [0, 0.115, 0]);
  addBone("neck", "chest", [0, 0.115, 0]);
  addBone("head", "neck", [0, 0.05, 0]);
  addBone("thigh-l", "pelvis", [P.legX, 0, 0]);
  addBone("thigh-r", "pelvis", [-P.legX, 0, 0]);
  addBone("shin-l", "thigh-l", [0, -(P.hipY - P.kneeY), 0.005]);
  addBone("shin-r", "thigh-r", [0, -(P.hipY - P.kneeY), 0.005]);
  addBone("foot-l", "shin-l", [0, -(P.kneeY - P.ankleY), -0.012]);
  addBone("foot-r", "shin-r", [0, -(P.kneeY - P.ankleY), -0.012]);

  // The bones are now in REST position. updateMatrixWorld() before constructing the
  // Skeleton is load-bearing: calculateInverses() reads each bone's CURRENT world
  // matrix, and those inverses are what cancel the rest pose during skinning.
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(boneOrder.map((id) => bones[id]));
  const boneIndexOf = new Map<string, number>(boneOrder.map((id, i) => [id, i]));

  // Analytic envelope segments (model space) for the primary body masses.
  // v31: head/neck joints follow the grown head cluster (chin -0.148, neck base
  // -0.172); leg envelopes widened with the bulk pass.
  const BONE_JOINT: Record<string, number[]> = {
    pelvis: [0, P.hipY, 0], abdomen: [0, -0.36, 0], chest: [0, -0.245, 0],
    neck: [0, -0.145, 0], head: [0, -0.088, 0],
    "thigh-l": [P.legX, P.hipY, 0], "thigh-r": [-P.legX, P.hipY, 0],
    "shin-l": [P.kneeX, P.kneeY, 0.005], "shin-r": [-P.kneeX, P.kneeY, 0.005],
    "foot-l": [P.ankleX, P.ankleY, -0.008], "foot-r": [-P.ankleX, P.ankleY, -0.008],
  };
  const BONE_TIP: Record<string, number[]> = {
    pelvis: [0, -0.36, 0], abdomen: [0, -0.245, 0], chest: [0, -0.145, 0],
    neck: [0, -0.088, 0], head: [0, -0.02, 0.006],
    "thigh-l": [P.kneeX, P.kneeY, 0.005], "thigh-r": [-P.kneeX, P.kneeY, 0.005],
    "shin-l": [P.ankleX, P.ankleY, -0.008], "shin-r": [-P.ankleX, P.ankleY, -0.008],
    "foot-l": [P.ankleX, -0.962, 0.045], "foot-r": [-P.ankleX, -0.962, 0.045],
  };
  const BONE_ENVELOPE: Record<string, number> = {
    pelvis: 0.115, abdomen: 0.1, chest: 0.14, neck: 0.05, head: 0.065,
    "thigh-l": 0.07, "thigh-r": 0.07, "shin-l": 0.056, "shin-r": 0.056,
    "foot-l": 0.046, "foot-r": 0.046,
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
    method: "8x8 grid IoU of projected module geometry vs turnaround front crop (references/derived/turnaround/front.png); per-view profile agreement reported by scripts/compare-profiles.py on .img2threejs/npc-operator/gauntlet-loop/r5 (v31 vision-fidelity loop, iteration 5; independent vision review scored v30 62% and drives this REBALANCE pass — goggles worn over the eyes as a wide dark visor band with the crown housing removed, bulky layered body ~15-20% with a 1/7-height head, rucksack shrunk 25% into a rounded mid-back-to-waist barrel, deep plate bag + large blank velcro panel + two waist pouches, cooler olive-gray palette with strengthened value separation, proper holster + thigh mag pouch + knuckle plates + prominent strapped knee pads, antenna moved to the character-left pack corner; full 9-view render set + back.png are present in r5)",
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
