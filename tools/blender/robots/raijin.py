"""
RAIJIN 雷神 — heavy armour, stacked-block construction, thunder-drum drive, amber glow.

Master design: docs/design/visual-bible-v01/ (01_RAIJIN_Design_Sheet.png + DESIGN_RULES_FOR_BLENDER.md).
  * silhouette locks: two horns, very wide shoulders, huge fists / forearms, one thunder drum
    (雷鼓) behind EACH shoulder; low centre of gravity, strong legs
  * Proof-of-Work motif: arm / leg armour reads as rectangular blocks stacked and split at the
    joints, with amber light in the seams; the chest is a "compute furnace" of repeating glowing
    tiles. Original abstract patterns only — no project logos, no ₿ mark
  * face: brim-like sharp visor (ひさし) over glowing eyes, oni-style mask, crescent horns
  * drums: vermilion barrel, copper hoops and studs, ivory heads with a mitsudomoe; each disc
    spins on its own bone (Drum_L / Drum_R). Lightning itself is a game effect, not mesh
  * palette: black iron #1E242D, copper armour #BC682A, glow amber #FF951A, vermilion #A42B20
Joint positions: robotkit.rig.SKELETONS["raijin"] (+ EXTRA_BONES for fingers, shoulder armour, drums).
"""

import math

from robotkit import geo, surface
from robotkit.parts import Robot, make_material, xf

KEY = "raijin"
PREFIX = "RJ"
TEAM_COLOR = "#FF951A"
ATLAS = {"size": 2048, "emissive_strength": 2.8, "keep": ()}

BEVEL_L, BEVEL_M, BEVEL_S = 0.022, 0.014, 0.008
AMBER = (1.0, 0.300, 0.010)  # #FF951A in linear RGB


def materials(detail):
    m = {
        "iron": make_material("RJ_Iron", "#1E242D", metallic=0.6, roughness=0.42),
        "copper": make_material("RJ_Copper", "#BC682A", metallic=0.75, roughness=0.32),
        "red": make_material("RJ_Vermilion", "#A42B20", metallic=0.25, roughness=0.38),
        "skin": make_material("RJ_DrumSkin", "#E6D6B8", metallic=0.0, roughness=0.62),
        "glow": make_material("RJ_Glow", "#FF951A", emission="#FF951A", strength=2.2),
        "core": make_material("RJ_Core", "#FFC27A", emission="#FF951A", strength=2.8),
    }
    if detail:
        # Stacked-block look: panel seams on the black iron glow amber in patches.
        surface.detail(m["iron"], spacing=(0.34, 0.30, 0.26), panel_darken=0.35, seam_glow=(AMBER, 1.2, 1.6))
        surface.detail(m["copper"], spacing=(0.34, 0.30, 0.26), panel_darken=0.35, rough_noise=0.10)
        surface.detail(m["red"], spacing=(0.40, 0.36, 0.30), panel_darken=0.3)
        surface.detail(m["skin"], panels=False, rough_noise=0.08, bevel_radius=0.0)
    return m


def at(center, rot=(0, 0, 0), offset=(0, 0, 0), rot2=(0, 0, 0)):
    """Matrix for a detail placed at `offset` inside a block at `center` rotated by `rot`."""
    return xf(center, rot) @ xf(offset, rot2)


def build(detail=False):
    """Return (Robot, materials). `detail` adds procedural surface detail for the bake."""
    M = materials(detail)
    r = Robot(KEY, PREFIX)
    _head(r, M)
    _torso(r, M)
    _arms(r, M)
    _legs(r, M)
    _back(r, M)
    return r, M


# --------------------------------------------------------------------------- head


def _head(r, M):
    h = r.part("Head", "Head", "head", mirror=True, bevel=BEVEL_S)
    # Vermilion kabuto with an iron crown and a copper crest ridge.
    h.add(geo.tbox(0.60, 0.58, 0.36, tw=0.50, td=0.48, dy=0.02), M["red"], xf((0, -0.04, 4.22)))
    h.add(geo.tbox(0.52, 0.50, 0.06, tw=0.42, td=0.40), M["iron"], xf((0, -0.02, 4.425)))
    h.add(geo.tbox(0.10, 0.50, 0.10, tw=0.06, td=0.44), M["copper"], xf((0, 0.0, 4.45)))
    # Sharp brim (ひさし) angled down over the eyes.
    h.add(geo.tbox(0.72, 0.30, 0.05, tw=0.64, td=0.12, dy=-0.07), M["copper"], xf((0, -0.33, 4.35), (14, 0, 0)))
    # Dark eye band and slanted glowing eyes.
    h.add(geo.tbox(0.46, 0.06, 0.12), M["iron"], xf((0, -0.325, 4.27)))
    h.add_many(geo.segments_xz([(0.05, 4.255), (0.19, 4.295)], 0.045, 0.04), M["core"], xf((0, -0.355, 0)))
    # Oni mask: vermilion face, iron mouth guard with copper fangs, chin.
    h.add(geo.tbox(0.40, 0.14, 0.18, tw=0.46, td=0.12), M["red"], xf((0, -0.33, 4.12)))
    h.add(geo.tbox(0.30, 0.10, 0.08), M["iron"], xf((0, -0.39, 4.06)))
    h.add(geo.prism([(0.06, 4.025), (0.11, 4.025), (0.085, 4.105)], 0.03), M["copper"], xf((0, -0.445, 0)))
    h.add(geo.tbox(0.26, 0.10, 0.06), M["copper"], xf((0, -0.36, 3.99)))
    # Fukigaeshi cheek guards with copper edges.
    cheek, cheek_r = (0.35, -0.20, 4.24), (0, 0, 24)
    h.add(geo.tbox(0.06, 0.28, 0.26, td=0.20), M["red"], xf(cheek, cheek_r))
    h.add(geo.tbox(0.065, 0.03, 0.26), M["copper"], at(cheek, cheek_r, (0, -0.13, 0)))
    # Crescent horns rising from the brim, broad face to the front, tips curling inward.
    horn = [
        (0.13, -0.36, 4.40),
        (0.27, -0.39, 4.50),
        (0.39, -0.37, 4.66),
        (0.45, -0.31, 4.86),
        (0.42, -0.25, 5.03),
        (0.33, -0.21, 5.13),
    ]
    sizes = [(0.10, 0.05), (0.12, 0.05), (0.11, 0.045), (0.09, 0.04), (0.06, 0.03), (0.012, 0.01)]
    h.add(geo.loft(horn, sizes, geo.LENS, up=(0, 1, 0)), M["copper"])
    h.add(geo.tbox(0.14, 0.10, 0.10), M["copper"], xf((0.13, -0.35, 4.40)))
    # Side sensors and the shikoro neck guard.
    h.add(geo.cyl(0.075, 0.08, 12), M["iron"], xf((0.32, -0.02, 4.20), (0, 90, 0)))
    h.add(geo.cyl(0.045, 0.02, 12), M["glow"], xf((0.365, -0.02, 4.20), (0, 90, 0)))
    h.add(geo.tbox(0.66, 0.08, 0.14, tw=0.62), M["iron"], xf((0, 0.30, 4.12), (25, 0, 0)))
    h.add(geo.tbox(0.72, 0.08, 0.13, tw=0.68), M["iron"], xf((0, 0.35, 4.00), (30, 0, 0)))
    h.add(geo.tbox(0.72, 0.09, 0.03), M["copper"], at((0, 0.35, 4.00), (30, 0, 0), (0, 0, -0.065)))

    n = r.part("Neck", "Neck", "joints", bevel=BEVEL_S)
    n.add(geo.cyl(0.19, 0.26, 12, r_top=0.17), M["iron"], xf((0, -0.05, 3.93)))
    n.add(geo.torus(0.2, 0.025, 20, 6), M["copper"], xf((0, -0.05, 3.86)))


# --------------------------------------------------------------------------- torso

FURNACE = (0.0, -0.47, 3.26)  # chest "compute furnace": a grid of glowing tiles


def _torso(r, M):
    c = r.part("Chest", "Chest", "torso", mirror=True, bevel=BEVEL_M)
    # Iron frame, wider at the shoulders (inverted trapezoid), copper yoke, vermilion collar.
    c.add(geo.tbox(1.30, 0.92, 1.00, tw=1.70, td=1.02), M["iron"], xf((0, 0.04, 3.20)))
    c.add(geo.tbox(2.0, 1.05, 0.16, tw=1.80, td=0.96), M["copper"], xf((0, 0.04, 3.76)))
    c.add(geo.tbox(0.86, 0.22, 0.28, tw=0.70, td=0.16, dy=-0.03), M["red"], xf((0, 0.40, 3.94)))
    # Gorget around the neck so the head sits low between the shoulders (low centre of gravity).
    c.add(geo.tbox(0.52, 0.14, 0.16, tw=0.58, td=0.12), M["iron"], xf((0, -0.33, 3.90)))
    c.add(geo.tbox(0.56, 0.15, 0.04), M["copper"], xf((0, -0.33, 3.995)))
    c.add(geo.tbox(0.16, 0.50, 0.22, tw=0.12, td=0.44), M["red"], xf((0.36, -0.02, 3.93)))
    # Vermilion pectoral blocks with copper edges and a glowing seam below.
    pec, pec_r = (0.60, -0.44, 3.36), (-5, 0, 0)
    c.add(geo.tbox(0.52, 0.28, 0.56, tw=0.58, td=0.24, dx=0.03), M["red"], xf(pec, pec_r))
    c.add(geo.tbox(0.58, 0.26, 0.05), M["copper"], at(pec, pec_r, (0.03, 0, 0.29)))
    c.add(geo.tbox(0.05, 0.26, 0.56), M["copper"], at(pec, pec_r, (0.30, 0, 0)))
    c.add(geo.tbox(0.46, 0.20, 0.03), M["glow"], xf((0.58, -0.40, 3.05)))
    c.add(geo.tbox(0.48, 0.24, 0.10, tw=0.50), M["iron"], xf((0.58, -0.40, 2.98)))
    # Compute furnace: copper frame, iron grid, 3×3 glowing tiles (left half + centre column).
    fx, fy, fz = FURNACE
    c.add(geo.tbox(0.66, 0.16, 0.66), M["copper"], xf((fx, fy, fz)))
    c.add(geo.tbox(0.56, 0.06, 0.56), M["iron"], xf((fx, fy - 0.08, fz)))
    for tx in (0.0, 0.17):
        for tz in (-0.17, 0.0, 0.17):
            c.add(geo.tbox(0.14, 0.03, 0.14), M["core"], xf((tx, fy - 0.115, fz + tz)))
    # Abdomen blocks with glowing seams.
    for z, w in ((2.86, 0.36), (2.66, 0.34)):
        c.add(geo.tbox(w, 0.18, 0.17, tw=w + 0.02), M["iron"], xf((0.19, -0.42, z)))
        c.add(geo.tbox(w - 0.02, 0.17, 0.025), M["glow"], xf((0.19, -0.42, z + 0.10)))
    # Flank plates with vent slits.
    c.add(geo.tbox(0.12, 0.80, 0.70, td=0.90, dx=0.05), M["iron"], xf((0.84, 0.04, 3.20)))
    c.add(geo.tbox(0.13, 0.82, 0.05), M["copper"], xf((0.845, 0.04, 3.53)))
    for z in (3.02, 3.14, 3.26):
        c.add(geo.tbox(0.02, 0.40, 0.03), M["glow"], xf((0.92, 0.04, z)))
    # Back plate and exhaust stacks.
    c.add(geo.tbox(1.40, 0.20, 0.86, tw=1.60, td=0.18), M["iron"], xf((0, 0.58, 3.25)))
    c.add(geo.cyl(0.10, 0.30, 12), M["iron"], xf((0.40, 0.66, 3.20)))
    c.add(geo.cyl(0.07, 0.02, 12), M["glow"], xf((0.40, 0.66, 3.355)))

    s = r.part("Spine", "Spine", "torso", mirror=True, bevel=BEVEL_M)
    s.add(geo.cyl(0.46, 0.42, 12, r_top=0.52), M["iron"], xf((0, 0.04, 2.47)))
    s.add(geo.tbox(0.30, 0.15, 0.16, tw=0.32), M["iron"], xf((0.16, -0.40, 2.42)))
    s.add(geo.tbox(0.28, 0.14, 0.025), M["glow"], xf((0.16, -0.40, 2.515)))
    s.add(geo.tbox(0.10, 0.50, 0.36), M["iron"], xf((0.50, 0.04, 2.47)))

    hp = r.part("Hips", "Hips", "torso", mirror=True, bevel=BEVEL_M)
    hp.add(geo.tbox(1.10, 0.80, 0.42, tw=1.30, td=0.86), M["iron"], xf((0, 0.03, 2.02)))
    hp.add(geo.tbox(1.36, 0.90, 0.12), M["copper"], xf((0, 0.03, 2.20)))
    # Buckle: vermilion block in a copper border with a glowing diamond.
    hp.add(geo.tbox(0.36, 0.10, 0.26, tw=0.32), M["copper"], xf((0, -0.47, 2.13)))
    hp.add(geo.tbox(0.28, 0.05, 0.18, tw=0.24), M["red"], xf((0, -0.52, 2.13)))
    hp.add(geo.prism([(0.0, 2.19), (0.05, 2.13), (0.0, 2.07), (-0.05, 2.13)], 0.03), M["glow"], xf((0, -0.55, 0)))
    # Long vermilion front tasset (前垂れ) with copper borders, tip kicked slightly forward.
    tas, tas_r = (0, -0.48, 1.62), (-6, 0, 0)
    hp.add(geo.tbox(0.34, 0.07, 0.90, tw=0.40), M["red"], xf(tas, tas_r))
    hp.add(geo.tbox(0.045, 0.085, 0.90), M["copper"], at(tas, tas_r, (0.175, 0, 0)))
    hp.add(geo.tbox(0.38, 0.085, 0.05), M["copper"], at(tas, tas_r, (0, 0, -0.44)))
    hp.add(geo.tbox(0.03, 0.02, 0.62), M["glow"], at(tas, tas_r, (0, -0.042, 0.05)))
    # Side tassets (kusazuri) hang outside the thighs; rear plate.
    side, side_r = (0.74, 0.0, 1.92), (0, -12, 0)
    hp.add(geo.tbox(0.10, 0.62, 0.40, td=0.66), M["iron"], xf(side, side_r))
    hp.add(geo.tbox(0.105, 0.64, 0.05), M["copper"], at(side, side_r, (0, 0, -0.19)))
    hp.add(geo.tbox(0.03, 0.56, 0.03), M["glow"], at(side, side_r, (0.05, 0, -0.12)))
    hp.add(geo.tbox(0.09, 0.58, 0.30), M["iron"], xf((0.80, 0.0, 1.66), (0, -16, 0)))
    hp.add(geo.tbox(0.60, 0.10, 0.40, tw=0.70), M["iron"], xf((0, 0.48, 1.92), (-10, 0, 0)))


# --------------------------------------------------------------------------- arms

FINGERS = ("Index", "Middle", "Ring", "Pinky")


def _arms(r, M):
    def shoulder(p):
        p.add(geo.sphere(0.30, 16, 10), M["iron"], xf((1.22, 0, 3.5)))

    def pauldron(p):
        # Huge stacked dome: iron blocks, copper bands, vermilion plates, glowing seams.
        sc, sr = (1.34, 0.0, 3.70), (0, 12, 0)
        p.add(geo.tbox(1.02, 1.04, 0.40, tw=0.86, td=0.90, dx=0.04), M["iron"], xf(sc, sr))
        p.add(geo.tbox(0.70, 0.78, 0.16, tw=0.50, td=0.62), M["iron"], at(sc, sr, (0.04, 0, 0.27)))
        p.add(geo.tbox(0.74, 0.80, 0.04), M["copper"], at(sc, sr, (0.04, 0, 0.19)))
        p.add(geo.tbox(1.06, 1.08, 0.06), M["copper"], at(sc, sr, (0, 0, -0.19)))
        for y in (-0.53, 0.53):
            p.add(geo.tbox(0.60, 0.05, 0.22, tw=0.54), M["red"], at(sc, sr, (0.02, y, 0.0)))
        p.add(geo.tbox(0.55, 0.03, 0.03), M["glow"], at(sc, sr, (0.02, -0.56, -0.13)))
        for c, rot, size in (
            ((1.88, 0, 3.38), (0, -14, 0), (0.11, 0.94, 0.34)),
            ((1.94, 0, 3.12), (0, -18, 0), (0.10, 0.88, 0.30)),
        ):
            p.add(geo.tbox(size[0], size[1], size[2], td=size[1] + 0.04), M["iron"], xf(c, rot))
            p.add(geo.tbox(size[0] + 0.005, size[1] + 0.02, 0.04), M["copper"], at(c, rot, (0, 0, size[2] / 2 - 0.02)))
            p.add(geo.tbox(0.03, size[1] - 0.1, 0.035), M["glow"], at(c, rot, (size[0] / 2, 0, -size[2] / 2 + 0.04)))

    def upper_arm(p):
        p.add(geo.cyl(0.26, 0.62, 12, r_top=0.28), M["iron"], xf((1.22, 0, 3.02)))
        p.add(geo.tbox(0.20, 0.50, 0.46, td=0.46), M["copper"], xf((1.43, 0, 3.0)))
        p.add(geo.tbox(0.40, 0.10, 0.40), M["iron"], xf((1.22, -0.27, 3.0)))
        p.add(geo.torus(0.29, 0.03, 20, 6), M["copper"], xf((1.22, 0, 2.76)))

    def elbow(p):
        p.add(geo.cyl(0.22, 0.52, 14), M["iron"], xf((1.22, 0, 2.65), (0, 90, 0)))
        for x in (1.49, 0.95):
            p.add(geo.cyl(0.15, 0.06, 14), M["copper"], xf((x, 0, 2.65), (0, 90, 0)))
        p.add(geo.tbox(0.30, 0.14, 0.26, tw=0.24), M["copper"], xf((1.22, 0.28, 2.66)))

    def forearm(p):
        # Huge gauntlet: three stacked blocks widening to the wrist, amber light in the seams.
        p.add(geo.tbox(0.62, 0.64, 0.20, tw=0.58, td=0.60), M["iron"], xf((1.22, 0, 2.46)))
        p.add(geo.tbox(0.60, 0.62, 0.03), M["glow"], xf((1.22, 0, 2.345)))
        p.add(geo.tbox(0.78, 0.80, 0.22, tw=0.66, td=0.68), M["copper"], xf((1.22, 0, 2.22)))
        p.add(geo.tbox(0.76, 0.78, 0.03), M["glow"], xf((1.22, 0, 2.095)))
        p.add(geo.tbox(0.90, 0.90, 0.24, tw=0.80, td=0.82), M["iron"], xf((1.22, 0, 1.96)))
        p.add(geo.tbox(0.14, 0.62, 0.50, td=0.52), M["red"], xf((1.69, 0, 2.16)))
        # Front block with a 2×2 window of glowing tiles (the sheet's block motif).
        p.add(geo.tbox(0.50, 0.12, 0.40, tw=0.44), M["iron"], xf((1.22, -0.47, 2.16)))
        for dx in (-0.08, 0.08):
            for dz in (-0.08, 0.08):
                p.add(geo.tbox(0.12, 0.03, 0.12), M["core"], xf((1.22 + dx, -0.535, 2.16 + dz)))
        p.add(geo.tbox(0.92, 0.92, 0.07), M["copper"], xf((1.22, 0, 1.84)))

    def hand(p):
        # Fist as big as the head; each finger is bound to its own bone.
        p.add(geo.cyl(0.26, 0.10, 14), M["iron"], xf((1.22, 0, 1.80)))
        p.add(geo.tbox(0.66, 0.58, 0.42, tw=0.68, td=0.60), M["iron"], xf((1.22, 0.03, 1.60)))
        p.add(geo.tbox(0.12, 0.50, 0.36), M["copper"], xf((1.56, 0.03, 1.60)))
        p.add(geo.tbox(0.66, 0.03, 0.03), M["glow"], xf((1.22, -0.27, 1.72)))
        for i, name in enumerate(FINGERS):
            x = 1.22 + (i - 1.5) * 0.158
            b = f"{name}_L"
            p.add(geo.tbox(0.15, 0.20, 0.26), M["iron"], xf((x, -0.32, 1.56)), bone=b)
            p.add(geo.tbox(0.155, 0.08, 0.10), M["copper"], xf((x, -0.41, 1.63)), bone=b)
            p.add(geo.tbox(0.12, 0.02, 0.025), M["glow"], xf((x, -0.425, 1.56)), bone=b)
        p.add(geo.tbox(0.13, 0.24, 0.22), M["iron"], xf((0.88, -0.17, 1.58)), bone="Thumb_L")
        p.add(geo.tbox(0.135, 0.08, 0.08), M["copper"], xf((0.88, -0.27, 1.64)), bone="Thumb_L")

    r.sided("Shoulder", "UpperArm", "joints", shoulder)
    r.sided("Pauldron", "ShoulderArmor", "arms", pauldron, bevel=BEVEL_L)
    r.sided("UpperArm", "UpperArm", "arms", upper_arm, bevel=BEVEL_M)
    r.sided("Elbow", "Forearm", "joints", elbow, bevel=BEVEL_S)
    r.sided("Forearm", "Forearm", "arms", forearm, bevel=BEVEL_M)
    r.sided("Hand", "Hand", "arms", hand, bevel=BEVEL_M)


# --------------------------------------------------------------------------- legs


def _legs(r, M):
    def hip_joint(p):
        p.add(geo.sphere(0.27, 16, 10), M["iron"], xf((0.42, 0, 1.86)))

    def thigh(p):
        p.add(geo.cyl(0.34, 0.68, 12, r_top=0.37), M["iron"], xf((0.42, 0, 1.42)))
        p.add(geo.tbox(0.60, 0.20, 0.30, tw=0.62), M["iron"], xf((0.42, -0.32, 1.62)))
        p.add(geo.tbox(0.58, 0.19, 0.025), M["glow"], xf((0.42, -0.32, 1.455)))
        p.add(geo.tbox(0.56, 0.20, 0.24, tw=0.58), M["copper"], xf((0.42, -0.31, 1.31)))
        p.add(geo.tbox(0.14, 0.52, 0.50), M["iron"], xf((0.73, 0, 1.45)))
        p.add(geo.tbox(0.02, 0.36, 0.03), M["glow"], xf((0.805, 0, 1.40)))

    def knee(p):
        p.add(geo.cyl(0.21, 0.54, 14), M["iron"], xf((0.42, 0, 1.0), (0, 90, 0)))
        kc, kr = (0.42, -0.30, 1.02), (-8, 0, 0)
        p.add(geo.tbox(0.48, 0.22, 0.42, tw=0.38, td=0.15, dy=0.02), M["copper"], xf(kc, kr))
        p.add(geo.tbox(0.20, 0.05, 0.20, tw=0.10), M["red"], at(kc, kr, (0, -0.10, 0.02)))

    def shin(p):
        # Two stacked blocks (lower one flared like suneate) with an amber seam between them.
        p.add(geo.tbox(0.60, 0.64, 0.32, tw=0.56, td=0.60), M["iron"], xf((0.42, 0.02, 0.71)))
        p.add(geo.tbox(0.58, 0.62, 0.035), M["glow"], xf((0.42, 0.02, 0.535)))
        p.add(geo.tbox(0.72, 0.76, 0.36, tw=0.62, td=0.66), M["copper"], xf((0.42, 0.02, 0.34)))
        p.add(geo.tbox(0.40, 0.12, 0.56, tw=0.32, td=0.10), M["red"], xf((0.42, -0.40, 0.60)))
        p.add(geo.tbox(0.05, 0.03, 0.44), M["glow"], xf((0.42, -0.465, 0.60)))
        p.add(geo.tbox(0.40, 0.20, 0.50), M["iron"], xf((0.42, 0.38, 0.58)))
        for z in (0.50, 0.62):
            p.add(geo.tbox(0.30, 0.03, 0.03), M["glow"], xf((0.42, 0.485, z)))
        p.add(geo.tbox(0.10, 0.50, 0.50, td=0.44), M["iron"], xf((0.78, 0.02, 0.50)))
        p.add(geo.tbox(0.58, 0.62, 0.06), M["copper"], xf((0.42, 0.02, 0.88)))

    def foot(p):
        p.add(geo.tbox(0.72, 1.10, 0.20, tw=0.68, td=1.02), M["iron"], xf((0.42, -0.14, 0.10)))
        p.add(geo.tbox(0.70, 0.36, 0.18, tw=0.60, td=0.28, dy=0.04), M["copper"], xf((0.42, -0.50, 0.29)))
        p.add(geo.tbox(0.62, 0.56, 0.22, tw=0.56, td=0.50), M["iron"], xf((0.42, 0.02, 0.30)))
        p.add(geo.tbox(0.50, 0.24, 0.24), M["iron"], xf((0.42, 0.36, 0.14)))
        p.add(geo.tbox(0.72, 0.30, 0.08), M["copper"], xf((0.42, -0.56, 0.06)))
        p.add(geo.tbox(0.50, 0.03, 0.04), M["glow"], xf((0.42, -0.70, 0.15)))

    r.sided("HipJoint", "Thigh", "joints", hip_joint)
    r.sided("Thigh", "Thigh", "legs", thigh, bevel=BEVEL_M)
    r.sided("Knee", "Shin", "joints", knee, bevel=BEVEL_M)
    r.sided("Shin", "Shin", "legs", shin, bevel=BEVEL_M)
    r.sided("Foot", "Foot", "legs", foot, bevel=BEVEL_M)


# --------------------------------------------------------------------------- back: thunder drums

DRUM_C = (1.0, 0.70, 4.15)  # = Drum_L bone head
DRUM_ROT = (90, 0, 18)  # local +Z → drum axis (forward and slightly outward) = Drum_L bone direction
DRUM_R, DRUM_DEPTH = 0.50, 0.44


def _back(r, M):
    # Backpack (static on the chest): octagonal reactor housing, struts and the drum yokes.
    m = r.part("BackMount", "Chest", "back", mirror=True, bevel=BEVEL_S)
    rx = (90, 0, 0)
    m.add(geo.cyl(0.40, 0.30, 8), M["iron"], xf((0, 0.80, 3.55), rx))
    m.add(geo.torus(0.40, 0.035, 8, 4, rphase=math.pi / 4), M["copper"], xf((0, 0.95, 3.55), rx))
    m.add(geo.torus(0.28, 0.03, 8, 4), M["glow"], xf((0, 0.955, 3.55), rx))
    m.add(geo.cyl(0.16, 0.03, 16), M["core"], xf((0, 0.955, 3.55), rx))
    strut = [(0.20, 0.82, 3.70), (0.52, 0.80, 3.92), (0.78, 0.74, 4.04)]
    m.add(geo.loft(strut, [(0.15, 0.15)] * 3, geo.SQUARE, up=(0, 1, 0)), M["iron"])
    # Copper yoke around the barrel's waist: the disc spins inside it.
    m.add(geo.torus(DRUM_R + 0.11, 0.045, 28, 6), M["copper"], xf(DRUM_C, DRUM_ROT))
    m.add(geo.tbox(0.16, 0.16, 0.20), M["iron"], xf((0.80, 0.74, 4.02)))

    def drum(p):
        frame = xf(DRUM_C, DRUM_ROT)
        p.add(geo.barrel(DRUM_R, DRUM_R + 0.06, DRUM_DEPTH, 24, 4), M["red"], frame)
        for z in (-0.16, 0.16):
            p.add(geo.torus(DRUM_R + 0.035, 0.022, 24, 4), M["copper"], frame @ xf((0, 0, z)))
            for i in range(12):  # studs (鋲) in two rings, pointing radially out
                a = math.tau * (i + 0.5) / 12
                rr = DRUM_R + 0.045
                local = xf((rr * math.cos(a), rr * math.sin(a), z * 0.62), (0, 90, math.degrees(a)))
                p.add(geo.cyl(0.024, 0.03, 6), M["copper"], frame @ local)
        head_z = DRUM_DEPTH / 2
        for z in (head_z, -head_z):
            p.add(geo.cyl(DRUM_R - 0.03, 0.03, 32), M["skin"], frame @ xf((0, 0, z)))
        p.add(geo.torus(DRUM_R - 0.01, 0.018, 32, 4), M["glow"], frame @ xf((0, 0, head_z + 0.012)))
        for g in geo.tomoe(DRUM_R - 0.10):
            p.add(g, M["iron"], frame @ xf((0, 0, head_z + 0.021)))

    r.sided("Drum", "Drum", "back", drum, bevel=0.0)
