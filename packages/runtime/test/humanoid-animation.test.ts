import { describe, test, expect, afterEach } from "bun:test";
import * as THREE from "three";
import { GameWorld, HumanoidMotion, HumanoidAnimationProjector } from "../src/index";

const worlds: GameWorld[] = [];
function testWorld(): GameWorld {
  const world = new GameWorld();
  worlds.push(world);
  return world;
}
afterEach(() => {
  for (const world of worlds.splice(0)) world.world.destroy();
});

function projector(rootMotion = false): HumanoidAnimationProjector {
  const clips = ["Idle_Loop", "Walk_Loop", "Jog_Fwd_Loop", "Swim_Fwd_Loop", "Sword_Attack"]
    .map(name => new THREE.AnimationClip(name, 1, []));
  const model = new THREE.Group();
  model.animations = clips;
  return new HumanoidAnimationProjector({
    model, clips, rootMotion,
    skeletonSignature: "compatibility-signature", transitionSeconds: 0,
  });
}

describe("humanoid semantic motion -> presentation projection", () => {
  test("reads Koota truth; does not mutate ECS position or semantic motion", () => {
    const world = testWorld();
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
    const original = testWorld();
    original.spawnEntity({ id: "enemy", motion: { state: "sword-attack", rate: 1, trigger: 7 } });
    const snapshot = JSON.parse(JSON.stringify(original.takeSemanticSnapshot()));
    original.getEntity("enemy")!.set(HumanoidMotion, { state: "idle", trigger: 8 });
    original.restoreSemanticSnapshot(snapshot);
    expect(original.getEntity("enemy")?.get(HumanoidMotion)?.state).toBe("sword-attack");
    expect(original.getEntity("enemy")?.get(HumanoidMotion)?.trigger).toBe(7);
    original.assertNoProviderObjectsInState();
  });

  test("new one-shot requests restart the same action, including after completion", () => {
    const world = testWorld();
    const entity = world.spawnEntity({ id: "hero", motion: { state: "sword-attack" } });
    const visual = projector();
    try {
      visual.updateFromWorld(world, "hero", 0.4);
      const action = visual.mixer.existingAction("Sword_Attack")!;
      visual.updateFromWorld(world, "hero", 0.2);
      expect(action.time).toBeCloseTo(0.6);
      entity.set(HumanoidMotion, { trigger: entity.get(HumanoidMotion)!.trigger + 1 });
      visual.updateFromWorld(world, "hero", 0.1);
      expect(action.time).toBeCloseTo(0.1);
      expect(visual.observe().time).toBeCloseTo(0.1);
      visual.updateFromWorld(world, "hero", 1);
      expect(action.paused).toBe(true);
      visual.updateFromWorld(world, "hero", 0.1);
      expect(action.time).toBe(1);
      entity.set(HumanoidMotion, { trigger: entity.get(HumanoidMotion)!.trigger + 1 });
      visual.updateFromWorld(world, "hero", 0.1);
      expect(action.paused).toBe(false);
      expect(action.time).toBeCloseTo(0.1);
      expect(entity.get(HumanoidMotion)?.trigger).toBe(2);
    } finally { visual.dispose(); }
  });

  test("looping motion continues when the request counter changes", () => {
    const visual = projector();
    try {
      visual.update({ state: "walk", trigger: 1 }, 0.3);
      visual.update({ state: "walk", trigger: 2 }, 0.2);
      expect(visual.mixer.existingAction("Walk_Loop")!.time).toBeCloseTo(0.5);
    } finally { visual.dispose(); }
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
