# Reference Suitability + Spec v2 Delta — Turnaround Target (2026-09-19)

## Suitability verdict (validation rubric): PASS

- Multi-view sheet (6 canonical views + 7 detail panels) exceeds the single-image
  suitability bar; hidden-side risk that plagued the photo route is retired.
- Generated art direction (not photogrammetry): small cross-view inconsistencies are
  expected; priority order fixed by operator: front silhouette > side depth > back
  structure > 3/4 confirmation > detail panels.
- Subject/background separation verified clean (no labels, borders, cast shadow in
  crops; `crops-manifest.json`).
- Intended use: real-time game NPC (playable loop), rig-mappable for Blender skeletal
  animation; weapon attach via existing socket (pistol panel is separate-asset design
  reference only).

## Spec v2 delta vs blockout spec (object-sculpt-spec.json)

The v1 spec produced an accepted-topology but visually flat blockout (white mannequin
head, slab vest, no head gear). v2 keeps the accepted structural contract and replaces
the form/material targets:

**Unchanged (structural contract):**
- Named anatomical hierarchy: pelvis > abdomen > chest > neck > head;
  clavicle > upper-arm > forearm > hand (L/R); thigh > shin > foot (L/R).
- Joint-aligned pivots, A-pose authored state, L/R mirrors (equipment asymmetry
  allowed: thigh rig, radio, antenna).
- weapon-socket node under hand-r; no weapon geometry.
- World-baked skinned-mesh bind protocol, sockets/colliders/destructionGroups in
  `root.userData.sculptRuntime`, rig in `root.userData.rig`.
- Export route: `scripts/export-npc-gltf.ts` → `assets/operator-npc.gltf`,
  verified in headless Blender 5.2.2.

**Changed (form targets):**
1. Head: helmet shell (spherical-cap + brim + rails + NVG shroud) replaces bare
   mannequin head; goggles band (glossy near-black torus-band + lens); face covering;
   layered neck wrap. Head block 0.005–0.160 H, goggle width 0.129 H.
2. Torso: shirt with chest taper + sleeve cylinders at real arm angle (27°);
   substantial carrier: front plate bag (0.30–0.33 H wide × 0.24–0.25 H deep system),
   3-across mag pouch row, side pouches, shoulder pads, sternum strap, radio+cable;
   belt with pouches; rear carrier/backpack mass (back view structure 0.51 H wide band
   at waist height is rear gear, not body).
3. Limbs: tapered loft limbs with volume (arm ≈ 0.055–0.065 H radius at upper arm,
   forearm taper, glove mass 0.09 H incl. knuckle plate); legs: thigh 0.095 H radius
   incl. cargo volume, calf taper, hard knee pad shells, ankle pinch 0.12 H.
4. Boots: sole box + rounded toe + laced shaft, 0.10–0.12 H tall, 0.17 H sole length.
5. Thigh rig on character-right thigh (holster + pouch + straps); antenna on
   carrier left-rear (front view) — equipment asymmetry only.
6. Proportion authority: `turnaround-profiles.json` full-span/midline vectors per view
   + depth vectors; used as the numeric target for every build iteration.

**Material classes (7):** uniform fabric (olive cordura, rough 0.85), carrier nylon
(dark olive-black, rough 0.78), rubber/polymer (near-black, rough 0.6 low sheen),
anodized metal hardware (dark, metalness 1, rough 0.45), goggle lens (smooth,
rough 0.15), boot leather/synthetic (rough 0.7, darker), glove fabric+polymer mix
(rough 0.75). Albedo palette restrained military; separation via roughness/metalness
+ normal breakup (AO/height bands), never albedo alone.

**Budget:** the frozen 12k-tri cap is superseded by operator instruction (evidence:
18,880-tri baseline fits the 180k game budget with 58.6k used; 2 instances fit).
Optimize for smallest geometry preserving form; measure the real game budget after
convergence. Draw-call merge pass happens AFTER visual acceptance (preserve
articulated groups, sockets, Blender usability).

## Acceptance (composite, operator definition)

Weighted: 30% silhouette+anatomy, 25% major equipment placement/proportion, 15%
side/back volumetric agreement, 15% material readability, 10% secondary gear/forms,
5% fine detail. Hard minimums: recognizable without the reference beside it; believable
front+profile proportions; no missing major gear category; no blockout-looking primary
forms; front/back carrier distinct; boots/gloves/helmet/knee pads/pouches authored;
fabric/polymer/metal/rubber/lens visibly separate; intact limb hierarchy; no detached
components; no severe self-intersection; A-pose animation-ready; Blender import
verified. Ceiling ~75–80%: no time on stitching/labels/micro-scratches.
