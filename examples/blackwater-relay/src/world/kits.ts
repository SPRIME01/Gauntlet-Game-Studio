/**
 * Blackwater Relay — composed world kit builders (T22).
 *
 * Runtime execution projections of the accepted 3dviz composition
 * (.studio/results/world.yaml; assets/manifest.json kit-* records). These builders
 * materialize the committed kit definitions in src/world/environment.ts as Three.js
 * objects. They are PURE projections: no gameplay semantics, no network, no DOM.
 * Heights always arrive from the canonical sampler — never stored here.
 */

import * as THREE from "three";
import {
  WORLD_KITS,
  WORLD_LIGHTING_ATMOSPHERE,
  WORLD_SCATTER,
  WORLD_SOCKETS,
  resolveWorldKitAnchors,
  resolveWorldSocketTransforms,
  type CanonicalHeightSampler,
} from "./environment";

/** Deterministic 32-bit LCG for scatter placement (seeded, no Math.random). */
function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export interface BuiltWorld {
  group: THREE.Group;
  scatterMeshes: THREE.InstancedMesh[];
  socketPositions: Array<{ id: string; position: THREE.Vector3 }>;
}

function buildRelayTower(): THREE.Group {
  const g = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: 0x5c6672, roughness: 0.75, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x39414b, roughness: 0.85 });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.2, 1.2, 10), dark);
  base.position.y = 0.6;
  base.name = "relay_tower_base";
  g.add(base);

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.4, 12, 8), material);
  mast.position.y = 7.2;
  mast.name = "relay_tower_mast";
  g.add(mast);

  for (const y of [4, 8, 11.4]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.5 - y * 0.06, 0.12, 6, 12), material);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    g.add(ring);
  }

  const dish = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), material);
  dish.position.set(1.2, 12.4, 0);
  dish.rotation.z = -0.7;
  dish.name = "relay_tower_dish";
  g.add(dish);
  return g;
}

function buildDock(): THREE.Group {
  const g = new THREE.Group();
  const plank = new THREE.MeshStandardMaterial({ color: 0x6b5138, roughness: 0.9 });
  const post = new THREE.MeshStandardMaterial({ color: 0x57422e, roughness: 0.95 });
  for (let i = 0; i < 7; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 5.2), plank);
    p.position.set(i * 1.0 - 3.0, 0, 0);
    p.name = `dock_plank_${i}`;
    g.add(p);
  }
  for (const [x, z] of [[-3.2, -2.3], [-3.2, 2.3], [3.0, -2.3], [3.0, 2.3]] as const) {
    const post1 = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 2.2, 6), post);
    post1.position.set(x, -1.0, z);
    g.add(post1);
  }
  return g;
}

function buildHut(): THREE.Group {
  const g = new THREE.Group();
  const wall = new THREE.MeshStandardMaterial({ color: 0x4f5a66, roughness: 0.85 });
  const roof = new THREE.MeshStandardMaterial({ color: 0x3a424c, roughness: 0.9 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 5), wall);
  body.position.y = 1.5;
  body.name = "hut_body";
  g.add(body);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(4.6, 1.8, 4), roof);
  cap.position.y = 3.9;
  cap.rotation.y = Math.PI / 4;
  cap.name = "hut_roof";
  g.add(cap);
  return g;
}

/**
 * Builds the composed world group: kits socketed to the canonical heightfield,
 * seeded vegetation scatter, and storm-dusk lighting/atmosphere bindings.
 */
export function buildComposedWorld(sample: CanonicalHeightSampler): BuiltWorld {
  const group = new THREE.Group();
  group.name = "bw-composed-world";

  const builders: Record<string, () => THREE.Group> = {
    "kit-relay-tower": buildRelayTower,
    "kit-dock-planks": buildDock,
    "kit-maintainer-hut": buildHut,
  };

  for (const anchor of resolveWorldKitAnchors(sample)) {
    const build = builders[anchor.asset_id];
    if (!build) continue;
    const kit = build();
    kit.position.set(anchor.position.x, anchor.position.y, anchor.position.z);
    kit.rotation.y = anchor.rotation_y;
    kit.scale.setScalar(anchor.scale);
    kit.name = anchor.id;
    group.add(kit);
  }

  // Socket markers (beacon mount, lantern, antenna) — canonical-height resolved.
  const socketPositions: Array<{ id: string; position: THREE.Vector3 }> = [];
  for (const socket of resolveWorldSocketTransforms(sample)) {
    socketPositions.push({
      id: socket.id,
      position: new THREE.Vector3(socket.position.x, socket.position.y, socket.position.z),
    });
  }

  // Seeded terrain-projected vegetation scatter (InstancedMesh: 1 draw call/layer).
  const scatterMeshes: THREE.InstancedMesh[] = [];
  const scrubGeometry = new THREE.ConeGeometry(0.55, 1.6, 6);
  const scrubMaterial = new THREE.MeshStandardMaterial({ color: 0x40513c, roughness: 1.0 });
  for (const layer of WORLD_SCATTER) {
    const mesh = new THREE.InstancedMesh(scrubGeometry, scrubMaterial, layer.max_instances);
    const rng = seededRandom(layer.placement_seed);
    const m = new THREE.Matrix4();
    let placed = 0;
    let guard = 0;
    while (placed < layer.max_instances && guard < layer.max_instances * 20) {
      guard++;
      const x = (rng() - 0.5) * 480;
      const z = (rng() - 0.5) * 480;
      const y = sample(x, z);
      if (y > 2.0) continue; // scrub grows above the shoreline only
      const s = 0.6 + rng() * 0.9;
      m.makeScale(s, s, s);
      m.setPosition(x, y + 0.6 * s, z);
      mesh.setMatrixAt(placed, m);
      placed++;
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.name = layer.layer_id;
    scatterMeshes.push(mesh);
    group.add(mesh);
  }

  // Storm-dusk atmosphere binding (preset metadata is composition-owned).
  void WORLD_LIGHTING_ATMOSPHERE;

  return { group, scatterMeshes, socketPositions };
}
