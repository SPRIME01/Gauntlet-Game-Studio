/**
 * Blackwater Relay — test:blackwater-multiplayer gate (T23).
 *
 * Bundles first (`bun run test:blackwater-multiplayer`); then settles the THREE frozen
 * networked scenarios (multiplayer-sync, interest-filtering, multiplayer-latency) with
 * TWO independent browser clients per scenario against the authoritative headless
 * server, through the stable observability contract and the studio Gauntlet bridge.
 * Also proves the single-player source tree stays free of transport construction.
 */

import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { runMultiplayerSuite } from "./run-multiplayer-suite";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..", "..");
const SCENARIOS = ["multiplayer-sync", "interest-filtering", "multiplayer-latency"];

/** Single-player source graph: must never construct transports/clients/servers (T22 declaration). */
const SINGLE_PLAYER_SOURCES = [
  path.join(PROJECT_ROOT, "src", "game"),
  path.join(PROJECT_ROOT, "src", "world"),
  path.join(PROJECT_ROOT, "src", "assets"),
  path.join(PROJECT_ROOT, "src", "main.ts"),
  path.join(PROJECT_ROOT, "src", "index.ts"),
];

describe("Blackwater Relay authoritative multiplayer (T23)", () => {
  it(
    "settles the full three-scenario multiplayer suite against frozen expectations",
    async () => {
      const result = await runMultiplayerSuite({ projectRoot: PROJECT_ROOT });

      for (const entry of result.scenarios) {
        const failed = entry.channel_verdicts.flatMap((v) => v.failed_checks);
        console.log(
          `[multiplayer] ${entry.scenario}: ${entry.decision.toUpperCase()}` +
            (failed.length > 0 ? ` — ${failed.join(" | ")}` : "") +
            (entry.observation_blockage ? ` — [${entry.observation_blockage}]` : "")
        );
      }

      expect(result.scenarios.map((s) => s.scenario)).toEqual(SCENARIOS);
      expect(result.all_settled).toBe(true);
      expect(result.totals.settled).toBe(3);
      expect(result.totals.failed).toBe(0);
      expect(result.totals.blocked).toBe(0);
      expect(result.totals.incomplete).toBe(0);
    },
    { timeout: 600_000 }
  );

  it("keeps the single-player build graph free of any transport construction path", () => {
    // REQ-RUNTIME-009 / game.spec.yaml single_player: the single-player build never
    // imports or constructs a transport, network client, or server. Only the dedicated
    // T23 entries (src/server.ts, src/net/**) may reference them.
    const markers = [
      "BunWebSocketServerTransport",
      "BunWebSocketClientTransport",
      "LatencyImpairedTransport",
      "AuthoritativeServer",
      "NetworkClient",
      "new WebSocket",
    ];
    let offenders: string[] = [];
    const visit = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) visit(full);
        else if (/\.ts$/.test(entry.name)) {
          const text = fs.readFileSync(full, "utf-8");
          for (const marker of markers) {
            if (text.includes(marker)) offenders.push(`${path.relative(PROJECT_ROOT, full)}: ${marker}`);
          }
        }
      }
    };
    for (const target of SINGLE_PLAYER_SOURCES) {
      if (fs.statSync(target).isDirectory()) visit(target);
      else {
        const text = fs.readFileSync(target, "utf-8");
        for (const marker of markers) {
          if (text.includes(marker)) offenders.push(`${path.relative(PROJECT_ROOT, target)}: ${marker}`);
        }
      }
    }
    expect(offenders).toEqual([]);

    // The built single-player bundle contains no transport construction either.
    const gameBundle = fs.readFileSync(path.join(PROJECT_ROOT, "dist", "game.js"), "utf-8");
    expect(gameBundle.includes("new WebSocket")).toBe(false);
    // The networked client entries exist for the multiplayer suite only.
    expect(fs.existsSync(path.join(PROJECT_ROOT, "dist", "net-client.js"))).toBe(true);
    expect(fs.existsSync(path.join(PROJECT_ROOT, "src", "server.ts"))).toBe(true);
  });
});
