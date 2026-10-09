import { describe, test, expect } from "bun:test";
import * as THREE from "three";
import type { AssetRecord } from "@gauntlet/contracts";
import {
  GameWorld, HumanoidMotion, RenderProjectionManager, spawnHumanoidPrefab,
} from "../src/index";

function asset(id: string, kind: string, status: "accepted" | "pending" = "accepted", rootMotion = false): AssetRecord {
  return {
    id, role: kind, origin: "cc0", construction_route: "asset.resolve/gauntlet-foundations",
    source_provenance: { license: "CC0-1.0", sha256: "b".repeat(64) },
    runtime_representation: "assets/sources/foundations/" + id + ".glb",
    budget: {}, acceptance_state: status,
    animation_contract: { kind, skeleton_sha256: "a".repeat(64), root_motion: rootMotion },
  };
}
const model = { asset: asset("quaternius.base.test", "character"), url: "/assets/character.glb" };
const anim = { asset: asset("quaternius.animations-1.test", "animation-library"), url: "/assets/animations.glb" };

describe("humanoid prefab intake boundaries", () => {
  test("instantiates from accepted assets, Koota drives motion and render follows state", async () => {
    const world = new GameWorld();
    const render = new RenderProjectionManager();
    const scene = new THREE.Scene();
    const loader = {
      async loadAsync(url: string) {
        return {
          scene: new THREE.Group(),
          animations: url.includes("animations")
            ? [new THREE.AnimationClip("Idle_Loop", 1, []), new THREE.AnimationClip("Walk_Loop", 1, [])] : [],
        };
      },
    } as any;
    const spawned = await spawnHumanoidPrefab({
      world, render, scene, entityId: "hero", model, animations: [anim],
      loader, position: [1, 2, 3],
    });
    expect(scene.children.includes(spawned.model)).toBe(true);
    expect(world.getEntity("hero")?.get(HumanoidMotion)?.state).toBe("idle");
    expect(spawned.update(1 / 60).clip).toBe("Idle_Loop");
    world.getEntity("hero")!.set(HumanoidMotion, { state: "walk", rate: 1 });
    expect(spawned.update(1 / 60).clip).toBe("Walk_Loop");
    render.syncFromState(world);
    expect(spawned.model.position.toArray()).toEqual([1, 2, 3]);
    spawned.dispose();
    expect(world.hasEntity("hero")).toBe(false);
    expect(scene.children.includes(spawned.model)).toBe(false);
  });

  test("pending source cannot spawn a production prefab", async () => {
    const world = new GameWorld();
    await expect(spawnHumanoidPrefab({
      world, render: new RenderProjectionManager(), scene: new THREE.Scene(), entityId: "x",
      model: { ...model, asset: asset("quaternius.base.test", "character", "pending") },
      animations: [anim],
    })).rejects.toThrow("NOT_ACCEPTED");
    expect(world.getEntityIds()).toHaveLength(0);
  });

  test("root motion variants and differing skeleton signatures are blocked", async () => {
    const base = { world: new GameWorld(), render: new RenderProjectionManager(),
      scene: new THREE.Scene(), entityId: "x", model };
    await expect(spawnHumanoidPrefab({
      ...base, animations: [{ ...anim, asset: asset("quaternius.animations-1.test", "animation-library", "accepted", true) }],
    })).rejects.toThrow("ROOT_MOTION_NOT_AUTHORITATIVE");

    const mismatched = { ...anim.asset, animation_contract: { kind: "animation-library", skeleton_sha256: "c".repeat(64), root_motion: false } };
    await expect(spawnHumanoidPrefab({ ...base, animations: [{ ...anim, asset: mismatched }] }))
      .rejects.toThrow("FOUNDATION_RIG_MISMATCH");
  });

  test("remote and traversal URLs cannot be loaded even with an accepted catalog record", async () => {
    const base = { world: new GameWorld(), render: new RenderProjectionManager(),
      scene: new THREE.Scene(), entityId: "x", animations: [anim] };
    for (const url of ["https://example.com/asset.glb", "../escape.glb", "data:asset"]) {
      await expect(spawnHumanoidPrefab({ ...base, model: { ...model, url } })).rejects.toThrow("NOT_LOCAL");
    }
  });
});
