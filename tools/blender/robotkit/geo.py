"""
Pure-geometry primitive generators. Each returns (verts, faces) in local space;
`parts.Part.add` places them with a matrix and assigns a material.

Conventions (Blender): Z up, the robot faces -Y, robot's left = +X, 1 unit = 1 m.
Faces are wound counter-clockwise seen from outside (normals point out).
"""

import math

from mathutils import Matrix, Vector  # type: ignore

TAU = math.tau

# Hexahedron faces for corners ordered: bottom (-x-y, +x-y, +x+y, -x+y), then top in the same order.
HEX_FACES = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]


def hexa(corners):
    """Arbitrary 8-corner block (see HEX_FACES for the corner order)."""
    return [tuple(c) for c in corners], list(HEX_FACES)


def tbox(w, d, h, tw=None, td=None, dx=0.0, dy=0.0):
    """
    Block w×d×h centred on the origin. The top face can be resized (tw, td) and
    slid (dx, dy): tapered armour plates, wedges and leaning blocks all come from this.
    """
    tw = w if tw is None else tw
    td = d if td is None else td
    z0, z1 = -h / 2, h / 2
    bottom = [(-w / 2, -d / 2, z0), (w / 2, -d / 2, z0), (w / 2, d / 2, z0), (-w / 2, d / 2, z0)]
    top = [
        (-tw / 2 + dx, -td / 2 + dy, z1),
        (tw / 2 + dx, -td / 2 + dy, z1),
        (tw / 2 + dx, td / 2 + dy, z1),
        (-tw / 2 + dx, td / 2 + dy, z1),
    ]
    return hexa(bottom + top)


def lathe(profile, segments=16, cap_bottom=True, cap_top=True, phase=0.0):
    """Revolve [(radius, z), ...] (bottom→top) around Z. Radii must be > 0 where capped."""
    verts, faces = [], []
    n = len(profile)
    for r, z in profile:
        for i in range(segments):
            a = phase + TAU * i / segments
            verts.append((r * math.cos(a), r * math.sin(a), z))
    for k in range(n - 1):
        for i in range(segments):
            a = k * segments + i
            b = k * segments + (i + 1) % segments
            faces.append((a, b, b + segments, a + segments))
    if cap_bottom:
        faces.append(tuple(reversed(range(segments))))
    if cap_top:
        faces.append(tuple(range((n - 1) * segments, n * segments)))
    return verts, faces


def cyl(r, h, segments=16, r_top=None, phase=None):
    """Cylinder / truncated cone along Z, centred on the origin."""
    if phase is None:
        phase = math.pi / segments  # flat side facing the axes, reads better on blocky parts
    return lathe([(r, -h / 2), (r if r_top is None else r_top, h / 2)], segments, phase=phase)


def barrel(r_end, r_mid, h, segments=20, rings=4):
    """Taiko drum body: a barrel bulging to r_mid at its waist, along Z."""
    prof = []
    for k in range(rings + 1):
        t = k / rings
        z = -h / 2 + h * t
        r = r_end + (r_mid - r_end) * math.sin(math.pi * t)
        prof.append((r, z))
    return lathe(prof, segments)


def sphere(r, segments=16, rings=10):
    verts = [(0.0, 0.0, -r)]
    for k in range(1, rings):
        phi = -math.pi / 2 + math.pi * k / rings
        for i in range(segments):
            a = TAU * i / segments
            verts.append((r * math.cos(phi) * math.cos(a), r * math.cos(phi) * math.sin(a), r * math.sin(phi)))
    verts.append((0.0, 0.0, r))
    faces = []
    top = len(verts) - 1
    for i in range(segments):
        faces.append((0, 1 + (i + 1) % segments, 1 + i))
    for k in range(rings - 2):
        for i in range(segments):
            a = 1 + k * segments + i
            b = 1 + k * segments + (i + 1) % segments
            faces.append((a, b, b + segments, a + segments))
    base = 1 + (rings - 2) * segments
    for i in range(segments):
        faces.append((base + i, base + (i + 1) % segments, top))
    return verts, faces


def torus(R, r, segments=32, rsegments=8, arc=TAU, start=0.0, rphase=0.0):
    """Torus around Z. A partial `arc` gets flat end caps."""
    closed = abs(arc - TAU) < 1e-6
    n = segments if closed else segments + 1
    verts, faces = [], []
    for i in range(n):
        a = start + arc * i / segments
        for j in range(rsegments):
            b = rphase + TAU * j / rsegments
            rr = R + r * math.cos(b)
            verts.append((rr * math.cos(a), rr * math.sin(a), r * math.sin(b)))
    for i in range(segments):
        i2 = (i + 1) % n
        for j in range(rsegments):
            j2 = (j + 1) % rsegments
            faces.append((i * rsegments + j, i2 * rsegments + j, i2 * rsegments + j2, i * rsegments + j2))
    if not closed:
        faces.append(tuple(range(rsegments)))
        faces.append(tuple(reversed(range((n - 1) * rsegments, n * rsegments))))
    return verts, faces


def prism(points, depth):
    """Polygon [(x, z), ...] in the XZ plane, extruded along Y (front face at -depth/2)."""
    n = len(points)
    verts = [(x, -depth / 2, z) for x, z in points] + [(x, depth / 2, z) for x, z in points]
    faces = [tuple(range(n)), tuple(reversed(range(n, 2 * n)))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, n + i, n + j, j))
    return verts, faces


SQUARE = [(-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)]
DIAMOND = [(0.0, -0.5), (0.5, 0.0), (0.0, 0.5), (-0.5, 0.0)]
BLADE = [(-0.5, 0.0), (0.0, -0.18), (0.5, 0.0), (0.0, 0.18)]
OCT = [(0.5 * math.cos(a), 0.5 * math.sin(a)) for a in (math.tau * (i + 0.5) / 8 for i in range(8))]
LENS = [(-0.5, 0.0), (-0.3, -0.32), (0.0, -0.42), (0.3, -0.32), (0.5, 0.0), (0.3, 0.32), (0.0, 0.42), (-0.3, 0.32)]


def loft(path, sizes, profile=SQUARE, up=(0.0, 0.0, 1.0)):
    """
    Sweep a 2D `profile` along `path` (list of 3D points); `sizes` = [(w, h), ...] per point.
    Used for horns, fins and blades. `up` picks the profile's orientation.
    """
    pts = [Vector(p) for p in path]
    upv = Vector(up)
    m = len(profile)
    verts, faces = [], []
    for k, p in enumerate(pts):
        t = (pts[min(k + 1, len(pts) - 1)] - pts[max(k - 1, 0)]).normalized()
        side = t.cross(upv)
        if side.length < 1e-6:
            side = t.cross(Vector((0.0, 1.0, 0.0)))
        side.normalize()
        nrm = side.cross(t).normalized()
        w, h = sizes[k]
        for u, v in profile:
            q = p + side * (u * w) + nrm * (v * h)
            verts.append(tuple(q))
    for k in range(len(pts) - 1):
        for i in range(m):
            a, b = k * m + i, k * m + (i + 1) % m
            faces.append((a, b, b + m, a + m))
    faces.append(tuple(reversed(range(m))))
    faces.append(tuple(range((len(pts) - 1) * m, len(pts) * m)))
    return verts, faces


def segments_xz(points, width, depth):
    """
    Zig-zag strip (lightning bolts, circuit traces) as one block per segment in the XZ
    plane. Returns a list of (verts, faces, matrix) so the caller can place each block.
    """
    out = []
    for (x0, z0), (x1, z1) in zip(points, points[1:], strict=False):
        dx, dz = x1 - x0, z1 - z0
        length = math.hypot(dx, dz) + width  # overlap the joints
        ang = math.atan2(dx, dz)
        m = Matrix.Translation(((x0 + x1) / 2, 0.0, (z0 + z1) / 2)) @ Matrix.Rotation(ang, 4, "Y")
        v, f = tbox(width, depth, length)
        out.append((v, f, m))
    return out
