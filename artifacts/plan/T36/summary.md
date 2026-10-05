# T36 — Semantic Tool Registry, Loopback MCP, WebMCP, Authority Teeth

Settled: 2026-10-04. Confirmation: independent_adversarial (see confirmation.md).

## What was built

- **One semantic tool registry** (packages/cockpit/src/protocol/tools.ts): 23 tools — base
  (get_status/get_workspace/get_vocabulary/list_items/get_entity/show_surface/show_ref/compare_refs/
  ask_human/arrange/annotate/read_responses), game (get_game_case/get_quality_bar/get_release_matrix/
  get_resources), world debugger (game_why/game_impact/game_diff/game_timeline/game_counterfactual/
  resource_reach/game_replay), work (workbench/work_get/work_update). One implementation per tool in
  core.ts behind CLI (`studio cockpit tool`), loopback MCP (/mcp JSON-RPC, agent role only), and
  WebMCP (document.modelContext.registerTool with per-tool AbortController withdrawal and graceful
  no-op without modelContext). No manually divergent per-transport APIs (REQ-MCP-001).
- **Dynamic offering** (activeTools): base set always on; context gates world-debugger and work tools by
  focused surface kind and screen mode. Offering changes never change executability (REQ-MCP-002).
- **Annotations** per WebMCP ToolAnnotations (readOnlyHint from effect, untrustedContentHint from
  untrusted flag); inputSchema projected via z.toJSONSchema.
- **Authority invariants** (REQ-MCP-003): the work_update input schema structurally excludes
  accepted/cancelled; no tool can write the Game Model, waive licenses, or override the release gate
  (proven by a full registry checksum sweep against the canonical spec file); no raw-DOM/HTML block
  exists in the vocabulary; malformed/unknown calls return structured errors and mutate nothing
  (REQ-MCP-004).

## Gate results

- bun test full workspace: 528 pass / 0 fail (10 mcp-webmcp tests + live-server authority matrix).
- bun x tsc --noEmit: exit 0.
- Live server matrix (recorded during T34): 12/12 checks — boot/auth, MCP agent-only, human-op refusal,
  structured errors, tool-schema rejection of accepted status.

## Teeth outcomes (TEETH-T36-001..004)

- Tool name/schema sets identical across /api/boot, /mcp tools/list, and the registry (up to the
  active-set filter, which matches exactly).
- work_update → accepted/cancelled: refused (SCHEMA at the boundary; AUTHORITY_HUMAN at the reducer).
- Full-registry checksum sweep: canonical game.spec.yaml byte-identical after calling every tool.
- Malformed MCP calls: isError with structured codes; canonical state unchanged.
- WebMCP: graceful no-op without modelContext; with a fake context, tools register with correct
  annotations and non-aborted signals.
