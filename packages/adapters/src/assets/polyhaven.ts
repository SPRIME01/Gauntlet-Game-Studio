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
import * as path from "node:path";
import type { AssetRecord } from "@gauntlet/contracts";

export const POLYHAVEN_ADAPTER_VERSION = "0.2.0";
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
}

export type PolyHavenResult<T> =
  | { status: "success"; data: T }
  | { status: "blocked"; code: PolyHavenBlockedCode; detail: string }
  | { status: "failed"; code: PolyHavenFailedCode; detail: string };

export type PolyHavenBlockedCode =
  | "NETWORK_UNAVAILABLE"
  | "ASSET_NOT_FOUND"
  | "REMOTE_ERROR";

export type PolyHavenFailedCode =
  | "UNSAFE_FILE"
  | "UNEXPECTED_PAYLOAD";

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
}

export interface PolyHavenIntakeData {
  asset_record: AssetRecord;
  files: Array<{ path: string; sha256: string; bytes: number }>;
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

interface PolyHavenFiles {
  gltf?: { glb?: PolyHavenFileEntry; gltf?: PolyHavenFileEntry };
  blend?: PolyHavenFileEntry;
  textures?: Record<string, PolyHavenFileEntry>;
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
    const glbEntry = files?.gltf?.glb;
    if (!glbEntry || typeof glbEntry.url !== "string") {
      return { status: "failed", code: "UNEXPECTED_PAYLOAD", detail: `Poly Haven asset '${id}' exposes no downloadable GLB file` };
    }

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
      fs.writeFileSync(absPath, bytes);
      return { status: "success", data: { absPath, sha256, bytes: bytes.byteLength } };
    };

    const glbName = `${id}.glb`;
    const glbResult = await downloadOne(glbEntry.url, glbName);
    if (glbResult.status !== "success") return glbResult;
    downloaded.push({ path: path.relative(options.projectRoot, glbResult.data.absPath), sha256: glbResult.data.sha256, bytes: glbResult.data.bytes });

    const primarySha256 = glbResult.data.sha256;
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
      runtime_representation: "GLB/glTF",
      budget: {},
      acceptance_state: "pending",
    };

    return {
      status: "success",
      data: {
        asset_record: record,
        files: downloaded,
      },
    };
  }
}
