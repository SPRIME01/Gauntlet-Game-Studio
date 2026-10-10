import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import type { AssetRecord } from "@gauntlet/contracts";
import type { GameWorld } from "../state/world";
import { RenderProjectionManager } from "./render";
import { HumanoidAnimationProjector, type HumanoidAnimationObservation } from "./humanoid-animation";

/**
 * Runtime composition of *accepted* project assets, not raw catalog derivatives.
 * Loading/import stays separate from Koota authority, and fails before spawning
 * entities if the model/animation contract is incompatible.
 */
export interface HumanoidPrefabAsset {
  asset: AssetRecord;
  url: string; // explicit project-owned URL; never remote URL guessed from a query
}
export interface SpawnHumanoidPrefabOptions {
  world: GameWorld;
  scene: THREE.Object3D;
  render: RenderProjectionManager;
  entityId: string;
  model: HumanoidPrefabAsset;
  animations: readonly HumanoidPrefabAsset[];
  position?: [number, number, number];
  tags?: Array<"player" | "enemy">;
  /** Injectible loader for headless tests and application-owned fetch policy. */
  loader?: Pick<GLTFLoader, "loadAsync">;
  blendSeconds?: number;
}
export interface HumanoidPrefabInstance {
  model: THREE.Object3D;
  playerId: string;
  projector: HumanoidAnimationProjector;
  update(dt: number): HumanoidAnimationObservation;
  /** Cleans up visual resources and ECS entity when finished. */
  dispose(): void;
}

function signature(asset: AssetRecord): string {
  const sig = asset.animation_contract?.["skeleton_sha256"];
  if (typeof sig !== "string" || !/^[0-9a-f]{64}$/.test(sig)) {
    throw new Error("FOUNDATION_RIG_SIGNATURE_MISSING for " + asset.id);
  }
  return sig;
}

function assertAccepted(subject: HumanoidPrefabAsset): void {
  if (subject.asset.acceptance_state !== "accepted") {
    throw new Error("FOUNDATION_ASSET_NOT_ACCEPTED: " + subject.asset.id);
  }
  if (!subject.url || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(subject.url) ||
      subject.url.includes("\\\\") || subject.url.split(/[?#]/)[0].split("/").includes("..")) {
    // The caller must provide an explicitly controlled same-origin project URL.
    throw new Error("FOUNDATION_ASSET_URL_NOT_LOCAL: " + subject.asset.id);
  }
}

export async function spawnHumanoidPrefab(options: SpawnHumanoidPrefabOptions): Promise<HumanoidPrefabInstance> {
  if (!options.entityId || options.world.hasEntity(options.entityId)) {
    throw new Error("FOUNDATION_ENTITY_ID_UNAVAILABLE");
  }
  assertAccepted(options.model);
  for (const item of options.animations) assertAccepted(item);
  if (options.animations.length < 1) throw new Error("FOUNDATION_ANIMATION_REQUIRED");
  const rig = signature(options.model.asset);
  if (options.model.asset.animation_contract?.["kind"] !== "character") {
    throw new Error("FOUNDATION_MODEL_KIND_MISMATCH");
  }
  for (const item of options.animations) {
    if (signature(item.asset) !== rig ||
        item.asset.animation_contract?.["kind"] !== "animation-library") {
      throw new Error("FOUNDATION_RIG_MISMATCH: " + item.asset.id);
    }
    if (item.asset.animation_contract?.["root_motion"] !== false) {
      throw new Error("ROOT_MOTION_NOT_AUTHORITATIVE: " + item.asset.id);
    }
  }
  const loader = options.loader ?? new GLTFLoader();
  // Loading/preflight must precede all ECS/scene mutations.
  const loadedModel: GLTF = await loader.loadAsync(options.model.url);
  const libraries: GLTF[] = await Promise.all(options.animations.map(item => loader.loadAsync(item.url)));
  const clipMap = new Map<string, THREE.AnimationClip>();
  for (const lib of libraries) {
    for (const clip of lib.animations) if (!clipMap.has(clip.name)) clipMap.set(clip.name, clip);
  }
  // The Standard library guarantees Idle_Loop in UAL1 but not necessarily UAL2.
  const model = loadedModel.scene;
  const projector = new HumanoidAnimationProjector({
    model, clips: [...clipMap.values()], rootMotion: false,
    skeletonSignature: rig, transitionSeconds: options.blendSeconds,
  });
  const handleId = "humanoid:" + options.entityId;
  let createdEntity = false;
  try {
    options.world.spawnEntity({
      id: options.entityId,
      transform: { position: options.position ?? [0, 0, 0] },
      renderHandle: { handleId, castShadow: true, receiveShadow: true },
      assetBinding: { assetId: options.model.asset.id },
      motion: { state: "idle", rate: 1 },
      tags: options.tags ?? ["player"],
    });
    createdEntity = true;
    options.scene.add(model);
    options.render.bind(options.entityId, handleId, model);
  } catch (error) {
    projector.dispose();
    if (createdEntity) {
      options.scene.remove(model);
      options.world.despawnEntity(options.entityId);
    }
    throw error;
  }
  let disposed = false;
  return {
    model, playerId: options.entityId, projector,
    update(dt) {
      if (disposed) throw new Error("FOUNDATION_PREFAB_DISPOSED");
      return projector.updateFromWorld(options.world, options.entityId, dt);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      projector.dispose();
      options.render.destroyProjection(options.entityId);
      options.world.despawnEntity(options.entityId);
      // Do not dispose shared geometry/material/texture here: asset lifetime is owned by loader/cache.
    },
  };
}
