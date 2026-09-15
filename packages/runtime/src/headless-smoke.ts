#!/usr/bin/env bun
import { ServerRuntime } from "./server";

console.log("=== Gauntlet Runtime Headless Server Smoke Verification ===");

const server = new ServerRuntime({ enablePhysics: true, enableNavigation: true });

// Simulate async subsystem readiness
server.kernel.barrier.markBooting("physics");
server.kernel.barrier.markReady("physics", 12);

server.kernel.barrier.markBooting("navigation");
server.kernel.barrier.markReady("navigation", 18);

if (!server.kernel.barrier.isReady()) {
  console.error("FAIL: ServerRuntime failed readiness barrier.");
  process.exit(1);
}

// Execute 60 authoritative simulation ticks (1.0s at 60Hz)
for (let i = 0; i < 60; i++) {
  server.tick();
}

const diag = server.getDiagnostics();
console.log(`OK: Executed ${diag.tick} ticks in headless mode. State: ${diag.state}`);
console.log(`OK: Authoritative simulation time: ${diag.simulation_time.toFixed(4)}s`);

server.dispose();
console.log("SUCCESS: Headless runtime smoke verification passed.");
process.exit(0);
