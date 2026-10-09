/**
 * Browser-only proof of real Quaternius glTF/GLB in Gauntlet's actual runtime.
 * Driven by Playwright from run.ts. Never promotes source assets to production.
 */
import * as THREE from "three";
import { GameWorld } from "../../src/state/world";
import { HumanoidMotion, type HumanoidMotionState } from "../../src/state/traits";
import { RenderProjectionManager } from "../../src/projections/render";
import { spawnHumanoidPrefab, type HumanoidPrefabAsset } from "../../src/projections/humanoid-prefab";
import { applyLightingPreset } from "../../src/projections/lighting-presets";

interface CatalogAsset {
  id: string;
  kind: string;
  path: string;
  skeleton_sha256: string;
  root_motion: boolean;
  animation_clips: string[];
}
interface Catalog {
  assets: CatalogAsset[];
  license: string;
}
interface PoseEvidence {
  state: string;
  clip: string | null;
  pixels: number;
  renderCalls: number;
  triangles: number;
  skinMeshes: number;
  bones: number;
  animatedBones: number;
  position: number[];
  targetPosition: number[];
  averageMs: number;
  maxMs: number;
  signature: string | null;
}
declare global {
  interface Window {
    __gauntletFoundation?: {
      ready: boolean;
      error?: string;
      sample: (state: HumanoidMotionState, frames: number) => PoseEvidence;
      provenance: string[];
      gender: string;
    };
  }
}

const params = new URLSearchParams(location.search);
const gender = params.get("gender") === "male" ? "male" : "female";
const probe: NonNullable<Window["__gauntletFoundation"]> = {
  ready: false,
  provenance: [],
  gender,
  sample: () => { throw new Error("Foundation scene not ready"); },
};
window.__gauntletFoundation = probe;

function getRequired(catalog: Catalog, predicate: (asset: CatalogAsset) => boolean, label: string): CatalogAsset {
  const found = catalog.assets.find(predicate);
  if (!found) throw new Error("ACTUAL_SOURCE_ASSET_MISSING: " + label);
  return found;
}

function fixtureAsset(asset: CatalogAsset): HumanoidPrefabAsset {
  // Only the evidence harness uses a synthetic accepted record, after its input
  // importer has validated source hashes. This is NOT a production acceptance.
  const kind = asset.kind;
  return {
    asset: {
      id: asset.id,
      role: kind,
      origin: "cc0",
      construction_route: "verification-fixture/not-production",
      source_provenance: { license: "CC0-1.0", author: "Quaternius", sha256: "f".repeat(64) },
      runtime_representation: asset.path,
      budget: {},
      acceptance_state: "accepted",
      animation_contract: {
        kind, skeleton_sha256: asset.skeleton_sha256, root_motion: asset.root_motion,
      },
    },
    url: "/raw/" + asset.path.split("/").map(encodeURIComponent).join("/"),
  };
}

function countVisualPixels(canvas: HTMLCanvasElement): number {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return 0;
  const sample = document.createElement("canvas");
  sample.width = 80;
  sample.height = 80;
  const c = sample.getContext("2d", { willReadFrequently: true });
  if (!c) return 0;
  c.drawImage(canvas, 0, 0, 80, 80);
  const data = c.getImageData(0, 0, 80, 80).data;
  let foreground = 0;
  // Neutral studio background ~#cbd7e0. Detect foreground via color distance.
  for (let i = 0; i < data.length; i += 4) {
    const dist = Math.abs(data[i] - 203) + Math.abs(data[i + 1] - 215) + Math.abs(data[i + 2] - 224);
    if (dist > 95 && data[i + 3] > 0) foreground++;
  }
  return foreground;
}

function bonePose(model: THREE.Object3D): Map<string, number[]> {
  const poses = new Map<string, number[]>();
  model.traverse((o) => {
    if ((o as THREE.Bone).isBone) {
      const bone = o as THREE.Bone;
      poses.set(bone.name, [...bone.quaternion.toArray(), ...bone.position.toArray()]);
    }
  });
  return poses;
}
function poseDifference(a: Map<string, number[]>, b: Map<string, number[]>): number {
  let changed = 0;
  for (const [name, pose] of b) {
    const reference = a.get(name);
    if (!reference) continue;
    if (pose.some((value, i) => Math.abs(value - reference[i]) > 1e-4)) changed++;
  }
  return changed;
}

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>("#stage");
  if (!canvas) throw new Error("Stage canvas missing");
  const inventory = (await (await fetch("/inventory.json")).json()) as Catalog;
  const modelAsset = getRequired(inventory,
    a => a.kind === "character" && a.id.toLowerCase().split(/[._-]+/).includes(gender), gender + " body");
  const first = getRequired(inventory,
    a => a.kind === "animation-library" && a.id.includes("animations-1") && !a.root_motion, "UAL1 in-place");
  const second = getRequired(inventory,
    a => a.kind === "animation-library" && a.id.includes("animations-2") && !a.root_motion, "UAL2 in-place");
  probe.provenance = [modelAsset.id, first.id, second.id];

  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: "low-power",
  });
  renderer.setPixelRatio(1);
  renderer.setSize(720, 720, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  const lights = applyLightingPreset(scene, { preset: "neutral-studio", quality: "mobile" });
  const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 150);
  camera.position.set(2.8, 1.55, 3.1);
  camera.lookAt(0, 0.95, 0);
  const world = new GameWorld();
  const render = new RenderProjectionManager();
  const character = await spawnHumanoidPrefab({
    world, scene, render, entityId: "test-hero",
    model: fixtureAsset(modelAsset),
    animations: [fixtureAsset(first), fixtureAsset(second)],
    position: [0, 0, 0],
  });
  let skinMeshes = 0;
  character.model.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinMeshes++; });
  if (!skinMeshes) throw new Error("Imported character has no skinned meshes");

  // Resolve skeletal animation tracks to this character, not an external
  // donor scene. Unknown tracks otherwise generate PropertyBinding warnings.
  const rest = bonePose(character.model);
  const entity = world.getEntity("test-hero");
  if (!entity) throw new Error("Missing authoritative Koota player");

  probe.sample = (state: HumanoidMotionState, frames: number): PoseEvidence => {
    if (frames < 1 || frames > 240) throw new Error("Invalid sample frame count");
    const before = world.takeSemanticSnapshot().entities[0];
    entity.set(HumanoidMotion, { state, rate: 1 });
    let averageMs = 0;
    let maxMs = 0;
    for (let i = 0; i < frames; i++) {
      const t0 = performance.now();
      render.syncFromState(world);
      character.update(1 / 60);
      renderer.render(scene, camera);
      const ms = performance.now() - t0;
      averageMs += ms;
      maxMs = Math.max(maxMs, ms);
    }
    const after = world.takeSemanticSnapshot().entities[0];
    if (JSON.stringify(before.transform) !== JSON.stringify(after.transform)) {
      throw new Error("Animation mutated authoritative Koota transform");
    }
    const current = bonePose(character.model);
    const observation = character.projector.observe();
    const info = renderer.info.render;
    return {
      state,
      clip: observation.clip,
      pixels: countVisualPixels(canvas),
      renderCalls: info.calls,
      triangles: info.triangles,
      skinMeshes,
      bones: current.size,
      animatedBones: poseDifference(rest, current),
      position: after.transform?.position ?? [],
      targetPosition: [0, 0, 0],
      averageMs: averageMs / frames,
      maxMs,
      signature: observation.skeletonSignature,
    };
  };
  probe.ready = true;
  window.addEventListener("beforeunload", () => { character.dispose(); lights.dispose(); renderer.dispose(); });
}

boot().catch(e => { probe.error = e?.stack || String(e); console.error("FOUNDATION_BROWSER_FAILURE", probe.error); });
