/**
 * Opt-in foundation catalog provider. The importer owns archive extraction; this
 * adapter consumes ONLY its verified derivatives and never bypasses AssetRegistry.
 * No network or DCC required. Existing asset.resolve remains the sole intake route.
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AssetSourceProvider, ProviderMatch, ProviderSearchOutcome } from "../assets/resolve";

const ID = /^[a-z0-9][a-z0-9_.-]*$/;
const SOURCE_URIS: Record<string, string> = {
  base: "https://quaternius.itch.io/universal-base-characters",
  "animations-1": "https://quaternius.itch.io/universal-animation-library",
  "animations-2": "https://quaternius.itch.io/universal-animation-library-2",
  outfits: "https://quaternius.itch.io/modular-character-outfits-fantasy",
};

export type FoundationKind = "character" | "outfit" | "animation-library";
export interface FoundationAsset {
  id: string;
  kind: FoundationKind;
  path: string;
  sha256: string;
  skeleton_bone_names: string[];
  skeleton_sha256: string;
  animation_clips: string[];
  root_motion: boolean;
  repairs: Array<{ from: string; to: string }>;
  acceptance: "pending";
}
export interface FoundationPack {
  id: string;
  archive: string;
  archive_sha256: string;
  license: string;
  license_file: string;
}
export interface FoundationInventory {
  schema: "gauntlet.foundation.inventory";
  schema_version: "1.0";
  license: "CC0-1.0";
  packs: FoundationPack[];
  assets: FoundationAsset[];
  compatibility: { bone_names_match: boolean; skeleton_sha256: string };
  publication_state: "unaccepted-source-derivatives";
}

export class FoundationCatalogError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "FoundationCatalogError";
  }
}

function contained(base: string, candidate: string): string {
  const absBase = path.resolve(base);
  const absolute = path.resolve(absBase, candidate);
  const rel = path.relative(absBase, absolute);
  if (!rel || rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
    throw new FoundationCatalogError("UNSAFE_PATH", "Foundation path escapes or aliases root: " + candidate);
  }
  return absolute;
}

function digest(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function isHexDigest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function validateInventory(input: unknown): FoundationInventory {
  if (typeof input !== "object" || !input) throw new FoundationCatalogError("INVALID_CATALOG", "Catalog must be an object");
  const value = input as Partial<FoundationInventory>;
  if (value.schema !== "gauntlet.foundation.inventory" || value.schema_version !== "1.0" ||
      value.license !== "CC0-1.0" || value.publication_state !== "unaccepted-source-derivatives" ||
      !Array.isArray(value.assets) || !Array.isArray(value.packs) ||
      value.compatibility?.bone_names_match !== true || !isHexDigest(value.compatibility.skeleton_sha256)) {
    throw new FoundationCatalogError("INVALID_CATALOG", "Foundation catalog identity, version, or safety boundary invalid");
  }
  for (const pack of value.packs) {
    if (!SOURCE_URIS[pack.id] || pack.license !== "CC0-1.0" || !isHexDigest(pack.archive_sha256)) {
      throw new FoundationCatalogError("INVALID_PACK", "Unsupported foundation pack or missing license/hash");
    }
  }
  const ids = new Set<string>();
  for (const asset of value.assets) {
    if (!ID.test(asset.id) || ids.has(asset.id) ||
        !["character", "outfit", "animation-library"].includes(asset.kind) ||
        !isHexDigest(asset.sha256) || !isHexDigest(asset.skeleton_sha256) ||
        asset.skeleton_sha256 !== value.compatibility.skeleton_sha256 ||
        !Array.isArray(asset.skeleton_bone_names) || asset.skeleton_bone_names.length < 1 ||
        !Array.isArray(asset.animation_clips) || !asset.animation_clips.every(v => typeof v === "string") ||
        asset.acceptance !== "pending" || typeof asset.root_motion !== "boolean" ||
        typeof asset.path !== "string" || !/\.(gltf|glb)$/i.test(asset.path)) {
      throw new FoundationCatalogError("INVALID_ASSET", "Malformed foundation asset record " + String(asset.id));
    }
    // normalized paths must be safe *before* touching the filesystem
    contained("/foundation-source-root", asset.path);
    ids.add(asset.id);
  }
  return value as FoundationInventory;
}

export function loadFoundationInventory(file: string): FoundationInventory {
  let input: unknown;
  try {
    input = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (error) {
    throw new FoundationCatalogError("CATALOG_UNREADABLE", "Cannot read foundation catalog: " + String(error));
  }
  return validateInventory(input);
}

/** Contract-level kind gating: no animation file can masquerade as a character. */
export function roleAllowsFoundation(role: string, kind: FoundationKind): boolean {
  const r = role.toLowerCase();
  if (/animation|motion|locomotion/.test(r)) return kind === "animation-library";
  if (/outfit|armor|clothing|apparel|costume/.test(r)) return kind === "outfit";
  if (/character|humanoid|player|enemy|npc|hero|human|avatar/.test(r)) return kind === "character";
  return false; // unknown role: do not silently substitute incompatible geometry
}

export function findFoundationAssets(inventory: FoundationInventory, role: string, keywords: string[]): FoundationAsset[] {
  const needles = keywords.flatMap(x => x.toLowerCase().split(/[^a-z0-9]+/)).filter(Boolean).map(x =>
    x === "woman" ? "female" : x === "man" ? "male" : x);
  // These body types are not available in Standard. Never imply a child asset is included.
  if (needles.some(x => ["child", "children", "kid", "boy", "girl", "baby", "toddler"].includes(x))) return [];
  const relevant = inventory.assets.filter(a => roleAllowsFoundation(role, a.kind));
  const scoring = (asset: FoundationAsset): number => {
    const tokens = new Set((asset.id + " " + asset.path).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
    let score = 0;
    for (const term of needles) {
      if (tokens.has(term)) score += 3;
      if (["humanoid", "player", "character", "human", "hero", "npc", "enemy"].includes(term) && asset.kind === "character") score += 1;
      if (["locomotion", "animation", "motion", "run", "walk"].includes(term) && asset.kind === "animation-library") score += 1;
    }
    if (asset.kind === "animation-library" && asset.root_motion) score -= 1; // prefer ECS-safe in-place variant
    return score;
  };
  return relevant.filter(a => needles.length === 0 || scoring(a) > 0)
    .sort((a, b) => scoring(b) - scoring(a) || a.id.localeCompare(b.id));
}

function dependencies(sourceFile: string): string[] {
  if (!sourceFile.endsWith(".gltf")) return [];
  const document = JSON.parse(fs.readFileSync(sourceFile, "utf8")) as {
    buffers?: Array<{ uri?: string }>; images?: Array<{ uri?: string }>;
  };
  const uris = [...(document.buffers ?? []), ...(document.images ?? [])]
    .map(x => x.uri).filter((x): x is string => Boolean(x));
  for (const uri of uris) {
    if (uri.startsWith("data:") || uri.includes("://") || path.isAbsolute(uri) || uri.includes("\\") ||
        uri.split("/").includes("..")) {
      throw new FoundationCatalogError("UNSAFE_DEPENDENCY", "Unsupported external glTF URI: " + uri);
    }
  }
  return [...new Set(uris)];
}

export interface FoundationProviderOptions {
  inventoryPath: string;
}

/**
 * Provider is deliberately a *pending* intake; calling acquire does not accept
 * the asset or authorize a game to ship it. The project registry verifies that.
 */
export function createFoundationProvider(options: FoundationProviderOptions): AssetSourceProvider {
  const catalogPath = path.resolve(options.inventoryPath);
  const sourceRoot = path.join(path.dirname(catalogPath), "raw");
  return {
    id: "gauntlet-foundations",
    async search(keywords: string[], role: string): Promise<ProviderSearchOutcome> {
      if (!fs.existsSync(catalogPath)) return { status: "success", matches: [] };
      try {
        const inventory = loadFoundationInventory(catalogPath);
        return {
          status: "success",
          matches: findFoundationAssets(inventory, role, keywords).map(asset => ({
            provider: "gauntlet-foundations",
            assetId: asset.id,
            title: asset.id,
            license: inventory.license,
            sourceUri: SOURCE_URIS[asset.id.split(".")[1]] ?? "https://quaternius.itch.io",
            metadata: { kind: asset.kind, skeleton_sha256: asset.skeleton_sha256, root_motion: asset.root_motion },
          })),
        };
      } catch (error) {
        return { status: "unavailable", detail: error instanceof Error ? error.message : String(error) };
      }
    },
    async acquire(match: ProviderMatch, role: string, projectRoot: string) {
      try {
        const inventory = loadFoundationInventory(catalogPath);
        const asset = inventory.assets.find(item => item.id === match.assetId);
        if (!asset || !roleAllowsFoundation(role, asset.kind)) {
          return { status: "blocked" as const, code: "FOUNDATION_NOT_COMPATIBLE", detail: "Missing or incompatible foundation asset" };
        }
        const source = contained(sourceRoot, asset.path);
        if (!fs.existsSync(source) || digest(source) !== asset.sha256) {
          return { status: "blocked" as const, code: "FOUNDATION_STALE", detail: "Source derivative missing or hash changed; re-run foundation import" };
        }
        const companions = dependencies(source);
        const srcFiles = [source, ...companions.map(uri => contained(path.dirname(source), uri))];
        if (srcFiles.some(f => !fs.existsSync(f))) {
          return { status: "blocked" as const, code: "FOUNDATION_INCOMPLETE", detail: "glTF dependencies not present" };
        }
        const targetRoot = path.resolve(projectRoot, "assets", "sources", "foundations", asset.id);
        const paths = srcFiles.map((file, i) => ({
          from: file, to: contained(targetRoot, i === 0 ? path.basename(source) : companions[i - 1]),
        }));
        // Verify every destination before writing ANY file. Never clobber user content.
        for (const entry of paths) {
          if (fs.existsSync(entry.to) && digest(entry.to) !== digest(entry.from)) {
            return { status: "blocked" as const, code: "FOUNDATION_DESTINATION_CONFLICT", detail: "Existing project file differs: " + entry.to };
          }
        }
        for (const entry of paths) {
          fs.mkdirSync(path.dirname(entry.to), { recursive: true });
          if (!fs.existsSync(entry.to)) fs.copyFileSync(entry.from, entry.to);
        }
        const relative = path.relative(projectRoot, paths[0].to).split(path.sep).join("/");
        return {
          status: "success" as const,
          files: paths.map(x => x.to),
          assetRecord: {
            id: asset.id, role, origin: "cc0", construction_route: "asset.resolve/gauntlet-foundations",
            source_provenance: {
              uri: SOURCE_URIS[asset.id.split(".")[1]],
              license: inventory.license, author: "Quaternius", sha256: asset.sha256,
              retrieved_at: new Date().toISOString(),
              donor_notice: "Source ZIP and derivative hashes recorded in foundation inventory",
            },
            runtime_representation: relative,
            acceptance_state: "pending",
            budget: {},
            animation_contract: {
              skeleton_sha256: asset.skeleton_sha256,
              skeleton_bone_names: asset.skeleton_bone_names,
              clip_names: asset.animation_clips,
              root_motion: asset.root_motion,
              kind: asset.kind,
            },
          },
        };
      } catch (error) {
        return { status: "blocked" as const, code: "FOUNDATION_ACQUIRE_FAILED", detail: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

/** Find a dev checkout's ignored derivative catalog without coupling to cwd. */
export function findFoundationInventory(packageDir: string, override?: string): string {
  return override ? path.resolve(override) : path.resolve(packageDir, "../../../.tmp/foundations/quaternius/inventory.json");
}
