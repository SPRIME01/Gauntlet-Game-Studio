/**
 * WebMCP (REQ-MCP-002/003, spec v0.5.0).
 *
 * Registers the cockpit's semantic tools on `document.modelContext` with
 * graceful degradation when the browser does not support it. Tools are offered
 * and withdrawn dynamically by aborting per-tool signals as the server's
 * active set changes. Execution posts to /api/agent/tool with the agent token:
 * tools run on the server under AGENT authority — the same schemas, authority
 * checks, and reducer as every other path. There is no tool that answers,
 * rules, confirms, approves, edits the model, touches the rail, or writes DOM.
 * Offering is discovery, not authorization.
 */

import { getState, subscribe as subscribeStore, api } from "./store";

interface ToolSchema {
  name: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
}

interface ModelContextLike {
  registerTool(tool: unknown, options?: { signal?: AbortSignal }): void;
}

function modelContext(): ModelContextLike | null {
  const doc = document as Document & { modelContext?: ModelContextLike; navigator?: Navigator & { modelContext?: ModelContextLike } };
  if (doc.modelContext) return doc.modelContext;
  const nav = (globalThis as { navigator?: Navigator & { modelContext?: ModelContextLike } }).navigator;
  return nav?.modelContext ?? null;
}

const withdrawn = new Map<string, AbortController>();

function title(name: string): string {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function syncTools(schemas: { name: string; description: string; inputSchema: object; annotations: Record<string, boolean> }[], active: string[]): void {
  const context = modelContext();
  if (!context) return; // graceful no-op when unsupported

  for (const [name, controller] of withdrawn) {
    if (!active.includes(name)) {
      controller.abort();
      withdrawn.delete(name);
    }
  }
  for (const schema of schemas) {
    if (!active.includes(schema.name) || withdrawn.has(schema.name)) continue;
    const controller = new AbortController();
    withdrawn.set(schema.name, controller);
    context.registerTool(
      {
        name: schema.name,
        title: title(schema.name),
        description: schema.description,
        inputSchema: schema.inputSchema,
        annotations: schema.annotations,
        execute: (input: unknown, options?: { signal?: AbortSignal }) => api(schema.name, input ?? {}, options?.signal),
      },
      { signal: controller.signal },
    );
  }
}

export function startWebMcp(): void {
  if (!modelContext()) return; // graceful no-op when the browser lacks modelContext
  const sync = (): void => syncTools(getState().toolSchemas, getState().activeTools);
  sync();
  subscribeStore(sync);
}
