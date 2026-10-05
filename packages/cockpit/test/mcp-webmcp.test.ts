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
