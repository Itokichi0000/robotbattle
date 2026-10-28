"""
RAIJIN 雷神 — heavy armour, block-built plates, taiko-drum reactor, amber glow.

Design brief (docs/ART_BIBLE.md + the in-game procedural stand-in):
  * wide inverted-triangle silhouette, oversized ōsode-style pauldrons, fists as big as the head
  * chest reactor shaped like a taiko drum (barrel body, studded rim, glowing drumhead)
  * armour assembled from separate blocks; the seams between blocks glow amber
  * kabuto-like box helmet, two gold horns, amber chevron visor
  * thunder-drum ring on the back: gold hoop with 8 glowing drums (spins on the BackUnit bone)
  * palette: amber #E8851A, gold #C9A040, black iron #2A2522, glow #FFB547 / core #FFD27A
  * no logos or letters of any kind (in particular no Bitcoin "B" mark)
Joint positions come from robotkit.rig.SKELETONS["raijin"]; review notes in
docs/models/RAIJIN_BASE_REVIEW.md.
"""

import math

from robotkit import geo, surface
from robotkit.parts import Robot, make_material, xf

KEY = "raijin"
PREFIX = "RJ"
TEAM_COLOR = "#F7931A"
# Atlas / bake settings used by build_robot.py for --stage detail.
ATLAS = {"size": 2048, "emissive_strength": 2.6, "keep": ()}

BEVEL_L, BEVEL_M, BEVEL_S = 0.022, 0.014, 0.008


def materials(detail):
    m = {
        "armor": make_material("RJ_Armor", "#E8851A", metallic=0.3, roughness=0.38),
        "wave": make_material("RJ_ArmorWave", "#E07C16", metallic=0.3, roughness=0.42),
        "gold": make_material("RJ_Gold", "#C9A040", metallic=0.75, roughness=0.3),
        "iron": make_material("RJ_Iron", "#2A2522", metallic=0.55, roughness=0.5),
        "glow": make_material("RJ_Glow", "#FFB547", emission="#FFB547", strength=2.0),
        "core": make_material("RJ_Core", "#FFD27A", emission="#FFD27A", strength=2.6),
    }
    if detail:
        surface.detail(m["armor"], spacing=(0.34, 0.30, 0.26), panel_darken=0.4)
        # Abstract seigaiha (青海波) waves embossed on selected panels (ART_BIBLE).
        surface.detail(m["wave"], spacing=(0.5, 0.5, 0.5), panel_darken=0.3, pattern="seigaiha", pattern_scale=1.0)
        surface.detail(m["gold"], panels=False, rough_noise=0.08)
        surface.detail(m["iron"], spacing=(0.22, 0.22, 0.18), panel_darken=0.5, rough_noise=0.18)
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
    # Kabuto-like box helmet, narrowing upward.
    h.add(geo.tbox(0.64, 0.62, 0.40, tw=0.54, td=0.52, dy=0.02), M["armor"], xf((0, -0.04, 4.25)))
    h.add(geo.tbox(0.56, 0.54, 0.06, tw=0.46, td=0.44), M["gold"], xf((0, -0.02, 4.48)))
    h.add(geo.tbox(0.08, 0.50, 0.08, tw=0.05, td=0.44), M["gold"], xf((0, 0.0, 4.54)))
    # Brow brim, high enough to leave the visor in view.
    h.add(geo.tbox(0.68, 0.15, 0.055, tw=0.64, td=0.11, dy=-0.02), M["gold"], xf((0, -0.36, 4.405)))
    # Recessed face plate and the bold amber chevron visor in front of it.
    h.add(geo.tbox(0.54, 0.10, 0.30), M["iron"], xf((0, -0.31, 4.22)))
    h.add_many(geo.segments_xz([(0.0, 4.235), (0.25, 4.315)], 0.085, 0.07), M["core"], xf((0, -0.37, 0)))
    # Mouth guard with vent slits, chin.
    h.add(geo.tbox(0.40, 0.14, 0.15, tw=0.44), M["iron"], xf((0, -0.34, 4.085)))
    for x in (0.05, 0.13):
        h.add(geo.tbox(0.025, 0.02, 0.09), M["glow"], xf((x, -0.413, 4.085)))
    h.add(geo.tbox(0.30, 0.10, 0.06, tw=0.34), M["gold"], xf((0, -0.36, 4.0)))
    # Fukigaeshi cheek guards flaring outward at the front, with gold edges.
    h.add(geo.tbox(0.06, 0.30, 0.30, td=0.22), M["armor"], xf((0.36, -0.20, 4.25), (0, 0, 22)))
    h.add(geo.tbox(0.065, 0.04, 0.30, td=0.03), M["gold"], at((0.36, -0.20, 4.25), (0, 0, 22), (0, -0.13, 0)))
    # Horns: tapered diamond-section sweep up and slightly back.
    horn = [(0.19, -0.10, 4.46), (0.30, -0.14, 4.62), (0.39, -0.13, 4.80), (0.45, -0.06, 4.97), (0.47, 0.04, 5.08)]
    sizes = [(0.13, 0.13), (0.11, 0.11), (0.085, 0.085), (0.05, 0.05), (0.012, 0.012)]
    h.add(geo.loft(horn, sizes, geo.DIAMOND, up=(0, 1, 0)), M["gold"])
    h.add(geo.tbox(0.16, 0.16, 0.08), M["iron"], xf((0.19, -0.10, 4.45)))
    # Side sensors.
    h.add(geo.cyl(0.085, 0.08, 12), M["iron"], xf((0.33, -0.02, 4.2), (0, 90, 0)))
    h.add(geo.cyl(0.05, 0.02, 12), M["glow"], xf((0.375, -0.02, 4.2), (0, 90, 0)))
    # Shikoro neck guard: two lames at the back.
    h.add(geo.tbox(0.66, 0.08, 0.14, tw=0.62), M["armor"], xf((0, 0.30, 4.13), (25, 0, 0)))
    h.add(geo.tbox(0.72, 0.08, 0.13, tw=0.68), M["armor"], xf((0, 0.35, 4.01), (30, 0, 0)))
    # Small forehead gem (a plain diamond: no letters or logos).
    h.add(geo.prism([(0.0, 4.50), (0.05, 4.445), (0.0, 4.39), (-0.05, 4.445)], 0.03), M["glow"], xf((0, -0.43, 0)))

    n = r.part("Neck", "Neck", "joints", bevel=BEVEL_S)
    n.add(geo.cyl(0.19, 0.26, 12, r_top=0.17), M["iron"], xf((0, -0.05, 3.93)))
    n.add(geo.torus(0.2, 0.025, 20, 6), M["gold"], xf((0, -0.05, 3.86)))


# --------------------------------------------------------------------------- torso


REACTOR = (0.0, -0.50, 3.28)  # taiko-drum reactor, axis along -Y (faces forward)


def _torso(r, M):
    c = r.part("Chest", "Chest", "torso", mirror=True, bevel=BEVEL_M)
    # Iron frame, wider at the shoulders (inverted trapezoid).
    c.add(geo.tbox(1.30, 0.92, 1.00, tw=1.70, td=1.02), M["iron"], xf((0, 0.04, 3.20)))
    # Gold yoke and the high collar behind the neck.
    c.add(geo.tbox(2.0, 1.05, 0.16, tw=1.80, td=0.96), M["gold"], xf((0, 0.04, 3.76)))
    c.add(geo.tbox(0.86, 0.22, 0.28, tw=0.70, td=0.16, dy=-0.03), M["armor"], xf((0, 0.40, 3.94)))
    # Pectoral blocks flanking the reactor, with lightning inlays and a glowing seam below.
    pec = (0.60, -0.44, 3.33)
    c.add(geo.tbox(0.50, 0.28, 0.58, tw=0.56, td=0.24, dx=0.03), M["armor"], xf(pec, (-5, 0, 0)))
    bolt = [(-0.10, 0.22), (0.07, 0.07), (-0.04, 0.03), (0.12, -0.20)]
    c.add_many(geo.segments_xz(bolt, 0.05, 0.03), M["glow"], at(pec, (-5, 0, 0), (0, -0.135, 0)))
    c.add(geo.tbox(0.46, 0.20, 0.03), M["glow"], xf((0.58, -0.40, 3.02)))
    c.add(geo.tbox(0.48, 0.24, 0.10, tw=0.50), M["armor"], xf((0.58, -0.40, 2.95)))
    # Upper abdomen blocks.
    c.add(geo.tbox(0.36, 0.18, 0.20, tw=0.38), M["armor"], xf((0.19, -0.42, 2.86)))
    # Flank plates with vent slits.
    c.add(geo.tbox(0.12, 0.80, 0.70, td=0.90, dx=0.05), M["wave"], xf((0.84, 0.04, 3.20)))
    for z in (3.02, 3.14, 3.26):
        c.add(geo.tbox(0.02, 0.40, 0.03), M["glow"], xf((0.92, 0.04, z)))
    # Back plate (seigaiha panel), exhaust stacks and the drum-ring mount.
    c.add(geo.tbox(1.40, 0.20, 0.86, tw=1.60, td=0.18), M["wave"], xf((0, 0.58, 3.25)))
    c.add(geo.cyl(0.10, 0.30, 12), M["iron"], xf((0.40, 0.66, 3.58)))
    c.add(geo.cyl(0.07, 0.02, 12), M["glow"], xf((0.40, 0.66, 3.735)))
    c.add(geo.tbox(0.40, 0.30, 0.40), M["iron"], xf((0, 0.74, 3.40)))
    # Taiko-drum reactor: octagonal housing, barrel body, studded gold rim, glowing drumhead.
    rx = (90, 0, 0)
    zc = REACTOR[2]
    c.add(geo.torus(0.37, 0.07, 8, 4, rphase=math.pi / 4), M["iron"], xf((0, -0.56, zc), rx, (1, 1, 1.4)))
    c.add(geo.barrel(0.27, 0.315, 0.40, 24, 4), M["armor"], xf(REACTOR, rx))
    c.add(geo.cyl(0.25, 0.03, 24), M["core"], xf((0, -0.705, zc), rx))
    c.add(geo.torus(0.27, 0.032, 24, 6), M["gold"], xf((0, -0.70, zc), rx))
    c.add(geo.torus(0.19, 0.014, 24, 4), M["gold"], xf((0, -0.725, zc), rx))
    c.add(geo.torus(0.11, 0.012, 20, 4), M["gold"], xf((0, -0.725, zc), rx))
    c.add(geo.cyl(0.045, 0.03, 12), M["gold"], xf((0, -0.73, zc), rx))
    for i in range(8):
        a = math.tau * (i + 0.5) / 8
        x, z = 0.318 * math.cos(a), 0.318 * math.sin(a)
        if x > 0:
            c.add(geo.cyl(0.032, 0.05, 8), M["gold"], xf((x, -0.64, zc + z), rx))

    s = r.part("Spine", "Spine", "torso", mirror=True, bevel=BEVEL_M)
    s.add(geo.cyl(0.46, 0.42, 12, r_top=0.52), M["iron"], xf((0, 0.04, 2.47)))
    s.add(geo.tbox(0.34, 0.16, 0.18, tw=0.36), M["armor"], xf((0.18, -0.42, 2.58)))
    s.add(geo.tbox(0.30, 0.15, 0.16, tw=0.32), M["armor"], xf((0.16, -0.40, 2.39)))
    s.add(geo.tbox(0.03, 0.12, 0.40), M["glow"], xf((0.0, -0.41, 2.49)))
    s.add(geo.tbox(0.10, 0.50, 0.36), M["armor"], xf((0.50, 0.04, 2.47)))

    hp = r.part("Hips", "Hips", "torso", mirror=True, bevel=BEVEL_M)
    hp.add(geo.tbox(1.10, 0.80, 0.42, tw=1.30, td=0.86), M["iron"], xf((0, 0.03, 2.02)))
    hp.add(geo.tbox(1.36, 0.90, 0.12), M["gold"], xf((0, 0.03, 2.20)))
    hp.add(geo.tbox(0.32, 0.10, 0.24, tw=0.28), M["gold"], xf((0, -0.47, 2.12)))
    hp.add(geo.prism([(0.0, 2.18), (0.06, 2.12), (0.0, 2.06), (-0.06, 2.12)], 0.03), M["glow"], xf((0, -0.525, 0)))
    hp.add(geo.tbox(0.22, 0.12, 0.36, tw=0.36), M["armor"], xf((0, -0.43, 1.88)))
    # Side tassets (kusazuri) hang outside the thighs so leg swings do not clip them.
    hp.add(geo.tbox(0.10, 0.62, 0.40, td=0.66), M["armor"], xf((0.74, 0.0, 1.92), (0, -12, 0)))
    hp.add(geo.tbox(0.03, 0.56, 0.03), M["glow"], at((0.74, 0.0, 1.92), (0, -12, 0), (0.05, 0, -0.16)))
    hp.add(geo.tbox(0.09, 0.58, 0.30), M["armor"], xf((0.80, 0.0, 1.66), (0, -16, 0)))
    hp.add(geo.tbox(0.60, 0.10, 0.40, tw=0.70), M["armor"], xf((0, 0.48, 1.92), (-10, 0, 0)))


# --------------------------------------------------------------------------- arms


def _arms(r, M):
    def shoulder(p):
        p.add(geo.sphere(0.30, 16, 10), M["iron"], xf((1.22, 0, 3.5)))

    def pauldron(p):
        shell_c, shell_r = (1.32, 0.0, 3.64), (0, 10, 0)
        # Two-tier block shell: a heavy base and a raised crown ridge.
        p.add(geo.tbox(1.00, 1.00, 0.34, tw=0.90, td=0.92, dx=0.03), M["armor"], xf(shell_c, shell_r))
        p.add(geo.tbox(0.70, 0.76, 0.16, tw=0.52, td=0.62, dx=0.03), M["wave"], at(shell_c, shell_r, (0.04, 0, 0.24)))
        p.add(geo.tbox(0.08, 0.80, 0.07, tw=0.05, td=0.70), M["gold"], at(shell_c, shell_r, (0.06, 0, 0.345)))
        p.add(geo.tbox(1.04, 1.04, 0.07), M["gold"], at(shell_c, shell_r, (0, 0, -0.17)))
        # Front and back cover plates so the shoulder reads as a solid block from any side.
        for y in (-0.53, 0.53):
            p.add(geo.tbox(0.80, 0.06, 0.30, tw=0.70), M["armor"], at(shell_c, shell_r, (0.02, y, -0.05)))
        p.add(geo.tbox(0.60, 0.03, 0.035), M["glow"], at(shell_c, shell_r, (0.02, -0.565, 0.0)))
        # Ōsode lames stepping down the outside of the arm, each with a glowing lower seam.
        for c, rot, size in (
            ((1.87, 0, 3.36), (0, -14, 0), (0.11, 0.94, 0.34)),
            ((1.93, 0, 3.10), (0, -18, 0), (0.10, 0.88, 0.30)),
            ((1.97, 0, 2.88), (0, -20, 0), (0.09, 0.80, 0.24)),
        ):
            p.add(geo.tbox(size[0], size[1], size[2], td=size[1] + 0.04), M["armor"], xf(c, rot))
            p.add(geo.tbox(0.03, size[1] - 0.1, 0.035), M["glow"], at(c, rot, (size[0] / 2, 0, -size[2] / 2 + 0.04)))

    def upper_arm(p):
        p.add(geo.cyl(0.26, 0.62, 12, r_top=0.28), M["iron"], xf((1.22, 0, 3.02)))
        p.add(geo.tbox(0.20, 0.50, 0.50, td=0.46), M["armor"], xf((1.43, 0, 3.02)))
        p.add(geo.tbox(0.40, 0.10, 0.44), M["armor"], xf((1.22, -0.27, 3.02)))
        p.add(geo.torus(0.29, 0.03, 20, 6), M["gold"], xf((1.22, 0, 2.78)))

    def elbow(p):
        p.add(geo.cyl(0.22, 0.52, 14), M["iron"], xf((1.22, 0, 2.65), (0, 90, 0)))
        for x in (1.49, 0.95):
            p.add(geo.cyl(0.15, 0.06, 14), M["gold"], xf((x, 0, 2.65), (0, 90, 0)))
        p.add(geo.tbox(0.30, 0.14, 0.26, tw=0.24), M["gold"], xf((1.22, 0.28, 2.66)))

    def forearm(p):
        # Gauntlet built from two stacked blocks with a glowing seam between them.
        p.add(geo.tbox(0.50, 0.52, 0.20), M["iron"], xf((1.22, 0, 2.47)))
        p.add(geo.tbox(0.66, 0.68, 0.18, tw=0.62, td=0.64), M["armor"], xf((1.22, 0, 2.30)))
        p.add(geo.tbox(0.62, 0.64, 0.04), M["glow"], xf((1.22, 0, 2.195)))
        p.add(geo.tbox(0.76, 0.78, 0.26, tw=0.68, td=0.70), M["armor"], xf((1.22, 0, 2.04)))
        p.add(geo.tbox(0.14, 0.60, 0.42, td=0.50), M["wave"], xf((1.62, 0, 2.14)))
        p.add(geo.tbox(0.50, 0.12, 0.40, tw=0.44), M["armor"], xf((1.22, -0.42, 2.14)))
        p.add(geo.tbox(0.80, 0.82, 0.09), M["gold"], xf((1.22, 0, 1.86)))
        p.add(geo.tbox(0.66, 0.68, 0.06), M["gold"], xf((1.22, 0, 2.40)))
        for y in (-0.12, 0.12):
            p.add(geo.tbox(0.03, 0.06, 0.36), M["glow"], xf((1.70, y, 2.14)))
        bolt = [(-0.04, 0.16), (0.04, 0.03), (-0.03, -0.01), (0.04, -0.15)]
        p.add_many(geo.segments_xz(bolt, 0.04, 0.03), M["glow"], xf((1.22, -0.485, 2.14)))

    def hand(p):
        # Fist as big as the head: armour back, armour fingers, gold knuckle guard, glow band.
        p.add(geo.cyl(0.24, 0.12, 14), M["iron"], xf((1.22, 0, 1.84)))
        p.add(geo.tbox(0.66, 0.60, 0.48, tw=0.68, td=0.62), M["armor"], xf((1.22, 0.03, 1.60)))
        p.add(geo.tbox(0.18, 0.50, 0.40), M["gold"], xf((1.53, 0.03, 1.60)))
        for i in range(4):
            x = 1.22 + (i - 1.5) * 0.158
            p.add(geo.tbox(0.15, 0.22, 0.30), M["armor"], xf((x, -0.34, 1.50)))
        p.add(geo.tbox(0.68, 0.12, 0.14, tw=0.66), M["gold"], xf((1.22, -0.43, 1.60)))
        p.add(geo.tbox(0.62, 0.04, 0.05), M["core"], xf((1.22, -0.495, 1.60)))
        p.add(geo.tbox(0.13, 0.28, 0.22), M["armor"], xf((0.86, -0.12, 1.55)))

    r.sided("Shoulder", "UpperArm", "joints", shoulder)
    r.sided("Pauldron", "UpperArm", "arms", pauldron, bevel=BEVEL_L)
    r.sided("UpperArm", "UpperArm", "arms", upper_arm, bevel=BEVEL_M)
    r.sided("Elbow", "Forearm", "joints", elbow, bevel=BEVEL_S)
    r.sided("Forearm", "Forearm", "arms", forearm, bevel=BEVEL_M)
    r.sided("Hand", "Hand", "arms", hand, bevel=BEVEL_M)


# --------------------------------------------------------------------------- legs


def _legs(r, M):
    def hip_joint(p):
        p.add(geo.sphere(0.27, 16, 10), M["iron"], xf((0.42, 0, 1.86)))

    def thigh(p):
        p.add(geo.cyl(0.30, 0.66, 12, r_top=0.33), M["iron"], xf((0.42, 0, 1.42)))
        p.add(geo.tbox(0.50, 0.16, 0.52, tw=0.54), M["armor"], xf((0.42, -0.30, 1.45)))
        p.add(geo.tbox(0.03, 0.03, 0.40), M["glow"], xf((0.42, -0.385, 1.45)))
        p.add(geo.tbox(0.14, 0.50, 0.50), M["wave"], xf((0.72, 0, 1.45)))

    def knee(p):
        p.add(geo.cyl(0.21, 0.54, 14), M["iron"], xf((0.42, 0, 1.0), (0, 90, 0)))
        p.add(geo.tbox(0.44, 0.20, 0.40, tw=0.36, td=0.14, dy=0.02), M["gold"], xf((0.42, -0.30, 1.02), (-8, 0, 0)))

    def shin(p):
        # Two stacked blocks (upper straight, lower flared like suneate) with a glowing seam.
        p.add(geo.tbox(0.58, 0.62, 0.32, tw=0.54, td=0.58), M["armor"], xf((0.42, 0.02, 0.71)))
        p.add(geo.tbox(0.56, 0.60, 0.04), M["glow"], xf((0.42, 0.02, 0.535)))
        p.add(geo.tbox(0.68, 0.72, 0.36, tw=0.60, td=0.64), M["armor"], xf((0.42, 0.02, 0.34)))
        p.add(geo.tbox(0.44, 0.12, 0.62, tw=0.36, td=0.10), M["armor"], xf((0.42, -0.39, 0.56)))
        p.add(geo.tbox(0.05, 0.03, 0.48), M["glow"], xf((0.42, -0.455, 0.58)))
        p.add(geo.tbox(0.40, 0.20, 0.50), M["iron"], xf((0.42, 0.38, 0.58)))
        for z in (0.50, 0.62):
            p.add(geo.tbox(0.30, 0.03, 0.03), M["glow"], xf((0.42, 0.485, z)))
        p.add(geo.tbox(0.10, 0.50, 0.50, td=0.44), M["wave"], xf((0.78, 0.02, 0.50)))
        p.add(geo.tbox(0.58, 0.62, 0.06), M["gold"], xf((0.42, 0.02, 0.88)))

    def foot(p):
        p.add(geo.tbox(0.72, 1.10, 0.20, tw=0.68, td=1.02), M["iron"], xf((0.42, -0.14, 0.10)))
        p.add(geo.tbox(0.70, 0.36, 0.18, tw=0.60, td=0.28, dy=0.04), M["armor"], xf((0.42, -0.50, 0.29)))
        p.add(geo.tbox(0.62, 0.56, 0.22, tw=0.56, td=0.50), M["armor"], xf((0.42, 0.02, 0.30)))
        p.add(geo.tbox(0.50, 0.24, 0.24), M["iron"], xf((0.42, 0.36, 0.14)))
        p.add(geo.tbox(0.72, 0.30, 0.08), M["gold"], xf((0.42, -0.56, 0.06)))
        p.add(geo.tbox(0.50, 0.03, 0.04), M["glow"], xf((0.42, -0.70, 0.15)))

    r.sided("HipJoint", "Thigh", "joints", hip_joint)
    r.sided("Thigh", "Thigh", "legs", thigh, bevel=BEVEL_M)
    r.sided("Knee", "Shin", "joints", knee, bevel=BEVEL_M)
    r.sided("Shin", "Shin", "legs", shin, bevel=BEVEL_M)
    r.sided("Foot", "Foot", "legs", foot, bevel=BEVEL_M)


# --------------------------------------------------------------------------- back unit


RING_C = (0.0, 0.88, 3.40)
RING_R = 1.30


def _back(r, M):
    b = r.part("DrumRing", "BackUnit", "back", bevel=BEVEL_S)
    rx = (90, 0, 0)
    cx, cy, cz = RING_C
    b.add(geo.cyl(0.24, 0.20, 16), M["iron"], xf(RING_C, rx))
    b.add(geo.cyl(0.14, 0.04, 16), M["gold"], xf((cx, cy + 0.11, cz), rx))
    b.add(geo.cyl(0.08, 0.03, 16), M["glow"], xf((cx, cy + 0.13, cz), rx))
    for k in range(4):
        a = math.radians(22.5 + 90 * k)
        mid = 0.70
        b.add(
            geo.tbox(0.06, 0.06, 1.10),
            M["gold"],
            xf((cx + mid * math.sin(a), cy, cz + mid * math.cos(a)), (0, math.degrees(a), 0)),
        )
    b.add(geo.torus(RING_R, 0.075, 48, 8), M["gold"], xf(RING_C, rx))
    b.add(geo.torus(1.13, 0.022, 48, 4), M["glow"], xf(RING_C, rx))
    for k in range(8):
        a = math.tau * k / 8
        dc = (cx + RING_R * math.cos(a), cy, cz + RING_R * math.sin(a))
        b.add(geo.barrel(0.19, 0.225, 0.30, 16, 3), M["armor"], xf(dc, rx))
        for side in (-1, 1):
            b.add(geo.cyl(0.17, 0.02, 16), M["glow"], xf((dc[0], cy + side * 0.152, dc[2]), rx))
            b.add(geo.torus(0.185, 0.022, 16, 4), M["gold"], xf((dc[0], cy + side * 0.148, dc[2]), rx))
            for i in range(6):
                t = math.tau * (i + 0.5) / 6
                pos = (dc[0] + 0.214 * math.cos(t), cy + side * 0.118, dc[2] + 0.214 * math.sin(t))
                b.add(geo.cyl(0.018, 0.03, 6), M["gold"], xf(pos, rx))

    m = r.part("BackMount", "Chest", "back", bevel=BEVEL_S)
    m.add(geo.cyl(0.18, 0.16, 12), M["iron"], xf((0, 0.80, 3.40), (90, 0, 0)))
