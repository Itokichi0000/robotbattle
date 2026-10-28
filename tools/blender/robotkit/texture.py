"""
Game texture pipeline: one UV atlas for every part of a robot, Cycles bakes from the
procedural "source" materials, and a single glTF-ready material using the baked maps.

  source materials (editable, procedural: panel lines, wave/circuit patterns, glow)
      │  bake (Cycles, CPU)
      ▼
  <PREFIX>_BaseColor (sRGB)   <PREFIX>_ORM (R=AO, G=roughness, B=metallic)
  <PREFIX>_Normal (tangent)   <PREFIX>_Emission (sRGB, scaled by emissive strength)
      │
      ▼
  <PREFIX>_Body: one Principled BSDF → one draw call per part in three.js

The source materials stay in the .blend (fake user) so the bake can be redone after
editing geometry: run build_robot.py again, or call bake_atlas() on edited parts.
"""

import math

import bpy  # type: ignore
import numpy as np

from . import compat

ATLAS_UV = "UVMap"


# --------------------------------------------------------------------------- UVs


def _edit_objects(objs):
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")


def build_atlas_uvs(objs, margin=0.003):
    """Smart-project every part, equalise texel density across parts, pack into one 0–1 atlas."""
    for o in objs:
        if ATLAS_UV not in o.data.uv_layers:
            o.data.uv_layers.new(name=ATLAS_UV)
        o.data.uv_layers[ATLAS_UV].active = True
    ts = bpy.context.scene.tool_settings
    ts.use_uv_select_sync = True
    for o in objs:
        _edit_objects([o])
        bpy.ops.uv.smart_project(
            angle_limit=math.radians(60), island_margin=0.0, area_weight=0.0, scale_to_bounds=False
        )
        bpy.ops.object.mode_set(mode="OBJECT")
    _edit_objects(objs)
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(
        **compat.operator_kwargs(bpy.ops.uv.pack_islands, rotate=True, margin=margin, shape_method="CONVEX")
    )
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")


# --------------------------------------------------------------------------- bake helpers


def _new_image(name, size, non_color=False, alpha=False):
    old = bpy.data.images.get(name)
    if old:
        bpy.data.images.remove(old)
    img = bpy.data.images.new(name, size, size, alpha=alpha, float_buffer=False)
    img.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
    return img


def _principled(mat):
    return next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")


def _output(mat):
    return next(n for n in mat.node_tree.nodes if n.type == "OUTPUT_MATERIAL")


def _source(nt, sock):
    """(linked output socket or None, default value) of an input socket."""
    if sock.is_linked:
        return sock.links[0].from_socket, None
    return None, sock.default_value


def _feed(nt, src, value, dst, as_color):
    if src is not None:
        nt.links.new(src, dst)
    elif as_color:
        dst.default_value = value if len(value) == 4 else (*value, 1.0)
    else:
        dst.default_value = (value, value, value, 1.0)


class _BakeRig:
    """Temporarily rewires every source material to emit one channel, then restores it."""

    def __init__(self, mats, target_image):
        self.mats = mats
        self.temp = []
        for m in mats:
            node = m.node_tree.nodes.new("ShaderNodeTexImage")
            node.name = "__bake_target"
            node.image = target_image
            m.node_tree.nodes.active = node
            self.temp.append((m, node))
        self.saved = {}

    def set_target(self, image):
        for _m, node in self.temp:
            node.image = image

    def emit(self, builder):
        """builder(mat, nt, bsdf, emission_node) wires the channel into the emission node."""
        for m in self.mats:
            nt = m.node_tree
            out = _output(m)
            self.saved[m.name] = out.inputs["Surface"].links[0].from_socket if out.inputs["Surface"].is_linked else None
            em = nt.nodes.new("ShaderNodeEmission")
            em.name = "__bake_emit"
            builder(m, nt, _principled(m), em)
            nt.links.new(em.outputs[0], out.inputs["Surface"])

    def restore_surface(self):
        for m in self.mats:
            nt = m.node_tree
            out = _output(m)
            for n in [n for n in nt.nodes if n.name.startswith("__bake_emit") or n.name.startswith("__bake_tmp")]:
                nt.nodes.remove(n)
            src = self.saved.get(m.name)
            if src is not None:
                nt.links.new(src, out.inputs["Surface"])
        self.saved = {}

    def cleanup(self):
        self.restore_surface()
        for m, node in self.temp:
            m.node_tree.nodes.remove(node)


def _bake(kind, objs, samples, margin_px, **kw):
    scene = bpy.context.scene
    scene.cycles.samples = samples
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.bake(type=kind, margin=margin_px, use_clear=True, **kw)


def _albedo(m, nt, bsdf, em):
    src, val = _source(nt, compat.bsdf_input(bsdf, "Base Color"))
    _feed(nt, src, val, em.inputs["Color"], True)


def _rough_metal(m, nt, bsdf, em):
    comb = (
        nt.nodes.new("ShaderNodeCombineColor")
        if hasattr(bpy.types, "ShaderNodeCombineColor")
        else nt.nodes.new("ShaderNodeCombineRGB")
    )
    comb.name = "__bake_tmp_comb"
    ins = comb.inputs
    ins[0].default_value = 1.0
    for idx, name in ((1, "Roughness"), (2, "Metallic")):
        src, val = _source(nt, compat.bsdf_input(bsdf, name))
        if src is not None:
            nt.links.new(src, ins[idx])
        else:
            ins[idx].default_value = val
    nt.links.new(comb.outputs[0], em.inputs["Color"])


def _emission(scale):
    def build(m, nt, bsdf, em):
        col = compat.bsdf_input(bsdf, "Emission Color", "Emission")
        strength = compat.bsdf_input(bsdf, "Emission Strength").default_value
        src, val = _source(nt, col)
        _feed(nt, src, val, em.inputs["Color"], True)
        em.inputs["Strength"].default_value = min(1.0, strength / scale) if strength > 0 else 0.0

    return build


def bake_atlas(objs, prefix, size=2048, samples_ao=64, emissive_strength=2.6, margin_px=8):
    """Bake the four maps for `objs` (sharing one atlas UV map). Returns the images."""
    scene = bpy.context.scene
    prev_engine = scene.render.engine
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    if hasattr(scene.cycles, "use_denoising"):
        scene.cycles.use_denoising = False
    scene.render.bake.use_selected_to_active = False
    for o in objs:
        o.data.uv_layers[ATLAS_UV].active = True

    mats = []
    for o in objs:
        for s in o.material_slots:
            if s.material and s.material not in mats:
                mats.append(s.material)

    img = {
        "basecolor": _new_image(f"{prefix}_BaseColor", size),
        "orm": _new_image(f"{prefix}_ORM", size, non_color=True),
        "normal": _new_image(f"{prefix}_Normal", size, non_color=True),
        "emission": _new_image(f"{prefix}_Emission", size),
    }
    ao = _new_image(f"{prefix}_AO_tmp", size, non_color=True)
    rig = _BakeRig(mats, img["basecolor"])
    try:
        rig.emit(_albedo)
        _bake("EMIT", objs, 4, margin_px)
        rig.restore_surface()

        rig.set_target(img["orm"])
        rig.emit(_rough_metal)
        _bake("EMIT", objs, 4, margin_px)
        rig.restore_surface()

        rig.set_target(img["emission"])
        rig.emit(_emission(emissive_strength))
        _bake("EMIT", objs, 4, margin_px)
        rig.restore_surface()

        rig.set_target(ao)
        if scene.world:
            scene.world.light_settings.distance = 0.6  # AO bake reach in metres
        _bake("AO", objs, samples_ao, margin_px)

        rig.set_target(img["normal"])
        _bake("NORMAL", objs, 8, margin_px, normal_space="TANGENT")
    finally:
        rig.cleanup()
        scene.render.engine = prev_engine

    # ORM.R = ambient occlusion (glTF occlusion reads the red channel).
    n = size * size * 4
    orm = np.empty(n, dtype=np.float32)
    img["orm"].pixels.foreach_get(orm)
    a = np.empty(n, dtype=np.float32)
    ao.pixels.foreach_get(a)
    orm[0::4] = np.clip(a[0::4] * 0.85 + 0.15, 0.0, 1.0)  # keep AO gentle: the arena lights are soft
    img["orm"].pixels.foreach_set(orm)
    bpy.data.images.remove(ao)
    for im in img.values():
        im.pack()
    return img


# --------------------------------------------------------------------------- game material


def _gltf_settings_group():
    """Node group the glTF exporter recognises for the occlusion map."""
    name = "glTF Material Output"
    grp = bpy.data.node_groups.get(name)
    if grp:
        return grp
    grp = bpy.data.node_groups.new(name, "ShaderNodeTree")
    if hasattr(grp, "interface"):
        grp.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
        grp.interface.new_socket("Thickness", in_out="INPUT", socket_type="NodeSocketFloat")
    else:  # Blender < 4.0
        grp.inputs.new("NodeSocketFloat", "Occlusion")
        grp.inputs.new("NodeSocketFloat", "Thickness")
    return grp


def game_material(prefix, images, emissive_strength=2.6, name=None):
    mat = bpy.data.materials.new(name or f"{prefix}_Body")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = _principled(mat)

    def tex(image, x, y, non_color=False):
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = image
        n.location = (x, y)
        n.interpolation = "Linear"
        if non_color:
            image.colorspace_settings.name = "Non-Color"
        return n

    base = tex(images["basecolor"], -700, 300)
    nt.links.new(base.outputs["Color"], compat.bsdf_input(bsdf, "Base Color"))
    orm = tex(images["orm"], -700, 0, non_color=True)
    sep = (
        nt.nodes.new("ShaderNodeSeparateColor")
        if hasattr(bpy.types, "ShaderNodeSeparateColor")
        else nt.nodes.new("ShaderNodeSeparateRGB")
    )
    sep.location = (-400, 0)
    nt.links.new(orm.outputs["Color"], sep.inputs[0])
    nt.links.new(sep.outputs[1], compat.bsdf_input(bsdf, "Roughness"))
    nt.links.new(sep.outputs[2], compat.bsdf_input(bsdf, "Metallic"))
    occl = nt.nodes.new("ShaderNodeGroup")
    occl.node_tree = _gltf_settings_group()
    occl.location = (-150, -250)
    nt.links.new(sep.outputs[0], occl.inputs["Occlusion"])
    nrm = tex(images["normal"], -700, -300, non_color=True)
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nmap.location = (-400, -300)
    nmap.uv_map = ATLAS_UV
    nt.links.new(nrm.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], compat.bsdf_input(bsdf, "Normal"))
    emi = tex(images["emission"], -700, -600)
    nt.links.new(emi.outputs["Color"], compat.bsdf_input(bsdf, "Emission Color", "Emission"))
    compat.bsdf_input(bsdf, "Emission Strength").default_value = emissive_strength
    mat["sw_glow"] = True
    return mat


def assign_single_material(objs, mat, keep=()):
    """Replace every slot with `mat`, except objects listed in `keep` (e.g. transparent veils)."""
    for o in objs:
        if o.name in keep:
            continue
        me = o.data
        me.materials.clear()
        me.materials.append(mat)
        me.polygons.foreach_set("material_index", [0] * len(me.polygons))


def protect_source_materials(mats):
    for m in mats:
        m.use_fake_user = True
