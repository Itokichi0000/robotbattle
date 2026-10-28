"""
FUJIN 風神 — streamlined armour, wind ring on the back, glowing circuit network, teal glow.

Design brief (docs/ART_BIBLE.md + the in-game procedural stand-in):
  * tall and slim, cinched waist; armour is smooth swept shells (lathe / loft), not blocks
  * back ring: a translucent fūtai (風袋, wind-bag) tube in a near-full circle with a silver
    frame, glowing inner ring and two blade wings (spins/sways on the BackUnit bone)
  * network-like circuit traces glow across the navy armour (generated pattern, baked)
  * pointed silver shoulder fins, wind blades on the forearms, pointed feet, heel boosters
  * streamlined helmet with a wrap-around teal visor and a crest flowing backward
  * palette: navy #1E3A5F, silver #B9C7D6, dark navy #0F1C2E, glow #25C8D7 / veil #7FE9F2
  * no logos or letters of any kind (in particular no Bitcoin "B" mark)
Joint positions come from robotkit.rig.SKELETONS["fujin"].
"""

import math

from robotkit import geo, surface
from robotkit.parts import Robot, make_material, xf

KEY = "fujin"
PREFIX = "FJ"
TEAM_COLOR = "#25C8D7"
TEAL = (0.018, 0.578, 0.672)  # #25C8D7 in linear RGB
# The translucent veil keeps its own blended material; everything else shares the atlas.
ATLAS = {"size": 2048, "emissive_strength": 2.8, "keep": ("FJ_WindVeil",)}

BEVEL = 0.008
SMOOTH = 50.0  # swept shells shade smooth; blade edges (≥ 90°) stay crisp


def materials(detail):
    m = {
        "armor": make_material("FJ_Armor", "#1E3A5F", metallic=0.45, roughness=0.32),
        "silver": make_material("FJ_Silver", "#B9C7D6", metallic=0.8, roughness=0.22),
        "dark": make_material("FJ_Dark", "#0F1C2E", metallic=0.6, roughness=0.45),
        "glow": make_material("FJ_Glow", "#25C8D7", emission="#25C8D7", strength=2.2),
        "core": make_material("FJ_Core", "#7FE9F2", emission="#7FE9F2", strength=2.8),
        "veil": make_material("FJ_Veil", "#7FE9F2", emission="#25C8D7", strength=0.9, alpha=0.32, roughness=0.1),
    }
    if detail:
        # Network-like circuit traces glowing across the navy shells.
        surface.detail(
            m["armor"],
            spacing=(0.55, 0.55, 0.45),
            panel_darken=0.25,
            pattern="circuit",
            pattern_scale=0.8,
            pattern_mode="emission",
            pattern_color=TEAL,
            pattern_strength=1.5,
            pattern_patches=1.4,
            bump=0.25,
        )
        surface.detail(m["silver"], spacing=(0.45, 0.45, 0.36), panel_darken=0.3, rough_noise=0.06)
        surface.detail(m["dark"], spacing=(0.25, 0.25, 0.2), panel_darken=0.4, rough_noise=0.15)
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


def edge_glow(path, offset, M, p):
    """Glowing strip along the leading edge of a blade loft (offset per point, in metres)."""
    pts = [(x + o[0], y + o[1], z + o[2]) for (x, y, z), o in zip(path, offset, strict=True)]
    p.add(geo.loft(pts, [(0.022, 0.022)] * len(pts), geo.DIAMOND), M["glow"])


# --------------------------------------------------------------------------- head


def _head(r, M):
    h = part(r, "Head", "Head", "head", mirror=True)
    # Streamlined helmet: an egg stretched backward.
    h.add(geo.sphere(0.25, 20, 12), M["silver"], xf((0, 0.02, 4.34), scale=(0.84, 1.18, 1.0)))
    h.add(geo.sphere(0.2, 16, 10), M["dark"], xf((0, -0.06, 4.27), scale=(0.95, 1.1, 0.9)))
    # Wrap-around visor following the helmet front.
    visor = [
        (-0.03, -0.302, 4.345),
        (0.08, -0.29, 4.35),
        (0.15, -0.255, 4.36),
        (0.20, -0.19, 4.375),
        (0.215, -0.12, 4.39),
    ]
    h.add(
        geo.loft(visor, [(0.035, 0.075), (0.035, 0.07), (0.035, 0.06), (0.03, 0.045), (0.02, 0.02)], geo.LENS),
        M["core"],
    )
    # Sharp chin guard.
    h.add(geo.tbox(0.18, 0.20, 0.13, tw=0.30, td=0.24, dy=0.02), M["armor"], xf((0, -0.19, 4.215)))
    # Crest flowing backward over the helmet.
    crest = [(0, -0.30, 4.44), (0, -0.16, 4.57), (0, 0.04, 4.64), (0, 0.26, 4.63), (0, 0.46, 4.56), (0, 0.62, 4.46)]
    h.add(
        geo.loft(
            crest, [(0.05, 0.10), (0.06, 0.16), (0.06, 0.18), (0.05, 0.16), (0.035, 0.11), (0.01, 0.02)], geo.DIAMOND
        ),
        M["armor"],
    )
    h.add(
        geo.loft(
            [(0, -0.29, 4.47), (0, -0.15, 4.60), (0, 0.05, 4.67), (0, 0.24, 4.665)], [(0.02, 0.02)] * 4, geo.DIAMOND
        ),
        M["glow"],
    )
    # Swept-back side fins (ear sensors).
    fin = [(0.19, -0.06, 4.36), (0.25, 0.08, 4.42), (0.29, 0.24, 4.50), (0.30, 0.36, 4.56)]
    h.add(geo.loft(fin, [(0.03, 0.12), (0.03, 0.11), (0.025, 0.07), (0.01, 0.015)], geo.DIAMOND), M["silver"])
    h.add(geo.cyl(0.06, 0.04, 12), M["glow"], xf((0.205, -0.04, 4.33), (0, 90, 0)))

    n = part(r, "Neck", "Neck", "joints")
    n.add(geo.cyl(0.12, 0.24, 12, r_top=0.10), M["dark"], xf((0, -0.02, 4.06)))
    n.add(geo.torus(0.13, 0.02, 20, 6), M["silver"], xf((0, -0.02, 3.99)))


# --------------------------------------------------------------------------- torso

# V-shaped streamlined chest (radius, z), flattened front-to-back, cinched toward the waist.
SHELL = [(0.36, 2.90), (0.52, 3.10), (0.68, 3.40), (0.76, 3.62), (0.70, 3.82), (0.50, 3.95), (0.30, 3.99)]
SHELL_DEPTH = 0.62  # y scale of the chest shell
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
    c.add(geo.lathe(SHELL, 20, phase=math.pi / 20), M["armor"], xf((0, SHELL_Y, 0), scale=(1.0, SHELL_DEPTH, 1.0)))
    # Silver upper-chest plate wrapping the front.
    wrap = [chest_front(-0.04 + 0.14 * i, 3.66 - 0.04 * i, 0.012) for i in range(6)]
    c.add(
        geo.loft(wrap, [(0.05, 0.30), (0.05, 0.30), (0.05, 0.27), (0.05, 0.22), (0.045, 0.15), (0.03, 0.06)], geo.LENS),
        M["silver"],
    )
    # Core gem with a silver frame, and glowing lines sweeping to the shoulders.
    core = [(0.0, 3.47), (0.13, 3.30), (0.0, 3.12), (-0.13, 3.30)]
    cy = chest_front(0.0, 3.30)[1]
    c.add(geo.prism(core, 0.08), M["core"], xf((0, cy - 0.03, 0)))
    frame = [(0.0, 3.53), (0.19, 3.30), (0.0, 3.06)]
    c.add_many(geo.segments_xz(frame, 0.035, 0.06), M["silver"], xf((0, cy - 0.02, 0)))
    for z0, x1, z1 in ((3.40, 0.60, 3.60), (3.22, 0.56, 3.22)):
        pts = [chest_front(0.12, z0, 0.0), chest_front(0.34, (z0 + z1) / 2 + 0.02, 0.0), chest_front(x1, z1, 0.0)]
        c.add(geo.loft(pts, [(0.035, 0.035)] * 3, geo.DIAMOND), M["glow"])
    # Collar ring and the back ridge / wind-ring mount.
    c.add(geo.torus(0.30, 0.04, 24, 6), M["silver"], xf((0, 0.0, 3.96), scale=(1.0, 0.8, 1.0)))
    c.add(geo.tbox(0.16, 0.30, 0.70, tw=0.10, td=0.22), M["dark"], xf((0, 0.38, 3.45)))
    c.add(geo.cyl(0.14, 0.20, 16), M["silver"], xf((0, 0.50, 3.77), (90, 0, 0)))

    s = part(r, "Spine", "Spine", "torso", mirror=True)
    s.add(geo.lathe([(0.34, 2.46), (0.25, 2.60), (0.27, 2.74), (0.38, 2.90)], 16), M["dark"], xf(scale=(1.0, 0.8, 1.0)))
    for z, rr in ((2.58, 0.27), (2.70, 0.29)):
        s.add(geo.torus(rr, 0.025, 24, 6), M["silver"], xf((0, 0, z), scale=(1.0, 0.8, 1.0)))

    hp = part(r, "Hips", "Hips", "torso", mirror=True)
    hp.add(
        geo.lathe([(0.30, 2.00), (0.42, 2.12), (0.44, 2.28), (0.36, 2.44)], 16), M["armor"], xf(scale=(1.0, 0.74, 1.0))
    )
    # Pointed front plate (maedare) hanging from the hip front, tip kicked slightly forward.
    top = (0, -0.31, 2.22)
    plate = [(0.0, -0.44), (0.16, -0.16), (0.13, 0.0), (-0.13, 0.0), (-0.16, -0.16)]
    hp.add(geo.prism(plate, 0.06), M["silver"], xf(top, (-6, 0, 0)))
    gem = [(0.0, -0.36), (0.05, -0.22), (0.0, -0.10), (-0.05, -0.22)]
    hp.add(geo.prism(gem, 0.03), M["glow"], xf(top, (-6, 0, 0)) @ xf((0, -0.035, 0)))
    fin = [(0.38, -0.08, 2.24), (0.50, 0.10, 2.12), (0.56, 0.32, 1.98), (0.58, 0.52, 1.86)]
    hp.add(
        geo.loft(fin, [(0.03, 0.26), (0.03, 0.24), (0.025, 0.16), (0.01, 0.03)], geo.DIAMOND, up=(1, 0, 0)), M["silver"]
    )


# --------------------------------------------------------------------------- arms


def _arms(r, M):
    X = 0.9

    def shoulder(p):
        p.add(geo.sphere(0.17, 16, 10), M["dark"], xf((X, 0, 3.72)))

    def pauldron(p):
        # Rounded shell plus the pointed silver fin sweeping up, out and back.
        p.add(geo.sphere(0.25, 20, 12), M["armor"], xf((X + 0.05, 0, 3.76), scale=(1.1, 1.05, 0.78)))
        fin = [
            (X - 0.06, -0.03, 3.86),
            (X + 0.14, 0.01, 4.04),
            (X + 0.30, 0.07, 4.24),
            (X + 0.40, 0.15, 4.40),
            (X + 0.44, 0.22, 4.50),
        ]
        sizes = [(0.50, 0.17), (0.48, 0.17), (0.36, 0.14), (0.18, 0.08), (0.02, 0.02)]
        p.add(geo.loft(fin, sizes, geo.BLADE), M["silver"])
        edge_glow(fin[:3], [(0, -0.5 * w * 0.92, 0.0) for w, _h in sizes[:3]], M, p)

    def upper_arm(p):
        p.add(geo.lathe([(0.11, 2.86), (0.15, 3.05), (0.15, 3.38), (0.12, 3.58)], 16), M["armor"], xf((X, 0, 0)))
        p.add(geo.torus(0.15, 0.022, 20, 6), M["silver"], xf((X, 0, 3.0)))

    def elbow(p):
        p.add(geo.cyl(0.11, 0.26, 14), M["dark"], xf((X, 0, 2.82), (0, 90, 0)))
        for x in (X + 0.14, X - 0.14):
            p.add(geo.cyl(0.08, 0.03, 14), M["silver"], xf((x, 0, 2.82), (0, 90, 0)))

    def forearm(p):
        p.add(geo.lathe([(0.11, 2.04), (0.15, 2.20), (0.17, 2.52), (0.14, 2.74)], 16), M["silver"], xf((X, 0, 0)))
        p.add(geo.torus(0.155, 0.02, 20, 6), M["armor"], xf((X, 0, 2.10)))
        # Wind blade along the outside of the forearm, extending past the wrist.
        blade = [(X + 0.15, 0.02, 2.74), (X + 0.24, 0.05, 2.42), (X + 0.27, 0.09, 2.08), (X + 0.22, 0.13, 1.78)]
        sizes = [(0.22, 0.16), (0.42, 0.17), (0.32, 0.14), (0.03, 0.03)]
        p.add(geo.loft(blade, sizes, geo.BLADE, up=(1, 0, 0)), M["armor"])
        edge_glow(blade[:3], [(0, -0.5 * w * 0.9, 0) for w, _h in sizes[:3]], M, p)

    def hand(p):
        p.add(geo.tbox(0.22, 0.26, 0.26, tw=0.24, td=0.26), M["dark"], xf((X, 0, 1.86)))
        p.add(geo.tbox(0.24, 0.08, 0.12), M["silver"], xf((X, -0.15, 1.80)))
        p.add(geo.tbox(0.20, 0.02, 0.03), M["glow"], xf((X, -0.195, 1.83)))
        p.add(geo.tbox(0.06, 0.12, 0.10), M["dark"], xf((X - 0.13, -0.06, 1.82)))

    sided(r, "Shoulder", "UpperArm", "joints", shoulder)
    sided(r, "Pauldron", "UpperArm", "arms", pauldron)
    sided(r, "UpperArm", "UpperArm", "arms", upper_arm)
    sided(r, "Elbow", "Forearm", "joints", elbow)
    sided(r, "Forearm", "Forearm", "arms", forearm)
    sided(r, "Hand", "Hand", "arms", hand)


# --------------------------------------------------------------------------- legs


def _legs(r, M):
    X = 0.28

    def hip_joint(p):
        p.add(geo.sphere(0.15, 16, 10), M["dark"], xf((X, 0, 2.12)))

    def thigh(p):
        p.add(
            geo.lathe([(0.15, 1.20), (0.20, 1.50), (0.22, 1.82), (0.18, 2.04)], 16),
            M["armor"],
            xf((X, 0, 0), scale=(1.0, 0.9, 1.0)),
        )
        plate = [(X + 0.16, -0.02, 1.96), (X + 0.22, 0.0, 1.70), (X + 0.19, 0.02, 1.40), (X + 0.12, 0.04, 1.22)]
        p.add(
            geo.loft(plate, [(0.26, 0.10), (0.30, 0.11), (0.24, 0.10), (0.06, 0.04)], geo.BLADE, up=(1, 0, 0)),
            M["silver"],
        )
        p.add(
            geo.loft(
                [(X, -0.20, 1.86), (X, -0.205, 1.55), (X, -0.17, 1.28)], [(0.022, 0.022)] * 3, geo.DIAMOND, up=(1, 0, 0)
            ),
            M["glow"],
        )

    def knee(p):
        p.add(geo.cyl(0.12, 0.30, 14), M["dark"], xf((X, 0, 1.12), (0, 90, 0)))
        guard = [(X, -0.10, 0.98), (X, -0.17, 1.12), (X, -0.14, 1.26), (X, -0.05, 1.36)]
        p.add(
            geo.loft(guard, [(0.20, 0.10), (0.22, 0.12), (0.16, 0.10), (0.04, 0.03)], geo.LENS, up=(0, -1, 0)),
            M["silver"],
        )

    def shin(p):
        p.add(
            geo.lathe([(0.10, 0.20), (0.15, 0.42), (0.17, 0.78), (0.14, 1.04)], 16),
            M["armor"],
            xf((X, 0, 0), scale=(1.0, 0.95, 1.0)),
        )
        fin = [(X, -0.14, 1.00), (X, -0.19, 0.74), (X, -0.17, 0.46), (X, -0.11, 0.24)]
        p.add(
            geo.loft(fin, [(0.10, 0.05), (0.14, 0.05), (0.12, 0.045), (0.04, 0.02)], geo.DIAMOND, up=(1, 0, 0)),
            M["silver"],
        )
        p.add(
            geo.loft(
                [(X + 0.14, -0.06, 0.96), (X + 0.17, -0.06, 0.66), (X + 0.14, -0.06, 0.36)],
                [(0.022, 0.022)] * 3,
                geo.DIAMOND,
                up=(0, 1, 0),
            ),
            M["glow"],
        )
        # Calf thruster pod.
        p.add(geo.lathe([(0.05, 0.40), (0.09, 0.50), (0.09, 0.78), (0.06, 0.86)], 12), M["dark"], xf((X, 0.14, 0)))

    def foot(p):
        # Pointed foot swept forward, heel booster with a glowing nozzle.
        body = [(X, 0.18, 0.11), (X, 0.0, 0.11), (X, -0.24, 0.08), (X, -0.44, 0.045), (X, -0.58, 0.02)]
        p.add(
            geo.loft(body, [(0.20, 0.20), (0.22, 0.20), (0.19, 0.14), (0.11, 0.07), (0.015, 0.015)], geo.OCT), M["dark"]
        )
        toe = [(X, -0.20, 0.13), (X, -0.38, 0.09), (X, -0.55, 0.035)]
        p.add(geo.loft(toe, [(0.17, 0.05), (0.12, 0.045), (0.02, 0.015)], geo.LENS), M["silver"])
        p.add(geo.lathe([(0.07, 0.0), (0.09, 0.08), (0.11, 0.18)], 14), M["silver"], xf((X, 0.16, 0.11), (-90, 0, 0)))
        p.add(geo.cyl(0.085, 0.02, 14), M["core"], xf((X, 0.345, 0.11), (90, 0, 0)))

    sided(r, "HipJoint", "Thigh", "joints", hip_joint)
    sided(r, "Thigh", "Thigh", "legs", thigh)
    sided(r, "Knee", "Shin", "joints", knee)
    sided(r, "Shin", "Shin", "legs", shin)
    sided(r, "Foot", "Foot", "legs", foot)


# --------------------------------------------------------------------------- back unit

RING_C = (0.0, 0.62, 3.77)
RING_R = 1.30
GAP = 60.0  # degrees left open at the bottom of the ring


def _back(r, M):
    rx = (90, 0, 0)
    cx, cy, cz = RING_C
    arc = math.radians(360 - GAP)
    start = math.radians(-90 + GAP / 2)  # ring lies in XZ after rx: angle 0 = +X, -90° = bottom

    b = part(r, "WindRing", "BackUnit", "back", mirror=True)
    b.add(geo.torus(RING_R, 0.05, 56, 6, arc=arc, start=start), M["silver"], xf(RING_C, rx))
    b.add(geo.torus(RING_R - 0.17, 0.028, 56, 6, arc=arc, start=start), M["glow"], xf(RING_C, rx))
    # Wind-bag ties (knots) along the ring.
    for k in range(7):
        a = start + arc * k / 6
        pos = (cx + RING_R * math.cos(a), cy, cz + RING_R * math.sin(a))
        if pos[0] >= -1e-6:
            b.add(geo.sphere(0.14, 14, 8), M["armor"], xf(pos, scale=(1.0, 1.4, 1.0)))
            b.add(geo.torus(0.12, 0.02, 16, 4), M["glow"], xf(pos, rx))
    # Hub and two struts up to the ring.
    b.add(geo.lathe([(0.20, -0.06), (0.16, 0.06), (0.08, 0.12)], 20), M["silver"], xf((cx, cy + 0.02, cz), (-90, 0, 0)))
    b.add(geo.cyl(0.06, 0.03, 16), M["core"], xf((cx, cy + 0.15, cz), rx))
    strut = [(0.12, cy, cz + 0.10), (0.55, cy + 0.02, cz + 0.62), (0.88, cy, cz + 0.95)]
    b.add(geo.loft(strut, [(0.06, 0.06)] * 3, geo.DIAMOND, up=(0, 1, 0)), M["dark"])
    # Two blade wings sweeping down and out, with glowing leading edges.
    wing = [
        (0.14, cy - 0.02, cz - 0.15),
        (0.52, cy + 0.04, cz - 0.55),
        (0.92, cy + 0.10, cz - 1.0),
        (1.18, cy + 0.14, cz - 1.42),
    ]
    sizes = [(0.30, 0.16), (0.44, 0.17), (0.32, 0.14), (0.03, 0.03)]
    b.add(geo.loft(wing, sizes, geo.BLADE, up=(0, 1, 0)), M["silver"])
    edge_glow(wing[:3], [(-0.42 * w, 0, -0.32 * w) for w, _h in sizes[:3]], M, b)

    # Translucent wind-bag tube: its own blended material (not baked into the atlas).
    v = part(r, "WindVeil", "BackUnit", "back", mirror=True, bevel=0.0)
    v.add(geo.torus(RING_R, 0.16, 56, 12, arc=arc, start=start), M["veil"], xf(RING_C, rx))
