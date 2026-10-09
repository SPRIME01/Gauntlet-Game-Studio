import { describe, test, expect } from "bun:test";
import * as THREE from "three";
import { GameWorld, HumanoidMotion, HumanoidAnimationProjector } from "../src/index";

function projector(rootMotion = false): HumanoidAnimationProjector {
  const clips = ["Idle_Loop", "Walk_Loop", "Jog_Fwd_Loop", "Swim_Fwd_Loop", "Sword_Attack"]
    .map(name => new THREE.AnimationClip(name, 1, []));
  return new HumanoidAnimationProjector({
    model: new THREE.Group(), clips, rootMotion,
    skeletonSignature: "compatibility-signature", transitionSeconds: 0,
  });
}

describe("humanoid semantic motion -> presentation projection", () => {
  test("reads Koota truth; does not mutate ECS position or semantic motion", () => {
    const world = new GameWorld();
    const entity = world.spawnEntity({
      id: "hero", transform: { position: [3, 2, 1] },
      motion: { state: "idle" }, tags: ["player"],
    });
    const visual = projector();
    try {
      expect(visual.updateFromWorld(world, "hero", 1 / 60).clip).toBe("Idle_Loop");
      entity.set(HumanoidMotion, { state: "walk", rate: 1.25 });
      expect(visual.updateFromWorld(world, "hero", 1 / 60).clip).toBe("Walk_Loop");
      expect(entity.get(HumanoidMotion)?.state).toBe("walk");
      expect(world.takeSemanticSnapshot().entities[0].transform?.position).toEqual([3, 2, 1]);
      expect(world.takeSemanticSnapshot().entities[0].humanoidMotion?.rate).toBe(1.25);
      expect(visual.observe().rootMotion).toBe(false);
    } finally { visual.dispose(); }
  });

  test("semantic state survives snapshot/restore without Three.js objects", () => {
    const original = new GameWorld();
    original.spawnEntity({ id: "enemy", motion: { state: "sword-attack", rate: 1 } });
    const restored = new GameWorld();
    restored.restoreSemanticSnapshot(JSON.parse(JSON.stringify(original.takeSemanticSnapshot())));
    expect(restored.getEntity("enemy")?.get(HumanoidMotion)?.state).toBe("sword-attack");
    restored.assertNoProviderObjectsInState();
  });

  test("rejects root-motion before it can bypass physics state authority", () => {
    expect(() => projector(true)).toThrow("ROOT_MOTION_NOT_AUTHORITATIVE");
  });

  test("missing clips/invalid delta are explicit failures", () => {
    const visual = projector();
    try {
      expect(() => visual.update({ state: "climb" }, 1 / 60)).toThrow("No compatible clip");
      expect(() => visual.update({ state: "idle" }, Number.NaN)).toThrow("Invalid animation");
    } finally { visual.dispose(); }
  });

  test("cannot instantiate a character without idle fallback", () => {
    expect(() => new HumanoidAnimationProjector({
      model: new THREE.Group(), clips: [new THREE.AnimationClip("Walk_Loop", 1, [])],
    })).toThrow("Idle_Loop");
  });
});
