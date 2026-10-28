"""
Shared skeleton. Bone names are the three.js joint names (docs/ART_BIBLE.md) and the
joint positions match the procedural rigs in packages/three-game/src/robots/build.ts,
so the code-driven clips in animate.ts fit these models without retuning.

Bones follow the limbs (arms/legs point down, the foot points forward, BackUnit
points backward) like a normal game rig, so IK / mirroring work for animators.
Every bone's local X axis is aligned to world +X: elbows and knees bend around X.
"""

import bpy  # type: ignore
from mathutils import Vector  # type: ignore

# name, parent, head, tail, bone collection   (Blender coords: Z up, front = -Y, left = +X)
SKELETONS = {
    "raijin": [
        ("Root", None, (0, 0, 0), (0, 0, 0.5), "Body"),
        ("Hips", "Root", (0, 0, 1.95), (0, 0, 2.25), "Body"),
        ("Spine", "Hips", (0, 0, 2.25), (0, 0, 2.65), "Body"),
        ("Chest", "Spine", (0, 0, 2.65), (0, 0, 3.85), "Body"),
        ("Neck", "Chest", (0, -0.05, 3.85), (0, -0.05, 4.0), "Body"),
        ("Head", "Neck", (0, -0.05, 4.0), (0, -0.05, 4.55), "Body"),
        ("UpperArm_L", "Chest", (1.22, 0, 3.5), (1.22, 0, 2.65), "Arm.L"),
        ("Forearm_L", "UpperArm_L", (1.22, 0, 2.65), (1.22, 0, 1.85), "Arm.L"),
        ("Hand_L", "Forearm_L", (1.22, 0, 1.85), (1.22, 0, 1.35), "Arm.L"),
        ("Thigh_L", "Hips", (0.42, 0, 1.85), (0.42, 0, 1.0), "Leg.L"),
        ("Shin_L", "Thigh_L", (0.42, 0, 1.0), (0.42, 0, 0.15), "Leg.L"),
        ("Foot_L", "Shin_L", (0.42, 0, 0.15), (0.42, -0.5, 0.08), "Leg.L"),
        ("BackUnit", "Chest", (0, 0.8, 3.4), (0, 1.1, 3.4), "BackUnit"),
    ],
    "fujin": [
        ("Root", None, (0, 0, 0), (0, 0, 0.5), "Body"),
        ("Hips", "Root", (0, 0, 2.2), (0, 0, 2.45), "Body"),
        ("Spine", "Hips", (0, 0, 2.45), (0, 0, 2.87), "Body"),
        ("Chest", "Spine", (0, 0, 2.87), (0, 0, 3.97), "Body"),
        ("Neck", "Chest", (0, -0.02, 3.97), (0, -0.02, 4.13), "Body"),
        ("Head", "Neck", (0, -0.02, 4.13), (0, -0.02, 4.6), "Body"),
        ("UpperArm_L", "Chest", (0.9, 0, 3.72), (0.9, 0, 2.82), "Arm.L"),
        ("Forearm_L", "UpperArm_L", (0.9, 0, 2.82), (0.9, 0, 2.0), "Arm.L"),
        ("Hand_L", "Forearm_L", (0.9, 0, 2.0), (0.9, 0, 1.65), "Arm.L"),
        ("Thigh_L", "Hips", (0.28, 0, 2.12), (0.28, 0, 1.12), "Leg.L"),
        ("Shin_L", "Thigh_L", (0.28, 0, 1.12), (0.28, 0, 0.12), "Leg.L"),
        ("Foot_L", "Shin_L", (0.28, 0, 0.12), (0.28, -0.45, 0.05), "Leg.L"),
        ("BackUnit", "Chest", (0, 0.55, 3.77), (0, 0.85, 3.77), "BackUnit"),
    ],
}


def _mirror(p):
    return (-p[0], p[1], p[2])


def _with_right_side(spec):
    """Append the _R mirror of every _L bone."""
    out = list(spec)
    for name, parent, head, tail, coll in spec:
        if name.endswith("_L"):
            right_parent = parent[:-2] + "_R" if parent.endswith("_L") else parent
            out.append((name[:-2] + "_R", right_parent, _mirror(head), _mirror(tail), coll.replace(".L", ".R")))
    return out


def bone_spec(key):
    return _with_right_side(SKELETONS[key])


def bone_head(key, name):
    for n, _p, head, _t, _c in bone_spec(key):
        if n == name:
            return Vector(head)
    raise KeyError(name)


def build_armature(key, name, collection):
    arm = bpy.data.armatures.new(name)
    arm.display_type = "OCTAHEDRAL"
    obj = bpy.data.objects.new(name, arm)
    collection.objects.link(obj)
    obj.show_in_front = True
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    colls = {}
    x_axis = Vector((1, 0, 0))
    for bname, parent, head, tail, coll in bone_spec(key):
        b = arm.edit_bones.new(bname)
        b.head = head
        b.tail = tail
        # Bone Z = X × bone direction  ⇒  bone local X == world +X for every bone.
        b.align_roll(x_axis.cross((b.tail - b.head).normalized()))
        if parent:
            b.parent = arm.edit_bones[parent]
            b.use_connect = (Vector(head) - arm.edit_bones[parent].tail).length < 1e-6
        b.use_deform = True
        if hasattr(arm, "collections"):
            c = colls.get(coll) or arm.collections.new(coll)
            colls[coll] = c
            c.assign(b)
    bpy.ops.object.mode_set(mode="OBJECT")
    obj.select_set(False)
    obj["sw_skeleton"] = "sats-wars/v1"
    return obj
