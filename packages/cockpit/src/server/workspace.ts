/**
 * Pure cockpit workspace reducer (REQ-COCKPIT-004, spec v0.5.0).
 *
 * Authority is decided by the transport, never by caller claims: every apply
 * call carries the caller's role, and the reducer itself rejects
 * authority-carrying operations from the agent role — regardless of payload.
 * Owner layout precedence holds: pinned surfaces cannot be moved/removed by
 * agents; agent content updates replace content in place; closed surfaces stay
 * closed until the owner reopens them. The release rail is system-owned and
 * cannot be covered, removed, or edited by any agent surface.
 */

import {
  AgentActionSchema,
  HumanActionSchema,
  SurfaceSchema,
  PlacementSchema,
  AUTHORITY_OPS,
  type AgentAction,
  type HumanAction,
  type Surface,
  type Placement,
  type CockpitResult,
  type Role,
  type RequestStatus,
  TRANSITIONS,
  TERMINAL_STATUSES,
} from "../protocol/blocks";

export interface WorkRequestState {
  seq: number;
  text: string;
  kind: string;
  status: RequestStatus;
  actor: string;
  refs: string[];
  history: { ts: string; status: string; by: string; note?: string }[];
}

export interface WorkspaceState {
  rev: number;
  surfaces: (Surface & { placedBy: Role; pinned: boolean; minimized: boolean })[];
  placementOrder: string[];
  /** Surfaces the owner closed. Agent surface.put on these ids is refused
   * until the owner reopens them (REQ-COCKPIT-004: closed stays closed). */
  closedByOwner: string[];
  /** Real placement records for agent/human place ops (not fabricated effects). */
  placements: Record<string, { rel: string; to: string; size?: number }>;
  focused: string | null;
  notes: { surface: string; text: string; at: string }[];
  answers: { surface: string; ask: string; outcome: string; value?: unknown; at: string; actor: Role }[];
  work: WorkRequestState[];
  screenMode: string;
}

export function initialWorkspace(): WorkspaceState {
  return {
    rev: 0,
    surfaces: [],
    placementOrder: [],
    closedByOwner: [],
    placements: {},
    focused: null,
    notes: [],
    answers: [],
    work: [],
    screenMode: "orient",
  };
}

const MAX_SURFACES = 8;

/** System-owned release rail: not a workspace surface, not addressable by any action. */
export const RELEASE_RAIL = "release-rail (system-owned): game · model version · phase · milestone · targets · quality profile · contradictions · unknowns · stale · blockers · owner input · next move · release verdict";

function ok(state: WorkspaceState, effects: string[], warnings?: string[]): CockpitResult {
  state.rev += 1;
  return { ok: true, rev: state.rev, effects, ...(warnings && warnings.length > 0 ? { warnings } : {}) };
}

function err(code: import("../protocol/blocks").ErrorCode, message: string): CockpitResult {
  return { ok: false, code, message };
}

/**
 * Apply an agent action. Pure: returns the next state plus a result; the
 * caller persists. The agent may compose surfaces with data, focus, place
 * (respecting owner precedence), add notes, and withdraw its own asks —
 * nothing else.
 */
export function applyAgent(state: WorkspaceState, raw: unknown): { next: WorkspaceState; result: CockpitResult } {
  const next = structuredClone(state);
  const parsed = AgentActionSchema.safeParse(raw);
  if (!parsed.success) {
    return { next: state, result: err("SCHEMA", `invalid agent action: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).slice(0, 4).join("; ")}`) };
  }
  const action: AgentAction = parsed.data;

  if (action.op === "surface.put") {
    const surface = SurfaceSchema.safeParse(action.args.surface);
    if (!surface.success) {
      return { next: state, result: err("SCHEMA", `invalid surface: ${surface.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).slice(0, 4).join("; ")}`) };
    }
    const incoming = surface.data as Surface;
    if (next.closedByOwner.includes(incoming.id)) {
      return { next: state, result: err("AUTHORITY_LAYOUT", `surface '${incoming.id}' was closed by the owner and stays closed until the owner reopens it`) };
    }
    const existing = next.surfaces.find((s) => s.id === incoming.id);
    if (existing) {
      // In-place content replacement: never steals placement, never moves it.
      existing.title = incoming.title;
      existing.summary = incoming.summary;
      existing.intent = incoming.intent;
      existing.layout = incoming.layout;
      existing.blocks = incoming.blocks;
      return { next, result: ok(next, [`surface.${incoming.id}.content-replaced-in-place`], ["placement preserved"]) };
    }
    if (next.surfaces.length >= MAX_SURFACES) {
      // Evict the least-recently focused unpinned surface; pinned never evicted.
      const evictable = next.surfaces.filter((s) => !s.pinned && s.id !== next.focused).sort((a, b) => next.placementOrder.indexOf(a.id) - next.placementOrder.indexOf(b.id));
      if (evictable.length === 0) {
        return { next: state, result: err("CLUTTER_CAP", `surface cap (${MAX_SURFACES}) reached and every surface is pinned or focused`) };
      }
      const victim = evictable[0];
      next.surfaces = next.surfaces.filter((s) => s.id !== victim.id);
      next.placementOrder = next.placementOrder.filter((id) => id !== victim.id);
      const result = ok(next, [`surface.${victim.id}.evicted`, `surface.${incoming.id}.opened`], ["eviction is reversible via surface.put"]);
      insertSurface(next, incoming);
      return { next, result };
    }
    insertSurface(next, incoming);
    return { next, result: ok(next, [`surface.${incoming.id}.opened`]) };
  }

  if (action.op === "surface.patch") {
    const surfaceId = action.args.surface as string;
    const existing = next.surfaces.find((s) => s.id === surfaceId);
    if (!existing) return { next: state, result: err("NOT_FOUND", `surface '${surfaceId}' does not exist`) };
    if (action.args.title !== undefined) existing.title = String(action.args.title).slice(0, 60);
    if (action.args.summary !== undefined) existing.summary = String(action.args.summary).slice(0, 240);
    return { next, result: ok(next, [`surface.${surfaceId}.patched`]) };
  }

  if (action.op === "surface.remove") {
    const surfaceId = action.args.surface as string;
    const existing = next.surfaces.find((s) => s.id === surfaceId);
    if (!existing) return { next: state, result: err("NOT_FOUND", `surface '${surfaceId}' does not exist`) };
    if (existing.pinned) return { next: state, result: err("AUTHORITY_PINNED", `surface '${surfaceId}' is pinned by the owner; agents cannot remove it`) };
    next.surfaces = next.surfaces.filter((s) => s.id !== surfaceId);
    next.placementOrder = next.placementOrder.filter((id) => id !== surfaceId);
    if (next.focused === surfaceId) next.focused = null;
    return { next, result: ok(next, [`surface.${surfaceId}.removed`]) };
  }

  if (action.op === "view.focus") {
    const surfaceId = action.args.surface as string | undefined;
    if (surfaceId !== undefined && !next.surfaces.some((s) => s.id === surfaceId)) {
      return { next: state, result: err("NOT_FOUND", `surface '${surfaceId}' does not exist`) };
    }
    next.focused = surfaceId ?? null;
    return { next, result: ok(next, [`focus.${surfaceId ?? "cleared"}`]) };
  }

  if (action.op === "view.place" || action.op === "view.size") {
    // Placement belongs to the owner. Agent placement applies only to its own
    // unpinned surfaces and never repositions owner-placed ones. Placement is
    // recorded for real (the workspace layout consumes it), never fabricated.
    const surfaceId = action.args.surface as string;
    const existing = next.surfaces.find((s) => s.id === surfaceId);
    if (!existing) return { next: state, result: err("NOT_FOUND", `surface '${surfaceId}' does not exist`) };
    if (existing.placedBy === "human") {
      return { next: state, result: err("AUTHORITY_LAYOUT", `surface '${surfaceId}' was placed by the owner; agents cannot reposition it`) };
    }
    const placement = PlacementSchema.safeParse(action.args.placement ?? {});
    if (action.op === "view.place" && !placement.success) {
      return { next: state, result: err("SCHEMA", `invalid placement: ${placement.error.issues[0]?.message ?? "unknown"}`) };
    }
    if (action.op === "view.place" && placement.success) {
      next.placements[surfaceId] = {
        rel: placement.data.rel,
        to: placement.data.to,
        ...(placement.data.size !== undefined ? { size: placement.data.size } : {}),
      };
      existing.placedBy = "agent";
    }
    return { next, result: ok(next, [`surface.${surfaceId}.${action.op === "view.place" ? "placed" : "sized"}`], ["owner-placed surfaces are immune"]) };
  }

  if (action.op === "note.add") {
    next.notes.push({ surface: String(action.args.surface ?? ""), text: String(action.args.text ?? "").slice(0, 2000), at: new Date().toISOString() });
    return { next, result: ok(next, ["note.added"]) };
  }

  if (action.op === "ask.withdraw") {
    return { next: state, result: err("NO_RESPONDER", "ask.withdraw applies only to open asks owned by the agent; none matched") };
  }

  return { next: state, result: err("UNKNOWN_OP", `unknown agent op '${(action as { op: string }).op}'`) };
}

function insertSurface(next: WorkspaceState, surface: Surface): void {
  next.surfaces.push({ ...surface, placedBy: "agent", pinned: false, minimized: false });
  next.placementOrder.push(surface.id);
  if (!next.focused) next.focused = surface.id;
}

/**
 * Apply a human action. Human ops arrive only on the human transport; the
 * server must never call this with role "agent".
 */
export function applyHuman(state: WorkspaceState, raw: unknown): { next: WorkspaceState; result: CockpitResult } {
  const next = structuredClone(state);
  const parsed = HumanActionSchema.safeParse(raw);
  if (!parsed.success) {
    return { next: state, result: err("SCHEMA", `invalid human action: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).slice(0, 4).join("; ")}`) };
  }
  const action: HumanAction = parsed.data;

  if (AUTHORITY_OPS.includes(action.op)) {
    // Authority ops become recorded answers/annotations for the router to
    // route; the cockpit itself never applies owner input to canonical truth.
    if (action.op === "human.answer") {
      next.answers.push({
        surface: String(action.args.surface ?? ""),
        ask: String(action.args.ask ?? ""),
        outcome: String(action.args.outcome ?? "answered"),
        value: action.args.value,
        at: new Date().toISOString(),
        actor: "human",
      });
      return { next, result: ok(next, ["answer.recorded"], ["the owner's answer is recorded; routing it through the process is the router's job"]) };
    }
    next.notes.push({ surface: String(action.args.surface ?? "owner"), text: String(action.args.text ?? action.args.note ?? ""), at: new Date().toISOString() });
    return { next, result: ok(next, ["owner-note.recorded"]) };
  }

  if (action.op === "human.pin") {
    const surface = next.surfaces.find((s) => s.id === action.args.surface);
    if (!surface) return { next: state, result: err("NOT_FOUND", "surface not found") };
    surface.pinned = Boolean(action.args.pinned ?? true);
    if (surface.pinned) surface.placedBy = "human";
    return { next, result: ok(next, [`surface.${surface.id}.${surface.pinned ? "pinned" : "unpinned"}`]) };
  }

  if (action.op === "human.close") {
    const surfaceId = String(action.args.surface ?? "");
    next.surfaces = next.surfaces.filter((s) => s.id !== surfaceId);
    next.placementOrder = next.placementOrder.filter((id) => id !== surfaceId);
    if (!next.closedByOwner.includes(surfaceId)) next.closedByOwner.push(surfaceId);
    return { next, result: ok(next, [`surface.${surfaceId}.closed`]) };
  }

  if (action.op === "human.open") {
    const surfaceId = String(action.args.surface ?? "");
    next.closedByOwner = next.closedByOwner.filter((id) => id !== surfaceId);
    return { next, result: ok(next, [`surface.${surfaceId}.reopened-by-owner`]) };
  }

  if (action.op === "human.layout") {
    const order = action.args.order;
    if (Array.isArray(order)) {
      next.placementOrder = (order as string[]).filter((id) => next.surfaces.some((s) => s.id === id));
      for (const id of next.placementOrder) {
        const surface = next.surfaces.find((s) => s.id === id);
        if (surface) surface.placedBy = "human";
      }
    }
    return { next, result: ok(next, ["layout.owner-updated"]) };
  }

  if (action.op === "human.layout-restore") {
    next.placements = {};
    next.placementOrder = next.surfaces.map((s) => s.id);
    return { next, result: ok(next, ["layout.restored-to-default"]) };
  }

  if (action.op === "human.size") {
    const surfaceId = String(action.args.surface ?? "");
    const size = Number(action.args.size);
    if (!Number.isFinite(size) || size <= 0 || size >= 1) {
      return { next: state, result: err("SCHEMA", "human.size requires a size fraction in (0,1)") };
    }
    next.placements[surfaceId] = { ...next.placements[surfaceId], rel: next.placements[surfaceId]?.rel ?? "within", to: next.placements[surfaceId]?.to ?? "active", size };
    return { next, result: ok(next, [`surface.${surfaceId}.sized`]) };
  }

  if (action.op === "human.select") {
    const surfaceId = String(action.args.surface ?? "");
    if (next.surfaces.some((s) => s.id === surfaceId)) next.focused = surfaceId;
    return { next, result: ok(next, [`focus.${surfaceId}`]) };
  }

  return { next: state, result: err("UNKNOWN_OP", `unknown human op '${(action as { op: string }).op}'`) };
}

/**
 * Move a work request through the lifecycle. `by` is the authority the caller
 * holds — decided by the transport. The very first check makes self-acceptance
 * structurally impossible: an agent can never reach accepted/cancelled,
 * whatever the request's state (REQ-COCKPIT-008).
 */
export function workMove(state: WorkspaceState, seq: number, to: RequestStatus, by: Role, note?: string): { next: WorkspaceState; result: CockpitResult } {
  const next = structuredClone(state);
  const request = next.work.find((w) => w.seq === seq);
  if (!request) return { next: state, result: err("NOT_FOUND", `work request '${seq}' does not exist`) };
  if (by === "agent" && (to === "accepted" || to === "cancelled")) {
    return { next: state, result: err("AUTHORITY_HUMAN", `work request '${seq}': '${to}' is the owner's authority; the executor cannot accept or cancel its own work`) };
  }
  if (TERMINAL_STATUSES.includes(request.status)) {
    return { next: state, result: err("SCHEMA", `work request '${seq}' is terminal (${request.status})`) };
  }
  const allowed = TRANSITIONS[request.status][to];
  if (!allowed || !allowed.includes(by)) {
    const legal = Object.entries(TRANSITIONS[request.status]).filter(([, roles]) => roles.includes(by)).map(([toState]) => toState);
    if (by === "agent" && legal.length === 0) {
      return { next: state, result: err("AUTHORITY_HUMAN", `work request '${seq}': '${to}' from '${request.status}' requires the owner`) };
    }
    return { next: state, result: err("SCHEMA", `work request '${seq}': '${request.status}' → '${to}' is not a legal ${by} transition (legal: ${legal.join(", ") || "none"})`) };
  }
  if (to === "ready_for_review" && !note && request.refs.length === 0) {
    return { next: state, result: err("SCHEMA", "ready_for_review requires a note or refs — something the owner can review") };
  }
  request.status = to;
  request.history.push({ ts: new Date().toISOString(), status: to, by, ...(note ? { note } : {}) });
  return { next, result: ok(next, [`work.${seq}.${to}`]) };
}

export function workInsert(state: WorkspaceState, text: string, kind: string): { next: WorkspaceState; result: CockpitResult; seq: number } {
  const next = structuredClone(state);
  const seq = (next.work.at(-1)?.seq ?? 0) + 1;
  next.work.push({ seq, text: text.slice(0, 2000), kind, status: "queued", actor: "owner", refs: [], history: [{ ts: new Date().toISOString(), status: "queued", by: "human" }] });
  const result = ok(next, [`work.${seq}.queued`]);
  return { next, result, seq };
}


