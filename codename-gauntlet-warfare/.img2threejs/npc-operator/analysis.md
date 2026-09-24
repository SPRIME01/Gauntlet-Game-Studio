# Image analysis — operator-tactical-front.jpg (1254×1254)

Per `grimoire/intake/image_analysis.md`, bottom-up, observation before inference.

## Layer 1 — Identification
- Observable: adult-humanoid dressed form; faceless matte-white head and hands; full black tactical clothing/gear set. Product-display mannequin presentation.
- Work type: clothed humanoid figure (tactical operator set on mannequin). Broad: character.
- `primaryDomain`: character. Confidence 0.9.

## Layer 2 — Form & silhouette
- Standing bipedal; bounding volume ≈ 7.5–8 head-units tall (adult canon); near-bilateral symmetry; stance: feet ~shoulder-width, figure's right foot marginally advanced/out-toed (slight asymmetry).
- Arms in mild A-pose: abducted ~15–20° from vertical, elbows straight, white hands at hip level.
- Shape language: geometric/tailored garment volumes over simplified anatomy (mannequin).
- Background: uniform white; silhouette fully separated, no occlusion, head-to-toe visible.

## Layer 3 — Macro → meso → micro
- Macro: head; neck; torso (shirt+vest assembly); pelvis (belt assembly); arm.L; arm.R; leg.L; leg.R; boots.
- Meso:
  - Torso: mandarin-collar combat shirt (sleeves rolled to mid-forearm); plate carrier vest (front zip, 2 vertical sternum buckles, pouch rows, shoulder straps with loop rows); radio pouch figure-left chest.
  - Pelvis: belt with buckle; holster on figure-right thigh with 2 retention straps; hip pouch figure-left.
  - Legs: cargo trousers (bilateral cargo pockets, banded ankles); round bilateral knee pads (4-screw face).
  - Arms: hard-knuckle tactical gloves.
  - Boots: black lace-up side-zip combat boots.
- Micro: buckle hardware ×2 (sternum), zip line + pull, pouch flap edges, MOLLE loop rows on straps, glove knuckle plates, knee-pad screws, boot eyelets/laces, collar band, belt pouches.

## Layer 4 — Spatial relationships
- <head, above, torso> neck contact (butt joint, mannequin).
- <vest, attached-to, shirt/torso> overlap, flush front; <pouches/radio pouch, attached-to, vest front> surface-mounted; <shoulder straps, wraps, torso> over shoulders.
- <belt, encircles, pelvis>; <holster, attached-to, figure-right thigh + belt> via vertical straps; <hip pouch, attached-to, figure-left hip>.
- <knee pads, strap-on, knees over trousers>.
- <boots, below, trouser cuffs> banded-ankle overlap.
- <arm.L/R, articulated-at, shoulders> mirrored A-pose; <leg.L/R, articulated-at, hips> vertical.

## Layer 5 — Materials (PBR)
- Head/hands: matte white plastic; albedo ~0.85–0.92 value; metalness 0; roughness ~0.6–0.7; subtle uniform specular.
- Shirt/trousers: matte black fabric; albedo ~0.03–0.05; metalness 0; roughness ~0.9–0.95.
- Vest/pouches/belt: matte black nylon; albedo ~0.04; roughness ~0.85–0.9; slight sheen on flap edges (inference: nylon sheen).
- Hardware (buckles/zip/screws): dark grey polymer or anodized metal; albedo ~0.08–0.12; metalness uncertain (reads dark) 0.2–0.6 band; roughness ~0.5 (inference flagged).
- Knee pads/gloves/boots: satin black polymer/leather; roughness ~0.6–0.8; boot toe caps glossier.
- Flag: all-black gear compresses fabric-vs-nylon distinction; treat as near-uniform dark band with value separation by form.

## Layer 6 — Color & finish
- Near-monochrome: white (head/forearms/hands) against layered near-blacks (0–0.10 value); hardware mid-grey accents; no prints/patterns.
- Finish: matte dominant; satin on pads/boot toes; high subject–background contrast.

## Layer 7 — Identity-defining features
1. Faceless matte-white mannequin head + exposed white forearms/hands (subject class marker).
2. Plate-carrier front: central zip + 2 vertical sternum buckles + lower bilateral mag-pouch row.
3. Radio pouch at figure-left chest; MOLLE loop rows on shoulder straps.
4. Rolled sleeves exposing white forearms (strong silhouette signature).
5. Figure-right thigh holster rig with 2 retention straps.
6. Round screw-faced knee pads, bilateral.
7. Hard-knuckle gloves.
8. Lace-up side-zip combat boots; banded trouser ankles.
9. Mandarin collar.

## Layer 8 — Uncertainty (single front view; side view available)
- Hidden (no view): back of vest/pouches/straps; back of head/neck; belt rear; glove palms; boot soles. Rear geometry inferred symmetric — LOWER CONFIDENCE, recorded in spec unknowns.
- Side view resolves: vest depth, collar height, radio pouch profile, boot profile, glove profile, holster side.
- Face: none exists (featureless mannequin) — no likeness surface.
- Perspective: frontal, ~chest-height camera, mild telephoto; minimal distortion; subject ≈ 70% of frame height.
- White-on-white boundary risk at head/hairline against background: moderate; silhouette extraction must use the soft shadow edge.
