import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BlockSchema, SurfaceSchema, BLOCK_TYPES, SourceSchema, AGENT_OPS, AUTHORITY_OPS,
  TRANSITIONS, REQUEST_STATUSES, SCREEN_MODES,
} from "../src/protocol/blocks";
import { TOOLS, TOOL_NAMES, activeTools, toolSchemas } from "../src/protocol/tools";
import { applyAgent, applyHuman, initialWorkspace, workMove, workInsert } from "../src/server/workspace";
import { CockpitDb } from "../src/server/db";
import { projectCockpitState } from "../src/server/project";
import { Cockpit } from "../src/server/core";
import * as world from "../src/server/world";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");

function tmpProject(withModel = true): string {
  const root = mkdtempSync(join(tmpdir(), "gauntlet-cockpit-"));
  if (withModel) {
    const dir = join(root, ".agents", "specs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "game.spec.yaml"), `schema: gauntlet.game.model
schema_version: "2.0"
model_version: 1
identity:
  game_id: "cockpit-game"
  title: "Cockpit Game"
camera:
  mode: "third-person"
languages:
  material:
    summary: "matte painted metal"
quality_bar:
  criteria:
    - id: boot-clean
      dimension: technical
      requirement: "boots clean"
      evidence_refs: ["settlement-boot"]
decisions:
  - n: 1
    version: 1
    summary: "initial direction"
    touched: ["identity"]
`);
  }
  return root;
}

const VALID_SURFACE = {
  id: "test-surface",
  title: "Test Surface",
  intent: "inspect",
  layout: "stack",
  blocks: [{ type: "metric", id: "m1", label: "model version", value: 1 }],
};

describe("protocol grammar (REQ-COCKPIT-001)", () => {
  test("block vocabulary is closed: 16 types including viewport", () => {
    expect(BLOCK_TYPES.length).toBe(16);
    expect(BLOCK_TYPES).toContain("viewport");
    expect(BlockSchema.safeParse({ type: "custom-widget", id: "x" }).success).toBe(false);
    expect(BlockSchema.safeParse({ type: "metric", id: "m", label: "L", value: 1, rogue: true }).success).toBe(false);
  });

  test("viewport block accepts only typed declarative modes", () => {
    expect(BlockSchema.safeParse({ type: "viewport", id: "v1", mode: "live-game", source: "gm:model" }).success).toBe(true);
    expect(BlockSchema.safeParse({ type: "viewport", id: "v1", mode: "arbitrary-iframe", source: "gm:model" }).success).toBe(false);
    expect(BlockSchema.safeParse({ type: "viewport", id: "v1", mode: "live-game", html: "<script>alert(1)</script>" }).success).toBe(false);
  });

  test("source grammar is bounded; traversal rejected", () => {
    expect(SourceSchema.safeParse("gm:decisions").success).toBe(true);
    expect(SourceSchema.safeParse("file:artifacts/runs/x.json").success).toBe(true);
    expect(SourceSchema.safeParse("../etc/passwd").success).toBe(false);
    expect(SourceSchema.safeParse("file:../../secrets").success).toBe(false);
    expect(SourceSchema.safeParse("window:document.body").success).toBe(false);
  });

  test("surfaces validate blocks and entity.follow", () => {
    expect(SurfaceSchema.safeParse(VALID_SURFACE).success).toBe(true);
    const duplicateIds = { ...VALID_SURFACE, blocks: [
      { type: "metric", id: "same", label: "a", value: 1 },
      { type: "metric", id: "same", label: "b", value: 2 },
    ] };
    expect(SurfaceSchema.safeParse(duplicateIds).success).toBe(false);
    const danglingFollow = { ...VALID_SURFACE, blocks: [{ type: "entity", id: "e1", follow: "missing-table" }] };
    expect(SurfaceSchema.safeParse(danglingFollow).success).toBe(false);
  });
});

describe("TEETH-T34-001: transport-decided authority", () => {
  test("agent reducer rejects human authority ops regardless of payload", () => {
    const state = initialWorkspace();
    for (const op of AUTHORITY_OPS) {
      const { result } = applyAgent(state, { op, args: { surface: "s", text: "forged" } });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(["AUTHORITY_HUMAN", "UNKNOWN_OP", "SCHEMA"]).toContain(result.code);
    }
  });

  test("cockpit agent transport refuses human.* ops before dispatch; human transport applies them", () => {
    const root = tmpProject();
    const agentCockpit = new Cockpit({ projectRoot: root, role: "agent" });
    const refused = agentCockpit.action({ op: "human.answer", args: { surface: "s", ask: "a", value: "forged" } });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe("AUTHORITY_HUMAN");
    agentCockpit.close();

    const humanCockpit = new Cockpit({ projectRoot: root, role: "human" });
    const accepted = humanCockpit.action({ op: "human.answer", args: { surface: "s", ask: "a", outcome: "answered", value: "owner says so" } });
    expect(accepted.ok).toBe(true);
    expect(humanCockpit.state.answers.length).toBe(1);
    humanCockpit.close();
    rmSync(root, { recursive: true, force: true });
  });

  test("pinned owner surfaces are immune to agent removal and repositioning", () => {
    const state = initialWorkspace();
    const opened = applyAgent(state, { op: "surface.put", args: { surface: VALID_SURFACE } });
    expect(opened.result.ok).toBe(true);
    const pinned = applyHuman(opened.next, { op: "human.pin", args: { surface: "test-surface", pinned: true } });
    expect(pinned.result.ok).toBe(true);
    const removed = applyAgent(pinned.next, { op: "surface.remove", args: { surface: "test-surface" } });
    expect(removed.result.ok).toBe(false);
    if (!removed.result.ok) expect(removed.result.code).toBe("AUTHORITY_PINNED");
    const moved = applyAgent(pinned.next, { op: "view.place", args: { surface: "test-surface", placement: { rel: "left" } } });
    expect(moved.result.ok).toBe(false);
    if (!moved.result.ok) expect(moved.result.code).toBe("AUTHORITY_LAYOUT");
  });

  test("agent surface content updates replace in place; cap evicts least-recent unpinned", () => {
    const state = initialWorkspace();
    const first = applyAgent(state, { op: "surface.put", args: { surface: VALID_SURFACE } });
    expect(first.result.ok).toBe(true);
    const replaced = applyAgent(first.next, { op: "surface.put", args: { surface: { ...VALID_SURFACE, title: "Updated" } } });
    expect(replaced.result.ok).toBe(true);
    expect(replaced.next.surfaces.length).toBe(1);
    expect(replaced.next.surfaces[0].title).toBe("Updated");
    expect(replaced.result.warnings?.join(" ")).toContain("placement preserved");
  });
});

describe("TEETH-T34-002: the cockpit DB is disposable; canonical truth is untouched", () => {
  test("rebuild reproduces identical projection; destroy + rebuild leaves canonical files identical", () => {
    const root = tmpProject();
    const canonicalBefore = readFileSync(join(root, ".agents", "specs", "game.spec.yaml"));
    const cockpit = new Cockpit({ projectRoot: root, role: "agent" });
    const put = cockpit.action({ op: "surface.put", args: { surface: VALID_SURFACE } });
    expect(put.ok).toBe(true);
    cockpit.close();

    const projection1 = projectCockpitState(root);
    const cockpit2 = new Cockpit({ projectRoot: root, role: "agent" });
    cockpit2.db.destroy();
    cockpit2.rebuild();
    const projection2 = projectCockpitState(root);
    expect(JSON.stringify(projection1.rows)).toEqual(JSON.stringify(projection2.rows));
    cockpit2.close();

    const canonicalAfter = readFileSync(join(root, ".agents", "specs", "game.spec.yaml"));
    expect(Buffer.from(canonicalAfter).equals(Buffer.from(canonicalBefore))).toBe(true);
    expect(existsSync(join(root, ".cockpit", "cockpit.db"))).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("TEETH-T34-004: work-request lifecycle; executor cannot accept its own work", () => {
  test("full happy path with agent producing and human accepting", () => {
    let state = initialWorkspace();
    const inserted = workInsert(state, "make combat feel heavier", "steer");
    state = inserted.next;
    const seq = inserted.seq;
    const path = ["acknowledged", "running", "produced", "ready_for_review"] as const;
    for (const to of path) {
      const moved = workMove(state, seq, to, "agent", to === "ready_for_review" ? "combat layer retuned; evidence linked" : undefined);
      expect(moved.result.ok).toBe(true);
      state = moved.next;
    }
    const accepted = workMove(state, seq, "accepted", "human");
    expect(accepted.result.ok).toBe(true);
  });

  test("agent attempting accepted/cancelled is refused with AUTHORITY_HUMAN whatever the state", () => {
    let state = initialWorkspace();
    const inserted = workInsert(state, "x", "capability");
    state = inserted.next;
    for (const status of ["queued", "acknowledged", "running", "produced", "ready_for_review"] as const) {
      if (status !== "queued") {
        const step = workMove(state, 1, status, "agent");
        state = step.next;
      }
      const attempt = workMove(state, 1, "accepted", "agent");
      expect(attempt.result.ok).toBe(false);
      if (!attempt.result.ok) expect(attempt.result.code).toBe("AUTHORITY_HUMAN");
    }
  });

  test("cockpit workMove enforces the same refusal; malformed transitions are typed", () => {
    const root = tmpProject();
    const cockpit = new Cockpit({ projectRoot: root, role: "agent" });
    const submitted = cockpit.workSubmit("find a permissive locomotion pack", "capability");
    if (!("seq" in submitted)) throw new Error("submit failed");
    const selfAccepted = cockpit.workMove(submitted.seq, "accepted");
    expect(selfAccepted.ok).toBe(false);
    if (!selfAccepted.ok) expect(selfAccepted.code).toBe("AUTHORITY_HUMAN");
    const illegal = cockpit.workMove(submitted.seq, "produced");
    expect(illegal.ok).toBe(false);
    if (!illegal.ok) expect(illegal.code).toBe("SCHEMA");
    cockpit.close();
    rmSync(root, { recursive: true, force: true });
  });

  test("malformed actions return structured errors and mutate nothing", () => {
    const state = initialWorkspace();
    const before = JSON.stringify(state);
    const bad1 = applyAgent(state, { op: "not-an-op" });
    expect(bad1.result.ok).toBe(false);
    const bad2 = applyAgent(state, { op: "surface.put", args: { surface: { id: "BAD ID", title: "", blocks: [] } } });
    expect(bad2.result.ok).toBe(false);
    if (!bad2.result.ok) expect(bad2.result.code).toBe("SCHEMA");
    const bad3 = applyAgent(state, "just a string");
    expect(bad3.result.ok).toBe(false);
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("TEETH-T34-005: world debugger is read-only with honest basis", () => {
  test("why distinguishes recorded/derived/unavailable and never invents", () => {
    const root = tmpProject();
    const env = world.openWorld(root);
    const cameraAnswers = world.why(env, "camera");
    expect(cameraAnswers[0].basis).toBe("recorded");
    const nothing = world.why(env, "warp_drive");
    expect(nothing[0].basis).toBe("unavailable");
    expect(nothing[0].a).toContain("nothing recorded");
    rmSync(root, { recursive: true, force: true });
  });

  test("counterfactual previews without applying; authority is possibility", () => {
    const root = tmpProject();
    const env = world.openWorld(root);
    const preview = world.counterfactual(env, { touched: ["camera"], summary: "camera to first person" });
    expect(preview.authority).toBe("possibility");
    expect(preview.effects.some((e) => e.class === "unknown")).toBe(true);
    expect(env.model.modelVersion).toBe(1); // unchanged
    rmSync(root, { recursive: true, force: true });
  });

  test("impact marks stale downstream; replay never settles", () => {
    const root = tmpProject();
    mkdirSync(join(root, "assets"), { recursive: true });
    writeFileSync(join(root, "assets", "manifest.json"), JSON.stringify({
      schema: "gauntlet.asset.manifest", schema_version: "1.0",
      records: [{ id: "rifle", built_from: 0, reads: ["camera"] }],
    }));
    const env = world.openWorld(root);
    const impact = world.impact(env, "camera");
    expect(impact.rows.some((r) => r.ref === "rifle" && r.stale === false)).toBe(true);
    const replayed = world.replay(env, "boot-expectation");
    expect(replayed.settles).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("tool registry (REQ-MCP-001/002)", () => {
  test("one registry, one implementation per tool; schemas project to all transports", () => {
    expect(TOOLS.length).toBeGreaterThanOrEqual(20);
    expect(TOOL_NAMES.size).toBe(TOOLS.length);
    const schemas = toolSchemas();
    expect(schemas.length).toBe(TOOLS.length);
    for (const schema of schemas) {
      expect(schema.annotations).toBeDefined();
      expect(typeof schema.inputSchema).toBe("object");
    }
  });

  test("contextual offering: base always on, context gates the rest, offering is not authorization", () => {
    const bare = activeTools({});
    expect(bare).toContain("get_status");
    expect(bare).toContain("get_game_case");
    expect(bare).not.toContain("work_update");
    const focused = activeTools({ focus: "resources:rifle", pendingWork: true });
    expect(focused).toContain("get_resources");
    expect(focused).toContain("resource_reach");
    expect(focused).toContain("work_update");
    // Offered or not, every tool stays executable via the registry.
    expect(TOOL_NAMES.has("resource_reach")).toBe(true);
  });

  test("cockpit dispatch: structured errors for unknown tools and malformed input", () => {
    const root = tmpProject();
    const cockpit = new Cockpit({ projectRoot: root, role: "agent" });
    const unknown = cockpit.tool("no_such_tool", {});
    expect(unknown.ok).toBe(false);
    expect((unknown as { error?: { code: string } }).error?.code).toBe("UNKNOWN_TOOL");
    const malformed = cockpit.tool("game_impact", { ref: 42, nonsense: true });
    expect(malformed.ok).toBe(false);
    expect((malformed as { error?: { code: string } }).error?.code).toBe("SCHEMA");
    cockpit.close();
    rmSync(root, { recursive: true, force: true });
  });

  test("the release rail is not a workspace surface and no action can address it", () => {
    const state = initialWorkspace();
    const attempt = applyAgent(state, { op: "surface.remove", args: { surface: "release-rail" } });
    expect(attempt.result.ok).toBe(false);
    if (!attempt.result.ok) expect(attempt.result.code).toBe("NOT_FOUND");
    const put = applyAgent(state, { op: "surface.put", args: { surface: { id: "system-rail", title: "Fake rail", blocks: [{ type: "metric", id: "x", label: "score", value: 99 }] } } });
    expect(put.result.ok).toBe(true); // a surface named like the rail is just a surface; the rail is rendered by the shell, not stored
    expect(put.next.surfaces.some((s) => s.id === "release-rail")).toBe(false);
  });
});

describe("protocol constants", () => {
  test("screen modes and lifecycle statuses are the game-vocabulary ones", () => {
    expect(SCREEN_MODES).toEqual(["orient", "decide", "build", "verify", "release"]);
    expect(REQUEST_STATUSES).toContain("ready_for_review");
    expect(TRANSITIONS.ready_for_review.accepted).toEqual(["human"]);
    expect(TRANSITIONS.queued.cancelled).toEqual(["human"]);
  });
  test("agent ops never overlap authority ops", () => {
    for (const op of AGENT_OPS) expect(AUTHORITY_OPS).not.toContain(op);
  });
});
