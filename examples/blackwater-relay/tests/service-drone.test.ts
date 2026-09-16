/**
 * Service-drone committed-derivative consumption tests (T18).
 *
 * These run as part of the NORMAL game test suite and must stay green on any
 * host — including hosts without Blender (TEETH-T18-001). They consume ONLY
 * the committed accepted GLB derivative + AssetRecord; no .blend and no DCC
 * tooling is touched (REQ-BLENDER-004/006).
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  SERVICE_DRONE_ASSET,
  assertServiceDroneDerivativeConsumable,
  parseGlbContainer,
} from "../src/assets/service-drone";

describe("Service-drone committed Blender derivative", () => {
  const glbBytes = new Uint8Array(readFileSync(new URL("../assets/service-drone.glb", import.meta.url)));

  it("consumes the committed GLB derivative without any Blender presence", () => {
    const glb = parseGlbContainer(glbBytes);
    expect(glb.version).toBe("2.0");
    expect(() => assertServiceDroneDerivativeConsumable(glb)).not.toThrow();
  });

  it("carries the accepted hover_cycle clip and rig affordances", () => {
    const glb = parseGlbContainer(glbBytes);
    expect(glb.animations.map((a) => a.name)).toContain(SERVICE_DRONE_ASSET.animationClip);
    expect(glb.animations[0]!.channels.length).toBeGreaterThan(0);
  });

  it("matches the accepted AssetRecord in the manifest", () => {
    const manifest = JSON.parse(readFileSync(new URL("../assets/manifest.json", import.meta.url), "utf-8"));
    const record = manifest.records.find((r: { id: string }) => r.id === SERVICE_DRONE_ASSET.id);
    expect(record).toBeDefined();
    expect(record.origin).toBe(SERVICE_DRONE_ASSET.origin);
    expect(record.construction_route).toBe(SERVICE_DRONE_ASSET.constructionRoute);
    expect(record.acceptance_state).toBe("accepted");
    expect(record.runtime_representation).toContain(SERVICE_DRONE_ASSET.glbPath);
  });

  it("carries no gameplay semantics in DCC-side metadata affordances", () => {
    const glb = parseGlbContainer(glbBytes);
    const forbidden = /quest|npc|dialog(ue)?|objective|faction|gameplay|mission|inventory/i;
    for (const node of glb.nodes) {
      for (const key of Object.keys(node.extras ?? {})) {
        expect(forbidden.test(key)).toBe(false);
      }
    }
  });
});
