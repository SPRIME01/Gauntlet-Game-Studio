# Turnaround Intake — Operator NPC v2 (2026-09-19)

Primary visual target changed by operator instruction: the previous photo references
(`operator-tactical-front/side.jpg`, mannequin product photos) are superseded by the
operator-supplied AAA turnaround sheet `references/operator-turnaround-sheet.png`
(sha256 70986adc0c7c748a1d7b25ffd6ee681a223c21f52aa5c9579778ff238b45972b).
Old intake evidence preserved under `archive-frontphoto-run/`.

## Layered observation

**Object class.** Clothed humanoid combatant (character domain), bilateral symmetric,
realistic adult build with heroic-tactical mass. Faceless: identity lives in silhouette,
gear masses, and material read — no facial likeness surface.

**View inventory (top row, cropped clean by `scripts/crop-turnaround.py`):**
front, left profile, back, right profile, 3/4 front, 3/4 back.
Detail panels: head front/side/back, torso, leg, glove, boot. Pistol panel is design
reference for a separate weapon asset — NOT to be merged into the body mesh (weapon
socket architecture preserved).

**Macro decomposition (head→foot).**
1. Ballistic helmet (rounded shell, brim, side rails/accessory mounts, small NVG shroud
   front plate), antenna on left-rear in most views (right-rear in right profile).
2. Dark goggles band wrapping the helmet mid-line, near-black lens, slight sheen.
3. Black face covering (balaclava-style) under the goggle line.
4. Layered neck covering: wrap/scarf mass flaring at the shoulders, olive tone.
5. Combat shirt/jacket, dark olive/charcoal, sleeve folds at elbow, cuff transitions.
6. Substantial plate carrier: front plate bag with MOLLE-like segmentation, mag pouch
   row (3-across), side pouches, shoulder pads, sternum strap; radio/cable on left
   chest in front view; backpack/rear carrier on back view with antenna.
7. Belt with pouches + dump pouch; thigh rig: holster + pouch on right thigh (viewer
   left in front view), straps.
8. Trousers with cargo volume, fold noise; hard knee pads (rounded shells).
9. Lace-up tactical boots, substantial sole, ~0.10-0.12 H tall.
10. Gloves (hard-knuckle), visible hand mass ~0.09 H.

**Micro features (identity-supporting, not fidelity-gating at 75%):** buckles, MOLLE
straps, zipper lines, boot laces, knee pad fasteners, glove knuckle plate, helmet rail
detail, radio cable curve.

**Materials (from sheet swatch row):** tactical fabric cordura/nylon (olive), plate
carrier matte nylon (dark olive-black), metal hardware anodized steel (low-sat dark),
rubber/polymer low sheen (near-black), fabric camo subtle pattern. Lens = glossy near-
black; boot = rough synthetic leather. Distinguish by roughness/metalness + form
breakup, not albedo alone.

## Measured proportion targets (fraction of total height H, front view)

From `turnaround-profiles.json` (29-row full-span + torso-midline runs per view) and
`turnaround-landmarks.json`:

| Feature | Value |
|---|---|
| Visible head block (crown→collar flare) | 0.005–0.160 H; helmet width ≈ 0.10–0.13 H |
| Max goggle-band width | 0.129 H at 14% H |
| Shoulder (deltoid row, arms merging) | 0.29–0.36 H at 21–29% H |
| Max full span (upper arms @ ~27° from vertical) | 0.422–0.424 H at 32–36% H |
| Carrier chest (torso-only) | ≈ 0.30–0.33 H at 30% H |
| Waist (torso-only) | 0.22–0.25 H at 39–50% H |
| Hip/gear span | 0.29–0.31 H at 57–61% H |
| Two-thigh span | 0.20–0.24 H at 64–68% H |
| Knee-pad band | 0.19–0.21 H at 76–82% H |
| Ankle pinch | 0.12 H at 89–93% H |
| Boot flare to sole | 0.14 H at 96–100% H |
| Chest depth (left view) | 0.24–0.25 H at 32–36% H |
| Helmet depth | 0.16 H |
| Waist depth | 0.18 H |
| Boot sole length | 0.17 H |
| A-pose arm angle | ≈ 27° from vertical both sides (hand tips at ≈ 50% H) |
| Hand-tip height | 0.50 H |
| Head unit (visible block) | ≈ 6.2 blocks/stature (helmeted read; chin occluded) |

Known contradictions between views (per operator priority: front silhouette > side
depth > back structure > 3/4 confirmation > detail panels): rear antenna side differs
between left/right profiles; mag-pouch row count reads 3 front / 2 back. Resolve to
front + side; do not distort canonical forms for the 3/4 views.

## Instrument history note (do not repeat)

The previous run's silhouette IoU plateau (aligned 0.476 vs 0.75 target) was traced to
the reference mask including a cast-shadow halo (±0.386 m at boot level vs true boots
±0.19 m). The new crops contain no measurable shadow contamination: darkest
non-subject pixel below the boots is gray 144+ vs subject threshold 120
(`crops-manifest.json.rows_below_boots_min_gray`). IoU against these crops is valid
as a tier-1 diagnostic.
