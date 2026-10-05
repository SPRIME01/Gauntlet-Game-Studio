/**
 * The single semantic tool registry (REQ-MCP-001, spec v0.5.0).
 *
 * One definition per tool — name, description, Zod input schema, effect
 * (read/compose), untrusted flag — feeds the CLI, the loopback MCP endpoint,
 * and WebMCP. No manually divergent per-transport APIs exist. Implementations
 * live in core.ts; this file is the contract surface.
 */

import { z } from "zod";

export interface ToolDef {
  name: string;
  description: string;
  input: z.ZodType;
  effect: "read" | "compose";
  untrusted?: boolean;
}

const SourceRef = z.string().max(300);

const SurfaceArg = z.object({ surface: z.record(z.string(), z.unknown()) }).loose();

const BASE_TOOLS: ToolDef[] = [
  {
    name: "get_status",
    description: "Cockpit and project status: connection, model version, screen mode, surface count, pending work, release state summary.",
    input: z.object({}).strict(),
    effect: "read",
  },
  {
    name: "get_workspace",
    description: "The current workspace: open surfaces with their block ids, focus, pins, and screen mode. Read-only.",
    input: z.object({}).strict(),
    effect: "read",
  },
  {
    name: "get_vocabulary",
    description: "The cockpit's fixed vocabulary: block types with use/avoid, source roots, and the authority rules. Compose surfaces only from this vocabulary.",
    input: z.object({ block: z.string().max(40).optional() }).strict(),
    effect: "read",
  },
  {
    name: "list_items",
    description: "List projected entities of a kind (e.g. resources:asset, gm:unknown, quality:criterion, release:target, gm:decision). Read-only over the disposable projection.",
    input: z.object({ kind: z.string().min(3).max(60), query: z.string().max(120).optional(), limit: z.number().int().min(1).max(200).default(50) }).strict(),
    effect: "read",
    untrusted: true,
  },
  {
    name: "get_entity",
    description: "One projected entity by kind and id. Read-only.",
    input: z.object({ kind: z.string().min(3).max(60), id: z.string().min(1).max(160) }).strict(),
    effect: "read",
    untrusted: true,
  },
  {
    name: "show_surface",
    description: "Compose and open a surface from the fixed block vocabulary. Data must be source-bound (gm:, case:, release:, quality:, resources:, reservoir:, recipes:, affordances:, evidence:, work:, graph:, file:); inline rows are marked agent-supplied. You cannot write UI code and cannot touch the release rail.",
    input: z.object({ surface: z.record(z.string(), z.unknown()), placement: z.record(z.string(), z.unknown()).optional() }).strict(),
    effect: "compose",
  },
  {
    name: "show_ref",
    description: "Open a one-document surface for a ref (entity/asset/decision/file). Read-only composition.",
    input: z.object({ ref: SourceRef, title: z.string().max(60).optional() }).strict(),
    effect: "compose",
  },
  {
    name: "compare_refs",
    description: "Compose a compare surface (diff/side/overlay/matrix) for 2-4 refs or sources.",
    input: z.object({ refs: z.array(SourceRef).min(2).max(4), mode: z.enum(["diff", "side", "overlay", "matrix"]).default("diff"), title: z.string().max(60).optional() }).strict(),
    effect: "compose",
  },
  {
    name: "ask_human",
    description: "Compose a one-ask surface titled 'Needs your input'. You cannot answer it: read the answer with read_responses.",
    input: z.object({ ask: z.record(z.string(), z.unknown()) }).strict(),
    effect: "compose",
  },
  {
    name: "arrange",
    description: "Patch workspace layout within authority: focus, size on agent-owned surfaces. Owner-placed and pinned surfaces are immune.",
    input: z.object({ op: z.enum(["view.focus", "view.place", "view.size"]), surface: z.string().max(60), args: z.record(z.string(), z.unknown()).default({}) }).strict(),
    effect: "compose",
  },
  {
    name: "annotate",
    description: "Add a note to a surface (agent context, visibly agent-authored).",
    input: z.object({ surface: z.string().max(60), text: z.string().min(1).max(2000) }).strict(),
    effect: "compose",
  },
  {
    name: "read_responses",
    description: "Read recorded owner answers and notes. Routing them through the process is your job; the cockpit never applies them to canonical truth.",
    input: z.object({}).strict(),
    effect: "read",
    untrusted: true,
  },
];

const GAME_TOOLS: ToolDef[] = [
  {
    name: "get_game_case",
    description: "The derived, read-only Game Case: destination, current, material deviation, primary move (guidance, not authority), why, cost, authority, recovery, expected evidence, alternatives, blocked moves, settlement reachability. Stored nowhere.",
    input: z.object({}).strict(),
    effect: "read",
    untrusted: true,
  },
  {
    name: "get_quality_bar",
    description: "The model-declared quality bar evaluated to pass/attention/fail/unknown/not-applicable with linked evidence. No numeric score exists.",
    input: z.object({}).strict(),
    effect: "read",
    untrusted: true,
  },
  {
    name: "get_release_matrix",
    description: "The derived target-by-target release matrix. Each target settles independently; one target passing never settles another.",
    input: z.object({}).strict(),
    effect: "read",
    untrusted: true,
  },
  {
    name: "get_resources",
    description: "Resource state for a gap: project records, reservoir records, blocked resolution records, and creation exceptions — the Resource Scout projection.",
    input: z.object({ id: z.string().max(160).optional(), kind: z.string().max(40).optional() }).strict(),
    effect: "read",
    untrusted: true,
  },
];

const WORLD_TOOLS: ToolDef[] = [
  {
    name: "game_why",
    description: "What a thing is, where it came from (source/license/decisions), adaptations, what uses it, what contradicts it. Answers say recorded/derived/unavailable. Read-only.",
    input: z.object({ ref: SourceRef }).strict(),
    effect: "read",
    untrusted: true,
  },
  {
    name: "game_impact",
    description: "Recorded dependency paths: what depends on this (down), what it depends on (up), or both, with staleness marked. Read-only.",
    input: z.object({ ref: SourceRef, dir: z.enum(["down", "up", "both"]).default("down"), depth: z.number().int().min(1).max(6).default(2) }).strict(),
    effect: "read",
    untrusted: true,
  },
  {
    name: "game_diff",
    description: "Compare two Game Model versions through the decision ledger. Read-only.",
    input: z.object({ a: z.number().int().nonnegative(), b: z.number().int().nonnegative() }).strict(),
    effect: "read",
    untrusted: true,
  },
  {
    name: "game_timeline",
    description: "The settled evolution the record supports: model versions and decisions. Read-only.",
    input: z.object({}).strict(),
    effect: "read",
    untrusted: true,
  },
  {
    name: "game_counterfactual",
    description: "Preview a candidate model change without applying it: known/derived/expected/unknown effects, authority: possibility. Read-only.",
    input: z.object({ touched: z.array(z.string().max(120)).min(1).max(32), summary: z.string().min(1).max(400) }).strict(),
    effect: "read",
  },
  {
    name: "resource_reach",
    description: "Resolve a missing resource/observation to the cascade: project, reservoir, external providers, scratch exception state. Nothing is contacted or run. Read-only.",
    input: z.object({ id: z.string().max(160).optional(), kind: z.string().max(40).optional() }).strict(),
    effect: "read",
    untrusted: true,
  },
  {
    name: "game_replay",
    description: "Re-evaluate declared expectations over recorded evidence. Always settles:false; settlement is a separate evidence-gated act. Read-only.",
    input: z.object({ expectation: z.string().min(1).max(160) }).strict(),
    effect: "read",
    untrusted: true,
  },
];

const WORK_TOOLS: ToolDef[] = [
  {
    name: "workbench",
    description: "The deterministic workbench screen (orient/decide/build/verify/release) as a pure function of project + cockpit state. Mode changes update content in place.",
    input: z.object({ mode: z.enum(["orient", "decide", "build", "verify", "release"]).optional() }).strict(),
    effect: "read",
    untrusted: true,
  },
  {
    name: "work_get",
    description: "Work requests and their lifecycle state. The executor cannot accept or cancel: that is the owner's.",
    input: z.object({}).strict(),
    effect: "read",
    untrusted: true,
  },
  {
    name: "work_submit",
    description: "Queue a typed work request on the owner's behalf. The executor acknowledges and works it; the owner reviews and accepts. You cannot accept your own work.",
    input: z.object({ text: z.string().min(1).max(2000), kind: z.enum(["capability", "steer", "split", "rebuild", "unclassified"]).default("unclassified") }).strict(),
    effect: "compose",
  },
  {
    name: "work_update",
    description: "Report work-request lifecycle progress (acknowledged/running/produced/ready_for_review/blocked/failed). You cannot reach accepted or cancelled — the cockpit refuses it.",
    input: z.object({ id: z.number().int().positive(), status: z.enum(["acknowledged", "running", "produced", "ready_for_review", "blocked", "failed"]), note: z.string().max(600).optional() }).strict(),
    effect: "compose",
  },
];

export const TOOLS: ToolDef[] = [...BASE_TOOLS, ...GAME_TOOLS, ...WORLD_TOOLS, ...WORK_TOOLS];
export const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));

/**
 * Dynamically advertise tools by context (REQ-MCP-002). Base set always on;
 * context-gated tools withdraw when their context closes. Offering is
 * discovery, not authorization: every tool stays executable via the registry.
 */
export function activeTools(ctx: { focus?: string; screenMode?: string; pendingWork?: boolean } = {}): string[] {
  const base = BASE_TOOLS.map((t) => t.name);
  const active = new Set<string>(base);
  active.add("get_game_case");
  active.add("get_quality_bar");
  active.add("get_release_matrix");
  active.add("workbench");
  active.add("work_get");
  const focus = ctx.focus ?? "";
  if (focus.startsWith("resources:") || focus.startsWith("reservoir:")) {
    active.add("get_resources");
    active.add("game_why");
    active.add("game_impact");
    active.add("resource_reach");
  }
  if (focus.startsWith("gm:decision") || focus.startsWith("evidence:")) {
    active.add("game_diff");
    active.add("game_timeline");
  }
  if (focus.startsWith("gm:unknown") || ctx.screenMode === "decide") {
    active.add("game_counterfactual");
    active.add("resource_reach");
  }
  if (focus.startsWith("evidence:")) {
    active.add("game_replay");
    active.add("game_why");
  }
  if (ctx.pendingWork) active.add("work_update");
  return TOOLS.filter((t) => active.has(t.name)).map((t) => t.name);
}

/** JSON-schema projection for MCP/WebMCP transport framing. */
export function toolSchemas(names?: string[]): { name: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean } }[] {
  const list = names ? TOOLS.filter((t) => names.includes(t.name)) : TOOLS;
  return list.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: z.toJSONSchema(t.input, { unrepresentable: "any", io: "input" }),
    annotations: { readOnlyHint: t.effect === "read", untrustedContentHint: Boolean(t.untrusted) },
  }));
}
