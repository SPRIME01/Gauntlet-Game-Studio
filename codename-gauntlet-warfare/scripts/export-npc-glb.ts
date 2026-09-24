// Minimal FileReader shim for Bun: GLTFExporter reads blobs through it.
(globalThis as any).FileReader = class {
  readAsArrayBuffer(blob: any) {
    const fr: any = this;
    blob.arrayBuffer().then((ab: ArrayBuffer) => {
      fr.result = ab;
      fr.onloadend?.({ target: fr });
      fr.onload?.({ target: fr });
    });
  }
  readAsDataURL(blob: any) {
    blob.arrayBuffer().then((ab: ArrayBuffer) => {
      const bytes = new Uint8Array(ab);
      let bin = "";
      for (const b of bytes) bin += String.fromCharCode(b);
      const fr: any = this;
      fr.result = "data:application/octet-stream;base64," + btoa(bin);
      fr.onloadend?.({ target: fr });
      fr.onload?.({ target: fr });
    });
  }
};

import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { createTacticalOperatorNPCModel } from "../src/assets/operator-npc";

// Deterministic GLB export of the operator NPC for Blender rigging.
// Normalizes the spec frame (crown origin, unit height) to Blender ergonomics:
// 1.8 m tall, feet at the origin, +Y up.
const model = createTacticalOperatorNPCModel({ qualityPriority: "reference-fidelity" });
const root = new THREE.Group();
root.name = "operator-npc";
root.add(model);
root.scale.setScalar(1.8);
model.position.set(0, 0.9, 0); // spec frame spans y [-1, 0]; lift feet to z=0 after scaling

const scene = new THREE.Scene();
scene.add(root);

// GLTFExporter's binary path needs the browser FileReader; Bun lacks it, so export
// JSON glTF with an embedded base64 buffer (imports identically into Blender).
const out = new URL("../assets/operator-npc.gltf", import.meta.url).pathname;
new GLTFExporter().parse(
  scene,
  (raw) => {
    // Deduplicate skins: three.js emits one skin per skinned mesh even when they
    // share the same joint set; Blender's importer emits a placeholder object per
    // redundant skin. Keep the first, remap every node to it.
    const gltf = raw as { skins: Array<unknown>; nodes: Array<{ skin?: number }> };
    const skins = gltf.skins ?? [];
    if (skins.length > 1) {
      for (const node of gltf.nodes) {
        if (node.skin !== undefined) node.skin = 0;
      }
      gltf.skins = [skins[0]];
    }
    Bun.write(out, JSON.stringify(gltf)).then(() => {
      console.log(JSON.stringify({ out, bytes: JSON.stringify(gltf as object).length, skins: gltf.skins.length }));
    });
  },
  (err) => {
    console.error(String(err));
    process.exit(1);
  },
  { binary: false },
);
