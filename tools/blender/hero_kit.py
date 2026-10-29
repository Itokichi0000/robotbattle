"""
Hard-surface kit for the hero assets (D-073): bmesh builders for chamfered
blocks, extruded armour plates, cylinders, swept tubes (horns, cables, rings),
vents, bolts and stencils, plus procedural paint materials made to be baked.

Every builder works in the current frame (`Kit.frame`) so a sub-assembly can
be modelled around its own hinge and then tilted as one. Pieces carry the
bone they ride on; `hero_assets.py` joins, unwraps, bakes and splits them.

Conventions follow generate_assets.py: Blender Z up, -Y is the model's front,
the robot's left is +X. Sizes are full extents in metres.
"""

import math
import random
from contextlib import contextmanager

import bmesh  # type: ignore
import bpy  # type: ignore
from mathutils import Euler, Matrix, Vector  # type: ignore

BW = "bevel_weight_edge"
SHARP_ANGLE = math.radians(32)


def _axis(c):
    return {"X": Vector((1, 0, 0)), "Y": Vector((0, 1, 0)), "Z": Vector((0, 0, 1))}[c]


def _rot(rot):
    return Euler([math.radians(r) for r in rot], "XYZ").to_matrix().to_4x4()


def spline(ctrl, n):
    """Catmull-Rom through the control points, n samples (ends included)."""
    pts = [Vector(p) for p in ctrl]
    ext = [pts[0] * 2 - pts[1], *pts, pts[-1] * 2 - pts[-2]]
    out = []
    segs = len(pts) - 1
    for i in range(n):
        t = i / (n - 1) * segs
        k = min(int(t), segs - 1)
        u = t - k
        p0, p1, p2, p3 = ext[k], ext[k + 1], ext[k + 2], ext[k + 3]
        out.append(
            0.5
            * (
                2 * p1
                + (-p0 + p2) * u
                + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u
                + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u
            )
        )
    return out


class Kit:
    def __init__(self, prefix):
        self.prefix = prefix
        self.pieces = []  # baked surface, each with ["bone"]
        self.glow = []  # emissive parts, never baked
        self.stack = [Matrix.Identity(4)]
        self.n = 0

    # -- frames ---------------------------------------------------------
    @contextmanager
    def frame(self, loc=(0, 0, 0), rot=(0, 0, 0)):
        self.stack.append(self.stack[-1] @ Matrix.Translation(loc) @ _rot(rot))
        try:
            yield
        finally:
            self.stack.pop()

    def world(self, p):
        return self.stack[-1] @ Vector(p)

    # -- object plumbing ------------------------------------------------
    def _name(self, name):
        self.n += 1
        return f"{self.prefix}_{name}_{self.n:03d}"

    def _finish(self, name, bm, mat, bone, bevel, seg=2, keep=None):
        """Weights the kept edges for the bevel modifier, marks hard edges sharp,
        applies the frame and links the object."""
        bw = bm.edges.layers.float.get(BW) or bm.edges.layers.float.new(BW)
        for e in bm.edges:
            e[bw] = 0.0
        for e in keep if keep is not None else bm.edges:
            if e.is_valid:
                e[bw] = 1.0
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        for f in bm.faces:
            f.smooth = True
        for e in bm.edges:
            if len(e.link_faces) == 2 and e.calc_face_angle(0) > SHARP_ANGLE:
                e.smooth = False
        bmesh.ops.transform(bm, matrix=self.stack[-1], verts=bm.verts)
        me = bpy.data.meshes.new(self._name(name))
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(me.name, me)
        bpy.context.scene.collection.objects.link(ob)
        me.materials.append(mat)
        if bevel > 0:
            mod = ob.modifiers.new("Bevel", "BEVEL")
            mod.width = bevel
            mod.segments = seg
            mod.limit_method = "WEIGHT"
            mod.harden_normals = True
            mod.miter_outer = "MITER_ARC"
            mod.use_clamp_overlap = True
        ob["bone"] = bone
        (self.glow if mat.get("glow") else self.pieces).append(ob)
        return ob

    # -- detail passes on a bmesh ----------------------------------------
    @staticmethod
    def _face_frame(f):
        """Centre, in-plane axes (along the longest edge and across) and half extents."""
        c = f.calc_center_median()
        e = max(f.edges, key=lambda e: e.calc_length())
        t = (e.verts[1].co - e.verts[0].co).normalized()
        b = f.normal.cross(t).normalized()
        ht = max(abs((v.co - c).dot(t)) for v in f.verts)
        hb = max(abs((v.co - c).dot(b)) for v in f.verts)
        return c, t, b, ht, hb

    @staticmethod
    def _ring(bm, f, frame, prev, amount):
        """Insets f by `amount` from its original border. An edge-offset inset
        folds over once it is wider than a short chamfer edge; scaling each
        in-plane axis toward the centre cannot."""
        c, t, b, ht, hb = frame
        bmesh.ops.inset_individual(bm, faces=[f], thickness=0.0, depth=0)
        st, sb = 1 - amount / ht, 1 - amount / hb
        pt, pb = 1 - prev / ht, 1 - prev / hb
        for v in f.verts:
            d = v.co - c
            v.co = c + t * (d.dot(t) * st / pt) + b * (d.dot(b) * sb / pb) + f.normal * d.dot(f.normal)

    @staticmethod
    def _seams(bm, min_area, inset, width=0.009, depth=0.007, dirs=None):
        """V-groove panel lines `inset` in from the border of every big face."""
        faces = [f for f in bm.faces if f.calc_area() > min_area]
        if dirs:
            faces = [f for f in faces if any(f.normal.dot(_axis(d[-1]) * (-1 if d[0] == "-" else 1)) > 0.8 for d in dirs)]
        for f in faces:
            frame = Kit._face_frame(f)
            if min(frame[3], frame[4]) < inset + 2 * width + 0.03:
                continue
            n = f.normal.copy()
            Kit._ring(bm, f, frame, 0.0, inset)
            Kit._ring(bm, f, frame, inset, inset + width)
            mid = list(f.verts)
            Kit._ring(bm, f, frame, inset + width, inset + 2 * width)
            for v in mid:
                v.co -= n * depth

    @staticmethod
    def _recess(bm, faces, inset, depth):
        for f in faces:
            frame = Kit._face_frame(f)
            if min(frame[3], frame[4]) <= inset + 0.01:
                continue
            n = f.normal.copy()
            Kit._ring(bm, f, frame, 0.0, inset)
            for v in f.verts:
                v.co -= n * depth

    # -- builders ---------------------------------------------------------
    def block(self, name, bone, mat, c, s, taper=(1, 1), bot=(1, 1), shift=(0, 0), chamfer=0.0, cax="Z",
              rot=(0, 0, 0), bevel=0.012, seams=0.0, seam_dirs=None, recess=None, seg=2):
        """A box (full size s) with a scaled/shifted top and bottom, optional
        chamfers on the edges along `cax`, panel seams and a recessed face."""
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            v.co.x *= s[0]
            v.co.y *= s[1]
            v.co.z *= s[2]
            if v.co.z > 0:
                v.co.x = v.co.x * taper[0] + shift[0]
                v.co.y = v.co.y * taper[1] + shift[1]
            else:
                v.co.x *= bot[0]
                v.co.y *= bot[1]
        if chamfer > 0:
            for ax in cax:
                a = _axis(ax)
                edges = [e for e in bm.edges if abs((e.verts[1].co - e.verts[0].co).normalized().dot(a)) > 0.6]
                bmesh.ops.bevel(bm, geom=edges, offset=chamfer, segments=1, affect="EDGES", profile=0.5,
                                clamp_overlap=True)
        bm.normal_update()
        keep = list(bm.edges)
        if recess:
            d, inset, depth = recess
            want = _axis(d[-1]) * (-1 if d[0] == "-" else 1)
            Kit._recess(bm, [f for f in bm.faces if f.normal.dot(want) > 0.8], inset, depth)
        if seams:
            Kit._seams(bm, seams * seams * 6, seams, dirs=seam_dirs)
        bmesh.ops.transform(bm, matrix=Matrix.Translation(c) @ _rot(rot), verts=bm.verts)
        return self._finish(name, bm, mat, bone, bevel, seg, keep)

    def prism(self, name, bone, mat, prof, depth, c, n=(0, -1, 0), up=(0, 0, 1), front=0.9, rot=(0, 0, 0),
              bevel=0.012, seams=0.0, seg=2):
        """An armour plate: 2D outline `prof` (u right, v up as seen from the
        outside) extruded `depth` along -n, the outer face shrunk by `front`."""
        n, up = Vector(n).normalized(), Vector(up).normalized()
        u = up.cross(n)
        cu = sum((p[0] for p in prof), 0.0) / len(prof)
        cv = sum((p[1] for p in prof), 0.0) / len(prof)
        bm = bmesh.new()
        outer, inner = [], []
        for pu, pv in prof:
            inner.append(bm.verts.new(u * pu + up * pv - n * depth / 2))
            fu, fv = cu + (pu - cu) * front, cv + (pv - cv) * front
            outer.append(bm.verts.new(u * fu + up * fv + n * depth / 2))
        k = len(prof)
        bm.faces.new(outer)
        bm.faces.new(list(reversed(inner)))
        for i in range(k):
            j = (i + 1) % k
            bm.faces.new((inner[i], inner[j], outer[j], outer[i]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.normal_update()
        keep = list(bm.edges)
        if seams:
            Kit._seams(bm, seams * seams * 6, seams)
        bmesh.ops.transform(bm, matrix=Matrix.Translation(c) @ _rot(rot), verts=bm.verts)
        return self._finish(name, bm, mat, bone, bevel, seg, keep)

    def cyl(self, name, bone, mat, a, b, r, r2=None, seg=20, bevel=0.01, caps=True):
        """A cylinder (or cone section) from point a to point b."""
        a, b = Vector(a), Vector(b)
        d = b - a
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=seg, radius1=r,
                              radius2=r if r2 is None else r2, depth=d.length)
        q = Vector((0, 0, 1)).rotation_difference(d.normalized())
        bm.normal_update()
        half = d.length / 2 - 1e-5
        keep = [e for e in bm.edges if all(abs(v.co.z) >= half for v in e.verts)]
        bmesh.ops.transform(bm, matrix=Matrix.Translation((a + b) / 2) @ q.to_matrix().to_4x4(), verts=bm.verts)
        return self._finish(name, bm, mat, bone, bevel, 2, keep)

    def sweep(self, name, bone, mat, pts, radii, sides=8, closed=False, cap=True, flat=1.0):
        """A tube along a polyline; radius per point (0 at the end makes a tip)."""
        pts = [Vector(p) for p in pts]
        n = len(pts)
        tangents = []
        for i in range(n):
            if closed:
                t = pts[(i + 1) % n] - pts[i - 1]
            else:
                t = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
            tangents.append(t.normalized())
        ref = Vector((0, 0, 1)) if abs(tangents[0].z) < 0.9 else Vector((1, 0, 0))
        normal = tangents[0].cross(ref).normalized()
        bm = bmesh.new()
        rings = []
        for i, (p, t) in enumerate(zip(pts, tangents)):
            # parallel transport keeps the tube from twisting
            normal = (normal - t * normal.dot(t)).normalized()
            binormal = t.cross(normal)
            r = radii[i]
            if r <= 1e-5:
                rings.append([bm.verts.new(p)])
                continue
            rings.append([bm.verts.new(p + (normal * math.cos(a) * flat + binormal * math.sin(a)) * r)
                          for a in (k / sides * math.tau for k in range(sides))])
        count = n if closed else n - 1
        for i in range(count):
            r0, r1 = rings[i], rings[(i + 1) % n]
            if len(r1) == 1:
                for k in range(sides):
                    bm.faces.new((r0[k], r0[(k + 1) % sides], r1[0]))
            elif len(r0) == 1:
                for k in range(sides):
                    bm.faces.new((r1[(k + 1) % sides], r1[k], r0[0]))
            else:
                for k in range(sides):
                    bm.faces.new((r0[k], r0[(k + 1) % sides], r1[(k + 1) % sides], r1[k]))
        if cap and not closed:
            if len(rings[0]) > 1:
                bm.faces.new(list(reversed(rings[0])))
            if len(rings[-1]) > 1:
                bm.faces.new(rings[-1])
        return self._finish(name, bm, mat, bone, 0.0, keep=[])

    def ring(self, name, bone, mat, c, radius, tube, axis="Y", sides=6, segments=64, flat=1.0):
        a = _axis(axis)
        u = (Vector((1, 0, 0)) if axis != "X" else Vector((0, 1, 0)))
        v = a.cross(u)
        pts = [Vector(c) + (u * math.cos(t) + v * math.sin(t)) * radius
               for t in (k / segments * math.tau for k in range(segments))]
        return self.sweep(name, bone, mat, pts, [tube] * segments, sides=sides, closed=True, flat=flat)

    def bolt(self, bone, mat, c, n, r=0.022, h=0.018):
        c, n = Vector(c), Vector(n).normalized()
        return self.cyl("bolt", bone, mat, c - n * 0.004, c + n * h, r, seg=6, bevel=0.0)

    def bolts(self, bone, mat, pts, n, r=0.022):
        for p in pts:
            self.bolt(bone, mat, p, n, r)

    def vent(self, name, bone, frame_mat, slat_mat, c, n, up, w, h, slats=5, depth=0.05):
        """A housing with angled slats, facing n."""
        n, up = Vector(n).normalized(), Vector(up).normalized()
        u = up.cross(n)
        basis = Matrix((u, up, n)).transposed().to_4x4()
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            v.co.x *= w
            v.co.y *= h
            v.co.z *= depth
        bm.normal_update()
        keep = list(bm.edges)
        Kit._recess(bm, [f for f in bm.faces if f.normal.z > 0.8], 0.025, depth * 0.6)
        bmesh.ops.transform(bm, matrix=Matrix.Translation(c) @ basis, verts=bm.verts)
        self._finish(name, bm, frame_mat, bone, 0.008, 2, keep)
        step = (h - 0.06) / slats
        for i in range(slats):
            y = -h / 2 + 0.03 + step * (i + 0.5)
            p = Vector(c) + up * y + n * (depth * 0.05)
            bm = bmesh.new()
            bmesh.ops.create_cube(bm, size=1.0)
            for v in bm.verts:
                v.co.x *= w - 0.05
                v.co.y *= step * 0.95
                v.co.z *= 0.012
            bmesh.ops.transform(bm, matrix=Matrix.Translation(p) @ basis @ _rot((-35, 0, 0)), verts=bm.verts)
            self._finish(name + "_slat", bm, slat_mat, bone, 0.0, keep=[])

    def crystal(self, name, bone, mat, base, direction, length, radius, sides=5, waist=0.35, seed=0, jitter=0.2,
                bevel=0.0):
        """A jagged crystal: narrow base, widest a third of the way up, a skewed tip."""
        rng = random.Random(seed)
        d = Vector(direction).normalized()
        ref = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
        u = d.cross(ref).normalized()
        v = d.cross(u)
        base = Vector(base)
        bm = bmesh.new()
        ring0, ring1 = [], []
        for i in range(sides):
            a = i / sides * math.tau + rng.uniform(-0.25, 0.25)
            r = radius * rng.uniform(0.75, 1.0)
            ring0.append(bm.verts.new(base + (u * math.cos(a) + v * math.sin(a)) * r * 0.6))
            ring1.append(bm.verts.new(base + d * length * waist + (u * math.cos(a) + v * math.sin(a)) * r *
                                      (1 + rng.uniform(0, jitter))))
        tip = bm.verts.new(base + d * length + (u * rng.uniform(-1, 1) + v * rng.uniform(-1, 1)) * radius * jitter)
        bm.faces.new(list(reversed(ring0)))
        for i in range(sides):
            j = (i + 1) % sides
            bm.faces.new((ring0[i], ring0[j], ring1[j], ring1[i]))
            bm.faces.new((ring1[i], ring1[j], tip))
        return self._finish(name, bm, mat, bone, bevel, 1)

    def plate_shell(self, name, bone, mat, radius, thick, subdiv=2, gap=0.9, skip=None, seed=0, lift=0.06,
                    bevel=0.008):
        """Armour scales on a sphere: every face of an icosphere becomes its own
        thick plate with a gap around it (light from inside shows through)."""
        rng = random.Random(seed)
        src = bmesh.new()
        bmesh.ops.create_icosphere(src, subdivisions=subdiv, radius=radius)
        bm = bmesh.new()
        for f in src.faces:
            c = f.calc_center_median()
            n = c.normalized()
            if skip and skip(n, rng):
                continue
            h = thick + rng.uniform(0, lift)
            inner = [bm.verts.new(c + (v.co - c) * gap) for v in f.verts]
            outer = [bm.verts.new(c + (v.co - c) * gap * 0.86 + n * h) for v in f.verts]
            k = len(inner)
            bm.faces.new(outer)
            bm.faces.new(list(reversed(inner)))
            for i in range(k):
                j = (i + 1) % k
                bm.faces.new((inner[i], inner[j], outer[j], outer[i]))
        src.free()
        return self._finish(name, bm, mat, bone, bevel, 1)

    def ellipsoid(self, name, bone, mat, c, r, subdiv=3):
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
        for v in bm.verts:
            v.co = Vector((v.co.x * r[0], v.co.y * r[1], v.co.z * r[2])) + Vector(c)
        return self._finish(name, bm, mat, bone, 0.0, keep=[])

    def text(self, name, bone, mat, body, c, n, up, size, depth=0.004, font=None):
        """Stencil lettering lying on a surface facing n (original markings only)."""
        cu = bpy.data.curves.new(name, "FONT")
        cu.body = body
        cu.size = size
        cu.extrude = depth / 2
        cu.align_x = "CENTER"
        cu.align_y = "CENTER"
        if font:
            cu.font = font
        tmp = bpy.data.objects.new(name, cu)
        bpy.context.scene.collection.objects.link(tmp)
        deps = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(tmp.evaluated_get(deps))
        bpy.data.objects.remove(tmp)
        bpy.data.curves.remove(cu)
        bm = bmesh.new()
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        n, up = Vector(n).normalized(), Vector(up).normalized()
        u = up.cross(n)
        basis = Matrix((u, up, n)).transposed().to_4x4()
        bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(c) + n * (depth / 2 + 0.002)) @ basis,
                            verts=bm.verts)
        return self._finish(name, bm, mat, bone, 0.0, keep=[])


# ---------------------------------------------------------------------------
# Procedural surfaces. Each material exposes three nodes the baker taps:
# OUT_ALBEDO (colour), OUT_ORM (AO, roughness, metallic) and the normal chain.
# ---------------------------------------------------------------------------


def _n(nodes, kind, loc, **inputs):
    node = nodes.new(kind)
    node.location = loc
    for k, v in inputs.items():
        node.inputs[k].default_value = v
    return node


def _math(nodes, links, op, a, b=None, loc=(0, 0), clamp=False):
    m = nodes.new("ShaderNodeMath")
    m.operation = op
    m.location = loc
    m.use_clamp = clamp
    for i, x in enumerate((a, b)):
        if x is None:
            continue
        if isinstance(x, (int, float)):
            m.inputs[i].default_value = x
        else:
            links.new(x, m.inputs[i])
    return m.outputs[0]


def surface(name, base, metal, rough, wear=0.0, grime=1.0, wear_rgb=(0.42, 0.42, 0.44), stripes=None,
            emission=None, micro=0.02, edge_radius=0.012):
    """A paint/metal surface with chipped edges (bevel-normal mask x noise),
    crevice grime (AO), large-scale tone and roughness variation and a micro
    bump. `emission` makes a glow material instead (not baked)."""
    m = bpy.data.materials.new(name)
    nodes, links = m.node_tree.nodes, m.node_tree.links
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    if emission is not None:
        m["glow"] = True
        bsdf.inputs["Base Color"].default_value = (*base, 1)
        bsdf.inputs["Roughness"].default_value = rough
        bsdf.inputs["Emission Color"].default_value = (*emission[0], 1)
        bsdf.inputs["Emission Strength"].default_value = emission[1]
        return m
    bsdf.location = (900, 0)
    tc = _n(nodes, "ShaderNodeTexCoord", (-1400, 0))
    big = _n(nodes, "ShaderNodeTexNoise", (-1100, 300), Scale=2.2, Detail=4.0, Roughness=0.55)
    chip = _n(nodes, "ShaderNodeTexNoise", (-1100, 0), Scale=28.0, Detail=9.0, Roughness=0.65)
    streak_map = _n(nodes, "ShaderNodeMapping", (-1250, -300))
    streak_map.inputs["Scale"].default_value = (9.0, 9.0, 0.7)
    streak = _n(nodes, "ShaderNodeTexNoise", (-1100, -300), Scale=3.0, Detail=3.0)
    for t in (big, chip):
        links.new(tc.outputs["Object"], t.inputs["Vector"])
    links.new(tc.outputs["Object"], streak_map.inputs["Vector"])
    links.new(streak_map.outputs[0], streak.inputs["Vector"])
    bevel = _n(nodes, "ShaderNodeBevel", (-1100, -600))
    bevel.inputs["Radius"].default_value = edge_radius
    bevel.samples = 8
    geo = _n(nodes, "ShaderNodeNewGeometry", (-1100, -800))
    dot = nodes.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    dot.location = (-900, -650)
    links.new(bevel.outputs[0], dot.inputs[0])
    links.new(geo.outputs["Normal"], dot.inputs[1])
    edge = _math(nodes, links, "SUBTRACT", 1.0, dot.outputs["Value"], (-750, -650))
    edge = _math(nodes, links, "MULTIPLY", edge, 9.0, (-600, -650), clamp=True)
    # chips: edges eaten into by the noise
    chipv = _math(nodes, links, "MULTIPLY", chip.outputs["Fac"], 1.0, (-750, -100))
    wearm = _math(nodes, links, "SUBTRACT", edge, _math(nodes, links, "MULTIPLY", chipv, 0.9, (-600, -100)),
                  (-450, -300))
    wearm = _math(nodes, links, "MULTIPLY", _math(nodes, links, "SUBTRACT", wearm, 0.12, (-300, -300)), 6.0 * wear,
                  (-150, -300), clamp=True)
    ao = _n(nodes, "ShaderNodeAmbientOcclusion", (-1100, -1000))
    ao.samples = 16
    ao.inputs["Distance"].default_value = 0.35
    cav = _math(nodes, links, "SUBTRACT", 1.0, ao.outputs["AO"], (-900, -1000))
    cav = _math(nodes, links, "POWER", cav, 0.8, (-750, -1000), clamp=True)
    # albedo
    tone = nodes.new("ShaderNodeMapRange")
    tone.location = (-750, 300)
    links.new(big.outputs["Fac"], tone.inputs["Value"])
    tone.inputs["To Min"].default_value = 0.86
    tone.inputs["To Max"].default_value = 1.1
    col = nodes.new("ShaderNodeMix")
    col.data_type = "RGBA"
    col.blend_type = "MULTIPLY"
    col.location = (-450, 300)
    col.inputs["Factor"].default_value = 1.0
    col.inputs[6].default_value = (*base, 1)
    links.new(tone.outputs[0], col.inputs[7])
    if stripes:
        # Off-white stencil band in object space (u axis, start, width)
        ax, start, width, rgb = stripes
        sep = nodes.new("ShaderNodeSeparateXYZ")
        sep.location = (-900, 500)
        links.new(tc.outputs["Object"], sep.inputs[0])
        coord = sep.outputs["XYZ".index(ax)]
        a = _math(nodes, links, "GREATER_THAN", coord, start, (-750, 500))
        b = _math(nodes, links, "LESS_THAN", coord, start + width, (-750, 600))
        band = _math(nodes, links, "MULTIPLY", a, b, (-600, 550))
        smix = nodes.new("ShaderNodeMix")
        smix.data_type = "RGBA"
        smix.location = (-300, 450)
        links.new(band, smix.inputs["Factor"])
        links.new(col.outputs[2], smix.inputs[6])
        smix.inputs[7].default_value = (*rgb, 1)
        col = smix
    worn = nodes.new("ShaderNodeMix")
    worn.data_type = "RGBA"
    worn.location = (-150, 300)
    links.new(wearm, worn.inputs["Factor"])
    links.new(col.outputs[2], worn.inputs[6])
    worn.inputs[7].default_value = (*wear_rgb, 1)
    dirt_amt = _math(nodes, links, "ADD", _math(nodes, links, "MULTIPLY", cav, 0.55 * grime, (-450, -900)),
                     _math(nodes, links, "MULTIPLY", streak.outputs["Fac"], 0.18 * grime, (-450, -1100)), (-300, -950))
    dirt = nodes.new("ShaderNodeMix")
    dirt.data_type = "RGBA"
    dirt.location = (100, 300)
    links.new(_math(nodes, links, "MINIMUM", dirt_amt, 0.85, (-150, -950)), dirt.inputs["Factor"])
    links.new(worn.outputs[2], dirt.inputs[6])
    dirt.inputs[7].default_value = (0.035, 0.03, 0.026, 1)
    dirt.name = "OUT_ALBEDO"
    # roughness and metal
    r = _math(nodes, links, "ADD", rough, _math(nodes, links, "MULTIPLY",
              _math(nodes, links, "SUBTRACT", big.outputs["Fac"], 0.5, (-600, 100)), 0.22, (-450, 100)), (-300, 100))
    r = _math(nodes, links, "ADD", r, _math(nodes, links, "MULTIPLY", dirt_amt, 0.25, (-150, 0)), (0, 100))
    rmix = nodes.new("ShaderNodeMix")
    rmix.location = (150, 100)
    links.new(wearm, rmix.inputs["Factor"])
    links.new(r, rmix.inputs[2])
    rmix.inputs[3].default_value = 0.32
    rmix.clamp_result = True
    mmix = nodes.new("ShaderNodeMix")
    mmix.location = (150, -100)
    links.new(wearm, mmix.inputs["Factor"])
    mmix.inputs[2].default_value = metal
    mmix.inputs[3].default_value = 1.0
    orm = nodes.new("ShaderNodeCombineColor")
    orm.location = (350, -100)
    orm.name = "OUT_ORM"
    aoc = _math(nodes, links, "ADD", _math(nodes, links, "MULTIPLY", ao.outputs["AO"], 0.75, (-900, -1200)), 0.25,
                (-750, -1200))
    links.new(aoc, orm.inputs[0])
    links.new(rmix.outputs[0], orm.inputs[1])
    links.new(mmix.outputs[0], orm.inputs[2])
    # normal: bevel-rounded edges plus a faint orange-peel bump
    micro_n = _n(nodes, "ShaderNodeTexNoise", (-400, -1400), Scale=180.0, Detail=2.0)
    links.new(tc.outputs["Object"], micro_n.inputs["Vector"])
    bump = _n(nodes, "ShaderNodeBump", (300, -600))
    bump.inputs["Strength"].default_value = micro
    bump.inputs["Distance"].default_value = 0.002
    links.new(micro_n.outputs["Fac"], bump.inputs["Height"])
    links.new(bevel.outputs[0], bump.inputs["Normal"])
    bump.name = "OUT_NORMAL"
    links.new(dirt.outputs[2], bsdf.inputs["Base Color"])
    links.new(rmix.outputs[0], bsdf.inputs["Roughness"])
    links.new(mmix.outputs[0], bsdf.inputs["Metallic"])
    links.new(bump.outputs[0], bsdf.inputs["Normal"])
    return m
