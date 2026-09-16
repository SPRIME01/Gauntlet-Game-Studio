/**
 * Blackwater Relay — test:e2e gate (T22).
 *
 * Builds nothing here (`bun run test:e2e` bundles first); serves the built game and
 * drives the SIX frozen named scenarios in declaration order through the stable T19
 * observability contract with real system Chrome (headless, no autoplay bypass), then
 * asserts — via the studio Gauntlet bridge — that every scenario SETTLES against its
 * frozen expectation. Single extra structural probes assert navigation/spatial
 * projection health and the single-player network-free declaration.
 */

import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { chromium } from "playwright";
import { OBSERVABILITY_CONTRACT_NAME } from "@gauntlet/runtime";
import { runSinglePlayerSuite } from "./run-suite";
import { serveGame } from "./serve";

const PROJECT_ROOT = path.resolve(import.meta.dir, "..", "..");
const SCENARIOS = [
  "boot",
  "active-play",
  "transceiver-interaction",
  "patrol-obstacle",
  "beacon-activation",
  "performance-flythrough",
];

describe("Blackwater Relay single-player vertical slice (T22)", () => {
  it(
    "settles the full six-scenario suite against frozen expectations",
    async () => {
      const result = await runSinglePlayerSuite({ projectRoot: PROJECT_ROOT });

      // Suite-level report (failure diagnosis without hiding the assert below).
      for (const entry of result.scenarios) {
        const failed = entry.channel_verdicts.flatMap((v) => v.failed_checks);
        console.log(
          `[suite] ${entry.scenario}: ${entry.decision.toUpperCase()}` +
            (failed.length > 0 ? ` — ${failed.join(" | ")}` : "")
        );
      }

      expect(result.scenarios.map((s) => s.scenario)).toEqual(SCENARIOS);
      expect(result.all_settled).toBe(true);
      expect(result.totals.settled).toBe(6);
      expect(result.totals.failed).toBe(0);
      expect(result.totals.blocked).toBe(0);
      expect(result.totals.incomplete).toBe(0);
    },
    { timeout: 480_000 }
  );

  it(
    "exposes healthy navigation/spatial projections and zero network surface (single-player proof)",
    async () => {
      const served = serveGame(PROJECT_ROOT);
      let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
      try {
        browser = await chromium.launch({
          executablePath: "/usr/bin/google-chrome",
          headless: true,
          args: ["--no-default-browser-check"],
        });
        const page = await (await browser.newContext({ viewport: { width: 640, height: 360 } })).newPage();
        await page.goto(`${served.url}/`, { waitUntil: "load", timeout: 60_000 });

        // Stable surface only — no DOM/provider fallbacks (REQ-OBS-004).
        await page.waitForFunction(
          `globalThis[${JSON.stringify(OBSERVABILITY_CONTRACT_NAME)}] && globalThis[${JSON.stringify(OBSERVABILITY_CONTRACT_NAME)}].ready()`,
          null,
          { timeout: 60_000 }
        );
        const surface = `globalThis[${JSON.stringify(OBSERVABILITY_CONTRACT_NAME)}]`;

        const nav = (await page.evaluate(`(${surface}).navigation.read()`)) as {
          present: boolean;
          diagnostics: { hasNavMesh: boolean; agentCount: number };
        };
        expect(nav.present).toBe(true);
        expect(nav.diagnostics.hasNavMesh).toBe(true);
        expect(nav.diagnostics.agentCount).toBeGreaterThanOrEqual(1);

        const spatial = (await page.evaluate(`(${surface}).spatial.read()`)) as { present: boolean };
        expect(spatial.present).toBe(true);

        const network = (await page.evaluate(`(${surface}).network.read()`)) as {
          present: boolean;
          reason?: string;
        };
        // REQ-RUNTIME-009: single-player never wires a transport.
        expect(network.present).toBe(false);
        expect(network.reason).toBe("not_registered");

        const scenarios = (await page.evaluate(`(${surface}).control.listScenarios()`)) as string[];
        for (const s of SCENARIOS) expect(scenarios).toContain(s);

        // The privileged control namespace exists only because this is a dev/test
        // surface; the production surface shape is proven by the runtime's own gate.
        const header = (await page.evaluate(`(${surface}).contract`)) as {
          name: string;
          version: number;
        };
        expect(header.name).toBe(OBSERVABILITY_CONTRACT_NAME);
        expect(header.version).toBe(1);
      } finally {
        await browser?.close().catch(() => undefined);
        served.stop();
      }
    },
    { timeout: 180_000 }
  );

  it("keeps the committed service-drone derivative consumable with no Blender present", () => {
    // The GLB is committed and validated at container level by game code; here we
    // assert the game RUNTIME (src/) never references a Blender executable. The
    // scripts/ teeth runners are falsification evidence and legitimately probe for
    // Blender absence, so they are out of scope for the runtime-authority scan.
    const sources = [path.join(PROJECT_ROOT, "src")];
    let offenders = 0;
    const visit = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) visit(full);
        else if (/\.(ts|js|json|yaml)$/.test(entry.name)) {
          const text = fs.readFileSync(full, "utf-8");
          if (/blender\s*(--background|\.blend)|exec.*blender|spawn.*blender/i.test(text)) offenders++;
        }
      }
    };
    for (const dir of sources) visit(dir);
    expect(offenders).toBe(0);
    expect(fs.existsSync(path.join(PROJECT_ROOT, "assets", "service-drone.glb"))).toBe(true);
  });
});
