"""
SATS WARS: EARTH DEFENSE — hero assets for the venue screen (D-073).

RAIJIN and NULL CORE rebuilt for the big screen: layered hard-surface armour
(chamfered plates, panel seams, vents, pistons, cables, original stencils) on
the same skeleton and clips as generate_assets.py, with PBR textures baked in
Cycles (base colour with chipped edges and grime; AO/roughness/metal; normal).

  python tools/blender/hero_assets.py                       # bpy module (tested: bpy 5.2.3)
  python tools/blender/hero_assets.py --only raijin --tex 1024 --no-render
  python tools/blender/hero_assets.py --stage geo           # shapes only: quick previews, no bake/export

Outputs apps/web/public/assets/models/hero/{raijin,null_core}.glb + manifest.json,
assets/blender/hero_*.blend and docs/art/hero_*.png previews.
Everything is original geometry and procedural texture made here: no imported
meshes, scans or third-party textures. The preview HDRI is optional (--hdri).
"""

import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # type: ignore  # noqa: E402
from mathutils import Vector  # type: ignore  # noqa: E402

from generate_assets import (  # noqa: E402
    FPS,
    add_actions,
    add_damage,
    build_armature,
    clear_scene,
    export_glb,
    parent_to_bone,
    robot_bones,
    robot_clips,
    with_aliases,
)
from hero_kit import Kit, spline, surface  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
HERO_DIR = "apps/web/public/assets/models/hero"


def opt(name, default=None):
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    if f"--{name}" in argv:
        i = argv.index(f"--{name}")
        return argv[i + 1] if i + 1 < len(argv) and not argv[i + 1].startswith("--") else True
    return default


# ---------------------------------------------------------------------------
# RAIJIN — heavy assault frame: amber armour over a gunmetal frame, a rail
# cannon over the right shoulder and a ring of eight thunder drums on the back.
# ---------------------------------------------------------------------------

STENCIL_FONTS = (
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
    "/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-Bold.ttf",
)


def stencil_font():
    """A bold mono face for the stencils when the system has one (Bfont otherwise)."""
    for path in STENCIL_FONTS:
        if os.path.exists(path):
            return bpy.data.fonts.load(path, check_existing=True)
    return None


def raijin_materials():
    amber = (0.80, 0.25, 0.014)
    return {
        "amber": surface("raijin_amber", amber, 0.0, 0.34, wear=1.0, wear_rgb=(0.36, 0.35, 0.34)),
        "amber_band": surface("raijin_amber_band", amber, 0.0, 0.34, wear=1.0,
                              stripes=("Y", -0.06, 0.12, (0.78, 0.8, 0.82))),
        "paint": surface("raijin_charcoal", (0.05, 0.053, 0.06), 0.0, 0.38, wear=0.7, wear_rgb=(0.3, 0.31, 0.33)),
        "metal": surface("raijin_gunmetal", (0.2, 0.21, 0.23), 1.0, 0.42, wear=0.3, wear_rgb=(0.5, 0.5, 0.52)),
        "steel": surface("raijin_steel", (0.72, 0.73, 0.75), 1.0, 0.15, grime=0.4),
        "gold": surface("raijin_gold", (0.85, 0.53, 0.17), 1.0, 0.27, wear=0.3, wear_rgb=(0.95, 0.78, 0.5), grime=0.6),
        "rubber": surface("raijin_rubber", (0.016, 0.016, 0.017), 0.0, 0.78, grime=0.5),
        "decal": surface("raijin_decal", (0.8, 0.81, 0.83), 0.0, 0.42, wear=0.8, wear_rgb=(0.80, 0.25, 0.014)),
        "skin": surface("raijin_drumskin", (0.62, 0.52, 0.38), 0.0, 0.6, grime=1.3),
        "glow": surface("raijin_glow", (1.0, 0.5, 0.1), 0.0, 0.4, emission=((1.0, 0.42, 0.06), 6.0)),
    }


# Raijin fights with the rail cannon on its shoulder, not its fists: the two
# attack clips become "aim and fire" — brace, the right arm thrust out at the
# target (the hit marker still has the hand forward, as the contract checks),
# the chest kicking back on the shot and the drum ring turning. The drum ring
# ends on a multiple of 45 degrees (eight drums), so Idle resumes seamlessly.
RAIJIN_CANNON_CLIPS = {
    "AttackHeavy": (20, False, [
        (7, "Hips", (0, 0, 0), (0, -0.1, 0)), (14, "Hips", (0, 0, 0), (0, -0.08, 0)),
        (7, "Thigh_L", (-16, 0, 0)), (7, "Shin_L", (22, 0, 0)), (7, "Thigh_R", (10, 0, 0)),
        (14, "Thigh_L", (-14, 0, 0)), (14, "Shin_L", (20, 0, 0)), (14, "Thigh_R", (8, 0, 0)),
        (7, "Chest", (2, -8, 0)), (11, "Chest", (-9, -8, 0)), (14, "Chest", (-3, -6, 0)),
        (7, "UpperArm_R", (-80, 0, -4)), (11, "UpperArm_R", (-90, 0, -4)), (14, "UpperArm_R", (-86, 0, -4)),
        (7, "Forearm_R", (-6, 0, 0)), (11, "Forearm_R", (0, 0, 0)),
        (7, "UpperArm_L", (10, 0, 10)), (14, "UpperArm_L", (8, 0, 10)),
        (11, "Head", (-4, 0, 0)),
        (11, "BackUnit", (0, 45, 0)), (20, "BackUnit", (0, 90, 0)),
    ]),
    "AttackLight": (14, False, [
        (3, "UpperArm_R", (-70, 0, -4)), (7, "UpperArm_R", (-60, 0, -4)),
        (3, "Chest", (-5, -6, 0)), (7, "Chest", (-1, -3, 0)),
        (3, "BackUnit", (0, 20, 0)), (14, "BackUnit", (0, 45, 0)),
    ]),
}


def raijin_clips():
    return with_aliases({**robot_clips(True), **RAIJIN_CANNON_CLIPS})


def mirrored(prof, sx):
    """Profile for the side sx (+1 robot left, -1 right) with a consistent winding."""
    out = [(sx * u, v) for u, v in prof]
    return out if sx > 0 else list(reversed(out))



def lame(k, bone, M, mat, sx, width, height, cords=4, thick=0.07):
    """One armour lame facing out to side sx (top edge at the frame origin), a
    gold edge along the bottom and dark lacing cords (odoshi) over the face."""
    k.block("lame", bone, mat, (0, 0, -height / 2), (thick, width, height), chamfer=0.03, cax="X", bevel=0.016)
    k.block("lame_edge", bone, M["gold"], (sx * 0.006, 0, -height + 0.012), (thick + 0.012, width + 0.01, 0.026),
            bevel=0.005)
    for j in range(cords):
        y = (j / (cords - 1) - 0.5) * width * 0.86 if cords > 1 else 0
        k.block("odoshi", bone, M["rubber"], (sx * (thick / 2 + 0.006), y, -height / 2 + 0.01), (0.014, 0.034,
                                                                                               height * 0.9),
                bevel=0.0)


def build_raijin_shapes(k, M, font=None):
    sh, hip = 1.3, 0.48

    # --- pelvis and skirts (Hips) ---------------------------------------
    k.block("pelvis", "Hips", M["paint"], (0, 0.03, 2.03), (0.86, 0.6, 0.34), bot=(0.74, 0.88), chamfer=0.08,
            cax="Y", bevel=0.016)
    k.prism("crotch", "Hips", M["amber"], [(-0.22, 0.12), (0.22, 0.12), (0.19, -0.16), (0, -0.32), (-0.19, -0.16)],
            0.14, (0, -0.36, 1.97), rot=(-10, 0, 0), seams=0.045)
    k.block("crotch_trim", "Hips", M["gold"], (0, -0.43, 2.08), (0.34, 0.05, 0.05), bevel=0.008)
    for sx in (1, -1):
        with k.frame((sx * 0.4, -0.3, 2.1), (-16, 0, sx * 8)):
            k.block("skirt_f", "Hips", M["amber"], (0, -0.03, -0.21), (0.34, 0.08, 0.44), bot=(0.86, 1),
                    chamfer=0.05, cax="Y", seams=0.04, seam_dirs=["-Y"])
            k.block("skirt_f_trim", "Hips", M["paint"], (0, -0.08, -0.4), (0.3, 0.03, 0.07), bevel=0.006)
            k.cyl("skirt_f_hinge", "Hips", M["metal"], (-0.14, 0.02, 0.0), (0.14, 0.02, 0.0), 0.045)
        with k.frame((sx * 0.66, 0.0, 2.16), (0, -sx * 17, 0)):
            # kusazuri: three overlapping lames, the lowest one amber
            for i in range(3):
                with k.frame((sx * (0.05 + 0.03 * i), 0, -0.02 - 0.17 * i), (0, -sx * 4 * i, 0)):
                    lame(k, "Hips", M, M["amber"] if i == 2 else M["paint"], sx, 0.6 + 0.04 * i, 0.19, cords=2)
            k.text("skirt_no", "Hips", M["decal"], "21", (sx * 0.135, 0, -0.27), (sx, 0, 0), (0, 0, 1), 0.13,
                   font=font)
            k.cyl("skirt_s_hinge", "Hips", M["metal"], (0, -0.2, 0.0), (0, 0.2, 0.0), 0.055)
    with k.frame((0, 0.3, 2.1), (14, 0, 0)):
        k.block("skirt_b", "Hips", M["paint"], (0, 0.03, -0.22), (0.6, 0.08, 0.44), bot=(0.8, 1), chamfer=0.06,
                cax="Y", seams=0.045)

    # --- abdomen (Spine): narrow waist, segmented ----------------------------
    k.block("abdomen", "Spine", M["metal"], (0, 0.06, 2.42), (0.56, 0.44, 0.44), chamfer=0.08, cax="Z")
    for i, z in enumerate((2.26, 2.4, 2.54)):
        k.block(f"ab_{i}", "Spine", M["paint"], (0, -0.19 - 0.012 * i, z), (0.38 + 0.06 * i, 0.13, 0.12),
                taper=(0.96, 1), chamfer=0.045, cax="Y", bevel=0.012)
    for sx in (1, -1):
        k.cyl("ab_piston_h", "Spine", M["metal"], (sx * 0.31, -0.04, 2.62), (sx * 0.3, -0.04, 2.42), 0.05)
        k.cyl("ab_piston_r", "Spine", M["steel"], (sx * 0.3, -0.04, 2.44), (sx * 0.29, -0.04, 2.2), 0.03)
        k.sweep("ab_cable", "Spine", M["rubber"], spline([(sx * 0.18, 0.26, 2.2), (sx * 0.29, 0.33, 2.4),
                                                         (sx * 0.22, 0.32, 2.62)], 10), [0.03] * 10)

    # --- chest (Chest): V-shaped torso -----------------------------------------
    k.block("torso", "Chest", M["paint"], (0, 0.1, 3.18), (1.34, 0.86, 1.04), bot=(0.58, 0.74), chamfer=0.12,
            cax="Z")
    for sx in (1, -1):
        with k.frame((sx * 0.05, -0.43, 3.36), (-8, 0, sx * 14)):
            k.prism("pec", "Chest", M["amber"], mirrored([(0.0, 0.36), (0.74, 0.42), (0.84, 0.12), (0.62, -0.22),
                                                          (0.18, -0.36), (0.0, -0.14)], sx),
                    0.22, (0, 0, 0), front=0.86, seams=0.075, bevel=0.04, seg=3)
            k.prism("pec_inner", "Chest", M["paint"], mirrored([(0.06, 0.3), (0.3, 0.32), (0.26, -0.06),
                                                                (0.06, -0.08)], sx),
                    0.04, (0, -0.125, 0), front=0.9, bevel=0.006)
        with k.frame((sx * 0.62, 0.1, 3.04), (0, -sx * 12, 0)):
            k.block("flank", "Chest", M["amber"], (sx * 0.05, 0, 0), (0.12, 0.74, 0.74), taper=(1, 0.8),
                    bot=(1, 0.9), chamfer=0.08, cax="X", bevel=0.012)
            k.vent("flank_vent", "Chest", M["metal"], M["paint"], (sx * 0.12, -0.04, -0.02), (sx, 0, 0), (0, 0, 1),
                   0.38, 0.32, slats=5, depth=0.04)
        k.bolts("Chest", M["metal"], [(sx * 0.74, y, 3.38) for y in (-0.2, 0.0, 0.2)], (sx, 0, 0.3))
    k.text("pec_mark", "Chest", M["decal"], "RJ-01", (0.44, -0.6, 3.5), (0.24, -0.97, 0.14), (0, 0.14, 1), 0.07,
           font=font)
    # lower chest shield with the reactor
    k.prism("chest_shield", "Chest", M["amber"], [(-0.44, 0.1), (0.44, 0.1), (0.26, -0.24), (-0.26, -0.24)], 0.18,
            (0, -0.42, 2.86), rot=(12, 0, 0), seams=0.06, bevel=0.03, seg=3)
    k.cyl("reactor_back", "Chest", M["gold"], (0, -0.48, 2.9), (0, -0.55, 2.9), 0.25, seg=6, bevel=0.008)
    k.cyl("reactor_house", "Chest", M["metal"], (0, -0.5, 2.9), (0, -0.6, 2.9), 0.2, seg=6, bevel=0.01)
    k.cyl("reactor_lens", "Chest", M["glow"], (0, -0.58, 2.9), (0, -0.615, 2.9), 0.145, seg=6, bevel=0.0)
    for a in (0, 60, 120):
        with k.frame((0, -0.615, 2.9), (0, a, 0)):
            k.block("reactor_bar", "Chest", M["metal"], (0, 0, 0), (0.03, 0.025, 0.29), bevel=0.0)
    # collar: guards rise beside the head
    k.block("collar", "Chest", M["metal"], (0, 0.02, 3.72), (0.8, 0.72, 0.16), chamfer=0.2, cax="Z", bevel=0.012)
    k.block("collar_front", "Chest", M["decal"], (0, -0.36, 3.66), (0.34, 0.08, 0.12), taper=(0.8, 1),
            rot=(25, 0, 0), bevel=0.01)
    for sx in (1, -1):
        with k.frame((sx * 0.38, -0.02, 3.72), (0, -sx * 22, 0)):
            k.block("collar_guard", "Chest", M["amber"], (sx * 0.03, 0, 0.17), (0.1, 0.6, 0.38), taper=(1, 0.74),
                    chamfer=0.05, cax="X", bevel=0.012)
            k.block("collar_guard_in", "Chest", M["paint"], (-sx * 0.03, 0, 0.12), (0.04, 0.5, 0.26),
                    taper=(1, 0.8), bevel=0.006)
    # backpack, tanks and thrusters
    k.block("backpack", "Chest", M["paint"], (0, 0.62, 3.24), (1.08, 0.38, 1.0), bot=(0.9, 1), chamfer=0.11,
            cax="Y", seams=0.06, seam_dirs=["+Y"])
    for sx in (1, -1):
        k.cyl("tank", "Chest", M["metal"], (sx * 0.6, 0.64, 2.88), (sx * 0.6, 0.64, 3.58), 0.13, seg=20)
        for z in (2.98, 3.44):
            k.cyl("tank_band", "Chest", M["gold"], (sx * 0.6, 0.64, z), (sx * 0.6, 0.64, z + 0.05), 0.14, seg=20,
                  bevel=0.004)
        k.cyl("nozzle", "Chest", M["metal"], (sx * 0.28, 0.68, 2.8), (sx * 0.28, 0.74, 2.5), 0.12, r2=0.18, seg=20)
        k.cyl("nozzle_in", "Chest", M["glow"], (sx * 0.28, 0.74, 2.51), (sx * 0.28, 0.742, 2.495), 0.14, seg=20,
              bevel=0.0)
        k.sweep("pack_cable", "Chest", M["rubber"], spline([(sx * 0.42, 0.82, 3.5), (sx * 0.55, 0.86, 3.2),
                                                           (sx * 0.5, 0.84, 2.9)], 10), [0.032] * 10)

    # --- shoulder rail cannon: its own node "Cannon" on the chest ---------------
    with k.frame((-0.78, 0.04, 4.06)):
        k.block("cn_receiver", "Cannon", M["paint"], (0, 0.15, 0), (0.36, 0.82, 0.34), chamfer=0.07, cax="Y",
                seams=0.04, seam_dirs=["+X", "-X"])
        for sx in (1, -1):
            k.block("cn_side", "Cannon", M["amber"], (sx * 0.19, 0.05, 0.0), (0.04, 0.56, 0.24), chamfer=0.04,
                    cax="X", bevel=0.008)
        k.block("cn_capacitor", "Cannon", M["metal"], (0, 0.64, 0.02), (0.42, 0.3, 0.4), chamfer=0.06, cax="Y")
        for i in range(3):
            k.block("cn_cap_glow", "Cannon", M["glow"], (0, 0.795, -0.08 + i * 0.08), (0.26, 0.012, 0.025),
                    bevel=0.0)
        k.block("cn_shroud", "Cannon", M["paint"], (0, -0.55, 0.02), (0.28, 0.72, 0.24), chamfer=0.06, cax="Y")
        for sx in (1, -1):
            k.block("cn_rail", "Cannon", M["metal"], (sx * 0.075, -1.06, 0.02), (0.05, 0.92, 0.16), bevel=0.008)
        k.block("cn_channel", "Cannon", M["glow"], (0, -1.02, 0.02), (0.03, 0.84, 0.05), bevel=0.0)
        for y in (-0.76, -0.96, -1.16):
            k.cyl("cn_coil", "Cannon", M["gold"], (0, y + 0.03, 0.02), (0, y - 0.03, 0.02), 0.155, seg=16,
                  bevel=0.006)
        k.block("cn_muzzle", "Cannon", M["metal"], (0, -1.54, 0.02), (0.32, 0.13, 0.26), chamfer=0.045, cax="Y")
        k.block("cn_mount", "Cannon", M["metal"], (0.17, 0.38, -0.27), (0.14, 0.22, 0.36), bevel=0.01)
        k.cyl("cn_pivot", "Cannon", M["metal"], (0.06, 0.3, -0.13), (0.27, 0.3, -0.13), 0.09)
        k.text("cn_warn", "Cannon", M["decal"], "HIGH VOLTAGE", (-0.212, 0.1, 0.0), (-1, 0, 0), (0, 0, 1), 0.04,
               font=font)
        k.sweep("cn_cable", "Cannon", M["rubber"], spline([(0.17, 0.5, -0.1), (0.3, 0.55, -0.3), (0.36, 0.5, -0.5)],
                                                          8), [0.028] * 8)

    # --- head (Head) and neck (Neck) ---------------------------------------------
    k.cyl("neck", "Neck", M["metal"], (0, -0.05, 3.74), (0, -0.05, 3.99), 0.14, seg=14)
    for z in (3.82, 3.9):
        k.cyl("neck_ring", "Neck", M["paint"], (0, -0.05, z), (0, -0.05, z + 0.035), 0.16, seg=14, bevel=0.005)
    k.block("helmet", "Head", M["amber"], (0, -0.03, 4.25), (0.5, 0.56, 0.4), taper=(0.84, 0.86), chamfer=0.0,
            cax="Z", bevel=0.07, seg=4)
    k.block("helmet_back", "Head", M["paint"], (0, 0.2, 4.2), (0.42, 0.24, 0.36), taper=(0.8, 0.9), chamfer=0.07,
            cax="Z", bevel=0.01)
    # shikoro: neck guard lames behind the helmet
    for i in range(3):
        with k.frame((0, 0.27 + 0.03 * i, 4.16 - 0.085 * i), (20 + 8 * i, 0, 0)):
            k.block("shikoro", "Head", M["amber"] if i < 2 else M["paint"], (0, 0, 0), (0.6 + 0.09 * i, 0.05, 0.11),
                    taper=(0.94, 1), chamfer=0.05, cax="Y", bevel=0.012)
            k.block("shikoro_trim", "Head", M["gold"], (0, 0.012, -0.05), (0.58 + 0.09 * i, 0.04, 0.02), bevel=0.0)
    k.block("helmet_stripe", "Head", M["decal"], (0, -0.06, 4.452), (0.08, 0.4, 0.012), bevel=0.0)
    k.block("face", "Head", M["paint"], (0, -0.27, 4.14), (0.32, 0.07, 0.25), taper=(1.1, 1), bevel=0.01)
    k.prism("brow", "Head", M["gold"], [(-0.27, 0.05), (0, -0.02), (0.27, 0.05), (0.25, 0.12), (0, 0.06),
                                        (-0.25, 0.12)], 0.09, (0, -0.3, 4.3), rot=(-15, 0, 0), bevel=0.008)
    for sx in (1, -1):
        k.block("eye", "Head", M["glow"], (sx * 0.074, -0.309, 4.205), (0.1, 0.02, 0.028), rot=(0, -sx * 14, 0),
                bevel=0.0)
        k.prism("cheek", "Head", M["amber"], mirrored([(-0.17, 0.11), (0.13, 0.13), (0.17, -0.11), (-0.1, -0.15)],
                                                      sx), 0.07, (sx * 0.27, -0.13, 4.15), n=(sx, 0, 0), bevel=0.008)
        k.cyl("ear", "Head", M["metal"], (sx * 0.24, 0.04, 4.24), (sx * 0.32, 0.04, 4.24), 0.08, seg=16)
        k.cyl("ear_lamp", "Head", M["glow"], (sx * 0.32, 0.04, 4.24), (sx * 0.326, 0.04, 4.24), 0.034, seg=12,
              bevel=0.0)
        horn = spline([(sx * 0.21, -0.12, 4.34), (sx * 0.3, -0.1, 4.46), (sx * 0.4, -0.02, 4.66),
                       (sx * 0.46, 0.12, 4.86), (sx * 0.44, 0.27, 4.98)], 16)
        k.sweep("horn", "Head", M["gold"], horn, [0.07 * (1 - i / 15) ** 0.8 for i in range(16)], sides=8, flat=0.7)
        k.cyl("horn_base", "Head", M["metal"], (sx * 0.17, -0.12, 4.32), (sx * 0.25, -0.11, 4.37), 0.085, seg=12)
    k.block("mouth", "Head", M["metal"], (0, -0.31, 4.05), (0.2, 0.06, 0.1), taper=(0.8, 1), bevel=0.008)
    for i in range(3):
        k.block("mouth_slot", "Head", M["rubber"], (-0.05 + i * 0.05, -0.342, 4.05), (0.018, 0.01, 0.07),
                bevel=0.0)

    # --- arms ------------------------------------------------------------------
    for sx in (1, -1):
        side = "L" if sx > 0 else "R"
        ua, fa, hd = f"UpperArm_{side}", f"Forearm_{side}", f"Hand_{side}"
        x = sx * sh
        k.cyl("shoulder", ua, M["metal"], (sx * 0.82, 0, 3.45), (sx * 1.16, 0, 3.45), 0.25, seg=24)
        k.cyl("shoulder_cap", ua, M["gold"], (sx * 0.78, 0, 3.45), (sx * 0.82, 0, 3.45), 0.17, seg=24, bevel=0.006)
        # o-sode: a rounded cap over the joint and a shield of laced lames that
        # flares out over the upper arm
        with k.frame((sx * 1.36, 0, 3.68), (0, sx * 12, 0)):
            k.block("sode_cap", ua, M["amber"], (0, 0, 0), (0.8, 0.96, 0.3), taper=(0.84, 0.88), bevel=0.09, seg=4,
                    seams=0.12, seam_dirs=["+Z"])
            k.block("sode_cap_stripe", ua, M["decal"], (sx * 0.13, 0, 0.152), (0.08, 0.8, 0.012), bevel=0.0)
            k.block("sode_cap_lip", ua, M["paint"], (0, 0, -0.18), (0.76, 0.9, 0.08), chamfer=0.05, cax="Z",
                    bevel=0.015)
        k.cyl("sode_bar", ua, M["metal"], (sx * 1.72, -0.5, 3.52), (sx * 1.72, 0.5, 3.52), 0.04, seg=12)
        with k.frame((sx * 1.74, 0, 3.5)):
            for i in range(4):
                with k.frame((sx * 0.035 * i, 0, -0.165 * i), (0, -sx * (5 + 2.5 * i), 0)):
                    lame(k, ua, M, M["amber"], sx, 0.98 + 0.035 * i, 0.19, cords=4)
            k.text("sode_no", ua, M["decal"], "01" if sx > 0 else "RJ", (sx * 0.07, 0, -0.26), (sx, -0.0, 0.04),
                   (0, 0, 1), 0.17, font=font)
        k.cyl("upperarm", ua, M["metal"], (x, 0, 3.2), (x, 0, 2.72), 0.2, seg=16)
        k.block("upperarm_armor", ua, M["paint"], (sx * 1.44, 0, 2.95), (0.15, 0.46, 0.48), chamfer=0.05, cax="Z",
                bevel=0.012, seams=0.04, seam_dirs=["+X", "-X"])
        k.cyl("ua_piston_h", ua, M["metal"], (x, -0.21, 3.18), (x, -0.22, 2.98), 0.05)
        k.cyl("ua_piston_r", ua, M["steel"], (x, -0.22, 3.0), (x, -0.23, 2.74), 0.03)
        # elbow and the heavy gauntlet
        k.cyl("elbow", fa, M["metal"], (sx * 1.08, 0, 2.65), (sx * 1.52, 0, 2.65), 0.21, seg=24)
        k.prism("elbow_guard", fa, M["amber"], [(-0.2, 0.13), (0.2, 0.13), (0.15, -0.1), (0, -0.22), (-0.15, -0.1)],
                0.12, (x, 0.27, 2.6), n=(0, 1, 0), bevel=0.01)
        k.block("gauntlet", fa, M["amber"], (x, -0.02, 2.22), (0.62, 0.68, 0.78), taper=(0.82, 0.86), chamfer=0.1,
                cax="Z", seams=0.08, seam_dirs=["-Y", "+X", "-X"], bevel=0.02, seg=3)
        k.block("gauntlet_under", fa, M["paint"], (x, 0.24, 2.18), (0.5, 0.24, 0.66), taper=(0.86, 1),
                chamfer=0.06, cax="Z", bevel=0.01)
        k.block("gauntlet_glow", fa, M["glow"], (x, -0.365, 2.2), (0.05, 0.02, 0.38), bevel=0.0)
        k.prism("gauntlet_fin", fa, M["paint"], mirrored([(-0.32, 0.34), (0.3, 0.38), (0.36, -0.32), (-0.28, -0.38)],
                                                          -sx), 0.09, (sx * 1.65, -0.02, 2.2), n=(sx, 0, 0),
                bevel=0.01)
        k.bolts(fa, M["gold"], [(sx * 1.7, y, z) for y, z in ((-0.2, 2.44), (0.16, 2.44), (-0.2, 1.98),
                                                              (0.16, 1.98))], (sx, 0, 0))
        k.block("cuff", fa, M["metal"], (x, -0.02, 1.86), (0.54, 0.58, 0.12), chamfer=0.06, cax="Z", bevel=0.01)
        # fist: knuckles down at rest, so they lead the punch
        k.block("fist", hd, M["paint"], (x, -0.02, 1.62), (0.46, 0.52, 0.4), chamfer=0.06, cax="Y", bevel=0.03, seg=3)
        for i in range(4):
            y = -0.18 + i * 0.12
            k.block("knuckle", hd, M["metal"], (x, y, 1.44), (0.36, 0.1, 0.11), chamfer=0.028, cax="Y",
                    bevel=0.008)
            k.block("finger", hd, M["metal"], (sx * (sh - 0.19), y, 1.54), (0.11, 0.1, 0.2), chamfer=0.022,
                    cax="Y", bevel=0.008)
        k.block("knuckle_plate", hd, M["gold"], (sx * 1.32, -0.02, 1.38), (0.34, 0.5, 0.05), bevel=0.01)
        k.block("hand_back", hd, M["amber"], (sx * 1.52, -0.02, 1.63), (0.08, 0.44, 0.32), chamfer=0.04, cax="X",
                bevel=0.01)
        k.block("thumb", hd, M["metal"], (sx * 1.21, -0.27, 1.62), (0.13, 0.11, 0.24), bevel=0.01)

    # --- legs ----------------------------------------------------------------------
    for sx in (1, -1):
        side = "L" if sx > 0 else "R"
        th, sn, ft = f"Thigh_{side}", f"Shin_{side}", f"Foot_{side}"
        x = sx * hip
        k.cyl("hip_joint", th, M["metal"], (sx * 0.24, 0, 1.85), (sx * 0.72, 0, 1.85), 0.19, seg=24)
        k.block("thigh_frame", th, M["paint"], (x, 0.05, 1.42), (0.42, 0.46, 0.7), chamfer=0.07, cax="Z")
        k.prism("thigh_front", th, M["amber"], [(-0.22, 0.32), (0.22, 0.32), (0.24, -0.22), (0, -0.34),
                                                (-0.24, -0.22)], 0.15, (x, -0.22, 1.45), seams=0.065, bevel=0.035, seg=3)
        k.block("thigh_side", th, M["amber_band"], (sx * 0.74, 0.03, 1.48), (0.11, 0.54, 0.64), bot=(1, 0.8),
                chamfer=0.06, cax="X", seams=0.045, seam_dirs=["+X", "-X"])
        k.cyl("thigh_piston_h", th, M["metal"], (x, 0.29, 1.75), (x, 0.3, 1.45), 0.065)
        k.cyl("thigh_piston_r", th, M["steel"], (x, 0.3, 1.47), (x, 0.31, 1.12), 0.038)
        k.cyl("knee", sn, M["metal"], (sx * 0.27, 0, 1.0), (sx * 0.69, 0, 1.0), 0.2, seg=24)
        k.prism("knee_guard", sn, M["amber"], [(-0.22, 0.24), (0.22, 0.24), (0.24, -0.05), (0, -0.29),
                                               (-0.24, -0.05)], 0.17, (x, -0.29, 1.0), rot=(8, 0, 0), seams=0.06, bevel=0.035, seg=3)
        k.prism("knee_core", sn, M["gold"], [(-0.08, 0.06), (0.08, 0.06), (0, -0.08)], 0.04, (x, -0.385, 1.02),
                rot=(8, 0, 0), bevel=0.005)
        k.block("shin", sn, M["amber"], (x, 0.02, 0.6), (0.56, 0.68, 0.8), taper=(0.84, 0.86), bot=(1.06, 1.04),
                chamfer=0.1, cax="Z", seams=0.08, seam_dirs=["+X", "-X", "+Y"], bevel=0.02, seg=3)
        k.prism("shin_plate", sn, M["paint"], [(-0.2, 0.32), (0.2, 0.32), (0.25, -0.32), (-0.25, -0.32)], 0.08,
                (x, -0.345, 0.6), rot=(-4, 0, 0), bevel=0.01, seams=0.04)
        k.text("shin_mark", sn, M["decal"], "EDF", (x, -0.392, 0.74), (0, -1, -0.07), (0, -0.07, 1), 0.1, font=font)
        k.vent("calf_vent", sn, M["metal"], M["paint"], (x, 0.37, 0.64), (0, 1, 0), (0, 0, 1), 0.32, 0.38,
               slats=4)
        k.cyl("ankle", ft, M["metal"], (sx * 0.29, 0, 0.24), (sx * 0.67, 0, 0.24), 0.15, seg=20)
        k.block("foot", ft, M["paint"], (x, -0.13, 0.12), (0.56, 1.0, 0.22), taper=(0.9, 0.86), chamfer=0.11,
                cax="Z")
        k.block("toe", ft, M["amber"], (x, -0.46, 0.22), (0.5, 0.36, 0.13), taper=(0.84, 0.7), shift=(0, 0.03),
                chamfer=0.06, cax="Z", bevel=0.04, seg=3)
        k.block("toe_split", ft, M["metal"], (x, -0.55, 0.075), (0.52, 0.2, 0.1), chamfer=0.06, cax="Z",
                bevel=0.008)
        k.block("heel", ft, M["metal"], (x, 0.34, 0.12), (0.42, 0.22, 0.2), chamfer=0.05, cax="Z")
        k.block("ankle_guard", ft, M["amber"], (x, 0.0, 0.34), (0.48, 0.54, 0.15), taper=(0.8, 0.8), chamfer=0.05,
                cax="Z", bevel=0.035, seg=3)
        k.block("sole", ft, M["rubber"], (x, -0.13, 0.02), (0.58, 1.02, 0.04), chamfer=0.11, cax="Z", bevel=0.008)

    # --- the thunder-drum ring on the back (BackUnit spins about its own axis) ----
    cy, cz, rr = 0.96, 3.3, 1.0
    k.cyl("hub", "BackUnit", M["metal"], (0, 0.78, cz), (0, 1.02, cz), 0.25, seg=24)
    k.cyl("hub_glow", "BackUnit", M["glow"], (0, 1.02, cz), (0, 1.04, cz), 0.13, seg=24, bevel=0.0)
    k.ring("drum_ring", "BackUnit", M["gold"], (0, cy, cz), rr, 0.05, axis="Y", sides=6)
    k.ring("drum_ring_in", "BackUnit", M["metal"], (0, cy, cz), rr - 0.23, 0.03, axis="Y", sides=6)
    for i in range(8):
        a = i * 45
        with k.frame((0, cy, cz), (0, a, 0)):
            k.block("spoke", "BackUnit", M["metal"], (0, 0, 0.5), (0.06, 0.06, 0.6), bevel=0.008)
            k.cyl("drum", "BackUnit", M["amber"], (0, -0.11, rr), (0, 0.11, rr), 0.2, seg=24)
            for s in (-1, 1):
                k.cyl("drum_rim", "BackUnit", M["gold"], (0, s * 0.1, rr), (0, s * 0.125, rr), 0.215, seg=24,
                      bevel=0.004)
                k.cyl("drum_skin", "BackUnit", M["skin"], (0, s * 0.124, rr), (0, s * 0.128, rr), 0.17, seg=24,
                      bevel=0.0)
            for j in range(8):
                b = j / 8 * math.tau
                k.bolt("BackUnit", M["gold"], (math.cos(b) * 0.19, 0.128, rr + math.sin(b) * 0.19), (0, 1, 0),
                       r=0.016)


# ---------------------------------------------------------------------------
# previews
# ---------------------------------------------------------------------------

def preview(name, out_dir, target, radius, views, res=(900, 900), samples=48, hdri=None, mood="studio",
            ground_z=0.0):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    world = bpy.data.worlds.new("hero_world")
    scene.world = world
    nodes, links = world.node_tree.nodes, world.node_tree.links
    bg = next(n for n in nodes if n.type == "BACKGROUND")
    if hdri and os.path.exists(hdri):
        env = nodes.new("ShaderNodeTexEnvironment")
        env.image = bpy.data.images.load(hdri)
        links.new(env.outputs[0], bg.inputs[0])
        bg.inputs[1].default_value = 0.35 if mood == "studio" else 0.6
    else:
        bg.inputs[0].default_value = (0.01, 0.014, 0.03, 1)
    made = []

    def area(nm, loc, energy, color, size):
        light = bpy.data.lights.new(nm, "AREA")
        light.energy = energy
        light.color = color
        light.size = size
        o = bpy.data.objects.new(nm, light)
        scene.collection.objects.link(o)
        o.location = loc
        o.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        made.append(o)

    tx, ty, tz = target
    if mood == "studio":
        area("key", (tx - radius * 0.7, ty - radius * 0.9, tz + radius * 0.8), 2600, (1.0, 0.93, 0.85), 3)
        area("fill", (tx + radius * 1.0, ty - radius * 0.5, tz + radius * 0.2), 700, (0.75, 0.85, 1.0), 4)
        area("rim", (tx + radius * 0.4, ty + radius * 1.0, tz + radius * 0.9), 2400, (0.6, 0.8, 1.0), 2)
        area("rim2", (tx - radius * 0.8, ty + radius * 0.8, tz + radius * 0.3), 1500, (1.0, 0.7, 0.4), 2)
    else:
        area("moon", (tx - radius * 0.5, ty - radius * 0.3, tz + radius * 1.4), 1500, (0.6, 0.72, 1.0), 4)
        area("city", (tx + radius * 1.0, ty - radius * 0.9, tz - radius * 0.2), 900, (1.0, 0.55, 0.25), 5)
        area("rim", (tx + radius * 0.2, ty + radius * 1.0, tz + radius * 0.7), 3200, (0.45, 0.75, 1.0), 2)
    ground = bpy.data.meshes.new("ground")
    import bmesh  # type: ignore

    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=30)
    bm.to_mesh(ground)
    bm.free()
    g = bpy.data.objects.new("ground", ground)
    g.location.z = ground_z
    scene.collection.objects.link(g)
    gm = surface("preview_ground", (0.03, 0.035, 0.045), 0.3, 0.55, grime=0)
    ground.materials.append(gm)
    made.append(g)
    cam_data = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    made.append(cam)
    paths = []
    for label, az, el, lens in views:
        cam_data.lens = lens
        a, e = math.radians(az), math.radians(el)
        cam.location = (tx + math.sin(a) * math.cos(e) * radius, ty - math.cos(a) * math.cos(e) * radius,
                        tz + math.sin(e) * radius)
        cam.rotation_euler = (Vector(target) - Vector(cam.location)).to_track_quat("-Z", "Y").to_euler()
        path = os.path.join(out_dir, f"{name}_{label}.png")
        scene.render.filepath = path
        t0 = time.time()
        bpy.ops.render.render(write_still=True)
        print(f"  render {label}: {time.time() - t0:.0f}s", flush=True)
        paths.append(path)
    for o in made:
        bpy.data.objects.remove(o)
    return paths


def apply_and_tag(k):
    """Applies modifiers so the pieces are plain meshes for joining."""
    deps = bpy.context.evaluated_depsgraph_get()
    for ob in k.pieces + k.glow:
        if not ob.modifiers:
            continue
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(deps), preserve_all_data_layers=True, depsgraph=deps)
        old = ob.data
        ob.modifiers.clear()
        ob.data = me
        bpy.data.meshes.remove(old)


def tri_count(objs):
    t = 0
    for o in objs:
        o.data.calc_loop_triangles()
        t += len(o.data.loop_triangles)
    return t


def select_only(objs, active=None):
    for o in list(bpy.context.selected_objects):
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]


def gltf_output_group():
    """The node group the glTF exporter reads ambient occlusion from."""
    g = bpy.data.node_groups.get("glTF Material Output")
    if g is None:
        g = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        g.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    return g


def join_and_unwrap(k, name):
    """Every surface piece into one mesh (vertex group = its bone) with one UV atlas."""
    for ob in k.pieces:
        vg = ob.vertex_groups.new(name=ob["bone"])
        vg.add(range(len(ob.data.vertices)), 1.0, "REPLACE")
    select_only(k.pieces)
    bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    body.name = f"{name}_body"
    body.data.name = f"{name}_body"
    t0 = time.time()
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(rotate=True, rotate_method="ANY", scale=True, margin_method="FRACTION",
                            margin=0.0025, shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")
    print(f"  unwrap: {time.time() - t0:.1f}s", flush=True)
    return body


def bake_maps(body, name, tex, out_dir, samples):
    """Bakes base colour, ORM (AO, roughness, metallic) and a tangent-space
    normal map from the procedural surfaces, then swaps them for one textured
    PBR material the glTF exporter understands."""
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.render.bake.margin = max(4, tex // 256)
    scene.render.bake.use_clear = True
    os.makedirs(out_dir, exist_ok=True)
    imgs = {
        "base": bpy.data.images.new(f"{name}_base", tex, tex, alpha=False),
        "orm": bpy.data.images.new(f"{name}_orm", tex, tex, alpha=False),
        "normal": bpy.data.images.new(f"{name}_normal", tex, tex, alpha=False),
    }
    imgs["orm"].colorspace_settings.name = "Non-Color"
    imgs["normal"].colorspace_settings.name = "Non-Color"
    mats = [m for m in body.data.materials if m]
    taps = {}
    for m in mats:
        nt = m.node_tree
        out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
        bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        emit = nt.nodes.new("ShaderNodeEmission")
        img = nt.nodes.new("ShaderNodeTexImage")
        taps[m.name] = (nt, out, bsdf, emit, img)
    select_only([body])

    def run(kind, image, source):
        for m in mats:
            nt, out, bsdf, emit, img = taps[m.name]
            img.image = image
            nt.nodes.active = img
            if source is None:
                nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
            else:
                sock = nt.nodes[source].outputs[2 if source == "OUT_ALBEDO" else 0]
                nt.links.new(sock, emit.inputs["Color"])
                emit.inputs["Strength"].default_value = 1.0
                nt.links.new(emit.outputs[0], out.inputs["Surface"])
        t0 = time.time()
        if kind == "NORMAL":
            bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT")
        else:
            bpy.ops.object.bake(type="EMIT")
        print(f"  bake {image.name}: {time.time() - t0:.0f}s", flush=True)

    run("EMIT", imgs["base"], "OUT_ALBEDO")
    run("EMIT", imgs["orm"], "OUT_ORM")
    run("NORMAL", imgs["normal"], None)
    # JPEG keeps the GLB small; normals get the higher quality (blocking shows in highlights).
    for key, img in imgs.items():
        img.filepath_raw = os.path.join(out_dir, f"{name}_{key}.jpg")
        img.file_format = "JPEG"
        img.save(quality=95 if key == "normal" else 90)
    # the textured material the game sees
    fm = bpy.data.materials.new(f"{name}_paint")
    nt = fm.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tb = nt.nodes.new("ShaderNodeTexImage")
    tb.image = imgs["base"]
    to = nt.nodes.new("ShaderNodeTexImage")
    to.image = imgs["orm"]
    tn = nt.nodes.new("ShaderNodeTexImage")
    tn.image = imgs["normal"]
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nm = nt.nodes.new("ShaderNodeNormalMap")
    gl = nt.nodes.new("ShaderNodeGroup")
    gl.node_tree = gltf_output_group()
    nt.links.new(tb.outputs[0], bsdf.inputs["Base Color"])
    nt.links.new(to.outputs[0], sep.inputs[0])
    nt.links.new(sep.outputs[1], bsdf.inputs["Roughness"])
    nt.links.new(sep.outputs[2], bsdf.inputs["Metallic"])
    nt.links.new(sep.outputs[0], gl.inputs["Occlusion"])
    nt.links.new(tn.outputs[0], nm.inputs["Color"])
    nt.links.new(nm.outputs[0], bsdf.inputs["Normal"])
    body.data.materials.clear()
    body.data.materials.append(fm)
    for poly in body.data.polygons:
        poly.material_index = 0
    for m in mats:
        bpy.data.materials.remove(m)
    return fm


def split_by_bone(body, arm, name, rename=None, parent=None):
    """One rigid mesh per bone, parented to it (rigid parts: no skinning cost).
    A group that is not a bone (a named node such as Cannon) rides `parent[group]`."""
    rename, parent = rename or {}, parent or {}
    parts = {}
    for gname in [g.name for g in body.vertex_groups]:
        gi = body.vertex_groups[gname].index
        if not any(gi in [g.group for g in v.groups] for v in body.data.vertices):
            continue
        select_only([body])
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="DESELECT")
        body.vertex_groups.active_index = gi
        bpy.ops.object.vertex_group_select()
        bpy.ops.mesh.separate(type="SELECTED")
        bpy.ops.object.mode_set(mode="OBJECT")
        part = next(o for o in bpy.context.selected_objects if o is not body)
        part.name = rename.get(gname, f"{name}_{gname}")
        part.vertex_groups.clear()
        part.data.name = part.name
        tri = part.modifiers.new("Triangulate", "TRIANGULATE")
        if hasattr(tri, "keep_custom_normals"):
            tri.keep_custom_normals = True
        parts[gname] = part
    bpy.data.objects.remove(body)
    for gname, part in parts.items():
        select_only([part])
        bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
        parent_to_bone(part, arm, parent.get(gname, gname))
    return parts


def rig_glow(k, arm, name, rename=None, parent=None):
    """Emissive parts, joined per bone (the game drives their intensity)."""
    rename, parent = rename or {}, parent or {}
    by_bone = {}
    for ob in k.glow:
        by_bone.setdefault(ob["bone"], []).append(ob)
    for bone, obs in by_bone.items():
        select_only(obs)
        bpy.ops.object.join()
        ob = bpy.context.view_layer.objects.active
        ob.name = rename.get(bone, f"{name}_{bone}_glow")
        ob.data.name = ob.name
        bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
        parent_to_bone(ob, arm, parent.get(bone, bone))


def socket(arm, name, bone, loc):
    """An empty the game reads effect origins from (muzzle and the like)."""
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    e.location = loc
    bpy.context.view_layer.update()
    parent_to_bone(e, arm, bone)
    return e


def export_hero(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_yup=True, export_apply=True,
                              export_animations=True, export_animation_mode="NLA_TRACKS",
                              export_image_format="AUTO", export_tangents=True, export_cameras=False,
                              export_lights=False)


# ---------------------------------------------------------------------------
# NULL CORE — the corruption: obsidian scales over a burning core, a reptile
# eye, a crown of crystals, a stinger below and a broken blade ring with a claw.
# ---------------------------------------------------------------------------

# Bones as in generate_assets.build_null_core (the game and tests know them).
NULL_BONES = [
    ("Root", None, (0, 0, 0), (0, 0, 0.3)),
    ("Core", "Root", (0, 0, 0), (0, 0, 0.5)),
    ("Ring", "Root", (0, 0, 0), (0, 0, 0.4)),
    ("WP_CORE", "Core", (0, -0.9, 0), (0, -1.1, 0)),
    ("WP_ARM", "Ring", (1.6, 0, 0.2), (1.9, 0, 0.2)),
    ("WP_LEG", "Root", (0, 0, -1.1), (0, 0, -1.4)),
]

# Loops close exactly: the ring makes whole turns (its claw makes it asymmetric)
# and the core sways back to rest, so nothing jumps when a loop restarts.
NULL_CLIPS = {
    "Idle": (360, True, [
        (1, "Ring", (0, 0, 0)), (360, "Ring", (0, 360, 0)),
        (90, "Core", (0, 9, 0)), (180, "Core", (3, 0, 0)), (270, "Core", (0, -9, 0)),
        (120, "WP_LEG", (7, 0, 4)), (240, "WP_LEG", (-6, 0, -4)),
    ]),
    "Telegraph": (36, True, [
        (1, "Ring", (0, 0, 0)), (36, "Ring", (0, 360, 0)),
        (18, "Core", (-8, 0, 0)), (18, "WP_ARM", (0, 0, 25)), (18, "WP_LEG", (10, 0, 0)),
    ]),
    "Attack": (24, False, [
        (8, "Core", (-20, 0, 0)), (1, "Ring", (0, 0, 0)), (24, "Ring", (0, 180, 0)), (8, "WP_ARM", (0, 0, -30)),
    ]),
    "HitReact": (12, False, [(4, "Core", (12, 0, 8)), (4, "Ring", (6, 0, -4))]),
    "Defeat": (60, False, [(60, "Ring", (70, 300, 0)), (60, "Core", (40, 0, 0)), (60, "WP_LEG", (40, 0, 20))]),
}


def null_core_materials():
    return {
        "obsidian": surface("null_obsidian", (0.014, 0.012, 0.018), 0.5, 0.16, wear=0.7,
                            wear_rgb=(0.2, 0.06, 0.36), grime=0.3),
        "carapace": surface("null_carapace", (0.05, 0.035, 0.07), 0.85, 0.3, wear=0.5,
                            wear_rgb=(0.36, 0.14, 0.5), grime=0.5),
        "bone": surface("null_bone", (0.1, 0.085, 0.11), 0.2, 0.42, wear=0.3, grime=0.8),
        "glow": surface("null_glow", (1.0, 0.06, 0.12), 0.0, 0.3, emission=((1.0, 0.03, 0.07), 1.4)),
        "violet": surface("null_violet", (0.4, 0.1, 0.8), 0.0, 0.3, emission=((0.5, 0.1, 1.0), 1.6)),
        "weak": surface("null_weak", (1.0, 0.1, 0.15), 0.0, 0.25, emission=((1.0, 0.06, 0.1), 1.8)),
    }


def build_null_core_shapes(k, M):
    front = Vector((0, -1, 0))
    # burning core under the scales; the gaps glow red
    k.ellipsoid("core_fire", "Core", M["glow"], (0, 0, 0), (0.93, 0.93, 0.93), subdiv=3)
    k.plate_shell("scales", "Core", M["obsidian"], 0.95, 0.07, subdiv=2, gap=0.94, seed=3,
                  skip=lambda n, rng: n.dot(front) > 0.8 or rng.random() < 0.04)
    k.plate_shell("scales_outer", "Core", M["carapace"], 1.05, 0.05, subdiv=1, gap=0.8, seed=5, lift=0.04,
                  skip=lambda n, rng: n.dot(front) > 0.5 or n.z < -0.5 or rng.random() < 0.6)
    # crown of crystals over the top and the flanks
    for i, (az, el, ln, r) in enumerate([(0, 70, 1.25, 0.16), (60, 55, 0.95, 0.13), (-60, 55, 0.95, 0.13),
                                         (130, 45, 1.05, 0.14), (-130, 45, 1.05, 0.14), (180, 62, 0.85, 0.12),
                                         (95, 20, 0.7, 0.11), (-95, 20, 0.7, 0.11), (30, 35, 0.6, 0.09),
                                         (-30, 35, 0.6, 0.09)]):
        a, e = math.radians(az), math.radians(el)
        d = Vector((math.sin(a) * math.cos(e), math.cos(a) * math.cos(e), math.sin(e)))
        k.crystal("crown", "Core", M["obsidian"], d * 0.95, d + Vector((0, 0, 0.25)), ln, r, seed=10 + i)
    # the eye: socket, lids, the iris (weak_core) and a slit pupil
    with k.frame((0, -0.92, 0.0)):
        k.ring("eye_socket", "Core", M["carapace"], (0, 0, 0), 0.44, 0.08, axis="Y", sides=6, segments=36)
        for sz in (1, -1):
            k.crystal("eye_lid", "Core", M["carapace"], (-0.5, 0.05, sz * 0.36), (1, -0.25, sz * 0.1), 1.0, 0.1,
                      sides=4, waist=0.5, seed=40 + sz, jitter=0.05)
    k.ellipsoid("iris", "WP_CORE", M["weak"], (0, -0.97, 0), (0.34, 0.14, 0.34), subdiv=3)
    k.block("pupil", "WP_CORE", M["obsidian"], (0, -1.1, 0), (0.07, 0.03, 0.4), taper=(0.3, 1), bot=(0.3, 1),
            bevel=0.0)
    # stinger under the core (weak_leg at its root)
    k.ellipsoid("stinger_bulb", "WP_LEG", M["weak"], (0, 0, -1.2), (0.26, 0.26, 0.3), subdiv=3)
    k.ring("stinger_collar", "WP_LEG", M["carapace"], (0, 0, -1.05), 0.3, 0.07, axis="Z", sides=5, segments=24)
    k.crystal("stinger", "WP_LEG", M["obsidian"], (0, 0, -1.35), (0, 0, -1), 1.3, 0.2, seed=60, jitter=0.1)
    for i in range(6):
        a = i / 6 * math.tau + 0.3
        d = Vector((math.cos(a) * 0.55, math.sin(a) * 0.55, -1)).normalized()
        k.crystal("tendril", "WP_LEG", M["obsidian"], (math.cos(a) * 0.3, math.sin(a) * 0.3, -1.1), d,
                  0.75 + 0.15 * (i % 2), 0.09, seed=70 + i)
    # the broken ring below the eye line: three arcs, a violet seam, blade shards and the claw
    rz, rr = -0.45, 1.85
    for j in range(3):
        a0 = j * 120 + 8
        pts = [Vector((math.cos(math.radians(a)) * rr, math.sin(math.radians(a)) * rr, rz))
               for a in range(a0, a0 + 100, 4)]
        k.sweep("ring_arc", "Ring", M["carapace"], pts, [0.13] * len(pts), sides=4, flat=0.42)
        k.sweep("ring_seam", "Ring", M["violet"], [p + Vector((0, 0, 0.06)) for p in pts], [0.02] * len(pts),
                sides=4)
    blades = [(20, 0.95), (48, 0.62), (75, 0.8), (140, 0.9), (166, 0.6), (192, 0.75), (255, 0.92), (282, 0.62),
              (310, 0.78), (336, 0.58)]
    for i, (ang, ln) in enumerate(blades):
        a = math.radians(ang)
        base = Vector((math.cos(a) * (rr + 0.05), math.sin(a) * (rr + 0.05), rz))
        tangent = Vector((-math.sin(a), math.cos(a), 0))
        d = (base.normalized() * 0.7 + tangent * 0.6 + Vector((0, 0, 0.12 * (-1) ** i))).normalized()
        k.crystal("blade", "shard_0" if i == 0 else "Ring", M["obsidian"], base, d, ln, 0.12, sides=4, waist=0.3,
                  seed=80 + i, jitter=0.08)
    # the claw on the ring (WP_ARM); its emitter orb is weak_arm
    cx = rr + 0.05
    for i, (dy, dz) in enumerate(((-0.2, 0.1), (0.2, 0.1), (0, -0.18))):
        k.crystal("claw_base", "WP_ARM", M["carapace"], (cx + 0.1, dy * 0.6, rz + dz * 0.6), (-1, dy, dz), 0.5, 0.16,
                  sides=5, seed=110 + i, jitter=0.1)
        k.crystal("talon", "WP_ARM", M["obsidian"], (cx + 0.12, dy, rz + dz), (1, dy * 1.8, dz * 1.8 - 0.1), 1.15,
                  0.12, sides=4, seed=120 + i, jitter=0.06)
    k.ellipsoid("claw_orb", "WP_ARM", M["weak"], (cx + 0.2, 0, rz), (0.18, 0.18, 0.18), subdiv=3)


def make_raijin(out_root, preview_dir, hdri, stage):
    clear_scene()
    bpy.context.scene.render.fps = FPS  # clip lengths are in 30 fps frames
    M = raijin_materials()
    k = Kit("rj")
    t0 = time.time()
    build_raijin_shapes(k, M, stencil_font())
    apply_and_tag(k)
    print(f"raijin shapes: {len(k.pieces)} pieces + {len(k.glow)} glow, "
          f"{tri_count(k.pieces + k.glow)} tris, {time.time() - t0:.1f}s", flush=True)
    views = [("front", 0, 8, 50), ("three_quarter", 35, 12, 50), ("back", 160, 14, 50), ("hero", -24, -6, 32)]
    if stage == "geo":
        preview("hero_raijin_geo", preview_dir, (0, 0, 2.45), 9.5, pick_views(views),
                samples=int(opt("samples", 24)), hdri=hdri, res=(800, 800))
        return
    arm = build_armature("raijin", robot_bones(1.3, 0.48, 1.0))
    body = join_and_unwrap(k, "raijin")
    bake_maps(body, "raijin", int(opt("tex", 2048)), os.path.join(out_root, "assets/blender/hero_textures"),
              int(opt("bake-samples", 16)))
    split_by_bone(body, arm, "raijin", rename={"Cannon": "Cannon"}, parent={"Cannon": "Chest"})
    rig_glow(k, arm, "raijin", parent={"Cannon": "Chest"})
    socket(arm, "Muzzle", "Chest", (-0.78, -1.6, 4.08))
    dmg_plate = surface("raijin_damage_plate", (0.80, 0.25, 0.014), 0.0, 0.4)
    add_damage(arm, M["glow"], dmg_plate, -0.66, 3.3, 0.8, (1.42, 3.6, -0.5))
    add_actions(arm, raijin_clips())
    finish("raijin", out_root, preview_dir, hdri, (0, 0, 2.45), 9.5, views)


def make_null_core(out_root, preview_dir, hdri, stage):
    clear_scene()
    bpy.context.scene.render.fps = FPS  # clip lengths are in 30 fps frames
    M = null_core_materials()
    k = Kit("nc")
    t0 = time.time()
    build_null_core_shapes(k, M)
    apply_and_tag(k)
    print(f"null_core shapes: {len(k.pieces)} pieces + {len(k.glow)} glow, "
          f"{tri_count(k.pieces + k.glow)} tris, {time.time() - t0:.1f}s", flush=True)
    views = [("front", 0, 6, 50), ("three_quarter", 40, 18, 50), ("side", 90, 4, 50), ("hero", -20, -12, 32)]
    if stage == "geo":
        preview("hero_null_core_geo", preview_dir, (0, 0, 0), 9.0, pick_views(views),
                samples=int(opt("samples", 24)), hdri=hdri, res=(800, 800), mood="night", ground_z=-3.2)
        return
    arm = build_armature("null_core", NULL_BONES)
    body = join_and_unwrap(k, "null_core")
    bake_maps(body, "null_core", int(opt("tex", 2048)), os.path.join(out_root, "assets/blender/hero_textures"),
              int(opt("bake-samples", 16)))
    split_by_bone(body, arm, "null_core", rename={"shard_0": "shard_0"}, parent={"shard_0": "Ring"})
    rig_glow(k, arm, "null_core", rename={"WP_CORE": "weak_core", "WP_ARM": "weak_arm", "WP_LEG": "weak_leg"})
    add_actions(arm, NULL_CLIPS)
    linear_spin(["Ring"])
    finish("null_core", out_root, preview_dir, hdri, (0, 0, 0), 9.0, views, mood="night", ground_z=-3.2)


def action_fcurves(action):
    """F-curves of an action on both the legacy and the layered (Blender 4.4+) API."""
    legacy = getattr(action, "fcurves", None)
    if legacy is not None:
        return list(legacy)
    out = []
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                out.extend(bag.fcurves)
    return out


def linear_spin(bones):
    """Whole-turn spins must not ease in and out, or the loop seam shows."""
    for action in bpy.data.actions:
        for fc in action_fcurves(action):
            if any(f'"{b}"' in fc.data_path for b in bones) and fc.data_path.endswith("rotation_euler"):
                for kp in fc.keyframe_points:
                    kp.interpolation = "LINEAR"


def pick_views(views):
    pick = opt("views")
    return [v for v in views if v[0] in pick.split(",")] if isinstance(pick, str) else views


def finish(name, out_root, preview_dir, hdri, target, radius, views, **kw):
    glb = os.path.join(out_root, HERO_DIR, f"{name}.glb")
    export_hero(glb)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    print(f"{name}.glb: {os.path.getsize(glb) / 1e6:.1f} MB, {tri_count(meshes)} tris", flush=True)
    bpy.context.preferences.filepaths.save_version = 0
    # Texture paths relative to the .blend, so the source opens on any machine.
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out_root, f"assets/blender/hero_{name}.blend"),
                                compress=True)
    bpy.ops.file.make_paths_relative()
    bpy.ops.wm.save_mainfile(compress=True)
    if not opt("no-render"):
        preview(f"hero_{name}", preview_dir, target, radius, pick_views(views), samples=int(opt("samples", 48)),
                hdri=hdri, res=(900, 900), **kw)


def write_manifest(out_root):
    """The arena reads the hero set from here (?models=hero). Fujin has no hero
    model yet: without an entry the arena keeps the code-built one (D-072),
    which holds up better next to Raijin than the old blockout."""
    path = os.path.join(out_root, HERO_DIR, "manifest.json")
    m = {"RAIJIN": "raijin.glb", "BOSS": "null_core.glb", "source": "tools/blender/hero_assets.py"}
    with open(path, "w") as f:
        json.dump(m, f, indent=2)
        f.write("\n")


def main():
    only = opt("only", "all")
    stage = opt("stage", "full")
    out_root = os.path.abspath(opt("out-root", ROOT))
    preview_dir = os.path.abspath(opt("preview-dir", os.path.join(out_root, "docs/art")))
    hdri = opt("hdri")
    os.makedirs(preview_dir, exist_ok=True)
    if only in ("raijin", "all"):
        make_raijin(out_root, preview_dir, hdri, stage)
    if only in ("null_core", "all"):
        make_null_core(out_root, preview_dir, hdri, stage)
    if stage != "geo":
        write_manifest(out_root)


if __name__ == "__main__":
    main()
