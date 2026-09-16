/**
 * @gauntlet/runtime network module.
 * Optional server-authoritative multiplayer over a transport-neutral boundary.
 * Baseline transport binding: Bun native WebSockets (built into Bun).
 * WebRTC/geckos.io is an OPTIONAL advanced transport (unreliable/unordered
 * delivery) and is intentionally NOT a baseline dependency (REQ-BIND-013).
 * Koota remains the sole semantic authority (REQ-NET-001, REQ-SAFE-006).
 */

export * from "./types";
export * from "./protocol";
export * from "./transport";
export * from "./bun-websocket";
export * from "./replication";
export * from "./diagnostics";
export * from "./server";
export * from "./client";
