# How-To Guide: Register and Verify an Asset

This guide provides a step-by-step procedure for ingesting a 3D asset into the project's `AssetRegistry`, setting legal provenance, compiling/optimizing it via glTF-Transform, and running automated acceptance gates.

---

## 1. Goal

You have an art asset (e.g. `assets/props/antenna.glb`) and want to register it into the game's production pipeline, ensure it conforms to licensing and budget policies, optimize its textures to WebP, and accept it into `assets/manifest.json`.

---

## 2. Step 1: Register the Asset with Provenance

Every production asset must have an `AssetRecord` declaring its origin class (`user`, `project`, `cc0`, `licensed`, `generated`, `blender`, `procedural`).

Use the studio CLI to register the asset:

```bash
bun run studio -- asset register \
  --id prop.communication-antenna \
  --role interactive_prop \
  --origin cc0 \
  --source assets/props/antenna.glb \
  --license CC0-1.0 \
  --route asset.optimize
```

### What This Does:
- Computes the SHA-256 hash of `antenna.glb`.
- Validates the entry against `AssetRecordSchema`.
- Appends an `"intake"` event to `assets/manifest.json` with state `"pending"`.

---

## 3. Step 2: Compile & Optimize the Asset

Raw glTF files typically contain uncompressed PNG/JPEG textures, redundant vertex normals, and unindexed geometry.

Run the glTF-Transform compilation pipeline:

```bash
bun run studio -- asset compile \
  --input assets/props/antenna.glb \
  --output assets/props/antenna.optimized.glb \
  --webp
```

### What This Does:
- Converts textures to WebP format.
- Welds duplicate vertices and simplifies mesh geometry.
- Emits a budget summary:
  ```text
  [compile] Optimized antenna.glb -> antenna.optimized.glb
  [compile] Original size: 4.2 MB -> Optimized size: 680 KB (83.8% reduction)
  [compile] Triangles: 3,400 -> 2,100
  ```

---

## 4. Step 3: Run Asset Acceptance Gates

Run the verification gate across all assets:

```bash
bun run studio -- asset verify --id prop.communication-antenna
```

### Gates Evaluated:
1. **Provenance Gate**: Validates that license is approved and source hash matches the file on disk.
2. **Budget Gate**: Checks triangle count against target quality profile (`desktop-high`: `<= 2500` for props).
3. **Affordance Gate**: Confirms that if the role is `interactive_hero_prop`, required semantic sockets and colliders are declared.

If all gates pass:
- The asset acceptance state transitions from `"pending"` to `"accepted"`.
- A success record is logged in `assets/manifest.json`.

---

## 5. Handling Failures & Waivers

### Failure Case: Unapproved License
If the license is missing or proprietary:
```text
FAIL: Asset 'prop.communication-antenna' has unapproved license: 'All-Rights-Reserved'
Status: REJECTED
```
**Resolution**: Replace the asset with an authorized CC0 asset or approved project reference.

### Failure Case: Budget Exceeded
If an asset is visually critical but exceeds triangle thresholds:
```text
FAIL: Asset 'prop.communication-antenna' exceeds triangle budget (found 3400, max 2500)
Status: BLOCKED
```
**Resolution Options**:
1. Run glTF-Transform simplification to reduce polygon count.
2. If approved by the lead artist, apply a recorded waiver in `assets/manifest.json`:
   ```json
   {
     "waiver": {
       "gate": "budget",
       "reason": "Hero antenna prop requires detailed mesh silhouette",
       "author": "lead-artist"
     }
   }
   ```
   *Applying a waiver marks the asset as `"degraded"` rather than `"accepted"`, preserving the audit trail.*
