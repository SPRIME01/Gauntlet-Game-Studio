import * as THREE from "three";
import {
  createTacticalOperatorNPCModel,
  createTacticalOperatorNPCLookDevLights,
  createTacticalOperatorNPCEnvironment,
  configureTacticalOperatorNPCRenderer,
} from "../src/assets/operator-npc";

const q = new URLSearchParams(location.search);
const angleDeg = Number(q.get("angle") ?? "0");
const elevDeg = Number(q.get("elev") ?? "6");
const silhouette = q.get("silhouette") === "1";
const wantGeom = q.get("geom") === "1";
const lightMode = (q.get("lights") ?? "neutral") as "neutral" | "grazing" | "reference";

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
configureTacticalOperatorNPCRenderer(renderer);
renderer.setSize(1254, 1254); // square frame matches the reference photo geometry
renderer.setPixelRatio(1);
document.body.style.margin = "0";
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x999999); // mid-gray so white head AND dark gear both read as foreground

const model = createTacticalOperatorNPCModel({ qualityPriority: "reference-fidelity", textureSize: 512 });
scene.add(model);
const rig = (model.userData as any).rig;
const rt = (model.userData as any).sculptRuntime;

if (silhouette) {
  const black = new THREE.MeshBasicMaterial({ color: 0x000000 });
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) { m.material = black; m.castShadow = false; m.receiveShadow = false; }
  });
} else {
  scene.add(createTacticalOperatorNPCLookDevLights(lightMode));
  scene.environment = createTacticalOperatorNPCEnvironment(renderer);
}

const bbox = new THREE.Box3().setFromObject(model);
const size = new THREE.Vector3(); bbox.getSize(size);
const center = new THREE.Vector3(); bbox.getCenter(center);
const fov = 35;
const distance = (size.y / 2) / Math.tan((fov * Math.PI) / 360) * 1.044; // photo framing: subject 97.6% of frame height, 1.1% margins, square frame: subject ~94% of frame height
const a = (angleDeg * Math.PI) / 180;
const camera = new THREE.PerspectiveCamera(fov, 1, 0.05, 60);
camera.position.set(
  center.x - Math.sin(a) * distance,
  center.y + Math.tan((elevDeg * Math.PI) / 180) * distance,
  center.z + Math.cos(a) * distance,
);
camera.lookAt(center.x, center.y, center.z);

let triangles = 0;
const meshRecords: Array<{ name: string; vertices: number[][]; indices: number[] }> = [];
model.updateMatrixWorld(true);
model.traverse((o) => {
  const m = o as THREE.Mesh;
  if (!m.isMesh) return;
  const geo = m.geometry as THREE.BufferGeometry;
  const pos = geo.getAttribute("position");
  triangles += (geo.index ? geo.index.count : pos.count) / 3;
  if (wantGeom) {
    // Weld coincident seam vertices (BoxGeometry duplicates face-edge vertices with float
    // drift); without welding the topology shows false boundary edges and the
    // self-intersection ray parity misclassifies surface vertices.
    const key = (x: number, y: number, z: number) =>
      `${Math.round(x * 1e6)}|${Math.round(y * 1e6)}|${Math.round(z * 1e6)}`;
    const map = new Map<string, number>();
    const v: number[][] = [];
    const remap = new Array<number>(pos.count);
    const p = pos.array as ArrayLike<number>;
    for (let i = 0; i < pos.count; i++) {
      const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
      const k = key(x, y, z);
      let id = map.get(k);
      if (id === undefined) { id = v.length; map.set(k, id); v.push([x, y, z]); }
      remap[i] = id;
    }
    let raw: number[] = [];
    if (geo.index) raw = Array.from(geo.index.array as ArrayLike<number>);
    else for (let i = 0; i < pos.count; i++) raw.push(i);
    const idx: number[] = [];
    for (let t = 0; t < raw.length; t += 3) {
      const a = remap[raw[t]], b = remap[raw[t + 1]], c = remap[raw[t + 2]];
      if (a !== b && b !== c && a !== c) idx.push(a, b, c);
    }
    meshRecords.push({ name: m.name || m.parent?.name || "mesh", vertices: v, indices: idx });
  }
});

renderer.render(scene, camera);

(window as any).npcReview = {
  ready: true,
  triangles: Math.round(triangles),
  drawCalls: renderer.info.render.calls,
  bounds: { min: bbox.min.toArray(), max: bbox.max.toArray(), size: size.toArray() },
  bones: rig?.bones?.length ?? 0,
  rigBound: rig?.bound ?? false,
  sockets: Object.keys(rt?.sockets ?? {}),
  nodeCount: Object.keys(rt?.nodes ?? {}).length,
  angle: angleDeg,
  silhouette,
};
if (wantGeom) (window as any).npcGeometry = { meshes: meshRecords };
(window as any).__npcModel = model;
(window as any).reviewReady = true;
