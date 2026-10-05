/**
 * The Game Cockpit's fixed vocabulary (REQ-COCKPIT-001, spec v0.5.0).
 *
 * Code owns this file; the agent composes it as data and never writes UI code.
 * Everything is Zod `.strict()`: an unknown property is an error, not a silent
 * no-op. The client renders from a closed registry — a type that is not here
 * cannot be drawn. Agent-supplied inline data is always rendered with an
 * "agent-supplied" mark: a surface cannot pass its own numbers off as process
 * state.
 *
 * Block vocabulary follows the architectural donor (Product Actualizer) with
 * one game-specific addition: `viewport` (REQ-COCKPIT-005).
 */

import { z } from "zod";

export const ToneSchema = z.enum(["neutral", "ok", "warning", "danger", "unknown"]);
export type Tone = z.infer<typeof ToneSchema>;

const id = () => z.string().regex(/^[a-z][a-z0-9._-]{0,47}$/);
const bounded = z.object({ source: z.string().max(300).optional() }).loose();

/** Source grammar: bounded roots over canonical state; `..` is rejected. */
export const SourceSchema = z
  .string()
  .max(300)
  .refine((s) => !s.includes(".."), "source paths cannot traverse up")
  .refine((s) => {
    const roots = [
      "gm:", "case:", "release:", "quality:", "resources:", "reservoir:", "recipes:",
      "affordances:", "evidence:", "work:", "graph:", "file:",
    ];
    return roots.some((r) => s.startsWith(r));
  }, "source must use a declared root (gm:, case:, release:, quality:, resources:, reservoir:, recipes:, affordances:, evidence:, work:, graph:, file:)");
export type Source = z.infer<typeof SourceSchema>;

export const ColumnSchema = z
  .object({
    field: z.string().min(1).max(60),
    label: z.string().max(60).optional(),
    kind: z.enum(["text", "number", "tone", "ref", "status", "duration"]).default("text"),
    unit: z.string().max(12).optional(),
  })
  .strict();

const DataRowSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));

const BoundSchema = z
  .object({
    source: SourceSchema.optional(),
    data: z.array(DataRowSchema).max(500).optional(),
    filter: z.array(z.string().max(120)).max(6).default([]),
    sort: z.string().max(60).optional(),
  })
  .strict()
  .refine((b) => (b.source === undefined) !== (b.data === undefined), "exactly one of source or data");

const ToneText = z.object({ tone: ToneSchema.optional() }).strict();

const MetricBlock = z
  .object({ type: z.literal("metric"), id: id(), label: z.string().min(1).max(60), value: z.union([z.string().max(120), z.number()]), unit: z.string().max(12).optional(), of: z.string().max(120).optional(), delta: z.string().max(30).optional(), tone: ToneSchema.optional() })
  .strict();

const CalloutBlock = z
  .object({ type: z.literal("callout"), id: id(), tone: z.enum(["note", "ok", "warning", "danger", "unknown"]), text: z.string().min(1).max(900), title: z.string().max(80).optional() })
  .strict();

const TableBlock = z
  .object({ type: z.literal("table"), id: id(), columns: z.array(ColumnSchema).min(1).max(10), group: z.string().max(40).optional(), title: z.string().max(80).optional(), limit: z.number().int().min(1).max(200).optional() })
  .strict()
  .extend(BoundSchema.shape);

const TreeBlock = z
  .object({ type: z.literal("tree"), id: id(), expand: z.number().int().min(0).max(6).default(1), title: z.string().max(80).optional() })
  .strict()
  .extend(BoundSchema.shape);

const TimelineBlock = z
  .object({ type: z.literal("timeline"), id: id(), lane: z.string().max(40).optional(), window: z.number().int().min(5).max(200).default(40), title: z.string().max(80).optional() })
  .strict()
  .extend(BoundSchema.shape);

const GraphNodeSchema = z.object({ id: z.string().min(1).max(60), label: z.string().max(80).optional(), tone: ToneSchema.optional() }).strict();
const GraphEdgeSchema = z.object({ from: z.string().min(1).max(60), to: z.string().min(1).max(60), label: z.string().max(60).optional(), tone: ToneSchema.optional() }).strict();

const GraphBlock = z
  .object({
    type: z.literal("graph"),
    id: id(),
    source: SourceSchema.optional(),
    nodes: z.array(GraphNodeSchema).max(120).optional(),
    edges: z.array(GraphEdgeSchema).max(300).default([]),
    direction: z.enum(["LR", "TB"]).default("LR"),
    title: z.string().max(80).optional(),
  })
  .strict()
  .refine((b) => (b.source === undefined) !== (b.nodes === undefined), "graph needs a source or inline nodes")
  .refine((b) => b.nodes === undefined || b.edges.every((e) => b.nodes!.some((n) => n.id === e.from) && b.nodes!.some((n) => n.id === e.to)), "edges must name existing nodes");

const ChartBlock = z
  .object({
    type: z.literal("chart"),
    id: id(),
    kind: z.enum(["bar", "line", "dot"]),
    x: z.string().max(40),
    series: z.array(z.object({ y: z.string().max(40), label: z.string().max(60).optional(), tone: ToneSchema.optional() }).strict()).min(1).max(4),
    threshold: z.object({ value: z.number(), label: z.string().max(60).optional(), tone: ToneSchema.optional() }).strict().optional(),
    unit: z.string().max(12).optional(),
    title: z.string().max(80).optional(),
  })
  .strict()
  .extend(BoundSchema.shape);

const CompareBlock = z
  .object({
    type: z.literal("compare"),
    id: id(),
    mode: z.enum(["diff", "side", "overlay", "matrix"]),
    items: z.array(z.object({ label: z.string().min(1).max(60), source: SourceSchema.optional(), data: z.array(DataRowSchema).max(200).optional() }).strict()).min(2).max(4),
    criteria: z.array(z.object({ name: z.string().min(1).max(60), cells: z.array(z.object({ text: z.string().max(200), tone: ToneSchema.optional() }).strict()) }).strict()).max(12).optional(),
    title: z.string().max(80).optional(),
  })
  .strict()
  .refine((b) => b.mode !== "matrix" || (b.criteria !== undefined && b.criteria.every((c) => c.cells.length === b.items.length)), "matrix criteria need one cell per item");

const MediaBlock = z
  .object({ type: z.literal("media"), id: id(), items: z.array(z.object({ label: z.string().min(1).max(80), src: z.string().min(1).max(300), alt: z.string().max(200).optional() }).strict()).min(1).max(12), title: z.string().max(80).optional() })
  .strict();

const DocumentBlock = z
  .object({ type: z.literal("document"), id: id(), source: SourceSchema, lines: z.tuple([z.number().int().min(1), z.number().int().min(1)]).optional(), anchor: z.string().max(60).optional(), title: z.string().max(80).optional() })
  .strict();

const EntityBlock = z
  .object({ type: z.literal("entity"), id: id(), ref: z.string().max(120).optional(), follow: id().optional(), show: z.array(z.enum(["sources", "grade", "touches", "consequence", "actions"])).max(5).default([]) })
  .strict()
  .refine((b) => (b.ref === undefined) !== (b.follow === undefined), "entity needs exactly one of ref or follow");

/** Preflight: a human-confirmed gate around a consequential action. */
const PreflightBlock = z
  .object({
    type: z.literal("preflight"),
    id: id(),
    action: z
      .object({
        class: z.enum(["reversible", "state-changing", "irreversible"]),
        target: z.string().min(1).max(200),
        currentState: z.string().min(1).max(400),
        expected: z.string().min(1).max(400),
        stopIf: z.string().min(1).max(400),
        action: z.string().min(1).max(400),
        observation: z.string().min(1).max(400),
        recovery: z.string().min(1).max(400),
      })
      .strict(),
    title: z.string().max(80).optional(),
  })
  .strict();

/** Progress is bound to live state; the agent cannot set a percentage. */
const ProgressBlock = z
  .object({ type: z.literal("progress"), id: id(), label: z.string().min(1).max(80), source: z.enum(["work", "recipes", "evidence"]) })
  .strict();

const AskSchema = z
  .object({
    id: id(),
    prompt: z.string().min(1).max(300),
    why: z.string().max(300).optional(),
    input: z.enum(["confirm", "select", "multiselect", "text", "multiline"]),
    options: z.array(z.object({ value: z.string().min(1).max(80), label: z.string().min(1).max(120), hint: z.string().max(200).optional(), consequence: z.string().max(200).optional() }).strict()).max(12).default([]),
    required: z.boolean().default(true),
    placeholder: z.string().max(120).optional(),
  })
  .strict()
  .refine((a) => (a.input === "select" || a.input === "multiselect") ? a.options.length >= 2 : a.options.length === 0, "select asks need >= 2 options; others take none");

const AskBlock = z.object({ type: z.literal("ask"), id: id(), asks: z.array(AskSchema).min(1).max(4) }).strict();
const FormBlock = z.object({ type: z.literal("form"), id: id(), title: z.string().max(80).optional(), asks: z.array(AskSchema).min(2).max(8) }).strict();

/**
 * Viewport (REQ-COCKPIT-005): the game-dominant block. Typed declarative
 * modes, source-bound; never arbitrary markup. Production mutation lockout is
 * respected by construction — the block carries read-only display intent.
 */
const ViewportBlock = z
  .object({
    type: z.literal("viewport"),
    id: id(),
    mode: z.enum(["live-game", "reference-runtime", "godot-web", "asset-preview", "scene-preview", "animation-preview", "scenario-replay", "captured-view"]),
    source: SourceSchema,
    scenario: z.string().max(120).optional(),
    asset_ref: z.string().max(200).optional(),
    target: z.string().max(60).optional(),
    title: z.string().max(80).optional(),
  })
  .strict();

export const BlockSchema = z.discriminatedUnion("type", [
  MetricBlock, CalloutBlock, TableBlock, TreeBlock, TimelineBlock, GraphBlock,
  ChartBlock, CompareBlock, MediaBlock, DocumentBlock, EntityBlock, PreflightBlock,
  ProgressBlock, AskBlock, FormBlock, ViewportBlock,
]);
export type Block = z.infer<typeof BlockSchema>;

export const BLOCK_TYPES = BlockSchema.options.map((o) => o.shape.type.value) as string[];
export type BlockType = (typeof BLOCK_TYPES)[number];

export const SurfaceIntentSchema = z.enum(["inspect", "compare", "decide", "verify", "monitor"]);
export const SurfaceSchema = z
  .object({
    id: id(),
    title: z.string().min(1).max(60),
    summary: z.string().max(240).optional(),
    intent: SurfaceIntentSchema.default("inspect"),
    layout: z.enum(["stack", "columns"]).default("stack"),
    blocks: z.array(BlockSchema).min(1).max(12),
  })
  .strict()
  .refine((s) => {
    const ids = s.blocks.map((b) => b.id);
    return new Set(ids).size === ids.length;
  }, "block ids must be unique within a surface")
  .refine((s) => {
    return s.blocks.every((b) => {
      if (b.type !== "entity" || b.follow === undefined) return true;
      return s.blocks.some((other) => other.id === b.follow && (other.type === "table" || other.type === "tree"));
    });
  }, "entity.follow must reference a table/tree block in the same surface");
export type Surface = z.infer<typeof SurfaceSchema>;

export const PlacementSchema = z
  .object({
    rel: z.enum(["within", "left", "right", "above", "below"]).default("within"),
    to: z.string().max(60).default("active"),
    size: z.number().min(0.15).max(0.85).optional(),
    focus: z.boolean().default(true),
  })
  .strict();
export type Placement = z.infer<typeof PlacementSchema>;

// ── Actions: agent ops, human ops, and the authority boundary ───────────────

export const AGENT_OPS = [
  "surface.put", "surface.patch", "surface.remove",
  "view.focus", "view.place", "view.size",
  "note.add", "ask.withdraw",
] as const;
export type AgentOp = (typeof AGENT_OPS)[number];

export const HUMAN_OPS = [
  "human.answer", "human.rule", "human.confirm", "human.annotate",
  "human.select", "human.layout", "human.pin", "human.close", "human.open",
  "human.size", "human.layout-restore", "human.work-review", "human.work-cancel",
] as const;
export type HumanOp = (typeof HUMAN_OPS)[number];

/**
 * Authority ops carry the owner's judgment. They are never accepted from an
 * agent role (REQ-COCKPIT-004): transport decides authority, not caller claims.
 */
export const AUTHORITY_OPS: readonly string[] = ["human.answer", "human.rule", "human.confirm", "human.annotate"];

export const AgentActionSchema = z.object({ op: z.enum(AGENT_OPS), args: z.record(z.string(), z.unknown()).default({}) }).strict();
export const HumanActionSchema = z.object({ op: z.enum(HUMAN_OPS), args: z.record(z.string(), z.unknown()).default({}) }).strict();
export type AgentAction = z.infer<typeof AgentActionSchema>;
export type HumanAction = z.infer<typeof HumanActionSchema>;

export const ERROR_CODES = [
  "SCHEMA", "UNKNOWN_OP", "AUTHORITY_SYSTEM", "AUTHORITY_HUMAN", "AUTHORITY_PINNED",
  "AUTHORITY_LAYOUT", "NOT_FOUND", "BAD_SOURCE", "BAD_REF", "CLUTTER_CAP", "NO_RESPONDER",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface CockpitError {
  ok: false;
  code: ErrorCode;
  message: string;
  issues?: { path: string; message: string; expected?: string }[];
}

export interface CockpitOk {
  ok: true;
  rev: number;
  effects: string[];
  warnings?: string[];
}

export type CockpitResult = CockpitOk | CockpitError;

export function error(code: ErrorCode, message: string, issues?: CockpitError["issues"]): CockpitError {
  return { ok: false, code, message, ...(issues ? { issues } : {}) };
}

// ── Workbench screen modes (REQ-COCKPIT-006) ────────────────────────────────

export const SCREEN_MODES = ["orient", "decide", "build", "verify", "release"] as const;
export type ScreenMode = (typeof SCREEN_MODES)[number];

// ── Work request lifecycle (REQ-COCKPIT-008) ────────────────────────────────

export const REQUEST_STATUSES = [
  "queued", "acknowledged", "running", "produced", "ready_for_review",
  "accepted", "blocked", "cancelled", "failed",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export type Role = "agent" | "human";

/**
 * The transition table is the lifecycle. `by` is the authority the caller
 * holds — decided by the transport, never by the caller's claim.
 */
export const TRANSITIONS: Record<RequestStatus, Partial<Record<RequestStatus, Role[]>>> = {
  queued: { acknowledged: ["agent"], blocked: ["agent"], failed: ["agent"], cancelled: ["human"] },
  acknowledged: { running: ["agent"], blocked: ["agent"], failed: ["agent"], cancelled: ["human"] },
  running: { produced: ["agent"], ready_for_review: ["agent"], blocked: ["agent"], failed: ["agent"], cancelled: ["human"] },
  produced: { ready_for_review: ["agent"], running: ["agent"], failed: ["agent"], cancelled: ["human"] },
  ready_for_review: { accepted: ["human"], blocked: ["human"], running: ["agent"], cancelled: ["human"] },
  blocked: { acknowledged: ["agent"], running: ["agent"], failed: ["agent"], cancelled: ["human"] },
  accepted: {}, cancelled: {}, failed: {},
};

export const TERMINAL_STATUSES: readonly RequestStatus[] = ["accepted", "cancelled", "failed"];
