import { describe, test, expect, afterEach } from "bun:test";
import * as THREE from "three";
import type { AssetRecord } from "@gauntlet/contracts";
import {
  GameWorld, HumanoidMotion, RenderProjectionManager, spawnHumanoidPrefab,
} from "../src/index";

const worlds: GameWorld[] = [];
function testWorld(): GameWorld {
  const world = new GameWorld();
  worlds.push(world);
  return world;
}
afterEach(() => {
  for (const world of worlds.splice(0)) world.world.destroy();
});

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
    const world = testWorld();
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

  test("an entity created during loading survives a failed spawn", async () => {
    const world = testWorld();
    const render = new RenderProjectionManager();
    const scene = new THREE.Scene();
    const existingModel = new THREE.Group();
    let existingEntity: ReturnType<GameWorld["spawnEntity"]>;
    const loader = {
      async loadAsync(url: string) {
        if (url === model.url) {
          existingEntity = world.spawnEntity({ id: "hero" });
          scene.add(existingModel);
          render.bind("hero", "existing", existingModel);
        }
        return { scene: existingModel, animations: [new THREE.AnimationClip("Idle_Loop", 1, [])] };
      },
    } as any;
    await expect(spawnHumanoidPrefab({
      world, render, scene, entityId: "hero", model, animations: [anim], loader,
    })).rejects.toThrow();
    expect(world.getEntity("hero")).toBe(existingEntity!);
    expect(scene.children).toEqual([existingModel]);
    expect(render.registry.get("hero")).toBe(existingModel);
  });

  test("render failure rolls back the newly created entity and scene model", async () => {
    const world = testWorld();
    const scene = new THREE.Scene();
    const loadedModel = new THREE.Group();
    const failure = new Error("render binding failed");
    class FailingRender extends RenderProjectionManager {
      override bind(): void { throw failure; }
    }
    const loader = {
      async loadAsync() {
        return { scene: loadedModel, animations: [new THREE.AnimationClip("Idle_Loop", 1, [])] };
      },
    } as any;
    await expect(spawnHumanoidPrefab({
      world, render: new FailingRender(), scene, entityId: "hero", model, animations: [anim], loader,
    })).rejects.toBe(failure);
    expect(world.hasEntity("hero")).toBe(false);
    expect(scene.children).toHaveLength(0);
    expect(loadedModel.parent).toBeNull();
  });

  test("pending source cannot spawn a production prefab", async () => {
    const world = testWorld();
    await expect(spawnHumanoidPrefab({
      world, render: new RenderProjectionManager(), scene: new THREE.Scene(), entityId: "x",
      model: { ...model, asset: asset("quaternius.base.test", "character", "pending") },
      animations: [anim],
    })).rejects.toThrow("NOT_ACCEPTED");
    expect(world.getEntityIds()).toHaveLength(0);
  });

  test("root motion variants and differing skeleton signatures are blocked", async () => {
    const base = { world: testWorld(), render: new RenderProjectionManager(),
      scene: new THREE.Scene(), entityId: "x", model };
    await expect(spawnHumanoidPrefab({
      ...base, animations: [{ ...anim, asset: asset("quaternius.animations-1.test", "animation-library", "accepted", true) }],
    })).rejects.toThrow("ROOT_MOTION_NOT_AUTHORITATIVE");

    const mismatched = { ...anim.asset, animation_contract: { kind: "animation-library", skeleton_sha256: "c".repeat(64), root_motion: false } };
    await expect(spawnHumanoidPrefab({ ...base, animations: [{ ...anim, asset: mismatched }] }))
      .rejects.toThrow("FOUNDATION_RIG_MISMATCH");
  });

  test("remote and traversal URLs cannot be loaded even with an accepted catalog record", async () => {
    const base = { world: testWorld(), render: new RenderProjectionManager(),
      scene: new THREE.Scene(), entityId: "x", animations: [anim] };
    for (const url of ["https://example.com/asset.glb", "../escape.glb", "data:asset"]) {
      await expect(spawnHumanoidPrefab({ ...base, model: { ...model, url } })).rejects.toThrow("NOT_LOCAL");
    }
  });
});
