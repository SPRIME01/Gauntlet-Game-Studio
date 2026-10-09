# Quaternius Foundation Intake (Phase 1)

This is the **verified source intake** stage, not a finished runtime character system. Gauntlet's original project-local `AssetRegistry`, `asset.resolve` policy, Koota authority, and tri-channel proof remain unchanged.

## Input

The feature branch inherits the original ZIP archives from `main` under `assets/sources/quaternius/`. They are tracked in Git LFS. From the repo root:

```sh
git lfs pull
python3 scripts/foundations/import_quaternius.py
python3 -m unittest discover -s scripts/foundations -p 'test_*.py'
```

No third-party Python packages are needed. The importer writes to `.tmp/foundations/quaternius/` (ignored by Git), including a deterministic `inventory.json` and selected raw glTF assets. You may override locations with `--sources` and `--output`.

## Findings verified from the uploaded Standard ZIPs

| Input | Importable assets |
| --- | --- |
| Universal Base Characters Standard | 2 rigged superhero full-body glTF characters, female and male |
| Universal Animation Library 1 Standard | 43 animation names in both in-place and root-motion GLBs |
| Universal Animation Library 2 Standard | 43 animation names in both in-place and root-motion GLBs |
| Modular Character Outfits Fantasy Standard | 4 complete outfits (female/male peasant and ranger) |

**10 selected files** (2 models, 4 animation GLBs, 4 outfit models); **85 unique animation names** across both collections (the A_TPose animation appears in both). All 10 primary glTF/GLB assets have the same **65 ordered joint names** in their first skins. This is useful compatibility evidence; actual retargeting, skinned-mesh attachment, and animation appearance still require live runtime tests.

The Standard edition does **not** supply separate rigged boy/girl characters or the six base bodies mentioned in promotional descriptions of the expanded source pack. Do not invent or silently claim those assets exist.

## Source repairs

Two original superhero glTF JSON files reference three nonexistent texture filenames. The importer only rewrites references in generated derivative copies:
- `T_Eye_Normal_png.png` -> `T_Eye_Normal.png` (female and male)
- `T_Hair_1_Normal_png.png` -> `T_Hair_1_Normal.png` (male)

The original ZIPs are never modified. The inventory records the repairs and SHA-256 of each derivative, together with original ZIP SHA-256 and CC0 license-file evidence.

## Safety and release boundary

- Import refuses absent Git LFS content, unknown license evidence, unsafe ZIP paths, oversize members, missing texture/buffer dependencies, duplicate clip names, or incompatible ordered bone layouts.
- Output stays in `.tmp/` and entries are marked `pending`; **this stage does not accept assets into any game's production manifest**.
- Use the non-root-motion GLBs for Koota-authoritative movement by default. Root-motion variants require explicit projection/controller integration before use.
- The exporter uses original `.gltf` + `.bin` + texture dependencies for characters/outfits. Runtime-friendly `.glb` consolidation/texture compression requires a later validated glTF-Transform stage.
- The outfit author notes that the **head-only base mesh** should be used with outfits to avoid clipping; compositing an outfit over an entire full-body character is not correct.

## Next implementation stages

1. Build semantic foundation contracts and catalog queries in `packages/studio` (asset roles, style family, rig/profile signatures, variant compatibility and per-source provenance).
2. Integrate foundation candidates ahead of external providers inside existing `asset.resolve`, without bypassing `AssetRegistry` acceptance.
3. Implement a third-person humanoid prefab with Three.js `AnimationMixer`, authoritative Koota state transitions, equipment sockets, and safe root-motion policy.
4. Add Blender/glTF-Transform normalization, appropriate LOD/texture budgets, visual screenshot/animation proof, and accepted project derivatives.
5. Expand into lighting, cameras, environment and gameplay prefabs **after** the humanoid vertical slice passes browser performance and motion verification.
