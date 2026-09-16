# Generate the deterministic service-drone SOURCE rig + animation .blend.
#
# Part of the dcc.blender.process route (T18, REQ-BLENDER-003). This script is
# deterministic: every value comes from the committed source definition JSON; no
# randomness, no wall-clock time, no GUI. Run via:
#   blender --background --factory-startup --python generate_service_drone_source.py -- \
#     <definition.json> <output.blend>
#
# The output .blend is the retarget SOURCE: an armature (DroneRigSource) with a
# hover-cycle action that retarget_bake_service_drone.py later maps onto the
# delivery rig (DroneRigTarget) and bakes into keyframes.

import hashlib
import json
import sys


def log(message):
    print(f"[generate_service_drone_source] {message}", flush=True)


def build_armature(name, bone_specs):
    import bpy

    armature = bpy.data.armatures.new(name)
    obj = bpy.data.objects.new(name, armature)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    by_name = {}
    for spec in bone_specs:
        bone = armature.edit_bones.new(spec["name"])
        bone.head = tuple(spec["head"])
        bone.tail = tuple(spec["tail"])
        bone.roll = 0.0
        by_name[spec["name"]] = bone
    bpy.ops.object.mode_set(mode="OBJECT")
    return obj


def build_action(armature_obj, action_spec):
    import bpy

    action = bpy.data.actions.new(action_spec["name"])
    armature_obj.animation_data_create()
    armature_obj.animation_data.action = action
    # Blender 5.x layered-action API: keys route through a slot on the object.
    slot = action.slots.new(id_type="OBJECT", name=armature_obj.name)
    armature_obj.animation_data.action_slot = slot
    for bone_name, channels in action_spec["channels"].items():
        pose_bone = armature_obj.pose.bones[bone_name]
        for channel, keys in channels.items():
            for frame, values in keys:
                setattr(pose_bone, channel, tuple(values))
                pose_bone.keyframe_insert(data_path=channel, frame=float(frame))
    _set_linear_interpolation(armature_obj, action, slot)
    return action


def _set_linear_interpolation(armature_obj, action, slot):
    # Deterministic interpolation: straight linear keys (default bezier is also
    # deterministic, but linear keeps sampled export values predictable).
    for layer in action.layers:
        for strip in layer.strips:
            try:
                bag = strip.channelbag(slot)
            except Exception:
                continue
            if bag is None:
                continue
            for fcurve in bag.fcurves:
                for kp in fcurve.keyframe_points:
                    kp.interpolation = "LINEAR"
                fcurve.update()


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    import bpy

    argv = sys.argv
    if "--" not in argv:
        raise SystemExit("usage: blender --background --factory-startup --python "
                         "generate_service_drone_source.py -- <definition.json> <output.blend>")
    args = argv[argv.index("--") + 1:]
    definition_path, output_blend = args[0], args[1]

    with open(definition_path, "r", encoding="utf-8") as f:
        definition = json.load(f)

    # Deterministic empty scene (no default cube/camera/light in the artifact).
    bpy.ops.wm.read_factory_settings(use_empty=True)

    source = definition["source_rig"]
    arm_obj = build_armature(source["armature"], source["bones"])
    for action_spec in source["actions"]:
        build_action(arm_obj, action_spec)
        log(f"built action '{action_spec['name']}' "
            f"({action_spec['frame_start']}..{action_spec['frame_end']})")

    scene = bpy.context.scene
    scene.frame_start = source["actions"][0]["frame_start"]
    scene.frame_end = source["actions"][0]["frame_end"]

    bpy.ops.wm.save_as_mainfile(filepath=output_blend)

    report = {
        "definition_sha256": sha256_of(definition_path),
        "output_blend_sha256": sha256_of(output_blend),
        "armature": source["armature"],
        "bones": [b["name"] for b in source["bones"]],
        "actions": [a["name"] for a in source["actions"]],
    }
    print("GENERATE_SOURCE_RESULT " + json.dumps(report, sort_keys=True), flush=True)
    log("saved " + output_blend)


main()
