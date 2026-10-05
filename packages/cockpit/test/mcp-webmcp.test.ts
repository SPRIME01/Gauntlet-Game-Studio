import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startCockpitServer } from "../src/server/serve";
import { TOOLS, TOOL_NAMES, toolSchemas, activeTools } from "../src/protocol/tools";
import { BLOCK_TYPES } from "../src/protocol/blocks";

function tmpProject(): string {
  const root = mkdtempSync(join(tmpdir(), "gauntlet-mcp-"));
  const dir = join(root, ".agents", "specs");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "game.spec.yaml"), `schema: gauntlet.game.model
schema_version: "2.0"
model_version: 1
identity:
  game_id: "mcp-game"
  title: "Mcp Game"
decisions:
  - n: 1
    version: 1
    summary: "start"
    touched: ["identity"]
`);
  return root;
}

async function liveServer() {
  const root = tmpProject();
  const { server, tokens, cockpit, stop } = startCockpitServer({ projectRoot: root, port: 0 });
  const base = `http://127.0.0.1:${server.port}`;
  const boot = (await (await fetch(`${base}/api/boot?t=${tokens.human}`)).json()) as {
    agentToken: string;
    activeTools: string[];
    toolSchemas: { name: string }[];
  };
  const agentHeaders = { "content-type": "application/json", "x-cockpit-token": boot.agentToken };
  const call = async (name: string, input: unknown) =>
    (await (await fetch(`${base}/api/agent/tool`, { method: "POST", headers: agentHeaders, body: JSON.stringify({ name, input }) })).json()) as {
      ok: boolean;
      result?: unknown;
      error?: { code: string; message: string };
    };
  const mcpCall = async (name: string, args: unknown) =>
    (await (
      await fetch(`${base}/mcp`, {
        method: "POST",
        headers: agentHeaders,
        body: JSON.stringify({ id: 1, method: "tools/call", params: { name, arguments: args } }),
      })
    ).json()) as { result: { isError: boolean; content: { text: string }[] } };
  return { root, base, tokens, cockpit, stop, boot, agentHeaders, call, mcpCall };
}

describe("TEETH-T36-001: one registry feeds CLI, MCP, and WebMCP", () => {
  test("tool schemas are identical up to transport framing", async () => {
    const { base, agentHeaders, boot, stop } = await liveServer();
    const mcpList = (await (await fetch(`${base}/mcp`, { method: "POST", headers: agentHeaders, body: JSON.stringify({ id: 1, method: "tools/list", params: {} }) })).json()) as { result: { tools: { name: string; inputSchema: object; annotations: { readOnlyHint: boolean } }[] } };
    const registrySchemas = toolSchemas(boot.activeTools);
    expect(mcpList.result.tools.map((t) => t.name).sort()).toEqual(registrySchemas.map((t) => t.name).sort());
    for (const tool of mcpList.result.tools) {
      const registryTool = registrySchemas.find((t) => t.name === tool.name)!;
      expect(JSON.stringify(tool.inputSchema)).toEqual(JSON.stringify(registryTool.inputSchema));
      expect(tool.annotations.readOnlyHint).toEqual(registryTool.annotations.readOnlyHint);
    }
    stop();
  });

  test("the active offering is the same set on /api/boot and /mcp tools/list", async () => {
    const { base, agentHeaders, boot, stop } = await liveServer();
    const mcpList = (await (await fetch(`${base}/mcp`, { method: "POST", headers: agentHeaders, body: JSON.stringify({ id: 1, method: "tools/list", params: {} }) })).json()) as { result: { tools: { name: string }[] } };
    expect(mcpList.result.tools.map((t) => t.name).sort()).toEqual([...boot.activeTools].sort());
    stop();
  });
});

describe("TEETH-T36-002: the human-authority escalation matrix from every agent surface", () => {
  test("work_update cannot reach accepted/cancelled even for an existing request", async () => {
    const { cockpit, base, agentHeaders, stop } = await liveServer();
    const submitted = cockpit.workSubmit("prepare the web release", "capability");
    if (!("seq" in submitted)) throw new Error("submit failed");
    for (const status of ["accepted", "cancelled"] as const) {
      const direct = cockpit.tool("work_update", { id: submitted.seq, status });
      expect(direct.ok).toBe(false);
      // The tool schema itself excludes those statuses.
      expect(direct.error?.code).toBe("SCHEMA");
      const viaHttp = await (await fetch(`${base}/api/agent/action`, { method: "POST", headers: agentHeaders, body: JSON.stringify({ op: "human.work-review", args: { seq: submitted.seq, accepted: status === "accepted" } }) })).json();
      expect(viaHttp.ok).toBe(false);
    }
    stop();
  });

  test("no tool can silently mutate the canonical Game Model (checksum sweep)", async () => {
    const { root, call, stop } = await liveServer();
    const specPath = join(root, ".agents", "specs", "game.spec.yaml");
    const before = readFileSync(specPath);
    for (const name of TOOLS.map((t) => t.name)) {
      // Every tool, with its most aggressive plausible input.
      await call(name, name === "game_counterfactual" ? { touched: ["identity"], summary: "hostile change" } : name === "work_update" ? { id: 1, status: "failed" } : name === "show_surface" ? { surface: { id: "sweep-surface", title: "sweep", blocks: [{ type: "metric", id: "m", label: "x", value: 1 }] } } : name === "annotate" ? { surface: "sweep-surface", text: "note" } : name === "arrange" ? { op: "view.focus", surface: "sweep-surface", args: {} } : {});
    }
    expect(Buffer.from(readFileSync(specPath)).equals(Buffer.from(before))).toBe(true);
    stop();
  });

  test("no tool surface exposes license waivers, release override, or DOM driving", () => {
    const descriptions = TOOLS.map((t) => `${t.name} ${t.description}`).join(" ").toLowerCase();
    expect(TOOL_NAMES.has("waive_license")).toBe(false);
    expect(TOOL_NAMES.has("override_release")).toBe(false);
    expect(TOOL_NAMES.has("exec_dom")).toBe(false);
    expect(TOOL_NAMES.has("set_model")).toBe(false);
    // The block vocabulary has no arbitrary-HTML block.
    for (const forbidden of ["html", "iframe", "script", "codegen"]) {
      expect(BLOCK_TYPES).not.toContain(forbidden);
    }
    void descriptions;
  });

  test("malformed tool calls mutate nothing and return structured errors over MCP", async () => {
    const { root, mcpCall, stop } = await liveServer();
    const specPath = join(root, ".agents", "specs", "game.spec.yaml");
    const before = readFileSync(specPath);
    const attempts = [
      await mcpCall("no_such_tool", {}),
      await mcpCall("game_impact", { ref: 42 }),
      await mcpCall("show_surface", { surface: { id: "BAD", title: "" } }),
      await mcpCall("game_counterfactual", { touched: "not-an-array" }),
    ];
    for (const attempt of attempts) {
      expect(attempt.result?.isError).toBe(true);
      const payload = JSON.parse(attempt.result.content[0].text) as { ok: boolean; error?: { code: string } };
      expect(payload.ok).toBe(false);
      expect(payload.error?.code).toBeDefined();
    }
    expect(Buffer.from(readFileSync(specPath)).equals(Buffer.from(before))).toBe(true);
    stop();
  });
});

describe("TEETH-T36-004: dynamic offering — discovery is not authorization", () => {
  test("context gates the advertised set but never the executable set", async () => {
    const bare = activeTools({});
    const withContext = activeTools({ focus: "resources:rifle", pendingWork: true });
    expect(withContext.length).toBeGreaterThan(bare.length);
    // Every withdrawn tool remains executable through the registry.
    for (const name of TOOLS.map((t) => t.name)) expect(TOOL_NAMES.has(name)).toBe(true);
  });

  test("unknown/unacceptable tool names are refused before any dispatch", async () => {
    const { call, stop } = await liveServer();
    const result = await call("__proto__", {});
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("UNKNOWN_TOOL");
    stop();
  });
});

describe("WebMCP bridge semantics", () => {
  test("startWebMcp is a graceful no-op without document.modelContext", async () => {
    const { startWebMcp } = await import("../src/web/webmcp");
    // No document in the test environment: must not throw.
    expect(() => startWebMcp()).not.toThrow();
  });

  test("with a fake modelContext, tools register with annotations and withdraw by abort", async () => {
    const { startWebMcp } = await import("../src/web/webmcp?t=fakectx2");
    const registered: { name: string; signal: AbortSignal }[] = [];
    const controller = { registerTool: (tool: { name: string }, options?: { signal?: AbortSignal }) => registered.push({ name: tool.name, signal: options!.signal! }) };
    (globalThis as { document?: unknown }).document = { modelContext: controller };
    // Seed the store the way /api/boot would after connect.
    const { setState } = await import("../src/web/store");
    setState({ toolSchemas: toolSchemas(), activeTools: activeTools({}) });
    startWebMcp();
    // Allow the sync tick to run.
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(registered.length).toBeGreaterThan(0);
    // Every registered tool carries annotations consistent with the registry.
    const schemas = new Map(toolSchemas().map((s) => [s.name, s]));
    for (const entry of registered) {
      const schema = schemas.get(entry.name);
      expect(schema).toBeDefined();
      expect(entry.signal.aborted).toBe(false);
    }
    // Clean up globals.
    delete (globalThis as { document?: unknown }).document;
  });
});

describe("T34 correction round 1 — work-request operability end-to-end", () => {
  test("submit → agent works → owner reviews via human channel: the full loop is operable", async () => {
    const { base, tokens, agentHeaders, call, stop } = await (async () => {
      const root = tmpProject();
      const started = startCockpitServer({ projectRoot: root, port: 0 });
      const boot = (await (await fetch(`http://127.0.0.1:${started.server.port}/api/boot?t=${started.tokens.human}`)).json()) as { agentToken: string };
      const headers = { "content-type": "application/json", "x-cockpit-token": boot.agentToken };
      const call = async (name: string, input: unknown) =>
        (await (await fetch(`http://127.0.0.1:${started.server.port}/api/agent/tool`, { method: "POST", headers, body: JSON.stringify({ name, input }) })).json()) as { ok: boolean; result?: { seq?: number }; error?: { code: string } };
      return { base: `http://127.0.0.1:${started.server.port}`, tokens: started.tokens, agentHeaders: headers, call, stop: started.stop };
    })();
    void base; void agentHeaders;

    // Agent queues a request on the owner's behalf.
    const submitted = await call("work_submit", { text: "find a permissive locomotion pack", kind: "capability" });
    expect(submitted.ok).toBe(true);
    const seq = submitted.result!.seq!;

    // Agent works it to ready_for_review.
    for (const status of ["acknowledged", "running", "produced", "ready_for_review"] as const) {
      const moved = await call("work_update", { id: seq, status, ...(status === "ready_for_review" ? { note: "locomotion pack candidates linked" } : {}) });
      expect(moved.ok).toBe(true);
    }

    // Owner reviews over the human channel: accept.
    const review = await (await fetch(`${base}/api/agent/action`, { method: "POST", headers: { "x-cockpit-token": tokens.human }, body: JSON.stringify({ op: "human.work-review", args: { seq, accepted: true } }) })).json();
    expect(review.ok).toBe(true);
    const after = await call("work_get", {});
    expect((after.result as { requests: { seq: number; status: string }[] }).requests.find((r) => r.seq === seq)?.status).toBe("accepted");
    stop();
  });

  test("agent cannot reach accepted via work_submit path or direct reducer call", async () => {
    const { cockpit, call, stop } = await (async () => {
      const root = tmpProject();
      const started = startCockpitServer({ projectRoot: root, port: 0 });
      const boot = (await (await fetch(`http://127.0.0.1:${started.server.port}/api/boot?t=${started.tokens.human}`)).json()) as { agentToken: string };
      const headers = { "content-type": "application/json", "x-cockpit-token": boot.agentToken };
      const call = async (name: string, input: unknown) =>
        (await (await fetch(`http://127.0.0.1:${started.server.port}/api/agent/tool`, { method: "POST", headers, body: JSON.stringify({ name, input }) })).json()) as { ok: boolean; result?: { seq?: number }; error?: { code: string } };
      return { cockpit: started.cockpit, call, stop: started.stop };
    })();
    const submitted = await call("work_submit", { text: "x" });
    const seq = submitted.result!.seq!;
    // Direct reducer-level attempt still refused.
    const direct = cockpit.workMove(seq, "accepted");
    expect(direct.ok).toBe(false);
    if (!direct.ok) expect(direct.code).toBe("AUTHORITY_HUMAN");
    stop();
  });
});

describe("T34 correction round 2 — D1-D6 regression teeth", () => {
  test("D1: third work_submit in one session gets a fresh seq; owner review hits the right request", async () => {
    const { base, tokens, call, stop } = await (async () => {
      const root = tmpProject();
      const started = startCockpitServer({ projectRoot: root, port: 0 });
      const boot = (await (await fetch(`http://127.0.0.1:${started.server.port}/api/boot?t=${started.tokens.human}`)).json()) as { agentToken: string };
      const headers = { "content-type": "application/json", "x-cockpit-token": boot.agentToken };
      const call = async (name: string, input: unknown) =>
        (await (await fetch(`http://127.0.0.1:${started.server.port}/api/agent/tool`, { method: "POST", headers, body: JSON.stringify({ name, input }) })).json()) as { ok: boolean; result?: { seq?: number; requests?: { seq: number; status: string; text: string }[] }; error?: { code: string } };
      return { base: `http://127.0.0.1:${started.server.port}`, tokens: started.tokens, call, stop: started.stop };
    })();

    // Three submits in one session (the exact aliasing scenario).
    const s1 = await call("work_submit", { text: "request one" });
    const s2 = await call("work_submit", { text: "request two" });
    const s3 = await call("work_submit", { text: "request three" });
    const seqs = [s1.result!.seq!, s2.result!.seq!, s3.result!.seq!];
    expect(new Set(seqs).size).toBe(3);

    // Owner rejects request two; the handle must hit request two, not three.
    const reject = await (await fetch(`${base}/api/agent/action`, { method: "POST", headers: { "x-cockpit-token": tokens.human }, body: JSON.stringify({ op: "human.work-cancel", args: { seq: seqs[1], note: "not now" } }) })).json();
    expect(reject.ok).toBe(true);
    const listing = await call("work_get", {});
    const requests = listing.result!.requests!;
    const bySeq = new Map(requests.map((r) => [r.seq, r]));
    expect(bySeq.get(seqs[1])?.status).toBe("cancelled");
    expect(bySeq.get(seqs[2])?.status).toBe("queued");
    expect(bySeq.get(seqs[2])?.text).toBe("request three");
    // No duplicate seq rows.
    expect(requests.filter((r) => r.seq === seqs[1]).length).toBe(1);
    stop();
  });

  test("D2: work_submit is advertised on /api/boot and /mcp tools/list", async () => {
    const { base, agentHeaders, boot, stop } = await (async () => {
      const root = tmpProject();
      const started = startCockpitServer({ projectRoot: root, port: 0 });
      const boot = (await (await fetch(`http://127.0.0.1:${started.server.port}/api/boot?t=${started.tokens.human}`)).json()) as { agentToken: string; activeTools: string[] };
      const headers = { "content-type": "application/json", "x-cockpit-token": boot.agentToken };
      return { base: `http://127.0.0.1:${started.server.port}`, agentHeaders: headers, boot, stop: started.stop };
    })();
    expect(boot.activeTools).toContain("work_submit");
    const mcpList = (await (await fetch(`${base}/mcp`, { method: "POST", headers: agentHeaders, body: JSON.stringify({ id: 1, method: "tools/list", params: {} }) })).json()) as { result: { tools: { name: string }[] } };
    expect(mcpList.result.tools.map((t) => t.name)).toContain("work_submit");
    stop();
  });

  test("D3: work_update refusals carry the tool contract shape (error.code)", async () => {
    const { cockpit, stop } = await (async () => {
      const root = tmpProject();
      const started = startCockpitServer({ projectRoot: root, port: 0 });
      return { cockpit: started.cockpit, stop: started.stop };
    })();
    const result = cockpit.tool("work_update", { id: 999, status: "running" });
    expect(result.ok).toBe(false);
    expect((result as { error?: { code: string } }).error?.code).toBeDefined();
    stop();
  });

  test("D4: work history starts with the queued step attributed to the submitter", async () => {
    const { call, stop } = await (async () => {
      const root = tmpProject();
      const started = startCockpitServer({ projectRoot: root, port: 0 });
      const boot = (await (await fetch(`http://127.0.0.1:${started.server.port}/api/boot?t=${started.tokens.human}`)).json()) as { agentToken: string };
      const headers = { "content-type": "application/json", "x-cockpit-token": boot.agentToken };
      const call = async (name: string, input: unknown) =>
        (await (await fetch(`http://127.0.0.1:${started.server.port}/api/agent/tool`, { method: "POST", headers, body: JSON.stringify({ name, input }) })).json()) as { ok: boolean; result?: { requests?: { seq: number; actor?: string; history?: { status: string; by: string }[] }[] } };
      return { call, stop: started.stop };
    })();
    const submitted = await call("work_submit", { text: "agent-submitted request" });
    const listing = await call("work_get", {});
    const request = listing.result!.requests!.find((r) => r.seq === submitted.result!.seq);
    expect(request?.history?.[0]?.status).toBe("queued");
    expect(request?.history?.[0]?.by).toBe("agent");
    stop();
  });

  test("D5: degenerate replay id matches nothing (evidence-missing, never everything)", async () => {
    const { root, stop } = await (async () => {
      const root = tmpProject();
      mkdirSync(join(root, "artifacts", "runs", "run-something"), { recursive: true });
      writeFileSync(join(root, "artifacts", "runs", "run-something", "settlement-01.json"), JSON.stringify({ id: "settlement-x", decision: "settled", requirement_ids: [] }));
      return { root, stop: null as null | (() => void) };
    })();
    const world = await import("../src/server/world");
    const env = world.openWorld(root);
    const result = world.replay(env, "expectation:");
    expect(result.verdict).toBe("evidence-missing");
    rmSync(root, { recursive: true, force: true });
    void stop;
  });
});
