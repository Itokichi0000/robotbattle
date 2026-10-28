"""
Parts and materials.

A Part is one editable Blender object (head, chest, left forearm, knee joint, back
unit, ...). Every part is skinned 100% to exactly one bone via a vertex group named
after that bone + an Armature modifier. That keeps the robot rigid like a real
machine today, while an artist can later repaint weights, join parts, or add
deforming pieces without changing the skeleton or the exported joint names.
"""

import math

import bmesh  # type: ignore
import bpy  # type: ignore
from mathutils import Euler, Matrix, Vector  # type: ignore

from . import compat


def xf(loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    """Placement matrix. `rot` is XYZ Euler in degrees."""
    return Matrix.LocRotScale(Vector(loc), Euler([math.radians(a) for a in rot], "XYZ"), Vector(scale))


MIRROR_X = Matrix.Scale(-1, 4, (1, 0, 0))


# --------------------------------------------------------------------------- materials


def _srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(_srgb_to_linear(int(h[i : i + 2], 16) / 255) for i in (0, 2, 4))


def make_material(name, color, metallic=0.0, roughness=0.5, emission=None, strength=0.0, alpha=1.0):
    """
    glTF-friendly Principled BSDF (no custom node groups, so the exporter maps every
    input to core glTF / KHR_materials_emissive_strength).
    """
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    compat.bsdf_input(bsdf, "Base Color").default_value = (*hex_rgb(color), 1.0)
    compat.bsdf_input(bsdf, "Metallic").default_value = metallic
    compat.bsdf_input(bsdf, "Roughness").default_value = roughness
    if emission:
        compat.bsdf_input(bsdf, "Emission Color", "Emission").default_value = (*hex_rgb(emission), 1.0)
        compat.bsdf_input(bsdf, "Emission Strength").default_value = strength
    if alpha < 1.0:
        compat.bsdf_input(bsdf, "Alpha").default_value = alpha
        compat.set_blend_transparent(mat)
    mat.diffuse_color = (*hex_rgb(emission or color), alpha)  # solid-view colour
    mat["sw_glow"] = bool(emission)
    return mat


# --------------------------------------------------------------------------- parts


class Part:
    """Geometry accumulator for one object. Add primitives, then `build()`."""

    def __init__(self, name, bone, group, *, mirror=False, bevel=0.0, bevel_segments=2, smooth_angle=35.0):
        self.name = name
        self.bone = bone
        self.group = group  # collection key: head / torso / arms / legs / joints / back
        self.mirror = mirror  # model only x >= 0; a Mirror modifier (bisect + merge) makes the rest
        self.bevel = bevel
        self.bevel_segments = bevel_segments
        self.smooth_angle = smooth_angle
        self.bm = bmesh.new()
        self.materials = []

    def _mat_index(self, mat):
        if mat not in self.materials:
            self.materials.append(mat)
        return self.materials.index(mat)

    def add(self, geom, mat, matrix=None, closed=True):
        """Place (verts, faces) with `matrix` (or xf(...) tuple) and material `mat`."""
        verts, faces = geom
        m = matrix if matrix is not None else Matrix.Identity(4)
        bvs = [self.bm.verts.new(m @ Vector(v)) for v in verts]
        new_faces = []
        for f in faces:
            try:
                new_faces.append(self.bm.faces.new([bvs[i] for i in f]))
            except ValueError:  # duplicate face from a degenerate primitive: skip
                pass
        idx = self._mat_index(mat)
        for f in new_faces:
            f.material_index = idx
        if m.determinant() < 0:
            bmesh.ops.reverse_faces(self.bm, faces=new_faces)
        if closed:
            bmesh.ops.recalc_face_normals(self.bm, faces=new_faces)
        return new_faces

    def add_many(self, items, mat, matrix=None):
        """Add [(verts, faces, local_matrix), ...] (e.g. geo.segments_xz) under `matrix`."""
        m = matrix if matrix is not None else Matrix.Identity(4)
        for v, f, lm in items:
            self.add((v, f), mat, m @ lm)

    def tri_count(self):
        return sum(len(f.verts) - 2 for f in self.bm.faces)

    def build(self, collection, armature_obj):
        me = bpy.data.meshes.new(self.name)
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-5)
        self.bm.to_mesh(me)
        self.bm.free()
        for mat in self.materials:
            me.materials.append(mat)
        compat.set_smooth_by_angle(me, self.smooth_angle)
        obj = bpy.data.objects.new(self.name, me)
        collection.objects.link(obj)
        obj["sw_part"] = self.group
        obj["sw_bone"] = self.bone
        if self.mirror:
            mod = obj.modifiers.new("Mirror", "MIRROR")
            mod.use_axis = (True, False, False)
            mod.use_bisect_axis = (True, False, False)
            mod.use_clip = True
            mod.use_mirror_merge = True
            mod.merge_threshold = 1e-4
        if self.bevel > 0:
            mod = obj.modifiers.new("Bevel", "BEVEL")
            mod.width = self.bevel
            mod.segments = self.bevel_segments
            mod.limit_method = "ANGLE"
            mod.angle_limit = math.radians(40)
            mod.use_clamp_overlap = True
            mod.harden_normals = True
            mod.miter_outer = "MITER_ARC"
        vg = obj.vertex_groups.new(name=self.bone)
        vg.add(list(range(len(me.vertices))), 1.0, "REPLACE")
        obj.parent = armature_obj
        arm = obj.modifiers.new("Armature", "ARMATURE")
        arm.object = armature_obj
        return obj


class Robot:
    """Collects parts per collection and turns them into Blender objects."""

    GROUPS = ("head", "torso", "arms", "legs", "joints", "back")

    def __init__(self, key, prefix):
        self.key = key  # "raijin" / "fujin"
        self.prefix = prefix  # object name prefix, e.g. "RJ"
        self.parts = []

    def part(self, name, bone, group, **kw):
        p = Part(f"{self.prefix}_{name}", bone, group, **kw)
        self.parts.append(p)
        return p

    def sided(self, name, bone, group, build, **kw):
        """
        Left/right pair. `build(part)` models only the LEFT (+X) part; the right part
        is its exact mirror image, so the two can never drift apart.
        """
        left = self.part(f"{name}_L", f"{bone}_L", group, **kw)
        build(left)
        right = self.part(f"{name}_R", f"{bone}_R", group, **kw)
        right.bm.free()
        right.bm = left.bm.copy()
        bmesh.ops.transform(right.bm, matrix=MIRROR_X, verts=right.bm.verts)
        bmesh.ops.reverse_faces(right.bm, faces=right.bm.faces)
        right.materials = list(left.materials)
        return left, right
