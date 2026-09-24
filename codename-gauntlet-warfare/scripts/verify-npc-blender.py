"""Headless Blender verification for the operator NPC glTF (deterministic).

Run: blender --background --factory-startup --python scripts/verify-npc-blender.py -- <gltf-path>
Prints a JSON summary: armature count, bone names, mesh count, triangle count,
hierarchy sanity (every mesh parented, non-empty), and exits nonzero on failure.
"""
import json
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:]
path = argv[0]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)

armatures = [o for o in bpy.data.objects if o.type == "ARMATURE"]
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
# The Blender glTF importer emits a hidden placeholder "Icosphere" (its default
# custom bone shape) for armatures; it is importer furniture, not asset geometry.
importer_placeholders = [o for o in meshes if not o.visible_get()]
meshes = [o for o in meshes if o.visible_get()]
bones = sorted(b.name for a in armatures for b in a.data.bones)

triangles = 0
orphan_meshes = []
for m in meshes:
    for p in m.data.polygons:
        triangles += p.loop_total - 2
    if m.parent is None:
        orphan_meshes.append(m.name)

expected_bones = {
    "pelvis", "abdomen", "chest", "neck", "head",
    "thigh-l", "thigh-r", "shin-l", "shin-r", "foot-l", "foot-r",
}
missing_bones = sorted(expected_bones - set(bones))

skinned_meshes = sum(
    1 for m in meshes
    if any(mod.type == "ARMATURE" for mod in m.modifiers)
)

summary = {
    "blender_version": bpy.app.version_string,
    "armatures": len(armatures),
    "bones": bones,
    "missing_expected_bones": missing_bones,
    "meshes": len(meshes),
    "skinned_meshes": skinned_meshes,
    "triangles": triangles,
    "orphan_meshes": orphan_meshes,
    "importer_placeholders": [o.name for o in importer_placeholders],
    "ok": (
        len(armatures) == 1
        and not missing_bones
        and len(meshes) > 0
        and not orphan_meshes
        and skinned_meshes > 0
    ),
}
print("NPC_BLENDER_VERIFY " + json.dumps(summary))
if not summary["ok"]:
    sys.exit(1)
