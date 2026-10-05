/**
 * Cockpit client store: one external store; the server is authoritative.
 * Every mutation is a request the server validates. The store only holds what
 * the server told it.
 */

import { useSyncExternalStore } from "react";

export interface ClientState {
  connected: boolean;
  role: string | null;
  screenMode: string;
  surfaces: { id: string; title: string; summary?: string; intent: string; layout: string; pinned: boolean; placedBy: string; blocks: unknown[] }[];
  focused: string | null;
  answers: unknown[];
  notes: unknown[];
  work: { seq: number; text: string; status: string; kind: string }[];
  rail: Record<string, unknown> | null;
  toolSchemas: { name: string; description: string; inputSchema: object; annotations: Record<string, boolean> }[];
  activeTools: string[];
}

let state: ClientState = {
  connected: false,
  role: null,
  screenMode: "orient",
  surfaces: [],
  focused: null,
  answers: [],
  notes: [],
  work: [],
  rail: null,
  toolSchemas: [],
  activeTools: [],
};

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function getState(): ClientState {
  return state;
}

export function setState(patch: Partial<ClientState>): void {
  state = { ...state, ...patch };
  emit();
}

/** Subscribe to raw state changes (used by the WebMCP bridge). */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useClientState(): ClientState {
  return useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => listeners.delete(onStoreChange);
    },
    getState,
    getState,
  );
}

let socket: WebSocket | null = null;
let agentToken: string | null = null;
let humanToken: string | null = null;

export function getHumanToken(): string | null {
  if (humanToken) return humanToken;
  const match = /[#&]t=([^&]+)/.exec(location.hash);
  if (match) humanToken = decodeURIComponent(match[1]);
  return humanToken;
}

export function getAgentToken(): string | null {
  return agentToken;
}

export function connect(): void {
  const token = getHumanToken() ?? "";
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${proto}//${location.host}/ws?t=${encodeURIComponent(token)}`);
  socket.onopen = () => {
    setState({ connected: true });
    void boot();
  };
  socket.onclose = () => {
    setState({ connected: false });
    setTimeout(connect, 1000 + Math.floor(Math.random() * 2000));
  };
  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(String(event.data)) as Record<string, unknown>;
      if (message.rev !== undefined) void refreshSnapshot();
    } catch {
      /* ignore malformed frames */
    }
  };
}

async function boot(): Promise<void> {
  const response = await fetch(`/api/boot?t=${encodeURIComponent(getHumanToken() ?? "")}`);
  const data = (await response.json()) as { role: string | null; agentToken?: string; toolSchemas: ClientState["toolSchemas"]; activeTools: string[]; screenMode: string };
  agentToken = data.agentToken ?? null;
  setState({ role: data.role, toolSchemas: data.toolSchemas, activeTools: data.activeTools, screenMode: data.screenMode });
  await refreshSnapshot();
}

export async function refreshSnapshot(): Promise<void> {
  const workspace = await api<{ ok: boolean; result?: { surfaces: ClientState["surfaces"]; focused: string | null } }>("get_workspace", {});
  const work = await api<{ ok: boolean; result?: { requests?: ClientState["work"] } }>("work_get", {});
  setState({
    surfaces: (workspace.result?.surfaces ?? []) as ClientState["surfaces"],
    focused: (workspace.result?.focused as string) ?? null,
    work: (work.result?.requests ?? []) as ClientState["work"],
  });
  void fetchRail();
}

/** The release rail is system state: fetched by the shell, never composed by agents. */
export async function fetchRail(): Promise<void> {
  try {
    const response = await fetch(`/api/rail`, { headers: { "x-cockpit-token": agentToken ?? getHumanToken() ?? "" } });
    const rail = (await response.json()) as ClientState["rail"];
    setState({ rail });
  } catch {
    /* rail stays at its last known value; absence is rendered as unknown */
  }
}

/** Resolve a bounded-grammar source to rows for source-bound blocks. */
const sourceCache = new Map<string, Record<string, unknown>[]>();

export async function fetchSourceRows(source: string): Promise<Record<string, unknown>[] | null> {
  if (sourceCache.has(source)) return sourceCache.get(source)!;
  try {
    const response = await fetch(`/api/data?source=${encodeURIComponent(source)}`, {
      headers: { "x-cockpit-token": agentToken ?? getHumanToken() ?? "" },
    });
    const body = (await response.json()) as { ok: boolean; rows?: Record<string, unknown>[] };
    if (!body.ok || !Array.isArray(body.rows)) return null;
    sourceCache.set(source, body.rows);
    return body.rows;
  } catch {
    return null;
  }
}

/** Human ops go over the human WebSocket. Agent tools go over HTTP with the agent token. */
export function human(op: string, args: Record<string, unknown> = {}): void {
  socket?.send(JSON.stringify({ op, args, token: getHumanToken() }));
}

export async function api<T = { ok: boolean; result?: unknown; error?: { code: string; message: string } }>(path: string, input: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/agent/tool`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-cockpit-token": agentToken ?? "" },
    body: JSON.stringify({ name: path, input }),
    signal,
  });
  return (await response.json()) as T;
}
