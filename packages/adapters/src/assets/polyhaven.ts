/**
 * Poly Haven CC0 external source adapter (REQ-ASSET-003, REQ-ASSET-005, REQ-SAFE-002,
 * REQ-SAFE-003, REQ-SEC-002, REQ-SEC-004).
 *
 * HTTP intake with provenance capture for the preferred CC0 source binding
 * (`asset.polyhaven`). Network/tooling unavailability degrades to a typed blocked
 * result — it never silently lowers the requested outcome. Deterministic tests
 * inject a fetcher and fixtures; no test ever touches the real network. External
 * files are constrained to the intended project paths and validated against
 * traversal and unsafe file types before they are written.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import type { AssetRecord } from "@gauntlet/contracts";

export const POLYHAVEN_ADAPTER_VERSION = "0.3.0";
/** Texture maps the intake recognizes, in preference order (Poly Haven PBR triple).
 * Albedo accepts both live-API spellings ("Diffuse", "diff"); detection is
 * case-insensitive because the live payload capitalizes map names. */
export const POLYHAVEN_TEXTURE_MAPS = ["diff", "diffuse", "nor_gl", "arm"] as const;
export const POLYHAVEN_ALBEDO_MAPS = ["diff", "diffuse"] as const;
export const POLYHAVEN_API_BASE = "https://api.polyhaven.com";
export const POLYHAVEN_SITE_BASE = "https://polyhaven.com";

/** Minimal HTTP response surface the adapter relies on; satisfiable by fetch or test stubs. */
export interface HttpResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

export type Fetcher = (url: string) => Promise<HttpResponse>;

const defaultFetcher: Fetcher = (url) => fetch(url) as unknown as Promise<HttpResponse>;

export type PolyHavenAssetType = "models" | "textures" | "hdris";

export interface PolyHavenAssetSummary {
  id: string;
  name: string;
  type: PolyHavenAssetType;
  polycount?: number;
}

export type PolyHavenResult<T> =
  | { status: "success"; data: T }
  | { status: "blocked"; code: PolyHavenBlockedCode; detail: string }
  | { status: "failed"; code: PolyHavenFailedCode; detail: string };

export type PolyHavenBlockedCode =
  | "NETWORK_UNAVAILABLE"
  | "ASSET_NOT_FOUND"
  | "REMOTE_ERROR"
  | "TOOL_UNAVAILABLE";

export type PolyHavenFailedCode =
  | "UNSAFE_FILE"
  | "UNEXPECTED_PAYLOAD"
  | "SOURCE_EXISTS";

/** File extensions permitted to be written into the project from a Poly Haven intake. */
const SAFE_FILE_EXTENSIONS = new Set([
  ".glb",
  ".gltf",
  ".bin",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".ktx2",
  ".hdr",
  ".exr",
  ".json",
  ".txt",
  ".license",
]);

export interface PolyHavenOptions {
  fetcher?: Fetcher;
  apiBase?: string;
  now?: () => string;
}

export interface IntakeOptions {
  /** Gameplay/visual role for the produced AssetRecord. */
  role: string;
  /** Project root; files land under <projectRoot>/assets/sources/polyhaven/<id>/. */
  projectRoot: string;
  /** Preferred resolution for texture intake (default "1k"). */
  textureResolution?: string;
}

export interface PolyHavenIntakeData {
  asset_record: AssetRecord;
  files: Array<{ path: string; sha256: string; bytes: number }>;
  /** Present when the intake produced a PBR texture set (albedo + optional maps). */
  texture_set?: { albedo: string; normal?: string; arm?: string };
}

interface PolyHavenInfo {
  name?: string;
  authors?: Record<string, { author?: string }>;
  license?: string;
  tags?: string[];
}

interface PolyHavenFileEntry {
  url?: string;
  md5?: number | string;
  size?: number;
}

type PolyHavenMapEntries = Record<string, Record<string, unknown>>;

interface PolyHavenFiles {
  gltf?: { glb?: PolyHavenFileEntry; gltf?: PolyHavenFileEntry } & Record<string, unknown>;
  blend?: PolyHavenFileEntry;
  textures?: Record<string, PolyHavenFileEntry>;
  /** PBR texture maps (format-detected intake). */
  diff?: PolyHavenMapEntries;
  nor_gl?: PolyHavenMapEntries;
  arm?: PolyHavenMapEntries;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Constrain external files to the intended project path and reject traversal
 * or unsafe file types before any bytes are written (REQ-SEC-002).
 */
export function safeIntakePath(projectRoot: string, ...segments: string[]): string {
  const base = path.resolve(projectRoot, "assets", "sources", "polyhaven");
  if (segments.some((s) => s.includes("\0"))) {
    throw new PolyHavenPathError(`Intake path contains null bytes: ${segments.join("/")}`);
  }
  const resolved = path.resolve(base, ...segments);
  const rel = path.relative(base, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new PolyHavenPathError(`Intake path escapes the Poly Haven sources directory: ${segments.join("/")}`);
  }
  const ext = path.extname(resolved).toLowerCase();
  if (!SAFE_FILE_EXTENSIONS.has(ext)) {
    throw new PolyHavenPathError(`Unsafe file type rejected for intake: '${ext || "(none)"}'`);
  }
  return resolved;
}

export class PolyHavenPathError extends Error {
  code = "UNSAFE_FILE";
  constructor(message: string) {
    super(message);
    this.name = "PolyHavenPathError";
  }
}

async function guard<T>(op: () => Promise<PolyHavenResult<T>>): Promise<PolyHavenResult<T>> {
  try {
    return await op();
  } catch (err) {
    if (err instanceof PolyHavenPathError) {
      return { status: "failed", code: "UNSAFE_FILE", detail: err.message };
    }
    // fetch() rejects on DNS/socket/abort failures -> typed scoped blockage (REQ-SAFE-002).
    return { status: "blocked", code: "NETWORK_UNAVAILABLE", detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Poly Haven CC0 source adapter. All HTTP access goes through the injectable
 * fetcher; provenance (source URI, license, author, sha256, retrieval time) is
 * captured for every intake.
 */
export class PolyHavenAssetSource {
  private readonly fetcher: Fetcher;
  private readonly apiBase: string;
  private readonly now: () => string;

  constructor(options: PolyHavenOptions = {}) {
    this.fetcher = options.fetcher ?? defaultFetcher;
    this.apiBase = options.apiBase ?? POLYHAVEN_API_BASE;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async listAssets(type: PolyHavenAssetType): Promise<PolyHavenResult<PolyHavenAssetSummary[]>> {
    return guard(async () => {
      const res = await this.fetcher(`${this.apiBase}/assets?type=${type}`);
      if (!res.ok) {
        return { status: "blocked" as const, code: "REMOTE_ERROR" as const, detail: `Poly Haven assets request failed with HTTP ${res.status}` };
      }
      const payload = await res.json();
      if (!isRecord(payload)) {
        return { status: "failed" as const, code: "UNEXPECTED_PAYLOAD" as const, detail: "Poly Haven assets response was not an object" };
      }
      const assets = Object.entries(payload).map(([id, value]) => ({
        id,
        name: isRecord(value) && typeof value["name"] === "string" ? (value["name"] as string) : id,
        type,
        ...(isRecord(value) && typeof value["polycount"] === "number" ? { polycount: value["polycount"] as number } : {}),
      }));
      return { status: "success", data: assets };
    });
  }

  private async fetchJson<T>(url: string): Promise<PolyHavenResult<T>> {
    let res: HttpResponse;
    try {
      res = await this.fetcher(url);
    } catch (err) {
      return { status: "blocked", code: "NETWORK_UNAVAILABLE", detail: err instanceof Error ? err.message : String(err) };
    }
    if (res.status === 404) {
      return { status: "blocked", code: "ASSET_NOT_FOUND", detail: `Poly Haven asset not found: ${url}` };
    }
    if (!res.ok) {
      return { status: "blocked", code: "REMOTE_ERROR", detail: `Poly Haven request failed with HTTP ${res.status}: ${url}` };
    }
    try {
      const data = (await res.json()) as T;
      return { status: "success", data };
    } catch (err) {
      return { status: "failed", code: "UNEXPECTED_PAYLOAD", detail: `Poly Haven response was not valid JSON: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  /**
   * Intake one Poly Haven asset: download the GLB file, hash every byte written,
   * and produce a pending AssetRecord with full CC0 provenance. Acceptance is
   * NOT granted here — the Asset Registry gates decide that.
   */
  async intakeAsset(id: string, options: IntakeOptions): Promise<PolyHavenResult<PolyHavenIntakeData>> {
    const infoRes = await this.fetchJson<PolyHavenInfo>(`${this.apiBase}/info/${id}`);
    if (infoRes.status !== "success") return infoRes;
    const filesRes = await this.fetchJson<PolyHavenFiles>(`${this.apiBase}/files/${id}`);
    if (filesRes.status !== "success") return filesRes;

    const info = infoRes.data;
    const files = filesRes.data;
    const authors = Object.values(info.authors ?? {})
      .map((a) => a?.author)
      .filter((a): a is string => typeof a === "string" && a.length > 0);
    const license = typeof info.license === "string" && info.license.length > 0 ? info.license : "CC0";

    const dirRelative = path.join(id);
    const downloaded: PolyHavenIntakeData["files"] = [];

    const downloadOne = async (url: string, fileName: string): Promise<PolyHavenResult<{ absPath: string; sha256: string; bytes: number }>> => {
      let absPath: string;
      try {
        absPath = safeIntakePath(options.projectRoot, dirRelative, fileName);
      } catch (err) {
        return { status: "failed", code: "UNSAFE_FILE", detail: err instanceof Error ? err.message : String(err) };
      }
      let res: HttpResponse;
      try {
        res = await this.fetcher(url);
      } catch (err) {
        return { status: "blocked", code: "NETWORK_UNAVAILABLE", detail: err instanceof Error ? err.message : String(err) };
      }
      if (!res.ok) {
        return { status: "blocked", code: "REMOTE_ERROR", detail: `Poly Haven file download failed with HTTP ${res.status}: ${url}` };
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      try {
        // O_EXCL semantics close the CLI's check-then-fetch race: no intake may
        // replace bytes that another process has already retained.
        fs.writeFileSync(absPath, bytes, { flag: "wx" });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EEXIST") {
          return { status: "failed", code: "SOURCE_EXISTS", detail: `Retained source file already exists: ${path.relative(options.projectRoot, absPath)}` };
        }
        throw err;
      }
      return { status: "success", data: { absPath, sha256, bytes: bytes.byteLength } };
    };

    // The live API serves models in two shapes: the legacy flat `gltf.glb` entry and
    // resolution-nested `.gltf` scene bundles with separate texture `include` files.
    // Texture assets instead carry per-map resolution zips. Intake is format-aware.
    const glbEntry = files?.gltf?.glb;
    const nestedResolutions = files?.gltf ? Object.entries(files.gltf).filter(([, v]) => v && typeof v === "object" && "gltf" in (v as Record<string, unknown>)) : [];
    const lowerFiles: Record<string, Record<string, { zip?: { url?: unknown } }>> = {};
    if (files) for (const [key, value] of Object.entries(files)) {
      if (value && typeof value === "object" && !("url" in (value as Record<string, unknown>))) {
        lowerFiles[key.toLowerCase()] = value as Record<string, { zip?: { url?: unknown } }>;
      }
    }
    const hasAlbedo = POLYHAVEN_ALBEDO_MAPS.some(map => lowerFiles[map]);
    const textureMaps = hasAlbedo ? POLYHAVEN_TEXTURE_MAPS.filter(map => lowerFiles[map]) : [];

    const finish = (runtime: string, primarySha256: string, textureSet?: PolyHavenIntakeData["texture_set"]) => {
      const assetId = `polyhaven-${id}`;
      const record: AssetRecord = {
        id: assetId,
        role: options.role,
        origin: "cc0",
        construction_route: "asset.source/asset.polyhaven",
        source_provenance: {
          uri: `${POLYHAVEN_SITE_BASE}/a/${id}`,
          license,
          author: authors.length > 0 ? authors.join(", ") : "Poly Haven",
          sha256: primarySha256,
          retrieved_at: this.now(),
        },
        runtime_representation: runtime,
        budget: {},
        acceptance_state: "pending",
      };
      return {
        status: "success" as const,
        data: { asset_record: record, files: downloaded, ...(textureSet ? { texture_set: textureSet } : {}) },
      };
    };

    // Texture set: per-map resolution zips extracted with the local unzip tool.
    // Zips are intermediates: they are fetched to a temp location and never
    // retained in the project tree — only the extracted, hashed images are.
    if (hasAlbedo) {
      const resolution = options.textureResolution ?? "1k";
      const extracted: Array<{ name: string; result: { absPath: string; sha256: string; bytes: number } }> = [];
      for (const map of textureMaps) {
        const res = this.pickResolution(lowerFiles[map], resolution);
        if (!res) return { status: "failed", code: "UNEXPECTED_PAYLOAD", detail: `Poly Haven texture '${id}' map '${map}' has no usable resolution entry` };
        const entry = lowerFiles[map]?.[res] ?? {};
        // Live payloads expose a direct per-resolution jpg; zips remain supported.
        const jpgUrl = (entry as { jpg?: { url?: unknown } }).jpg?.url;
        if (typeof jpgUrl === "string") {
          const result = await downloadOne(jpgUrl, path.basename(new URL(jpgUrl).pathname));
          if (result.status !== "success") return result;
          extracted.push({ name: path.basename(jpgUrl), result: result.data });
          continue;
        }
        const zipEntry = (entry as { zip?: { url?: unknown } }).zip;
        if (!zipEntry || typeof zipEntry.url !== "string") return { status: "failed", code: "UNEXPECTED_PAYLOAD", detail: `Poly Haven texture '${id}' map '${map}' exposes no jpg or zip download at ${res}` };
        const zipPath = await this.fetchZipToTemp(zipEntry.url);
        if (zipPath.status !== "success") return zipPath;
        const picked = this.extractTextureZip(zipPath.data, options.projectRoot, id, `${id}_${map}_${res}`, res);
        if (picked.status !== "success") return picked;
        extracted.push(...picked.data);
      }
      const albedo = extracted.find(f => /diff|albedo/.test(f.name));
      const normal = extracted.find(f => f.name.includes("nor"));
      const arm = extracted.find(f => f.name.includes("arm"));
      if (!albedo) return { status: "failed", code: "UNEXPECTED_PAYLOAD", detail: `Poly Haven texture '${id}' zip contained no albedo (diff) image` };
      for (const file of extracted) downloaded.push({ path: file.result.absPath ? path.relative(options.projectRoot, file.result.absPath) : "", sha256: file.result.sha256, bytes: file.result.bytes });
      const primarySha256 = albedo.result.sha256;
      return finish(`Texture set (JPG: ${textureMaps.join(",")})`, primarySha256, { albedo: path.relative(options.projectRoot, albedo.result.absPath), ...(normal ? { normal: path.relative(options.projectRoot, normal.result.absPath) } : {}), ...(arm ? { arm: path.relative(options.projectRoot, arm.result.absPath) } : {}) });
    }

    // Legacy flat single-GLB model.
    if (glbEntry && typeof glbEntry.url === "string") {
      const glbResult = await downloadOne(glbEntry.url, `${id}.glb`);
      if (glbResult.status !== "success") return glbResult;
      downloaded.push({ path: path.relative(options.projectRoot, glbResult.data.absPath), sha256: glbResult.data.sha256, bytes: glbResult.data.bytes });
      return finish("GLB/glTF", glbResult.data.sha256);
    }

    // Live nested model bundle: pick the preferred resolution and download the scene
    // file plus every included texture at its relative path.
    if (nestedResolutions.length > 0) {
      const preferred = ["2k", "1k", "4k", "8k"].map(r => nestedResolutions.find(([key]) => key === r)).find(Boolean)
        ?? nestedResolutions[0];
      const bundle = (preferred![1] as { gltf?: { url?: unknown; include?: unknown } }).gltf;
      if (!bundle || typeof bundle.url !== "string" || !bundle.url.endsWith(".gltf")) {
        return { status: "failed", code: "UNEXPECTED_PAYLOAD", detail: `Poly Haven asset '${id}' exposes no downloadable GLB file and no .gltf scene bundle` };
      }
      const sceneName = path.basename(new URL(bundle.url).pathname);
      const sceneResult = await downloadOne(bundle.url, sceneName);
      if (sceneResult.status !== "success") return sceneResult;
      downloaded.push({ path: path.relative(options.projectRoot, sceneResult.data.absPath), sha256: sceneResult.data.sha256, bytes: sceneResult.data.bytes });
      const include = (bundle.include ?? {}) as Record<string, { url?: unknown }>;
      for (const [relativeName, entry] of Object.entries(include)) {
        if (typeof entry?.url !== "string") continue;
        const result = await downloadOne(entry.url, relativeName);
        if (result.status !== "success") return result;
        downloaded.push({ path: path.relative(options.projectRoot, result.data.absPath), sha256: result.data.sha256, bytes: result.data.bytes });
      }
      return finish("glTF scene bundle", sceneResult.data.sha256);
    }

    return { status: "failed", code: "UNEXPECTED_PAYLOAD", detail: `Poly Haven asset '${id}' exposes no downloadable GLB file` };
  }

  private async fetchZipToTemp(url: string): Promise<PolyHavenResult<string>> {
    let res: HttpResponse;
    try {
      res = await this.fetcher(url);
    } catch (err) {
      return { status: "blocked", code: "NETWORK_UNAVAILABLE", detail: err instanceof Error ? err.message : String(err) };
    }
    if (!res.ok) return { status: "blocked", code: "REMOTE_ERROR", detail: `Poly Haven zip download failed with HTTP ${res.status}: ${url}` };
    const bytes = new Uint8Array(await res.arrayBuffer());
    const temp = path.join(os.tmpdir(), `polyhaven-${crypto.randomBytes(6).toString("hex")}.zip`);
    fs.writeFileSync(temp, bytes);
    return { status: "success", data: temp };
  }

  private pickResolution(map: Record<string, Record<string, unknown>> | undefined, wanted: string): string | null {
    if (!map) return null;
    if (map[wanted]) return wanted;
    const keys = Object.keys(map);
    return keys.length > 0 ? keys.sort()[0] : null;
  }

  /**
   * Extract a downloaded texture zip with the local unzip tool, keep only image
   * files, and retain them under the intake directory with exclusive creation.
   * Any entry that escapes the extraction directory is rejected (zip-slip guard).
   */
  private extractTextureZip(zipAbsPath: string, projectRoot: string, retainDirRelative: string, filePrefix: string, resolution: string):
    PolyHavenResult<Array<{ name: string; result: { absPath: string; sha256: string; bytes: number } }>> {
    // Explicit mkdtemp target: never parse tool output for the extraction path,
    // and never walk a directory this adapter did not create.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polyhaven-x-"));
    const unzip = spawnSync("unzip", ["-o", "-j", zipAbsPath, "-d", dir], { encoding: "utf8" });
    if (unzip.error || unzip.status !== 0) {
      fs.rmSync(dir, { recursive: true, force: true });
      const detail = unzip.error ? String(unzip.error) : (unzip.stderr || "unzip exited non-zero");
      return { status: "blocked", code: "TOOL_UNAVAILABLE", detail: `texture intake requires the unzip tool: ${detail.trim()}` };
    }
    try {
      const extractRoot = path.resolve(dir);
      const kept: Array<{ name: string; result: { absPath: string; sha256: string; bytes: number } }> = [];
      const walk = (dirPath: string): void => {
        for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
          const abs = path.join(dirPath, entry.name);
          if (entry.isDirectory()) { walk(abs); continue; }
          if (!/\.(jpg|jpeg|png)$/i.test(entry.name)) continue;
          if (!entry.name.includes(`_${resolution}.`)) continue; // keep only the requested resolution
          const bytes = fs.readFileSync(abs);
          const finalName = entry.name.toLowerCase();
          const absPath = safeIntakePath(projectRoot, retainDirRelative, finalName);
          fs.mkdirSync(path.dirname(absPath), { recursive: true });
          try {
            fs.writeFileSync(absPath, bytes, { flag: "wx" });
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code === "EEXIST") throw Object.assign(new Error(`Retained source file already exists: ${path.relative(projectRoot, absPath)}`), { code: "SOURCE_EXISTS" });
            throw err;
          }
          kept.push({ name: entry.name, result: { absPath, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), bytes: bytes.byteLength } });
        }
      };
      walk(extractRoot);
      if (kept.length === 0) return { status: "failed", code: "UNEXPECTED_PAYLOAD", detail: `texture zip for '${filePrefix}' contained no image files` };
      return { status: "success", data: kept };
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "SOURCE_EXISTS" || (err instanceof Error && err.message.includes("already exists"))) {
        return { status: "failed", code: "SOURCE_EXISTS", detail: err instanceof Error ? err.message : String(err) };
      }
      if (err instanceof PolyHavenPathError) return { status: "failed", code: "UNSAFE_FILE", detail: err.message };
      return { status: "failed", code: "UNEXPECTED_PAYLOAD", detail: err instanceof Error ? err.message : String(err) };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}
