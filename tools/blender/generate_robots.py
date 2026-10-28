"""
SATS WARS — procedural RAIJIN / FUJIN generator for Blender (bpy).

STATUS: NOT EXECUTED. Blender is not installed in the development container,
so this script has only been syntax-checked. Treat the output as a blockout
for a human 3D artist (see docs/ART_BIBLE.md). Tested API target: Blender 4.x.

Usage:
  blender --background --python tools/blender/generate_robots.py -- --out apps/web/public/assets/robots
Then validate:
  node tools/blender/inspect_glb.mjs apps/web/public/assets/robots/raijin.glb

What it builds (mirrors packages/three-game/src/robots/build.ts):
  * an armature with the shared bone names (Root, Hips, Spine, Chest, Neck, Head,
    UpperArm_L/R, Forearm_L/R, Hand_L/R, Thigh_L/R, Shin_L/R, Foot_L/R) + BackUnit
  * primitive meshes parented to bones (rigid skinning, like the three.js stand-in)
  * PBR materials (glTF-compatible Principled BSDF + emission)
  * the 9 shared actions as keyframes, pushed to NLA tracks so the glTF exporter
    writes one animation per action
"""

import math
import os
import sys

import bpy  # type: ignore  # provided by Blender

BONES = [
    # name, parent, head(x, y, z), tail(x, y, z)   (Blender: Z up, -Y forward)
    ("Root", None, (0, 0, 0), (0, 0, 0.3)),
    ("Hips", "Root", (0, 0, 1.95), (0, 0, 2.25)),
    ("Spine", "Hips", (0, 0, 2.25), (0, 0, 2.65)),
    ("Chest", "Spine", (0, 0, 2.65), (0, 0, 3.85)),
    ("Neck", "Chest", (0, -0.05, 3.85), (0, -0.05, 4.0)),
    ("Head", "Neck", (0, -0.05, 4.0), (0, -0.05, 4.5)),
    ("UpperArm_L", "Chest", (1.22, 0, 3.5), (1.22, 0, 2.65)),
    ("Forearm_L", "UpperArm_L", (1.22, 0, 2.65), (1.22, 0, 1.85)),
    ("Hand_L", "Forearm_L", (1.22, 0, 1.85), (1.22, 0, 1.35)),
    ("UpperArm_R", "Chest", (-1.22, 0, 3.5), (-1.22, 0, 2.65)),
    ("Forearm_R", "UpperArm_R", (-1.22, 0, 2.65), (-1.22, 0, 1.85)),
    ("Hand_R", "Forearm_R", (-1.22, 0, 1.85), (-1.22, 0, 1.35)),
    ("Thigh_L", "Hips", (0.42, 0, 1.85), (0.42, 0, 1.0)),
    ("Shin_L", "Thigh_L", (0.42, 0, 1.0), (0.42, 0, 0.25)),
    ("Foot_L", "Shin_L", (0.42, 0, 0.25), (0.42, -0.4, 0.05)),
    ("Thigh_R", "Hips", (-0.42, 0, 1.85), (-0.42, 0, 1.0)),
    ("Shin_R", "Thigh_R", (-0.42, 0, 1.0), (-0.42, 0, 0.25)),
    ("Foot_R", "Shin_R", (-0.42, 0, 0.25), (-0.42, -0.4, 0.05)),
    ("BackUnit", "Chest", (0, 0.8, 3.4), (0, 1.0, 3.4)),
]

CLIPS = {
    # name: (frames, keyframes [(frame, bone, (rx, ry, rz) degrees)])
    "Idle": (60, [(1, "Chest", (2, 0, 0)), (30, "Chest", (-2, 0, 0)), (60, "Chest", (2, 0, 0))]),
    "Intro": (66, [(1, "Root", (0, 0, 0)), (30, "Hips", (0, 0, 0)), (66, "UpperArm_R", (-150, 0, 0))]),
    "AttackLight": (30, [(1, "UpperArm_R", (0, 0, 0)), (8, "UpperArm_R", (-85, 0, 0)), (14, "UpperArm_L", (-85, 0, 0)), (30, "UpperArm_R", (0, 0, 0))]),
    "AttackHeavy": (33, [(1, "UpperArm_R", (0, 0, 0)), (14, "UpperArm_R", (50, 0, 0)), (18, "UpperArm_R", (-90, 0, 0)), (33, "UpperArm_R", (0, 0, 0))]),
    "Guard": (24, [(1, "UpperArm_L", (0, 0, 0)), (10, "UpperArm_L", (-70, 0, -15)), (10, "UpperArm_R", (-70, 0, 15))]),
    "HitReact": (21, [(1, "Chest", (0, 0, 0)), (5, "Chest", (-25, 0, 0)), (21, "Chest", (0, 0, 0))]),
    "Special": (90, [(1, "UpperArm_L", (0, 0, 0)), (30, "UpperArm_L", (-160, 0, 0)), (30, "UpperArm_R", (-160, 0, 0)), (60, "UpperArm_L", (-60, 0, 0)), (90, "UpperArm_L", (0, 0, 0))]),
    "Victory": (60, [(1, "UpperArm_R", (0, 0, 0)), (18, "UpperArm_R", (-165, 0, 0)), (60, "UpperArm_R", (-165, 0, 0))]),
    "Defeat": (42, [(1, "Hips", (0, 0, 0)), (34, "Chest", (30, 0, 0)), (34, "Thigh_L", (-65, 0, 0)), (34, "Thigh_R", (-65, 0, 0))]),
}

PALETTES = {
    "raijin": {"primary": (0.91, 0.52, 0.10), "secondary": (0.79, 0.63, 0.25), "dark": (0.16, 0.15, 0.13), "glow": (1.0, 0.71, 0.28)},
    "fujin": {"primary": (0.12, 0.23, 0.37), "secondary": (0.73, 0.78, 0.84), "dark": (0.06, 0.11, 0.18), "glow": (0.15, 0.78, 0.84)},
}


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.armatures, bpy.data.actions):
        for item in list(block):
            block.remove(item)


def material(name, rgb, metallic, roughness, emission=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission > 0:
        bsdf.inputs["Emission Color"].default_value = (*rgb, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission
    return m


def build_armature(kind):
    bpy.ops.object.armature_add(enter_editmode=True, location=(0, 0, 0))
    arm_obj = bpy.context.object
    arm_obj.name = f"{kind}_rig"
    arm = arm_obj.data
    arm.edit_bones.remove(arm.edit_bones[0])
    scale = 1.0 if kind == "raijin" else 0.75  # FUJIN: narrower shoulders/hips
    for name, parent, head, tail in BONES:
        b = arm.edit_bones.new(name)
        hx = head[0] * (scale if abs(head[0]) > 0.3 else 1.0)
        tx = tail[0] * (scale if abs(tail[0]) > 0.3 else 1.0)
        b.head = (hx, head[1], head[2])
        b.tail = (tx, tail[1], tail[2])
        if parent:
            b.parent = arm.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    return arm_obj


def add_part(arm_obj, bone, primitive, location, scale, mat, rotation=(0, 0, 0)):
    ops = {
        "cube": bpy.ops.mesh.primitive_cube_add,
        "cyl": bpy.ops.mesh.primitive_cylinder_add,
        "sphere": bpy.ops.mesh.primitive_uv_sphere_add,
        "cone": bpy.ops.mesh.primitive_cone_add,
        "torus": bpy.ops.mesh.primitive_torus_add,
    }
    ops[primitive](location=location, rotation=[math.radians(r) for r in rotation])
    obj = bpy.context.object
    obj.scale = scale
    obj.data.materials.append(mat)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    # Rigid bind: parent the mesh to the bone.
    obj.parent = arm_obj
    obj.parent_type = "BONE"
    obj.parent_bone = bone
    obj.matrix_parent_inverse = (arm_obj.matrix_world @ arm_obj.pose.bones[bone].matrix).inverted()
    return obj


def build_robot(kind):
    p = PALETTES[kind]
    primary = material(f"{kind}_primary", p["primary"], 0.55, 0.38)
    secondary = material(f"{kind}_secondary", p["secondary"], 0.85, 0.3)
    dark = material(f"{kind}_dark", p["dark"], 0.7, 0.55)
    glow = material(f"{kind}_glow", p["glow"], 0.1, 0.4, emission=4.0)
    arm = build_armature(kind)
    heavy = kind == "raijin"
    w = 1.0 if heavy else 0.6
    add_part(arm, "Hips", "cube", (0, 0, 1.95), (0.68 * w, 0.42, 0.22), dark)
    add_part(arm, "Chest", "cube" if heavy else "cyl", (0, 0, 3.15), (0.98 * w, 0.58, 0.52), primary)
    add_part(arm, "Chest", "sphere", (0, -0.6, 3.2), (0.24, 0.24, 0.24), glow)
    add_part(arm, "Head", "cube" if heavy else "sphere", (0, -0.05, 4.25), (0.31, 0.3, 0.25), primary if heavy else secondary)
    add_part(arm, "Head", "cube", (0, -0.35, 4.27), (0.25, 0.03, 0.05), glow)
    for side, sx in (("L", 1), ("R", -1)):
        x = sx * 1.22 * (1.0 if heavy else 0.75)
        add_part(arm, f"UpperArm_{side}", "sphere", (x, 0, 3.5), (0.55 * w, 0.5, 0.45), secondary)
        add_part(arm, f"UpperArm_{side}", "cyl", (x, 0, 3.05), (0.28 * w, 0.28 * w, 0.4), dark)
        add_part(arm, f"Forearm_{side}", "cyl", (x, 0, 2.25), (0.36 * w, 0.36 * w, 0.38), primary)
        add_part(arm, f"Hand_{side}", "cube", (x, 0, 1.6), (0.33 * w, 0.33 * w, 0.31), secondary)
        lx = sx * 0.42 * (1.0 if heavy else 0.7)
        add_part(arm, f"Thigh_{side}", "cyl", (lx, 0, 1.42), (0.32 * w, 0.32 * w, 0.42), dark)
        add_part(arm, f"Shin_{side}", "cube" if heavy else "cyl", (lx, 0, 0.62), (0.29 * w, 0.3, 0.42), primary)
        add_part(arm, f"Foot_{side}", "cube", (lx, -0.16, 0.12), (0.34 * w, 0.5, 0.12), dark)
    if heavy:
        add_part(arm, "BackUnit", "torus", (0, 0.8, 3.4), (1.0, 1.0, 1.0), secondary, rotation=(90, 0, 0))
    else:
        add_part(arm, "BackUnit", "torus", (0, 0.6, 3.6), (1.0, 1.0, 1.0), glow, rotation=(90, 0, 0))
    return arm


def add_actions(arm_obj):
    arm_obj.animation_data_create()
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="POSE")
    for clip, (frames, keys) in CLIPS.items():
        action = bpy.data.actions.new(clip)
        arm_obj.animation_data.action = action
        for pb in arm_obj.pose.bones:
            pb.rotation_mode = "XYZ"
            pb.rotation_euler = (0, 0, 0)
            pb.keyframe_insert("rotation_euler", frame=1)
            pb.keyframe_insert("rotation_euler", frame=frames)
        for frame, bone, rot in keys:
            pb = arm_obj.pose.bones[bone]
            pb.rotation_euler = [math.radians(r) for r in rot]
            pb.keyframe_insert("rotation_euler", frame=frame)
        track = arm_obj.animation_data.nla_tracks.new()
        track.name = clip
        track.strips.new(clip, 1, action)
        arm_obj.animation_data.action = None
    bpy.ops.object.mode_set(mode="OBJECT")


def export(kind, out_dir):
    path = os.path.join(out_dir, f"{kind}.glb")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=True,
        export_animations=True,
        export_nla_strips=True,
        export_apply=True,
    )
    print(f"exported {path}")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out_dir = argv[argv.index("--out") + 1] if "--out" in argv else "apps/web/public/assets/robots"
    os.makedirs(out_dir, exist_ok=True)
    for kind in ("raijin", "fujin"):
        clear_scene()
        arm = build_robot(kind)
        add_actions(arm)
        export(kind, out_dir)


if __name__ == "__main__":
    main()
