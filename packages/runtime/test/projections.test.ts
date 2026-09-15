import { describe, it, expect, beforeEach } from "bun:test";
import * as THREE from "three";
import {
  GameWorld,
  Transform,
  RenderProjectionHandle,
  AssetBinding,
  ProjectionRegistry,
  MultiProjectionCoordinator,
  RenderProjectionManager,
  AssetAffordanceFilter,
  type RawAssetAffordanceManifest,
  type GameBindingSpecification,
} from "../src/index";

describe("Runtime Projection Correlation & Affordance Isolation Suite (T08 - REQ-RUNTIME-002, REQ-RUNTIME-003)", () => {
  let gameWorld: GameWorld;
  let renderManager: RenderProjectionManager;
  let coordinator: MultiProjectionCoordinator;

  beforeEach(() => {
    gameWorld = new GameWorld();
    renderManager = new RenderProjectionManager();
    coordinator = new MultiProjectionCoordinator();
  });

  it("maintains stable IDs correlating entities across render, physics, navigation, and audio projections", () => {
    const entityId = "unit-tank-01";
    gameWorld.spawnEntity({
      id: entityId,
      transform: { position: [10, 0, 10] },
      renderHandle: { handleId: "render-tank-01" },
      physicsHandle: { handleId: "phys-tank-01", bodyType: "dynamic" },
      navHandle: { handleId: "nav-tank-01", radius: 1.5 },
    });

    // Register projections across domains
    const mockMesh = new THREE.Mesh();
    const mockRigidBody = { handle: "rb-1234", type: "dynamic" };
    const mockNavAgent = { agentId: 42, radius: 1.5 };
    const mockAudioEmitter = { sound: "engine_loop", playing: true };

    coordinator.render.register(entityId, "render-tank-01", mockMesh);
    coordinator.physics.register(entityId, "phys-tank-01", mockRigidBody);
    coordinator.navigation.register(entityId, "nav-tank-01", mockNavAgent);
    coordinator.audio.register(entityId, "audio-tank-01", mockAudioEmitter);

    // Correlate by stable entityId
    const projections = coordinator.correlate(entityId);
    expect(projections.entityId).toBe(entityId);
    expect(projections.render).toBe(mockMesh);
    expect(projections.physics).toBe(mockRigidBody);
    expect(projections.navigation).toBe(mockNavAgent);
    expect(projections.audio).toBe(mockAudioEmitter);

    // Reverse lookup by handleId
    expect(coordinator.render.getEntityId("render-tank-01")).toBe(entityId);
    expect(coordinator.physics.getEntityId("phys-tank-01")).toBe(entityId);
    expect(coordinator.navigation.getEntityId("nav-tank-01")).toBe(entityId);
  });

  it("TEETH-T08-002: Delete a render projection while the Koota entity remains alive (Teeth Check)", () => {
    const entityId = "survivor-entity";
    const entity = gameWorld.spawnEntity({
      id: entityId,
      transform: { position: [42, 0, 84], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      renderHandle: { handleId: "render-survivor-1", visible: true },
    });

    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    scene.add(mesh);
    renderManager.bind(entityId, "render-survivor-1", mesh);
    renderManager.syncFromState(gameWorld);

    expect(renderManager.registry.has(entityId)).toBe(true);
    expect(scene.children.includes(mesh)).toBe(true);

    // ATTACK: Destroy/delete the visual render projection completely
    const destroyed = renderManager.destroyProjection(entityId);
    expect(destroyed).toBe(true);
    expect(scene.children.includes(mesh)).toBe(false);
    expect(renderManager.registry.has(entityId)).toBe(false);

    // VERIFICATION: Game semantics in Koota remain 100% alive, uncorrupted, and intact!
    expect(gameWorld.hasEntity(entityId)).toBe(true);
    const semanticTransform = entity.get(Transform);
    expect(semanticTransform?.position).toEqual([42, 0, 84]);
    const semanticRenderHandle = entity.get(RenderProjectionHandle);
    expect(semanticRenderHandle?.handleId).toBe("render-survivor-1");

    // VERIFICATION: Projection can be recreated and re-correlated cleanly from authoritative state
    const recreatedMesh = renderManager.recreateProjection(
      entityId,
      () => new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()),
      gameWorld,
      scene
    );

    expect(scene.children.includes(recreatedMesh)).toBe(true);
    expect(renderManager.registry.has(entityId)).toBe(true);
    expect(recreatedMesh.position.x).toBe(42);
    expect(recreatedMesh.position.z).toBe(84);
  });

  it("TEETH-T08-003: Asset affordance isolation prevents raw asset metadata from polluting game semantics (Teeth Check)", () => {
    // Sourced asset exposing many rich nodes, sockets, and colliders (e.g. from glTF / Blender / 3dviz)
    const rawAsset: RawAssetAffordanceManifest = {
      assetId: "mech_heavy_v2",
      nodes: [
        { name: "Root" },
        { name: "Cockpit" },
        { name: "Turret" },
        { name: "LeftArm" },
        { name: "RightArm" },
      ],
      sockets: [
        { name: "socket_weapon_primary", position: [1, 0, 0], rotation: [0, 0, 0, 1] },
        { name: "socket_weapon_secondary", position: [-1, 0, 0], rotation: [0, 0, 0, 1] },
        { name: "socket_exhaust_left", position: [0, 1, -1], rotation: [0, 0, 0, 1] },
        { name: "socket_exhaust_right", position: [0, 1, -1], rotation: [0, 0, 0, 1] },
        { name: "socket_pilot_seat", position: [0, 0.5, 0], rotation: [0, 0, 0, 1] },
      ],
      colliders: [
        { name: "col_chassis_box", type: "box", dimensions: [2, 1, 3] },
        { name: "col_cockpit_sphere", type: "sphere", dimensions: [1] },
        { name: "col_decorative_antennae", type: "capsule", dimensions: [0.1, 1] },
        { name: "col_fender_left", type: "box", dimensions: [0.5, 0.5, 1] },
        { name: "col_fender_right", type: "box", dimensions: [0.5, 0.5, 1] },
      ],
      destructionGroups: ["armor_plates", "weapons", "chassis"],
      rigs: [{ name: "mech_skeleton", boneCount: 24 }],
    };

    // Explicit game binding: only select the primary weapon socket and chassis collider
    const bindingConfig: GameBindingSpecification = {
      acceptedSockets: {
        socket_weapon_primary: "slot_primary_weapon",
      },
      acceptedColliders: ["col_chassis_box"],
      acceptedDestructionGroups: ["armor_plates"],
    };

    const filterResult = AssetAffordanceFilter.filterAffordances(rawAsset, bindingConfig);

    // Filter verification
    expect(filterResult.boundSockets).toEqual({ socket_weapon_primary: "slot_primary_weapon" });
    expect(filterResult.activeColliders).toEqual(["col_chassis_box"]);
    expect(filterResult.activeDestructionGroups).toEqual(["armor_plates"]);

    // Inert affordances are quarantined and NOT promoted
    expect(filterResult.inertAffordances.unboundSockets).toContain("socket_weapon_secondary");
    expect(filterResult.inertAffordances.unboundSockets).toContain("socket_pilot_seat");
    expect(filterResult.inertAffordances.unboundColliders).toContain("col_decorative_antennae");
    expect(filterResult.inertAffordances.unboundNodes.length).toBe(5);

    // Apply to Koota entity
    const entity = gameWorld.spawnEntity({
      id: "mech-01",
      transform: { position: [0, 0, 0] },
    });

    AssetAffordanceFilter.bindToEntity(entity, filterResult);

    // Verify entity in Koota has ONLY the explicitly bound affordances
    const assetBinding = entity.get(AssetBinding);
    expect(assetBinding?.assetId).toBe("mech_heavy_v2");
    expect(assetBinding?.boundSockets).toEqual({ socket_weapon_primary: "slot_primary_weapon" });
    expect(assetBinding?.activeColliders).toEqual(["col_chassis_box"]);

    // Unaccepted affordances are NOT present in entity state
    expect(assetBinding?.boundSockets["socket_pilot_seat"]).toBeUndefined();
    expect(assetBinding?.activeColliders.includes("col_decorative_antennae")).toBe(false);
  });

  it("cleans up multi-projection registry on entity despawn without residual handles", () => {
    const entityId = "ephemeral-drone";
    gameWorld.spawnEntity({ id: entityId });

    coordinator.render.register(entityId, "r-1", new THREE.Mesh());
    coordinator.physics.register(entityId, "p-1", { body: 1 });
    coordinator.navigation.register(entityId, "n-1", { agent: 1 });

    expect(coordinator.render.has(entityId)).toBe(true);
    expect(coordinator.physics.has(entityId)).toBe(true);

    const unregistered = coordinator.unregisterAll(entityId);
    expect(unregistered.render).toBeDefined();
    expect(unregistered.physics).toBeDefined();
    expect(unregistered.navigation).toBeDefined();

    expect(coordinator.render.has(entityId)).toBe(false);
    expect(coordinator.physics.has(entityId)).toBe(false);
    expect(coordinator.navigation.has(entityId)).toBe(false);
  });
});
