"""
FUJIN 風神 — high mobility, streamlined armour, segmented wind ring, glowing node network.

Master design: docs/design/visual-bible-v01/ (02_FUJIN_Design_Sheet.png + DESIGN_RULES_FOR_BLENDER.md).
  * silhouette locks: ONE big segmented wind ring (風環) on the back, streamlined mask, long
    slender legs, wing-like parts flowing up from both shoulders; small chest
  * Lightning-Network motif: glowing nodes on the white armour joined by thin routes (an abstract
    graph, not a real topology). No logos, no ₿ mark
  * face: sharp porcelain mask with angled cyan eyes and two thin horns swept back
  * the wind ring spins on its own bone (WindRing); auxiliary back fins (BackFin_L/R);
    cloth / wind ribbons and particles are game effects, not mesh
  * palette: white porcelain #EBF1F7, dark navy metal #152534, glow cyan #5CDEFA, gold edge #C7A56C
Joint positions: robotkit.rig.SKELETONS["fujin"] (+ EXTRA_BONES for fingers, shoulder armour, ring, fins).
"""

import math

from robotkit import geo, surface
from robotkit.parts import Robot, make_material, xf

KEY = "fujin"
PREFIX = "FJ"
TEAM_COLOR = "#5CDEFA"
ATLAS = {"size": 2048, "emissive_strength": 2.8, "keep": ()}

BEVEL = 0.008
SMOOTH = 50.0  # swept shells shade smooth; blade edges (≥ 90°) stay crisp
CYAN = (0.107, 0.730, 0.956)  # #5CDEFA in linear RGB
NODE_TINT = (0.020, 0.090, 0.140)  # dark cyan-navy under the glowing routes


def materials(detail):
    m = {
        "white": make_material("FJ_Porcelain", "#EBF1F7", metallic=0.1, roughness=0.28),
        "navy": make_material("FJ_Navy", "#152534", metallic=0.6, roughness=0.40),
        "gold": make_material("FJ_GoldEdge", "#C7A56C", metallic=0.85, roughness=0.30),
        "glow": make_material("FJ_Glow", "#5CDEFA", emission="#5CDEFA", strength=2.2),
        "core": make_material("FJ_Core", "#B8F2FF", emission="#5CDEFA", strength=2.8),
    }
    if detail:
        # Glowing nodes joined by thin routes across the porcelain shells.
        surface.detail(
            m["white"],
            spacing=(0.5, 0.5, 0.42),
            panel_darken=0.12,
            pattern="nodes",
            pattern_scale=1.15,
            pattern_mode="emission",
            pattern_color=CYAN,
            pattern_strength=2.4,
            pattern_tint=NODE_TINT,
            bump=0.2,
        )
        surface.detail(m["navy"], spacing=(0.25, 0.25, 0.2), panel_darken=0.4, rough_noise=0.15)
        surface.detail(m["gold"], panels=False, rough_noise=0.06)
    return m


def build(detail=False):
    M = materials(detail)
    r = Robot(KEY, PREFIX)
    _head(r, M)
    _torso(r, M)
    _arms(r, M)
    _legs(r, M)
    _back(r, M)
    return r, M


def part(r, name, bone, group, **kw):
    kw.setdefault("bevel", BEVEL)
    kw.setdefault("smooth_angle", SMOOTH)
    return r.part(name, bone, group, **kw)


def sided(r, name, bone, group, fn, **kw):
    kw.setdefault("bevel", BEVEL)
    kw.setdefault("smooth_angle", SMOOTH)
    return r.sided(name, bone, group, fn, **kw)


def edge_glow(path, offset, M, p, mat="glow", size=0.022):
    """Thin strip along the edge of a blade loft (offset per point, in metres)."""
    pts = [(x + o[0], y + o[1], z + o[2]) for (x, y, z), o in zip(path, offset, strict=True)]
    p.add(geo.loft(pts, [(size, size)] * len(pts), geo.DIAMOND), M[mat])


# --------------------------------------------------------------------------- head


def _head(r, M):
    h = part(r, "Head", "Head", "head", mirror=True)
    # Streamlined porcelain helmet stretched backward over a navy skull.
    h.add(geo.sphere(0.24, 20, 12), M["white"], xf((0, 0.03, 4.36), scale=(0.82, 1.2, 0.95)))
    h.add(geo.sphere(0.19, 16, 10), M["navy"], xf((0, -0.05, 4.27), scale=(0.95, 1.1, 0.9)))
    # Sharp mask: a pointed porcelain faceplate with a navy slit and angled cyan eyes.
    h.add(geo.tbox(0.30, 0.16, 0.22, tw=0.10, td=0.10, dy=0.02), M["white"], xf((0, -0.21, 4.17), (180, 0, 0)))
    h.add(geo.tbox(0.30, 0.05, 0.07), M["navy"], xf((0, -0.27, 4.31)))
    h.add_many(geo.segments_xz([(0.03, 4.295), (0.14, 4.33)], 0.035, 0.03), M["core"], xf((0, -0.295, 0)))
    h.add(geo.tbox(0.05, 0.12, 0.10, tw=0.02), M["gold"], xf((0, -0.29, 4.39)))
    # Two thin horns swept back from the forehead.
    horn = [(0.07, -0.24, 4.44), (0.11, -0.13, 4.62), (0.15, 0.06, 4.78), (0.17, 0.30, 4.88), (0.16, 0.52, 4.92)]
    sizes = [(0.05, 0.07), (0.045, 0.06), (0.04, 0.05), (0.03, 0.035), (0.008, 0.01)]
    h.add(geo.loft(horn, sizes, geo.DIAMOND), M["white"])
    edge_glow(horn[:4], [(0, 0, 0.022)] * 4, M, h, size=0.014)
    # Swept-back side fins over the ears.
    fin = [(0.19, -0.04, 4.34), (0.24, 0.10, 4.40), (0.27, 0.26, 4.48), (0.27, 0.38, 4.53)]
    h.add(geo.loft(fin, [(0.03, 0.10), (0.03, 0.10), (0.025, 0.06), (0.01, 0.015)], geo.DIAMOND), M["white"])
    h.add(geo.cyl(0.055, 0.04, 12), M["glow"], xf((0.195, -0.03, 4.32), (0, 90, 0)))

    n = part(r, "Neck", "Neck", "joints")
    n.add(geo.cyl(0.11, 0.24, 12, r_top=0.09), M["navy"], xf((0, -0.02, 4.06)))
    n.add(geo.torus(0.12, 0.018, 20, 6), M["gold"], xf((0, -0.02, 3.99)))


# --------------------------------------------------------------------------- torso

# Small streamlined chest (radius, z), flattened front-to-back, cinched toward the waist.
SHELL = [(0.32, 2.92), (0.46, 3.12), (0.60, 3.42), (0.66, 3.62), (0.60, 3.82), (0.42, 3.95), (0.26, 3.99)]
SHELL_DEPTH = 0.64
SHELL_Y = 0.02


def chest_front(x, z, lift=0.0):
    """Point on the front of the chest shell at (x, z), pushed out by `lift` metres."""
    for (r0, z0), (r1, z1) in zip(SHELL, SHELL[1:], strict=False):
        if z0 <= z <= z1:
            rad = r0 + (r1 - r0) * (z - z0) / (z1 - z0)
            break
    else:
        rad = SHELL[-1][0]
    y = -SHELL_DEPTH * math.sqrt(max(rad * rad - x * x, 0.0)) + SHELL_Y
    return (x, y - lift, z)


def _torso(r, M):
    c = part(r, "Chest", "Chest", "torso", mirror=True)
    # Navy inner frame with a porcelain breastplate over the front.
    c.add(geo.lathe(SHELL, 20, phase=math.pi / 20), M["navy"], xf((0, SHELL_Y, 0), scale=(1.0, SHELL_DEPTH, 1.0)))
    plate = [chest_front(-0.04 + 0.11 * i, 3.70 - 0.05 * i, 0.01) for i in range(6)]
    c.add(
        geo.loft(
            plate, [(0.05, 0.46), (0.05, 0.46), (0.05, 0.42), (0.05, 0.34), (0.045, 0.24), (0.03, 0.10)], geo.LENS
        ),
        M["white"],
    )
    gold = [chest_front(-0.04 + 0.11 * i, 3.70 - 0.05 * i + 0.24 - 0.03 * i, 0.03) for i in range(5)]
    c.add(geo.loft(gold, [(0.022, 0.022)] * 5, geo.DIAMOND), M["gold"])
    # Abdomen porcelain plates below the breastplate.
    for z, w in ((3.16, 0.44), (3.02, 0.36)):
        c.add(
            geo.loft([chest_front(-0.03, z, 0.0), chest_front(w / 2, z - 0.02, 0.0)], [(0.04, 0.10)] * 2, geo.LENS),
            M["white"],
        )
    # Core node with a gold frame; glowing routes run from it to the shoulders.
    cy = chest_front(0.0, 3.34)[1]
    c.add(geo.cyl(0.075, 0.05, 16), M["core"], xf((0, cy - 0.04, 3.34), (90, 0, 0)))
    c.add(geo.torus(0.09, 0.018, 20, 6), M["gold"], xf((0, cy - 0.05, 3.34), (90, 0, 0)))
    for z0, x1, z1 in ((3.40, 0.52, 3.66), (3.28, 0.50, 3.30)):
        pts = [chest_front(0.10, z0, 0.04), chest_front(0.30, (z0 + z1) / 2 + 0.02, 0.04), chest_front(x1, z1, 0.02)]
        c.add(geo.loft(pts, [(0.03, 0.03)] * 3, geo.DIAMOND), M["glow"])
        c.add(geo.sphere(0.035, 10, 6), M["core"], xf(pts[-1]))
    # Collar, back ridge and the wind-ring mount.
    c.add(geo.torus(0.26, 0.035, 24, 6), M["gold"], xf((0, 0.0, 3.96), scale=(1.0, 0.8, 1.0)))
    c.add(geo.tbox(0.16, 0.30, 0.70, tw=0.10, td=0.22), M["navy"], xf((0, 0.36, 3.45)))
    c.add(geo.cyl(0.16, 0.22, 16), M["navy"], xf((0, 0.50, 3.45), (90, 0, 0)))
    c.add(geo.torus(0.16, 0.02, 20, 6), M["gold"], xf((0, 0.61, 3.45), (90, 0, 0)))

    s = part(r, "Spine", "Spine", "torso", mirror=True)
    s.add(geo.lathe([(0.32, 2.46), (0.22, 2.60), (0.24, 2.74), (0.34, 2.92)], 16), M["navy"], xf(scale=(1.0, 0.8, 1.0)))
    for z, rr in ((2.58, 0.24), (2.70, 0.26)):
        s.add(geo.torus(rr, 0.022, 24, 6), M["gold"], xf((0, 0, z), scale=(1.0, 0.8, 1.0)))

    hp = part(r, "Hips", "Hips", "torso", mirror=True)
    hp.add(
        geo.lathe([(0.28, 2.00), (0.40, 2.12), (0.42, 2.28), (0.34, 2.44)], 16), M["white"], xf(scale=(1.0, 0.74, 1.0))
    )
    hp.add(geo.torus(0.40, 0.022, 24, 6), M["gold"], xf((0, 0, 2.30), scale=(1.0, 0.74, 1.0)))
    top = (0, -0.30, 2.22)
    plate = [(0.0, -0.40), (0.14, -0.14), (0.12, 0.0), (-0.12, 0.0), (-0.14, -0.14)]
    hp.add(geo.prism(plate, 0.05), M["navy"], xf(top, (-6, 0, 0)))
    gem = [(0.0, -0.33), (0.045, -0.20), (0.0, -0.09), (-0.045, -0.20)]
    hp.add(geo.prism(gem, 0.03), M["glow"], xf(top, (-6, 0, 0)) @ xf((0, -0.03, 0)))
    fin = [(0.36, -0.08, 2.24), (0.48, 0.10, 2.12), (0.54, 0.32, 1.98), (0.56, 0.52, 1.86)]
    hp.add(
        geo.loft(fin, [(0.03, 0.24), (0.03, 0.22), (0.025, 0.15), (0.01, 0.03)], geo.DIAMOND, up=(1, 0, 0)), M["white"]
    )


# --------------------------------------------------------------------------- arms

FINGERS = ("Index", "Middle", "Ring", "Pinky")


def _arms(r, M):
    X = 0.9

    def shoulder(p):
        p.add(geo.sphere(0.16, 16, 10), M["navy"], xf((X, 0, 3.72)))

    def pauldron(p):
        # Rounded porcelain shell + a crescent wing flowing up beside the head (翼状パーツ).
        # Angular (faceted) shell rather than a round dome: reads as a sharp porcelain plate.
        p.add(geo.sphere(0.25, 8, 6), M["white"], xf((X + 0.06, 0, 3.80), (0, 0, 22.5), (1.0, 1.15, 0.55)))
        p.add(
            geo.torus(0.235, 0.018, 8, 4, rphase=math.pi / 4),
            M["gold"],
            xf((X + 0.06, 0, 3.74), (0, 0, 22.5), (1.0, 1.15, 1.0)),
        )
        wing = [
            (X - 0.02, 0.02, 3.90),
            (X + 0.18, 0.10, 4.16),
            (X + 0.30, 0.24, 4.44),
            (X + 0.28, 0.40, 4.70),
            (X + 0.18, 0.54, 4.86),
        ]
        sizes = [(0.30, 0.13), (0.34, 0.14), (0.28, 0.12), (0.18, 0.09), (0.02, 0.02)]
        p.add(geo.loft(wing, sizes, geo.BLADE, up=(1, 0, 0)), M["white"])
        edge_glow(wing[:4], [(0, -0.42 * w, 0) for w, _h in sizes[:4]], M, p)
        edge_glow(wing[:4], [(0, 0.42 * w, 0) for w, _h in sizes[:4]], M, p, mat="gold", size=0.018)

    def upper_arm(p):
        p.add(geo.lathe([(0.10, 2.86), (0.13, 3.05), (0.13, 3.38), (0.11, 3.58)], 16), M["white"], xf((X, 0, 0)))
        p.add(geo.cyl(0.09, 0.80, 12), M["navy"], xf((X, 0, 3.22)))
        p.add(geo.torus(0.135, 0.018, 20, 6), M["gold"], xf((X, 0, 2.98)))

    def elbow(p):
        p.add(geo.cyl(0.10, 0.24, 14), M["navy"], xf((X, 0, 2.82), (0, 90, 0)))
        for x in (X + 0.13, X - 0.13):
            p.add(geo.cyl(0.07, 0.03, 14), M["gold"], xf((x, 0, 2.82), (0, 90, 0)))

    def forearm(p):
        p.add(geo.lathe([(0.10, 2.06), (0.14, 2.22), (0.15, 2.52), (0.12, 2.74)], 16), M["white"], xf((X, 0, 0)))
        p.add(geo.torus(0.14, 0.018, 20, 6), M["gold"], xf((X, 0, 2.10)))
        # Wind blade along the outside of the forearm, extending past the wrist.
        blade = [(X + 0.14, 0.02, 2.74), (X + 0.22, 0.05, 2.42), (X + 0.25, 0.09, 2.08), (X + 0.20, 0.13, 1.80)]
        sizes = [(0.20, 0.15), (0.38, 0.16), (0.30, 0.13), (0.03, 0.03)]
        p.add(geo.loft(blade, sizes, geo.BLADE, up=(1, 0, 0)), M["white"])
        edge_glow(blade[:3], [(0, -0.45 * w, 0) for w, _h in sizes[:3]], M, p)

    def hand(p):
        # Slender navy hand with clawed fingers, each finger on its own bone.
        p.add(geo.tbox(0.18, 0.20, 0.20, tw=0.20, td=0.22), M["navy"], xf((X, 0, 1.88)))
        p.add(geo.tbox(0.20, 0.06, 0.10), M["white"], xf((X, -0.11, 1.90)))
        for i, name in enumerate(FINGERS):
            x = X + (i - 1.5) * 0.055
            b = f"{name}_L"
            claw = [(x, -0.04, 1.79), (x, -0.07, 1.68), (x, -0.06, 1.58)]
            p.add(
                geo.loft(claw, [(0.035, 0.035), (0.03, 0.03), (0.006, 0.006)], geo.DIAMOND, up=(1, 0, 0)),
                M["navy"],
                bone=b,
            )
            p.add(geo.sphere(0.022, 8, 5), M["gold"], xf((x, -0.05, 1.74)), bone=b)
        thumb = [(0.82, -0.06, 1.88), (0.80, -0.12, 1.80), (0.80, -0.16, 1.74)]
        p.add(
            geo.loft(thumb, [(0.035, 0.035), (0.03, 0.03), (0.006, 0.006)], geo.DIAMOND, up=(1, 0, 0)),
            M["navy"],
            bone="Thumb_L",
        )

    sided(r, "Shoulder", "UpperArm", "joints", shoulder)
    sided(r, "Pauldron", "ShoulderArmor", "arms", pauldron)
    sided(r, "UpperArm", "UpperArm", "arms", upper_arm)
    sided(r, "Elbow", "Forearm", "joints", elbow)
    sided(r, "Forearm", "Forearm", "arms", forearm)
    sided(r, "Hand", "Hand", "arms", hand)


# --------------------------------------------------------------------------- legs


def _legs(r, M):
    X = 0.28

    def hip_joint(p):
        p.add(geo.sphere(0.14, 16, 10), M["navy"], xf((X, 0, 2.12)))

    def thigh(p):
        p.add(
            geo.lathe([(0.14, 1.20), (0.19, 1.50), (0.21, 1.82), (0.17, 2.04)], 16),
            M["white"],
            xf((X, 0, 0), scale=(1.0, 0.9, 1.0)),
        )
        p.add(geo.torus(0.155, 0.018, 20, 6), M["gold"], xf((X, 0, 1.24), scale=(1.0, 0.9, 1.0)))
        plate = [(X + 0.15, -0.02, 1.96), (X + 0.21, 0.0, 1.70), (X + 0.18, 0.02, 1.40), (X + 0.11, 0.04, 1.22)]
        p.add(
            geo.loft(plate, [(0.24, 0.10), (0.28, 0.11), (0.22, 0.10), (0.06, 0.04)], geo.BLADE, up=(1, 0, 0)),
            M["navy"],
        )
        # Cyan flow channel down the front of the thigh (FLOW CHANNELS on the sheet).
        chan = [(X + 0.02, -0.19, 1.96), (X + 0.03, -0.205, 1.62), (X + 0.02, -0.17, 1.30)]
        p.add(geo.loft(chan, [(0.024, 0.024)] * 3, geo.DIAMOND, up=(1, 0, 0)), M["glow"])

    def knee(p):
        p.add(geo.cyl(0.11, 0.28, 14), M["navy"], xf((X, 0, 1.12), (0, 90, 0)))
        guard = [(X, -0.10, 0.98), (X, -0.16, 1.12), (X, -0.13, 1.26), (X, -0.05, 1.36)]
        p.add(
            geo.loft(guard, [(0.18, 0.09), (0.20, 0.11), (0.15, 0.09), (0.04, 0.03)], geo.LENS, up=(0, -1, 0)),
            M["gold"],
        )

    def shin(p):
        # Long slender porcelain shin, front ridge, calf thruster with glowing nozzles.
        p.add(
            geo.lathe([(0.09, 0.20), (0.14, 0.42), (0.16, 0.78), (0.13, 1.04)], 16),
            M["white"],
            xf((X, 0, 0), scale=(1.0, 0.95, 1.0)),
        )
        ridge = [(X, -0.13, 1.00), (X, -0.18, 0.74), (X, -0.16, 0.46), (X, -0.10, 0.24)]
        p.add(
            geo.loft(ridge, [(0.10, 0.05), (0.14, 0.05), (0.12, 0.045), (0.04, 0.02)], geo.DIAMOND, up=(1, 0, 0)),
            M["white"],
        )
        p.add(geo.lathe([(0.05, 0.40), (0.09, 0.50), (0.09, 0.82), (0.06, 0.90)], 12), M["navy"], xf((X, 0.15, 0)))
        for dz in (0.0, 0.16):
            p.add(geo.cyl(0.035, 0.03, 12), M["core"], xf((X, 0.24, 0.56 + dz), (90, 0, 0)))
        p.add(geo.torus(0.135, 0.016, 20, 6), M["gold"], xf((X, 0, 0.98), scale=(1.0, 0.95, 1.0)))
        chan = [(X + 0.13, -0.07, 0.96), (X + 0.165, -0.06, 0.66), (X + 0.13, -0.05, 0.34)]
        p.add(geo.loft(chan, [(0.022, 0.022)] * 3, geo.DIAMOND, up=(0, 1, 0)), M["glow"])

    def foot(p):
        # Pointed foot swept forward, heel booster with a glowing nozzle.
        body = [(X, 0.18, 0.11), (X, 0.0, 0.11), (X, -0.24, 0.08), (X, -0.44, 0.045), (X, -0.58, 0.02)]
        p.add(
            geo.loft(body, [(0.20, 0.20), (0.22, 0.20), (0.19, 0.14), (0.11, 0.07), (0.015, 0.015)], geo.OCT), M["navy"]
        )
        toe = [(X, -0.20, 0.13), (X, -0.38, 0.09), (X, -0.55, 0.035)]
        p.add(geo.loft(toe, [(0.17, 0.05), (0.12, 0.045), (0.02, 0.015)], geo.LENS), M["white"])
        p.add(geo.lathe([(0.07, 0.0), (0.09, 0.08), (0.11, 0.18)], 14), M["gold"], xf((X, 0.16, 0.11), (-90, 0, 0)))
        p.add(geo.cyl(0.085, 0.02, 14), M["core"], xf((X, 0.345, 0.11), (90, 0, 0)))

    sided(r, "HipJoint", "Thigh", "joints", hip_joint)
    sided(r, "Thigh", "Thigh", "legs", thigh)
    sided(r, "Knee", "Shin", "joints", knee)
    sided(r, "Shin", "Shin", "legs", shin)
    sided(r, "Foot", "Foot", "legs", foot)


# --------------------------------------------------------------------------- back: wind ring + fins

RING_C = (0.0, 0.62, 3.25)  # = WindRing bone head; the bone points back along the ring axis
RING_R = 1.62
SEGMENTS = 12
GAP_DEG = 7.0


def _arc(a0, a1, n, radius, y):
    cx, cy, cz = RING_C
    return [
        (cx + radius * math.cos(a0 + (a1 - a0) * i / n), cy + y, cz + radius * math.sin(a0 + (a1 - a0) * i / n))
        for i in range(n + 1)
    ]


def _back(r, M):
    # One segmented wind ring (分割風環) on its own bone: porcelain tiles with gold edges,
    # glowing nodes on each tile and navy couplings in the gaps.
    w = part(r, "WindRing", "WindRing", "back", mirror=True, bevel=0.0)
    step = math.tau / SEGMENTS
    gap = math.radians(GAP_DEG)
    for k in range(SEGMENTS):
        a0, a1 = -math.pi / 2 + k * step + gap / 2, -math.pi / 2 + (k + 1) * step - gap / 2
        mid = (a0 + a1) / 2
        if math.cos(mid) < -1e-6:  # model the +X half; the Mirror modifier makes the rest
            continue
        tile = _arc(a0, a1, 6, RING_R, 0.0)
        w.add(geo.loft(tile, [(0.24, 0.12)] * len(tile), geo.SQUARE, up=(0, 1, 0)), M["white"])
        for rr in (RING_R - 0.125, RING_R + 0.125):
            edge = _arc(a0, a1, 6, rr, -0.04)
            w.add(geo.loft(edge, [(0.025, 0.05)] * len(edge), geo.SQUARE, up=(0, 1, 0)), M["gold"])
        for t in (0.3, 0.7):
            a = a0 + (a1 - a0) * t
            pos = (RING_C[0] + RING_R * math.cos(a), RING_C[1] - 0.065, RING_C[2] + RING_R * math.sin(a))
            w.add(geo.cyl(0.035, 0.02, 12), M["core"], xf(pos, (90, 0, 0)))
    for j in range(SEGMENTS):  # navy couplings in the gaps (top and bottom gaps sit on the mirror plane)
        ca = -math.pi / 2 + j * step
        if math.cos(ca) > -1e-6:
            cpos = (RING_C[0] + RING_R * math.cos(ca), RING_C[1], RING_C[2] + RING_R * math.sin(ca))
            w.add(geo.tbox(0.10, 0.10, 0.16), M["navy"], xf(cpos, (0, -math.degrees(ca), 0)))
    w.add(geo.torus(RING_R - 0.30, 0.016, 64, 4), M["glow"], xf(RING_C, (90, 0, 0)))

    # Hub (static on BackUnit) and struts up to the ring.
    hub = part(r, "BackHub", "BackUnit", "back", mirror=True)
    cx, cy, cz = RING_C
    hub.add(
        geo.lathe([(0.20, -0.06), (0.16, 0.06), (0.08, 0.12)], 20),
        M["white"],
        xf((cx, cy - 0.02, cz + 0.20), (-90, 0, 0)),
    )
    hub.add(geo.cyl(0.06, 0.03, 16), M["core"], xf((cx, cy + 0.11, cz + 0.20), (90, 0, 0)))
    strut = [(0.10, cy + 0.02, cz + 0.30), (0.62, cy + 0.04, cz + 0.85), (1.05, cy, cz + 1.15)]
    hub.add(geo.loft(strut, [(0.06, 0.06)] * 3, geo.DIAMOND, up=(0, 1, 0)), M["navy"])

    def fin(p):
        # Auxiliary blade fin sweeping down and out from the upper back.
        path = [(0.14, 0.58, 3.62), (0.32, 0.66, 3.40), (0.52, 0.76, 3.12), (0.66, 0.84, 2.86)]
        sizes = [(0.22, 0.12), (0.30, 0.13), (0.22, 0.11), (0.02, 0.02)]
        p.add(geo.loft(path, sizes, geo.BLADE, up=(0, 1, 0)), M["white"])
        edge_glow(path[:3], [(-0.4 * w_, 0, -0.3 * w_) for w_, _h in sizes[:3]], M, p)

    sided(r, "BackFin", "BackFin", "back", fin)
