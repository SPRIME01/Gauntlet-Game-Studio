#!/usr/bin/env bun
/**
 * TEETH-T22-001: Disable/remove network transport configuration and run the full
 * single-player suite.
 *
 * Legs:
 *  A. The game's declared network configuration is disabled (single_player declaration)
 *     and the SINGLE-PLAYER BUILD GRAPH contains NO transport construction path at all —
 *     there is nothing to enable: the configuration is absent from the runtime path.
 *     T23 refinement: the game now also declares an OPTIONAL multiplayer mode confined
 *     to dedicated entries (src/server.ts + src/net/, per the frozen game.spec.yaml
 *     `multiplayer` block); the tooth still fails if any transport reference appears
 *     anywhere in src/ OUTSIDE those declared entries.
 *  B. The full six-scenario single-player suite runs and settles with networking
 *     disabled (it always is): all non-network gameplay remains functional.
 *  C. Runtime surface proof: the observability network read reports no transport wired.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { NETWORK } from "../src/game/config";
import { runSinglePlayerSuite } from "../tests/e2e/run-suite";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..");
process.env.BW_NETWORK_DISABLED = "1"; // explicit attack-environment marker

// ---- Leg A: configuration disabled + zero transport construction in the single-player
// build graph (network references outside the declared T23 entries still fail) --------
if (NETWORK.enabled !== false || NETWORK.declaration !== "single-player-only") {
  console.error("TEETH-T22-001 LEG A FAILED: network configuration is not declared disabled.");
  process.exit(1);
}
const forbidden = /new\s+WebSocket|Bun\.serve|startNetwork|NetworkServer|NetworkClient|WebSocketTransport|createTransport/;
/** T23-declared multiplayer entries: the ONLY place transport code may live. */
const declaredNetEntries = (rel: string): boolean =>
  rel === "server.ts" || rel.startsWith(`net${path.sep}`);
let transportRefs = 0;
const visit = (dir: string, relBase: string) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = relBase ? path.join(relBase, entry.name) : entry.name;
    if (entry.isDirectory()) visit(full, rel);
    else if (entry.name.endsWith(".ts") && !declaredNetEntries(rel) && forbidden.test(fs.readFileSync(full, "utf-8")))
      transportRefs++;
  }
};
visit(path.join(PROJECT_ROOT, "src"), "");
// The declared entries MUST exist and MUST contain transport code (they are the only
// sanctioned home for it); anything else was already counted above.
if (!fs.existsSync(path.join(PROJECT_ROOT, "src", "server.ts")) || !fs.existsSync(path.join(PROJECT_ROOT, "src", "net"))) {
  console.error("TEETH-T22-001 LEG A FAILED: declared multiplayer entries are missing.");
  process.exit(1);
}
if (transportRefs !== 0) {
  console.error(`TEETH-T22-001 LEG A FAILED: ${transportRefs} transport construction reference(s) in game source outside the declared multiplayer entries.`);
  process.exit(1);
}
console.log("PASS A: network transport configuration disabled and absent from the single-player build graph (transport code confined to the declared multiplayer entries)");

// ---- Leg B: full suite settles with networking disabled ---------------------------
const result = await runSinglePlayerSuite({ projectRoot: PROJECT_ROOT, evidence: false });
for (const entry of result.scenarios) {
  console.log(`[teeth] ${entry.scenario}: ${entry.decision.toUpperCase()}`);
}
if (!result.all_settled || result.scenarios.length !== 6) {
  console.error("TEETH-T22-001 LEG B FAILED: single-player suite did not fully settle.");
  process.exit(1);
}
console.log("PASS B: all six scenarios settled with networking disabled");

// ---- Leg C: runtime surface reports no transport wired ----------------------------
const served = await import("../tests/e2e/serve");
const { chromium } = await import("playwright");
const game = served.serveGame(PROJECT_ROOT);
let networkRead: Record<string, unknown> | null = null;
try {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-default-browser-check"],
  });
  try {
    const page = await (await browser.newContext({ viewport: { width: 640, height: 360 } })).newPage();
    await page.goto(`${game.url}/`, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction("globalThis.__GAUNTLET_STUDIO_OBS__ && globalThis.__GAUNTLET_STUDIO_OBS__.ready()", null, { timeout: 60000 });
    networkRead = (await page.evaluate("globalThis.__GAUNTLET_STUDIO_OBS__.network.read()")) as Record<string, unknown>;
  } finally {
    await browser.close();
  }
} finally {
  game.stop();
}
if (!networkRead || networkRead.present !== false || networkRead.reason !== "not_registered") {
  console.error(`TEETH-T22-001 LEG C FAILED: network surface read ${JSON.stringify(networkRead)}`);
  process.exit(1);
}
console.log("PASS C: observability network read reports no transport wired (not_registered)");
console.log("TEETH-T22-001 BIT: full single-player suite functional with network transport disabled/removed.");
