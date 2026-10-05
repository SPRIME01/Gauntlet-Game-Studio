/**
 * Cockpit core (REQ-COCKPIT-003/004/007/008, REQ-MCP-001, spec v0.5.0).
 *
 * One implementation per semantic tool, dispatched by name, behind every
 * transport (CLI, loopback MCP, WebMCP). Authority is decided here by the
 * `role` the transport passes: agent actions apply through the pure reducer
 * (which enforces the agent/owner boundary), human authority ops are recorded
 * for routing — never applied to canonical truth — and the executor cannot
 * accept or cancel its own work.
 */

import { join } from "node:path";
import { ReservoirStore, listCreationExceptions } from "@gauntlet/studio";
import { CockpitDb } from "./db";
import { projectCockpitState } from "./project";
import {
  applyAgent,
  applyHuman,
  initialWorkspace,
  workInsert,
  workMove,
  type WorkspaceState,
  type WorkRequestState,
} from "./workspace";
import * as world from "./world";
import { TOOLS, TOOL_NAMES, activeTools, type ToolDef } from "../protocol/tools";
import type { CockpitResult, Role, RequestStatus } from "../protocol/blocks";
import { SurfaceSchema } from "../protocol/blocks";

export interface CockpitOptions {
  projectRoot: string;
  /** The role this transport carries. Decided by the transport, never the caller. */
  role: Role;
}

export class Cockpit {
  readonly db: CockpitDb;
  readonly projectRoot: string;
  readonly role: Role;
  private workspace: WorkspaceState;
  private env: world.WorldEnv;

  constructor(options: CockpitOptions) {
    this.projectRoot = options.projectRoot.replace(/\/$/, "");
    this.role = options.role;
    this.db = new CockpitDb(this.projectRoot);
    this.env = world.openWorld(this.projectRoot);
    const persisted = this.db.getUiState("workspace");
    this.workspace = persisted ? (JSON.parse(persisted) as WorkspaceState) : initialWorkspace();
    this.rebuild();
  }

  /** Rebuild the disposable projection from canonical files. Truth unchanged. */
  rebuild(): void {
    const workRows = this.db.listWorkRequests().map((r) => ({
      seq: r.seq,
      text: r.text,
      kind: r.kind,
      status: r.status,
      actor: r.actor,
    }));
    const { rows, searchRows } = projectCockpitState(this.projectRoot, { workRequests: workRows });
    this.db.replaceProjection(rows, searchRows);
    this.workspace.work = this.db.listWorkRequests().map((r) => ({
      seq: r.seq,
      text: r.text,
      kind: r.kind,
      status: r.status as RequestStatus,
      actor: r.actor,
      refs: JSON.parse(r.refs) as string[],
      history: JSON.parse(r.history),
    }));
  }

  private persist(): void {
    this.db.setUiState("workspace", JSON.stringify(this.workspace));
  }

  get state(): WorkspaceState {
    return this.workspace;
  }

  private agentGuard(op: string): CockpitResult | null {
    // Transport-decided authority: this instance carries `this.role`. A
    // human-authority op attempted through an agent transport is refused here
    // AND the reducer would refuse it again (defence in depth).
    if (this.role === "agent" && op.startsWith("human.")) {
      return { ok: false, code: "AUTHORITY_HUMAN", message: `op '${op}' carries the owner's authority; the agent transport cannot send it` };
    }
    return null;
  }

  /** Apply an action. The role comes from the transport that authenticated
   * the request — a caller may pass it explicitly (the server does), and it
   * can never exceed the transport's own authority. */
  action(raw: unknown, roleOverride?: Role): CockpitResult {
    const role = roleOverride ?? this.role;
    const op = (raw as { op?: string }).op ?? "";
    if (role === "agent" && op.startsWith("human.")) {
      const refusal: CockpitResult = { ok: false, code: "AUTHORITY_HUMAN", message: `op '${op}' carries the owner's authority; the agent transport cannot send it` };
      this.db.appendInteraction(role, op, { rejected: refusal.message });
      return refusal;
    }
    // Owner work review/cancellation moves through the lifecycle with human
    // authority (REQ-COCKPIT-008): accept, or reject → blocked with the reason.
    if (role === "human" && op === "human.work-review") {
      const args = (raw as { args?: Record<string, unknown> }).args ?? {};
      const seq = Number(args.seq);
      const accepted = Boolean(args.accepted);
      if (!Number.isInteger(seq)) return { ok: false, code: "SCHEMA", message: "human.work-review requires a work request seq" };
      const note = args.note ? String(args.note) : accepted ? undefined : "rejected by the owner";
      return this.workMove(seq, accepted ? "accepted" : "blocked", note, "human");
    }
    if (role === "human" && op === "human.work-cancel") {
      const args = (raw as { args?: Record<string, unknown> }).args ?? {};
      const seq = Number(args.seq);
      if (!Number.isInteger(seq)) return { ok: false, code: "SCHEMA", message: "human.work-cancel requires a work request seq" };
      return this.workMove(seq, "cancelled", args.note ? String(args.note) : undefined, "human");
    }
    const { next, result } =
      role === "agent" && !op.startsWith("human.") ? applyAgent(this.workspace, raw) : applyHuman(this.workspace, raw);
    this.db.appendInteraction(role, op, { ok: result.ok, code: result.ok ? undefined : result.code });
    if (result.ok) {
      this.workspace = next;
      this.persist();
    }
    return result;
  }

  /** Submit a work request (owner intent, routed by the executor). */
  workSubmit(text: string, kind = "unclassified"): { ok: true; seq: number } | CockpitResult {
    const { next, result, seq } = workInsert(this.workspace, text, kind);
    if (!result.ok) return result;
    this.workspace = next;
    this.db.insertWorkRequest(text, kind, "owner", []);
    this.persist();
    return { ok: true, seq };
  }

  /** Move a work request. Authority: the transport's role. Self-acceptance impossible. */
  workMove(seq: number, to: RequestStatus, note?: string, roleOverride?: Role): CockpitResult {
    const role = roleOverride ?? this.role;
    const { next, result } = workMove(this.workspace, seq, to, role, note);
    this.db.appendInteraction(role, `work.${seq}.${to}`, { ok: result.ok, code: result.ok ? undefined : (result as { code?: string }).code });
    if (result.ok) {
      this.workspace = next;
      this.db.updateWorkRequest(seq, { status: to, ...(note ? { note } : {}), historyStep: { status: to, by: role, note } });
      this.persist();
      this.rebuild();
    }
    return result;
  }

  // ── read/write tool implementations (one per semantic tool) ──

  private resolveSource(source: string): { kind: string; rows: Record<string, unknown>[] } | CockpitResult {
    const projection = projectCockpitState(this.projectRoot, {
      workRequests: this.db.listWorkRequests().map((r) => ({ seq: r.seq, text: r.text, status: r.status, kind: r.kind })),
    });
    const [root, rest] = source.split(/:(?=.)/);
    const key = `${root}:`;
    void key;
    const rootName = root;
    const selector = (rest ?? "").split("?")[0];
    const matchRows = (kindPrefix: string) => {
      const found = projection.rows.filter((r) => r.kind === kindPrefix || r.kind.startsWith(kindPrefix));
      return found.map((r) => JSON.parse(r.data) as Record<string, unknown>);
    };
    switch (rootName) {
      case "gm":
        if (selector === "decisions") return { kind: "gm:decision", rows: matchRows("gm:decision") };
        if (selector === "unknowns") return { kind: "gm:unknown", rows: matchRows("gm:unknown") };
        if (selector === "contradictions") return { kind: "gm:contradiction", rows: matchRows("gm:contradiction") };
        if (selector === "north-star") return { kind: "gm:north-star", rows: matchRows("gm:north-star") };
        if (selector === "entities") return { kind: "gm:entity", rows: matchRows("gm:entity") };
        if (selector === "scenarios") return { kind: "gm:scenario", rows: matchRows("gm:scenario") };
        return { kind: "gm:model", rows: matchRows("gm:model") };
      case "case":
        return { kind: "case:state", rows: matchRows("case:state") };
      case "release":
        return { kind: "release:target", rows: matchRows("release:target") };
      case "quality":
        return { kind: "quality:criterion", rows: matchRows("quality:criterion") };
      case "resources":
        return { kind: "resources:asset", rows: matchRows("resources:asset") };
      case "reservoir":
        return { kind: "reservoir:record", rows: matchRows("reservoir:record") };
      case "work":
        return { kind: "work:request", rows: matchRows("work:request") };
      case "affordances":
        return { kind: "gm:scenario", rows: matchRows("gm:scenario") };
      case "evidence":
        return { kind: "resources:evidence", rows: [] };
      case "recipes":
        return { kind: "recipes:record", rows: [] };
      case "graph":
        return { kind: "case:state", rows: matchRows("case:state") };
      case "file": {
        const target = join(this.projectRoot, selector);
        if (!target.startsWith(this.projectRoot)) return { ok: false, code: "BAD_SOURCE", message: "file sources must stay inside the project" };
        if (!require("node:fs").existsSync(target)) return { ok: false, code: "NOT_FOUND", message: `file '${selector}' not found` };
        const text = require("node:fs").readFileSync(target, "utf8");
        return { kind: "file", rows: [{ path: selector, lines: text.split("\n").slice(0, 400) }] };
      }
      default:
        return { ok: false, code: "BAD_SOURCE", message: `unknown source root '${rootName}'` };
    }
  }

  private readSource(source: string): unknown {
    const resolved = this.resolveSource(source);
    if ("ok" in resolved && resolved.ok === false) return resolved;
    return resolved as { kind: string; rows: Record<string, unknown>[] };
  }

  tool(name: string, input: unknown): { ok: boolean; result?: unknown; error?: { code: string; message: string } } {
    if (!TOOL_NAMES.has(name)) {
      return { ok: false, error: { code: "UNKNOWN_TOOL", message: `unknown tool '${name}'` } };
    }
    const def = TOOLS.find((t) => t.name === name)!;
    const parsed = (def as ToolDef).input.safeParse(input ?? {});
    if (!parsed.success) {
      return {
        ok: false,
        error: { code: "SCHEMA", message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).slice(0, 6).join("; ") },
      };
    }
    const args = parsed.data as Record<string, unknown>;
    const compose = (result: { ok: boolean; result?: unknown; error?: { code: string; message: string } }) => result;

    try {
      switch (name) {
        case "get_status": {
          const projection = projectCockpitState(this.projectRoot);
          return compose({ ok: true, result: { role: this.role, model_version: this.env.model.modelVersion, screen_mode: this.workspace.screenMode, surfaces: this.workspace.surfaces.length, pending_work: this.workspace.work.filter((w) => !["accepted", "cancelled", "failed"].includes(w.status)).length, projection_kinds: [...new Set(projection.rows.map((r) => r.kind))], rail: "release-rail (system-owned)" } });
        }
        case "get_workspace": {
          const surfaces = this.workspace.surfaces.map((s) => ({
            id: s.id,
            title: s.title,
            pinned: s.pinned,
            placed_by: s.placedBy,
            blocks: s.blocks.map((b) => (b as { type: string }).type),
          }));
          return compose({ ok: true, result: { focused: this.workspace.focused, screen_mode: this.workspace.screenMode, surfaces } });
        }
        case "get_vocabulary": {
          const blocks = require("../protocol/blocks") as { BLOCK_TYPES: string[] };
          return compose({ ok: true, result: { block_types: blocks.BLOCK_TYPES, source_roots: ["gm:", "case:", "release:", "quality:", "resources:", "reservoir:", "recipes:", "affordances:", "evidence:", "work:", "graph:", "file:"], authority: ["agents compose data, never UI code", "release rail is system-owned", "pinned surfaces are immune", "inline data is badged agent-supplied"] } });
        }
        case "list_items": {
          const projection = projectCockpitState(this.projectRoot);
          const rows = projection.rows.filter((r) => r.kind === args.kind).slice(0, Number(args.limit ?? 50));
          return compose({ ok: true, result: { kind: args.kind, count: rows.length, items: rows.map((r) => JSON.parse(r.data)) } });
        }
        case "get_entity": {
          const projection = projectCockpitState(this.projectRoot);
          const row = projection.rows.find((r) => r.kind === args.kind && r.id === args.id);
          if (!row) return compose({ ok: false, error: { code: "NOT_FOUND", message: `no '${args.kind}' entity '${args.id}'` } });
          return compose({ ok: true, result: JSON.parse(row.data) });
        }
        case "show_surface": {
          const surface = SurfaceSchema.safeParse(args.surface);
          if (!surface.success) {
            return compose({ ok: false, error: { code: "SCHEMA", message: surface.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).slice(0, 6).join("; ") } });
          }
          const result = this.action({ op: "surface.put", args: { surface: args.surface } });
          return compose(result.ok ? { ok: true, result: { surface: surface.data.id, rev: result.rev, effects: result.effects, warnings: result.warnings } } : { ok: false, error: { code: result.code, message: result.message } });
        }
        case "show_ref": {
          const surface = {
            id: `ref-${String(args.ref).replace(/[^a-z0-9-]/g, "-").slice(0, 40)}`,
            title: String(args.title ?? args.ref).slice(0, 60),
            intent: "inspect",
            layout: "stack",
            blocks: [{ type: "document", id: "doc", source: String(args.ref).includes(":") ? String(args.ref) : `gm:model`, title: String(args.ref).slice(0, 80) }],
          };
          const result = this.action({ op: "surface.put", args: { surface } });
          return compose(result.ok ? { ok: true, result: { surface: surface.id } } : { ok: false, error: { code: result.code, message: result.message } });
        }
        case "compare_refs": {
          const surface = {
            id: `compare-${Date.now().toString(36)}`,
            title: String(args.title ?? "compare"),
            intent: "compare",
            layout: "stack",
            blocks: [{ type: "compare", id: "cmp", mode: args.mode ?? "diff", items: (args.refs as string[]).map((r) => ({ label: r, source: r.includes(":") ? r : "gm:model" })) }],
          };
          const result = this.action({ op: "surface.put", args: { surface } });
          return compose(result.ok ? { ok: true, result: { surface: surface.id } } : { ok: false, error: { code: result.code, message: result.message } });
        }
        case "ask_human": {
          const surface = { id: `needs-input-${Date.now().toString(36)}`, title: "Needs your input", intent: "decide", layout: "stack", blocks: [{ type: "ask", id: "ask", asks: [args.ask] }] };
          const result = this.action({ op: "surface.put", args: { surface } });
          return compose(result.ok ? { ok: true, result: { surface: surface.id, note: "you cannot answer it; read the answer with read_responses" } } : { ok: false, error: { code: result.code, message: result.message } });
        }
        case "arrange": {
          const result = this.action({ op: args.op as string, args: { surface: args.surface, ...(args.args as object) } });
          return compose(result);
        }
        case "annotate": {
          const result = this.action({ op: "note.add", args: { surface: args.surface, text: args.text } });
          return compose(result);
        }
        case "read_responses":
          return compose({ ok: true, result: { answers: this.workspace.answers, notes: this.workspace.notes.slice(-20) } });
        case "get_game_case": {
          const row = world.gameCaseFor(this.projectRoot);
          return compose({ ok: true, result: row ? JSON.parse(row.data) : { ok: false, error: "case derivation unavailable" } });
        }
        case "get_quality_bar":
          return compose({ ok: true, result: world.derivedViews(this.env).quality });
        case "get_release_matrix":
          return compose({ ok: true, result: world.derivedViews(this.env).release });
        case "get_resources": {
          const scout = resourceScout(this.projectRoot, { id: args.id as string | undefined, kind: args.kind as string | undefined });
          return compose({ ok: true, result: scout });
        }
        case "game_why":
          return compose({ ok: true, result: world.why(this.env, args.ref as string) });
        case "game_impact":
          return compose({ ok: true, result: world.impact(this.env, args.ref as string, { dir: args.dir as "down" | "up" | "both", depth: args.depth as number }) });
        case "game_diff":
          return compose({ ok: true, result: world.diff(this.env, args.a as number, args.b as number) });
        case "game_timeline":
          return compose({ ok: true, result: world.timeline(this.env) });
        case "game_counterfactual":
          return compose({ ok: true, result: world.counterfactual(this.env, { touched: args.touched as string[], summary: args.summary as string }) });
        case "resource_reach":
          return compose({ ok: true, result: world.resourceReach(this.env, { id: args.id as string | undefined, kind: args.kind as string | undefined }) });
        case "game_replay":
          return compose({ ok: true, result: world.replay(this.env, args.expectation as string) });
        case "workbench": {
          if (args.mode) {
            this.workspace.screenMode = args.mode as string;
            this.persist();
          }
          const row = world.gameCaseFor(this.projectRoot);
          return compose({ ok: true, result: { mode: this.workspace.screenMode, game_case: row ? JSON.parse(row.data) : null } });
        }
                case "work_get":
          return compose({ ok: true, result: { requests: this.workspace.work.map((w) => ({ seq: w.seq, text: w.text, status: w.status, kind: w.kind, history: w.history.slice(-5) })) } });
        case "work_submit": {
          const submitted = this.workSubmit(String(args.text ?? ""), String(args.kind ?? "unclassified"));
          return compose("seq" in submitted ? { ok: true, result: { seq: submitted.seq, status: "queued", note: "queued for the executor; the owner reviews and accepts" } } : submitted);
        }
        case "work_update": {
          const result = this.workMove(args.id as number, args.status as RequestStatus, args.note as string | undefined);
          return compose(result);
        }
        default:
          return compose({ ok: false, error: { code: "UNKNOWN_TOOL", message: `tool '${name}' has no implementation` } });
      }
    } catch (caught) {
      return { ok: false, error: { code: "TOOL_ERROR", message: String(caught).slice(0, 400) } };
    }
  }

  /** Tools actively advertised for the current context (REQ-MCP-002). */
  activeTools(): string[] {
    return activeTools({ focus: this.workspace.focused ?? undefined, screenMode: this.workspace.screenMode, pendingWork: this.workspace.work.some((w) => w.status === "queued") });
  }

  close(): void {
    this.db.close();
  }
}

/** Resource Scout data (REQ-COCKPIT-011): derived from the real machinery. */
export function resourceScout(projectRoot: string, need: { id?: string; kind?: string } = {}): Record<string, unknown> {
  const fs = require("node:fs");
  const project: Record<string, unknown>[] = [];
  const manifestPath = join(projectRoot, "assets", "manifest.json");
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      for (const record of manifest.records ?? []) {
        if (need.id && record.id !== need.id) continue;
        project.push({ id: record.id, role: record.role, acceptance_state: record.acceptance_state, origin: record.origin, route: "R0 accepted project resource" });
      }
    } catch {
      /* manifest unreadable: no project candidates claimed */
    }
  }
  const reservoir: Record<string, unknown>[] = [];
  try {
    const store = ReservoirStore.resolveFor(projectRoot);
    for (const record of store.records()) {
      if (need.id && record.id !== need.id) continue;
      reservoir.push({ id: record.id, kind: record.kind, accepted: record.accepted, license: record.source.license, derived_from: record.derived_from, route: "R1 reservoir" });
    }
  } catch {
    /* no reservoir */
  }
  const gaps: Record<string, unknown>[] = [];
  const resolutionsDir = join(projectRoot, ".studio", "resolutions");
  if (fs.existsSync(resolutionsDir)) {
    for (const file of fs.readdirSync(resolutionsDir).filter((f: string) => f.startsWith("resource-") && f.endsWith(".json")).slice(-10)) {
      try {
        const record = JSON.parse(fs.readFileSync(join(resolutionsDir, file), "utf8"));
        if (record.decision !== "resolved") {
          gaps.push({ requested_id: record.requested_id, kind: record.kind, status_code: record.status_code, rationale: record.rationale });
        }
      } catch {
        /* skip unreadable */
      }
    }
  }
  const exceptions = listCreationExceptionsSafe(projectRoot);
  return {
    need,
    project_candidates: project,
    reservoir_candidates: reservoir,
    unresolved_gaps: gaps,
    creation_exceptions: exceptions,
    note: "derived from the real resource-resolution machinery; candidates are possibilities, not accepted assets",
  };
}

function listCreationExceptionsSafe(projectRoot: string): Record<string, unknown>[] {
  try {
    return listCreationExceptions(projectRoot) as unknown as Record<string, unknown>[];
  } catch {
    return [];
  }
}
