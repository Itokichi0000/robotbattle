"""
SATS WARS: EARTH DEFENSE — headless Blender asset generator (bpy).

Builds the three hero assets from docs/ART_PIPELINE.md as hard-surface blockouts:
  RAIJIN (heavy, amber, twin thunder drums on the back)
  FUJIN  (slim, teal, split wind ring and blade wings)
  NULL CORE (floating core, armour shard ring, separate weak-point parts)

For each asset it writes an editable source .blend, a game .glb (meshes rigidly
parented to bones, PBR materials, baked clips as NLA tracks), four preview
renders (front / side / back / three-quarter) and stats for the report.

Run with Blender 4.2+ or the `bpy` module (tested: bpy 5.2.3, Python 3.13):
  python tools/blender/generate_assets.py            # with `pip install bpy`
Outputs: assets/blender/*.blend, apps/web/public/assets/models/blender/*.glb + manifest.json,
docs/art/*.png previews and docs/art/asset_report.json.
  blender --background --python-exit-code 1 --python tools/blender/generate_assets.py
Options (after `--` when run through blender): --no-render, --out-root <repo root>

Everything is original geometry from primitives: no imported meshes, textures
or third-party assets. A human artist should still refine shapes and motion.
"""

import json
import math
import os
import sys

import bpy  # type: ignore  # provided by Blender / the bpy module
from mathutils import Matrix, Vector  # type: ignore

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
# Served by the web app; the arena uses them with /arena?models=blender (D-047).
MODEL_DIR = "apps/web/public/assets/models/blender"
FPS = 30

# ---------------------------------------------------------------------------
# Shared skeleton (Blender: Z up, -Y forward; glTF export converts to +Y up, +Z forward)
# name, parent, head, tail. The robot's left is +X.
# ---------------------------------------------------------------------------

def robot_bones(shoulder, hip, height):
    """Bone layout scaled per robot: shoulder/hip half-widths and overall height factor."""
    h = height
    return [
        ("Root", None, (0, 0, 0), (0, 0, 0.3)),
        ("Hips", "Root", (0, 0, 1.9 * h), (0, 0, 2.2 * h)),
        ("Spine", "Hips", (0, 0, 2.2 * h), (0, 0, 2.6 * h)),
        ("Chest", "Spine", (0, 0, 2.6 * h), (0, 0, 3.75 * h)),
        ("Neck", "Chest", (0, -0.05, 3.75 * h), (0, -0.05, 3.95 * h)),
        ("Head", "Neck", (0, -0.05, 3.95 * h), (0, -0.05, 4.45 * h)),
        ("UpperArm_L", "Chest", (shoulder, 0, 3.45 * h), (shoulder, 0, 2.65 * h)),
        ("Forearm_L", "UpperArm_L", (shoulder, 0, 2.65 * h), (shoulder, 0, 1.85 * h)),
        ("Hand_L", "Forearm_L", (shoulder, 0, 1.85 * h), (shoulder, 0, 1.4 * h)),
        ("UpperArm_R", "Chest", (-shoulder, 0, 3.45 * h), (-shoulder, 0, 2.65 * h)),
        ("Forearm_R", "UpperArm_R", (-shoulder, 0, 2.65 * h), (-shoulder, 0, 1.85 * h)),
        ("Hand_R", "Forearm_R", (-shoulder, 0, 1.85 * h), (-shoulder, 0, 1.4 * h)),
        ("Thigh_L", "Hips", (hip, 0, 1.85 * h), (hip, 0, 1.0 * h)),
        ("Shin_L", "Thigh_L", (hip, 0, 1.0 * h), (hip, 0, 0.25)),
        ("Foot_L", "Shin_L", (hip, 0, 0.25), (hip, -0.4, 0.05)),
        ("Thigh_R", "Hips", (-hip, 0, 1.85 * h), (-hip, 0, 1.0 * h)),
        ("Shin_R", "Thigh_R", (-hip, 0, 1.0 * h), (-hip, 0, 0.25)),
        ("Foot_R", "Shin_R", (-hip, 0, 0.25), (-hip, -0.4, 0.05)),
        ("BackUnit", "Chest", (0, 0.55, 3.3 * h), (0, 0.85, 3.3 * h)),
    ]


# Clips shared by both robots: (frames, loop, keys[(frame, bone, (rx, ry, rz) degrees)]).
# Rotations are in each bone's local space (X bends limbs forward/back).
def robot_clips(heavy):
    sway = 3 if heavy else 5
    return {
        "Idle": (60, True, [
            (1, "Chest", (sway, 0, 0)), (30, "Chest", (-sway, 0, 0)), (60, "Chest", (sway, 0, 0)),
            (1, "UpperArm_L", (0, 0, 8)), (30, "UpperArm_L", (0, 0, 11)), (60, "UpperArm_L", (0, 0, 8)),
            (1, "UpperArm_R", (0, 0, -8)), (30, "UpperArm_R", (0, 0, -11)), (60, "UpperArm_R", (0, 0, -8)),
            (1, "BackUnit", (0, 0, 0)), (60, "BackUnit", (0, 90 if heavy else 120, 0)),
        ]),
        "Intro": (66, False, [
            (1, "Hips", (0, 0, 0)), (1, "Thigh_L", (-60, 0, 0)), (1, "Thigh_R", (-60, 0, 0)),
            (1, "Shin_L", (90, 0, 0)), (1, "Shin_R", (90, 0, 0)), (1, "Chest", (25, 0, 0)),
            (24, "Thigh_L", (-60, 0, 0)), (24, "Shin_L", (90, 0, 0)), (24, "Chest", (25, 0, 0)),
            (40, "Thigh_L", (0, 0, 0)), (40, "Thigh_R", (0, 0, 0)), (40, "Shin_L", (0, 0, 0)), (40, "Shin_R", (0, 0, 0)),
            (40, "Chest", (0, 0, 0)), (40, "UpperArm_R", (0, 0, 0)),
            (58, "UpperArm_R", (-160, 0, 0)), (58, "Forearm_R", (-20, 0, 0)), (66, "UpperArm_R", (-160, 0, 0)),
        ]),
        "AttackLight": (14, False, [
            (1, "UpperArm_R", (0, 0, 0)), (1, "Forearm_R", (-40, 0, 0)), (1, "Chest", (0, 0, 0)),
            (5, "UpperArm_R", (-85, 0, 0)), (5, "Forearm_R", (0, 0, 0)), (5, "Chest", (0, -15, 0)),
            (14, "UpperArm_R", (0, 0, 0)), (14, "Forearm_R", (-40, 0, 0)), (14, "Chest", (0, 0, 0)),
        ]),
        "AttackHeavy": (20, False, [
            (1, "UpperArm_R", (0, 0, 0)), (1, "Chest", (0, 0, 0)),
            (8, "UpperArm_R", (40, 0, -20)), (8, "Forearm_R", (-60, 0, 0)), (8, "Chest", (0, 25, 0)),
            (12, "UpperArm_R", (-95, 0, 0)), (12, "Forearm_R", (0, 0, 0)), (12, "Chest", (8, -25, 0)),
            (20, "UpperArm_R", (0, 0, 0)), (20, "Forearm_R", (0, 0, 0)), (20, "Chest", (0, 0, 0)),
        ]),
        "Guard": (24, False, [
            (1, "UpperArm_L", (0, 0, 0)), (1, "UpperArm_R", (0, 0, 0)),
            (8, "UpperArm_L", (-80, 0, -25)), (8, "Forearm_L", (-70, 0, 0)),
            (8, "UpperArm_R", (-80, 0, 25)), (8, "Forearm_R", (-70, 0, 0)),
            (24, "UpperArm_L", (-80, 0, -25)), (24, "UpperArm_R", (-80, 0, 25)),
            (24, "Forearm_L", (-70, 0, 0)), (24, "Forearm_R", (-70, 0, 0)),
        ]),
        "HitReact": (12, False, [
            (1, "Chest", (0, 0, 0)), (4, "Chest", (-22, 0, 6)), (4, "Head", (-15, 0, 0)),
            (12, "Chest", (0, 0, 0)), (12, "Head", (0, 0, 0)),
        ]),
        "Special": (48, False, [
            (1, "UpperArm_L", (0, 0, 0)), (1, "UpperArm_R", (0, 0, 0)), (1, "BackUnit", (0, 0, 0)),
            (16, "UpperArm_L", (-170, 0, -10)), (16, "UpperArm_R", (-170, 0, 10)), (16, "Chest", (-12, 0, 0)),
            (30, "BackUnit", (0, 540, 0)), (30, "Chest", (-12, 0, 0)),
            (38, "UpperArm_L", (-60, 0, -20)), (38, "UpperArm_R", (-60, 0, 20)), (38, "Chest", (20, 0, 0)),
            (48, "UpperArm_L", (0, 0, 0)), (48, "UpperArm_R", (0, 0, 0)), (48, "Chest", (0, 0, 0)), (48, "BackUnit", (0, 720, 0)),
        ]),
        "Victory": (60, True, [
            (1, "UpperArm_R", (-165, 0, 0)), (30, "UpperArm_R", (-170, 0, -6)), (60, "UpperArm_R", (-165, 0, 0)),
            (1, "Chest", (-5, 0, 0)), (30, "Chest", (-8, 0, 0)), (60, "Chest", (-5, 0, 0)),
        ]),
        "Defeat": (42, False, [
            (1, "Hips", (0, 0, 0)), (1, "Chest", (0, 0, 0)),
            (34, "Chest", (35, 0, 0)), (34, "Head", (25, 0, 0)),
            (34, "Thigh_L", (-70, 0, 0)), (34, "Shin_L", (100, 0, 0)), (34, "Thigh_R", (-30, 0, 0)), (34, "Shin_R", (60, 0, 0)),
            (42, "Chest", (35, 0, 0)),
        ]),
    }


BOSS_CLIPS = {
    # Bones: Root, Core, Ring, WP_CORE, WP_ARM, WP_LEG
    # Core and Ring bones point up (+Z), so local Y spins them flat; X/Z tilt them.
    "Idle": (90, True, [(1, "Ring", (0, 0, 0)), (90, "Ring", (0, 120, 0)), (1, "Core", (0, 0, 0)), (90, "Core", (0, -60, 0))]),
    "Telegraph": (36, True, [(1, "Ring", (0, 0, 0)), (36, "Ring", (0, 240, 0)), (1, "WP_ARM", (0, 0, 0)), (18, "WP_ARM", (0, 0, 25)), (36, "WP_ARM", (0, 0, 0))]),
    "Attack": (24, False, [(1, "Core", (0, 0, 0)), (8, "Core", (-20, 0, 0)), (24, "Core", (0, 0, 0)), (1, "Ring", (0, 0, 0)), (24, "Ring", (0, 180, 0))]),
    "HitReact": (12, False, [(1, "Core", (0, 0, 0)), (4, "Core", (12, 0, 8)), (12, "Core", (0, 0, 0))]),
    "Defeat": (60, False, [(1, "Ring", (0, 0, 0)), (60, "Ring", (70, 300, 0)), (1, "Core", (0, 0, 0)), (60, "Core", (40, 0, 0))]),
}

PALETTES = {
    # Linear-ish RGB approximations of docs/ART_PIPELINE.md swatches.
    "raijin": {
        "primary": (0.84, 0.36, 0.04),   # amber armour
        "secondary": (0.48, 0.30, 0.10),  # gold
        "copper": (0.27, 0.10, 0.04),
        "dark": (0.015, 0.018, 0.022),    # black iron
        "glow": (1.0, 0.45, 0.06),
    },
    "fujin": {
        "primary": (0.012, 0.045, 0.075),  # deep navy
        "secondary": (0.66, 0.77, 0.80),   # silver white
        "copper": (0.03, 0.25, 0.75),      # accent blue
        "dark": (0.005, 0.012, 0.02),
        "glow": (0.02, 0.60, 0.68),
    },
    "null_core": {
        "primary": (0.006, 0.005, 0.009),  # ink black
        "secondary": (0.18, 0.04, 0.32),   # violet
        "copper": (0.05, 0.01, 0.03),
        "dark": (0.002, 0.002, 0.004),
        "glow": (1.0, 0.04, 0.10),         # corruption red
    },
}

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, rgb, metallic, roughness, emission=0.0):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True  # always on in Blender 5; still needed on 4.x
    except Exception:  # noqa: BLE001
        pass
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission > 0:
        bsdf.inputs["Emission Color"].default_value = (*rgb, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission
    return m


def build_armature(name, bones):
    arm_data = bpy.data.armatures.new(f"{name}_armature")
    arm_obj = bpy.data.objects.new(f"{name}_rig", arm_data)
    bpy.context.scene.collection.objects.link(arm_obj)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="EDIT")
    for bname, parent, head, tail in bones:
        b = arm_data.edit_bones.new(bname)
        b.head = head
        b.tail = tail
        if parent:
            b.parent = arm_data.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    # Pose matrices are only valid after an update; parenting below reads them.
    bpy.context.view_layer.update()
    return arm_obj


PRIMS = {
    "cube": lambda: bpy.ops.mesh.primitive_cube_add(size=2),
    "cyl": lambda: bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=1, depth=2),
    "cyl8": lambda: bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=1, depth=2),
    "sphere": lambda: bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=1),
    "ico": lambda: bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1),
    "cone": lambda: bpy.ops.mesh.primitive_cone_add(vertices=16, radius1=1, radius2=0, depth=2),
    "torus": lambda: bpy.ops.mesh.primitive_torus_add(major_radius=1, minor_radius=0.08, major_segments=40, minor_segments=8),
}


def part(arm_obj, bone, prim, loc, scale, mat, rot=(0, 0, 0), bevel=0.0, name=None):
    """A rigid armour piece parented to a bone (keeps world transform)."""
    PRIMS[prim]()
    obj = bpy.context.object
    obj.name = name or f"{bone}_{prim}"
    obj.location = loc
    obj.rotation_euler = [math.radians(r) for r in rot]
    obj.scale = scale
    obj.data.materials.append(mat)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if bevel > 0:
        mod = obj.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        mod.limit_method = "ANGLE"
    if prim in ("sphere", "cyl", "torus", "cone"):
        bpy.ops.object.shade_smooth()
    parent_to_bone(obj, arm_obj, bone)
    return obj


def parent_to_bone(obj, arm_obj, bone):
    # Bone parenting places the child relative to the bone's tail; compute the
    # inverse so the piece stays exactly where it was modelled.
    world = obj.matrix_world.copy()
    obj.parent = arm_obj
    obj.parent_type = "BONE"
    obj.parent_bone = bone
    pb = arm_obj.pose.bones[bone]
    bone_tail_world = arm_obj.matrix_world @ pb.matrix @ Matrix.Translation(Vector((0, pb.length, 0)))
    obj.matrix_parent_inverse = bone_tail_world.inverted()
    obj.matrix_world = world


def mirror(fn):
    for side, sx in (("L", 1), ("R", -1)):
        fn(side, sx)


# ---------------------------------------------------------------------------
# RAIJIN — heavy: broad shoulders, thick chest, huge fists, twin thunder drums
# ---------------------------------------------------------------------------


def build_raijin():
    p = PALETTES["raijin"]
    m = {
        "armor": material("raijin_armor", p["primary"], 0.55, 0.42),
        "gold": material("raijin_gold", p["secondary"], 0.95, 0.28),
        "copper": material("raijin_copper", p["copper"], 0.9, 0.45),
        "iron": material("raijin_iron", p["dark"], 0.8, 0.6),
        "glow": material("raijin_glow", p["glow"], 0.0, 0.4, emission=6.0),
    }
    sh, hip = 1.3, 0.48
    arm = build_armature("raijin", robot_bones(sh, hip, 1.0))
    # torso: wide inverted trapezoid built from stacked blocks ("block chain" motif)
    part(arm, "Hips", "cube", (0, 0, 2.0), (0.7, 0.45, 0.24), m["iron"], bevel=0.04)
    part(arm, "Spine", "cube", (0, 0, 2.4), (0.55, 0.38, 0.22), m["copper"], bevel=0.03)
    part(arm, "Chest", "cube", (0, 0, 3.15), (1.05, 0.62, 0.55), m["armor"], bevel=0.08)
    for i, z in enumerate((2.8, 3.05, 3.3)):
        part(arm, "Chest", "cube", (0, -0.64, z), (0.62 - i * 0.08, 0.04, 0.09), m["gold"], bevel=0.02, name=f"chest_block_{i}")
    part(arm, "Chest", "cyl", (0, -0.66, 3.55), (0.2, 0.2, 0.05), m["glow"], rot=(90, 0, 0), name="chest_core")
    part(arm, "Chest", "cube", (0, -0.69, 3.55), (0.32, 0.02, 0.32), m["iron"], rot=(0, 45, 0), bevel=0.01, name="core_frame")
    # head: boxy helmet, two gold horns, amber visor
    part(arm, "Head", "cube", (0, -0.05, 4.2), (0.32, 0.32, 0.27), m["armor"], bevel=0.05)
    part(arm, "Head", "cube", (0, -0.38, 4.22), (0.26, 0.03, 0.06), m["glow"], name="visor")
    mirror(lambda s, x: part(arm, "Head", "cone", (x * 0.22, -0.05, 4.62), (0.07, 0.07, 0.28), m["gold"], rot=(0, x * 18, 0), name=f"horn_{s}"))
    part(arm, "Neck", "cyl", (0, -0.05, 3.88), (0.18, 0.18, 0.12), m["iron"])

    def limb(side, sx):
        x = sx * sh
        part(arm, f"UpperArm_{side}", "sphere", (x, 0, 3.5), (0.62, 0.55, 0.48), m["armor"], name=f"pauldron_{side}")
        part(arm, f"UpperArm_{side}", "cube", (x, 0, 3.78), (0.5, 0.42, 0.06), m["gold"], bevel=0.02, name=f"pauldron_trim_{side}")
        part(arm, f"UpperArm_{side}", "cyl", (x, 0, 3.0), (0.26, 0.26, 0.38), m["iron"])
        part(arm, f"Forearm_{side}", "cyl8", (x, 0, 2.25), (0.4, 0.4, 0.4), m["armor"], bevel=0.03)
        part(arm, f"Forearm_{side}", "torus", (x, 0, 2.55), (0.42, 0.42, 0.6), m["gold"], name=f"bracer_{side}")
        part(arm, f"Hand_{side}", "cube", (x, -0.02, 1.6), (0.4, 0.38, 0.34), m["copper"], bevel=0.06, name=f"fist_{side}")
        lx = sx * hip
        part(arm, f"Thigh_{side}", "cyl8", (lx, 0, 1.45), (0.36, 0.36, 0.42), m["iron"], bevel=0.03)
        part(arm, f"Shin_{side}", "cube", (lx, 0, 0.62), (0.34, 0.36, 0.42), m["armor"], bevel=0.06)
        part(arm, f"Shin_{side}", "cube", (lx, -0.38, 0.75), (0.22, 0.04, 0.22), m["gold"], bevel=0.02, name=f"knee_{side}")
        part(arm, f"Foot_{side}", "cube", (lx, -0.18, 0.12), (0.4, 0.58, 0.13), m["iron"], bevel=0.04)

    mirror(limb)
    # back: two thunder-drum reactors on a gold ring
    part(arm, "BackUnit", "torus", (0, 0.75, 3.3), (1.15, 1.15, 1.6), m["gold"], rot=(90, 0, 0), name="drum_ring")
    for i in range(8):
        a = i / 8 * math.tau
        part(arm, "BackUnit", "cyl", (math.cos(a) * 1.15, 0.75, 3.3 + math.sin(a) * 1.15), (0.17, 0.17, 0.09), m["copper"], rot=(90, 0, 0), name=f"drum_{i}")
    mirror(lambda s, x: part(arm, "BackUnit", "cyl", (x * 0.45, 0.72, 3.2), (0.3, 0.3, 0.2), m["glow"], rot=(90, 0, 0), name=f"reactor_{s}"))
    return arm


# ---------------------------------------------------------------------------
# FUJIN — slim: long legs, streamlined armour, split wind ring, blade wings
# ---------------------------------------------------------------------------


def build_fujin():
    p = PALETTES["fujin"]
    m = {
        "armor": material("fujin_armor", p["primary"], 0.6, 0.35),
        "silver": material("fujin_silver", p["secondary"], 0.9, 0.22),
        "blue": material("fujin_blue", p["copper"], 0.5, 0.35),
        "dark": material("fujin_dark", p["dark"], 0.7, 0.5),
        "glow": material("fujin_glow", p["glow"], 0.0, 0.3, emission=6.0),
    }
    sh, hip = 0.95, 0.32
    arm = build_armature("fujin", robot_bones(sh, hip, 1.04))
    part(arm, "Hips", "cyl8", (0, 0, 2.0), (0.42, 0.32, 0.2), m["dark"], bevel=0.03)
    part(arm, "Spine", "cyl8", (0, 0, 2.45), (0.28, 0.24, 0.24), m["silver"])
    part(arm, "Chest", "cyl8", (0, 0, 3.25), (0.7, 0.46, 0.55), m["armor"], bevel=0.05)
    part(arm, "Chest", "cone", (0, -0.42, 3.3), (0.42, 0.18, 0.5), m["silver"], rot=(90, 0, 0), name="chest_keel")
    # node-circuit glow lines on the chest (branching paths)
    for i, (x, z, w) in enumerate(((0, 3.55, 0.36), (-0.18, 3.25, 0.2), (0.2, 3.05, 0.22))):
        part(arm, "Chest", "cube", (x, -0.62, z), (w, 0.015, 0.02), m["glow"], name=f"circuit_{i}")
    part(arm, "Head", "sphere", (0, -0.05, 4.3), (0.24, 0.3, 0.26), m["silver"])
    part(arm, "Head", "cube", (0, -0.32, 4.3), (0.2, 0.03, 0.05), m["glow"], name="visor")
    part(arm, "Head", "cone", (0, 0.25, 4.45), (0.08, 0.08, 0.38), m["blue"], rot=(-70, 0, 0), name="crest")
    part(arm, "Neck", "cyl", (0, -0.05, 4.03), (0.12, 0.12, 0.12), m["dark"])

    def limb(side, sx):
        x = sx * sh
        part(arm, f"UpperArm_{side}", "cone", (x + sx * 0.08, 0, 3.7), (0.3, 0.42, 0.32), m["silver"], rot=(0, sx * -35, 0), name=f"fin_{side}")
        part(arm, f"UpperArm_{side}", "cyl", (x, 0, 3.05), (0.17, 0.17, 0.42), m["dark"])
        part(arm, f"Forearm_{side}", "cyl8", (x, 0, 2.3), (0.22, 0.22, 0.42), m["armor"], bevel=0.02)
        part(arm, f"Forearm_{side}", "cube", (x + sx * 0.2, 0, 2.3), (0.03, 0.3, 0.5), m["silver"], bevel=0.01, name=f"blade_{side}")
        part(arm, f"Hand_{side}", "sphere", (x, 0, 1.68), (0.2, 0.2, 0.22), m["blue"])
        lx = sx * hip
        part(arm, f"Thigh_{side}", "cyl8", (lx, 0, 1.5), (0.22, 0.22, 0.45), m["armor"], bevel=0.02)
        part(arm, f"Shin_{side}", "cyl8", (lx, 0, 0.65), (0.2, 0.24, 0.45), m["silver"], bevel=0.02)
        part(arm, f"Shin_{side}", "cyl", (lx, 0.22, 0.35), (0.09, 0.09, 0.12), m["glow"], rot=(90, 0, 0), name=f"booster_{side}")
        part(arm, f"Foot_{side}", "cone", (lx, -0.2, 0.1), (0.18, 0.42, 0.1), m["dark"], rot=(90, 0, 0), name=f"foot_{side}")

    mirror(limb)
    # back: split wind ring (four arcs) + two blade wings
    for i in range(4):
        a = i / 4 * math.tau + math.pi / 4
        part(arm, "BackUnit", "cube", (math.cos(a) * 1.25, 0.7, 3.4 + math.sin(a) * 1.25), (0.5, 0.05, 0.08), m["glow"], rot=(0, -math.degrees(a) + 90, 0), name=f"wind_arc_{i}")
    part(arm, "BackUnit", "torus", (0, 0.72, 3.4), (1.25, 1.25, 1.0), m["silver"], rot=(90, 0, 0), name="wind_ring")
    mirror(lambda s, x: part(arm, "BackUnit", "cube", (x * 0.75, 0.75, 3.7), (0.7, 0.03, 0.16), m["silver"], rot=(0, x * -30, 0), bevel=0.01, name=f"wing_{s}"))
    return arm


# ---------------------------------------------------------------------------
# NULL CORE — floating core, armour shard ring, separate weak points
# ---------------------------------------------------------------------------


def build_null_core():
    p = PALETTES["null_core"]
    m = {
        "shell": material("null_shell", p["primary"], 0.7, 0.45),
        "violet": material("null_violet", p["secondary"], 0.4, 0.4, emission=0.6),
        "dark": material("null_dark", p["dark"], 0.85, 0.6),
        "glow": material("null_glow", p["glow"], 0.0, 0.3, emission=8.0),
    }
    bones = [
        ("Root", None, (0, 0, 0), (0, 0, 0.3)),
        ("Core", "Root", (0, 0, 0), (0, 0, 0.5)),
        ("Ring", "Root", (0, 0, 0), (0, 0, 0.4)),
        ("WP_CORE", "Core", (0, -0.9, 0), (0, -1.1, 0)),
        ("WP_ARM", "Ring", (1.6, 0, 0.2), (1.9, 0, 0.2)),
        ("WP_LEG", "Root", (0, 0, -1.1), (0, 0, -1.4)),
    ]
    arm = build_armature("null_core", bones)
    part(arm, "Core", "ico", (0, 0, 0), (1.0, 1.0, 1.0), m["shell"], bevel=0.03, name="core_shell")
    for i in range(6):
        a = i / 6 * math.tau
        part(arm, "Core", "cube", (math.cos(a) * 0.95, math.sin(a) * 0.95, 0), (0.18, 0.18, 0.45), m["dark"], rot=(0, 0, math.degrees(a)), bevel=0.02, name=f"core_plate_{i}")
    part(arm, "WP_CORE", "sphere", (0, -0.95, 0), (0.32, 0.18, 0.32), m["glow"], name="weak_core")
    for i in range(10):
        a = i / 10 * math.tau
        part(arm, "Ring", "cube", (math.cos(a) * 1.7, math.sin(a) * 1.7, 0), (0.28, 0.12, 0.1), m["violet"], rot=(0, 0, math.degrees(a) + 90), bevel=0.01, name=f"shard_{i}")
    part(arm, "Ring", "torus", (0, 0, 0), (1.7, 1.7, 1.2), m["dark"], name="shard_ring")
    part(arm, "WP_ARM", "cone", (1.75, 0, 0.2), (0.22, 0.22, 0.45), m["glow"], rot=(0, 90, 0), name="weak_arm")
    part(arm, "WP_LEG", "cone", (0, 0, -1.2), (0.25, 0.25, 0.4), m["glow"], rot=(180, 0, 0), name="weak_leg")
    return arm


# ---------------------------------------------------------------------------
# animation, export, previews
# ---------------------------------------------------------------------------


def add_actions(arm_obj, clips):
    arm_obj.animation_data_create()
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="POSE")
    for pb in arm_obj.pose.bones:
        pb.rotation_mode = "XYZ"
    for clip, (frames, _loop, keys) in clips.items():
        action = bpy.data.actions.new(clip)
        action.use_fake_user = True
        arm_obj.animation_data.action = action
        touched = {bone for _, bone, _ in keys}
        for pb in arm_obj.pose.bones:
            pb.rotation_euler = (0, 0, 0)
        for bone in touched:
            pb = arm_obj.pose.bones[bone]
            pb.keyframe_insert("rotation_euler", frame=1)
            pb.keyframe_insert("rotation_euler", frame=frames)
        for frame, bone, rot in keys:
            pb = arm_obj.pose.bones[bone]
            pb.rotation_euler = [math.radians(r) for r in rot]
            pb.keyframe_insert("rotation_euler", frame=frame)
        track = arm_obj.animation_data.nla_tracks.new()
        track.name = clip
        strip = track.strips.new(clip, 1, action)
        strip.name = clip
        track.mute = True
        arm_obj.animation_data.action = None
    for pb in arm_obj.pose.bones:
        pb.rotation_euler = (0, 0, 0)
    bpy.ops.object.mode_set(mode="OBJECT")


def export_glb(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    common = dict(filepath=path, export_format="GLB", export_yup=True, export_apply=True, export_animations=True)
    try:
        bpy.ops.export_scene.gltf(**common, export_animation_mode="NLA_TRACKS")
    except TypeError:
        bpy.ops.export_scene.gltf(**common, export_nla_strips=True)


def stats(arm_obj, clips):
    tris = 0
    deps = bpy.context.evaluated_depsgraph_get()
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        ev = obj.evaluated_get(deps)
        mesh = ev.to_mesh()
        mesh.calc_loop_triangles()
        tris += len(mesh.loop_triangles)
        ev.to_mesh_clear()
    return {
        "triangles": tris,
        "bones": len(arm_obj.data.bones),
        "clips": list(clips.keys()),
        "materials": sorted({ms.material.name for o in bpy.context.scene.objects if o.type == "MESH" for ms in o.material_slots if ms.material}),
    }


def render_previews(name, out_dir, radius, target_z):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 24
    scene.cycles.use_denoising = False
    scene.render.resolution_x = 360
    scene.render.resolution_y = 360
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("preview_world")
    try:
        world.use_nodes = True
    except Exception:  # noqa: BLE001
        pass
    bg = next((n for n in world.node_tree.nodes if n.type == "BACKGROUND"), None) if world.node_tree else None
    if bg:
        bg.inputs[0].default_value = (0.006, 0.01, 0.03, 1.0)  # venue navy
    world.color = (0.006, 0.01, 0.03)
    scene.world = world
    for i, (az, el) in enumerate(((0, 0.18), (90, 0.18), (180, 0.18), (35, 0.35))):
        light = bpy.data.lights.new(f"key{i}", "AREA")
        light.energy = 900
        light.size = 4
        lo = bpy.data.objects.new(f"key{i}", light)
        scene.collection.objects.link(lo)
        a = math.radians(az + 30)
        lo.location = (math.sin(a) * radius * 1.2, -math.cos(a) * radius * 1.2, target_z + radius)
        lo.rotation_euler = (Vector((0, 0, target_z)) - Vector(lo.location)).to_track_quat("-Z", "Y").to_euler()
    cam_data = bpy.data.cameras.new("preview_cam")
    cam_data.lens = 50
    cam = bpy.data.objects.new("preview_cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    paths = []
    for label, az in (("front", 0), ("side", 90), ("back", 180), ("three_quarter", 35)):
        a = math.radians(az)
        # Blender front is -Y.
        cam.location = (math.sin(a) * radius, -math.cos(a) * radius, target_z + radius * 0.22)
        cam.rotation_euler = (Vector((0, 0, target_z)) - Vector(cam.location)).to_track_quat("-Z", "Y").to_euler()
        path = os.path.join(out_dir, f"{name}_{label}.png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        paths.append(path)
    # Remove the preview rig so it is not saved into the source file.
    for o in list(scene.objects):
        if o.type in ("CAMERA", "LIGHT"):
            bpy.data.objects.remove(o)
    return paths


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    root = argv[argv.index("--out-root") + 1] if "--out-root" in argv else ROOT
    render = "--no-render" not in argv
    jobs = [
        ("raijin", build_raijin, robot_clips(True), os.path.join(root, MODEL_DIR, "raijin.glb"), 9.5, 2.4),
        ("fujin", build_fujin, robot_clips(False), os.path.join(root, MODEL_DIR, "fujin.glb"), 9.5, 2.4),
        ("null_core", build_null_core, BOSS_CLIPS, os.path.join(root, MODEL_DIR, "null_core.glb"), 7.0, 0.0),
    ]
    blend_dir = os.path.join(root, "assets/blender")
    preview_dir = os.path.join(root, "docs/art")
    os.makedirs(blend_dir, exist_ok=True)
    os.makedirs(preview_dir, exist_ok=True)
    report = {"blender": bpy.app.version_string, "assets": {}}
    # No *.blend1 backups next to the sources.
    bpy.context.preferences.filepaths.save_version = 0
    for name, build, clips, glb, radius, target_z in jobs:
        clear_scene()
        bpy.context.preferences.filepaths.save_version = 0
        bpy.context.scene.render.fps = FPS
        arm = build()
        add_actions(arm, clips)
        info = stats(arm, clips)
        if render:
            info["previews"] = [os.path.relpath(p, root) for p in render_previews(name, preview_dir, radius, target_z)]
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(blend_dir, f"{name}.blend"), compress=True)
        # Export last: baking NLA tracks leaves the scene posed, which must not
        # end up in the previews or the editable source.
        export_glb(glb)
        info["glb"] = os.path.relpath(glb, root)
        info["blend"] = f"assets/blender/{name}.blend"
        info["glbBytes"] = os.path.getsize(glb)
        report["assets"][name] = info
        print(f"[sats-wars] {name}: {info['triangles']} tris, {info['bones']} bones, {len(info['clips'])} clips -> {info['glb']}")
    with open(os.path.join(root, MODEL_DIR, "manifest.json"), "w") as f:
        json.dump({"RAIJIN": "raijin.glb", "FUJIN": "fujin.glb", "BOSS": "null_core.glb", "source": "tools/blender/generate_assets.py"}, f, indent=2)
        f.write("\n")
    with open(os.path.join(preview_dir, "asset_report.json"), "w") as f:
        json.dump(report, f, indent=2)
        f.write("\n")
    print("[sats-wars] done")


if __name__ == "__main__":
    main()
