/**
 * Resource Reservoir (REQ-RES-005, spec v0.5.0).
 *
 * A studio-level, indexed, content-addressed store so later games benefit from
 * earlier work. Blobs are stored exactly once under objects/<hash>/ and records
 * carry provenance, license, lineage (derived_from), and usage (used_by).
 * Adaptations that pass acceptance become reservoir resources where licensing
 * permits, so the next game reuses the accepted derivative instead of starting
 * again from the raw original.
 */

import { ReservoirRecordSchema, type ReservoirRecord, type ResourceKind } from "@gauntlet/contracts";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const RESERVOIR_INDEX_SCHEMA = "gauntlet.resource.reservoir";

export interface ReservoirIndex {
  schema: typeof RESERVOIR_INDEX_SCHEMA;
  schema_version: "1.0";
  records: ReservoirRecord[];
}

export interface ReservoirPutInput {
  id: string;
  kind: ResourceKind;
  tags?: string[];
  source: { uri?: string; license: string; author?: string; sha256?: string };
  content: Uint8Array | string;
  filename: string;
  format: string;
  metadata?: Record<string, string | number | boolean>;
  derived_from?: string[];
  verification_refs?: string[];
  built_from?: number;
  reads?: string[];
  added_at?: string;
}

export class ReservoirError extends Error {
  constructor(
    readonly code: "RESERVOIR_RECORD_INVALID" | "RESERVOIOIR_INDEX_CORRUPT" | "RESERVOIR_ID_CONFLICT",
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "ReservoirError";
  }
}

export class ReservoirStore {
  readonly root: string;

  constructor(root: string) {
    this.root = root.replace(/\/$/, "");
  }

  /**
   * Resolve the reservoir root for a project: the nearest ancestor directory
   * (including the project itself) containing `reservoir/index.json`, falling
   * back to `<projectRoot>/reservoir` when none exists yet. This lets a
   * monorepo-level reservoir serve every workspace game while a game-local
   * reservoir works standalone.
   */
  static resolveFor(projectRoot: string): ReservoirStore {
    let dir = projectRoot.replace(/\/$/, "");
    while (true) {
      const candidate = join(dir, "reservoir", "index.json");
      if (existsSync(candidate)) return new ReservoirStore(join(dir, "reservoir"));
      const parent = join(dir, "..");
      if (parent === dir) break;
      dir = parent;
    }
    return new ReservoirStore(join(projectRoot.replace(/\/$/, ""), "reservoir"));
  }

  get indexPath(): string {
    return join(this.root, "index.json");
  }

  private readIndex(): ReservoirIndex {
    if (!existsSync(this.indexPath)) {
      return { schema: RESERVOIR_INDEX_SCHEMA, schema_version: "1.0", records: [] };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.indexPath, "utf8"));
    } catch (error) {
      throw new ReservoirError("RESERVOIOIR_INDEX_CORRUPT", String(error));
    }
    const index = ReservoirIndexSafe.parse(parsed);
    return { schema: RESERVOIR_INDEX_SCHEMA, schema_version: "1.0", records: index.records };
  }

  private writeIndex(index: ReservoirIndex): void {
    mkdirSync(this.root, { recursive: true });
    const tmp = `${this.indexPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(index, null, 2));
    writeFileSync(this.indexPath, JSON.stringify(index, null, 2));
    try {
      // Keep or remove tmp; removal keeps the tree clean.
      require("node:fs").rmSync(tmp, { force: true });
    } catch {
      /* best effort */
    }
  }

  records(): ReservoirRecord[] {
    return this.readIndex().records;
  }

  get(id: string): ReservoirRecord | null {
    return this.readIndex().records.find((r) => r.id === id) ?? null;
  }

  search(query: { kind?: ResourceKind; tags?: string[]; keywords?: string[] }): ReservoirRecord[] {
    const q = query;
    return this.readIndex().records.filter((r) => {
      if (q.kind && r.kind !== q.kind) return false;
      if (q.tags && q.tags.length > 0 && !q.tags.every((t) => r.tags.includes(t))) return false;
      if (q.keywords && q.keywords.length > 0) {
        const haystack = `${r.id} ${r.tags.join(" ")} ${r.format} ${Object.values(r.metadata).join(" ")}`.toLowerCase();
        if (!q.keywords.some((k) => haystack.includes(k.toLowerCase()))) return false;
      }
      return true;
    });
  }

  /**
   * Store content once (content-addressed by sha256) and index a record.
   * Re-putting identical content does not duplicate the blob; a differing
   * record with the same id is a conflict unless `supersede` is set.
   */
  put(input: ReservoirPutInput, opts: { supersede?: boolean } = {}): { record: ReservoirRecord; blobPath: string; deduplicated: boolean } {
    const contentBytes =
      typeof input.content === "string" ? new TextEncoder().encode(input.content) : input.content;
    const localHash = createHash("sha256").update(contentBytes).digest("hex");
    const blobDir = join(this.root, "objects", localHash.slice(0, 12));
    const blobPath = join(blobDir, input.filename.replace(/[^A-Za-z0-9._-]/g, "_"));
    const deduplicated = existsSync(blobPath);
    if (!deduplicated) {
      mkdirSync(blobDir, { recursive: true });
      writeFileSync(blobPath, contentBytes);
    }

    const index = this.readIndex();
    const existing = index.records.find((r) => r.id === input.id);
    const record: ReservoirRecord = ReservoirRecordSchema.parse({
      id: input.id,
      kind: input.kind,
      tags: input.tags ?? [],
      source: input.source,
      local_hash: localHash,
      format: input.format,
      metadata: input.metadata ?? {},
      derived_from: input.derived_from ?? [],
      used_by: existing?.used_by ?? [],
      accepted: existing?.accepted ?? false,
      verification_refs: input.verification_refs ?? [],
      built_from: input.built_from,
      reads: input.reads ?? [],
      added_at: input.added_at ?? new Date().toISOString(),
    });

    if (existing && !opts.supersede) {
      if (existing.local_hash !== localHash) {
        throw new ReservoirError("RESERVOIR_ID_CONFLICT", `id '${input.id}' already holds different content`);
      }
      // Identical re-put: keep the original record (idempotent).
      return { record: existing, blobPath, deduplicated };
    }
    const others = index.records.filter((r) => r.id !== input.id);
    this.writeIndex({ schema: RESERVOIR_INDEX_SCHEMA, schema_version: "1.0", records: [...others, record] });
    return { record, blobPath, deduplicated };
  }

  blobPath(record: ReservoirRecord): string {
    const dir = join(this.root, "objects", record.local_hash.slice(0, 12));
    // The blob filename is not in the record; locate by listing the dir.
    if (!existsSync(dir)) throw new ReservoirError("RESERVOIOIR_INDEX_CORRUPT", `missing blob dir for ${record.id}`);
    const name = readFileSyncSafeDir(dir);
    if (!name) throw new ReservoirError("RESERVOIOIR_INDEX_CORRUPT", `missing blob for ${record.id}`);
    return join(dir, name);
  }

  markAccepted(id: string): ReservoirRecord {
    const index = this.readIndex();
    const record = index.records.find((r) => r.id === id);
    if (!record) throw new ReservoirError("RESERVOIR_RECORD_INVALID", `unknown reservoir id '${id}'`);
    record.accepted = true;
    this.writeIndex(index);
    return record;
  }

  linkUsage(id: string, consumer: string): ReservoirRecord {
    const index = this.readIndex();
    const record = index.records.find((r) => r.id === id);
    if (!record) throw new ReservoirError("RESERVOIR_RECORD_INVALID", `unknown reservoir id '${id}'`);
    if (!record.used_by.includes(consumer)) record.used_by.push(consumer);
    this.writeIndex(index);
    return record;
  }
}

// ReservoirRecordSchema with a relaxed index envelope (records array).
import { z } from "zod";
const ReservoirIndexSafe = z.object({ records: z.array(ReservoirRecordSchema) });

function readFileSyncSafeDir(dir: string): string | null {
  try {
    const names = require("node:fs").readdirSync(dir) as string[];
    return names[0] ?? null;
  } catch {
    return null;
  }
}
