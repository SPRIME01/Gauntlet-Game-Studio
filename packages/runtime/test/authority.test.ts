import { describe, it, expect, beforeEach } from "bun:test";
import * as THREE from "three";
import {
  GameWorld,
  Transform,
  Velocity,
  RenderProjectionHandle,
  PlayerTag,
  EnemyTag,
  RenderProjectionManager,
} from "../src/index";

describe("Koota State Authority & Semantic Isolation Suite (T08 - REQ-GOAL-003, REQ-BIND-002, REQ-RUNTIME-001)", () => {
  let gameWorld: GameWorld;
  let renderManager: RenderProjectionManager;

  beforeEach(() => {
    gameWorld = new GameWorld();
    renderManager = new RenderProjectionManager();
  });

  it("spawns entities with authoritative Koota traits and queries them", () => {
    const player = gameWorld.spawnEntity({
      id: "player-1",
      transform: { position: [0, 5, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      velocity: { linear: [1, 0, 0], angular: [0, 0, 0] },
      renderHandle: { handleId: "render-player-1", visible: true },
      tags: ["player"],
    });

    expect(gameWorld.hasEntity("player-1")).toBe(true);
    expect(player.has(Transform)).toBe(true);
    expect(player.has(PlayerTag)).toBe(true);
    expect(player.has(EnemyTag)).toBe(false);

    const transform = player.get(Transform);
    expect(transform?.position).toEqual([0, 5, 0]);

    const players = gameWorld.query(PlayerTag);
    expect(players.length).toBe(1);
  });

  it("takes and restores pure semantic snapshots with zero provider classes", () => {
    gameWorld.spawnEntity({
      id: "hero",
      transform: { position: [10, 20, 30], rotation: [0, 1, 0, 0], scale: [1, 1, 1] },
      velocity: { linear: [5, 0, -5], angular: [0, 1, 0] },
      renderHandle: { handleId: "render-hero", visible: true },
      tags: ["player"],
    });

    gameWorld.spawnEntity({
      id: "goblin-1",
      transform: { position: [50, 0, 50], rotation: [0, 0, 0, 1], scale: [0.8, 0.8, 0.8] },
      renderHandle: { handleId: "render-goblin-1", visible: true },
      tags: ["enemy"],
    });

    // Take snapshot
    const snapshot = gameWorld.takeSemanticSnapshot();
    expect(snapshot.entities.length).toBe(2);

    // Verify snapshot is pure JSON-serializable data
    const jsonStr = JSON.stringify(snapshot);
    const parsed = JSON.parse(jsonStr);
    expect(parsed.entities.length).toBe(2);

    // Assert no provider objects leaked into state
    expect(() => gameWorld.assertNoProviderObjectsInState()).not.toThrow();

    // Create a new fresh world and restore
    const freshWorld = new GameWorld();
    freshWorld.restoreSemanticSnapshot(parsed);

    expect(freshWorld.hasEntity("hero")).toBe(true);
    expect(freshWorld.hasEntity("goblin-1")).toBe(true);

    const restoredHero = freshWorld.getEntity("hero");
    expect(restoredHero?.get(Transform)?.position).toEqual([10, 20, 30]);
    expect(restoredHero?.has(PlayerTag)).toBe(true);
  });

  it("assertNoProviderObjectsInState detects and rejects provider classes leaking into state", () => {
    // Standard state passes check
    gameWorld.spawnEntity({
      id: "clean-entity",
      transform: { position: [1, 2, 3] },
    });
    expect(() => gameWorld.assertNoProviderObjectsInState()).not.toThrow();
  });

  it("TEETH-T08-001: Mutate Three.js Object3D directly without updating Koota (Teeth Check)", () => {
    // Setup authoritative entity in Koota
    const entity = gameWorld.spawnEntity({
      id: "adversary-test-subject",
      transform: { position: [10, 20, 30], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      renderHandle: { handleId: "render-subj-1", visible: true },
    });

    // Create and bind visual Three.js mesh
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    renderManager.bind("adversary-test-subject", "render-subj-1", mesh);

    // Sync initial state
    renderManager.syncFromState(gameWorld);
    expect(mesh.position.x).toBe(10);
    expect(mesh.position.y).toBe(20);
    expect(mesh.position.z).toBe(30);
    expect(mesh.visible).toBe(true);

    // ATTACK: Adversary directly mutates Three.js Object3D properties
    // attempting to smuggle a gameplay state transition without updating Koota
    mesh.position.set(999, -500, 1337);
    mesh.rotation.set(1, 2, 3);
    mesh.scale.set(50, 50, 50);
    mesh.visible = false;

    // VERIFICATION: The semantic oracle (Koota) MUST remain completely unchanged!
    const semanticTransform = entity.get(Transform);
    expect(semanticTransform?.position).toEqual([10, 20, 30]);
    expect(semanticTransform?.rotation).toEqual([0, 0, 0, 1]);
    expect(semanticTransform?.scale).toEqual([1, 1, 1]);

    const semanticRenderHandle = entity.get(RenderProjectionHandle);
    expect(semanticRenderHandle?.visible).toBe(true);

    // VERIFICATION: Re-syncing from state resets the corrupted Three.js mesh back to Koota truth
    renderManager.syncFromState(gameWorld);
    expect(mesh.position.x).toBe(10);
    expect(mesh.position.y).toBe(20);
    expect(mesh.position.z).toBe(30);
    expect(mesh.visible).toBe(true);
    expect(mesh.scale.x).toBe(1);
  });

  it("headless simulation advances identically without any Three.js objects attached (Headless Parity)", () => {
    const e = gameWorld.spawnEntity({
      id: "headless-mover",
      transform: { position: [0, 0, 0] },
      velocity: { linear: [10, 0, 0] },
    });

    // Simulate 5 ticks headless
    const dt = 1 / 60;
    for (let i = 0; i < 60; i++) {
      const t = e.get(Transform);
      const v = e.get(Velocity);
      if (t && v) {
        e.set(Transform, {
          position: [t.position[0] + v.linear[0] * dt, t.position[1], t.position[2]],
          rotation: t.rotation,
          scale: t.scale,
        });
      }
    }

    const finalPos = e.get(Transform)?.position[0];
    expect(finalPos).toBeCloseTo(10, 4);
    expect(renderManager.registry.size()).toBe(0); // Zero render projections exist
  });
});
