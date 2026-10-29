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
Options (after `--` when run through blender): --no-render, --no-motion, --out-root <repo root>
Also builds the arena (stage, spawn pads, 8 bases, skyline, camera presets) and an
effects library, renders damage-stage previews and motion contact sheets (Pillow).

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
        # --- spec D1/D2 motions (keys with a 4th item move the bone: x, up, forward) ---
        "Walk": (36, False, [
            (9, "Thigh_L", (-28, 0, 0)), (27, "Thigh_L", (18, 0, 0)),
            (9, "Thigh_R", (18, 0, 0)), (27, "Thigh_R", (-28, 0, 0)),
            (9, "Shin_L", (30, 0, 0)), (27, "Shin_R", (30, 0, 0)), (18, "Shin_L", (0, 0, 0)), (18, "Shin_R", (0, 0, 0)),
            (9, "UpperArm_L", (18, 0, 8)), (27, "UpperArm_L", (-18, 0, 8)),
            (9, "UpperArm_R", (-18, 0, -8)), (27, "UpperArm_R", (18, 0, -8)),
            (9, "Hips", (0, 0, 0), (0, 0.05, 0)), (18, "Hips", (0, 0, 0), (0, 0, 0)), (27, "Hips", (0, 0, 0), (0, 0.05, 0)),
        ]),
        "Dash": (18, False, [
            (9, "Root", (0, 0, 0), (0, 0 if heavy else 0.2, 0.9)),
            (9, "Chest", (25, 0, 0)), (9, "Head", (-15, 0, 0)),
            (9, "UpperArm_L", (40, 0, 10)), (9, "UpperArm_R", (40, 0, -10)),
            (9, "Thigh_L", (-35, 0, 0)), (9, "Shin_L", (25, 0, 0)), (9, "Thigh_R", (25, 0, 0)),
            (18, "BackUnit", (0, 180, 0)),
        ]),
        "Hover": (48, False, [
            (12, "Root", (0, 0, 0), (0, 0.3 if heavy else 1.2, 0)), (36, "Root", (0, 0, 0), (0, 0.3 if heavy else 1.25, 0)),
            (12, "Thigh_L", (-15, 0, 0)), (36, "Thigh_L", (-15, 0, 0)), (12, "Thigh_R", (-15, 0, 0)), (36, "Thigh_R", (-15, 0, 0)),
            (12, "Shin_L", (35, 0, 0)), (36, "Shin_L", (35, 0, 0)), (12, "Shin_R", (35, 0, 0)), (36, "Shin_R", (35, 0, 0)),
            (12, "UpperArm_L", (0, 0, 25)), (36, "UpperArm_L", (0, 0, 25)), (12, "UpperArm_R", (0, 0, -25)), (36, "UpperArm_R", (0, 0, -25)),
            (48, "BackUnit", (0, 540, 0)),
        ]),
        "ShieldDeploy": (27, False, [
            (9, "UpperArm_L", (-20, 0, 75)), (22, "UpperArm_L", (-20, 0, 75)),
            (9, "UpperArm_R", (-20, 0, -75)), (22, "UpperArm_R", (-20, 0, -75)),
            (9, "Forearm_L", (20, 0, 0)), (9, "Forearm_R", (20, 0, 0)),
            (9, "Chest", (-12, 0, 0)), (22, "Chest", (-12, 0, 0)),
            (27, "BackUnit", (0, 360, 0)),
        ]),
        "Charge": (36, False, [
            (20, "Hips", (0, 0, 0), (0, -0.25, 0)), (32, "Hips", (0, 0, 0), (0, -0.25, 0)),
            (20, "Thigh_L", (-25, 0, 0)), (32, "Thigh_L", (-25, 0, 0)), (20, "Thigh_R", (-25, 0, 0)), (32, "Thigh_R", (-25, 0, 0)),
            (20, "Shin_L", (45, 0, 0)), (32, "Shin_L", (45, 0, 0)), (20, "Shin_R", (45, 0, 0)), (32, "Shin_R", (45, 0, 0)),
            (20, "UpperArm_L", (-35, 0, 0)), (32, "UpperArm_L", (-35, 0, 0)), (20, "UpperArm_R", (-35, 0, 0)), (32, "UpperArm_R", (-35, 0, 0)),
            (20, "Forearm_L", (-80, 0, 0)), (32, "Forearm_L", (-80, 0, 0)), (20, "Forearm_R", (-80, 0, 0)), (32, "Forearm_R", (-80, 0, 0)),
            (36, "BackUnit", (0, 720, 0)),
        ]),
        "Boarding": (72, False, [
            (20, "Hips", (0, 0, 0), (0, -0.6, 0)), (52, "Hips", (0, 0, 0), (0, -0.6, 0)),
            (20, "Thigh_L", (-70, 0, 0)), (52, "Thigh_L", (-70, 0, 0)), (20, "Shin_L", (95, 0, 0)), (52, "Shin_L", (95, 0, 0)),
            (20, "Thigh_R", (-20, 0, 0)), (52, "Thigh_R", (-20, 0, 0)), (20, "Shin_R", (70, 0, 0)), (52, "Shin_R", (70, 0, 0)),
            (20, "Chest", (20, 0, 0)), (36, "Chest", (-15, 0, 0)), (52, "Chest", (20, 0, 0)),
            (36, "UpperArm_L", (-15, 0, 15)), (36, "UpperArm_R", (-15, 0, -15)),
        ]),
        "HitHeavy": (27, False, [
            (6, "Root", (0, 0, 0), (0, 0, -0.9)), (18, "Root", (0, 0, 0), (0, 0, -0.3)),
            (6, "Chest", (-40, 10, 8)), (6, "Head", (-25, 0, 0)),
            (8, "Thigh_R", (-30, 0, 0)), (8, "Shin_R", (50, 0, 0)),
            (6, "UpperArm_L", (25, 0, 30)), (6, "UpperArm_R", (25, 0, -30)),
        ]),
    }


# Spec names (D1/D2) for motions we already have: exported as their own clips too.
SPEC_ALIASES = {"Punch": "AttackLight", "HeavyAttack": "AttackHeavy", "HitLight": "HitReact"}


def with_aliases(clips):
    out = dict(clips)
    for alias, source in SPEC_ALIASES.items():
        out[alias] = clips[source]
    return out


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


def add_damage(arm, light, plate, chest_front_y, chest_z, half_w, pauldron):
    """Damage stages (spec D1): cracks with the inner light showing (damage1_*),
    then a lifted chest plate with light leaking out and cracked shoulders
    (damage2_*). The game shows them by hull; hidden in the clean previews."""
    made = []

    def crack(bone, x, z, y, tilt, tag):
        # three short tilted segments on the armour face (Blender front is -Y)
        for i, (dx, dz, a) in enumerate(((0, 0.1, 30), (0.05, -0.08, -25), (0.02, -0.24, 20))):
            made.append(part(arm, bone, "cube", (x + dx, y, z + dz), (0.02, 0.012, 0.11), light, rot=(0, tilt + a, 0), name=f"{tag}_{i}"))

    crack("Chest", -half_w * 0.45, chest_z + 0.15, chest_front_y, 15, "damage1_chest_a")
    crack("Chest", half_w * 0.5, chest_z - 0.1, chest_front_y, -25, "damage1_chest_b")
    made.append(part(arm, "Chest", "cube", (half_w * 0.25, chest_front_y - 0.1, chest_z + 0.35), (half_w * 0.35, 0.025, 0.14), plate, rot=(-25, 0, 7), bevel=0.01, name="damage2_plate"))
    made.append(part(arm, "Chest", "cube", (half_w * 0.25, chest_front_y - 0.01, chest_z + 0.27), (half_w * 0.33, 0.01, 0.04), light, name="damage2_leak"))
    crack("Chest", 0, chest_z - 0.3, chest_front_y, 5, "damage2_chest_c")
    px, pz, py = pauldron
    crack("UpperArm_L", px, pz, py, 20, "damage2_arm_L")
    crack("UpperArm_R", -px, pz, py, -20, "damage2_arm_R")
    for o in made:
        o.hide_render = True
    return made


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
    add_damage(arm, material("raijin_damage_light", (1.0, 0.62, 0.2), 0.0, 0.4, emission=7.0), m["iron"], -0.635, 3.15, 1.05, (sh, 3.55, -0.6))
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
    add_damage(arm, material("fujin_damage_light", (0.35, 0.92, 0.95), 0.0, 0.4, emission=7.0), m["dark"], -0.47, 3.25, 0.7, (sh + 0.1, 3.55, -0.3))
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
        touched = {k[1] for k in keys}
        moved = {k[1] for k in keys if len(k) > 3}
        for pb in arm_obj.pose.bones:
            pb.rotation_euler = (0, 0, 0)
            pb.location = (0, 0, 0)
        # Every touched channel starts and ends at rest (one-shot clips return home).
        for bone in touched:
            pb = arm_obj.pose.bones[bone]
            pb.keyframe_insert("rotation_euler", frame=1)
            pb.keyframe_insert("rotation_euler", frame=frames)
        for bone in moved:
            pb = arm_obj.pose.bones[bone]
            pb.keyframe_insert("location", frame=1)
            pb.keyframe_insert("location", frame=frames)
        for key in keys:
            frame, bone, rot = key[0], key[1], key[2]
            pb = arm_obj.pose.bones[bone]
            pb.rotation_euler = [math.radians(r) for r in rot]
            pb.keyframe_insert("rotation_euler", frame=frame)
            if len(key) > 3:
                # Bone space of an upright bone: x = right, y = up, z = forward (model front).
                pb.location = key[3]
                pb.keyframe_insert("location", frame=frame)
                pb.location = (0, 0, 0)
        track = arm_obj.animation_data.nla_tracks.new()
        track.name = clip
        strip = track.strips.new(clip, 1, action)
        strip.name = clip
        track.mute = True
        arm_obj.animation_data.action = None
    for pb in arm_obj.pose.bones:
        pb.rotation_euler = (0, 0, 0)
        pb.location = (0, 0, 0)
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


def render_previews(name, out_dir, radius, target_z, views=None):
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
        if views and label not in views:
            continue
        a = math.radians(az)
        # Blender front is -Y.
        cam.location = (math.sin(a) * radius, -math.cos(a) * radius, target_z + radius * 0.22)
        cam.rotation_euler = (Vector((0, 0, target_z)) - Vector(cam.location)).to_track_quat("-Z", "Y").to_euler()
        path = os.path.join(out_dir, f"{name}_{label}.png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        paths.append(path)
    # Remove the preview rig so it is not saved into the source file (the arena's
    # preset cameras stay).
    for o in list(scene.objects):
        if o.name == "preview_cam" or o.name.startswith("key"):
            bpy.data.objects.remove(o)
    return paths


# ---------------------------------------------------------------------------
# ARENA and EFFECTS (static assets; three.js keeps its own lights and particles)
# ---------------------------------------------------------------------------

# Camera presets of the venue screen (packages/three-game/src/layout.ts, three.js
# coordinates). three (x, y, z) -> Blender (x, -z, y).
CAMERA_PRESETS = {
    "intro": ((0, 13, 27), (0, 5, -4)),
    "overview": ((0, 6.5, 19), (0, 5.2, -4.5)),
    "boss": ((0, 11, 4), (0, 14.5, -17)),
    "mapFocus": ((0, 11.5, 6.5), (0, 6.2, -8.5)),
    "special": ((0, 3.2, 10), (0, 6, -10)),
    "final": ((0, 4.0, 13), (0, 3.0, 0)),
    "cityDefense": ((6.5, 8.5, 2.5), (0, 6.2, -8.5)),
    "gunnerImpact": ((-8.5, 4.2, 6), (2, 9, -12)),
    "routerPulse": ((0, 3.2, 8.5), (0, 1.2, 2.4)),
    "repairRecovery": ((0, 3.6, 9.5), (0, 2.8, 0.6)),
    "specialCharge": ((0, 2.6, 7.5), (0, 3.4, 0.6)),
}


def to_blender(v):
    x, y, z = v
    return (x, -z, y)


def plain(name, prim, loc, scale, mat, rot=(0, 0, 0), bevel=0.0):
    PRIMS[prim]()
    obj = bpy.context.object
    obj.name = name
    obj.location = loc
    obj.rotation_euler = [math.radians(r) for r in rot]
    obj.scale = scale
    obj.data.materials.append(mat)
    if bevel > 0:
        mod = obj.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
    if prim in ("sphere", "cyl", "torus", "cone"):
        bpy.ops.object.shade_smooth()
    return obj


def ring(name, loc, major, minor, mat, rot=(0, 0, 0)):
    """A torus with real radii (scaling the unit torus would fatten the tube)."""
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=64, minor_segments=8)
    obj = bpy.context.object
    obj.name = name
    obj.location = loc
    obj.rotation_euler = [math.radians(r) for r in rot]
    obj.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    return obj


def build_arena():
    """Round stage, robot spawn pads, the map pedestal, 8 defence-base pylons,
    spotlight rigs, an abstract city skyline and the camera presets."""
    m = {
        "floor": material("arena_floor", (0.008, 0.014, 0.03), 0.4, 0.6),
        "inner": material("arena_inner", (0.015, 0.03, 0.06), 0.5, 0.5),
        "amber": material("arena_amber", (1.0, 0.45, 0.05), 0.0, 0.4, emission=0.9),
        "teal": material("arena_teal", (0.05, 0.6, 0.7), 0.0, 0.4, emission=0.9),
        "steel": material("arena_steel", (0.05, 0.06, 0.08), 0.8, 0.4),
        "city": material("arena_city", (0.004, 0.008, 0.016), 0.2, 0.8),
        "window": material("arena_window", (0.3, 0.55, 1.0), 0.0, 0.5, emission=0.6),
        "beam": material("arena_beam", (0.75, 0.85, 1.0), 0.0, 0.5, emission=1.2),
        "red": material("arena_warning", (1.0, 0.1, 0.18), 0.0, 0.4, emission=0.9),
    }
    plain("stage", "cyl", (0, 0, -0.2), (14, 14, 0.2), m["floor"])
    plain("stage_inner", "cyl", (0, 0, 0.01), (6.2, 6.2, 0.01), m["inner"])
    ring("stage_rim_amber", (0, 0, 0.02), 14, 0.08, m["amber"])
    ring("stage_rim_teal", (0, 0, 0.02), 13.2, 0.05, m["teal"])
    for team, x, mat in (("RAIJIN", -4.6, m["amber"]), ("FUJIN", 4.6, m["teal"])):
        plain(f"spawn_{team}", "cyl", (x, -0.6, 0.05), (1.6, 1.6, 0.05), m["steel"])
        ring(f"spawn_{team}_ring", (x, -0.6, 0.1), 1.6, 0.05, mat)
    plain("map_pedestal", "cyl8", (0, 8.5, 2.6), (0.5, 0.5, 2.6), m["steel"], bevel=0.02)
    ring("map_frame", (0, 8.5, 6.4), 7.5, 0.06, m["teal"], rot=(55, 0, 0))
    regions = ["hokkaido", "tohoku", "kanto", "chubu", "kinki", "chugoku", "shikoku", "kyushu"]
    for i, rid in enumerate(regions):
        a = math.radians(200 + i * (140 / 7))
        x, y = math.cos(a) * 11.5, -math.sin(a) * 11.5
        plain(f"base_{rid}", "cyl8", (x, y, 0.9), (0.45, 0.45, 0.9), m["steel"], bevel=0.02)
        plain(f"base_{rid}_cap", "cyl8", (x, y, 1.9), (0.5, 0.5, 0.1), m["teal"])
        ring(f"base_{rid}_warning", (x, y, 2.3), 0.6, 0.04, m["red"])
    for i, a in enumerate((25, 155, 205, 335)):
        r = math.radians(a)
        x, y = math.cos(r) * 15.5, math.sin(r) * 15.5
        plain(f"spot_pole_{i}", "cyl8", (x, y, 4), (0.12, 0.12, 4), m["steel"])
        # Lamp head aimed at the stage centre (the light cone itself is drawn by three.js).
        aim = (Vector((0, 0, 0)) - Vector((x, y, 8))).to_track_quat("Z", "Y").to_euler()
        head = plain(f"spot_head_{i}", "cyl", (x, y, 8), (0.45, 0.45, 0.35), m["steel"])
        head.rotation_euler = aim
        lens = plain(f"spot_lens_{i}", "cyl", (x, y, 8), (0.38, 0.38, 0.02), m["beam"])
        lens.rotation_euler = aim
        lens.location = Vector((x, y, 8)) + (Vector((0, 0, 0)) - Vector((x, y, 8))).normalized() * 0.36
    # Abstract skyline behind the boss (an original silhouette, no real buildings).
    for i in range(44):
        a = math.radians(40 + i * (100 / 43))
        r = 34 + (i * 7 % 5)
        h = 3 + (i * 37 % 11) + (6 if i % 9 == 0 else 0)
        x, y = math.cos(a) * r, math.sin(a) * r
        plain(f"skyline_{i}", "cube", (x, y, h / 2), (0.9 + (i % 3) * 0.4, 0.9, h / 2), m["city"])
        if i % 2 == 0:
            plain(f"skyline_{i}_lights", "cube", (x, y - 0.95, h * 0.6), (0.5, 0.02, h * 0.25), m["window"])
    # Seigaiha-like wave arcs (original geometric motif) on the horizon.
    for i in range(7):
        ring(f"wave_arc_{i}", ((i - 3) * 6.5, 30, 0), 3.2, 0.08, m["teal"], rot=(90, 0, 0))
    for name, (pos, target) in CAMERA_PRESETS.items():
        data = bpy.data.cameras.new(f"cam_{name}")
        data.lens_unit = "FOV"
        data.angle_y = math.radians(42)
        data.sensor_fit = "VERTICAL"
        cam = bpy.data.objects.new(f"cam_{name}", data)
        bpy.context.scene.collection.objects.link(cam)
        cam.location = to_blender(pos)
        cam.rotation_euler = (Vector(to_blender(target)) - Vector(cam.location)).to_track_quat("-Z", "Y").to_euler()


def build_effects():
    """Effect meshes for artists and future use (the game draws its effects in
    code): shield dome, thunder bolt, wind ribbon, warning ring, NULL beam."""
    teal = material("fx_shield", (0.1, 0.75, 0.85), 0.0, 0.2, emission=2.0)
    amber = material("fx_thunder", (1.0, 0.55, 0.08), 0.0, 0.3, emission=8.0)
    wind = material("fx_wind", (0.55, 0.95, 1.0), 0.0, 0.3, emission=3.0)
    red = material("fx_warning", (1.0, 0.1, 0.18), 0.0, 0.3, emission=6.0)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=1.5, location=(-6, 0, 0))
    dome = bpy.context.object
    dome.name = "fx_shield_dome"
    dome.data.materials.append(teal)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")
    for v in dome.data.vertices:
        v.select = v.co.z < -0.01
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.delete(type="VERT")
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.shade_smooth()
    pts = [(0, 0, 3.0), (0.4, 0, 2.2), (-0.2, 0, 1.7), (0.5, 0, 0.8), (0.0, 0, 0.0)]
    for i in range(len(pts) - 1):
        a, b = Vector(pts[i]), Vector(pts[i + 1])
        mid = (a + b) / 2
        seg = plain(f"fx_lightning_{i}", "cube", (mid.x - 2.5, mid.y, mid.z), (0.07, 0.07, (b - a).length / 2), amber)
        seg.rotation_euler = (b - a).to_track_quat("Z", "Y").to_euler()
    ring("fx_wind_ribbon", (1.5, 0, 1.2), 1.2, 0.05, wind, rot=(70, 0, 30))
    ring("fx_warning_ring", (4.5, 0, 0.1), 1.0, 0.06, red)
    for i in range(3):
        plain(f"fx_warning_chevron_{i}", "cone", (4.5, 0, 0.8 + i * 0.45), (0.25, 0.25, 0.18), red, rot=(180, 0, 0))
    plain("fx_null_beam", "cyl", (7.5, 0, 1.5), (0.25, 0.25, 1.5), red)


def render_motion(name, arm, clips, names, out_dir, radius, target_z, frames_per_clip=6):
    """Motion contact sheet: rows = clips, columns = evenly spaced frames (and a
    GIF of the charge-up). Needs Pillow; skipped quietly without it."""
    try:
        from PIL import Image  # type: ignore
    except ImportError:
        print("[sats-wars] Pillow not installed: no motion sheets")
        return []
    scene = bpy.context.scene
    scene.render.resolution_x = 220
    scene.render.resolution_y = 220
    scene.cycles.samples = 10
    tmp_dir = os.path.join(out_dir, "_frames")
    os.makedirs(tmp_dir, exist_ok=True)
    light = bpy.data.lights.new("motion_key", "AREA")
    light.energy = 1400
    light.size = 5
    lo = bpy.data.objects.new("motion_key", light)
    scene.collection.objects.link(lo)
    lo.location = (radius * 0.6, -radius, target_z + radius)
    lo.rotation_euler = (Vector((0, 0, target_z)) - Vector(lo.location)).to_track_quat("-Z", "Y").to_euler()
    cam_data = bpy.data.cameras.new("motion_cam")
    cam = bpy.data.objects.new("motion_cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    a = math.radians(30)
    cam.location = (math.sin(a) * radius, -math.cos(a) * radius, target_z + radius * 0.2)
    cam.rotation_euler = (Vector((0, 0, target_z)) - Vector(cam.location)).to_track_quat("-Z", "Y").to_euler()
    for track in arm.animation_data.nla_tracks:
        track.mute = True
    sheet = Image.new("RGB", (220 * frames_per_clip, 220 * len(names)), (2, 4, 10))
    gif = []
    for row, clip in enumerate(names):
        frames = clips[clip][0]
        arm.animation_data.action = bpy.data.actions[clip]
        for col in range(frames_per_clip):
            f = 1 + round((frames - 1) * col / (frames_per_clip - 1))
            scene.frame_set(f)
            path = os.path.join(tmp_dir, f"{name}_{clip}_{col}.png")
            scene.render.filepath = path
            bpy.ops.render.render(write_still=True)
            img = Image.open(path).convert("RGB")
            sheet.paste(img, (col * 220, row * 220))
            if clip == "Charge":
                gif.append(img.copy())
    arm.animation_data.action = None
    scene.frame_set(1)
    for o in (lo, cam):
        bpy.data.objects.remove(o)
    out = os.path.join(out_dir, f"{name}_motion.png")
    sheet.save(out)
    paths = [out]
    if gif:
        g = os.path.join(out_dir, f"{name}_charge.gif")
        gif[0].save(g, save_all=True, append_images=gif[1:] + gif[-2:0:-1], duration=120, loop=0)
        paths.append(g)
    for f in os.listdir(tmp_dir):
        os.remove(os.path.join(tmp_dir, f))
    os.rmdir(tmp_dir)
    return paths


def render_damage(name, out_dir, radius, target_z):
    """One front render with damage stage 2 parts shown (cracks, lifted plate)."""
    scene = bpy.context.scene
    hidden = [o for o in scene.objects if o.name.startswith("damage")]
    for o in hidden:
        o.hide_render = False
    cam_data = bpy.data.cameras.new("damage_cam")
    cam = bpy.data.objects.new("damage_cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.location = (0, -radius * 0.75, target_z + 1.2)
    cam.rotation_euler = (Vector((0, 0, target_z + 0.8)) - Vector(cam.location)).to_track_quat("-Z", "Y").to_euler()
    light = bpy.data.lights.new("damage_key", "AREA")
    light.energy = 900
    light.size = 4
    lo = bpy.data.objects.new("damage_key", light)
    scene.collection.objects.link(lo)
    lo.location = (3, -6, 7)
    lo.rotation_euler = (Vector((0, 0, target_z)) - Vector(lo.location)).to_track_quat("-Z", "Y").to_euler()
    scene.render.resolution_x = 360
    scene.render.resolution_y = 360
    scene.cycles.samples = 24
    path = os.path.join(out_dir, f"{name}_damaged.png")
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for o in hidden:
        o.hide_render = True
    for o in (cam, lo):
        bpy.data.objects.remove(o)
    return path


def static_job(name, build, root, render, preview_dir, blend_dir, radius, target_z):
    clear_scene()
    bpy.context.preferences.filepaths.save_version = 0
    build()
    tris = 0
    deps = bpy.context.evaluated_depsgraph_get()
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            ev = obj.evaluated_get(deps)
            mesh = ev.to_mesh()
            mesh.calc_loop_triangles()
            tris += len(mesh.loop_triangles)
            ev.to_mesh_clear()
    info = {"triangles": tris, "objects": len(bpy.context.scene.objects)}
    if render:
        info["previews"] = [os.path.relpath(p, root) for p in render_previews(name, preview_dir, radius, target_z, views=("three_quarter",))]
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(blend_dir, f"{name}.blend"), compress=True)
    glb = os.path.join(root, MODEL_DIR, f"{name}.glb")
    os.makedirs(os.path.dirname(glb), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", export_yup=True, export_apply=True, export_cameras=name == "arena")
    info["glb"] = os.path.relpath(glb, root)
    info["blend"] = f"assets/blender/{name}.blend"
    info["glbBytes"] = os.path.getsize(glb)
    print(f"[sats-wars] {name}: {tris} tris -> {info['glb']}")
    return info


MOTION_CLIPS = {
    "raijin": ["Walk", "Dash", "Punch", "Charge", "Boarding", "HitHeavy"],
    "fujin": ["Walk", "Hover", "ShieldDeploy", "Charge", "Boarding", "HitHeavy"],
}


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    root = argv[argv.index("--out-root") + 1] if "--out-root" in argv else ROOT
    render = "--no-render" not in argv
    jobs = [
        ("raijin", build_raijin, with_aliases(robot_clips(True)), os.path.join(root, MODEL_DIR, "raijin.glb"), 9.5, 2.4),
        ("fujin", build_fujin, with_aliases(robot_clips(False)), os.path.join(root, MODEL_DIR, "fujin.glb"), 9.5, 2.4),
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
            if name in MOTION_CLIPS:
                info["damagePreview"] = os.path.relpath(render_damage(name, preview_dir, radius, target_z), root)
                if "--no-motion" not in argv:
                    motion_dir = os.path.join(preview_dir, "motion")
                    os.makedirs(motion_dir, exist_ok=True)
                    info["motion"] = [os.path.relpath(p, root) for p in render_motion(name, arm, clips, MOTION_CLIPS[name], motion_dir, radius, target_z)]
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(blend_dir, f"{name}.blend"), compress=True)
        # Export last: baking NLA tracks leaves the scene posed, which must not
        # end up in the previews or the editable source.
        export_glb(glb)
        info["glb"] = os.path.relpath(glb, root)
        info["blend"] = f"assets/blender/{name}.blend"
        info["glbBytes"] = os.path.getsize(glb)
        report["assets"][name] = info
        print(f"[sats-wars] {name}: {info['triangles']} tris, {info['bones']} bones, {len(info['clips'])} clips -> {info['glb']}")
    report["assets"]["arena"] = static_job("arena", build_arena, root, render, preview_dir, blend_dir, 40.0, 2.0)
    report["assets"]["effects"] = static_job("effects", build_effects, root, render, preview_dir, blend_dir, 19.0, 1.0)
    with open(os.path.join(root, MODEL_DIR, "manifest.json"), "w") as f:
        json.dump({"RAIJIN": "raijin.glb", "FUJIN": "fujin.glb", "BOSS": "null_core.glb", "ARENA": "arena.glb", "EFFECTS": "effects.glb", "source": "tools/blender/generate_assets.py"}, f, indent=2)
        f.write("\n")
    with open(os.path.join(preview_dir, "asset_report.json"), "w") as f:
        json.dump(report, f, indent=2)
        f.write("\n")
    print("[sats-wars] done")


if __name__ == "__main__":
    main()
