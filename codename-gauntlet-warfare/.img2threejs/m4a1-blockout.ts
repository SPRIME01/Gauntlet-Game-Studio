import * as THREE from 'three';
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

// bevelEnabled defaults to true on THREE.ExtrudeGeometry and rounds every
// corner — sharp/pointed profiles (blades, fork tines, spikes) need
// bevelEnabled: false plus lineTo()-only path segments near the tip, since a
// curve command cannot produce a true converging point.
function buildExtrudeShape(points: [number, number][], holes?: [number, number][][]): THREE.Shape {
  const shape = new THREE.Shape();
  if (points.length > 0) {
    shape.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) {
      shape.lineTo(points[i][0], points[i][1]);
    }
  }
  // Cutouts (e.g. an oval wire-cutter hole) as THREE.Path added to shape.holes —
  // dep-free boolean subtraction via the tessellator, no CSG library needed.
  for (const loop of holes ?? []) {
    if (loop.length < 3) continue;
    const path = new THREE.Path();
    path.moveTo(loop[0][0], loop[0][1]);
    for (let i = 1; i < loop.length; i += 1) path.lineTo(loop[i][0], loop[i][1]);
    path.closePath();
    shape.holes.push(path);
  }
  return shape;
}

// Build an N-gon oval loop (for hole authoring from a compact {cx,cy,rx,ry} descriptor).
function ovalLoop(cx: number, cy: number, rx: number, ry: number, seg = 24): [number, number][] {
  const loop: [number, number][] = [];
  for (let i = 0; i < seg; i += 1) {
    const a = (i / seg) * Math.PI * 2;
    loop.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return loop;
}

function buildExtrudeGeometry(profile: { points: [number, number][]; depth: number; holes?: [number, number][][]; ovalHoles?: { cx: number; cy: number; rx: number; ry: number }[] }): THREE.ExtrudeGeometry {
  const holes = [...(profile.holes ?? []), ...((profile.ovalHoles ?? []).map((o) => ovalLoop(o.cx, o.cy, o.rx, o.ry)))];
  const shape = buildExtrudeShape(profile.points, holes);
  return new THREE.ExtrudeGeometry(shape, {
    depth: profile.depth,
    bevelEnabled: false,
    steps: 1,
  });
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

// Generated from ObjectSculptSpec target: M4A1
// Sculpt build pass: blockout
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createM4A1Model(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "M4A1";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 40, "aspect": 1, "orientation": {"yaw": 0, "pitch": 0, "roll": 0}, "positionHint": [0, 0, 3], "note": "For likeness work, solve the reference camera (forge/stage1_intake/solve_camera_pose.py) so the review render aligns with the photo and the reference can be projected. Confirm by overlay review."}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["receiver"] = createSculptMaterial(
    "receiver",
    {"id": "receiver", "name": "receiver", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#39393B", "color": "#39393B", "albedo": {"dominant": "#39393B", "secondary": ["#434345", "#2A2A2B", "#171718", "#727171"], "samplingNotes": "Use image-observed local color zones, not a single averaged color."}, "colorVariation": {"palette": ["#39393B", "#434345", "#2A2A2B", "#171718", "#727171"], "pattern": "mottled", "amplitude": 0.03, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2, 2], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.718, "variation": 0.15, "map": "independent-procedural-field", "localResponse": "higher roughness in cavities, lower roughness on worn edges"}, "metalness": {"base": 0.65, "variation": 0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0, "scale": 1}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#2F2A22"}, "localOverrides": [{"id": "edge-polish", "region": "bevel edges", "roughness": 0.4, "evidenceRefs": ["full-object"], "description": "Restrained edge highlights"}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "referencePbr": {"ok": true, "verdict": "pass", "confidence": 0.812, "estimatedFidelity": 0.812, "targetThreshold": 0.7, "materialId": "receiver", "sourceImage": "/home/sprime01/projects/gauntlet-game-studio/codename-gauntlet-warfare/.img2threejs/zones/receiver.png", "outDir": "/home/sprime01/projects/gauntlet-game-studio/codename-gauntlet-warfare/.img2threejs/materials/receiver", "palette": ["#39393B", "#434345", "#2A2A2B", "#171718", "#727171"], "maps": {"albedo": {"path": "/home/sprime01/projects/gauntlet-game-studio/codename-gauntlet-warfare/.img2threejs/materials/receiver/receiver_albedo.png", "url": "receiver_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/home/sprime01/projects/gauntlet-game-studio/codename-gauntlet-warfare/.img2threejs/materials/receiver/receiver_roughness.png", "url": "receiver_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/home/sprime01/projects/gauntlet-game-studio/codename-gauntlet-warfare/.img2threejs/materials/receiver/receiver_height.png", "url": "receiver_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/home/sprime01/projects/gauntlet-game-studio/codename-gauntlet-warfare/.img2threejs/materials/receiver/receiver_normal.png", "url": "receiver_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/home/sprime01/projects/gauntlet-game-studio/codename-gauntlet-warfare/.img2threejs/materials/receiver/receiver_ao.png", "url": "receiver_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 783, "sourceHeight": 417, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 0, "width": 783, "height": 417}, "mask": {"backgroundColor": "#FFFFFF", "backgroundNoise": 0, "transparentPixelFraction": 0, "foregroundCoverage": 0.8987}, "mapStats": {"valueRange": 0.184, "heightP90Gradient": 0.09621, "roughnessBase": 0.718, "roughnessVariation": 0.179, "normalStrength": 0.269, "blurRadius": 21}, "palette": ["#39393B", "#434345", "#2A2A2B", "#171718", "#727171"]}, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped", "low value range weakens height/roughness inference"], "limitation": "single-image PBR extraction is an estimate; 70%+ extraction confidence still needs render screenshot review", "usable": true}},
    options
  );
  materialMap["polymer"] = createSculptMaterial(
    "polymer",
    {"id": "polymer", "name": "polymer", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#221F1B", "color": "#221F1B", "albedo": {"dominant": "#221F1B", "secondary": ["#090808", "#575759", "#12100E", "#FEFEFE"], "samplingNotes": "Use image-observed local color zones, not a single averaged color."}, "colorVariation": {"palette": ["#221F1B", "#090808", "#575759", "#12100E", "#FEFEFE"], "pattern": "mottled", "amplitude": 0.03, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2, 2], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.68, "variation": 0.15, "map": "independent-procedural-field", "localResponse": "higher roughness in cavities, lower roughness on worn edges"}, "metalness": {"base": 0, "variation": 0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0, "scale": 1}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#2F2A22"}, "localOverrides": [{"id": "edge-polish", "region": "bevel edges", "roughness": 0.4, "evidenceRefs": ["full-object"], "description": "Restrained edge highlights"}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "referencePbr": {"ok": true, "verdict": "pass", "confidence": 0.832, "estimatedFidelity": 0.832, "targetThreshold": 0.7, "materialId": "polymer", "sourceImage": "/home/sprime01/projects/gauntlet-game-studio/codename-gauntlet-warfare/.img2threejs/zones/polymer.png", "outDir": "/home/sprime01/projects/gauntlet-game-studio/codename-gauntlet-warfare/.img2threejs/materials/polymer", "palette": ["#221F1B", "#090808", "#575759", "#12100E", "#FEFEFE"], "maps": {"albedo": {"path": "/home/sprime01/projects/gauntlet-game-studio/codename-gauntlet-warfare/.img2threejs/materials/polymer/polymer_albedo.png", "url": "polymer_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/home/sprime01/projects/gauntlet-game-studio/codename-gauntlet-warfare/.img2threejs/materials/polymer/polymer_roughness.png", "url": "polymer_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/home/sprime01/projects/gauntlet-game-studio/codename-gauntlet-warfare/.img2threejs/materials/polymer/polymer_height.png", "url": "polymer_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/home/sprime01/projects/gauntlet-game-studio/codename-gauntlet-warfare/.img2threejs/materials/polymer/polymer_normal.png", "url": "polymer_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/home/sprime01/projects/gauntlet-game-studio/codename-gauntlet-warfare/.img2threejs/materials/polymer/polymer_ao.png", "url": "polymer_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 522, "sourceHeight": 165, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 0, "width": 522, "height": 165}, "mask": {"backgroundColor": "#242320", "backgroundNoise": 30.166, "transparentPixelFraction": 0, "foregroundCoverage": 0.1115}, "mapStats": {"valueRange": 0.977, "heightP90Gradient": 0.00992, "roughnessBase": 0.68, "roughnessVariation": 0.05, "normalStrength": 0.168, "blurRadius": 21}, "palette": ["#221F1B", "#090808", "#575759", "#12100E", "#FEFEFE"]}, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped"], "limitation": "single-image PBR extraction is an estimate; 70%+ extraction confidence still needs render screenshot review", "usable": true}},
    options
  );
  materialMap["magazine"] = createSculptMaterial(
    "magazine",
    {"id": "magazine", "name": "magazine", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#7A7D82", "color": "#7A7D82", "albedo": {"dominant": "#7A7D82", "secondary": ["#7E8187", "#74777C", "#66686D", "#FEFEFE"], "samplingNotes": "Use image-observed local color zones, not a single averaged color."}, "colorVariation": {"palette": ["#7A7D82", "#7E8187", "#74777C", "#66686D", "#FEFEFE"], "pattern": "mottled", "amplitude": 0.03, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2, 2], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.687, "variation": 0.15, "map": "independent-procedural-field", "localResponse": "higher roughness in cavities, lower roughness on worn edges"}, "metalness": {"base": 0.65, "variation": 0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0, "scale": 1}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#2F2A22"}, "localOverrides": [{"id": "edge-polish", "region": "bevel edges", "roughness": 0.4, "evidenceRefs": ["full-object"], "description": "Restrained edge highlights"}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Replace with image-derived color, roughness, noise, and edge-wear notes.", "referencePbr": {"ok": true, "verdict": "pass", "confidence": 0.758, "estimatedFidelity": 0.758, "targetThreshold": 0.7, "materialId": "magazine", "sourceImage": "/home/sprime01/projects/gauntlet-game-studio/codename-gauntlet-warfare/.img2threejs/zones/magazine.png", "outDir": "/home/sprime01/projects/gauntlet-game-studio/codename-gauntlet-warfare/.img2threejs/materials/magazine", "palette": ["#7A7D82", "#7E8187", "#74777C", "#66686D", "#FEFEFE"], "maps": {"albedo": {"path": "/home/sprime01/projects/gauntlet-game-studio/codename-gauntlet-warfare/.img2threejs/materials/magazine/magazine_albedo.png", "url": "magazine_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/home/sprime01/projects/gauntlet-game-studio/codename-gauntlet-warfare/.img2threejs/materials/magazine/magazine_roughness.png", "url": "magazine_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/home/sprime01/projects/gauntlet-game-studio/codename-gauntlet-warfare/.img2threejs/materials/magazine/magazine_height.png", "url": "magazine_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/home/sprime01/projects/gauntlet-game-studio/codename-gauntlet-warfare/.img2threejs/materials/magazine/magazine_normal.png", "url": "magazine_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/home/sprime01/projects/gauntlet-game-studio/codename-gauntlet-warfare/.img2threejs/materials/magazine/magazine_ao.png", "url": "magazine_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 261, "sourceHeight": 296, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 0, "width": 261, "height": 296}, "mask": {"backgroundColor": "#FFFFFF", "backgroundNoise": 224.706, "transparentPixelFraction": 0, "foregroundCoverage": 1}, "mapStats": {"valueRange": 0.5838, "heightP90Gradient": 0.01492, "roughnessBase": 0.687, "roughnessVariation": 0.05, "normalStrength": 0.174, "blurRadius": 21}, "palette": ["#7A7D82", "#7E8187", "#74777C", "#66686D", "#FEFEFE"]}, "warnings": ["foreground mask is tiny; material extraction is likely unreliable", "image is not clearly isolated from background; using most pixels as material evidence", "object/background separation is weak", "single-image inverse rendering cannot prove true physical PBR; confidence is capped"], "limitation": "single-image PBR extraction is an estimate; 70%+ extraction confidence still needs render screenshot review", "usable": true}},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const endpoint_receiver_0 = makeAttachmentEndpoint(null);
  const node_receiver_0 = new THREE.Group();
  node_receiver_0.name = "receiver__pivot";
  node_receiver_0.scale.set(1, 1, 1);
  if (endpoint_receiver_0) {
    node_receiver_0.position.copy(endpoint_receiver_0.start);
    node_receiver_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_receiver_0.position.set(0.0, 0.0, 0.0);
    node_receiver_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_receiver_0.userData.sculptComponent = {"id": "receiver", "name": "receiver", "level": "macro", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": null, "attachment": null, "dimensions": {"width": 0.22, "height": 0.055, "depth": 0.052, "units": "metres", "confidence": 0.75}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "receiver", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}}, "material": "receiver", "materialLayers": ["receiver"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "receiver-edge", "type": "bevel", "description": "Soft machined edge on receiver", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(57, 57, 59, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_receiver_0.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "receiver", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}};
  (nodes["root"] ?? root).add(node_receiver_0);
  nodes["receiver"] = node_receiver_0;
  const mesh_receiver_0Geometry = endpoint_receiver_0
    ? new THREE.CylinderGeometry(endpoint_receiver_0.endRadius, endpoint_receiver_0.baseRadius, endpoint_receiver_0.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_receiver_0) {
    mesh_receiver_0Geometry.scale(0.22, 0.055, 0.052);
  }
  const mesh_receiver_0 = new THREE.Mesh(
    mesh_receiver_0Geometry,
    materialMap["receiver"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_receiver_0.name = "receiver";
  if (endpoint_receiver_0) {
    mesh_receiver_0.position.copy(endpoint_receiver_0.midpoint);
    mesh_receiver_0.quaternion.copy(endpoint_receiver_0.quaternion);
  }
  mesh_receiver_0.castShadow = options.castShadow ?? true;
  mesh_receiver_0.receiveShadow = options.receiveShadow ?? true;
  mesh_receiver_0.userData.sculptComponent = {"id": "receiver", "name": "receiver", "level": "macro", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": null, "attachment": null, "dimensions": {"width": 0.22, "height": 0.055, "depth": 0.052, "units": "metres", "confidence": 0.75}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "receiver", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}}, "material": "receiver", "materialLayers": ["receiver"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "receiver-edge", "type": "bevel", "description": "Soft machined edge on receiver", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(57, 57, 59, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_receiver_0.add(mesh_receiver_0);
  meshes["receiver"] = mesh_receiver_0;
  colliders["receiver"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["receiver"] ??= [];
  destructionGroups["receiver"].push(node_receiver_0);

  const endpoint_lower_1 = makeAttachmentEndpoint(null);
  const node_lower_1 = new THREE.Group();
  node_lower_1.name = "lower__pivot";
  node_lower_1.scale.set(1, 1, 1);
  if (endpoint_lower_1) {
    node_lower_1.position.copy(endpoint_lower_1.start);
    node_lower_1.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lower_1.position.set(0.048, -0.052, 0.0);
    node_lower_1.rotation.set(0.0, 0.0, 0.0);
  }
  node_lower_1.userData.sculptComponent = {"id": "lower", "name": "lower", "level": "macro", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "receiver", "attachment": null, "dimensions": {"width": 0.085, "height": 0.067, "depth": 0.05, "units": "metres", "confidence": 0.8}, "transform": {"position": [0.048, -0.052, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lower", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}}, "material": "receiver", "materialLayers": ["receiver"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lower-edge", "type": "bevel", "description": "Soft machined edge on lower", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(57, 57, 59, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_lower_1.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lower", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}};
  (nodes["receiver"] ?? root).add(node_lower_1);
  nodes["lower"] = node_lower_1;
  const mesh_lower_1Geometry = endpoint_lower_1
    ? new THREE.CylinderGeometry(endpoint_lower_1.endRadius, endpoint_lower_1.baseRadius, endpoint_lower_1.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_lower_1) {
    mesh_lower_1Geometry.scale(0.085, 0.067, 0.05);
  }
  const mesh_lower_1 = new THREE.Mesh(
    mesh_lower_1Geometry,
    materialMap["receiver"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lower_1.name = "lower";
  if (endpoint_lower_1) {
    mesh_lower_1.position.copy(endpoint_lower_1.midpoint);
    mesh_lower_1.quaternion.copy(endpoint_lower_1.quaternion);
  }
  mesh_lower_1.castShadow = options.castShadow ?? true;
  mesh_lower_1.receiveShadow = options.receiveShadow ?? true;
  mesh_lower_1.userData.sculptComponent = {"id": "lower", "name": "lower", "level": "macro", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "receiver", "attachment": null, "dimensions": {"width": 0.085, "height": 0.067, "depth": 0.05, "units": "metres", "confidence": 0.8}, "transform": {"position": [0.048, -0.052, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lower", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}}, "material": "receiver", "materialLayers": ["receiver"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lower-edge", "type": "bevel", "description": "Soft machined edge on lower", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(57, 57, 59, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_lower_1.add(mesh_lower_1);
  meshes["lower"] = mesh_lower_1;
  colliders["lower"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["lower"] ??= [];
  destructionGroups["lower"].push(node_lower_1);

  const endpoint_handguard_2 = makeAttachmentEndpoint(null);
  const node_handguard_2 = new THREE.Group();
  node_handguard_2.name = "handguard__pivot";
  node_handguard_2.scale.set(1, 1, 1);
  if (endpoint_handguard_2) {
    node_handguard_2.position.copy(endpoint_handguard_2.start);
    node_handguard_2.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_handguard_2.position.set(0.218, 0.0, 0.0);
    node_handguard_2.rotation.set(0.0, 0.0, 0.0);
  }
  node_handguard_2.userData.sculptComponent = {"id": "handguard", "name": "handguard", "level": "macro", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "receiver", "attachment": null, "dimensions": {"width": 0.2, "height": 0.063, "depth": 0.067, "units": "metres", "confidence": 0.75}, "transform": {"position": [0.218, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "handguard", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "polymer"}}, "material": "polymer", "materialLayers": ["polymer"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "handguard-edge", "type": "bevel", "description": "Soft machined edge on handguard", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(34, 31, 27, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_handguard_2.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "handguard", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "polymer"}};
  (nodes["receiver"] ?? root).add(node_handguard_2);
  nodes["handguard"] = node_handguard_2;
  const mesh_handguard_2Geometry = endpoint_handguard_2
    ? new THREE.CylinderGeometry(endpoint_handguard_2.endRadius, endpoint_handguard_2.baseRadius, endpoint_handguard_2.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_handguard_2) {
    mesh_handguard_2Geometry.scale(0.2, 0.063, 0.067);
  }
  const mesh_handguard_2 = new THREE.Mesh(
    mesh_handguard_2Geometry,
    materialMap["polymer"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_handguard_2.name = "handguard";
  if (endpoint_handguard_2) {
    mesh_handguard_2.position.copy(endpoint_handguard_2.midpoint);
    mesh_handguard_2.quaternion.copy(endpoint_handguard_2.quaternion);
  }
  mesh_handguard_2.castShadow = options.castShadow ?? true;
  mesh_handguard_2.receiveShadow = options.receiveShadow ?? true;
  mesh_handguard_2.userData.sculptComponent = {"id": "handguard", "name": "handguard", "level": "macro", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "receiver", "attachment": null, "dimensions": {"width": 0.2, "height": 0.063, "depth": 0.067, "units": "metres", "confidence": 0.75}, "transform": {"position": [0.218, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "handguard", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "polymer"}}, "material": "polymer", "materialLayers": ["polymer"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "handguard-edge", "type": "bevel", "description": "Soft machined edge on handguard", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(34, 31, 27, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_handguard_2.add(mesh_handguard_2);
  meshes["handguard"] = mesh_handguard_2;
  colliders["handguard"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["handguard"] ??= [];
  destructionGroups["handguard"].push(node_handguard_2);

  const endpoint_stock_3 = makeAttachmentEndpoint(null);
  const node_stock_3 = new THREE.Group();
  node_stock_3.name = "stock__pivot";
  node_stock_3.scale.set(1, 1, 1);
  if (endpoint_stock_3) {
    node_stock_3.position.copy(endpoint_stock_3.start);
    node_stock_3.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_stock_3.position.set(-0.235, -0.002, 0.0);
    node_stock_3.rotation.set(0.0, 0.0, 0.0);
  }
  node_stock_3.userData.sculptComponent = {"id": "stock", "name": "stock", "level": "macro", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "receiver", "attachment": null, "dimensions": {"width": 0.16, "height": 0.05, "depth": 0.046, "units": "metres", "confidence": 0.75}, "transform": {"position": [-0.235, -0.002, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "stock", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "polymer"}}, "material": "polymer", "materialLayers": ["polymer"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "stock-edge", "type": "bevel", "description": "Soft machined edge on stock", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(34, 31, 27, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_stock_3.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "stock", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "polymer"}};
  (nodes["receiver"] ?? root).add(node_stock_3);
  nodes["stock"] = node_stock_3;
  const mesh_stock_3Geometry = endpoint_stock_3
    ? new THREE.CylinderGeometry(endpoint_stock_3.endRadius, endpoint_stock_3.baseRadius, endpoint_stock_3.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_stock_3) {
    mesh_stock_3Geometry.scale(0.16, 0.05, 0.046);
  }
  const mesh_stock_3 = new THREE.Mesh(
    mesh_stock_3Geometry,
    materialMap["polymer"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_stock_3.name = "stock";
  if (endpoint_stock_3) {
    mesh_stock_3.position.copy(endpoint_stock_3.midpoint);
    mesh_stock_3.quaternion.copy(endpoint_stock_3.quaternion);
  }
  mesh_stock_3.castShadow = options.castShadow ?? true;
  mesh_stock_3.receiveShadow = options.receiveShadow ?? true;
  mesh_stock_3.userData.sculptComponent = {"id": "stock", "name": "stock", "level": "macro", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "receiver", "attachment": null, "dimensions": {"width": 0.16, "height": 0.05, "depth": 0.046, "units": "metres", "confidence": 0.75}, "transform": {"position": [-0.235, -0.002, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "stock", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "polymer"}}, "material": "polymer", "materialLayers": ["polymer"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "stock-edge", "type": "bevel", "description": "Soft machined edge on stock", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(34, 31, 27, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_stock_3.add(mesh_stock_3);
  meshes["stock"] = mesh_stock_3;
  colliders["stock"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["stock"] ??= [];
  destructionGroups["stock"].push(node_stock_3);

  const endpoint_magazine_4 = makeAttachmentEndpoint(null);
  const node_magazine_4 = new THREE.Group();
  node_magazine_4.name = "magazine__pivot";
  node_magazine_4.scale.set(1, 1, 1);
  if (endpoint_magazine_4) {
    node_magazine_4.position.copy(endpoint_magazine_4.start);
    node_magazine_4.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_magazine_4.position.set(0.046, -0.139, 0.0);
    node_magazine_4.rotation.set(0.0, 0.0, 0.0);
  }
  node_magazine_4.userData.sculptComponent = {"id": "magazine", "name": "magazine", "level": "macro", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "extrude", "topologyClass": "continuous-sculpt", "topologyRationale": "Curved box-magazine outline requires a closed volumetric profile rather than a rotated cuboid.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.48, 0.5], [0.48, 0.5], [0.46, 0.25], [0.39, 0], [0.28, -0.25], [0.12, -0.5], [-0.5, -0.38], [-0.38, -0.1], [-0.35, 0.2]], "bevelEnabled": false}}, "parent": "receiver", "attachment": null, "dimensions": {"width": 0.075, "height": 0.118, "depth": 0.027, "units": "metres", "confidence": 0.75}, "transform": {"position": [0.046, -0.139, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "magazine", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "magazine"}}, "material": "magazine", "materialLayers": ["magazine"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "magazine-edge", "type": "bevel", "description": "Soft machined edge on magazine", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(122, 125, 130, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_magazine_4.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "magazine", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "magazine"}};
  (nodes["receiver"] ?? root).add(node_magazine_4);
  nodes["magazine"] = node_magazine_4;
  const mesh_magazine_4Geometry = endpoint_magazine_4
    ? new THREE.CylinderGeometry(endpoint_magazine_4.endRadius, endpoint_magazine_4.baseRadius, endpoint_magazine_4.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.48, 0.5], [0.48, 0.5], [0.46, 0.25], [0.39, 0], [0.28, -0.25], [0.12, -0.5], [-0.5, -0.38], [-0.38, -0.1], [-0.35, 0.2]], "bevelEnabled": false});
  if (!endpoint_magazine_4) {
    mesh_magazine_4Geometry.scale(0.075, 0.118, 0.027);
  }
  const mesh_magazine_4 = new THREE.Mesh(
    mesh_magazine_4Geometry,
    materialMap["magazine"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_magazine_4.name = "magazine";
  if (endpoint_magazine_4) {
    mesh_magazine_4.position.copy(endpoint_magazine_4.midpoint);
    mesh_magazine_4.quaternion.copy(endpoint_magazine_4.quaternion);
  }
  mesh_magazine_4.castShadow = options.castShadow ?? true;
  mesh_magazine_4.receiveShadow = options.receiveShadow ?? true;
  mesh_magazine_4.userData.sculptComponent = {"id": "magazine", "name": "magazine", "level": "macro", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "extrude", "topologyClass": "continuous-sculpt", "topologyRationale": "Curved box-magazine outline requires a closed volumetric profile rather than a rotated cuboid.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.48, 0.5], [0.48, 0.5], [0.46, 0.25], [0.39, 0], [0.28, -0.25], [0.12, -0.5], [-0.5, -0.38], [-0.38, -0.1], [-0.35, 0.2]], "bevelEnabled": false}}, "parent": "receiver", "attachment": null, "dimensions": {"width": 0.075, "height": 0.118, "depth": 0.027, "units": "metres", "confidence": 0.75}, "transform": {"position": [0.046, -0.139, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "magazine", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "magazine"}}, "material": "magazine", "materialLayers": ["magazine"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "magazine-edge", "type": "bevel", "description": "Soft machined edge on magazine", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(122, 125, 130, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_magazine_4.add(mesh_magazine_4);
  meshes["magazine"] = mesh_magazine_4;
  colliders["magazine"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["magazine"] ??= [];
  destructionGroups["magazine"].push(node_magazine_4);

  const endpoint_grip_5 = makeAttachmentEndpoint(null);
  const node_grip_5 = new THREE.Group();
  node_grip_5.name = "grip__pivot";
  node_grip_5.scale.set(1, 1, 1);
  if (endpoint_grip_5) {
    node_grip_5.position.copy(endpoint_grip_5.start);
    node_grip_5.rotation.set(0.0, 0.0, -0.35);
  } else {
    node_grip_5.position.set(-0.097, -0.117, 0.0);
    node_grip_5.rotation.set(0.0, 0.0, -0.35);
  }
  node_grip_5.userData.sculptComponent = {"id": "grip", "name": "grip", "level": "macro", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "receiver", "attachment": null, "dimensions": {"width": 0.045, "height": 0.105, "depth": 0.034, "units": "metres", "confidence": 0.75}, "transform": {"position": [-0.097, -0.117, 0], "rotation": [0, 0, -0.35]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "grip", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "polymer"}}, "material": "polymer", "materialLayers": ["polymer"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "grip-edge", "type": "bevel", "description": "Soft machined edge on grip", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(34, 31, 27, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_grip_5.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "grip", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "polymer"}};
  (nodes["receiver"] ?? root).add(node_grip_5);
  nodes["grip"] = node_grip_5;
  const mesh_grip_5Geometry = endpoint_grip_5
    ? new THREE.CylinderGeometry(endpoint_grip_5.endRadius, endpoint_grip_5.baseRadius, endpoint_grip_5.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_grip_5) {
    mesh_grip_5Geometry.scale(0.045, 0.105, 0.034);
  }
  const mesh_grip_5 = new THREE.Mesh(
    mesh_grip_5Geometry,
    materialMap["polymer"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_grip_5.name = "grip";
  if (endpoint_grip_5) {
    mesh_grip_5.position.copy(endpoint_grip_5.midpoint);
    mesh_grip_5.quaternion.copy(endpoint_grip_5.quaternion);
  }
  mesh_grip_5.castShadow = options.castShadow ?? true;
  mesh_grip_5.receiveShadow = options.receiveShadow ?? true;
  mesh_grip_5.userData.sculptComponent = {"id": "grip", "name": "grip", "level": "macro", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "receiver", "attachment": null, "dimensions": {"width": 0.045, "height": 0.105, "depth": 0.034, "units": "metres", "confidence": 0.75}, "transform": {"position": [-0.097, -0.117, 0], "rotation": [0, 0, -0.35]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "grip", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "polymer"}}, "material": "polymer", "materialLayers": ["polymer"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "grip-edge", "type": "bevel", "description": "Soft machined edge on grip", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(34, 31, 27, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_grip_5.add(mesh_grip_5);
  meshes["grip"] = mesh_grip_5;
  colliders["grip"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["grip"] ??= [];
  destructionGroups["grip"].push(node_grip_5);

  const attachment_barrel_6 = {"parentId": "receiver", "parentSocket": "barrel-mount", "localStart": [0.3, 0, 0], "localEnd": [0.52, 0, 0], "baseRadius": 0.0085, "endRadius": 0.0085, "embedDepth": 0.02, "gapTolerance": 0.001, "contactType": "overlap", "evidenceRefs": ["full-object"]};
  const endpoint_barrel_6 = makeAttachmentEndpoint(attachment_barrel_6);
  const node_barrel_6 = new THREE.Group();
  node_barrel_6.name = "barrel__pivot";
  node_barrel_6.scale.set(1, 1, 1);
  if (endpoint_barrel_6) {
    node_barrel_6.position.copy(endpoint_barrel_6.start);
    node_barrel_6.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_barrel_6.position.set(0.413, 0.0, 0.0);
    node_barrel_6.rotation.set(0.0, 0.0, 0.0);
  }
  node_barrel_6.userData.sculptComponent = {"id": "barrel", "name": "barrel", "level": "macro", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "receiver", "attachment": {"parentId": "receiver", "parentSocket": "barrel-mount", "localStart": [0.3, 0, 0], "localEnd": [0.52, 0, 0], "baseRadius": 0.0085, "endRadius": 0.0085, "embedDepth": 0.02, "gapTolerance": 0.001, "contactType": "overlap", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.017, "height": 0.21, "depth": 0.017, "units": "metres", "confidence": 0.75}, "transform": {"position": [0.413, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "barrel", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}}, "material": "receiver", "materialLayers": ["receiver"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "barrel-edge", "type": "bevel", "description": "Soft machined edge on barrel", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(57, 57, 59, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_barrel_6.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "barrel", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}};
  (nodes["receiver"] ?? root).add(node_barrel_6);
  nodes["barrel"] = node_barrel_6;
  const mesh_barrel_6Geometry = endpoint_barrel_6
    ? new THREE.CylinderGeometry(endpoint_barrel_6.endRadius, endpoint_barrel_6.baseRadius, endpoint_barrel_6.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_barrel_6) {
    mesh_barrel_6Geometry.scale(0.017, 0.21, 0.017);
  }
  const mesh_barrel_6 = new THREE.Mesh(
    mesh_barrel_6Geometry,
    materialMap["receiver"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_barrel_6.name = "barrel";
  if (endpoint_barrel_6) {
    mesh_barrel_6.position.copy(endpoint_barrel_6.midpoint);
    mesh_barrel_6.quaternion.copy(endpoint_barrel_6.quaternion);
  }
  mesh_barrel_6.castShadow = options.castShadow ?? true;
  mesh_barrel_6.receiveShadow = options.receiveShadow ?? true;
  mesh_barrel_6.userData.sculptComponent = {"id": "barrel", "name": "barrel", "level": "macro", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "receiver", "attachment": {"parentId": "receiver", "parentSocket": "barrel-mount", "localStart": [0.3, 0, 0], "localEnd": [0.52, 0, 0], "baseRadius": 0.0085, "endRadius": 0.0085, "embedDepth": 0.02, "gapTolerance": 0.001, "contactType": "overlap", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.017, "height": 0.21, "depth": 0.017, "units": "metres", "confidence": 0.75}, "transform": {"position": [0.413, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "barrel", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}}, "material": "receiver", "materialLayers": ["receiver"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "barrel-edge", "type": "bevel", "description": "Soft machined edge on barrel", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(57, 57, 59, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_barrel_6.add(mesh_barrel_6);
  meshes["barrel"] = mesh_barrel_6;
  colliders["barrel"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["barrel"] ??= [];
  destructionGroups["barrel"].push(node_barrel_6);

  const attachment_buffer_tube_7 = {"parentId": "receiver", "parentSocket": "buffer-tube-mount", "localStart": [-0.1, 0, 0], "localEnd": [-0.21, 0, 0], "baseRadius": 0.015, "endRadius": 0.015, "embedDepth": 0.02, "gapTolerance": 0.001, "contactType": "overlap", "evidenceRefs": ["full-object"]};
  const endpoint_buffer_tube_7 = makeAttachmentEndpoint(attachment_buffer_tube_7);
  const node_buffer_tube_7 = new THREE.Group();
  node_buffer_tube_7.name = "buffer-tube__pivot";
  node_buffer_tube_7.scale.set(1, 1, 1);
  if (endpoint_buffer_tube_7) {
    node_buffer_tube_7.position.copy(endpoint_buffer_tube_7.start);
    node_buffer_tube_7.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_buffer_tube_7.position.set(-0.151, 0.0, 0.0);
    node_buffer_tube_7.rotation.set(0.0, 0.0, 0.0);
  }
  node_buffer_tube_7.userData.sculptComponent = {"id": "buffer-tube", "name": "buffer-tube", "level": "meso", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "receiver", "attachment": {"parentId": "receiver", "parentSocket": "buffer-tube-mount", "localStart": [-0.1, 0, 0], "localEnd": [-0.21, 0, 0], "baseRadius": 0.015, "endRadius": 0.015, "embedDepth": 0.02, "gapTolerance": 0.001, "contactType": "overlap", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.03, "height": 0.12, "depth": 0.03, "units": "metres", "confidence": 0.75}, "transform": {"position": [-0.151, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "buffer-tube", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}}, "material": "receiver", "materialLayers": ["receiver"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "buffer-tube-edge", "type": "bevel", "description": "Soft machined edge on buffer-tube", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(57, 57, 59, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_buffer_tube_7.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "buffer-tube", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}};
  (nodes["receiver"] ?? root).add(node_buffer_tube_7);
  nodes["buffer-tube"] = node_buffer_tube_7;
  const mesh_buffer_tube_7Geometry = endpoint_buffer_tube_7
    ? new THREE.CylinderGeometry(endpoint_buffer_tube_7.endRadius, endpoint_buffer_tube_7.baseRadius, endpoint_buffer_tube_7.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_buffer_tube_7) {
    mesh_buffer_tube_7Geometry.scale(0.03, 0.12, 0.03);
  }
  const mesh_buffer_tube_7 = new THREE.Mesh(
    mesh_buffer_tube_7Geometry,
    materialMap["receiver"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_buffer_tube_7.name = "buffer-tube";
  if (endpoint_buffer_tube_7) {
    mesh_buffer_tube_7.position.copy(endpoint_buffer_tube_7.midpoint);
    mesh_buffer_tube_7.quaternion.copy(endpoint_buffer_tube_7.quaternion);
  }
  mesh_buffer_tube_7.castShadow = options.castShadow ?? true;
  mesh_buffer_tube_7.receiveShadow = options.receiveShadow ?? true;
  mesh_buffer_tube_7.userData.sculptComponent = {"id": "buffer-tube", "name": "buffer-tube", "level": "meso", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "receiver", "attachment": {"parentId": "receiver", "parentSocket": "buffer-tube-mount", "localStart": [-0.1, 0, 0], "localEnd": [-0.21, 0, 0], "baseRadius": 0.015, "endRadius": 0.015, "embedDepth": 0.02, "gapTolerance": 0.001, "contactType": "overlap", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.03, "height": 0.12, "depth": 0.03, "units": "metres", "confidence": 0.75}, "transform": {"position": [-0.151, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "buffer-tube", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}}, "material": "receiver", "materialLayers": ["receiver"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "buffer-tube-edge", "type": "bevel", "description": "Soft machined edge on buffer-tube", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(57, 57, 59, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_buffer_tube_7.add(mesh_buffer_tube_7);
  meshes["buffer-tube"] = mesh_buffer_tube_7;
  colliders["buffer-tube"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["buffer-tube"] ??= [];
  destructionGroups["buffer-tube"].push(node_buffer_tube_7);

  const attachment_muzzle_8 = {"parentId": "receiver", "parentSocket": "muzzle-mount", "localStart": [0.5, 0, 0], "localEnd": [0.542, 0, 0], "baseRadius": 0.012, "endRadius": 0.012, "embedDepth": 0.02, "gapTolerance": 0.001, "contactType": "overlap", "evidenceRefs": ["full-object"]};
  const endpoint_muzzle_8 = makeAttachmentEndpoint(attachment_muzzle_8);
  const node_muzzle_8 = new THREE.Group();
  node_muzzle_8.name = "muzzle__pivot";
  node_muzzle_8.scale.set(1, 1, 1);
  if (endpoint_muzzle_8) {
    node_muzzle_8.position.copy(endpoint_muzzle_8.start);
    node_muzzle_8.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_muzzle_8.position.set(0.525, 0.0, 0.0);
    node_muzzle_8.rotation.set(0.0, 0.0, 0.0);
  }
  node_muzzle_8.userData.sculptComponent = {"id": "muzzle", "name": "muzzle", "level": "meso", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "receiver", "attachment": {"parentId": "receiver", "parentSocket": "muzzle-mount", "localStart": [0.5, 0, 0], "localEnd": [0.542, 0, 0], "baseRadius": 0.012, "endRadius": 0.012, "embedDepth": 0.02, "gapTolerance": 0.001, "contactType": "overlap", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.024, "height": 0.034, "depth": 0.024, "units": "metres", "confidence": 0.75}, "transform": {"position": [0.525, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "muzzle", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}}, "material": "receiver", "materialLayers": ["receiver"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "muzzle-edge", "type": "bevel", "description": "Soft machined edge on muzzle", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(57, 57, 59, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_muzzle_8.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "muzzle", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}};
  (nodes["receiver"] ?? root).add(node_muzzle_8);
  nodes["muzzle"] = node_muzzle_8;
  const mesh_muzzle_8Geometry = endpoint_muzzle_8
    ? new THREE.CylinderGeometry(endpoint_muzzle_8.endRadius, endpoint_muzzle_8.baseRadius, endpoint_muzzle_8.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_muzzle_8) {
    mesh_muzzle_8Geometry.scale(0.024, 0.034, 0.024);
  }
  const mesh_muzzle_8 = new THREE.Mesh(
    mesh_muzzle_8Geometry,
    materialMap["receiver"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_muzzle_8.name = "muzzle";
  if (endpoint_muzzle_8) {
    mesh_muzzle_8.position.copy(endpoint_muzzle_8.midpoint);
    mesh_muzzle_8.quaternion.copy(endpoint_muzzle_8.quaternion);
  }
  mesh_muzzle_8.castShadow = options.castShadow ?? true;
  mesh_muzzle_8.receiveShadow = options.receiveShadow ?? true;
  mesh_muzzle_8.userData.sculptComponent = {"id": "muzzle", "name": "muzzle", "level": "meso", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "receiver", "attachment": {"parentId": "receiver", "parentSocket": "muzzle-mount", "localStart": [0.5, 0, 0], "localEnd": [0.542, 0, 0], "baseRadius": 0.012, "endRadius": 0.012, "embedDepth": 0.02, "gapTolerance": 0.001, "contactType": "overlap", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.024, "height": 0.034, "depth": 0.024, "units": "metres", "confidence": 0.75}, "transform": {"position": [0.525, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "muzzle", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}}, "material": "receiver", "materialLayers": ["receiver"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "muzzle-edge", "type": "bevel", "description": "Soft machined edge on muzzle", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(57, 57, 59, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_muzzle_8.add(mesh_muzzle_8);
  meshes["muzzle"] = mesh_muzzle_8;
  colliders["muzzle"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["muzzle"] ??= [];
  destructionGroups["muzzle"].push(node_muzzle_8);

  const attachment_foregrip_9 = {"parentId": "receiver", "parentSocket": "foregrip-mount", "localStart": [0.257, -0.02, 0], "localEnd": [0.257, -0.15, 0], "baseRadius": 0.0175, "endRadius": 0.0175, "embedDepth": 0.02, "gapTolerance": 0.001, "contactType": "overlap", "evidenceRefs": ["full-object"]};
  const endpoint_foregrip_9 = makeAttachmentEndpoint(attachment_foregrip_9);
  const node_foregrip_9 = new THREE.Group();
  node_foregrip_9.name = "foregrip__pivot";
  node_foregrip_9.scale.set(1, 1, 1);
  if (endpoint_foregrip_9) {
    node_foregrip_9.position.copy(endpoint_foregrip_9.start);
    node_foregrip_9.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_foregrip_9.position.set(0.257, -0.085, 0.0);
    node_foregrip_9.rotation.set(0.0, 0.0, 0.0);
  }
  node_foregrip_9.userData.sculptComponent = {"id": "foregrip", "name": "foregrip", "level": "meso", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "receiver", "attachment": {"parentId": "receiver", "parentSocket": "foregrip-mount", "localStart": [0.257, -0.02, 0], "localEnd": [0.257, -0.15, 0], "baseRadius": 0.0175, "endRadius": 0.0175, "embedDepth": 0.02, "gapTolerance": 0.001, "contactType": "overlap", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.035, "height": 0.125, "depth": 0.035, "units": "metres", "confidence": 0.75}, "transform": {"position": [0.257, -0.085, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "foregrip", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "polymer"}}, "material": "polymer", "materialLayers": ["polymer"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "foregrip-edge", "type": "bevel", "description": "Soft machined edge on foregrip", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(34, 31, 27, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_foregrip_9.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "foregrip", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "polymer"}};
  (nodes["receiver"] ?? root).add(node_foregrip_9);
  nodes["foregrip"] = node_foregrip_9;
  const mesh_foregrip_9Geometry = endpoint_foregrip_9
    ? new THREE.CylinderGeometry(endpoint_foregrip_9.endRadius, endpoint_foregrip_9.baseRadius, endpoint_foregrip_9.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_foregrip_9) {
    mesh_foregrip_9Geometry.scale(0.035, 0.125, 0.035);
  }
  const mesh_foregrip_9 = new THREE.Mesh(
    mesh_foregrip_9Geometry,
    materialMap["polymer"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_foregrip_9.name = "foregrip";
  if (endpoint_foregrip_9) {
    mesh_foregrip_9.position.copy(endpoint_foregrip_9.midpoint);
    mesh_foregrip_9.quaternion.copy(endpoint_foregrip_9.quaternion);
  }
  mesh_foregrip_9.castShadow = options.castShadow ?? true;
  mesh_foregrip_9.receiveShadow = options.receiveShadow ?? true;
  mesh_foregrip_9.userData.sculptComponent = {"id": "foregrip", "name": "foregrip", "level": "meso", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "receiver", "attachment": {"parentId": "receiver", "parentSocket": "foregrip-mount", "localStart": [0.257, -0.02, 0], "localEnd": [0.257, -0.15, 0], "baseRadius": 0.0175, "endRadius": 0.0175, "embedDepth": 0.02, "gapTolerance": 0.001, "contactType": "overlap", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.035, "height": 0.125, "depth": 0.035, "units": "metres", "confidence": 0.75}, "transform": {"position": [0.257, -0.085, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "foregrip", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "polymer"}}, "material": "polymer", "materialLayers": ["polymer"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "foregrip-edge", "type": "bevel", "description": "Soft machined edge on foregrip", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(34, 31, 27, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_foregrip_9.add(mesh_foregrip_9);
  meshes["foregrip"] = mesh_foregrip_9;
  colliders["foregrip"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["foregrip"] ??= [];
  destructionGroups["foregrip"].push(node_foregrip_9);

  const endpoint_stock_heel_10 = makeAttachmentEndpoint(null);
  const node_stock_heel_10 = new THREE.Group();
  node_stock_heel_10.name = "stock-heel__pivot";
  node_stock_heel_10.scale.set(1, 1, 1);
  if (endpoint_stock_heel_10) {
    node_stock_heel_10.position.copy(endpoint_stock_heel_10.start);
    node_stock_heel_10.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_stock_heel_10.position.set(-0.31, -0.05, 0.0);
    node_stock_heel_10.rotation.set(0.0, 0.0, 0.0);
  }
  node_stock_heel_10.userData.sculptComponent = {"id": "stock-heel", "name": "stock-heel", "level": "meso", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "receiver", "attachment": null, "dimensions": {"width": 0.021, "height": 0.14, "depth": 0.048, "units": "metres", "confidence": 0.75}, "transform": {"position": [-0.31, -0.05, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "stock-heel", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "polymer"}}, "material": "polymer", "materialLayers": ["polymer"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "stock-heel-edge", "type": "bevel", "description": "Soft machined edge on stock-heel", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(34, 31, 27, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_stock_heel_10.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "stock-heel", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "polymer"}};
  (nodes["receiver"] ?? root).add(node_stock_heel_10);
  nodes["stock-heel"] = node_stock_heel_10;
  const mesh_stock_heel_10Geometry = endpoint_stock_heel_10
    ? new THREE.CylinderGeometry(endpoint_stock_heel_10.endRadius, endpoint_stock_heel_10.baseRadius, endpoint_stock_heel_10.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_stock_heel_10) {
    mesh_stock_heel_10Geometry.scale(0.021, 0.14, 0.048);
  }
  const mesh_stock_heel_10 = new THREE.Mesh(
    mesh_stock_heel_10Geometry,
    materialMap["polymer"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_stock_heel_10.name = "stock-heel";
  if (endpoint_stock_heel_10) {
    mesh_stock_heel_10.position.copy(endpoint_stock_heel_10.midpoint);
    mesh_stock_heel_10.quaternion.copy(endpoint_stock_heel_10.quaternion);
  }
  mesh_stock_heel_10.castShadow = options.castShadow ?? true;
  mesh_stock_heel_10.receiveShadow = options.receiveShadow ?? true;
  mesh_stock_heel_10.userData.sculptComponent = {"id": "stock-heel", "name": "stock-heel", "level": "meso", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "receiver", "attachment": null, "dimensions": {"width": 0.021, "height": 0.14, "depth": 0.048, "units": "metres", "confidence": 0.75}, "transform": {"position": [-0.31, -0.05, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "stock-heel", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "polymer"}}, "material": "polymer", "materialLayers": ["polymer"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "stock-heel-edge", "type": "bevel", "description": "Soft machined edge on stock-heel", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(34, 31, 27, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_stock_heel_10.add(mesh_stock_heel_10);
  meshes["stock-heel"] = mesh_stock_heel_10;
  colliders["stock-heel"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["stock-heel"] ??= [];
  destructionGroups["stock-heel"].push(node_stock_heel_10);

  const endpoint_stock_lower_11 = makeAttachmentEndpoint(null);
  const node_stock_lower_11 = new THREE.Group();
  node_stock_lower_11.name = "stock-lower__pivot";
  node_stock_lower_11.scale.set(1, 1, 1);
  if (endpoint_stock_lower_11) {
    node_stock_lower_11.position.copy(endpoint_stock_lower_11.start);
    node_stock_lower_11.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_stock_lower_11.position.set(-0.236, -0.053, 0.0);
    node_stock_lower_11.rotation.set(0.0, 0.0, 0.0);
  }
  node_stock_lower_11.userData.sculptComponent = {"id": "stock-lower", "name": "stock-lower", "level": "meso", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Solid telescoping-stock lower cheek support with a tapered bottom edge.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.5, 0.5], [0.5, 0.5], [0.5, 0.1], [0.15, 0.1], [0.05, -0.12], [-0.08, -0.12], [-0.5, -0.5]], "bevelEnabled": false}}, "parent": "receiver", "attachment": null, "dimensions": {"width": 0.16, "height": 0.078, "depth": 0.026, "units": "metres", "confidence": 0.75}, "transform": {"position": [-0.236, -0.053, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "stock-lower", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "polymer"}}, "material": "polymer", "materialLayers": ["polymer"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "stock-lower-edge", "type": "bevel", "description": "Soft machined edge on stock-lower", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(34, 31, 27, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_stock_lower_11.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "stock-lower", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "polymer"}};
  (nodes["receiver"] ?? root).add(node_stock_lower_11);
  nodes["stock-lower"] = node_stock_lower_11;
  const mesh_stock_lower_11Geometry = endpoint_stock_lower_11
    ? new THREE.CylinderGeometry(endpoint_stock_lower_11.endRadius, endpoint_stock_lower_11.baseRadius, endpoint_stock_lower_11.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.5, 0.5], [0.5, 0.5], [0.5, 0.1], [0.15, 0.1], [0.05, -0.12], [-0.08, -0.12], [-0.5, -0.5]], "bevelEnabled": false});
  if (!endpoint_stock_lower_11) {
    mesh_stock_lower_11Geometry.scale(0.16, 0.078, 0.026);
  }
  const mesh_stock_lower_11 = new THREE.Mesh(
    mesh_stock_lower_11Geometry,
    materialMap["polymer"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_stock_lower_11.name = "stock-lower";
  if (endpoint_stock_lower_11) {
    mesh_stock_lower_11.position.copy(endpoint_stock_lower_11.midpoint);
    mesh_stock_lower_11.quaternion.copy(endpoint_stock_lower_11.quaternion);
  }
  mesh_stock_lower_11.castShadow = options.castShadow ?? true;
  mesh_stock_lower_11.receiveShadow = options.receiveShadow ?? true;
  mesh_stock_lower_11.userData.sculptComponent = {"id": "stock-lower", "name": "stock-lower", "level": "meso", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Solid telescoping-stock lower cheek support with a tapered bottom edge.", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.5, 0.5], [0.5, 0.5], [0.5, 0.1], [0.15, 0.1], [0.05, -0.12], [-0.08, -0.12], [-0.5, -0.5]], "bevelEnabled": false}}, "parent": "receiver", "attachment": null, "dimensions": {"width": 0.16, "height": 0.078, "depth": 0.026, "units": "metres", "confidence": 0.75}, "transform": {"position": [-0.236, -0.053, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "stock-lower", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "polymer"}}, "material": "polymer", "materialLayers": ["polymer"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "stock-lower-edge", "type": "bevel", "description": "Soft machined edge on stock-lower", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(34, 31, 27, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "plastic", "materialClassConfidence": 0.8}};
  node_stock_lower_11.add(mesh_stock_lower_11);
  meshes["stock-lower"] = mesh_stock_lower_11;
  colliders["stock-lower"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["stock-lower"] ??= [];
  destructionGroups["stock-lower"].push(node_stock_lower_11);

  const endpoint_guard_bottom_12 = makeAttachmentEndpoint(null);
  const node_guard_bottom_12 = new THREE.Group();
  node_guard_bottom_12.name = "guard-bottom__pivot";
  node_guard_bottom_12.scale.set(1, 1, 1);
  if (endpoint_guard_bottom_12) {
    node_guard_bottom_12.position.copy(endpoint_guard_bottom_12.start);
    node_guard_bottom_12.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_guard_bottom_12.position.set(-0.03, -0.087, 0.0);
    node_guard_bottom_12.rotation.set(0.0, 0.0, 0.0);
  }
  node_guard_bottom_12.userData.sculptComponent = {"id": "guard-bottom", "name": "guard-bottom", "level": "meso", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "receiver", "attachment": null, "dimensions": {"width": 0.065, "height": 0.009, "depth": 0.017, "units": "metres", "confidence": 0.75}, "transform": {"position": [-0.03, -0.087, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "guard-bottom", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}}, "material": "receiver", "materialLayers": ["receiver"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "guard-bottom-edge", "type": "bevel", "description": "Soft machined edge on guard-bottom", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(57, 57, 59, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_guard_bottom_12.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "guard-bottom", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}};
  (nodes["receiver"] ?? root).add(node_guard_bottom_12);
  nodes["guard-bottom"] = node_guard_bottom_12;
  const mesh_guard_bottom_12Geometry = endpoint_guard_bottom_12
    ? new THREE.CylinderGeometry(endpoint_guard_bottom_12.endRadius, endpoint_guard_bottom_12.baseRadius, endpoint_guard_bottom_12.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_guard_bottom_12) {
    mesh_guard_bottom_12Geometry.scale(0.065, 0.009, 0.017);
  }
  const mesh_guard_bottom_12 = new THREE.Mesh(
    mesh_guard_bottom_12Geometry,
    materialMap["receiver"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_guard_bottom_12.name = "guard-bottom";
  if (endpoint_guard_bottom_12) {
    mesh_guard_bottom_12.position.copy(endpoint_guard_bottom_12.midpoint);
    mesh_guard_bottom_12.quaternion.copy(endpoint_guard_bottom_12.quaternion);
  }
  mesh_guard_bottom_12.castShadow = options.castShadow ?? true;
  mesh_guard_bottom_12.receiveShadow = options.receiveShadow ?? true;
  mesh_guard_bottom_12.userData.sculptComponent = {"id": "guard-bottom", "name": "guard-bottom", "level": "meso", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "receiver", "attachment": null, "dimensions": {"width": 0.065, "height": 0.009, "depth": 0.017, "units": "metres", "confidence": 0.75}, "transform": {"position": [-0.03, -0.087, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "guard-bottom", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}}, "material": "receiver", "materialLayers": ["receiver"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "guard-bottom-edge", "type": "bevel", "description": "Soft machined edge on guard-bottom", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(57, 57, 59, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_guard_bottom_12.add(mesh_guard_bottom_12);
  meshes["guard-bottom"] = mesh_guard_bottom_12;
  colliders["guard-bottom"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["guard-bottom"] ??= [];
  destructionGroups["guard-bottom"].push(node_guard_bottom_12);

  const endpoint_guard_front_13 = makeAttachmentEndpoint(null);
  const node_guard_front_13 = new THREE.Group();
  node_guard_front_13.name = "guard-front__pivot";
  node_guard_front_13.scale.set(1, 1, 1);
  if (endpoint_guard_front_13) {
    node_guard_front_13.position.copy(endpoint_guard_front_13.start);
    node_guard_front_13.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_guard_front_13.position.set(0.002, -0.072, 0.0);
    node_guard_front_13.rotation.set(0.0, 0.0, 0.0);
  }
  node_guard_front_13.userData.sculptComponent = {"id": "guard-front", "name": "guard-front", "level": "meso", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "receiver", "attachment": null, "dimensions": {"width": 0.009, "height": 0.03, "depth": 0.017, "units": "metres", "confidence": 0.75}, "transform": {"position": [0.002, -0.072, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "guard-front", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}}, "material": "receiver", "materialLayers": ["receiver"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "guard-front-edge", "type": "bevel", "description": "Soft machined edge on guard-front", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(57, 57, 59, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_guard_front_13.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "guard-front", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}};
  (nodes["receiver"] ?? root).add(node_guard_front_13);
  nodes["guard-front"] = node_guard_front_13;
  const mesh_guard_front_13Geometry = endpoint_guard_front_13
    ? new THREE.CylinderGeometry(endpoint_guard_front_13.endRadius, endpoint_guard_front_13.baseRadius, endpoint_guard_front_13.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_guard_front_13) {
    mesh_guard_front_13Geometry.scale(0.009, 0.03, 0.017);
  }
  const mesh_guard_front_13 = new THREE.Mesh(
    mesh_guard_front_13Geometry,
    materialMap["receiver"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_guard_front_13.name = "guard-front";
  if (endpoint_guard_front_13) {
    mesh_guard_front_13.position.copy(endpoint_guard_front_13.midpoint);
    mesh_guard_front_13.quaternion.copy(endpoint_guard_front_13.quaternion);
  }
  mesh_guard_front_13.castShadow = options.castShadow ?? true;
  mesh_guard_front_13.receiveShadow = options.receiveShadow ?? true;
  mesh_guard_front_13.userData.sculptComponent = {"id": "guard-front", "name": "guard-front", "level": "meso", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "receiver", "attachment": null, "dimensions": {"width": 0.009, "height": 0.03, "depth": 0.017, "units": "metres", "confidence": 0.75}, "transform": {"position": [0.002, -0.072, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "guard-front", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}}, "material": "receiver", "materialLayers": ["receiver"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "guard-front-edge", "type": "bevel", "description": "Soft machined edge on guard-front", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(57, 57, 59, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_guard_front_13.add(mesh_guard_front_13);
  meshes["guard-front"] = mesh_guard_front_13;
  colliders["guard-front"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["guard-front"] ??= [];
  destructionGroups["guard-front"].push(node_guard_front_13);

  const attachment_front_sight_a_14 = {"parentId": "receiver", "parentSocket": "front-sight-a-mount", "localStart": [0.315, 0.018, 0], "localEnd": [0.356, 0.079, 0], "baseRadius": 0.0035, "endRadius": 0.0035, "embedDepth": 0.02, "gapTolerance": 0.001, "contactType": "overlap", "evidenceRefs": ["full-object"]};
  const endpoint_front_sight_a_14 = makeAttachmentEndpoint(attachment_front_sight_a_14);
  const node_front_sight_a_14 = new THREE.Group();
  node_front_sight_a_14.name = "front-sight-a__pivot";
  node_front_sight_a_14.scale.set(1, 1, 1);
  if (endpoint_front_sight_a_14) {
    node_front_sight_a_14.position.copy(endpoint_front_sight_a_14.start);
    node_front_sight_a_14.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_front_sight_a_14.position.set(0.305, 0.05, 0.0);
    node_front_sight_a_14.rotation.set(0.0, 0.0, 0.0);
  }
  node_front_sight_a_14.userData.sculptComponent = {"id": "front-sight-a", "name": "front-sight-a", "level": "meso", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "receiver", "attachment": {"parentId": "receiver", "parentSocket": "front-sight-a-mount", "localStart": [0.315, 0.018, 0], "localEnd": [0.356, 0.079, 0], "baseRadius": 0.0035, "endRadius": 0.0035, "embedDepth": 0.02, "gapTolerance": 0.001, "contactType": "overlap", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.009, "height": 0.067, "depth": 0.016, "units": "metres", "confidence": 0.75}, "transform": {"position": [0.305, 0.05, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "front-sight-a", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}}, "material": "receiver", "materialLayers": ["receiver"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "front-sight-a-edge", "type": "bevel", "description": "Soft machined edge on front-sight-a", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(57, 57, 59, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_front_sight_a_14.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "front-sight-a", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}};
  (nodes["receiver"] ?? root).add(node_front_sight_a_14);
  nodes["front-sight-a"] = node_front_sight_a_14;
  const mesh_front_sight_a_14Geometry = endpoint_front_sight_a_14
    ? new THREE.CylinderGeometry(endpoint_front_sight_a_14.endRadius, endpoint_front_sight_a_14.baseRadius, endpoint_front_sight_a_14.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_front_sight_a_14) {
    mesh_front_sight_a_14Geometry.scale(0.009, 0.067, 0.016);
  }
  const mesh_front_sight_a_14 = new THREE.Mesh(
    mesh_front_sight_a_14Geometry,
    materialMap["receiver"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_front_sight_a_14.name = "front-sight-a";
  if (endpoint_front_sight_a_14) {
    mesh_front_sight_a_14.position.copy(endpoint_front_sight_a_14.midpoint);
    mesh_front_sight_a_14.quaternion.copy(endpoint_front_sight_a_14.quaternion);
  }
  mesh_front_sight_a_14.castShadow = options.castShadow ?? true;
  mesh_front_sight_a_14.receiveShadow = options.receiveShadow ?? true;
  mesh_front_sight_a_14.userData.sculptComponent = {"id": "front-sight-a", "name": "front-sight-a", "level": "meso", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "receiver", "attachment": {"parentId": "receiver", "parentSocket": "front-sight-a-mount", "localStart": [0.315, 0.018, 0], "localEnd": [0.356, 0.079, 0], "baseRadius": 0.0035, "endRadius": 0.0035, "embedDepth": 0.02, "gapTolerance": 0.001, "contactType": "overlap", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.009, "height": 0.067, "depth": 0.016, "units": "metres", "confidence": 0.75}, "transform": {"position": [0.305, 0.05, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "front-sight-a", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}}, "material": "receiver", "materialLayers": ["receiver"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "front-sight-a-edge", "type": "bevel", "description": "Soft machined edge on front-sight-a", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(57, 57, 59, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_front_sight_a_14.add(mesh_front_sight_a_14);
  meshes["front-sight-a"] = mesh_front_sight_a_14;
  colliders["front-sight-a"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["front-sight-a"] ??= [];
  destructionGroups["front-sight-a"].push(node_front_sight_a_14);

  const attachment_front_sight_b_15 = {"parentId": "receiver", "parentSocket": "front-sight-b-mount", "localStart": [0.365, 0.018, 0], "localEnd": [0.356, 0.079, 0], "baseRadius": 0.0035, "endRadius": 0.0035, "embedDepth": 0.02, "gapTolerance": 0.001, "contactType": "overlap", "evidenceRefs": ["full-object"]};
  const endpoint_front_sight_b_15 = makeAttachmentEndpoint(attachment_front_sight_b_15);
  const node_front_sight_b_15 = new THREE.Group();
  node_front_sight_b_15.name = "front-sight-b__pivot";
  node_front_sight_b_15.scale.set(1, 1, 1);
  if (endpoint_front_sight_b_15) {
    node_front_sight_b_15.position.copy(endpoint_front_sight_b_15.start);
    node_front_sight_b_15.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_front_sight_b_15.position.set(0.326, 0.05, 0.0);
    node_front_sight_b_15.rotation.set(0.0, 0.0, 0.0);
  }
  node_front_sight_b_15.userData.sculptComponent = {"id": "front-sight-b", "name": "front-sight-b", "level": "meso", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "receiver", "attachment": {"parentId": "receiver", "parentSocket": "front-sight-b-mount", "localStart": [0.365, 0.018, 0], "localEnd": [0.356, 0.079, 0], "baseRadius": 0.0035, "endRadius": 0.0035, "embedDepth": 0.02, "gapTolerance": 0.001, "contactType": "overlap", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.009, "height": 0.067, "depth": 0.016, "units": "metres", "confidence": 0.75}, "transform": {"position": [0.326, 0.05, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "front-sight-b", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}}, "material": "receiver", "materialLayers": ["receiver"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "front-sight-b-edge", "type": "bevel", "description": "Soft machined edge on front-sight-b", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(57, 57, 59, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_front_sight_b_15.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "front-sight-b", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}};
  (nodes["receiver"] ?? root).add(node_front_sight_b_15);
  nodes["front-sight-b"] = node_front_sight_b_15;
  const mesh_front_sight_b_15Geometry = endpoint_front_sight_b_15
    ? new THREE.CylinderGeometry(endpoint_front_sight_b_15.endRadius, endpoint_front_sight_b_15.baseRadius, endpoint_front_sight_b_15.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_front_sight_b_15) {
    mesh_front_sight_b_15Geometry.scale(0.009, 0.067, 0.016);
  }
  const mesh_front_sight_b_15 = new THREE.Mesh(
    mesh_front_sight_b_15Geometry,
    materialMap["receiver"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_front_sight_b_15.name = "front-sight-b";
  if (endpoint_front_sight_b_15) {
    mesh_front_sight_b_15.position.copy(endpoint_front_sight_b_15.midpoint);
    mesh_front_sight_b_15.quaternion.copy(endpoint_front_sight_b_15.quaternion);
  }
  mesh_front_sight_b_15.castShadow = options.castShadow ?? true;
  mesh_front_sight_b_15.receiveShadow = options.receiveShadow ?? true;
  mesh_front_sight_b_15.userData.sculptComponent = {"id": "front-sight-b", "name": "front-sight-b", "level": "meso", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "receiver", "attachment": {"parentId": "receiver", "parentSocket": "front-sight-b-mount", "localStart": [0.365, 0.018, 0], "localEnd": [0.356, 0.079, 0], "baseRadius": 0.0035, "endRadius": 0.0035, "embedDepth": 0.02, "gapTolerance": 0.001, "contactType": "overlap", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.009, "height": 0.067, "depth": 0.016, "units": "metres", "confidence": 0.75}, "transform": {"position": [0.326, 0.05, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "front-sight-b", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}}, "material": "receiver", "materialLayers": ["receiver"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "front-sight-b-edge", "type": "bevel", "description": "Soft machined edge on front-sight-b", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(57, 57, 59, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_front_sight_b_15.add(mesh_front_sight_b_15);
  meshes["front-sight-b"] = mesh_front_sight_b_15;
  colliders["front-sight-b"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["front-sight-b"] ??= [];
  destructionGroups["front-sight-b"].push(node_front_sight_b_15);

  const endpoint_rear_sight_16 = makeAttachmentEndpoint(null);
  const node_rear_sight_16 = new THREE.Group();
  node_rear_sight_16.name = "rear-sight__pivot";
  node_rear_sight_16.scale.set(1, 1, 1);
  if (endpoint_rear_sight_16) {
    node_rear_sight_16.position.copy(endpoint_rear_sight_16.start);
    node_rear_sight_16.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_rear_sight_16.position.set(-0.066, 0.044, 0.0);
    node_rear_sight_16.rotation.set(0.0, 0.0, 0.0);
  }
  node_rear_sight_16.userData.sculptComponent = {"id": "rear-sight", "name": "rear-sight", "level": "meso", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "receiver", "attachment": null, "dimensions": {"width": 0.032, "height": 0.018, "depth": 0.026, "units": "metres", "confidence": 0.75}, "transform": {"position": [-0.066, 0.044, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rear-sight", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}}, "material": "receiver", "materialLayers": ["receiver"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rear-sight-edge", "type": "bevel", "description": "Soft machined edge on rear-sight", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(57, 57, 59, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_rear_sight_16.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rear-sight", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}};
  (nodes["receiver"] ?? root).add(node_rear_sight_16);
  nodes["rear-sight"] = node_rear_sight_16;
  const mesh_rear_sight_16Geometry = endpoint_rear_sight_16
    ? new THREE.CylinderGeometry(endpoint_rear_sight_16.endRadius, endpoint_rear_sight_16.baseRadius, endpoint_rear_sight_16.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_rear_sight_16) {
    mesh_rear_sight_16Geometry.scale(0.032, 0.018, 0.026);
  }
  const mesh_rear_sight_16 = new THREE.Mesh(
    mesh_rear_sight_16Geometry,
    materialMap["receiver"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rear_sight_16.name = "rear-sight";
  if (endpoint_rear_sight_16) {
    mesh_rear_sight_16.position.copy(endpoint_rear_sight_16.midpoint);
    mesh_rear_sight_16.quaternion.copy(endpoint_rear_sight_16.quaternion);
  }
  mesh_rear_sight_16.castShadow = options.castShadow ?? true;
  mesh_rear_sight_16.receiveShadow = options.receiveShadow ?? true;
  mesh_rear_sight_16.userData.sculptComponent = {"id": "rear-sight", "name": "rear-sight", "level": "meso", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "receiver", "attachment": null, "dimensions": {"width": 0.032, "height": 0.018, "depth": 0.026, "units": "metres", "confidence": 0.75}, "transform": {"position": [-0.066, 0.044, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rear-sight", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}}, "material": "receiver", "materialLayers": ["receiver"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rear-sight-edge", "type": "bevel", "description": "Soft machined edge on rear-sight", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(57, 57, 59, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_rear_sight_16.add(mesh_rear_sight_16);
  meshes["rear-sight"] = mesh_rear_sight_16;
  colliders["rear-sight"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["rear-sight"] ??= [];
  destructionGroups["rear-sight"].push(node_rear_sight_16);

  const endpoint_rail_17 = makeAttachmentEndpoint(null);
  const node_rail_17 = new THREE.Group();
  node_rail_17.name = "rail__pivot";
  node_rail_17.scale.set(1, 1, 1);
  if (endpoint_rail_17) {
    node_rail_17.position.copy(endpoint_rail_17.start);
    node_rail_17.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_rail_17.position.set(0.1, 0.031, 0.0);
    node_rail_17.rotation.set(0.0, 0.0, 0.0);
  }
  node_rail_17.userData.sculptComponent = {"id": "rail", "name": "rail", "level": "micro", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "receiver", "attachment": null, "dimensions": {"width": 0.42, "height": 0.012, "depth": 0.026, "units": "metres", "confidence": 0.75}, "transform": {"position": [0.1, 0.031, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rail", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}}, "material": "receiver", "materialLayers": ["receiver"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rail-edge", "type": "bevel", "description": "Soft machined edge on rail", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(57, 57, 59, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_rail_17.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rail", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}};
  (nodes["receiver"] ?? root).add(node_rail_17);
  nodes["rail"] = node_rail_17;
  const mesh_rail_17Geometry = endpoint_rail_17
    ? new THREE.CylinderGeometry(endpoint_rail_17.endRadius, endpoint_rail_17.baseRadius, endpoint_rail_17.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_rail_17) {
    mesh_rail_17Geometry.scale(0.42, 0.012, 0.026);
  }
  const mesh_rail_17 = new THREE.Mesh(
    mesh_rail_17Geometry,
    materialMap["receiver"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rail_17.name = "rail";
  if (endpoint_rail_17) {
    mesh_rail_17.position.copy(endpoint_rail_17.midpoint);
    mesh_rail_17.quaternion.copy(endpoint_rail_17.quaternion);
  }
  mesh_rail_17.castShadow = options.castShadow ?? true;
  mesh_rail_17.receiveShadow = options.receiveShadow ?? true;
  mesh_rail_17.userData.sculptComponent = {"id": "rail", "name": "rail", "level": "micro", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "receiver", "attachment": null, "dimensions": {"width": 0.42, "height": 0.012, "depth": 0.026, "units": "metres", "confidence": 0.75}, "transform": {"position": [0.1, 0.031, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rail", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}}, "material": "receiver", "materialLayers": ["receiver"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rail-edge", "type": "bevel", "description": "Soft machined edge on rail", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(57, 57, 59, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_rail_17.add(mesh_rail_17);
  meshes["rail"] = mesh_rail_17;
  colliders["rail"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["rail"] ??= [];
  destructionGroups["rail"].push(node_rail_17);

  const endpoint_selector_18 = makeAttachmentEndpoint(null);
  const node_selector_18 = new THREE.Group();
  node_selector_18.name = "selector__pivot";
  node_selector_18.scale.set(1, 1, 1);
  if (endpoint_selector_18) {
    node_selector_18.position.copy(endpoint_selector_18.start);
    node_selector_18.rotation.set(0.0, 0.0, 0.2);
  } else {
    node_selector_18.position.set(-0.065, -0.047, 0.028);
    node_selector_18.rotation.set(0.0, 0.0, 0.2);
  }
  node_selector_18.userData.sculptComponent = {"id": "selector", "name": "selector", "level": "micro", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "receiver", "attachment": null, "dimensions": {"width": 0.024, "height": 0.005, "depth": 0.006, "units": "metres", "confidence": 0.75}, "transform": {"position": [-0.065, -0.047, 0.028], "rotation": [0, 0, 0.2]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "selector", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}}, "material": "receiver", "materialLayers": ["receiver"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "selector-edge", "type": "bevel", "description": "Soft machined edge on selector", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(57, 57, 59, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_selector_18.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "selector", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}};
  (nodes["receiver"] ?? root).add(node_selector_18);
  nodes["selector"] = node_selector_18;
  const mesh_selector_18Geometry = endpoint_selector_18
    ? new THREE.CylinderGeometry(endpoint_selector_18.endRadius, endpoint_selector_18.baseRadius, endpoint_selector_18.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_selector_18) {
    mesh_selector_18Geometry.scale(0.024, 0.005, 0.006);
  }
  const mesh_selector_18 = new THREE.Mesh(
    mesh_selector_18Geometry,
    materialMap["receiver"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_selector_18.name = "selector";
  if (endpoint_selector_18) {
    mesh_selector_18.position.copy(endpoint_selector_18.midpoint);
    mesh_selector_18.quaternion.copy(endpoint_selector_18.quaternion);
  }
  mesh_selector_18.castShadow = options.castShadow ?? true;
  mesh_selector_18.receiveShadow = options.receiveShadow ?? true;
  mesh_selector_18.userData.sculptComponent = {"id": "selector", "name": "selector", "level": "micro", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "receiver", "attachment": null, "dimensions": {"width": 0.024, "height": 0.005, "depth": 0.006, "units": "metres", "confidence": 0.75}, "transform": {"position": [-0.065, -0.047, 0.028], "rotation": [0, 0, 0.2]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "selector", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}}, "material": "receiver", "materialLayers": ["receiver"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "selector-edge", "type": "bevel", "description": "Soft machined edge on selector", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(57, 57, 59, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_selector_18.add(mesh_selector_18);
  meshes["selector"] = mesh_selector_18;
  colliders["selector"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["selector"] ??= [];
  destructionGroups["selector"].push(node_selector_18);

  const endpoint_bolt_catch_19 = makeAttachmentEndpoint(null);
  const node_bolt_catch_19 = new THREE.Group();
  node_bolt_catch_19.name = "bolt-catch__pivot";
  node_bolt_catch_19.scale.set(1, 1, 1);
  if (endpoint_bolt_catch_19) {
    node_bolt_catch_19.position.copy(endpoint_bolt_catch_19.start);
    node_bolt_catch_19.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_bolt_catch_19.position.set(0.002, -0.023, 0.031);
    node_bolt_catch_19.rotation.set(0.0, 0.0, 0.0);
  }
  node_bolt_catch_19.userData.sculptComponent = {"id": "bolt-catch", "name": "bolt-catch", "level": "micro", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "receiver", "attachment": null, "dimensions": {"width": 0.008, "height": 0.024, "depth": 0.007, "units": "metres", "confidence": 0.75}, "transform": {"position": [0.002, -0.023, 0.031], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bolt-catch", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}}, "material": "receiver", "materialLayers": ["receiver"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bolt-catch-edge", "type": "bevel", "description": "Soft machined edge on bolt-catch", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(57, 57, 59, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_bolt_catch_19.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bolt-catch", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}};
  (nodes["receiver"] ?? root).add(node_bolt_catch_19);
  nodes["bolt-catch"] = node_bolt_catch_19;
  const mesh_bolt_catch_19Geometry = endpoint_bolt_catch_19
    ? new THREE.CylinderGeometry(endpoint_bolt_catch_19.endRadius, endpoint_bolt_catch_19.baseRadius, endpoint_bolt_catch_19.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_bolt_catch_19) {
    mesh_bolt_catch_19Geometry.scale(0.008, 0.024, 0.007);
  }
  const mesh_bolt_catch_19 = new THREE.Mesh(
    mesh_bolt_catch_19Geometry,
    materialMap["receiver"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bolt_catch_19.name = "bolt-catch";
  if (endpoint_bolt_catch_19) {
    mesh_bolt_catch_19.position.copy(endpoint_bolt_catch_19.midpoint);
    mesh_bolt_catch_19.quaternion.copy(endpoint_bolt_catch_19.quaternion);
  }
  mesh_bolt_catch_19.castShadow = options.castShadow ?? true;
  mesh_bolt_catch_19.receiveShadow = options.receiveShadow ?? true;
  mesh_bolt_catch_19.userData.sculptComponent = {"id": "bolt-catch", "name": "bolt-catch", "level": "micro", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "receiver", "attachment": null, "dimensions": {"width": 0.008, "height": 0.024, "depth": 0.007, "units": "metres", "confidence": 0.75}, "transform": {"position": [0.002, -0.023, 0.031], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "bolt-catch", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}}, "material": "receiver", "materialLayers": ["receiver"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bolt-catch-edge", "type": "bevel", "description": "Soft machined edge on bolt-catch", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(57, 57, 59, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_bolt_catch_19.add(mesh_bolt_catch_19);
  meshes["bolt-catch"] = mesh_bolt_catch_19;
  colliders["bolt-catch"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["bolt-catch"] ??= [];
  destructionGroups["bolt-catch"].push(node_bolt_catch_19);

  const endpoint_magazine_floor_20 = makeAttachmentEndpoint(null);
  const node_magazine_floor_20 = new THREE.Group();
  node_magazine_floor_20.name = "magazine-floor__pivot";
  node_magazine_floor_20.scale.set(1, 1, 1);
  if (endpoint_magazine_floor_20) {
    node_magazine_floor_20.position.copy(endpoint_magazine_floor_20.start);
    node_magazine_floor_20.rotation.set(0.0, 0.0, 0.16);
  } else {
    node_magazine_floor_20.position.set(0.053, -0.207, 0.0);
    node_magazine_floor_20.rotation.set(0.0, 0.0, 0.16);
  }
  node_magazine_floor_20.userData.sculptComponent = {"id": "magazine-floor", "name": "magazine-floor", "level": "micro", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "receiver", "attachment": null, "dimensions": {"width": 0.073, "height": 0.009, "depth": 0.032, "units": "metres", "confidence": 0.75}, "transform": {"position": [0.053, -0.207, 0], "rotation": [0, 0, 0.16]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "magazine-floor", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "magazine"}}, "material": "magazine", "materialLayers": ["magazine"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "magazine-floor-edge", "type": "bevel", "description": "Soft machined edge on magazine-floor", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(122, 125, 130, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_magazine_floor_20.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "magazine-floor", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "magazine"}};
  (nodes["receiver"] ?? root).add(node_magazine_floor_20);
  nodes["magazine-floor"] = node_magazine_floor_20;
  const mesh_magazine_floor_20Geometry = endpoint_magazine_floor_20
    ? new THREE.CylinderGeometry(endpoint_magazine_floor_20.endRadius, endpoint_magazine_floor_20.baseRadius, endpoint_magazine_floor_20.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_magazine_floor_20) {
    mesh_magazine_floor_20Geometry.scale(0.073, 0.009, 0.032);
  }
  const mesh_magazine_floor_20 = new THREE.Mesh(
    mesh_magazine_floor_20Geometry,
    materialMap["magazine"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_magazine_floor_20.name = "magazine-floor";
  if (endpoint_magazine_floor_20) {
    mesh_magazine_floor_20.position.copy(endpoint_magazine_floor_20.midpoint);
    mesh_magazine_floor_20.quaternion.copy(endpoint_magazine_floor_20.quaternion);
  }
  mesh_magazine_floor_20.castShadow = options.castShadow ?? true;
  mesh_magazine_floor_20.receiveShadow = options.receiveShadow ?? true;
  mesh_magazine_floor_20.userData.sculptComponent = {"id": "magazine-floor", "name": "magazine-floor", "level": "micro", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "receiver", "attachment": null, "dimensions": {"width": 0.073, "height": 0.009, "depth": 0.032, "units": "metres", "confidence": 0.75}, "transform": {"position": [0.053, -0.207, 0], "rotation": [0, 0, 0.16]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "magazine-floor", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "magazine"}}, "material": "magazine", "materialLayers": ["magazine"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "magazine-floor-edge", "type": "bevel", "description": "Soft machined edge on magazine-floor", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(122, 125, 130, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_magazine_floor_20.add(mesh_magazine_floor_20);
  meshes["magazine-floor"] = mesh_magazine_floor_20;
  colliders["magazine-floor"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["magazine-floor"] ??= [];
  destructionGroups["magazine-floor"].push(node_magazine_floor_20);

  const endpoint_charging_handle_21 = makeAttachmentEndpoint(null);
  const node_charging_handle_21 = new THREE.Group();
  node_charging_handle_21.name = "charging-handle__pivot";
  node_charging_handle_21.scale.set(1, 1, 1);
  if (endpoint_charging_handle_21) {
    node_charging_handle_21.position.copy(endpoint_charging_handle_21.start);
    node_charging_handle_21.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_charging_handle_21.position.set(-0.115, 0.022, 0.0);
    node_charging_handle_21.rotation.set(0.0, 0.0, 0.0);
  }
  node_charging_handle_21.userData.sculptComponent = {"id": "charging-handle", "name": "charging-handle", "level": "micro", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "receiver", "attachment": {"parentId": "receiver", "parentSocket": "charging-handle-mount", "localStart": [-0.105, 0.022, 0], "localEnd": [-0.126, 0.022, 0], "baseRadius": 0.004, "endRadius": 0.004, "embedDepth": 0.02, "gapTolerance": 0.001, "contactType": "overlap", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.025, "height": 0.008, "depth": 0.075, "units": "metres", "confidence": 0.75}, "transform": {"position": [-0.115, 0.022, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "charging-handle", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}}, "material": "receiver", "materialLayers": ["receiver"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "charging-handle-edge", "type": "bevel", "description": "Soft machined edge on charging-handle", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(57, 57, 59, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_charging_handle_21.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "charging-handle", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}};
  (nodes["receiver"] ?? root).add(node_charging_handle_21);
  nodes["charging-handle"] = node_charging_handle_21;
  const mesh_charging_handle_21Geometry = endpoint_charging_handle_21
    ? new THREE.CylinderGeometry(endpoint_charging_handle_21.endRadius, endpoint_charging_handle_21.baseRadius, endpoint_charging_handle_21.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_charging_handle_21) {
    mesh_charging_handle_21Geometry.scale(0.025, 0.008, 0.075);
  }
  const mesh_charging_handle_21 = new THREE.Mesh(
    mesh_charging_handle_21Geometry,
    materialMap["receiver"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_charging_handle_21.name = "charging-handle";
  if (endpoint_charging_handle_21) {
    mesh_charging_handle_21.position.copy(endpoint_charging_handle_21.midpoint);
    mesh_charging_handle_21.quaternion.copy(endpoint_charging_handle_21.quaternion);
  }
  mesh_charging_handle_21.castShadow = options.castShadow ?? true;
  mesh_charging_handle_21.receiveShadow = options.receiveShadow ?? true;
  mesh_charging_handle_21.userData.sculptComponent = {"id": "charging-handle", "name": "charging-handle", "level": "micro", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "receiver", "attachment": {"parentId": "receiver", "parentSocket": "charging-handle-mount", "localStart": [-0.105, 0.022, 0], "localEnd": [-0.126, 0.022, 0], "baseRadius": 0.004, "endRadius": 0.004, "embedDepth": 0.02, "gapTolerance": 0.001, "contactType": "overlap", "evidenceRefs": ["full-object"]}, "dimensions": {"width": 0.025, "height": 0.008, "depth": 0.075, "units": "metres", "confidence": 0.75}, "transform": {"position": [-0.115, 0.022, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "charging-handle", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}}, "material": "receiver", "materialLayers": ["receiver"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "charging-handle-edge", "type": "bevel", "description": "Soft machined edge on charging-handle", "confidence": 0.8, "evidenceRefs": ["full-object"], "geometryEffect": "chamfer .002", "materialEffect": "highlight"}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(57, 57, 59, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_charging_handle_21.add(mesh_charging_handle_21);
  meshes["charging-handle"] = mesh_charging_handle_21;
  colliders["charging-handle"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["charging-handle"] ??= [];
  destructionGroups["charging-handle"].push(node_charging_handle_21);

  const endpoint_rear_tang_22 = makeAttachmentEndpoint(null);
  const node_rear_tang_22 = new THREE.Group();
  node_rear_tang_22.name = "rear-tang__pivot";
  node_rear_tang_22.scale.set(1, 1, 1);
  if (endpoint_rear_tang_22) {
    node_rear_tang_22.position.copy(endpoint_rear_tang_22.start);
    node_rear_tang_22.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_rear_tang_22.position.set(-0.08, -0.044, 0.0);
    node_rear_tang_22.rotation.set(0.0, 0.0, 0.0);
  }
  node_rear_tang_22.userData.sculptComponent = {"id": "rear-tang", "name": "rear-tang", "level": "meso", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "receiver", "attachment": null, "dimensions": {"width": 0.065, "height": 0.038, "depth": 0.042, "units": "metres", "confidence": 0.8}, "transform": {"position": [-0.08, -0.044, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rear-tang", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}}, "material": "receiver", "materialLayers": ["receiver"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(57, 57, 59, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_rear_tang_22.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rear-tang", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}};
  (nodes["receiver"] ?? root).add(node_rear_tang_22);
  nodes["rear-tang"] = node_rear_tang_22;
  const mesh_rear_tang_22Geometry = endpoint_rear_tang_22
    ? new THREE.CylinderGeometry(endpoint_rear_tang_22.endRadius, endpoint_rear_tang_22.baseRadius, endpoint_rear_tang_22.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_rear_tang_22) {
    mesh_rear_tang_22Geometry.scale(0.065, 0.038, 0.042);
  }
  const mesh_rear_tang_22 = new THREE.Mesh(
    mesh_rear_tang_22Geometry,
    materialMap["receiver"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rear_tang_22.name = "rear-tang";
  if (endpoint_rear_tang_22) {
    mesh_rear_tang_22.position.copy(endpoint_rear_tang_22.midpoint);
    mesh_rear_tang_22.quaternion.copy(endpoint_rear_tang_22.quaternion);
  }
  mesh_rear_tang_22.castShadow = options.castShadow ?? true;
  mesh_rear_tang_22.receiveShadow = options.receiveShadow ?? true;
  mesh_rear_tang_22.userData.sculptComponent = {"id": "rear-tang", "name": "rear-tang", "level": "meso", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "receiver", "attachment": null, "dimensions": {"width": 0.065, "height": 0.038, "depth": 0.042, "units": "metres", "confidence": 0.8}, "transform": {"position": [-0.08, -0.044, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rear-tang", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}}, "material": "receiver", "materialLayers": ["receiver"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(57, 57, 59, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_rear_tang_22.add(mesh_rear_tang_22);
  meshes["rear-tang"] = mesh_rear_tang_22;
  colliders["rear-tang"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["rear-tang"] ??= [];
  destructionGroups["rear-tang"].push(node_rear_tang_22);

  const endpoint_barrel_collar_23 = makeAttachmentEndpoint(null);
  const node_barrel_collar_23 = new THREE.Group();
  node_barrel_collar_23.name = "barrel-collar__pivot";
  node_barrel_collar_23.scale.set(1, 1, 1);
  if (endpoint_barrel_collar_23) {
    node_barrel_collar_23.position.copy(endpoint_barrel_collar_23.start);
    node_barrel_collar_23.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_barrel_collar_23.position.set(0.115, 0.0, 0.0);
    node_barrel_collar_23.rotation.set(0.0, 0.0, 0.0);
  }
  node_barrel_collar_23.userData.sculptComponent = {"id": "barrel-collar", "name": "barrel-collar", "level": "meso", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "receiver", "attachment": null, "dimensions": {"width": 0.028, "height": 0.069, "depth": 0.068, "units": "metres", "confidence": 0.8}, "transform": {"position": [0.115, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "barrel-collar", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}}, "material": "receiver", "materialLayers": ["receiver"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(57, 57, 59, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_barrel_collar_23.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "barrel-collar", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}};
  (nodes["receiver"] ?? root).add(node_barrel_collar_23);
  nodes["barrel-collar"] = node_barrel_collar_23;
  const mesh_barrel_collar_23Geometry = endpoint_barrel_collar_23
    ? new THREE.CylinderGeometry(endpoint_barrel_collar_23.endRadius, endpoint_barrel_collar_23.baseRadius, endpoint_barrel_collar_23.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_barrel_collar_23) {
    mesh_barrel_collar_23Geometry.scale(0.028, 0.069, 0.068);
  }
  const mesh_barrel_collar_23 = new THREE.Mesh(
    mesh_barrel_collar_23Geometry,
    materialMap["receiver"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_barrel_collar_23.name = "barrel-collar";
  if (endpoint_barrel_collar_23) {
    mesh_barrel_collar_23.position.copy(endpoint_barrel_collar_23.midpoint);
    mesh_barrel_collar_23.quaternion.copy(endpoint_barrel_collar_23.quaternion);
  }
  mesh_barrel_collar_23.castShadow = options.castShadow ?? true;
  mesh_barrel_collar_23.receiveShadow = options.receiveShadow ?? true;
  mesh_barrel_collar_23.userData.sculptComponent = {"id": "barrel-collar", "name": "barrel-collar", "level": "meso", "role": "assembly-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Mechanical connected assembly with finite width", "geometryDescriptor": {"topologyIntent": "low-poly blockout with bevel-ready edges", "edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "receiver", "attachment": null, "dimensions": {"width": 0.028, "height": 0.069, "depth": 0.068, "units": "metres", "confidence": 0.8}, "transform": {"position": [0.115, 0, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "barrel-collar", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "receiver"}}, "material": "receiver", "materialLayers": ["receiver"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(57, 57, 59, 1)", "secondaryAlbedo": "rgba(40, 40, 42, 1)", "materialClass": "metal", "materialClassConfidence": 0.8}};
  node_barrel_collar_23.add(mesh_barrel_collar_23);
  meshes["barrel-collar"] = mesh_barrel_collar_23;
  colliders["barrel-collar"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["barrel-collar"] ??= [];
  destructionGroups["barrel-collar"].push(node_barrel_collar_23);

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createM4A1LookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "M4A1 look-dev lights";
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
  lights.userData.lightingFromPhoto = [{"type": "directional", "role": "key", "position": [-2, 4, 5], "color": "#ffffff", "intensity": 3}, {"type": "hemisphere", "role": "fill", "color": "#ccddee", "intensity": 1}, {"type": "directional", "role": "rim", "position": [3, 2, -3], "color": "#ffffff", "intensity": 2}, {"type": "render", "exposure": 1, "toneMapping": "ACES filmic", "contactShadow": "soft ground shadow in neutral review"}];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createM4A1Environment(renderer: THREE.WebGLRenderer): THREE.Texture {
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
export function frameM4A1Camera(
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
export function createM4A1PresentationComposer(
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

export function configureM4A1Renderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createM4A1InspectControls(
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
