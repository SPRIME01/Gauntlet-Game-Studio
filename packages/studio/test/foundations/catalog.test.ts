import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { AssetResolver } from "../../src/assets/resolve";
import { AssetRegistry } from "../../src/assets/registry";
import {
  createFoundationProvider, findFoundationAssets, loadFoundationInventory, type FoundationInventory,
} from "../../src/foundations/catalog";

function fixture(): { root: string; inventory: string; project: string; data: FoundationInventory } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "foundations-"));
  const raw = path.join(root, "raw", "kit");
  fs.mkdirSync(raw, { recursive: true });
  const model = path.join(raw, "Female.gltf");
  fs.writeFileSync(model, JSON.stringify({ asset: { version: "2.0" }, nodes: [], images: [], buffers: [] }));
  const sha = crypto.createHash("sha256").update(fs.readFileSync(model)).digest("hex");
  const sig = "a".repeat(64);
  const data: FoundationInventory = {
    schema: "gauntlet.foundation.inventory",
    schema_version: "1.0",
    license: "CC0-1.0",
    publication_state: "unaccepted-source-derivatives",
    packs: [{ id: "base", archive: "unused.zip", archive_sha256: "b".repeat(64), license: "CC0-1.0", license_file: "License.txt" }],
    compatibility: { bone_names_match: true, skeleton_sha256: sig },
    assets: [{
      id: "quaternius.base.female", kind: "character", path: "kit/Female.gltf", sha256: sha,
      skeleton_sha256: sig, skeleton_bone_names: ["root"],
      animation_clips: [], root_motion: false, repairs: [], acceptance: "pending",
    }],
  };
  const inventory = path.join(root, "inventory.json");
  fs.writeFileSync(inventory, JSON.stringify(data));
  return { root, inventory, project: path.join(root, "project"), data };
}

describe("offline foundation catalog and asset.resolve integration", () => {
  test("correct semantic kind, role and identity matching", () => {
    const f = fixture();
    try {
      expect(findFoundationAssets(f.data, "npc_character", ["female"])).toHaveLength(1);
      expect(findFoundationAssets(f.data, "animation", ["female"])).toHaveLength(0);
      expect(findFoundationAssets(f.data, "npc", ["girl"])).toHaveLength(0);
      expect(findFoundationAssets(f.data, "npc", ["male"])).toHaveLength(0);
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
  });

  test("foundation match copies source and records pending, never accepted", async () => {
    const f = fixture();
    try {
      const provider = createFoundationProvider({ inventoryPath: f.inventory });
      const found = await provider.search(["female"], "npc");
      expect(found.status).toBe("success");
      if (found.status !== "success") return;
      expect(found.matches).toHaveLength(1);
      const resolver = new AssetResolver({ providers: [provider] });
      const outcome = await resolver.resolve({
        projectRoot: f.project, requestedId: "npc_woman", role: "npc", keywords: ["female"], requireLicense: "CC0-1.0",
      });
      expect(outcome.status).toBe("success");
      if (outcome.status !== "success") return;
      expect(outcome.result.provider).toBe("gauntlet-foundations");
      const registry = new AssetRegistry(f.project);
      registry.load();
      const record = registry.get("quaternius.base.female");
      expect(record?.acceptance_state).toBe("pending");
      expect(record?.source_provenance.license).toBe("CC0-1.0");
      expect(record?.runtime_representation).toContain("assets/sources/foundations/");
      expect(fs.existsSync(path.join(f.project, record!.runtime_representation))).toBe(true);
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
  });

  test("stale bytes are refused and no project manifest is created", async () => {
    const f = fixture();
    try {
      fs.writeFileSync(path.join(f.root, "raw", "kit", "Female.gltf"), "{}");
      const provider = createFoundationProvider({ inventoryPath: f.inventory });
      const result = await provider.acquire({
        assetId: "quaternius.base.female", provider: "gauntlet-foundations",
        title: "female", license: "CC0-1.0", sourceUri: "https://quaternius.itch.io",
      }, "npc", f.project);
      expect(result.status).toBe("blocked");
      expect(fs.existsSync(path.join(f.project, "assets"))).toBe(false);
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
  });

  test("rejects traversal paths from untrusted inventory", () => {
    const f = fixture();
    try {
      f.data.assets[0].path = "../escape.gltf";
      fs.writeFileSync(f.inventory, JSON.stringify(f.data));
      expect(() => loadFoundationInventory(f.inventory)).toThrow();
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
  });

  test("missing local catalog never blocks other providers", async () => {
    const provider = createFoundationProvider({ inventoryPath: path.join(os.tmpdir(), "missing-gauntlet-foundations-catalog.json") });
    expect((await provider.search(["male"], "npc")).status).toBe("success");
  });
});
