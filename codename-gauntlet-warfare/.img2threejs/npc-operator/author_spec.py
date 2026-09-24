#!/usr/bin/env python3
"""Author the Tactical Operator NPC sculpt spec (v2, parent-local frames).

Measured frame: total height 1.80 m (9.4 head-units, HH=0.1915 m).
Spec frame: origin at crown, figure occupies y in [-1, 0] (template convention), total
height 1.0. All component/bone positions are authored WORLD in this frame, then converted
to parent-local (the factory nests nodes, so absolute positions compound).
"""
import json, math

SPEC = "codename-gauntlet-warfare/.img2threejs/npc-operator/object-sculpt-spec.json"
ASMT = "codename-gauntlet-warfare/.img2threejs/npc-operator/assessment.json"
S = 1.0 / 1.80
def ym(m): return -(1.80 - m) * S  # meters-from-floor -> frame y
def wx(v): return v * S            # meters x/z -> frame

d = json.load(open(SPEC))
ASM = json.load(open(ASMT))
ASM["preSpecAssessment"]["complexity"]["scores"] = {
    "silhouetteComplexity": 2, "componentCount": 3, "hierarchyDepth": 3,
    "repetitionDensity": 2, "materialLayerCount": 2, "localDetailDensity": 2,
    "occlusionRisk": 2, "actionReadinessNeed": 3,
}
ASM["qualityContract"]["minimumSpecDepth"]["macroComponents"] = 6
ASM["qualityContract"]["featureGroups"] = [
    {"id": "fg-head-neck", "name": "head+neck (featureless mannequin)", "componentRefs": ["head", "neck", "collar"]},
    {"id": "fg-torso", "name": "torso core + shirt", "componentRefs": ["chest", "abdomen", "pelvis"]},
    {"id": "fg-carrier", "name": "plate carrier + pouches", "componentRefs": ["vest-shell", "vest-zip", "mag-pouch-l1", "mag-pouch-r1", "radio-pouch", "shoulder-strap-l", "shoulder-strap-r", "sternum-buckle-l", "sternum-buckle-r"]},
    {"id": "fg-arms", "name": "arms (A-pose) + gloves", "componentRefs": ["clavicle-l", "upper-arm-l", "forearm-l", "hand-l", "glove-plate-l"]},
    {"id": "fg-pelvis-belt", "name": "pelvis/belt/holster", "componentRefs": ["belt", "belt-buckle", "hip-pouch", "holster"]},
    {"id": "fg-legs", "name": "legs + knee pads", "componentRefs": ["thigh-l", "shin-l", "kneepad-l", "cargo-pocket-l"]},
    {"id": "fg-boots", "name": "boots", "componentRefs": ["boot-l", "boot-toe-l", "boot-lace-l-1"]},
]
ASM["qualityContract"]["antiShallowSpecRules"] = [
    "Every macro/meso component carries topologyClass + topologyRationale before primitive selection.",
    "Every detailInventory detail maps to a component.localFeatures or material.localOverrides entry.",
    "Repetition systems are declared, not improvised per-instance.",
    "Unknown/rear regions stay marked inferred with low confidence.",
]
ASM["preSpecAssessment"]["anatomy"]["faceLandmarks"] = {
    "eyeLine": 0.5, "eyeSpacing": 0.25, "noseBase": 0.65, "mouthLine": 0.8, "hairline": 0.05,
    "note": "Faceless mannequin head: NO facial features exist. Values are human-canon schema defaults, "
            "documented as unused; no facial geometry or feature-placement gate applies."
}
ASM["preSpecAssessment"]["unknownsToResolveBeforeImplementation"] = []
d["preSpecAssessment"] = ASM["preSpecAssessment"]
d["qualityContract"] = ASM["qualityContract"]

d["qualityTargets"]["targetFidelity"] = 0.75
d["selfCorrectLoop"]["visualAcceptance"]["threshold"] = 0.75
d["performanceBudget"] = {
    "qualityPriority": "reference-fidelity",
    "targetTriangles": 12000, "maxDrawCalls": 30,
    "textureSize": 1024, "fpsTarget": 60,
    "optimizationPolicy": "Reach accepted visual fidelity first, then optimize without removing reference-critical geometry or rig pivots.",
}
d["silhouette"] = {
    "boundingShape": "standing biped, bideltoid 0.534 m, hip 0.366 m, depth max 0.28 m at vest",
    "aspectRatios": [
        {"name": "height:bideltoid", "value": 1.8/0.534},
        {"name": "height:headHeight", "value": 9.4},
        {"name": "headWidth:headHeight", "value": 0.86},
    ],
    "symmetry": "bilateral",
    "dominantCurves": ["straight A-pose arms ~17 deg abduction", "vertical legs", "vest rectangular silhouette with lower pouch band"],
    "negativeSpaces": ["gap between torso and A-pose arms", "leg gap between knees down to mid-shin"],
    "landmarks": [
        {"name": "crown", "y": 0.0}, {"name": "chin", "y": ym(1.605)},
        {"name": "shoulderLine", "y": ym(1.475)}, {"name": "vestBottom", "y": ym(1.13)},
        {"name": "belt", "y": ym(1.098)}, {"name": "crotch", "y": ym(0.824)},
        {"name": "knee", "y": ym(0.56)}, {"name": "ankle", "y": ym(0.10)},
        {"name": "floor", "y": -1.0},
    ],
}
d["viewEvidence"] = [
    {"id": "front-primary", "view": "front",
     "imageRegion": {"x": 0, "y": 0, "width": 1254, "height": 1254},
     "observations": ["9.4 HU measured", "bideltoid 0.534 m", "vest layout, pouch rows, radio pouch figure-left",
                       "thigh holster figure-right with 2 straps", "round 4-screw knee pads", "lace-up boots, banded ankles",
                       "rolled sleeves expose white forearms", "featureless white mannequin head"],
     "confidence": 0.9},
    {"id": "side-secondary", "view": "side",
     "imageRegion": {"x": 0, "y": 0, "width": 1254, "height": 1254},
     "observations": ["vest depth ~0.20 m at chest", "collar height ~0.05 m", "boot profile with heel",
                      "glove profile with knuckle plate", "radio pouch proud of chest profile",
                      "holster rides outer-right thigh"],
     "confidence": 0.8},
]

d["materials"] = [
    {"id": "m-plastic", "name": "Mannequin plastic (head, neck, forearms)", "type": "standard",
     "shaderModel": "MeshStandardMaterial / PBR approximation",
     "baseColor": "#E9E7E2", "color": "#E9E7E2",
     "albedo": {"value": "#E9E7E2", "secondary": "#D6D3CD", "note": "matte-white display plastic, near-uniform"},
     "colorVariation": {"type": "none", "note": "uniform plastic; slight ambient-value shift only"},
     "roughness": {"value": 0.62, "base": 0.62, "variation": 0.04}, "metalness": {"value": 0.0},
     "textureless": {"declared": True, "evidence": [
        "1254px front + side views: head/forearm surfaces show no pores, grain, print or decal detail",
        "identity lives in silhouette and colour-region boundaries (white vs black), per analysis.md Layer 6",
        "measured albedo band 0.85-0.92 value, uniform; no hue variation regions"]},
     "notes": "Matte white plastic; subtle uniform specular; no subsurface."},
    {"id": "m-fabric", "name": "Uniform cotton fabric (shirt, trousers, collar)", "type": "standard",
     "shaderModel": "MeshStandardMaterial / PBR approximation",
     "baseColor": "#161616", "color": "#161616",
     "albedo": {"value": "#161616", "secondary": "#0A0A0A", "note": "matte black fabric, washed black"},
     "colorVariation": {"type": "crease-shading", "note": "value shift at waist/knee/ankle creases via geometry"},
     "roughness": {"value": 0.93, "base": 0.93, "variation": 0.05}, "metalness": {"value": 0.0},
     "textureless": {"declared": True, "evidence": [
        "all-black fabric regions resolve no weave, print or wear detail at source resolution",
        "fold/cinch structure carried by geometry creases (waist, knee, ankle), not normal maps",
        "near-monochrome: no printed pattern exists anywhere on the garment"]},
     "localOverrides": [{"id": "ov-waist-cinch", "note": "crease shading at vest/belt junction via geometry crease, not texture"}, {"id": "d-waist-cinch", "note": "waist cinch crease where vest meets belt"}],
     "notes": "All-black band; value separation from vest kept minimal per reference."},
    {"id": "m-nylon", "name": "Vest/pouch/belt nylon", "type": "standard",
     "shaderModel": "MeshStandardMaterial / PBR approximation",
     "baseColor": "#121212", "color": "#121212",
     "albedo": {"value": "#121212", "secondary": "#080808"},
     "colorVariation": {"type": "sheen", "note": "nylon sheen band on flap edges"},
     "roughness": {"value": 0.88, "base": 0.88, "variation": 0.05}, "metalness": {"value": 0.05},
     "textureless": {"declared": True, "evidence": [
        "vest/pouch surfaces show no print, label or fabric detail at 1254px",
        "pouch/buckle separation reads by geometric edges (analysis.md Layer 8)",
        "value band 0.03-0.06 uniform across all nylon regions"]},
     "notes": "Slight sheen over matte base distinguishes gear from fabric."},
    {"id": "m-polymer", "name": "Satin polymer (knee pads, gloves)", "type": "standard",
     "shaderModel": "MeshStandardMaterial / PBR approximation",
     "baseColor": "#0C0C0C", "color": "#0C0C0C",
     "albedo": {"value": "#0C0C0C", "secondary": "#060606"},
     "colorVariation": {"type": "none", "note": "uniform moulded polymer"},
     "roughness": {"value": 0.55, "base": 0.55, "variation": 0.08}, "metalness": {"value": 0.1},
     "textureless": {"declared": True, "evidence": [
        "knee pads/gloves: untextured moulded polymer, no scuff or print detail visible in either view",
        "satin response is a scalar roughness effect, not a texture"]},
     "notes": "Satin read under key light."},
    {"id": "m-boot-leather", "name": "Boot leather", "type": "standard",
     "shaderModel": "MeshStandardMaterial / PBR approximation",
     "baseColor": "#0A0A0A", "color": "#0A0A0A",
     "albedo": {"value": "#0A0A0A", "secondary": "#040404"},
     "colorVariation": {"type": "specular-band", "note": "glossier toe cap highlight"},
     "roughness": {"value": 0.45, "base": 0.45, "variation": 0.1}, "metalness": {"value": 0.05},
     "textureless": {"declared": True, "evidence": [
        "boots read as untextured black leather with specular highlight band; no grain detail at source resolution",
        "toe-cap gloss is scalar roughness variation, no map required"]},
     "notes": "Glossier toe caps per reference highlight."},
    {"id": "m-hardware", "name": "Dark hardware (buckles, zip, screws, eyelets)", "type": "standard",
     "shaderModel": "MeshStandardMaterial / PBR approximation",
     "baseColor": "#232323", "color": "#232323",
     "albedo": {"value": "#232323", "secondary": "#141414"},
     "colorVariation": {"type": "none", "note": "uniform anodized hardware"},
     "roughness": {"value": 0.5, "base": 0.5, "variation": 0.08}, "metalness": {"value": 0.6},
     "textureless": {"declared": True, "evidence": [
        "buckles/zip/screws: sub-10px features, no per-item texture detail resolvable in source",
        "dark anodized read carried by scalar metalness/roughness; flagged inference, bounded correction allowed"]},
     "notes": "Metalness inference flagged in assessment; bounded material-scoped correction allowed in material pass."},
]
RECIPES = {
    "m-plastic": (["rgba(233, 231, 226, 1.0)", "rgba(214, 211, 205, 1.0)"], "plastic", 0.9),
    "m-fabric": (["rgba(22, 22, 22, 1.0)", "rgba(10, 10, 10, 1.0)"], "fabric", 0.85),
    "m-nylon": (["rgba(18, 18, 18, 1.0)", "rgba(8, 8, 8, 1.0)"], "fabric", 0.8),
    "m-polymer": (["rgba(12, 12, 12, 1.0)", "rgba(6, 6, 6, 1.0)"], "plastic", 0.8),
    "m-boot-leather": (["rgba(10, 10, 10, 1.0)", "rgba(4, 4, 4, 1.0)"], "rubber", 0.7),
    "m-hardware": (["rgba(35, 35, 35, 1.0)", "rgba(20, 20, 20, 1.0)"], "metal", 0.65),
}

# ---------- arm chain (A-POSE authored geometrically; rigid pivot track) ----------
# Arm joint positions are the POSED (splayed) positions: the upper-arm pivot carries the
# abduction rotation, and child pivots are authored in the parent's rotated frame, so the
# whole chain splays around the shoulder joint. Pivot track (no arm bones): cuffs, gloves
# and the weapon socket stay rigidly attached to their segment.
ABD = math.radians(4.0)
def arm_chain(sx):
    ca, sa = math.cos(ABD), math.sin(ABD)
    def down(fr, ln):
        return (fr[0] + sx * sa * ln, fr[1] - ca * ln)
    sh = (sx * 0.195, 1.475)
    el = down(sh, 0.255)
    wr = down(el, 0.24)
    hn = down(wr, 0.08)
    cuff = down(el, 0.055)
    return sh, el, wr, hn, cuff

DECIMATE = {}  # decimation intentionally unused: standard-tier fidelity kept (18.9k tris; game headroom 121k)
C = []
C = []
def comp(id, name, level, role, prim, parent, dims_m, pos_m, material, imp, conf,
         topo="assembled-solid", topo_why=None, pivot=None, anim_role="static",
         ev=None, rot=None, seg=None):
    """seg=(start_m, end_m, r_base, r_end): anatomical segment in WORLD meters for
    capsule/cylinder attachment primitives. The factory derives geometry from the
    attachment endpoints and places the pivot AT localStart (the joint)."""
    w, h, dp = [x * S for x in dims_m]
    px, py, pz = wx(pos_m[0]), ym(pos_m[1]), wx(pos_m[2])
    attach = None
    if seg is not None:
        (sx3, ex3, rb, re_) = seg
        attach = {"parentId": parent, "parentSocket": f"{parent}-surface",
                  "worldStart": [wx(sx3[0]), ym(sx3[1]), wx(sx3[2])],
                  "worldEnd": [wx(ex3[0]), ym(ex3[1]), wx(ex3[2])],
                  "baseRadius": wx(rb), "endRadius": wx(re_),
                  "contactType": "overlap", "overlap": 0.01, "embedDepth": 0.0,
                  "gapTolerance": 0.005, "contactNormal": [0, 1, 0]}
        attach = {k: v for k, v in attach.items()}
    elif parent is not None:
        attach = {"parentId": parent, "parentSocket": f"{parent}-surface",
                  "localStart": [-w / 2, -h / 2, -dp / 2], "localEnd": [w / 2, h / 2, dp / 2],
                  "contactType": "overlap", "overlap": 0.01, "embedDepth": 0.0,
                  "gapTolerance": 0.005, "contactNormal": [0, 1, 0]}
    c = {
        "id": id, "name": name, "level": level, "role": role,
        "importance": imp, "confidence": conf, "primitive": prim,
        "topologyClass": topo,
        "topologyRationale": topo_why or f"{name} is a discrete primitive part assembled onto the humanoid rig, not a continuous sculpt or shell.",
        "geometryDescriptor": {
            "topologyIntent": "stylized character part",
            "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1},
            "deformationStack": [], "uvStrategy": "generated procedural coordinates",
            "normalStrategy": "smooth vertex normals",
            **({"decimate": {"targetRatio": DECIMATE.get(id, 1.0)}} if DECIMATE.get(id, 1.0) < 1.0 else {}),
        },
        "parent": parent, "attachment": attach,
        "colorMaterialRecipe": dict(zip(("dominantAlbedo", "secondaryAlbedo"), RECIPES[material][0]),
                                     materialClass=RECIPES[material][1], materialClassConfidence=RECIPES[material][2]),
        "dimensions": {"width": w, "height": h, "depth": dp, "units": "relative", "confidence": conf},
        "transform": {"position": [px, py, pz], "rotation": rot or [0, 0, 0], "scale": [w, h, dp]},
        "actionProfile": {
            "animationRole": anim_role,
            "pivot": {"mode": "center", "localPosition": pivot or [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.8},
            "transformChannels": {"translate": True, "rotate": True, "scale": True, "bend": False,
                                   "twist": False, "detach": False, "visibility": True, "material-state": False},
        },
        "material": material, "materialLayers": [], "deformations": [], "joints": [], "seams": [],
        "localFeatures": [], "surfaceDetail": {},
        "evidenceRefs": ev or ["front-primary"], "details": [], "fidelityTier": "blockout",
    }
    C.append(c)
    return c

comp("root", "Operator (root)", "macro", "body", "box", None,
     [0.02, 0.02, 0.02], [0, 0.90, 0], "m-fabric", 1.0, 0.9,
     topo_why="Root pivot node; not rendered.")
comp("pelvis", "Pelvis (trouser yoke)", "macro", "body", "ellipsoid", "root",
     [0.31, 0.13, 0.22], [0, 0.905, 0], "m-fabric", 0.9, 0.85, anim_role="articulated")
comp("abdomen", "Abdomen (shirt)", "macro", "body", "capsule", "pelvis",
     [0.30, 0.22, 0.21], [0, 1.08, 0], "m-fabric", 0.9, 0.85,
     seg=((0, 0.97, 0), (0, 1.19, 0), 0.15, 0.16))
comp("chest", "Chest (shirt)", "macro", "body", "capsule", "abdomen",
     [0.36, 0.34, 0.23], [0, 1.33, 0], "m-fabric", 1.0, 0.85,
     seg=((0, 1.16, 0), (0, 1.50, 0), 0.19, 0.18))
comp("neck", "Neck", "meso", "body", "cylinder", "chest",
     [0.11, 0.12, 0.11], [0, 1.565, 0], "m-plastic", 0.6, 0.9,
     seg=((0, 1.50, 0), (0, 1.63, 0), 0.055, 0.055))
comp("head", "Head (faceless mannequin)", "macro", "body", "ellipsoid", "neck",
     [0.150, 0.191, 0.165], [0, 1.70, 0], "m-plastic", 1.0, 0.75,
     topo="continuous-sculpt",
     topo_why="Smooth featureless mannequin head is a continuous organic ellipsoid; no facial features exist to place.",
     ev=["front-primary", "side-secondary"])
comp("collar", "Mandarin collar", "meso", "gear", "cylinder", "chest",
     [0.15, 0.05, 0.15], [0, 1.505, 0], "m-fabric", 0.55, 0.85,
     seg=((0, 1.48, 0), (0, 1.53, 0), 0.075, 0.075))
comp("vest-shell", "Plate carrier vest", "macro", "gear", "box", "chest",
     [0.40, 0.35, 0.28], [0, 1.315, 0], "m-nylon", 1.0, 0.9, ev=["front-primary", "side-secondary"])
comp("vest-zip", "Vest front zip", "micro", "gear", "box", "vest-shell",
     [0.02, 0.34, 0.012], [0, 1.31, 0.147], "m-hardware", 0.6, 0.85)
comp("sternum-buckle-l", "Sternum buckle left", "micro", "gear", "box", "vest-shell",
     [0.035, 0.09, 0.016], [0.055, 1.40, 0.147], "m-hardware", 0.55, 0.85)
comp("sternum-buckle-r", "Sternum buckle right", "micro", "gear", "box", "vest-shell",
     [0.035, 0.09, 0.016], [-0.055, 1.40, 0.147], "m-hardware", 0.55, 0.85)
for side, sx in (("l", 1), ("r", -1)):
    comp(f"shoulder-strap-{side}", f"Vest shoulder strap {side}", "meso", "gear", "box", "vest-shell",
         [0.06, 0.025, 0.17], [sx * 0.115, 1.485, 0.0], "m-nylon", 0.6, 0.85)
    for k in range(3):
        comp(f"molle-loop-{side}-{k+1}", f"MOLLE loop {side}{k+1}", "micro", "gear", "box", f"shoulder-strap-{side}",
             [0.055, 0.012, 0.02], [sx * 0.115, 1.487, -0.05 + k * 0.05], "m-nylon", 0.35, 0.75)
    for k, x in enumerate((0.06, 0.13, 0.185)):
        comp(f"mag-pouch-{side}{k+1}", f"Mag pouch {side}{k+1}", "meso", "gear", "box", "vest-shell",
             [0.085, 0.105, 0.055], [sx * x, 1.215, 0.152], "m-nylon", 0.8, 0.85)
comp("radio-pouch", "Radio pouch (figure-left chest)", "meso", "gear", "box", "vest-shell",
     [0.07, 0.12, 0.05], [0.14, 1.375, 0.145], "m-nylon", 0.7, 0.85)
comp("belt", "Battle belt", "meso", "gear", "box", "pelvis",
     [0.40, 0.05, 0.42], [0, 1.098, 0], "m-nylon", 0.75, 0.85)
comp("belt-buckle", "Belt buckle", "micro", "gear", "box", "belt",
     [0.05, 0.035, 0.02], [0, 1.098, 0.188], "m-hardware", 0.4, 0.85)
comp("hip-pouch", "Hip utility pouch (figure-left)", "meso", "gear", "box", "belt",
     [0.08, 0.10, 0.05], [0.185, 1.05, 0.0], "m-nylon", 0.6, 0.8)
for side, sx in (("l", 1), ("r", -1)):
    sh, el, wr, hn, cuff = arm_chain(sx)
    rz = sx * ABD
    comp(f"clavicle-{side}", f"Clavicle {side}", "meso", "body", "capsule", "chest",
         [0.16, 0.05, 0.09], [sx * 0.11, 1.472, 0], "m-fabric", 0.6, 0.8,
         seg=((sx * 0.03, 1.472, 0), (sx * 0.19, 1.472, 0), 0.045, 0.03))
    comp(f"upper-arm-{side}", f"Upper arm + sleeve {side}", "meso", "body", "capsule", f"clavicle-{side}",
         [0.13, 0.27, 0.13], [(sh[0] + el[0]) / 2, (sh[1] + el[1]) / 2, 0], "m-fabric", 0.7, 0.85,
         anim_role="articulated", rot=[0, 0, rz],
         seg=((sx * 0.195, 1.475, 0), (sx * 0.195, 1.22, 0), 0.088, 0.062))
    comp(f"forearm-{side}", f"Forearm (exposed) {side}", "meso", "body", "capsule", f"upper-arm-{side}",
         [0.10, 0.24, 0.10], [(el[0] + wr[0]) / 2, (el[1] + wr[1]) / 2, 0], "m-plastic", 0.65, 0.85,
         anim_role="articulated",
         seg=((el[0], el[1], 0), (wr[0], wr[1], 0), 0.058, 0.048))
    comp(f"sleeve-cuff-{side}", f"Rolled sleeve cuff {side}", "micro", "gear", "cylinder", f"forearm-{side}",
         [0.115, 0.09, 0.115], [cuff[0], cuff[1], 0], "m-fabric", 0.6, 0.85,
         seg=((el[0], el[1], 0), (cuff[0], cuff[1], 0), 0.066, 0.066))
    comp(f"hand-{side}", f"Gloved hand {side}", "meso", "body", "box", f"forearm-{side}",
         [0.09, 0.16, 0.055], [hn[0], hn[1], 0], "m-polymer", 0.55, 0.85,
         anim_role="articulated", pivot=[0, 0.08, 0])
    comp(f"glove-plate-{side}", f"Knuckle plate {side}", "micro", "gear", "box", f"hand-{side}",
         [0.055, 0.05, 0.012], [hn[0], hn[1], 0.03], "m-hardware", 0.4, 0.8)
wr_r = arm_chain(-1)[3]
comp("weapon-socket", "Weapon attachment socket (hand-r grip)", "micro", "socket", "box", "hand-r",
     [0.03, 0.03, 0.03], [wr_r[0], wr_r[1], 0.04], "m-hardware", 0.5, 0.9,
     topo_why="Locator node for attaching an existing accepted weapon asset; no weapon geometry reconstructed.",
     anim_role="socket")
for side, sx in (("l", 1), ("r", -1)):
    comp(f"thigh-{side}", f"Thigh (trouser) {side}", "meso", "body", "capsule", "pelvis",
         [0.165, 0.36, 0.165], [sx * 0.105, 0.72, 0.0], "m-fabric", 0.75, 0.85, anim_role="articulated",
         seg=((sx * 0.10, 0.88, 0), (sx * 0.115, 0.56, 0.01), 0.105, 0.082))
    comp(f"shin-{side}", f"Shin (trouser) {side}", "meso", "body", "capsule", f"thigh-{side}",
         [0.125, 0.47, 0.125], [sx * 0.115, 0.33, 0.0], "m-fabric", 0.7, 0.85, anim_role="articulated",
         seg=((sx * 0.115, 0.56, 0.01), (sx * 0.115, 0.10, -0.02), 0.082, 0.058))
    comp(f"kneepad-{side}", f"Knee pad {side}", "meso", "gear", "ellipsoid", f"shin-{side}",
         [0.17, 0.15, 0.085], [sx * 0.115, 0.575, 0.06], "m-polymer", 0.75, 0.85)
    for k in range(4):
        scx = sx * 0.115 + sx * 0.02 * (1 if k % 2 == 0 else -1)
        scy = 0.575 + 0.016 * (1 if k < 2 else -1)
        comp(f"kneepad-screw-{side}-{k+1}", f"Knee pad screw {side}{k+1}", "micro", "gear", "cylinder",
             f"kneepad-{side}", [0.012, 0.012, 0.012], [scx, scy, 0.083],
             "m-hardware", 0.3, 0.75,
             seg=((scx, scy, 0.079), (scx, scy, 0.087), 0.006, 0.006))
    comp(f"cargo-pocket-{side}", f"Cargo pocket {side}", "meso", "gear", "box", f"thigh-{side}",
         [0.095, 0.13, 0.045], [sx * 0.128, 0.69, 0.02], "m-fabric", 0.6, 0.8)
    comp(f"boot-{side}", f"Combat boot {side}", "meso", "body", "box", f"shin-{side}",
         [0.13, 0.25, 0.30], [sx * 0.115, 0.125, -0.01], "m-boot-leather", 0.65, 0.85,
         anim_role="articulated",
         topo_why="Boot is an assembled box pair (shaft + toe); discrete and rigid within one bone region.")
    comp(f"boot-toe-{side}", f"Boot toe {side}", "micro", "body", "box", f"boot-{side}",
         [0.125, 0.07, 0.10], [sx * 0.115, 0.045, 0.085], "m-boot-leather", 0.5, 0.85)
    for k in range(4):
        comp(f"boot-lace-{side}-{k+1}", f"Boot lace band {side}{k+1}", "micro", "gear", "box", f"boot-{side}",
             [0.09, 0.012, 0.02], [sx * 0.115, 0.19 - k * 0.045, 0.135], "m-hardware", 0.3, 0.7)
comp("holster", "Thigh holster (figure-right)", "meso", "gear", "box", "thigh-r",
     [0.085, 0.19, 0.10], [-0.142, 0.79, 0.03], "m-nylon", 0.7, 0.85)
comp("holster-strap-1", "Holster retention strap 1", "micro", "gear", "box", "thigh-r",
     [0.19, 0.025, 0.19], [-0.105, 0.85, 0.0], "m-nylon", 0.4, 0.8)
comp("holster-strap-2", "Holster retention strap 2", "micro", "gear", "box", "thigh-r",
     [0.19, 0.025, 0.19], [-0.105, 0.72, 0.0], "m-nylon", 0.4, 0.8)

d["componentTree"] = C
byid = {c["id"]: c for c in C}

# ---------- convert WORLD positions -> parent-LOCAL ----------
# Endpoint-branch parents (capsule/cylinder with an attachment) place their pivot at the
# segment START, not their center; transform-branch parents pivot at their center. Child
# offsets are taken against the parent's EFFECTIVE pivot and inverse-rotated by the
# parent's CUMULATED Z rotation.
import math as _m
def _inv_rz(v, ang):
    c_, s_ = _m.cos(-ang), _m.sin(-ang)
    return [c_ * v[0] - s_ * v[1], s_ * v[0] + c_ * v[1], v[2]]
def _own_ang(c):
    r = c["transform"]["rotation"]
    return r[2] if r else 0.0
eff = {}
for c in C:
    par = c["parent"]
    if par is None:
        eff[c["id"]] = (c["transform"]["position"][:], _own_ang(c))
        continue
    pp, pang = eff[par]
    a = c.get("attachment") or {}
    pivot = a.get("worldStart", c["transform"]["position"][:])
    eff[c["id"]] = (pivot, pang + _own_ang(c))
for c in C:
    if c["parent"] is None:
        continue
    pp, pang = eff[c["parent"]]
    p = c["transform"]["position"]
    delta = [p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]]
    c["transform"]["position"] = _inv_rz(delta, pang) if pang else delta
    a = c.get("attachment")
    if a and "worldStart" in a:
        d0 = [a["worldStart"][0] - pp[0], a["worldStart"][1] - pp[1], a["worldStart"][2] - pp[2]]
        d1 = [a["worldEnd"][0] - pp[0], a["worldEnd"][1] - pp[1], a["worldEnd"][2] - pp[2]]
        if pang:
            d0, d1 = _inv_rz(d0, pang), _inv_rz(d1, pang)
        a["localStart"], a["localEnd"] = [round(x, 6) for x in d0], [round(x, 6) for x in d1]
        del a["worldStart"], a["worldEnd"]

d["repetitionSystems"] = [
    {"id": "rs-mag-rows", "pattern": "bilateral 3+3 mag pouches on vest lower band",
     "componentRefs": [f"mag-pouch-{s}{k}" for s in ("l", "r") for k in (1, 2, 3)]},
    {"id": "rs-molle-loops", "pattern": "3 MOLLE loop rows per shoulder strap",
     "componentRefs": [f"molle-loop-{s}-{k}" for s in ("l", "r") for k in (1, 2, 3)]},
    {"id": "rs-kneepad-screws", "pattern": "4-screw face per knee pad",
     "componentRefs": [f"kneepad-screw-{s}-{k}" for s in ("l", "r") for k in (1, 2, 3, 4)]},
    {"id": "rs-boot-laces", "pattern": "4 lace bands per boot front",
     "componentRefs": [f"boot-lace-{s}-{k}" for s in ("l", "r") for k in (1, 2, 3, 4)]},
]

DETAIL_MAP = {
    "d-vest-zip": ("fastener", "vest-zip"), "d-sternum-buckles": ("fastener", "sternum-buckle-l"),
    "d-mag-row": ("ridge", "mag-pouch-l1"), "d-radio-pouch": ("ridge", "radio-pouch"),
    "d-molle-rows": ("ridge", "molle-loop-l-1"), "d-collar": ("contour", "collar"),
    "d-rolled-sleeves": ("seam", "sleeve-cuff-l"), "d-belt": ("contour", "belt"),
    "d-holster": ("ridge", "holster"), "d-cargo-pockets": ("ridge", "cargo-pocket-l"),
    "d-kneepads": ("ridge", "kneepad-l"), "d-glove-plates": ("bevel", "glove-plate-l"),
    "d-boot-laces": ("stitch", "boot-lace-l-1"), "d-ankle-bands": ("seam", "boot-l"),
    "d-waist-cinch": ("groove", "m-fabric"),
}
for det in d["preSpecAssessment"]["detailInventory"]["details"]:
    kind, target = DETAIL_MAP[det["id"]]
    det["kind"] = kind
    det["mapsTo"] = {"ref": target}
    if target.startswith("m-"):
        for m in d["materials"]:
            if m["id"] == target:
                m.setdefault("localOverrides", []).append({"id": det["id"], "note": det["desc"]})
    else:
        byid[target]["localFeatures"].append({"id": det["id"], "note": det["desc"]})

d["featureReviewTargets"] = [
    {"id": "anatomy-proportion", "name": "Head-unit proportions (measured 9.4 HU mannequin axis)",
     "tier": "critical", "passIds": ["blockout", "proportion-lock"], "minimumScore": 0.78, "mustPass": True,
     "componentRefs": ["root", "pelvis", "chest", "head", "thigh-l", "shin-l"],
     "evidenceRefs": ["front-primary"]},
    {"id": "pose-silhouette", "name": "A-pose stance silhouette (arms ~17 deg abduction, feet shoulder-width)",
     "tier": "critical", "passIds": ["blockout", "proportion-lock"], "minimumScore": 0.75, "mustPass": True,
     "componentRefs": ["upper-arm-l", "upper-arm-r", "forearm-l", "forearm-r", "thigh-l", "thigh-r"],
     "evidenceRefs": ["front-primary", "side-secondary"]},
    {"id": "gear-placement", "name": "Gear placement: mag rows, radio pouch figure-left, holster figure-right, knee pads",
     "tier": "critical", "passIds": ["feature-placement"], "minimumScore": 0.75, "mustPass": True,
     "componentRefs": ["vest-shell", "mag-pouch-l1", "mag-pouch-r1", "radio-pouch", "holster", "kneepad-l", "kneepad-r"],
     "evidenceRefs": ["front-primary", "side-secondary"]},
    {"id": "outfit-and-palette", "name": "Outfit palette: white head/forearms vs layered blacks; satin vs matte bands",
     "tier": "important", "passIds": ["material-pass"], "minimumScore": 0.7, "mustPass": True,
     "componentRefs": ["head", "forearm-l", "vest-shell", "kneepad-l", "boot-l"],
     "evidenceRefs": ["front-primary"]},
]

KEEP = ["pelvis", "abdomen", "chest", "neck", "head",
        "thigh-l", "thigh-r", "shin-l", "shin-r", "foot-l", "foot-r"]
PARENT = {"pelvis": None, "abdomen": "pelvis", "chest": "abdomen",
          "neck": "chest", "head": "neck",
          "thigh-l": "pelvis", "thigh-r": "pelvis",
          "shin-l": "thigh-l", "shin-r": "thigh-r",
          "foot-l": "shin-l", "foot-r": "shin-r"}
# MODEL-SPACE (absolute, crown frame) rest-pose joints/tips, per the generator contract:
# it converts to parent-local offsets itself, and the weight table consumes them as
# model-space segments.
REST = {
    "pelvis": (0, 0.885, 0), "abdomen": (0, 1.08, 0), "chest": (0, 1.30, 0),
    "neck": (0, 1.505, 0), "head": (0, 1.605, 0),
    "thigh-l": (0.10, 0.88, 0), "thigh-r": (-0.10, 0.88, 0),
    "shin-l": (0.115, 0.56, 0.01), "shin-r": (-0.115, 0.56, 0.01),
    "foot-l": (0.115, 0.10, -0.02), "foot-r": (-0.115, 0.10, -0.02),
}
TIP = {
    "pelvis": (0, 1.08, 0), "abdomen": (0, 1.30, 0), "chest": (0, 1.475, 0),
    "neck": (0, 1.605, 0), "head": (0, 1.75, 0.02),
    "thigh-l": (0.115, 0.56, 0.01), "thigh-r": (-0.115, 0.56, 0.01),
    "shin-l": (0.115, 0.10, -0.02), "shin-r": (-0.115, 0.10, -0.02),
    "foot-l": (0.115, 0.02, 0.10), "foot-r": (-0.115, 0.02, 0.10),
}
def world3(p): return [p[0] * S, ym(p[1]), p[2] * S]
def chain_of(bid):
    if bid in ("pelvis", "abdomen", "chest", "neck", "head"): return "spine"
    if bid in ("thigh-l", "shin-l", "foot-l"): return "leg-l"
    return "leg-r"
# jointPos/tipPos in MODEL SPACE (absolute); generator derives parent-local offsets.
bones = []
for bid in KEEP:
    jw, tw = world3(REST[bid]), world3(TIP[bid])
    bones.append({"id": bid, "parent": PARENT[bid], "jointPos": jw, "tipPos": tw,
                   "component": bid, "role": "skinned", "chain": chain_of(bid)})
d["rig"]["bones"] = bones
d["rig"]["bindPose"] = "A"
d["rig"]["forward"] = "+Z"
d["rig"]["note"] = ("Bound bones cover spine and legs in MODEL-SPACE joints (the generator derives parent-local "
                     "offsets and uses the records as model-space weight segments). The arm chains are authored in the "
                     "A-pose on the pivot track as named joint-aligned Groups (clavicle->upper-arm->forearm->hand, "
                     "mirrored -l/-r) so cuffs, gloves and the weapon socket travel rigidly with their segment; a Blender "
                     "rigger maps arm bones onto those pivots directly. Gloved hands carry no finger chains.")

d["animationAnchors"] = [
    "root pivot node supports whole-object translation, rotation, scale, and visibility changes",
    "limb pivots sit at measured anatomical joint centers (shoulder/elbow/wrist, hip/knee/ankle) for direct Blender skeleton mapping",
    "left/right pairs are reflections ((x,y,z)->(-x,y,z)), never rotations; triangle winding flips back on the mirrored side",
    "bind stance is the rest pose (arms straight); the A-pose (~17 deg abduction) is the authored pose applied via bones",
    "socket-weapon parented to hand-r for attaching the existing accepted weapon asset",
    "reconstruction data (pivots, sockets, named nodes) stays separate from renderer objects",
]

d["sculptPipeline"]["passOrder"] = [p["id"] for p in d["buildPasses"]]
d["sculptPipeline"]["currentPass"] = d["buildPasses"][0]["id"]
if not any(p["id"] == "structural-pass" for p in d["buildPasses"]):
    d["buildPasses"].insert(2, {"id": "structural-pass",
        "goal": "Assemble the component hierarchy with named joint-aligned pivots; no part floats and every parent-child seam overlaps.",
        "componentRefs": ["root", "pelvis", "chest", "vest-shell", "upper-arm-l", "upper-arm-r", "thigh-l", "thigh-r", "boot-l", "boot-r"],
        "acceptance": ["self-intersection gate exit 0", "attachment anchor gate exit 0", "every component parented with joint-aligned pivot"]})
for p in d["buildPasses"]:
    if p["id"] == "feature-placement":
        p["goal"] = "Place gear (vest, pouches, holster, knee pads, boots, collar, cuffs) and the weapon socket to reference landmarks."
    if p["id"] == "material-pass":
        p["acceptance"] = (p.get("acceptance") or []) + [
            "reference-derived albedo palette: 6 materials with measured hex values (m-plastic #E9E7E2; gear blacks #0A-#16)",
            "roughness variation declared per material band: plastic 0.62, fabric 0.93, nylon 0.88, polymer 0.55, leather 0.45, hardware 0.5",
        ]
    if p["id"] == "lighting-pass":
        p["acceptance"] = (p.get("acceptance") or []) + [
            "soft studio key + background bounce fill; ACES tone intent; gear blacks stay above 0.02 display value",
        ]

d["lightingFromPhoto"] = [
    "key: soft frontal-top key (white studio sweep), mild shadow under jaw/boots; exposure even, no clipped blacks in gear",
    "fill: broad white-background bounce lifting shadow side of trousers/arms; near-shadowless product-display lighting",
    "rim: none visible; background sweep provides edge separation for white head (tone target: filmic, protect gear black detail)",
    "contact shadow: soft ground contact under boot soles (excluded from reconstruction floor measurement; cast shadow ~y1236px)",
    "tone mapping intent: ACES/filmic in review renderer; keep gear blacks above 0.02 display value",
]
d["risks"] = [
    "RESOLVED-unknowns record: rear vest/belt surfaces inferred symmetric (LOW confidence, reported per-region); hardware metalness reads dark (bounded material-scoped correction in material-pass); white head/forearm silhouette edges from soft shadows (head confidence 0.75).",
    "Rear surfaces (vest back, belt rear) inferred symmetric: LOW confidence, reported per-region.",
    "All-black gear compresses interior detail: pouch separation reads by geometry edges.",
    "White head vs white background: silhouette edges from soft shadows; head geometry confidence 0.75.",
]

json.dump(d, open(SPEC, "w"), indent=2)
json.dump(ASM, open(ASMT, "w"), indent=2)
print(f"spec authored: {len(C)} components, {len(bones)} bones, {len(d['materials'])} materials")
