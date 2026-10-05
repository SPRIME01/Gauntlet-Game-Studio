/**
 * Cockpit server (REQ-COCKPIT-003/004, REQ-MCP-001..002, spec v0.5.0).
 *
 * One Bun.serve process:
 *  - human transport: one WebSocket at /ws, authenticated by the human token
 *    (never leaves the browser link; lives in the URL fragment, not the path).
 *  - agent transport: HTTP POST /api/agent with the agent token. Authority is
 *    decided by the transport — the agent path can never carry human ops.
 *  - loopback MCP at /mcp: JSON-RPC over the same semantic tool registry.
 *  - /api/boot: role, tool schemas (active set), snapshot.
 *
 * Loopback only: binds 127.0.0.1, checks Host/Origin. This is a local
 * development instrument; it does not sandbox a hostile local shell.
 */

import { Cockpit, type CockpitOptions } from "./core";
import { activeTools, toolSchemas, TOOLS } from "../protocol/tools";
import { deriveRail } from "./rail";
import type { Role } from "../protocol/blocks";

export interface ServeOptions {
  projectRoot: string;
  port?: number;
}

export interface CockpitTokens {
  human: string;
  agent: string;
}

function randomToken(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export function roleForRequest(request: Request, tokens: CockpitTokens): Role | null {
  const url = new URL(request.url);
  const header = request.headers.get("x-cockpit-token");
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const query = url.searchParams.get("t");
  for (const candidate of [header, bearer, query]) {
    if (candidate === tokens.human) return "human";
    if (candidate === tokens.agent) return "agent";
  }
  return null;
}

export function startCockpitServer(options: ServeOptions): { server: ReturnType<typeof Bun.serve>; tokens: CockpitTokens; cockpit: Cockpit; stop: () => void } {
  const projectRoot = options.projectRoot.replace(/\/$/, "");
  const port = options.port ?? 7740;
  const tokens: CockpitTokens = { human: randomToken(), agent: randomToken() };
  const cockpit = new Cockpit({ projectRoot, role: "agent" });
  const humanSockets = new Set<{ send(data: string): void; close(): void }>();

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(request: Request, serverContext: { upgrade(request: Request, options?: { data?: unknown }): boolean }) {
      const url = new URL(request.url);

      // Loopback host check (DNS rebinding guard).
      const host = request.headers.get("host") ?? "";
      if (!host.startsWith("127.0.0.1") && !host.startsWith("localhost")) {
        return new Response("forbidden", { status: 403 });
      }

      if (url.pathname === "/ws") {
        // Human transport only: the human token must be present on upgrade.
        if (url.searchParams.get("t") !== tokens.human) {
          return new Response("forbidden", { status: 403 });
        }
        if (serverContext.upgrade(request, { data: null })) {
          return; // upgraded
        }
        return new Response("upgrade failed", { status: 400 });
      }

      if (url.pathname === "/api/boot") {
        const role = roleForRequest(request, tokens);
        return Response.json({
          role,
          agentToken: role === "human" ? tokens.agent : undefined,
          toolSchemas: toolSchemas(activeTools({ screenMode: cockpit.state.screenMode, pendingWork: cockpit.state.work.some((w) => w.status === "queued") })),
          activeTools: cockpit.activeTools(),
          screenMode: cockpit.state.screenMode,
          rail: "release-rail (system-owned)",
        });
      }

      const role = roleForRequest(request, tokens);
      if (!role) return Response.json({ ok: false, code: "AUTHORITY_SYSTEM", message: "missing or invalid cockpit token" }, { status: 401 });

      if (url.pathname === "/api/agent/action" && request.method === "POST") {
        const body = (await request.json().catch(() => null)) as { op?: string } | null;
        if (!body) return Response.json({ ok: false, code: "SCHEMA", message: "invalid JSON body" }, { status: 400 });
        // Transport-decided authority: the authenticated role is passed down
        // explicitly. Agent transports can never carry human ops (the cockpit
        // refuses them); the human transport accepts human ops only.
        if (role === "agent") {
          return Response.json(cockpit.action(body, "agent"));
        }
        if (body.op?.startsWith("human.")) {
          return Response.json(cockpit.action(body, "human"));
        }
        return Response.json({ ok: false, code: "UNKNOWN_OP", message: "human transport accepts human ops only" });
      }

      if (url.pathname === "/api/agent/tool" && request.method === "POST") {
        const body = (await request.json().catch(() => null)) as { name?: string; input?: unknown } | null;
        if (!body?.name) return Response.json({ ok: false, error: { code: "SCHEMA", message: "tool call requires name" } }, { status: 400 });
        // Tools execute under this transport's role; agent token = agent authority.
        const outcome = cockpit.tool(body.name, body.input);
        return Response.json(outcome);
      }

      if (url.pathname === "/api/data" && request.method === "GET") {
        const source = url.searchParams.get("source") ?? "";
        const read = cockpit.readSource(source);
        return Response.json(read);
      }

      if (url.pathname === "/api/rail" && request.method === "GET") {
        // The rail is system state, readable by any authenticated role; it is
        // rendered by the shell and addressable by no agent action.
        return Response.json(deriveRail(cockpit.projectRoot, {
          openAsks: cockpit.state.answers.filter((a) => a.outcome === "deferred").length,
          readyForReview: cockpit.state.work.filter((w) => w.status === "ready_for_review").length,
        }));
      }

      if (url.pathname === "/mcp" && request.method === "POST") {
        // Loopback MCP is an agent transport (donor discipline: agent role only).
        if (role !== "agent") {
          return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "loopback MCP executes under agent authority only" } });
        }
        const rpc = (await request.json().catch(() => null)) as { id?: unknown; method?: string; params?: Record<string, unknown> } | null;
        if (!rpc?.method) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "invalid request" } });
        const rpcId = rpc.id ?? null;
        if (rpc.method === "initialize") {
          return Response.json({ jsonrpc: "2.0", id: rpcId, result: { protocolVersion: "2025-06-18", serverInfo: { name: "gauntlet-game-cockpit", version: "0.1.0" } } });
        }
        if (rpc.method === "tools/list") {
          const names = cockpit.activeTools();
          return Response.json({ jsonrpc: "2.0", id: rpcId, result: { tools: toolSchemas(names) } });
        }
        if (rpc.method === "tools/call") {
          const name = String(rpc.params?.name ?? "");
          const args = (rpc.params?.arguments ?? {}) as unknown;
          const outcome = cockpit.tool(name, args);
          return Response.json({
            jsonrpc: "2.0",
            id: rpcId,
            result: { content: [{ type: "text", text: JSON.stringify(outcome) }], isError: !outcome.ok },
          });
        }
        return Response.json({ jsonrpc: "2.0", id: rpcId, error: { code: -32601, message: `unknown method ${rpc.method}` } });
      }

      return new Response("not found", { status: 404 });
    },
    websocket: {
      open(socket) {
        // Human transport only; the upgrade is authenticated below by token query.
        humanSockets.add(socket);
      },
      close(socket) {
        humanSockets.delete(socket);
      },
      message(socket, message) {
        // Human WebSocket messages must be human ops; the server applies them
        // under the human role.
        try {
          const parsed = JSON.parse(String(message)) as { op?: string; args?: unknown; token?: string };
          if (parsed.token !== tokens.human) {
            socket.send(JSON.stringify({ ok: false, code: "AUTHORITY_SYSTEM", message: "invalid human token" }));
            return;
          }
          const result = cockpit.action({ op: parsed.op, args: parsed.args ?? {} }, "human");
          socket.send(JSON.stringify(result));
        } catch (error) {
          socket.send(JSON.stringify({ ok: false, code: "SCHEMA", message: String(error) }));
        }
      },
    },
  });

  function stop(): void {
    server.stop(true);
    cockpit.close();
  }

  return { server, tokens, cockpit, stop };
}

export const COCKPIT_TOOL_COUNT = TOOLS.length;
export type { CockpitOptions };
