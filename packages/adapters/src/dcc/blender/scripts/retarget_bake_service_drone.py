# Retarget the service-drone source animation onto the delivery rig and bake.
#
# Part of the dcc.blender.process route (T18, REQ-BLENDER-003). Deterministic:
# all inputs come from the committed definition; no randomness, no GUI. Run via:
#   blender --background --factory-startup --python retarget_bake_service_drone.py -- \
#     <source.blend> <definition.json> <raw.glb> <report.json>
#
# Pipeline inside this script:
#   1. open the generated source .blend (DroneRigSource + hover action);
#   2. build the delivery rig (DroneRigTarget) and skinned low-poly mesh parts;
#   3. retarget bone-by-bone with copy constraints from the retarget_map;
#   4. bake the visual motion into keyframes (nla.bake), constraints cleared;
#   5. remove the source rig and export a standard GLB (REQ-BLENDER-004);
#   6. write the bake report JSON (regeneration metadata + DCC metadata).

import hashlib
import json
import math
import sys


def log(message):
    print(f"[retarget_bake_service_drone] {message}", flush=True)


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def build_armature(name, bone_specs):
    import bpy

    armature = bpy.data.armatures.new(name)
    obj = bpy.data.objects.new(name, armature)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    for spec in bone_specs:
        bone = armature.edit_bones.new(spec["name"])
        bone.head = tuple(spec["head"])
        bone.tail = tuple(spec["tail"])
        bone.roll = 0.0
    bpy.ops.object.mode_set(mode="OBJECT")
    return obj


def box_verts(center, size):
    cx, cy, cz = center
    sx, sy, sz = (s / 2.0 for s in size)
    return [
        (cx - sx, cy - sy, cz - sz), (cx + sx, cy - sy, cz - sz),
        (cx + sx, cy + sy, cz - sz), (cx - sx, cy + sy, cz - sz),
        (cx - sx, cy - sy, cz + sz), (cx + sx, cy - sy, cz + sz),
        (cx + sx, cy + sy, cz + sz), (cx - sx, cy + sy, cz + sz),
    ]


BOX_FACES = [
    (0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4),
    (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7),
]


def build_mesh_part(name, bone_name, center, size, armature_obj):
    import bpy

    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    mesh.from_pydata(box_verts(center, size), [], list(BOX_FACES))
    mesh.update()
    group = obj.vertex_groups.new(name=bone_name)
    group.add(list(range(len(mesh.vertices))), 1.0, "REPLACE")
    modifier = obj.modifiers.new("armature", "ARMATURE")
    modifier.object = armature_obj
    obj.parent = armature_obj
    return obj


def _count_fcurves(action, slot):
    # Blender 5.x layered-action API: fcurves live in the slot's channelbag.
    for layer in action.layers:
        for strip in layer.strips:
            try:
                bag = strip.channelbag(slot)
            except Exception:
                continue
            if bag is not None:
                return len(bag.fcurves)
    return 0


def triangle_count():
    import bpy

    total = 0
    for obj in bpy.data.objects:
        if obj.type == "MESH":
            for polygon in obj.data.polygons:
                total += max(1, len(polygon.vertices) - 2)
    return total


def main():
    import bpy

    argv = sys.argv
    if "--" not in argv:
        raise SystemExit("usage: blender --background --factory-startup --python "
                         "retarget_bake_service_drone.py -- <source.blend> <definition.json> "
                         "<raw.glb> <report.json>")
    args = argv[argv.index("--") + 1:]
    source_blend, definition_path, raw_glb, report_path = args[0], args[1], args[2], args[3]

    with open(definition_path, "r", encoding="utf-8") as f:
        definition = json.load(f)

    bpy.ops.wm.open_mainfile(filepath=source_blend)

    target_spec = definition["target_rig"]
    source_name = definition["source_rig"]["armature"]
    target_obj = build_armature(target_spec["armature"], target_spec["bones"])
    log(f"built target rig '{target_spec['armature']}' "
        f"({len(target_spec['bones'])} bones)")

    for part in definition["mesh"]["parts"]:
        build_mesh_part(part["name"], part["bone"],
                        part["center"], part["size"], target_obj)
    log(f"built {len(definition['mesh']['parts'])} skinned mesh parts")

    # --- Retarget: copy constraints per the retarget_map -------------------
    source_obj = bpy.data.objects[source_name]
    constraint_types = []
    for mapping in target_spec["retarget_map"]:
        pose_bone = target_obj.pose.bones[mapping["target"]]
        constraint = pose_bone.constraints.new(
            "COPY_TRANSFORMS" if mapping["mode"] == "transform" else "COPY_ROTATION"
        )
        constraint.target = source_obj
        constraint.subtarget = mapping["source"]
        constraint.target_space = "LOCAL"
        constraint.owner_space = "LOCAL"
        if constraint.type not in constraint_types:
            constraint_types.append(constraint.type)
    log(f"retargeted {len(target_spec['retarget_map'])} bone channel(s) "
        f"via {constraint_types}")

    # --- Bake visual motion into keyframes ---------------------------------
    bake = definition["bake"]
    bpy.context.view_layer.objects.active = target_obj
    target_obj.select_set(True)
    bpy.ops.object.mode_set(mode="POSE")
    for pose_bone in target_obj.pose.bones:
        pose_bone.select = True
    bpy.ops.nla.bake(frame_start=int(bake["frame_start"]),
                     frame_end=int(bake["frame_end"]),
                     only_selected=True,
                     visual_keying=bool(bake["visual_keying"]),
                     clear_constraints=bool(bake["clear_constraints"]),
                     use_current_action=False,
                     bake_types={"POSE"})
    baked_action = target_obj.animation_data.action
    baked_action.name = definition["export"]["animation_name"]
    baked_fcurves = _count_fcurves(baked_action, target_obj.animation_data.action_slot)
    log(f"baked action '{baked_action.name}' with {baked_fcurves} fcurve(s)")
    bpy.ops.object.mode_set(mode="OBJECT")

    # --- Remove the source rig; ship only the delivery derivative ----------
    bpy.data.objects.remove(source_obj, do_unlink=True)
    bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True)

    scene = bpy.context.scene
    scene.frame_start = int(bake["frame_start"])
    scene.frame_end = int(bake["frame_end"])

    # Structural provenance markers ride on the target rig object as Blender
    # custom properties and export as glTF node extras (export_extras=True).
    # Content policy is studio-side: the dcc adapter rejects quest/NPC semantic
    # keys BEFORE this script ever runs (REQ-BLENDER-005).
    metadata = definition.get("dcc_metadata", {})
    for key, value in metadata.items():
        target_obj[key] = value

    # --- Export standard GLB (REQ-BLENDER-004) ------------------------------
    bpy.ops.export_scene.gltf(filepath=raw_glb,
                              export_format=definition["export"]["format"],
                              export_extras=True,
                              export_animations=True,
                              export_yup=True)
    log("exported " + raw_glb)

    metadata = definition.get("dcc_metadata", {})
    report = {
        "schema": "gauntlet.dcc.blender.bake_report",
        "schema_version": "1.0",
        "asset_id": definition["asset_id"],
        "capability": definition.get("capability", "dcc.blender.process"),
        "blender": {
            "version_string": bpy.app.version_string,
            "version": list(bpy.app.version),
        },
        "invocation": {
            "mode": "blender --background --factory-startup --python <script> -- <args>",
            "scripts": ["retarget_bake_service_drone.py"],
        },
        "source": {
            "definition_path": definition_path,
            "definition_sha256": sha256_of(definition_path),
            "blend_path": source_blend,
            # Not pinned: .blend files embed a per-save session UID, so the
            # intermediate's bytes differ run to run even though the CHAIN
            # OUTPUT is byte-deterministic (verified: raw GLB and normalized
            # derivative hashes are stable across runs). The derivative is
            # pinned by export.sha256 below and the committed AssetRecord.
            "blend_sha256_note": "regenerable intermediate; not pinned (per-save session UID)",
            "blend_generated_by": "generate_service_drone_source.py",
        },
        "retarget": {
            "source_armature": source_name,
            "target_armature": target_spec["armature"],
            "mapped_bones": [
                {"source": m["source"], "target": m["target"], "mode": m["mode"]}
                for m in target_spec["retarget_map"]
            ],
            "constraint_types": constraint_types,
        },
        "bake": {
            "frame_start": int(bake["frame_start"]),
            "frame_end": int(bake["frame_end"]),
            "visual_keying": bool(bake["visual_keying"]),
            "clear_constraints": bool(bake["clear_constraints"]),
            "baked_action": baked_action.name,
            "fcurves": baked_fcurves,
        },
        "export": {
            "path": raw_glb,
            "sha256": sha256_of(raw_glb),
            "format": definition["export"]["format"],
            "animations": [baked_action.name],
            "triangles": triangle_count(),
        },
        # Structural provenance affordances ONLY (REQ-BLENDER-005): gameplay
        # semantics never live in DCC metadata; the studio-side dcc adapter
        # rejects quest/NPC semantic keys before this file ever lands.
        "dcc_metadata": metadata,
    }
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, sort_keys=True)
        f.write("\n")
    print("RETARGET_BAKE_RESULT " + json.dumps({
        "baked_action": baked_action.name,
        "fcurves": baked_fcurves,
        "triangles": report["export"]["triangles"],
        "raw_glb_sha256": report["export"]["sha256"],
        "blender_version": bpy.app.version_string,
    }, sort_keys=True), flush=True)
    log("wrote " + report_path)


main()
