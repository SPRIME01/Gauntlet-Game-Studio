/**
 * Cockpit storage (REQ-COCKPIT-003, spec v0.5.0).
 *
 * Two classes in one disposable SQLite database (bun:sqlite, WAL):
 *  - projection: a rebuildable mirror of canonical state. Nothing here is
 *    truth; `rebuild()` regenerates every row from the project files, and
 *    deleting the database does not change the game.
 *  - cockpit state: non-authoritative cockpit-owned state (workspace layout,
 *    pins, interactions, work requests, owner answers). Losing it loses only
 *    cockpit convenience, never game truth.
 *
 * Canonical game truth lives in the Game Model, asset registry, recipes,
 * evidence store, and settlements — never here.
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface ProjectionRow {
  kind: string;
  id: string;
  ord: number;
  data: string;
}

export interface WorkRequestRow {
  seq: number;
  text: string;
  kind: string;
  status: string;
  actor: string;
  refs: string;
  note: string;
  history: string;
  created_at: string;
  updated_at: string;
}

export class CockpitDb {
  readonly db: Database;
  readonly path: string;

  constructor(projectRoot: string) {
    const dir = join(projectRoot.replace(/\/$/, ""), ".cockpit");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.path = join(dir, "cockpit.db");
    this.db = new Database(this.path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA busy_timeout = 3000;");
    this.migrate();
  }

  private migrate(): void {
    const userVersion = (this.db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
    if (userVersion >= 1) return;
    this.db.transaction(() => {
      // ── projection (disposable, rebuildable) ──
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS entities (
          kind TEXT NOT NULL, id TEXT NOT NULL, ord INTEGER NOT NULL, data TEXT NOT NULL,
          PRIMARY KEY (kind, id)
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(
          kind UNINDEXED, id UNINDEXED, text, tokenize='porter unicode61'
        );
      `);
      // ── cockpit state (durable, non-authoritative) ──
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS ui_state (k TEXT PRIMARY KEY, v TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS interactions (
          seq INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, actor TEXT NOT NULL,
          op TEXT NOT NULL, data TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS work_requests (
          seq INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'unclassified',
          status TEXT NOT NULL DEFAULT 'queued', actor TEXT NOT NULL DEFAULT 'owner', refs TEXT NOT NULL DEFAULT '[]',
          note TEXT NOT NULL DEFAULT '', history TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
      `);
      this.db.exec("PRAGMA user_version = 1;");
    })();
  }

  // ── projection API ──

  replaceProjection(rows: ProjectionRow[], searchRows: { kind: string; id: string; text: string }[]): void {
    this.db.transaction(() => {
      this.db.exec("DELETE FROM entities;");
      this.db.exec("DELETE FROM search;");
      const insert = this.db.query("INSERT INTO entities (kind, id, ord, data) VALUES (?, ?, ?, ?)");
      const insertSearch = this.db.query("INSERT INTO search (kind, id, text) VALUES (?, ?, ?)");
      for (const row of rows) insert.run(row.kind, row.id, row.ord, row.data);
      for (const row of searchRows) insertSearch.run(row.kind, row.id, row.text);
    })();
  }

  listEntities(kind?: string): ProjectionRow[] {
    if (kind) {
      return this.db.query("SELECT kind, id, ord, data FROM entities WHERE kind = ? ORDER BY ord").all(kind) as ProjectionRow[];
    }
    return this.db.query("SELECT kind, id, ord, data FROM entities ORDER BY kind, ord").all() as ProjectionRow[];
  }

  getEntity(kind: string, id: string): ProjectionRow | null {
    return (this.db.query("SELECT kind, id, ord, data FROM entities WHERE kind = ? AND id = ?").get(kind, id) as ProjectionRow | undefined) ?? null;
  }

  searchEntities(query: string, limit = 20): ProjectionRow[] {
    return this.db
      .query("SELECT kind, id, '' as ord, text as data FROM search WHERE search MATCH ? LIMIT ?")
      .all(query, limit) as unknown as ProjectionRow[];
  }

  // ── cockpit state API ──

  getUiState(key: string): string | null {
    const row = this.db.query("SELECT v FROM ui_state WHERE k = ?").get(key) as { v: string } | undefined;
    return row?.v ?? null;
  }

  setUiState(key: string, value: string): void {
    this.db.query("INSERT INTO ui_state (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(key, value);
  }

  appendInteraction(actor: string, op: string, data: unknown): void {
    this.db
      .query("INSERT INTO interactions (ts, actor, op, data) VALUES (?, ?, ?, ?)")
      .run(new Date().toISOString(), actor, op, JSON.stringify(data).slice(0, 8000));
  }

  listInteractions(limit = 50): unknown[] {
    return this.db.query("SELECT * FROM interactions ORDER BY seq DESC LIMIT ?").all(limit);
  }

  // ── work requests ──

  insertWorkRequest(text: string, kind: string, actor: string, refs: string[]): number {
    const now = new Date().toISOString();
    // The queued step is part of the durable history from birth, and the actor
    // records who actually submitted (agent on the owner's behalf, or owner).
    const history = JSON.stringify([{ ts: now, status: "queued", by: actor }]);
    const result = this.db
      .query("INSERT INTO work_requests (text, kind, actor, refs, history, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(text, kind, actor, JSON.stringify(refs), history, now, now);
    return Number(result.lastInsertRowid);
  }

  getWorkRequest(seq: number): WorkRequestRow | null {
    return (this.db.query("SELECT * FROM work_requests WHERE seq = ?").get(seq) as WorkRequestRow | undefined) ?? null;
  }

  listWorkRequests(): WorkRequestRow[] {
    return this.db.query("SELECT * FROM work_requests ORDER BY seq DESC LIMIT 100").all() as WorkRequestRow[];
  }

  updateWorkRequest(seq: number, patch: { status?: string; note?: string; refs?: string[]; historyStep?: { status: string; by: string; note?: string } }): void {
    const row = this.getWorkRequest(seq);
    if (!row) return;
    const history = JSON.parse(row.history) as { status: string; by: string; note?: string; ts: string }[];
    if (patch.historyStep) history.push({ ts: new Date().toISOString(), ...patch.historyStep });
    this.db
      .query("UPDATE work_requests SET status = ?, note = ?, refs = ?, history = ?, updated_at = ? WHERE seq = ?")
      .run(
        patch.status ?? row.status,
        patch.note ?? row.note,
        patch.refs ? JSON.stringify(patch.refs) : row.refs,
        JSON.stringify(history.slice(-30)),
        new Date().toISOString(),
        seq,
      );
  }

  /** Prove disposability: wipe everything (projection + cockpit state). */
  destroy(): void {
    this.db.exec("DELETE FROM entities; DELETE FROM search; DELETE FROM ui_state; DELETE FROM interactions; DELETE FROM work_requests;");
  }

  close(): void {
    this.db.close();
  }
}
