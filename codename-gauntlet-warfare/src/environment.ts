import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { blocks } from "./arena";

export interface WorldAnimations {
  /** Drives per-frame world motion (flag wave). Elapsed seconds since boot. */
  update(elapsed: number): void;
}

// Procedural fallback surface: used only when a PBR texture set fails to load,
// so the compound always builds (headless-safe, network-safe).
function surface(base: string, brick = false) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const c = canvas.getContext("2d")!;
  c.fillStyle = base;
  c.fillRect(0, 0, 256, 256);
  let seed = 17;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 14000; i++) {
    const v = random() > 0.5 ? 255 : 0;
    c.fillStyle = `rgba(${v},${v},${v},${random() * 0.12})`;
    c.fillRect(random() * 256, random() * 256, 1 + random() * 3, 1 + random() * 3);
  }
  if (brick) {
    c.strokeStyle = "#524c42"; c.lineWidth = 3;
    for (let y = 0; y < 256; y += 32) {
      c.beginPath(); c.moveTo(0, y); c.lineTo(256, y); c.stroke();
      for (let x = (y % 64 ? 32 : 0); x < 256; x += 64) { c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + 32); c.stroke(); }
    }
  }
  const map = new T.CanvasTexture(canvas);
  map.wrapS = map.wrapT = T.RepeatWrapping;
  map.colorSpace = T.SRGBColorSpace;
  map.anisotropy = 4;
  return map;
}

// Accepted CC0 texture sets (Poly Haven via asset.resolve; see assets/manifest.json).
// Each entry: [albedo, normal, arm, repeatX, repeatY, flatColor, metalness]
const PBR_SETS = {
  ground: ["sources/polyhaven/dry_ground_01/dry_ground_01_diff_1k.jpg", "sources/polyhaven/dry_ground_01/dry_ground_01_nor_gl_1k.jpg", "sources/polyhaven/dry_ground_01/dry_ground_01_arm_1k.jpg", 10, 14, "#9e926c", 0.0],
  concrete: ["sources/polyhaven/concrete_wall_003/concrete_wall_003_diff_1k.jpg", "sources/polyhaven/concrete_wall_003/concrete_wall_003_nor_gl_1k.jpg", "sources/polyhaven/concrete_wall_003/concrete_wall_003_arm_1k.jpg", 4, 2, "#a3977e", 0.0],
  brick: ["sources/polyhaven/brick_wall_04/brick_wall_04_diff_1k.jpg", "sources/polyhaven/brick_wall_04/brick_wall_04_nor_gl_1k.jpg", "sources/polyhaven/brick_wall_04/brick_wall_04_arm_1k.jpg", 5, 2, "#846451", 0.0],
  container: ["sources/polyhaven/container_side/container_side_diff_1k.jpg", "sources/polyhaven/container_side/container_side_nor_gl_1k.jpg", "sources/polyhaven/container_side/container_side_arm_1k.jpg", 2, 1, "#435954", 0.45],
} as const;

async function pbrMaterial(loader: T.TextureLoader, set: { albedo: string; normal?: string; arm?: string }, repeats: [number, number], flat: string, metalness: number): Promise<T.MeshStandardMaterial> {
  const fallback = () => new T.MeshStandardMaterial({ map: surface(flat), roughness: 0.95 });
  try {
    const [map, normalMap, armMap] = await Promise.all([
      loader.loadAsync("assets/" + set.albedo),
      set.normal ? loader.loadAsync("assets/" + set.normal).catch(() => null) : Promise.resolve(null),
      set.arm ? loader.loadAsync("assets/" + set.arm).catch(() => null) : Promise.resolve(null),
    ]);
    for (const texture of [map, normalMap, armMap]) {
      if (!texture) continue;
      texture.wrapS = texture.wrapT = T.RepeatWrapping;
      texture.repeat.set(repeats[0], repeats[1]);
      texture.anisotropy = 4;
      if (texture === armMap || texture === normalMap) texture.channel = 0;
    }
    map.colorSpace = T.SRGBColorSpace;
    const material = new T.MeshStandardMaterial({
      map,
      normalMap: normalMap ?? null,
      normalScale: new T.Vector2(0.85, 0.85),
      roughnessMap: armMap ?? null,
      aoMap: armMap ?? null,
      aoMapIntensity: 0.85,
      roughness: 1,
      metalness,
    });
    return material;
  } catch {
    return fallback();
  }
}

export async function buildEnvironment(scene: T.Scene): Promise<WorldAnimations> {
  const loader = new T.TextureLoader();
  const [groundMat, concreteMat, brickMat, containerMat] = await Promise.all(
    (Object.entries(PBR_SETS) as Array<[keyof typeof PBR_SETS, (typeof PBR_SETS)[keyof typeof PBR_SETS]]>).map(async ([key, s]) => {
      const material = await pbrMaterial(loader, { albedo: s[0], normal: s[1], arm: s[2] }, [s[3], s[4]], s[5], s[6]);
      material.name = key;
      return material;
    }),
  );
  const materials: Record<string, T.MeshStandardMaterial> = {
    ground: groundMat,
    concrete: concreteMat,
    brick: brickMat,
    container: containerMat,
    sand: new T.MeshStandardMaterial({ map: surface("#9e926c"), roughness: 1 }),
  };

  // Gameplay geometry merges per PBR material (textured); decoration merges into
  // ONE vertex-colored, shadow-free mesh — decor draws once and never enters the
  // shadow passes, which is what keeps the whole compound inside the draw budget.
  const buckets = new Map<T.Material, T.BufferGeometry[]>();
  const decorGeometries: T.BufferGeometry[] = [];
  function add(g: T.BufferGeometry, m: T.Material, x: number, y: number, z: number, ry = 0) {
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    const a = buckets.get(m) ?? [];
    if (g.index) { a.push(g.toNonIndexed()); g.dispose(); } else a.push(g);
    buckets.set(m, a);
  }
  function addDecor(g: T.BufferGeometry, color: number, x: number, y: number, z: number, ry = 0) {
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    // Many primitive geometries are already non-indexed; calling toNonIndexed()
    // on them logs a console warning per call, so convert only when needed.
    const flat = g.index ? g.toNonIndexed() : g;
    if (flat !== g) g.dispose();
    const count = flat.attributes.position.count;
    const c = new T.Color(color);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; }
    flat.setAttribute("color", new T.BufferAttribute(colors, 3));
    decorGeometries.push(flat);
  }

  // --- Gameplay geometry: the canonical arena blocks (colliders + navmesh derive
  // from the same table; this mapping must not gain or lose solids). ---
  for (const b of blocks) {
    const isFloor = b.y < 0;
    const kind: T.MeshStandardMaterial = isFloor ? materials.ground
      : b.kind === "sand" ? materials.sand
      : b.kind === "container" ? materials.container
      : b.kind === "brick" ? materials.brick
      : materials.concrete;
    if (b.kind !== "sand") add(new T.BoxGeometry(b.w, b.h, b.d), kind, b.x, b.y, b.z);
    if (b.kind === "container") {
      for (let z = -b.d / 2 + 0.15; z < b.d / 2; z += 0.22) for (const side of [-1, 1]) add(new T.BoxGeometry(0.06, b.h - 0.12, 0.065), materials.container, b.x + side * (b.w / 2 + 0.02), b.y, b.z + z);
      for (const x of [-0.65, 0.65]) add(new T.CylinderGeometry(0.025, 0.025, 2.3, 6), materials.metal, b.x + x, b.y, b.z + b.d / 2 + 0.04);
    }
    if (b.kind === "sand") {
      for (let row = 0; row < 3; row++) for (let col = 0; col < Math.floor(b.w / 0.55); col++) {
        const g = new T.SphereGeometry(1, 8, 6);
        g.scale(0.33, 0.2, b.d / 2);
        add(g, materials.sand, b.x - b.w / 2 + 0.3 + col * 0.55 + (row % 2) * 0.12, b.y - b.h / 2 + 0.2 + row * (b.h - 0.4) / 2, b.z);
      }
    }
  }

  // --- Visual-only composition (3dviz-pro-max world composition push).
  // Decor never collides and never enters the navmesh: it hugs walls, sits on
  // rooftops, or lives outside the perimeter so walkable space reads honestly.
  const rand = (() => { let s = 20260919; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; })();

  // Second + third skyline rows behind the near buildings: layered urban depth.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const x = side * (33 + rand() * 8), z = 24 - i * 12, h = 11 + (i % 3) * 5;
      addDecor(new T.BoxGeometry(9, h, 10), 0x9a9078, x, h / 2, z);
      addDecor(new T.BoxGeometry(9.4, 0.3, 10.4), 0x8d846e, x, h, z);
      for (let floor = 0; floor < 4; floor++) for (let w = 0; w < 4; w++) addDecor(new T.BoxGeometry(0.05, 1.2, 0.9), 0x323832, x - side * 4.55, 2.5 + floor * 2.4, z - 3 + w * 2);
    }
  }
  // Far north row behind the brick wall.
  for (let i = 0; i < 5; i++) {
    const x = -28 + i * 14, h = 9 + (i % 2) * 6;
    addDecor(new T.BoxGeometry(11, h, 9), 0x9a9078, x, h / 2, -46);
    addDecor(new T.BoxGeometry(11.4, 0.3, 9.4), 0x8d846e, x, h, -46);
  }

  // Near skyline: the buildings the rooftop clutter sits on (outside the walls,
  // visible over them — depth without colliders).
  for (const side of [-1, 1]) for (let i = 0; i < 5; i++) {
    const x = side * 22, z = 12 - i * 10, h = 7 + (i % 3) * 2;
    addDecor(new T.BoxGeometry(7, h, 8), 0x9a9078, x, h / 2, z);
    addDecor(new T.BoxGeometry(7.3, 0.25, 8.3), 0x8d846e, x, h, z);
    for (let floor = 0; floor < 2; floor++) for (let w = 0; w < 3; w++) addDecor(new T.BoxGeometry(0.04, 1.1, 0.8), 0x323832, x - side * 3.52, 3 + floor * 2, z - 2 + w * 2);
  }

  // Rooftop clutter on the near skyline (AC units, water tanks, vents).
  for (const side of [-1, 1]) for (let i = 0; i < 5; i++) {
    const x = side * 22, z = 12 - i * 10, h = 7 + (i % 3) * 2;
    for (let u = 0; u < 2; u++) addDecor(new T.BoxGeometry(1.4, 0.8, 1.1), 0x3a403a, x + (rand() - 0.5) * 3.4, h + 0.4, z + (rand() - 0.5) * 3.4, rand() * 3);
    addDecor(new T.CylinderGeometry(0.7, 0.7, 1.5, 10), 0x847e69, x + (rand() - 0.5) * 2.5, h + 0.75, z + (rand() - 0.5) * 2.5);
    addDecor(new T.CylinderGeometry(0.12, 0.16, 1.6, 6), 0x6e4a34, x + 2.6, h + 0.8, z - 2.6);
  }

  // Rubble and debris hugging wall bases (never in a walk lane).
  for (let i = 0; i < 60; i++) {
    const wall = i % 4;
    const t = (rand() - 0.5) * 30;
    const off = 0.9 + rand() * 1.4;
    const x = wall < 2 ? t : (wall === 2 ? -18 + off : 18 - off);
    const z = wall < 2 ? (wall === 0 ? 17.2 - off : -33.2 + off) : t;
    const g = new T.DodecahedronGeometry(0.1 + rand() * 0.28, 0);
    g.rotateY(rand() * 3); g.scale(1, 0.55 + rand() * 0.4, 0.8);
    addDecor(g, 0x846451, x, 0.1, z, rand() * 3);
  }
  for (let i = 0; i < 24; i++) {
    const g = new T.PlaneGeometry(0.3, 0.4);
    g.rotateX(-Math.PI / 2); g.rotateY(rand() * 3);
    addDecor(g, 0xb8b4a6, (rand() - 0.5) * 30, 0.012, 14 + (rand() - 0.5) * 26, 0);
  }

  // Jersey barriers (two-step profile) lining the south approach, visual only.
  for (let i = 0; i < 5; i++) {
    const x = -12 + i * 6;
    addDecor(new T.BoxGeometry(2.2, 0.28, 0.5), 0xa3977e, x, 0.14, 15.6);
    addDecor(new T.BoxGeometry(2.2, 0.5, 0.26), 0x9c9077, x, 0.5, 15.6);
  }

  // Barrels and pallets tucked against the containers (visual only).
  for (const [cx, cz] of [[-9, -8.4], [-9, -15.6], [10, -22], [13, -22], [10, -18.4]] as const) {
    for (let b = 0; b < 2; b++) addDecor(new T.CylinderGeometry(0.32, 0.32, 0.92, 10), 0x6e4a34, cx + (rand() - 0.5) * 1.6, 0.46, cz + (rand() - 0.5) * 1.2);
  }
  for (let i = 0; i < 4; i++) {
    const x = -16.6, z = -4 + i * 1.3;
    for (let p = 0; p < 3; p++) addDecor(new T.BoxGeometry(1.2, 0.09, 1.0), 0x7a5f43, x, 0.06 + p * 0.11, z, 0.12 * (p % 2 ? 1 : -1));
  }

  // Light poles with overhead wires crossing the courtyard (sagging spans).
  const poleTops: Array<[number, number, number]> = [];
  for (const [x, z] of [[-14, 12], [14, 12], [-14, -16], [14, -16]] as const) {
    addDecor(new T.CylinderGeometry(0.07, 0.1, 7, 8), 0x847e69, x, 3.5, z);
    addDecor(new T.BoxGeometry(1.1, 0.08, 0.08), 0x847e69, x - 0.5, 6.9, z);
    addDecor(new T.BoxGeometry(0.4, 0.06, 0.18), 0x323832, x - 0.95, 6.84, z);
    poleTops.push([x - 0.95, 6.8, z]);
  }
  for (const [a, b] of [[0, 1], [2, 3], [0, 2], [1, 3]] as const) {
    const [x1, y1, z1] = poleTops[a], [x2, y2, z2] = poleTops[b];
    const span = new T.CylinderGeometry(0.012, 0.012, Math.hypot(x2 - x1, y2 - y1, z2 - z1), 4);
    span.translate(0, -0.5, 0);
    const mid = new T.Vector3((x1 + x2) / 2, Math.min(y1, y2) - 0.55, (z1 + z2) / 2);
    const dir = new T.Vector3(x2 - x1, y2 - y1, z2 - z1);
    const quat = new T.Quaternion().setFromUnitVectors(new T.Vector3(0, -1, 0), dir.clone().normalize());
    span.applyQuaternion(quat);
    addDecor(span, 0x2c2c28, mid.x, mid.y, mid.z);
  }

  // Watchtower silhouettes outside the perimeter (read as overwatch positions).
  for (const [x, z] of [[-24, -38], [26, 6]] as const) {
    for (const [lx, lz] of [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]]) addDecor(new T.BoxGeometry(0.22, 7.5, 0.22), 0x7a5f43, x + lx, 3.75, z + lz);
    addDecor(new T.BoxGeometry(3.2, 0.24, 3.2), 0x7a5f43, x, 7.6, z);
    addDecor(new T.BoxGeometry(3.2, 0.9, 0.14), 0x7a5f43, x, 8.2, z - 1.55);
    addDecor(new T.BoxGeometry(3.2, 0.9, 0.14), 0x7a5f43, x, 8.2, z + 1.55);
    addDecor(new T.BoxGeometry(2.6, 0.5, 2.2), 0x6e4a34, x, 8.6, z);
  }

  // Waving unit banner near the spawn (dynamic: excluded from merges).
  const flagCanvas = document.createElement("canvas");
  flagCanvas.width = 256; flagCanvas.height = 128;
  const fc = flagCanvas.getContext("2d")!;
  fc.fillStyle = "#313d38"; fc.fillRect(0, 0, 256, 128);
  fc.fillStyle = "#ded6ba"; fc.font = "bold 44px monospace";
  fc.fillText("TF-07", 64, 58);
  fc.font = "18px monospace"; fc.fillText("GAUNTLET", 74, 92);
  const flagTexture = new T.CanvasTexture(flagCanvas);
  flagTexture.colorSpace = T.SRGBColorSpace;
  const flagGeometry = new T.PlaneGeometry(1.6, 0.9, 10, 5);
  const flagBase = flagGeometry.attributes.position.array.slice() as unknown as Float32Array;
  const flag = new T.Mesh(flagGeometry, new T.MeshStandardMaterial({ map: flagTexture, side: T.DoubleSide, roughness: 0.9 }));
  const flagPole = new T.CylinderGeometry(0.04, 0.05, 4.4, 8);
  const poleMesh = new T.Mesh(flagPole, new T.MeshStandardMaterial({ color: 0x847e69, metalness: 0.7, roughness: 0.5 }));
  poleMesh.position.set(6.5, 2.2, 16.6);
  flag.position.set(7.35, 3.85, 16.6);
  scene.add(poleMesh, flag);

  // --- Decoration: one merged, vertex-colored mesh that casts no shadows. ---
  if (decorGeometries.length > 0) {
    const decor = new T.Mesh(mergeGeometries(decorGeometries), new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.2 }));
    decor.receiveShadow = true;
    scene.add(decor);
    decorGeometries.forEach(g => g.dispose());
  }

  // --- Merge gameplay visuals per material. ---
  for (const [material, geometries] of buckets) {
    const geometry = mergeGeometries(geometries);
    const mesh = new T.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    geometries.forEach(g => g.dispose());
  }

  return {
    update(elapsed: number) {
      const pos = flag.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x0 = flagBase[i * 3], y0 = flagBase[i * 3 + 1];
        const hang = x0 / 1.6; // 0 at pole, 1 at free edge
        pos.setZ(i, Math.sin(elapsed * 2.1 + x0 * 3.2) * 0.09 * hang + Math.sin(elapsed * 3.7 + y0 * 4) * 0.03 * hang);
        pos.setY(i, y0 - Math.abs(Math.sin(elapsed * 2.1 + x0 * 3.2)) * 0.03 * hang);
      }
      pos.needsUpdate = true;
      flag.geometry.computeVertexNormals();
    },
  };
}

// --- Combatant rig with procedural animation (no external skeleton required). ---

export interface CombatantRig {
  group: T.Group;
  torso: T.Group;
  head: T.Mesh;
  leftLeg: T.Group;
  rightLeg: T.Group;
  leftArm: T.Group;
  rightArm: T.Group;
  materials: T.MeshStandardMaterial[];
  phase: number;
  /** Death/flinch animation timers, driven by main. */
  deathT: number;
  flinchT: number;
}

function vertexColorGeometry(g: T.BufferGeometry, color: number): T.BufferGeometry {
  const flat = g.index ? g.toNonIndexed() : g;
  if (flat !== g) g.dispose();
  const count = flat.attributes.position.count;
  const c = new T.Color(color);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) { colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; }
  flat.setAttribute("color", new T.BufferAttribute(colors, 3));
  return flat;
}

export interface CombatantRig {
  group: T.Group;
  torso: T.Group;
  head: T.Mesh;
  leftLeg: T.Group;
  rightLeg: T.Group;
  leftArm: T.Group;
  rightArm: T.Group;
  kneeL: T.Group;
  kneeR: T.Group;
  elbowL: T.Group;
  elbowR: T.Group;
  materials: T.MeshStandardMaterial[];
  phase: number;
  /** Death/flinch animation timers, driven by main. */
  deathT: number;
  flinchT: number;
}

// Soldier palette (vertex-baked): olive fatigues, darker plate carrier, tan
// pouches, skin, black rifle. Reads as military at 15-30m and in close-ups.
const C = { fatigue: 0x5f6650, carrier: 0x39412f, pouch: 0x8a7a55, skin: 0x9f846a, helmet: 0x3a4136, boot: 0x2e2a24, gun: 0x24282a, pack: 0x4c5340 };

export function combatant(): CombatantRig {
  const group = new T.Group();
  const cloth = new T.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 1 });
  const gun = new T.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.5, metalness: 0.5 });
  const materials = [cloth, gun];

  const mergeColored = (parent: T.Object3D, parts: Array<[T.BufferGeometry, number, number, number, number]>) => {
    const flatParts = parts.map(([g, color, x, y, z]) => {
      const flat = vertexColorGeometry(g, color);
      flat.translate(x, y, z);
      return flat;
    });
    const merged = mergeGeometries(flatParts);
    flatParts.forEach(f => f.dispose());
    const mesh = new T.Mesh(merged, cloth);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // Torso cluster: chest, plate carrier, pouches, belt, backpack.
  const torso = new T.Group();
  torso.position.y = 1.08;
  group.add(torso);
  mergeColored(torso, [
    [new T.BoxGeometry(0.42, 0.52, 0.24), C.fatigue, 0, 0.02, 0],
    [new T.BoxGeometry(0.44, 0.4, 0.32), C.carrier, 0, 0.05, 0.02],
    [new T.BoxGeometry(0.1, 0.12, 0.05), C.pouch, -0.11, -0.02, 0.19],
    [new T.BoxGeometry(0.1, 0.12, 0.05), C.pouch, 0.11, -0.02, 0.19],
    [new T.BoxGeometry(0.12, 0.1, 0.05), C.pouch, 0, -0.04, 0.19],
    [new T.BoxGeometry(0.36, 0.42, 0.16), C.pack, 0, 0.04, -0.2],
    [new T.BoxGeometry(0.44, 0.08, 0.3), C.boot, 0, -0.26, 0],
  ]);

  // Head pivot so the helmet+face reads as a head, not a slab.
  const headPivot = new T.Group();
  headPivot.position.y = 0.44;
  torso.add(headPivot);
  mergeColored(headPivot, [
    [new T.BoxGeometry(0.2, 0.22, 0.2), C.skin, 0, 0.08, 0],
    [new T.SphereGeometry(0.145, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.62), C.helmet, 0, 0.16, 0],
    [new T.BoxGeometry(0.22, 0.06, 0.22), C.helmet, 0, 0.09, 0],
  ]);
  const head = headPivot.children[0] as T.Mesh;

  // Two-segment legs: thigh pivot + knee pivot (procedural gait needs knees).
  const segment = (parent: T.Object3D, x: number, y: number, z: number): T.Group => {
    const pivot = new T.Group();
    pivot.position.set(x, y, z);
    parent.add(pivot);
    return pivot;
  };
  const legL = segment(group, -0.14, 0.82, 0);
  mergeColored(legL, [[new T.BoxGeometry(0.15, 0.4, 0.17), C.fatigue, 0, -0.18, 0]]);
  const kneeL = segment(legL, 0, -0.38, 0);
  mergeColored(kneeL, [
    [new T.BoxGeometry(0.13, 0.36, 0.15), C.fatigue, 0, -0.16, 0],
    [new T.BoxGeometry(0.14, 0.1, 0.26), C.boot, 0, -0.36, 0.04],
  ]);
  const legR = segment(group, 0.14, 0.82, 0);
  mergeColored(legR, [[new T.BoxGeometry(0.15, 0.4, 0.17), C.fatigue, 0, -0.18, 0]]);
  const kneeR = segment(legR, 0, -0.38, 0);
  mergeColored(kneeR, [
    [new T.BoxGeometry(0.13, 0.36, 0.15), C.fatigue, 0, -0.16, 0],
    [new T.BoxGeometry(0.14, 0.1, 0.26), C.boot, 0, -0.36, 0.04],
  ]);

  // Two-segment arms holding the rifle at readiness.
  const armL = segment(torso, -0.28, 0.3, 0.02);
  mergeColored(armL, [[new T.BoxGeometry(0.12, 0.3, 0.14), C.fatigue, 0, -0.14, 0]]);
  const elbowL = segment(armL, 0, -0.3, 0);
  mergeColored(elbowL, [
    [new T.BoxGeometry(0.11, 0.26, 0.13), C.fatigue, 0, -0.12, 0],
    [new T.BoxGeometry(0.09, 0.09, 0.1), C.skin, 0, -0.27, 0.02],
  ]);
  const armR = segment(torso, 0.28, 0.3, 0.02);
  mergeColored(armR, [[new T.BoxGeometry(0.12, 0.3, 0.14), C.fatigue, 0, -0.14, 0]]);
  const elbowR = segment(armR, 0, -0.3, 0);
  mergeColored(elbowR, [
    [new T.BoxGeometry(0.11, 0.26, 0.13), C.fatigue, 0, -0.12, 0],
    [new T.BoxGeometry(0.09, 0.09, 0.1), C.skin, 0, -0.27, 0.02],
  ]);

  // Rifle on the torso, barrel toward +Z (the group's facing), arms posed to it.
  const rifleParts: Array<[T.BufferGeometry, number, number, number, number]> = [
    [new T.BoxGeometry(0.07, 0.09, 0.3), C.gun, 0, 0, 0.1],        // receiver
    [new T.BoxGeometry(0.06, 0.08, 0.26), C.gun, 0, -0.005, 0.38], // handguard
    [new T.CylinderGeometry(0.016, 0.016, 0.2, 6), C.gun, 0, 0.0, 0.6],  // barrel
    [new T.BoxGeometry(0.05, 0.16, 0.08), C.gun, 0, -0.12, 0.05],  // magazine
    [new T.BoxGeometry(0.06, 0.1, 0.2), C.gun, 0, -0.02, -0.18],   // stock
    [new T.BoxGeometry(0.02, 0.05, 0.02), C.gun, 0, 0.07, 0.5],    // front post
  ];
  const rifleFlat = rifleParts.map(([g, color, x, y, z]) => { const f = vertexColorGeometry(g, color); f.translate(x, y, z); return f; });
  const rifle = new T.Mesh(mergeGeometries(rifleFlat), gun);
  rifleFlat.forEach(f => f.dispose());
  rifle.castShadow = true;
  rifle.position.set(0.16, -0.02, 0.3);
  torso.add(rifle);

  const contact = new T.Mesh(new T.CircleGeometry(0.45, 16), new T.MeshBasicMaterial({ color: 0x292a20, transparent: true, opacity: 0.18, depthWrite: false }));
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.012;
  group.add(contact);

  return { group, torso, head, leftLeg: legL, rightLeg: legR, leftArm: armL, rightArm: armR, kneeL, kneeR, elbowL, elbowR, materials, phase: Math.random() * 6, deathT: -1, flinchT: 0 };
}

/** Procedural animation: knee-flexed gait, rifle-ready arms, flinch, death fall. */
export function animateCombatant(rig: CombatantRig, speed: number, dt: number): void {
  if (rig.deathT >= 0) {
    rig.deathT += dt;
    const fall = Math.min(1, rig.deathT / 0.45);
    const ease = fall * fall * (3 - 2 * fall);
    rig.group.rotation.x = -Math.PI / 2 * ease;
    rig.kneeL.rotation.x = -1.2 * ease;
    rig.kneeR.rotation.x = -0.7 * ease;
    if (rig.deathT > 1.6) rig.group.position.y = -(rig.deathT - 1.6) * 0.35;
    if (rig.deathT > 2.6) rig.group.visible = false;
    return;
  }
  const norm = Math.min(1, speed / 3.2);
  if (norm > 0.05) rig.phase += dt * (5 + speed * 2.6);
  const swing = Math.sin(rig.phase) * 0.72 * norm;
  rig.leftLeg.rotation.x = swing;
  rig.rightLeg.rotation.x = Math.sin(rig.phase + Math.PI) * 0.72 * norm;
  // Knees flex as each leg swings through; boots stay under the body at rest.
  rig.kneeL.rotation.x = -Math.max(0, Math.sin(rig.phase - 0.9)) * 1.05 * norm;
  rig.kneeR.rotation.x = -Math.max(0, Math.sin(rig.phase + Math.PI - 0.9)) * 1.05 * norm;
  rig.torso.position.y = 1.08 + Math.abs(Math.sin(rig.phase)) * 0.045 * norm;
  rig.torso.rotation.z = Math.sin(rig.phase) * 0.045 * norm;
  rig.torso.rotation.x = 0.1 * norm; // lean into the run
  // Rifle-ready arms: shoulders forward, elbows bent to the handguard.
  rig.leftArm.rotation.x = -1.15;
  rig.rightArm.rotation.x = -1.15;
  rig.elbowL.rotation.x = -0.55;
  rig.elbowR.rotation.x = -0.85;
  if (rig.flinchT > 0) {
    rig.flinchT -= dt;
    rig.torso.rotation.x = 0.1 * norm + Math.sin(rig.flinchT * 40) * 0.12;
  }
  const flash = rig.flinchT > 0 ? 0.5 : 0;
  for (const m of rig.materials) m.emissive.setRGB(flash * 0.5, flash * 0.08, flash * 0.05);
}
