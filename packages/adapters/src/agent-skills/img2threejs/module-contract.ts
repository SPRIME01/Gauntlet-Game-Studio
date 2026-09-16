/**
 * Procedural asset module contract for img2threejs reference reconstructions.
 *
 * An accepted output is a committed TypeScript module that:
 *  - imports Three.js ONLY through the single pinned `three` specifier;
 *  - exports ASSET_MODULE_META (schema gauntlet.asset.procedural_module) with
 *    structural affordances (named nodes/sockets/colliders) and the recorded
 *    reference-comparison evidence from the interactive agent run;
 *  - exports the factory named by ASSET_MODULE_META.factory returning a
 *    THREE.Object3D built from pure Three.js geometry (no renderer, no DOM).
 *
 * Affordances are recorded metadata for the AssetRecord — they are never
 * auto-promoted into gameplay semantics (no Koota/@gauntlet/runtime imports).
 * All checks here are deterministic and offline: no model invocation, no network.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { DecodedImage } from "./png";

export const PROCEDURAL_MODULE_SCHEMA = "gauntlet.asset.procedural_module";
export const MODULE_META_EXPORT = "ASSET_MODULE_META";
export const PINNED_THREE_SPECIFIER = "three";

// ---------------------------------------------------------------------------
// Module metadata contract
// ---------------------------------------------------------------------------

export interface ProceduralModuleAffordances {
  named_nodes: string[];
  sockets: Record<string, { node: string; kind: string; note?: string }>;
  colliders: Array<{ node: string; shape: string }>;
}

export interface ProceduralModuleMeta {
  schema: string;
  id: string;
  version?: number;
  three_import: string;
  factory: string;
  reference_evidence?: {
    method: string;
    reference?: string;
    reference_sha256?: string;
    similarity?: number;
  };
  affordances?: ProceduralModuleAffordances;
}

// ---------------------------------------------------------------------------
// Syntax + import scanning (static, deterministic)
// ---------------------------------------------------------------------------

export interface ModuleImportScan {
  ok: boolean;
  bare: string[];
  relative: string[];
  violations: string[];
}

const NETWORK_API_PATTERNS: Array<{ pattern: string; reason: string }> = [
  { pattern: "fetch(", reason: "network API fetch()" },
  { pattern: "XMLHttpRequest", reason: "network API XMLHttpRequest" },
  { pattern: "WebSocket", reason: "network API WebSocket" },
  { pattern: "EventSource", reason: "network API EventSource" },
  { pattern: "sendBeacon", reason: "network API sendBeacon" },
  { pattern: "import('http", reason: "node http import" },
  { pattern: 'import("http', reason: "node http import" },
  { pattern: "require('http", reason: "node http require" },
  { pattern: 'require("http', reason: "node http require" },
];

const FORBIDDEN_BARE_PREFIXES = [
  "@gauntlet/", // studio/runtime/adapters authority — asset modules stay presentation-only
  "koota", // semantic state authority must never be imported by an asset module
  "node:http",
  "node:https",
  "node:net",
  "node:dgram",
  "undici",
];

/** Static syntax check via Bun's transpiler (no code execution). */
export function checkModuleSyntax(code: string): { ok: boolean; error?: string } {
  try {
    const transpiler = new Bun.Transpiler({ loader: "ts" });
    transpiler.transformSync(code);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Scan module imports: bare specifiers must be the pinned three specifier
 * (or a type-only import); relative imports are allowed; network APIs and
 * gameplay/state imports are violations.
 */
export function scanModuleImports(code: string): ModuleImportScan {
  const scan = new Bun.Transpiler({ loader: "ts" }).scan(code);
  const bare: string[] = [];
  const relative: string[] = [];
  const violations: string[] = [];

  // Type-only imports compile away; detect them textually (Bun's scan does not
  // expose type-only kind on all versions).
  const typeOnlySpecifiers = new Set<string>();
  const typeImportPatterns = [
    /import\s+type[\s\S]*?from\s*["']([^"']+)["']/g,
    /export\s+type[\s\S]*?from\s*["']([^"']+)["']/g,
  ];
  for (const pattern of typeImportPatterns) {
    for (const match of code.matchAll(pattern)) {
      typeOnlySpecifiers.add(match[1]);
    }
  }

  for (const imp of scan.imports) {
    if (imp.path.startsWith("./") || imp.path.startsWith("../")) {
      relative.push(imp.path);
      continue;
    }
    bare.push(imp.path);
    if (imp.path === PINNED_THREE_SPECIFIER || imp.path.startsWith(`${PINNED_THREE_SPECIFIER}/`)) {
      continue; // the single pinned Three.js specifier
    }
    if (typeOnlySpecifiers.has(imp.path)) continue; // type imports compile away
    const forbiddenPrefix = FORBIDDEN_BARE_PREFIXES.find((p) => imp.path.startsWith(p));
    if (forbiddenPrefix) {
      violations.push(`forbidden import '${imp.path}' (gameplay/state/network authority leaks into asset module)`);
    } else {
      violations.push(`non-pinned bare import '${imp.path}'; accepted modules may import only '${PINNED_THREE_SPECIFIER}'`);
    }
  }

  for (const { pattern, reason } of NETWORK_API_PATTERNS) {
    if (code.includes(pattern)) violations.push(`network violation: ${reason} ('${pattern}')`);
  }

  return { ok: violations.length === 0, bare, relative, violations };
}

// ---------------------------------------------------------------------------
// Staged runtime import against the pinned three installation
// ---------------------------------------------------------------------------

export interface StagedModule {
  mod: Record<string, unknown>;
  meta: ProceduralModuleMeta;
  cleanup: () => void;
}

/**
 * Stage the module in a temp dir whose node_modules/three symlinks to the
 * single pinned installation, then dynamically import it. This proves the
 * accepted output resolves and runs directly against the single standard
 * Three.js graph — no private runtime copy, no bundling, no network.
 */
export async function importProceduralModuleAgainstPinnedThree(
  modulePath: string,
  pinnedThreeDir: string,
  metaExport: string = MODULE_META_EXPORT
): Promise<StagedModule> {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "img2threejs-stage-"));
  const nm = path.join(staging, "node_modules");
  fs.mkdirSync(nm, { recursive: true });
  fs.symlinkSync(fs.realpathSync(pinnedThreeDir), path.join(nm, PINNED_THREE_SPECIFIER), "dir");
  const stagedModule = path.join(staging, path.basename(modulePath));
  fs.copyFileSync(modulePath, stagedModule);
  try {
    const mod = (await import(pathToFileURL(stagedModule).href)) as Record<string, unknown>;
    const meta = mod[metaExport] as ProceduralModuleMeta | undefined;
    if (!meta || typeof meta !== "object") {
      throw new Error(`module does not export ${metaExport}`);
    }
    return {
      mod,
      meta,
      cleanup: () => fs.rmSync(staging, { recursive: true, force: true }),
    };
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Instantiation + structural extraction (pure geometry; no renderer/DOM)
// ---------------------------------------------------------------------------

export interface InstantiatedAsset {
  root: unknown; // THREE.Object3D (typed loosely: adapters never import three)
  meta: ProceduralModuleMeta;
  node_names: string[];
  triangles: number;
  /** Front-projected (x, y) barycentric samples of all mesh triangles, root space. */
  projected_points: Array<{ x: number; y: number }>;
}

interface MinimalPositionAttribute {
  count: number;
  getX(i: number): number;
  getY(i: number): number;
  getZ(i: number): number;
}

interface MinimalMesh {
  isMesh: boolean;
  name: string;
  geometry: {
    index: { count: number; getX(i: number): number } | null;
    attributes: { position?: MinimalPositionAttribute };
  };
  matrixWorld: { elements: ArrayLike<number> };
}

interface MinimalObject3D {
  name: string;
  children: MinimalObject3D[];
  updateMatrixWorld(updateParents?: boolean): void;
}

const BARYCENTRIC_SAMPLES_PER_AXIS = 8;

/**
 * Call the module factory and extract structural facts from the produced
 * object graph: node names, total triangles, and barycentric samples of every
 * triangle projected onto the front (XY) plane in root space.
 */
export function instantiateProceduralModule(staged: StagedModule): InstantiatedAsset {
  const factory = staged.mod[staged.meta.factory];
  if (typeof factory !== "function") {
    throw new Error(`module export '${staged.meta.factory}' is not a function (factory)`);
  }
  const root = (factory as () => unknown)();
  if (!root || typeof root !== "object") {
    throw new Error("factory did not return an object");
  }
  const objRoot = root as MinimalObject3D;
  if (typeof objRoot.updateMatrixWorld !== "function") {
    throw new Error("factory did not return a THREE.Object3D-like root");
  }

  objRoot.updateMatrixWorld(true);

  const node_names: string[] = [];
  let triangles = 0;
  const projected_points: Array<{ x: number; y: number }> = [];

  const sampleTriangle = (
    position: MinimalPositionAttribute,
    index: { count: number; getX(i: number): number } | null,
    t: number,
    e: ArrayLike<number>
  ): void => {
    const i0 = index ? index.getX(t * 3) : t * 3;
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    const p0 = { x: position.getX(i0), y: position.getY(i0), z: position.getZ(i0) };
    const p1 = { x: position.getX(i1), y: position.getY(i1), z: position.getZ(i1) };
    const p2 = { x: position.getX(i2), y: position.getY(i2), z: position.getZ(i2) };
    const N = BARYCENTRIC_SAMPLES_PER_AXIS;
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j + i <= N; j++) {
        const w0 = i / N;
        const w1 = j / N;
        const w2 = (N - i - j) / N;
        // Root-space point (module factories use identity root transforms, but
        // apply matrixWorld for correctness): column-major 4x4 application.
        const lx = w0 * p0.x + w1 * p1.x + w2 * p2.x;
        const ly = w0 * p0.y + w1 * p1.y + w2 * p2.y;
        const lz = w0 * p0.z + w1 * p1.z + w2 * p2.z;
        projected_points.push({
          x: e[0] * lx + e[4] * ly + e[8] * lz + e[12],
          y: e[1] * lx + e[5] * ly + e[9] * lz + e[13],
        });
      }
    }
  };

  const visit = (node: MinimalObject3D): void => {
    if (node.name) node_names.push(node.name);
    const mesh = node as unknown as MinimalMesh;
    if (mesh.isMesh === true && mesh.geometry) {
      const position = mesh.geometry.attributes.position;
      if (position) {
        const triCount = triCountOf(mesh.geometry);
        triangles += triCount;
        const e = mesh.matrixWorld.elements;
        for (let t = 0; t < triCount; t++) {
          sampleTriangle(position, mesh.geometry.index, t, e);
        }
      }
    }
    for (const child of node.children) visit(child);
  };

  visit(objRoot);
  return { root, meta: staged.meta, node_names, triangles, projected_points };
}

function triCountOf(geo: MinimalMesh["geometry"]): number {
  if (geo.index) return Math.floor(geo.index.count / 3);
  return geo.attributes.position ? Math.floor(geo.attributes.position.count / 3) : 0;
}

// ---------------------------------------------------------------------------
// Deterministic reference-comparison evidence (silhouette occupancy IoU)
// ---------------------------------------------------------------------------

export const DEFAULT_SILHOUETTE_GRID = 8;
export const DEFAULT_DARK_THRESHOLD = 128;

export type OccupancyGrid = boolean[][]; // [row][col], row 0 = top

/**
 * Silhouette occupancy grid from a decoded reference image: the subject is the
 * set of dark pixels (luminance < threshold) inside its own bounding box,
 * normalized to a gridN x gridN occupancy grid (top-down rows).
 */
export function silhouetteGridFromImage(
  image: DecodedImage,
  gridN: number = DEFAULT_SILHOUETTE_GRID,
  darkThreshold: number = DEFAULT_DARK_THRESHOLD
): { grid: OccupancyGrid; dark_pixels: number } {
  const grid: OccupancyGrid = Array.from({ length: gridN }, () => new Array<boolean>(gridN).fill(false));
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  let dark_pixels = 0;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.gray[y * image.width + x] < darkThreshold) {
        dark_pixels++;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (dark_pixels === 0 || maxX < 0) {
    throw new Error("reference image contains no dark subject pixels");
  }
  const w = maxX - minX;
  const h = maxY - minY;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (image.gray[y * image.width + x] < darkThreshold) {
        const col = clampCell(((x - minX) / w) * gridN, gridN);
        const row = clampCell(((y - minY) / h) * gridN, gridN);
        grid[row][col] = true;
      }
    }
  }
  return { grid, dark_pixels };
}

/**
 * Silhouette occupancy grid from front-projected geometry samples, normalized
 * to the projected bounding box. Geometry Y is up; rows are top-down to match
 * image space.
 */
export function silhouetteGridFromGeometry(
  points: Array<{ x: number; y: number }>,
  gridN: number = DEFAULT_SILHOUETTE_GRID
): OccupancyGrid {
  if (points.length === 0) throw new Error("module produced no projected geometry samples");
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const grid: OccupancyGrid = Array.from({ length: gridN }, () => new Array<boolean>(gridN).fill(false));
  for (const p of points) {
    const col = clampCell(((p.x - minX) / w) * gridN, gridN);
    const row = clampCell((1 - (p.y - minY) / h) * gridN, gridN);
    grid[row][col] = true;
  }
  return grid;
}

function clampCell(v: number, gridN: number): number {
  const c = Math.floor(v);
  return Math.max(0, Math.min(gridN - 1, c));
}

/** Intersection-over-union of two occupancy grids (0..1). */
export function gridIoU(a: OccupancyGrid, b: OccupancyGrid): number {
  let inter = 0;
  let union = 0;
  for (let r = 0; r < a.length; r++) {
    for (let c = 0; c < a[r].length; c++) {
      const av = a[r][c];
      const bv = b[r][c];
      if (av || bv) union++;
      if (av && bv) inter++;
    }
  }
  if (union === 0) return 0;
  return inter / union;
}
