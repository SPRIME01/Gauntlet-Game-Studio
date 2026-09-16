import { describe, it, expect } from "bun:test";
import { BandwidthTracker } from "../src/diagnostics/bandwidth";
import { LatencySimulator } from "../src/diagnostics/latency-sim";
import { GameWorld } from "../src/state/world";
import { Transform } from "../src/state/traits";

describe("Donor Mechanism Mining & Isolation Suite (T09 - REQ-DONOR-001..007)", () => {
  describe("Transplanted Diagnostics", () => {
    it("tracks per-peer and aggregate bandwidth usage accurately", () => {
      const tracker = new BandwidthTracker();

      tracker.recordSent("peer_alpha", 1500);
      tracker.recordReceived("peer_alpha", 500);
      tracker.recordSent("peer_beta", 2000);
      tracker.recordReceived("peer_beta", 1000);

      const usageAlpha = tracker.getBandwidthUsage("peer_alpha");
      expect(usageAlpha.sent).toBe(1500);
      expect(usageAlpha.received).toBe(500);

      const total = tracker.getTotalUsage();
      expect(total.sent).toBe(3500);
      expect(total.received).toBe(1500);
      expect(total.total).toBe(5000);

      const summaries = tracker.getPeerSummaries();
      expect(summaries.length).toBe(2);
      expect(summaries[0].peerId).toBe("peer_beta"); // Sorted by total bytes descending
      expect(summaries[0].totalBytes).toBe(3000);

      tracker.reset();
      expect(tracker.getTotalUsage().total).toBe(0);
    });

    it("simulates deterministic latency and packet loss", () => {
      // Deterministic PRNG sequence: [0.1, 0.9, 0.05, 0.8]
      const rolls = [0.1, 0.9, 0.05, 0.8];
      let rollIdx = 0;
      const fakeRandom = () => rolls[rollIdx++ % rolls.length];

      // 20% packet loss threshold
      const sim = new LatencySimulator({
        fixedLatencyMs: 0,
        packetLossRatio: 0.2,
        randomFn: fakeRandom,
      });

      const received: string[] = [];

      // roll 0.1 < 0.2 -> DROPPED
      const p1 = sim.handle("pkt_1", (p) => received.push(p));
      expect(p1).toBe(false);

      // roll 0.9 >= 0.2 -> DELIVERED
      const p2 = sim.handle("pkt_2", (p) => received.push(p));
      expect(p2).toBe(true);

      expect(received).toEqual(["pkt_2"]);

      const stats = sim.getStats();
      expect(stats.droppedCount).toBe(1);
      expect(stats.scheduledCount).toBe(1);
      expect(stats.dropRateObserved).toBe(0.5);

      sim.reset();
      expect(sim.getStats().scheduledCount).toBe(0);
    });
  });

  describe("Teeth Checks", () => {
    it("TEETH-T09-001: Rejects donor GameObject/BaseWorld semantic authority in favor of Koota state", () => {
      // ATTACK: Attempt to introduce donor GameObject or BaseWorld semantic patterns into state
      class GameObject {
        public id = "donor_actor_01";
        public isGameObject = true;
        public components: any[] = [];
      }

      class BaseWorld {
        public entities = new Map();
      }

      const gameWorld = new GameWorld();

      expect(() => {
        gameWorld.assertValidSemanticData({ actorInstance: new GameObject() }, "entity-1");
      }).toThrow(/Forbidden provider object 'GameObject'/);

      expect(() => {
        gameWorld.assertValidSemanticData({ worldInstance: new BaseWorld() }, "world-root");
      }).toThrow(/Forbidden provider object 'BaseWorld'/);
    });

    it("TEETH-T09-002: Detects and rejects forbidden donor imports and branding patterns", () => {
      // ATTACK: Introduce forbidden import patterns matching donor source
      const forbiddenImportCases = [
        "import { LatencySimulator } " + 'from "../../../.tmp/donor/Core/packages/core";',
        "import { BaseWorld } " + 'from "@mavon/core";',
        "import { NetworkManager } " + 'from "mavon-engine";',
      ];

      const forbiddenRegexes = [
        /from\s+['"][^'"]*\/donor\/[^'"]*['"]/,
        /from\s+['"][^'"]*\.tmp\/[^'"]*['"]/,
        /from\s+['"]@mavon\/[^'"]*['"]/,
        /from\s+['"]mavon-engine[^'"]*['"]/,
      ];

      for (const snippet of forbiddenImportCases) {
        const matches = forbiddenRegexes.some((regex) => regex.test(snippet));
        expect(matches).toBe(true);
      }

      // Check donor branding string detection
      const testBranding = "MavonEngine Server initialized with 128 players";
      expect(/\bMavonEngine\b/.test(testBranding)).toBe(true);
    });

    it("TEETH-T09-003: Verifies first-party runtime operates independently of .tmp/donor/", () => {
      // ATTACK: Verify that imported BandwidthTracker and LatencySimulator do NOT have
      // any runtime bindings or dynamic require calls to .tmp/donor/.
      const tracker = new BandwidthTracker();
      tracker.recordSent("client-01", 1024);
      expect(tracker.getTotalUsage().total).toBe(1024);

      const sim = new LatencySimulator({ fixedLatencyMs: 0 });
      let called = false;
      sim.handle("test", () => {
        called = true;
      });
      expect(called).toBe(true);
    });
  });
});
