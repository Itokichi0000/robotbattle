"""
RAIJIN 雷神 — heavy armour, block-built plates, taiko-drum reactor, amber glow.

Design brief (docs/ART_BIBLE.md + the in-game procedural stand-in):
  * wide inverted-triangle silhouette, oversized ōsode-style pauldrons, fists as big as the head
  * chest reactor shaped like a taiko drum (barrel body, studded rim, glowing drumhead)
  * armour assembled from separate blocks with visible seams (block construction)
  * kabuto-like box helmet, two gold horns, amber chevron visor
  * thunder-drum ring on the back: gold hoop with 8 glowing drums (spins on the BackUnit bone)
  * palette: amber #E8851A, gold #C9A040, black iron #2A2522, glow #FFB547 / core #FFD27A
  * no logos or letters of any kind (in particular no Bitcoin "B" mark)
Joint positions come from robotkit.rig.SKELETONS["raijin"].
"""

import math

from robotkit import geo
from robotkit.parts import Robot, make_material, xf

KEY = "raijin"
PREFIX = "RJ"
TEAM_COLOR = "#F7931A"


def materials():
    return {
        "armor": make_material("RJ_Armor", "#E8851A", metallic=0.3, roughness=0.38),
        "gold": make_material("RJ_Gold", "#C9A040", metallic=0.75, roughness=0.3),
        "iron": make_material("RJ_Iron", "#2A2522", metallic=0.55, roughness=0.5),
        "glow": make_material("RJ_Glow", "#FFB547", emission="#FFB547", strength=2.0),
        "core": make_material("RJ_Core", "#FFD27A", emission="#FFD27A", strength=2.6),
    }


def at(center, rot=(0, 0, 0), offset=(0, 0, 0), rot2=(0, 0, 0)):
    """Matrix for a detail placed at `offset` inside a block at `center` rotated by `rot`."""
    return xf(center, rot) @ xf(offset, rot2)


def build(detail=False):
    """Return the Robot description. `detail` adds the second-pass greebles."""
    M = materials()
    r = Robot(KEY, PREFIX)
    _head(r, M, detail)
    _torso(r, M, detail)
    _arms(r, M, detail)
    _legs(r, M, detail)
    _back(r, M, detail)
    return r, M


# --------------------------------------------------------------------------- head


def _head(r, M, detail):
    h = r.part("Head", "Head", "head", mirror=True)
    # Kabuto-like box helmet, narrowing upward.
    h.add(geo.tbox(0.64, 0.62, 0.40, tw=0.54, td=0.52, dy=0.02), M["armor"], xf((0, -0.04, 4.24)))
    h.add(geo.tbox(0.56, 0.54, 0.06, tw=0.46, td=0.44), M["gold"], xf((0, -0.02, 4.47)))
    h.add(geo.tbox(0.08, 0.50, 0.08, tw=0.05, td=0.44), M["gold"], xf((0, 0.0, 4.53)))
    # Brow brim over the visor.
    h.add(geo.tbox(0.70, 0.16, 0.06, tw=0.66, td=0.12, dy=-0.02), M["gold"], xf((0, -0.36, 4.355)))
    # Chevron visor (left half; the Mirror modifier completes it).
    h.add_many(geo.segments_xz([(0.0, 4.245), (0.25, 4.30)], 0.065, 0.05), M["glow"], xf((0, -0.325, 0)))
    # Face guard and chin.
    h.add(geo.tbox(0.42, 0.16, 0.20, tw=0.46, td=0.14), M["iron"], xf((0, -0.32, 4.11)))
    h.add(geo.tbox(0.30, 0.10, 0.06, tw=0.34), M["gold"], xf((0, -0.36, 4.02)))
    # Fukigaeshi cheek guards flaring outward at the front.
    h.add(geo.tbox(0.06, 0.30, 0.30, td=0.22), M["armor"], xf((0.36, -0.20, 4.24), (0, 0, 22)))
    # Horns: tapered diamond-section sweep up and slightly back.
    horn = [(0.19, -0.10, 4.45), (0.29, -0.13, 4.60), (0.37, -0.12, 4.76), (0.42, -0.06, 4.91), (0.44, 0.03, 5.02)]
    sizes = [(0.12, 0.12), (0.10, 0.10), (0.075, 0.075), (0.045, 0.045), (0.01, 0.01)]
    h.add(geo.loft(horn, sizes, geo.DIAMOND, up=(0, 1, 0)), M["gold"])
    # Side sensors.
    h.add(geo.cyl(0.085, 0.08, 12), M["iron"], xf((0.33, -0.02, 4.2), (0, 90, 0)))
    h.add(geo.cyl(0.05, 0.02, 12), M["glow"], xf((0.375, -0.02, 4.2), (0, 90, 0)))
    # Shikoro neck guard: two lames at the back.
    h.add(geo.tbox(0.66, 0.08, 0.14, tw=0.62), M["armor"], xf((0, 0.30, 4.12), (25, 0, 0)))
    h.add(geo.tbox(0.72, 0.08, 0.13, tw=0.68), M["armor"], xf((0, 0.35, 4.0), (30, 0, 0)))
    # Small forehead gem (a plain diamond: no letters or logos).
    h.add(geo.prism([(0.0, 4.47), (0.05, 4.41), (0.0, 4.35), (-0.05, 4.41)], 0.03), M["glow"], xf((0, -0.43, 0)))

    n = r.part("Neck", "Neck", "joints")
    n.add(geo.cyl(0.19, 0.26, 12, r_top=0.17), M["iron"], xf((0, -0.05, 3.93)))
    n.add(geo.torus(0.2, 0.025, 24, 6), M["gold"], xf((0, -0.05, 3.86)))


# --------------------------------------------------------------------------- torso


REACTOR = (0.0, -0.48, 3.28)  # taiko-drum reactor, axis along -Y (faces forward)


def _torso(r, M, detail):
    c = r.part("Chest", "Chest", "torso", mirror=True)
    # Iron frame, wider at the shoulders (inverted trapezoid).
    c.add(geo.tbox(1.30, 0.92, 1.00, tw=1.70, td=1.02), M["iron"], xf((0, 0.04, 3.20)))
    # Gold yoke and the high collar behind the neck.
    c.add(geo.tbox(2.0, 1.05, 0.16, tw=1.80, td=0.96), M["gold"], xf((0, 0.04, 3.76)))
    c.add(geo.tbox(0.86, 0.22, 0.28, tw=0.70, td=0.16, dy=-0.03), M["armor"], xf((0, 0.40, 3.94)))
    # Pectoral blocks flanking the reactor, with lightning inlays.
    pec = (0.60, -0.44, 3.33)
    c.add(geo.tbox(0.50, 0.28, 0.58, tw=0.56, td=0.24, dx=0.03), M["armor"], xf(pec, (-5, 0, 0)))
    bolt = [(-0.10, 0.22), (0.07, 0.07), (-0.04, 0.03), (0.12, -0.20)]
    c.add_many(geo.segments_xz(bolt, 0.045, 0.03), M["glow"], at(pec, (-5, 0, 0), (0, -0.135, 0)))
    # Upper abdomen blocks.
    c.add(geo.tbox(0.36, 0.18, 0.20, tw=0.38), M["armor"], xf((0.19, -0.42, 2.88)))
    # Flank plates with vent slits.
    c.add(geo.tbox(0.12, 0.80, 0.70, td=0.90, dx=0.05), M["armor"], xf((0.84, 0.04, 3.20)))
    for z in (3.02, 3.14, 3.26):
        c.add(geo.tbox(0.02, 0.40, 0.03), M["glow"], xf((0.92, 0.04, z)))
    # Back plate, exhaust stacks and the drum-ring mount.
    c.add(geo.tbox(1.40, 0.20, 0.86, tw=1.60, td=0.18), M["armor"], xf((0, 0.58, 3.25)))
    c.add(geo.cyl(0.10, 0.30, 12), M["iron"], xf((0.40, 0.66, 3.58)))
    c.add(geo.cyl(0.07, 0.02, 12), M["glow"], xf((0.40, 0.66, 3.735)))
    c.add(geo.tbox(0.40, 0.30, 0.40), M["iron"], xf((0, 0.74, 3.40)))
    # Taiko-drum reactor: barrel body, studded gold rim, glowing drumhead.
    rx = (90, 0, 0)
    c.add(geo.torus(0.36, 0.07, 8, 4, rphase=math.pi / 4), M["iron"], xf((0, -0.56, REACTOR[2]), rx, (1, 1, 1.4)))
    c.add(geo.barrel(0.27, 0.31, 0.36, 24, 4), M["armor"], xf(REACTOR, rx))
    c.add(geo.cyl(0.25, 0.03, 24), M["core"], xf((0, -0.67, REACTOR[2]), rx))
    c.add(geo.torus(0.27, 0.03, 24, 6), M["gold"], xf((0, -0.665, REACTOR[2]), rx))
    c.add(geo.torus(0.15, 0.012, 24, 4), M["gold"], xf((0, -0.69, REACTOR[2]), rx))
    c.add(geo.cyl(0.05, 0.03, 12), M["gold"], xf((0, -0.695, REACTOR[2]), rx))
    for i in range(12):
        a = math.tau * i / 12
        x, z = 0.305 * math.cos(a), 0.305 * math.sin(a)
        if x >= -1e-6:
            c.add(geo.sphere(0.026, 8, 5), M["gold"], xf((x, -0.62, REACTOR[2] + z)))

    s = r.part("Spine", "Spine", "torso", mirror=True)
    s.add(geo.cyl(0.46, 0.42, 12, r_top=0.52), M["iron"], xf((0, 0.04, 2.47)))
    s.add(geo.tbox(0.34, 0.16, 0.18, tw=0.36), M["armor"], xf((0.18, -0.42, 2.58)))
    s.add(geo.tbox(0.30, 0.15, 0.16, tw=0.32), M["armor"], xf((0.16, -0.40, 2.40)))
    s.add(geo.tbox(0.10, 0.50, 0.36), M["armor"], xf((0.50, 0.04, 2.47)))

    hp = r.part("Hips", "Hips", "torso", mirror=True)
    hp.add(geo.tbox(1.10, 0.80, 0.42, tw=1.30, td=0.86), M["iron"], xf((0, 0.03, 2.02)))
    hp.add(geo.tbox(1.36, 0.90, 0.12), M["gold"], xf((0, 0.03, 2.20)))
    hp.add(geo.tbox(0.32, 0.10, 0.24, tw=0.28), M["gold"], xf((0, -0.47, 2.12)))
    hp.add(geo.prism([(0.0, 2.18), (0.06, 2.12), (0.0, 2.06), (-0.06, 2.12)], 0.03), M["glow"], xf((0, -0.525, 0)))
    hp.add(geo.tbox(0.22, 0.12, 0.36, tw=0.36), M["armor"], xf((0, -0.43, 1.88)))
    # Side tassets (kusazuri) hang outside the thighs so leg swings do not clip them.
    hp.add(geo.tbox(0.10, 0.62, 0.40, td=0.66), M["armor"], xf((0.74, 0.0, 1.92), (0, -12, 0)))
    hp.add(geo.tbox(0.09, 0.58, 0.30), M["armor"], xf((0.80, 0.0, 1.66), (0, -16, 0)))
    hp.add(geo.tbox(0.60, 0.10, 0.40, tw=0.70), M["armor"], xf((0, 0.48, 1.92), (-10, 0, 0)))


# --------------------------------------------------------------------------- arms


def _arms(r, M, detail):
    def shoulder(p):
        p.add(geo.sphere(0.30, 16, 10), M["iron"], xf((1.22, 0, 3.5)))

    def pauldron(p):
        shell_c, shell_r = (1.32, 0.0, 3.66), (0, 10, 0)
        p.add(geo.tbox(0.98, 0.98, 0.40, tw=0.78, td=0.82, dx=0.06), M["armor"], xf(shell_c, shell_r))
        p.add(geo.tbox(1.02, 1.02, 0.07), M["gold"], at(shell_c, shell_r, (0, 0, -0.19)))
        # Ōsode lames stepping down the outside of the arm.
        for c, rot, size in (
            ((1.86, 0, 3.36), (0, -14, 0), (0.10, 0.92, 0.34)),
            ((1.92, 0, 3.10), (0, -18, 0), (0.10, 0.86, 0.30)),
            ((1.96, 0, 2.88), (0, -20, 0), (0.09, 0.78, 0.24)),
        ):
            p.add(geo.tbox(size[0], size[1], size[2], td=size[1] + 0.04), M["armor"], xf(c, rot))
            p.add(geo.tbox(0.03, size[1] - 0.1, 0.035), M["glow"], at(c, rot, (size[0] / 2, 0, -size[2] / 2 + 0.04)))

    def upper_arm(p):
        p.add(geo.cyl(0.26, 0.62, 12, r_top=0.28), M["iron"], xf((1.22, 0, 3.02)))
        p.add(geo.tbox(0.20, 0.50, 0.50, td=0.46), M["armor"], xf((1.43, 0, 3.02)))
        p.add(geo.tbox(0.40, 0.10, 0.44), M["armor"], xf((1.22, -0.27, 3.02)))
        p.add(geo.torus(0.29, 0.03, 24, 6), M["gold"], xf((1.22, 0, 2.78)))

    def elbow(p):
        p.add(geo.cyl(0.22, 0.52, 14), M["iron"], xf((1.22, 0, 2.65), (0, 90, 0)))
        for x in (1.49, 0.95):
            p.add(geo.cyl(0.15, 0.06, 14), M["gold"], xf((x, 0, 2.65), (0, 90, 0)))
        p.add(geo.tbox(0.30, 0.14, 0.26, tw=0.24), M["gold"], xf((1.22, 0.28, 2.66)))

    def forearm(p):
        p.add(geo.tbox(0.50, 0.52, 0.20), M["iron"], xf((1.22, 0, 2.47)))
        p.add(geo.tbox(0.74, 0.76, 0.52, tw=0.64, td=0.66), M["armor"], xf((1.22, 0, 2.12)))
        p.add(geo.tbox(0.14, 0.60, 0.46, td=0.50), M["armor"], xf((1.62, 0, 2.14)))
        p.add(geo.tbox(0.50, 0.12, 0.40, tw=0.44), M["armor"], xf((1.22, -0.42, 2.14)))
        p.add(geo.tbox(0.80, 0.82, 0.09), M["gold"], xf((1.22, 0, 1.86)))
        p.add(geo.tbox(0.66, 0.68, 0.06), M["gold"], xf((1.22, 0, 2.40)))
        for y in (-0.12, 0.12):
            p.add(geo.tbox(0.03, 0.06, 0.40), M["glow"], xf((1.70, y, 2.14)))
        p.add(geo.tbox(0.05, 0.03, 0.34), M["glow"], xf((1.22, -0.485, 2.14)))

    def hand(p):
        p.add(geo.cyl(0.24, 0.12, 14), M["iron"], xf((1.22, 0, 1.84)))
        p.add(geo.tbox(0.62, 0.56, 0.46, tw=0.64, td=0.58), M["gold"], xf((1.22, 0.03, 1.60)))
        for i in range(4):
            x = 1.22 + (i - 1.5) * 0.15
            p.add(geo.tbox(0.14, 0.20, 0.30), M["iron"], xf((x, -0.33, 1.52)))
            p.add(geo.tbox(0.145, 0.08, 0.10), M["gold"], xf((x, -0.43, 1.58)))
        p.add(geo.tbox(0.62, 0.04, 0.045), M["glow"], xf((1.22, -0.445, 1.70)))
        p.add(geo.tbox(0.12, 0.26, 0.20), M["iron"], xf((0.86, -0.12, 1.55)))

    r.sided("Shoulder", "UpperArm", "joints", shoulder)
    r.sided("Pauldron", "UpperArm", "arms", pauldron)
    r.sided("UpperArm", "UpperArm", "arms", upper_arm)
    r.sided("Elbow", "Forearm", "joints", elbow)
    r.sided("Forearm", "Forearm", "arms", forearm)
    r.sided("Hand", "Hand", "arms", hand)


# --------------------------------------------------------------------------- legs


def _legs(r, M, detail):
    def hip_joint(p):
        p.add(geo.sphere(0.27, 16, 10), M["iron"], xf((0.42, 0, 1.86)))

    def thigh(p):
        p.add(geo.cyl(0.30, 0.66, 12, r_top=0.33), M["iron"], xf((0.42, 0, 1.42)))
        p.add(geo.tbox(0.50, 0.16, 0.52, tw=0.54), M["armor"], xf((0.42, -0.30, 1.45)))
        p.add(geo.tbox(0.14, 0.50, 0.50), M["armor"], xf((0.72, 0, 1.45)))

    def knee(p):
        p.add(geo.cyl(0.21, 0.54, 14), M["iron"], xf((0.42, 0, 1.0), (0, 90, 0)))
        p.add(geo.tbox(0.44, 0.20, 0.40, tw=0.36, td=0.14, dy=0.02), M["gold"], xf((0.42, -0.30, 1.02), (-8, 0, 0)))

    def shin(p):
        p.add(geo.tbox(0.66, 0.70, 0.72, tw=0.54, td=0.58), M["armor"], xf((0.42, 0.02, 0.52)))
        p.add(geo.tbox(0.44, 0.12, 0.62, tw=0.36, td=0.10), M["armor"], xf((0.42, -0.38, 0.56)))
        p.add(geo.tbox(0.05, 0.03, 0.48), M["glow"], xf((0.42, -0.445, 0.58)))
        p.add(geo.tbox(0.40, 0.20, 0.50), M["iron"], xf((0.42, 0.38, 0.58)))
        for z in (0.50, 0.62):
            p.add(geo.tbox(0.30, 0.03, 0.03), M["glow"], xf((0.42, 0.485, z)))
        p.add(geo.tbox(0.10, 0.50, 0.50, td=0.44), M["armor"], xf((0.77, 0.02, 0.50)))
        p.add(geo.tbox(0.58, 0.62, 0.06), M["gold"], xf((0.42, 0.02, 0.88)))

    def foot(p):
        p.add(geo.tbox(0.72, 1.10, 0.20, tw=0.68, td=1.02), M["iron"], xf((0.42, -0.14, 0.10)))
        p.add(geo.tbox(0.70, 0.36, 0.18, tw=0.60, td=0.28, dy=0.04), M["armor"], xf((0.42, -0.50, 0.29)))
        p.add(geo.tbox(0.62, 0.56, 0.22, tw=0.56, td=0.50), M["armor"], xf((0.42, 0.02, 0.30)))
        p.add(geo.tbox(0.50, 0.24, 0.24), M["iron"], xf((0.42, 0.36, 0.14)))
        p.add(geo.tbox(0.50, 0.03, 0.04), M["glow"], xf((0.42, -0.69, 0.14)))

    r.sided("HipJoint", "Thigh", "joints", hip_joint)
    r.sided("Thigh", "Thigh", "legs", thigh)
    r.sided("Knee", "Shin", "joints", knee)
    r.sided("Shin", "Shin", "legs", shin)
    r.sided("Foot", "Foot", "legs", foot)


# --------------------------------------------------------------------------- back unit


RING_C = (0.0, 0.88, 3.40)
RING_R = 1.30


def _back(r, M, detail):
    b = r.part("DrumRing", "BackUnit", "back")
    rx = (90, 0, 0)
    cx, cy, cz = RING_C
    b.add(geo.cyl(0.24, 0.20, 16), M["iron"], xf(RING_C, rx))
    b.add(geo.cyl(0.14, 0.04, 16), M["gold"], xf((cx, cy + 0.11, cz), rx))
    b.add(geo.cyl(0.08, 0.03, 16), M["glow"], xf((cx, cy + 0.13, cz), rx))
    for k in range(4):
        a = math.radians(22.5 + 90 * k)
        mid = 0.70
        b.add(geo.tbox(0.06, 0.06, 1.10), M["gold"], xf((cx + mid * math.sin(a), cy, cz + mid * math.cos(a)), (0, math.degrees(a), 0)))
    b.add(geo.torus(RING_R, 0.075, 48, 8), M["gold"], xf(RING_C, rx))
    b.add(geo.torus(1.13, 0.022, 48, 6), M["glow"], xf(RING_C, rx))
    for k in range(8):
        a = math.tau * k / 8
        dc = (cx + RING_R * math.cos(a), cy, cz + RING_R * math.sin(a))
        b.add(geo.barrel(0.19, 0.225, 0.30, 16, 4), M["armor"], xf(dc, rx))
        for side in (-1, 1):
            y = cy + side * 0.152
            b.add(geo.cyl(0.17, 0.02, 16), M["glow"], xf((dc[0], y, dc[2]), rx))
            b.add(geo.torus(0.185, 0.022, 16, 6), M["gold"], xf((dc[0], cy + side * 0.148, dc[2]), rx))
            for i in range(8):
                t = math.tau * i / 8
                b.add(
                    geo.sphere(0.016, 6, 4),
                    M["gold"],
                    xf((dc[0] + 0.212 * math.cos(t), cy + side * 0.12, dc[2] + 0.212 * math.sin(t))),
                )

    m = r.part("BackMount", "Chest", "back")
    m.add(geo.cyl(0.18, 0.16, 12), M["iron"], xf((0, 0.80, 3.40), rx))
