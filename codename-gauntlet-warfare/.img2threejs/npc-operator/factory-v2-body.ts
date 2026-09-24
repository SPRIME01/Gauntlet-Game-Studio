// ===================================================================
// Tactical Operator NPC v2 — turnaround convergence build (2026-09-19)
//
// Primary visual target: references/operator-turnaround-sheet.png (operator-
// supplied AAA art direction; clean crops under references/derived/turnaround/).
// Proportion authority: .img2threejs/npc-operator/turnaround-profiles.json
// (full-span / midline / depth vectors per view) and turnaround-landmarks.json.
//
// Structural contract preserved from the settled blockout factory:
//   - named anatomical hierarchy with joint-aligned pivots
//   - 11-bone bound skeleton (spine + legs) with analytic envelope weights
//   - arm chains clavicle > upper-arm > forearm > hand as named pivot Groups
//   - weapon-socket locator under hand-r (no weapon geometry merged into body)
//   - world-bake bind protocol; userData.sculptRuntime / rig contracts
//   - glTF export route (scripts/export-npc-gltf.ts) verified in Blender
// v2 changes: all visible forms re-authored against the turnaround (helmet,
// goggles, face covering, layered neck wrap, plate carrier with pouch rows,
// backpack, belt kit, thigh rig, hard knee pads, lace-up boots, gloves) with
// distinct material classes; equipment is skinned to its owning bone so
// skeletal animation carries gear with the body.
// ===================================================================
export function createTacticalOperatorNPCModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Tactical Operator NPC";
  root.userData.reconstructionEvidence = {
    itemFamily: "humanoid combatant", subtype: "tactical operator", componentAdapter: "parametric-v2",
    route: "asset.reconstruct.reference-image/agent-skill.img2threejs (character track, turnaround convergence)",
    exactnessTier: "designed-reference-approximation",
    referenceCamera: { solved: true, fovDegrees: 35, aspect: 1.0, orientation: { yaw: 0, pitch: 6, roll: 0 }, positionHint: [0, 0, 3], note: "orthographic-like turnaround views; review framing matches npc-scene reference framing" },
    approximationNotes: [
      "reference is generated art direction, not photogrammetry; cross-view contradictions resolved front > side > back > 3/4 per operator priority",
      "chin/neck boundary occluded by mask and wrap; head block sized by goggle-line + visible-block measurements",
    ],
  };
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  // ------------------------------------------------------------------
  // Measured proportions (fractions of standing height; y: 0 crown, -1 sole).
  // Sources: turnaround-profiles.json rows + turnaround-landmarks.json.
  // ------------------------------------------------------------------
  const ARM_ANGLE = (28 * Math.PI) / 180; // A-pose slant from vertical (measured 24-31 deg)
  const P = {
    helmetTopY: -0.012, helmetCY: -0.052, helmetR: 0.06,
    goggleY: -0.074, lensR: 0.024,
    maskCY: -0.098, chinY: -0.13,
    neckTopY: -0.105, neckBaseY: -0.165,
    shoulderY: -0.2, shoulderX: 0.115,
    chestTopY: -0.16, chestBotY: -0.315, chestRX: 0.152, chestRZ: 0.122,
    waistY: -0.42, waistRX: 0.122, waistRZ: 0.095,
    hipY: -0.52, hipRX: 0.125, hipRZ: 0.1,
    legX: 0.062, kneeY: -0.755, kneeR: 0.055,
    ankleY: -0.9, soleY: -1.0,
    upperArmR: 0.048, foreArmR: 0.04, wristR: 0.03,
    upperArmL: 0.165, foreArmL: 0.14,
    bootTopY: -0.9, bootLen: 0.19,
  } as const;

  // ------------------------------------------------------------------
  // Materials — nine classes, separated by response (roughness/metalness/
  // normal breakup), not albedo alone. Palette sampled from the sheet.
  // ------------------------------------------------------------------
  const fiberBands = [
    { frequency: 3, amplitude: 0.3, stretch: [1, 1], pattern: "weave", role: "macro cloth mass" },
    { frequency: 18, amplitude: 0.2, stretch: [3, 1], pattern: "fiber grain", role: "meso weave" },
    { frequency: 72, amplitude: 0.08, stretch: [4, 1], pattern: "thread ridges", role: "micro" },
  ];
  const nylonBands = [
    { frequency: 4, amplitude: 0.26, stretch: [1, 1], pattern: "patch mass", role: "macro" },
    { frequency: 22, amplitude: 0.16, stretch: [2, 1], pattern: "strap ridges", role: "meso" },
    { frequency: 90, amplitude: 0.05, stretch: [1, 1], pattern: "grain", role: "micro" },
  ];
  const materialMap: Record<string, THREE.Material> = {};
  materialMap["m-fabric"] = createSculptMaterial("m-fabric", {
    id: "m-fabric", name: "Combat shirt fabric (cordura/nylon blend)", type: "standard",
    baseColor: "#262420", albedo: { value: "#2A2822", secondary: "#1E1C18" },
    surfaceFrequencyBands: fiberBands,
    roughness: { base: 0.88, variation: 0.1 }, metalness: { base: 0 },
    normal: { strength: 0.5 }, ambientOcclusion: { cavityStrength: 0.4 },
    notes: "Dark olive-charcoal shirt; weave breakup carries the fabric read.",
  }, options);
  materialMap["m-fabric-trouser"] = createSculptMaterial("m-fabric-trouser", {
    id: "m-fabric-trouser", name: "Trousers fabric (lighter olive-brown)", type: "standard",
    baseColor: "#3A362E", albedo: { value: "#3E3930", secondary: "#302C25" },
    surfaceFrequencyBands: fiberBands,
    roughness: { base: 0.87, variation: 0.12 }, metalness: { base: 0 },
    normal: { strength: 0.55 }, ambientOcclusion: { cavityStrength: 0.42 },
    notes: "Trousers read lighter/browner than the shirt in every view.",
  }, options);
  materialMap["m-carrier"] = createSculptMaterial("m-carrier", {
    id: "m-carrier", name: "Plate carrier / pouch nylon", type: "standard",
    baseColor: "#2B2A26", albedo: { value: "#2E2C27", secondary: "#22211D" },
    surfaceFrequencyBands: nylonBands,
    roughness: { base: 0.78, variation: 0.12 }, metalness: { base: 0.02 },
    normal: { strength: 0.6 }, ambientOcclusion: { cavityStrength: 0.45 },
    sheen: { base: 0.25 }, sheenRoughness: { base: 0.6 },
    notes: "Matte nylon with edge sheen; distinct from shirt by tone + tighter grain.",
  }, options);
  materialMap["m-polymer"] = createSculptMaterial("m-polymer", {
    id: "m-polymer", name: "Moulded polymer (knee pads, goggle body)", type: "standard",
    baseColor: "#151515", albedo: { value: "#171717", secondary: "#101010" },
    surfaceFrequencyBands: [{ frequency: 8, amplitude: 0.12, stretch: [1, 1], pattern: "mould", role: "macro" }],
    roughness: { base: 0.55, variation: 0.08 }, metalness: { base: 0.05 },
    normal: { strength: 0.3 }, ambientOcclusion: { cavityStrength: 0.3 },
    notes: "Low-sheen moulded rubber/polymer per sheet swatch.",
  }, options);
  materialMap["m-hardware"] = createSculptMaterial("m-hardware", {
    id: "m-hardware", name: "Anodized steel hardware", type: "standard",
    baseColor: "#2E3033", albedo: { value: "#303236", secondary: "#232528" },
    textureless: { declared: true, evidence: ["small hardware reads as uniform anodized metal at gameplay distance"] },
    roughness: { base: 0.42, variation: 0.06 }, metalness: { base: 0.85 },
    notes: "Buckles, rails, antenna, cable — painted-metal response.",
  }, options, true);
  materialMap["m-lens"] = createSculptMaterial("m-lens", {
    id: "m-lens", name: "Goggle lens", type: "standard",
    baseColor: "#0B0D10", albedo: { value: "#0C0E12", secondary: "#070809" },
    textureless: { declared: true, evidence: ["lens is a smooth glossy solid in all views"] },
    roughness: { base: 0.14, variation: 0.03 }, metalness: { base: 0.1 },
    clearcoat: { base: 0.7 }, clearcoatRoughness: { base: 0.15 },
    notes: "Smooth specular class — never confused with fabric.",
  }, options, true);
  materialMap["m-boot"] = createSculptMaterial("m-boot", {
    id: "m-boot", name: "Boot leather/synthetic", type: "standard",
    baseColor: "#1B1A18", albedo: { value: "#1D1C19", secondary: "#141311" },
    surfaceFrequencyBands: [
      { frequency: 6, amplitude: 0.2, stretch: [1, 2], pattern: "leather grain", role: "macro" },
      { frequency: 40, amplitude: 0.1, stretch: [1, 1], pattern: "pore", role: "micro" },
    ],
    roughness: { base: 0.68, variation: 0.12 }, metalness: { base: 0.02 },
    normal: { strength: 0.45 }, ambientOcclusion: { cavityStrength: 0.4 },
    notes: "Rough synthetic leather; glossier than fabric, duller than polymer.",
  }, options);
  materialMap["m-rubber"] = createSculptMaterial("m-rubber", {
    id: "m-rubber", name: "Boot sole rubber", type: "standard",
    baseColor: "#131313", albedo: { value: "#141414", secondary: "#0E0E0E" },
    surfaceFrequencyBands: [{ frequency: 14, amplitude: 0.18, stretch: [2, 1], pattern: "tread", role: "meso" }],
    roughness: { base: 0.85, variation: 0.06 }, metalness: { base: 0 },
    normal: { strength: 0.4 },
    notes: "Dead-matte rubber class for soles.",
  }, options);
  materialMap["m-glove"] = createSculptMaterial("m-glove", {
    id: "m-glove", name: "Glove fabric + polymer", type: "standard",
    baseColor: "#2A2824", albedo: { value: "#2C2A25", secondary: "#201E1A" },
    surfaceFrequencyBands: fiberBands,
    roughness: { base: 0.75, variation: 0.1 }, metalness: { base: 0.03 },
    normal: { strength: 0.45 }, ambientOcclusion: { cavityStrength: 0.35 },
    notes: "Between fabric and carrier; hard knuckle plate uses m-polymer.",
  }, options);

  // ------------------------------------------------------------------
  // Registry + construction helpers
  // ------------------------------------------------------------------
  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};
  const skinnedParts: Record<string, THREE.SkinnedMesh[]> = {};

  let metaSeq = 0;
  const componentMeta = (
    id: string, name: string,
    o: { level: string; role: string; importance: number; primitive: string; parent: string | null; material: string; dims: [number, number, number] },
  ) => ({
    id, name, level: o.level, role: o.role, importance: o.importance, confidence: 0.9,
    primitive: o.primitive, topologyClass: "assembled-solid",
    topologyRationale: `${name} authored parametrically against turnaround measurements (spec-v2-turnaround.md).`,
    geometryDescriptor: { topologyIntent: "stylized character part", uvStrategy: "generated procedural coordinates", normalStrategy: "smooth vertex normals" },
    parent: o.parent, material: o.material,
    dimensions: { width: o.dims[0], height: o.dims[1], depth: o.dims[2], units: "relative", confidence: 0.9 },
    evidenceRefs: ["turnaround-front", "turnaround-left", "turnaround-back"],
    fidelityTier: "production-v2",
    seq: metaSeq++,
  });

  const pivotNode = (
    id: string, name: string, parentId: string,
    position: [number, number, number],
    meta: ReturnType<typeof componentMeta>,
    rotation?: [number, number, number],
  ): THREE.Group => {
    const g = new THREE.Group();
    g.name = `${name}__pivot`;
    g.position.set(position[0], position[1], position[2]);
    if (rotation) g.rotation.set(rotation[0], rotation[1], rotation[2]);
    g.userData.sculptComponent = meta;
    g.userData.actionProfile = {
      animationRole: meta.role === "socket" ? "socket" : "articulated",
      pivot: { mode: "joint", localPosition: [0, 0, 0], axis: [0, 1, 0], confidence: 0.9 },
    };
    (nodes[parentId] ?? root).add(g);
    nodes[id] = g;
    return g;
  };

  const attachMesh = (
    id: string, name: string,
    geo: THREE.BufferGeometry, mat: THREE.Material, parentId: string | null,
    meta: ReturnType<typeof componentMeta>,
    position?: [number, number, number], rotation?: [number, number, number],
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    if (position) mesh.position.set(position[0], position[1], position[2]);
    if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
    mesh.castShadow = options.castShadow ?? true;
    mesh.receiveShadow = options.receiveShadow ?? true;
    mesh.userData.sculptComponent = meta;
    (parentId ? nodes[parentId] ?? root : root).add(mesh);
    meshes[id] = mesh;
    colliders[id] = {};
    return mesh;
  };

  // Skinned part: geometry authored in MODEL space, mesh at root identity.
  // skin 'analytic' = envelope weights across bones (primary body masses);
  // skin 'rigid' = weight 1.0 to the owning bone (equipment follows its bone).
  const bindPart = (
    boneId: string, id: string, name: string,
    geo: THREE.BufferGeometry, mat: THREE.Material,
    meta: ReturnType<typeof componentMeta>,
    skin: "analytic" | "rigid" = "rigid",
  ): THREE.SkinnedMesh => {
    const mesh = new THREE.SkinnedMesh(geo, mat);
    mesh.name = name;
    mesh.castShadow = options.castShadow ?? true;
    mesh.receiveShadow = options.receiveShadow ?? true;
    mesh.userData.sculptComponent = meta;
    mesh.userData.skinMode = skin;
    root.add(mesh);
    meshes[id] = mesh;
    colliders[id] = {};
    (skinnedParts[boneId] ??= []).push(mesh);
    return mesh;
  };

  // ------------------------------------------------------------------
  // Geometry helpers (module-scope pure THREE, deterministic)
  // ------------------------------------------------------------------
  const lathe = (profile: Array<[number, number]>, radial = 20): THREE.LatheGeometry =>
    new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(0.002, r), y)), radial);

  const ellipsoid = (r: number, scale: [number, number, number], at: [number, number, number], w = 16, h = 12): THREE.BufferGeometry => {
    const g = new THREE.SphereGeometry(r, w, h);
    g.scale(scale[0], scale[1], scale[2]);
    g.translate(at[0], at[1], at[2]);
    return g;
  };

  const roundedBox = (w: number, h: number, d: number, radius = 0.012, at?: [number, number, number], rot?: [number, number, number]): THREE.BufferGeometry => {
    const shape = new THREE.Shape();
    const x0 = -w / 2, y0 = -h / 2, r = Math.min(radius, w / 2 - 0.002, h / 2 - 0.002);
    shape.moveTo(x0 + r, y0);
    shape.lineTo(x0 + w - r, y0);
    shape.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
    shape.lineTo(x0 + w, y0 + h - r);
    shape.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h);
    shape.lineTo(x0 + r, y0 + h);
    shape.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
    shape.lineTo(x0, y0 + r);
    shape.quadraticCurveTo(x0, y0, x0 + r, y0);
    const depth = Math.max(0.008, d - 0.012);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.005, bevelSegments: 2, curveSegments: 4,
    });
    geo.translate(0, 0, -depth / 2);
    if (rot) {
      geo.rotateX(rot[0]);
      geo.rotateY(rot[1]);
      geo.rotateZ(rot[2]);
    }
    if (at) geo.translate(at[0], at[1], at[2]);
    return geo;
  };

  const torus = (radius: number, tube: number, at: [number, number, number], scale: [number, number, number] = [1, 1, 1]): THREE.BufferGeometry => {
    const g = new THREE.TorusGeometry(radius, tube, 12, 22);
    g.rotateX(Math.PI / 2); // lie horizontal (around Y)
    g.scale(scale[0], scale[1], scale[2]);
    g.translate(at[0], at[1], at[2]);
    return g;
  };

  const box = (w: number, h: number, d: number, at: [number, number, number], rot?: [number, number, number]): THREE.BufferGeometry => {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rot) {
      g.rotateX(rot[0]);
      g.rotateY(rot[1]);
      g.rotateZ(rot[2]);
    }
    g.translate(at[0], at[1], at[2]);
    return g;
  };

  const tube = (points: Array<[number, number, number]>, radius: number): THREE.BufferGeometry =>
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2]))), 12, radius, 8, false);

  // ==================================================================
  // PIVOT HIERARCHY (named, joint-aligned; mirrors the bone chain)
  // ==================================================================
  pivotNode("root", "Operator (root)", "root", [0, -0.5, 0],
    componentMeta("root", "Operator (root)", { level: "macro", role: "body", importance: 1, primitive: "locator", parent: null, material: "m-fabric", dims: [0.01, 0.01, 0.01] }));
  pivotNode("pelvis", "Pelvis (trouser yoke)", "root", [0, -0.02, 0],
    componentMeta("pelvis", "Pelvis (trouser yoke)", { level: "macro", role: "body", importance: 0.9, primitive: "ellipsoid", parent: "root", material: "m-fabric-trouser", dims: [0.25, 0.15, 0.2] }));
  pivotNode("abdomen", "Abdomen", "pelvis", [0, 0.12, 0],
    componentMeta("abdomen", "Abdomen", { level: "macro", role: "body", importance: 0.9, primitive: "lathe", parent: "pelvis", material: "m-fabric", dims: [0.24, 0.12, 0.19] }));
  pivotNode("chest", "Chest", "abdomen", [0, 0.12, 0],
    componentMeta("chest", "Chest", { level: "macro", role: "body", importance: 1, primitive: "lathe", parent: "abdomen", material: "m-fabric", dims: [0.3, 0.16, 0.24] }));
  pivotNode("neck", "Neck", "chest", [0, 0.12, 0],
    componentMeta("neck", "Neck", { level: "macro", role: "body", importance: 0.7, primitive: "cylinder", parent: "chest", material: "m-fabric", dims: [0.08, 0.06, 0.08] }));
  pivotNode("head", "Head", "neck", [0, 0.055, 0],
    componentMeta("head", "Head", { level: "macro", role: "body", importance: 1, primitive: "sphere", parent: "neck", material: "m-fabric", dims: [0.12, 0.13, 0.12] }));
  pivotNode("clavicle-l", "Clavicle L", "chest", [0.045, 0.095, 0.01],
    componentMeta("clavicle-l", "Clavicle L", { level: "meso", role: "body", importance: 0.6, primitive: "locator", parent: "chest", material: "m-fabric", dims: [0.07, 0.03, 0.03] }));
  pivotNode("clavicle-r", "Clavicle R", "chest", [-0.045, 0.095, 0.01],
    componentMeta("clavicle-r", "Clavicle R", { level: "meso", role: "body", importance: 0.6, primitive: "locator", parent: "chest", material: "m-fabric", dims: [0.07, 0.03, 0.03] }));
  pivotNode("upper-arm-l", "Upper Arm L", "clavicle-l", [0.07, -0.015, -0.01],
    componentMeta("upper-arm-l", "Upper Arm L", { level: "macro", role: "body", importance: 0.8, primitive: "lathe", parent: "clavicle-l", material: "m-fabric", dims: [0.1, 0.165, 0.1] }),
    [0, 0, ARM_ANGLE]);
  pivotNode("upper-arm-r", "Upper Arm R", "clavicle-r", [-0.07, -0.015, -0.01],
    componentMeta("upper-arm-r", "Upper Arm R", { level: "macro", role: "body", importance: 0.8, primitive: "lathe", parent: "clavicle-r", material: "m-fabric", dims: [0.1, 0.165, 0.1] }),
    [0, 0, -ARM_ANGLE]);
  pivotNode("forearm-l", "Forearm L", "upper-arm-l", [0, -P.upperArmL, 0],
    componentMeta("forearm-l", "Forearm L", { level: "macro", role: "body", importance: 0.8, primitive: "lathe", parent: "upper-arm-l", material: "m-fabric", dims: [0.08, 0.14, 0.08] }));
  pivotNode("forearm-r", "Forearm R", "upper-arm-r", [0, -P.upperArmL, 0],
    componentMeta("forearm-r", "Forearm R", { level: "macro", role: "body", importance: 0.8, primitive: "lathe", parent: "upper-arm-r", material: "m-fabric", dims: [0.08, 0.14, 0.08] }));
  pivotNode("hand-l", "Hand L", "forearm-l", [0, -P.foreArmL, 0],
    componentMeta("hand-l", "Hand L", { level: "meso", role: "body", importance: 0.7, primitive: "sphere", parent: "forearm-l", material: "m-glove", dims: [0.07, 0.09, 0.05] }));
  pivotNode("hand-r", "Hand R", "forearm-r", [0, -P.foreArmL, 0],
    componentMeta("hand-r", "Hand R", { level: "meso", role: "body", importance: 0.7, primitive: "sphere", parent: "forearm-r", material: "m-glove", dims: [0.07, 0.09, 0.05] }));
  pivotNode("thigh-l", "Thigh L", "pelvis", [P.legX, 0.0, 0],
    componentMeta("thigh-l", "Thigh L", { level: "macro", role: "body", importance: 0.9, primitive: "lathe", parent: "pelvis", material: "m-fabric-trouser", dims: [0.12, 0.24, 0.12] }));
  pivotNode("thigh-r", "Thigh R", "pelvis", [-P.legX, 0.0, 0],
    componentMeta("thigh-r", "Thigh R", { level: "macro", role: "body", importance: 0.9, primitive: "lathe", parent: "pelvis", material: "m-fabric-trouser", dims: [0.12, 0.24, 0.12] }));
  pivotNode("shin-l", "Shin L", "thigh-l", [0, -(P.hipY - P.kneeY), 0.005],
    componentMeta("shin-l", "Shin L", { level: "macro", role: "body", importance: 0.8, primitive: "lathe", parent: "thigh-l", material: "m-fabric-trouser", dims: [0.1, 0.15, 0.1] }));
  pivotNode("shin-r", "Shin R", "thigh-r", [0, -(P.hipY - P.kneeY), 0.005],
    componentMeta("shin-r", "Shin R", { level: "macro", role: "body", importance: 0.8, primitive: "lathe", parent: "thigh-r", material: "m-fabric-trouser", dims: [0.1, 0.15, 0.1] }));
  pivotNode("foot-l", "Foot L", "shin-l", [0, -(P.kneeY - P.ankleY), -0.017],
    componentMeta("foot-l", "Foot L", { level: "macro", role: "body", importance: 0.8, primitive: "assembled", parent: "shin-l", material: "m-boot", dims: [0.1, 0.11, 0.19] }));
  pivotNode("foot-r", "Foot R", "shin-r", [0, -(P.kneeY - P.ankleY), -0.017],
    componentMeta("foot-r", "Foot R", { level: "macro", role: "body", importance: 0.8, primitive: "assembled", parent: "shin-r", material: "m-boot", dims: [0.1, 0.11, 0.19] }));

  // ==================================================================
  // BODY (skinned primaries, analytic envelope weights)
  // ==================================================================
  bindPart("pelvis", "pelvis", "Pelvis (trouser yoke)",
    ellipsoid(0.5, [0.25, 0.15, 0.2], [0, P.hipY - 0.015, 0]),
    materialMap["m-fabric-trouser"],
    componentMeta("pelvis", "Pelvis (trouser yoke)", { level: "macro", role: "body", importance: 0.9, primitive: "ellipsoid", parent: "root", material: "m-fabric-trouser", dims: [0.25, 0.15, 0.2] }),
    "analytic");
  bindPart("abdomen", "abdomen", "Abdomen",
    (() => { const g = lathe([[0.112, P.waistY - 0.02], [0.118, -0.38], [0.122, P.chestBotY]]); g.scale(1, 1, 0.78); return g; })(),
    materialMap["m-fabric"],
    componentMeta("abdomen", "Abdomen", { level: "macro", role: "body", importance: 0.9, primitive: "lathe", parent: "pelvis", material: "m-fabric", dims: [0.24, 0.12, 0.19] }),
    "analytic");
  bindPart("chest", "chest", "Chest",
    (() => { const g = lathe([[0.122, P.chestBotY], [0.148, -0.27], [P.chestRX, -0.225], [0.135, -0.185], [0.098, P.chestTopY]]); g.scale(1, 1, 0.8); return g; })(),
    materialMap["m-fabric"],
    componentMeta("chest", "Chest", { level: "macro", role: "body", importance: 1, primitive: "lathe", parent: "abdomen", material: "m-fabric", dims: [0.3, 0.16, 0.24] }),
    "analytic");
  bindPart("neck", "neck", "Neck",
    (() => { const g = new THREE.CylinderGeometry(0.042, 0.05, P.neckBaseY - P.neckTopY, 14, 3); g.translate(0, (P.neckBaseY + P.neckTopY) / 2, 0.004); return g; })(),
    materialMap["m-fabric"],
    componentMeta("neck", "Neck", { level: "macro", role: "body", importance: 0.7, primitive: "cylinder", parent: "chest", material: "m-fabric", dims: [0.08, 0.06, 0.08] }),
    "analytic");
  bindPart("head", "head", "Head (skull)",
    ellipsoid(0.05, [0.85, 0.95, 0.9], [0, -0.075, 0.004]),
    materialMap["m-fabric"],
    componentMeta("head", "Head (skull)", { level: "macro", role: "body", importance: 0.8, primitive: "sphere", parent: "neck", material: "m-fabric", dims: [0.09, 0.1, 0.09] }),
    "analytic");

  for (const side of ["l", "r"] as const) {
    const sx = side === "l" ? 1 : -1;
    bindPart(`thigh-${side}`, `thigh-${side}`, `Thigh ${side}`,
      (() => { const g = lathe([[0.058, P.hipY - 0.01], [0.055, -0.58], [0.05, -0.68], [0.047, P.kneeY + 0.008]]); g.scale(1, 1, 1.04); g.translate(sx * P.legX, 0, 0); return g; })(),
      materialMap["m-fabric-trouser"],
      componentMeta(`thigh-${side}`, `Thigh ${side}`, { level: "macro", role: "body", importance: 0.9, primitive: "lathe", parent: "pelvis", material: "m-fabric-trouser", dims: [0.12, 0.24, 0.12] }),
      "analytic");
    bindPart(`shin-${side}`, `shin-${side}`, `Shin ${side}`,
      (() => { const g = lathe([[0.047, P.kneeY], [0.05, -0.795], [0.044, -0.845], [0.034, P.ankleY + 0.005]]); g.scale(1, 1, 1.05); g.translate(sx * P.legX, 0, 0.005); return g; })(),
      materialMap["m-fabric-trouser"],
      componentMeta(`shin-${side}`, `Shin ${side}`, { level: "macro", role: "body", importance: 0.8, primitive: "lathe", parent: `thigh-${side}`, material: "m-fabric-trouser", dims: [0.1, 0.15, 0.1] }),
      "analytic");
    // Boot: shaft + foot mass + sole + lace panel, all following the foot bone.
    bindPart(`foot-${side}`, `boot-shaft-${side}`, `Boot shaft ${side}`,
      (() => { const g = lathe([[0.036, P.ankleY + 0.005], [0.041, -0.935], [0.044, -0.958]], 18); g.translate(sx * P.legX, 0, 0.005); return g; })(),
      materialMap["m-boot"],
      componentMeta(`boot-shaft-${side}`, `Boot shaft ${side}`, { level: "meso", role: "gear", importance: 0.8, primitive: "lathe", parent: `foot-${side}`, material: "m-boot", dims: [0.09, 0.06, 0.09] }));
    bindPart(`foot-${side}`, `boot-foot-${side}`, `Boot foot ${side}`,
      ellipsoid(0.048, [0.95, 0.72, 1.95], [sx * P.legX, -0.952, 0.042]),
      materialMap["m-boot"],
      componentMeta(`boot-foot-${side}`, `Boot foot ${side}`, { level: "meso", role: "gear", importance: 0.8, primitive: "ellipsoid", parent: `foot-${side}`, material: "m-boot", dims: [0.09, 0.07, 0.18] }));
    bindPart(`foot-${side}`, `boot-sole-${side}`, `Boot sole ${side}`,
      roundedBox(0.1, 0.028, P.bootLen + 0.005, 0.012, [sx * P.legX, -0.985, 0.043]),
      materialMap["m-rubber"],
      componentMeta(`boot-sole-${side}`, `Boot sole ${side}`, { level: "micro", role: "gear", importance: 0.6, primitive: "box", parent: `foot-${side}`, material: "m-rubber", dims: [0.1, 0.028, 0.195] }));
    bindPart(`foot-${side}`, `boot-laces-${side}`, `Boot lace panel ${side}`,
      box(0.034, 0.05, 0.01, [sx * P.legX, -0.928, 0.038], [-0.28, 0, 0]),
      materialMap["m-boot"],
      componentMeta(`boot-laces-${side}`, `Boot lace panel ${side}`, { level: "micro", role: "gear", importance: 0.5, primitive: "box", parent: `foot-${side}`, material: "m-boot", dims: [0.034, 0.05, 0.01] }));
  }

  // ==================================================================
  // HEAD ASSEMBLY (helmet, goggles, face covering, neck wrap) — skinned head
  // ==================================================================
  const headGear: THREE.Object3D[] = [];
  const headPart = (id: string, name: string, matId: string, geo: THREE.BufferGeometry, mat: THREE.Material, importance: number, dims: [number, number, number]) => {
    const m = bindPart("head", id, name, geo, mat,
      componentMeta(id, name, { level: "meso", role: "gear", importance, primitive: "assembled", parent: "head", material: matId, dims }));
    headGear.push(m);
    return m;
  };
  headPart("helmet-shell", "Helmet shell", "m-polymer",
    ellipsoid(P.helmetR, [0.98, 0.92, 1.06], [0, P.helmetCY, 0.002]),
    materialMap["m-polymer"], 1, [0.12, 0.11, 0.13]);
  headPart("helmet-brim", "Helmet brim", "m-polymer",
    torus(P.helmetR * 0.97, 0.011, [0, P.helmetCY - 0.018, 0.002], [1, 0.5, 1.06]),
    materialMap["m-polymer"], 0.8, [0.12, 0.02, 0.13]);
  headPart("helmet-shroud", "Helmet NVG shroud", "m-hardware",
    box(0.032, 0.022, 0.016, [0, -0.042, 0.06]),
    materialMap["m-hardware"], 0.6, [0.032, 0.022, 0.016]);
  headPart("helmet-rail-l", "Helmet rail L", "m-hardware",
    box(0.011, 0.014, 0.085, [0.057, -0.046, 0.004]),
    materialMap["m-hardware"], 0.5, [0.011, 0.014, 0.085]);
  headPart("helmet-rail-r", "Helmet rail R", "m-hardware",
    box(0.011, 0.014, 0.085, [-0.057, -0.046, 0.004]),
    materialMap["m-hardware"], 0.5, [0.011, 0.014, 0.085]);
  headPart("goggle-band", "Goggle band", "m-polymer",
    torus(0.059, 0.017, [0, P.goggleY, 0.004], [1.04, 0.82, 1.0]),
    materialMap["m-polymer"], 0.9, [0.13, 0.035, 0.12]);
  headPart("goggle-lens-l", "Goggle lens L", "m-lens",
    (() => { const g = new THREE.CylinderGeometry(P.lensR, P.lensR, 0.01, 16); g.rotateX(Math.PI / 2); g.translate(0.027, P.goggleY, 0.056); return g; })(),
    materialMap["m-lens"], 0.8, [0.048, 0.02, 0.01]);
  headPart("goggle-lens-r", "Goggle lens R", "m-lens",
    (() => { const g = new THREE.CylinderGeometry(P.lensR, P.lensR, 0.01, 16); g.rotateX(Math.PI / 2); g.translate(-0.027, P.goggleY, 0.056); return g; })(),
    materialMap["m-lens"], 0.8, [0.048, 0.02, 0.01]);
  headPart("face-mask", "Face covering", "m-carrier",
    ellipsoid(0.048, [0.84, 0.88, 0.9], [0, P.maskCY, 0.008]),
    materialMap["m-carrier"], 0.9, [0.08, 0.09, 0.085]);
  headPart("neck-wrap-lower", "Neck wrap (lower)", "m-fabric",
    torus(0.052, 0.021, [0, -0.142, 0.002], [1.2, 1, 1.15]),
    materialMap["m-fabric"], 0.8, [0.13, 0.045, 0.12]);
  headPart("neck-wrap-upper", "Neck wrap (upper)", "m-fabric",
    torus(0.058, 0.022, [0, -0.163, 0.002], [1.3, 1, 1.2]),
    materialMap["m-fabric"], 0.8, [0.15, 0.05, 0.14]);
  destructionGroups["head-gear"] = headGear;

  // ==================================================================
  // PLATE CARRIER + CHEST KIT — skinned chest
  // ==================================================================
  const carrierParts: THREE.Object3D[] = [];
  const chestPart = (id: string, name: string, geo: THREE.BufferGeometry, mat: THREE.Material, importance: number, dims: [number, number, number]) => {
    const m = bindPart("chest", id, name, geo, mat,
      componentMeta(id, name, { level: "meso", role: "gear", importance, primitive: "assembled", parent: "chest", material: "chest-gear", dims }));
    carrierParts.push(m);
    return m;
  };
  chestPart("collar", "Collar flare",
    (() => { const g = lathe([[0.05, P.neckBaseY + 0.01], [0.088, P.neckBaseY - 0.03]], 18); return g; })(),
    materialMap["m-fabric"], 0.7, [0.18, 0.05, 0.18]);
  chestPart("carrier-front", "Carrier front plate bag",
    roundedBox(0.3, 0.235, 0.052, 0.02, [0, -0.268, 0.108]),
    materialMap["m-carrier"], 1, [0.3, 0.235, 0.052]);
  chestPart("carrier-molle-a", "Carrier MOLLE ridge A",
    box(0.26, 0.012, 0.008, [0, -0.222, 0.136]),
    materialMap["m-carrier"], 0.4, [0.26, 0.012, 0.008]);
  chestPart("carrier-molle-b", "Carrier MOLLE ridge B",
    box(0.26, 0.012, 0.008, [0, -0.262, 0.136]),
    materialMap["m-carrier"], 0.4, [0.26, 0.012, 0.008]);
  chestPart("carrier-molle-c", "Carrier MOLLE ridge C",
    box(0.26, 0.012, 0.008, [0, -0.302, 0.136]),
    materialMap["m-carrier"], 0.4, [0.26, 0.012, 0.008]);
  const magRow: THREE.Object3D[] = [];
  for (const [i, mx] of [-0.082, 0, 0.082].entries()) {
    magRow.push(chestPart(`mag-pouch-${i + 1}`, `Mag pouch ${i + 1}`,
      roundedBox(0.068, 0.078, 0.046, 0.01, [mx, -0.345, 0.132]),
      materialMap["m-carrier"], 0.9, [0.068, 0.078, 0.046]));
    magRow.push(chestPart(`mag-flap-${i + 1}`, `Mag flap ${i + 1}`,
      box(0.07, 0.014, 0.05, [mx, -0.308, 0.132], [-0.22, 0, 0]),
      materialMap["m-carrier"], 0.6, [0.07, 0.014, 0.05]));
  }
  destructionGroups["mag-pouches"] = magRow;
  chestPart("radio-box", "Radio pouch",
    roundedBox(0.042, 0.072, 0.028, 0.008, [-0.107, -0.202, 0.122], [0, 0, 0.06]),
    materialMap["m-carrier"], 0.7, [0.042, 0.072, 0.028]);
  chestPart("radio-cable", "Radio cable",
    tube([[-0.105, -0.168, 0.115], [-0.088, -0.108, 0.088], [-0.048, -0.068, 0.05]], 0.004),
    materialMap["m-hardware"], 0.5, [0.01, 0.11, 0.01]);
  chestPart("carrier-side-l", "Carrier side pouch L",
    roundedBox(0.046, 0.1, 0.062, 0.01, [0.146, -0.30, 0.026]),
    materialMap["m-carrier"], 0.7, [0.046, 0.1, 0.062]);
  chestPart("carrier-side-r", "Carrier side pouch R",
    roundedBox(0.046, 0.1, 0.062, 0.01, [-0.146, -0.30, 0.026]),
    materialMap["m-carrier"], 0.7, [0.046, 0.1, 0.062]);
  chestPart("strap-l", "Shoulder strap L",
    tube([[0.072, -0.172, 0.104], [0.092, -0.152, 0.02], [0.082, -0.162, -0.06]], 0.02),
    materialMap["m-carrier"], 0.8, [0.05, 0.03, 0.18]);
  chestPart("strap-r", "Shoulder strap R",
    tube([[-0.072, -0.172, 0.104], [-0.092, -0.152, 0.02], [-0.082, -0.162, -0.06]], 0.02),
    materialMap["m-carrier"], 0.8, [0.05, 0.03, 0.18]);
  chestPart("strap-pad-l", "Shoulder pad L",
    roundedBox(0.062, 0.018, 0.11, 0.008, [0.093, -0.148, -0.008], [0, 0, -0.1]),
    materialMap["m-carrier"], 0.6, [0.062, 0.018, 0.11]);
  chestPart("strap-pad-r", "Shoulder pad R",
    roundedBox(0.062, 0.018, 0.11, 0.008, [-0.093, -0.148, -0.008], [0, 0, 0.1]),
    materialMap["m-carrier"], 0.6, [0.062, 0.018, 0.11]);
  chestPart("sternum-strap", "Sternum strap",
    box(0.052, 0.013, 0.008, [0, -0.192, 0.14]),
    materialMap["m-carrier"], 0.5, [0.052, 0.013, 0.008]);
  chestPart("backpack-body", "Backpack body",
    roundedBox(0.24, 0.28, 0.075, 0.02, [0, -0.277, -0.125]),
    materialMap["m-carrier"], 0.95, [0.24, 0.28, 0.075]);
  chestPart("backpack-lid", "Backpack lid",
    roundedBox(0.22, 0.1, 0.05, 0.015, [0, -0.163, -0.112]),
    materialMap["m-carrier"], 0.7, [0.22, 0.1, 0.05]);
  chestPart("backpack-pouch-l", "Backpack side pouch L",
    roundedBox(0.052, 0.13, 0.048, 0.01, [0.147, -0.28, -0.075]),
    materialMap["m-carrier"], 0.6, [0.052, 0.13, 0.048]);
  chestPart("backpack-pouch-r", "Backpack side pouch R",
    roundedBox(0.052, 0.13, 0.048, 0.01, [-0.147, -0.28, -0.075]),
    materialMap["m-carrier"], 0.6, [0.052, 0.13, 0.048]);
  chestPart("antenna-base", "Antenna base",
    (() => { const g = new THREE.CylinderGeometry(0.009, 0.011, 0.024, 10); g.translate(-0.096, -0.15, -0.128); return g; })(),
    materialMap["m-hardware"], 0.4, [0.02, 0.024, 0.02]);
  chestPart("antenna", "Antenna",
    (() => { const g = new THREE.CylinderGeometry(0.0035, 0.005, 0.24, 8); g.rotateX(0.16); g.translate(-0.09, -0.028, -0.148); return g; })(),
    materialMap["m-hardware"], 0.5, [0.01, 0.24, 0.01]);
  destructionGroups["carrier"] = carrierParts;

  // ==================================================================
  // BELT + WAIST KIT — skinned pelvis
  // ==================================================================
  const beltParts: THREE.Object3D[] = [];
  const pelvisPart = (id: string, name: string, geo: THREE.BufferGeometry, mat: THREE.Material, importance: number, dims: [number, number, number]) => {
    const m = bindPart("pelvis", id, name, geo, mat,
      componentMeta(id, name, { level: "meso", role: "gear", importance, primitive: "assembled", parent: "pelvis", material: "belt-kit", dims }));
    beltParts.push(m);
    return m;
  };
  pelvisPart("belt", "Duty belt",
    (() => { const g = new THREE.CylinderGeometry(0.131, 0.131, 0.042, 24, 1, true); g.scale(1, 1, 0.84); g.translate(0, -0.425, 0); return g; })(),
    materialMap["m-carrier"], 0.9, [0.26, 0.042, 0.22]);
  pelvisPart("belt-buckle", "Belt buckle",
    box(0.03, 0.02, 0.012, [0, -0.425, 0.111]),
    materialMap["m-hardware"], 0.5, [0.03, 0.02, 0.012]);
  pelvisPart("belt-pouch-l", "Belt pouch L",
    roundedBox(0.052, 0.076, 0.04, 0.01, [-0.1, -0.455, 0.098]),
    materialMap["m-carrier"], 0.7, [0.052, 0.076, 0.04]);
  pelvisPart("belt-dump-pouch", "Dump pouch",
    roundedBox(0.068, 0.088, 0.046, 0.012, [0.05, -0.462, 0.096]),
    materialMap["m-carrier"], 0.7, [0.068, 0.088, 0.046]);
  pelvisPart("belt-pouch-back-l", "Belt pouch back L",
    roundedBox(0.05, 0.068, 0.045, 0.01, [-0.112, -0.452, -0.058]),
    materialMap["m-carrier"], 0.6, [0.05, 0.068, 0.045]);
  pelvisPart("belt-pouch-back-r", "Belt pouch back R",
    roundedBox(0.045, 0.06, 0.04, 0.01, [0.112, -0.45, -0.05]),
    materialMap["m-carrier"], 0.6, [0.045, 0.06, 0.04]);
  pelvisPart("buttpack", "Butt pack",
    roundedBox(0.13, 0.09, 0.05, 0.015, [0, -0.462, -0.112]),
    materialMap["m-carrier"], 0.7, [0.13, 0.09, 0.05]);
  destructionGroups["belt-kit"] = beltParts;

  // ==================================================================
  // THIGH RIG (character-right) + admin pouch — skinned thighs
  // ==================================================================
  bindPart("thigh-r", "holster-body", "Holster body",
    roundedBox(0.048, 0.15, 0.06, 0.012, [-0.096, -0.605, 0.05], [0.1, 0, 0.07]),
    materialMap["m-carrier"],
    componentMeta("holster-body", "Holster body", { level: "meso", role: "gear", importance: 0.8, primitive: "assembled", parent: "thigh-r", material: "m-carrier", dims: [0.048, 0.15, 0.06] }));
  bindPart("thigh-r", "holster-strap-a", "Holster strap A",
    torus(0.066, 0.007, [-P.legX, -0.575, 0]),
    materialMap["m-carrier"],
    componentMeta("holster-strap-a", "Holster strap A", { level: "micro", role: "gear", importance: 0.5, primitive: "torus", parent: "thigh-r", material: "m-carrier", dims: [0.13, 0.014, 0.13] }));
  bindPart("thigh-r", "holster-strap-b", "Holster strap B",
    torus(0.062, 0.007, [-P.legX, -0.64, 0]),
    materialMap["m-carrier"],
    componentMeta("holster-strap-b", "Holster strap B", { level: "micro", role: "gear", importance: 0.5, primitive: "torus", parent: "thigh-r", material: "m-carrier", dims: [0.125, 0.014, 0.125] }));
  bindPart("thigh-r", "thigh-pouch-r", "Thigh pouch R",
    roundedBox(0.046, 0.066, 0.036, 0.01, [-0.09, -0.672, 0.058]),
    materialMap["m-carrier"],
    componentMeta("thigh-pouch-r", "Thigh pouch R", { level: "micro", role: "gear", importance: 0.6, primitive: "assembled", parent: "thigh-r", material: "m-carrier", dims: [0.046, 0.066, 0.036] }));
  bindPart("thigh-l", "thigh-pouch-l", "Admin pouch L",
    roundedBox(0.04, 0.056, 0.03, 0.008, [0.088, -0.615, 0.06]),
    materialMap["m-carrier"],
    componentMeta("thigh-pouch-l", "Admin pouch L", { level: "micro", role: "gear", importance: 0.5, primitive: "assembled", parent: "thigh-l", material: "m-carrier", dims: [0.04, 0.056, 0.03] }));

  // ==================================================================
  // KNEE PADS — skinned thighs (sit on the knee cap)
  // ==================================================================
  for (const side of ["l", "r"] as const) {
    const sx = side === "l" ? 1 : -1;
    bindPart(`thigh-${side}`, `kneepad-${side}`, `Knee pad ${side}`,
      ellipsoid(P.kneeR, [0.88, 1.02, 0.72], [sx * P.legX, P.kneeY + 0.005, 0.038]),
      materialMap["m-polymer"],
      componentMeta(`kneepad-${side}`, `Knee pad ${side}`, { level: "meso", role: "gear", importance: 0.8, primitive: "ellipsoid", parent: `thigh-${side}`, material: "m-polymer", dims: [0.097, 0.112, 0.079] }));
  }

  // ==================================================================
  // ARMS (rigid meshes under named pivot chains — the arm contract)
  // ==================================================================
  for (const side of ["l", "r"] as const) {
    attachMesh(`upper-arm-${side}`, `Upper arm ${side}`,
      lathe([[P.upperArmR, 0.015], [0.044, -0.08], [0.04, -P.upperArmL + 0.005]], 18),
      materialMap["m-fabric"], `upper-arm-${side}`,
      componentMeta(`upper-arm-${side}`, `Upper arm ${side}`, { level: "macro", role: "body", importance: 0.8, primitive: "lathe", parent: `upper-arm-${side}`, material: "m-fabric", dims: [0.1, 0.18, 0.1] }));
    attachMesh(`elbow-${side}`, `Elbow ${side}`,
      ellipsoid(0.041, [1, 1, 1], [0, 0, 0], 14, 10),
      materialMap["m-fabric"], `forearm-${side}`,
      componentMeta(`elbow-${side}`, `Elbow ${side}`, { level: "meso", role: "body", importance: 0.6, primitive: "sphere", parent: `forearm-${side}`, material: "m-fabric", dims: [0.082, 0.082, 0.082] }));
    attachMesh(`forearm-${side}`, `Forearm ${side}`,
      lathe([[0.039, 0.01], [0.033, -0.07], [P.wristR, -P.foreArmL + 0.01]], 18),
      materialMap["m-fabric"], `forearm-${side}`,
      componentMeta(`forearm-${side}`, `Forearm ${side}`, { level: "macro", role: "body", importance: 0.8, primitive: "lathe", parent: `forearm-${side}`, material: "m-fabric", dims: [0.08, 0.15, 0.08] }));
    attachMesh(`sleeve-fold-${side}-a`, `Sleeve fold ${side} A`,
      torus(0.041, 0.005, [0, -0.022, 0], [1, 1, 1]),
      materialMap["m-fabric"], `forearm-${side}`,
      componentMeta(`sleeve-fold-${side}-a`, `Sleeve fold ${side} A`, { level: "micro", role: "gear", importance: 0.4, primitive: "torus", parent: `forearm-${side}`, material: "m-fabric", dims: [0.092, 0.01, 0.092] }));
    attachMesh(`sleeve-fold-${side}-b`, `Sleeve fold ${side} B`,
      torus(0.038, 0.005, [0, -0.048, 0]),
      materialMap["m-fabric"], `forearm-${side}`,
      componentMeta(`sleeve-fold-${side}-b`, `Sleeve fold ${side} B`, { level: "micro", role: "gear", importance: 0.4, primitive: "torus", parent: `forearm-${side}`, material: "m-fabric", dims: [0.086, 0.01, 0.086] }));
    attachMesh(`cuff-${side}`, `Sleeve cuff ${side}`,
      (() => { const g = new THREE.CylinderGeometry(0.033, 0.03, 0.03, 14); g.translate(0, -P.foreArmL + 0.022, 0); return g; })(),
      materialMap["m-fabric"], `forearm-${side}`,
      componentMeta(`cuff-${side}`, `Sleeve cuff ${side}`, { level: "micro", role: "gear", importance: 0.4, primitive: "cylinder", parent: `forearm-${side}`, material: "m-fabric", dims: [0.066, 0.03, 0.066] }));
    // Glove (hand mass + hard knuckle plate + cuff) under the hand pivot.
    attachMesh(`hand-${side}`, `Hand ${side}`,
      ellipsoid(0.034, [0.78, 1.12, 0.95], [0, -0.026, 0.002], 14, 10),
      materialMap["m-glove"], `hand-${side}`,
      componentMeta(`hand-${side}`, `Hand ${side}`, { level: "meso", role: "body", importance: 0.7, primitive: "sphere", parent: `hand-${side}`, material: "m-glove", dims: [0.053, 0.076, 0.065] }));
    attachMesh(`knuckle-${side}`, `Knuckle plate ${side}`,
      roundedBox(0.05, 0.03, 0.018, 0.006, [0, -0.016, 0.028]),
      materialMap["m-polymer"], `hand-${side}`,
      componentMeta(`knuckle-${side}`, `Knuckle plate ${side}`, { level: "micro", role: "gear", importance: 0.5, primitive: "box", parent: `hand-${side}`, material: "m-polymer", dims: [0.05, 0.03, 0.018] }));
  }

  // ==================================================================
  // WEAPON SOCKET (locator only — no weapon geometry in the body mesh)
  // ==================================================================
  const socketMeta = componentMeta("weapon-socket", "Weapon attachment socket (hand-r grip)", {
    level: "micro", role: "socket", importance: 0.5, primitive: "locator", parent: "hand-r", material: "m-hardware", dims: [0.02, 0.02, 0.02],
  });
  const socketNode = pivotNode("weapon-socket", "Weapon attachment socket (hand-r grip)", "hand-r", [0, -0.03, 0.02], socketMeta);
  sockets["weapon-socket"] = socketNode;
  attachMesh("weapon-socket-mesh", "Weapon attachment socket (hand-r grip)",
    box(0.02, 0.02, 0.02, [0, 0, 0]), materialMap["m-hardware"], "weapon-socket", socketMeta);

  // ==================================================================
  // BONE HIERARCHY (bound skeleton: spine + legs; arms are pivot chains)
  // ==================================================================
  const bones: Record<string, THREE.Bone> = {};
  const boneOrder: string[] = [];
  const addBone = (id: string, parent: string | null, position: [number, number, number]) => {
    const bone = new THREE.Bone();
    bone.name = id;
    bone.position.set(position[0], position[1], position[2]);
    (parent ? bones[parent] : root).add(bone);
    bones[id] = bone;
    boneOrder.push(id);
  };
  addBone("pelvis", null, [0, -0.52, 0]);
  addBone("abdomen", "pelvis", [0, 0.12, 0]);
  addBone("chest", "abdomen", [0, 0.12, 0]);
  addBone("neck", "chest", [0, 0.12, 0]);
  addBone("head", "neck", [0, 0.055, 0]);
  addBone("thigh-l", "pelvis", [P.legX, 0, 0]);
  addBone("thigh-r", "pelvis", [-P.legX, 0, 0]);
  addBone("shin-l", "thigh-l", [0, -(P.hipY - P.kneeY), 0.005]);
  addBone("shin-r", "thigh-r", [0, -(P.hipY - P.kneeY), 0.005]);
  addBone("foot-l", "shin-l", [0, -(P.kneeY - P.ankleY), -0.017]);
  addBone("foot-r", "shin-r", [0, -(P.kneeY - P.ankleY), -0.017]);

  // The bones are now in REST position. updateMatrixWorld() before constructing the
  // Skeleton is load-bearing: calculateInverses() reads each bone's CURRENT world
  // matrix, and those inverses are what cancel the rest pose during skinning.
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(boneOrder.map((id) => bones[id]));
  const boneIndexOf = new Map<string, number>(boneOrder.map((id, i) => [id, i]));

  // Analytic envelope segments (model space) for the primary body masses.
  const BONE_JOINT: Record<string, number[]> = {
    pelvis: [0, -0.52, 0], abdomen: [0, -0.4, 0], chest: [0, -0.28, 0],
    neck: [0, -0.16, 0], head: [0, -0.105, 0],
    "thigh-l": [P.legX, -0.52, 0], "thigh-r": [-P.legX, -0.52, 0],
    "shin-l": [P.legX, P.kneeY, 0.005], "shin-r": [-P.legX, P.kneeY, 0.005],
    "foot-l": [P.legX, -0.9, -0.012], "foot-r": [-P.legX, -0.9, -0.012],
  };
  const BONE_TIP: Record<string, number[]> = {
    pelvis: [0, -0.4, 0], abdomen: [0, -0.28, 0], chest: [0, -0.16, 0],
    neck: [0, -0.105, 0], head: [0, -0.02, 0.01],
    "thigh-l": [P.legX, P.kneeY, 0.005], "thigh-r": [-P.legX, P.kneeY, 0.005],
    "shin-l": [P.legX, -0.9, -0.012], "shin-r": [-P.legX, -0.9, -0.012],
    "foot-l": [P.legX, -0.985, 0.055], "foot-r": [-P.legX, -0.985, 0.055],
  };
  const BONE_ENVELOPE: Record<string, number> = {
    pelvis: 0.12, abdomen: 0.11, chest: 0.16, neck: 0.05, head: 0.08,
    "thigh-l": 0.075, "thigh-r": 0.075, "shin-l": 0.06, "shin-r": 0.06,
    "foot-l": 0.045, "foot-r": 0.045,
  };
  const _closest = new THREE.Vector3();
  const distanceToSegment = (p: THREE.Vector3, s: number[], e: number[]): number => {
    const ab = [e[0] - s[0], e[1] - s[1], e[2] - s[2]];
    const ap = [p.x - s[0], p.y - s[1], p.z - s[2]];
    const abLenSq = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
    const t = abLenSq > 1e-12
      ? THREE.MathUtils.clamp((ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / abLenSq, 0, 1)
      : 0;
    _closest.set(s[0] + ab[0] * t, s[1] + ab[1] * t, s[2] + ab[2] * t);
    return p.distanceTo(_closest);
  };
  const computeVertexWeights = (p: THREE.Vector3) => {
    const scored = boneOrder.map((id) => {
      const d = distanceToSegment(p, BONE_JOINT[id], BONE_TIP[id]);
      const u = d / BONE_ENVELOPE[id];
      const falloff = Math.max(0, 1 - u * u);
      return { id, d, w: falloff * falloff };
    });
    scored.sort((a, b) => b.w - a.w);
    const kept = scored.slice(0, 4);
    const total = kept.reduce((sum, c) => sum + c.w, 0);
    const indices = [0, 0, 0, 0];
    const weights = [0, 0, 0, 0];
    if (total > 0) {
      for (let slot = 0; slot < kept.length; slot++) {
        indices[slot] = boneIndexOf.get(kept[slot].id) ?? 0;
        weights[slot] = kept[slot].w / total;
      }
      return { indices, weights, fallback: false };
    }
    // Zero-sum fallback: pin weight 1.0 to the absolutely nearest bone rather than
    // let normalizeSkinWeights() spike the vertex at bone 0.
    let nearest = boneOrder[0];
    let nearestDistance = Infinity;
    for (const id of boneOrder) {
      const d = distanceToSegment(p, BONE_JOINT[id], BONE_TIP[id]);
      if (d < nearestDistance) { nearest = id; nearestDistance = d; }
    }
    indices[0] = boneIndexOf.get(nearest) ?? 0;
    weights[0] = 1;
    return { indices, weights, fallback: true };
  };

  // ---- bind protocol: geometry is already model-space (meshes at identity), so the
  // world bake is a verified no-op guard; analytic weights for primaries, rigid
  // weights (owning bone, 1.0) for equipment so animation carries gear along.
  root.updateMatrixWorld(true);
  const skinnedMeshNames: string[] = [];
  let boundCount = 0;
  let expectedBound = 0;
  const vertex = new THREE.Vector3();
  for (const boneId of boneOrder) {
    const parts = skinnedParts[boneId] ?? [];
    for (const mesh of parts) {
      expectedBound += 1;
      const position = mesh.geometry.getAttribute("position");
      if (!position) continue;
      mesh.updateWorldMatrix(true, false);
      if (mesh.geometry.userData.worldBaked) {
        throw new Error(
          `geometry for '${mesh.name}' is already world-baked; baking twice squares the ` +
          "world matrix and scatters the parts. Build a fresh factory instead of re-binding.",
        );
      }
      mesh.geometry.applyMatrix4(mesh.matrixWorld);
      mesh.geometry.userData.worldBaked = true;
      root.add(mesh);
      mesh.position.set(0, 0, 0);
      mesh.quaternion.identity();
      mesh.scale.set(1, 1, 1);
      mesh.updateMatrixWorld(true);
      const count = position.count;
      const skinIndices = new Uint16Array(count * 4);
      const skinWeights = new Float32Array(count * 4);
      const rigid = mesh.userData.skinMode !== "analytic";
      for (let v = 0; v < count; v++) {
        if (rigid) {
          skinIndices[v * 4] = boneIndexOf.get(boneId) ?? 0;
          skinWeights[v * 4] = 1;
        } else {
          vertex.fromBufferAttribute(position, v);
          const { indices, weights } = computeVertexWeights(vertex);
          for (let slot = 0; slot < 4; slot++) {
            skinIndices[v * 4 + slot] = indices[slot];
            skinWeights[v * 4 + slot] = weights[slot];
          }
        }
      }
      mesh.geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndices, 4));
      mesh.geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeights, 4));
      skinnedMeshNames.push(mesh.name);
      mesh.bind(skeleton, new THREE.Matrix4());
      // A SkinnedMesh's boundingSphere is computed from its REST vertex data and is
      // not recomputed when bones move; disable the test — consumers needing culling
      // must supply their own bounds (recorded in userData.rig).
      mesh.frustumCulled = false;
      boundCount += 1;
    }
  }
  root.userData.rig = {
    bones, skeleton, boneOrder, boneIndexOf,
    skinAttributes: skinnedMeshNames,
    bound: skinnedMeshNames.length > 0 && boundCount === expectedBound,
    frustumCulled: false,
    cullingNote: "skinned meshes set frustumCulled = false; bone motion does not update a SkinnedMesh boundingSphere, so a consumer that needs culling must recompute bounds per frame",
  };
  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 512, "preferredTextureResolution": 1024, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": false, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "turnaround swatches define material classes; extraction is swatch-informed inference"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth cloth or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare carrier/pouch/belt segmentation against the turnaround panels.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: "Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets. Arm chains are pivot Groups (clavicle > upper-arm > forearm > hand); spine and legs are the bound skeleton; equipment is skinned to its owning bone.",
  };
  return root;
}
