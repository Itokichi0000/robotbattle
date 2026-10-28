"""Save .blend, export GLB, and measure what was built."""

import json
import os

import bpy  # type: ignore
from mathutils import Vector  # type: ignore

from . import compat


def evaluated_tris(obj, depsgraph):
    """Triangles after modifiers (what the GLB will contain)."""
    ev = obj.evaluated_get(depsgraph)
    me = ev.to_mesh()
    try:
        me.calc_loop_triangles()
        return len(me.loop_triangles)
    finally:
        ev.to_mesh_clear()


def robot_stats(robot_objs, armature):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    per_obj = {}
    bmin = Vector((1e9, 1e9, 1e9))
    bmax = Vector((-1e9, -1e9, -1e9))
    mats = set()
    for obj in robot_objs:
        per_obj[obj.name] = evaluated_tris(obj, depsgraph)
        for slot in obj.material_slots:
            if slot.material:
                mats.add(slot.material.name)
        ev = obj.evaluated_get(depsgraph)
        for corner in ev.bound_box:
            w = obj.matrix_world @ Vector(corner)
            bmin = Vector(map(min, bmin, w))
            bmax = Vector(map(max, bmax, w))
    images = sorted(
        {
            n.image.name
            for m in bpy.data.materials
            if m.name in mats and m.use_nodes
            for n in m.node_tree.nodes
            if n.type == "TEX_IMAGE" and n.image
        }
    )
    return {
        "blender": bpy.app.version_string,
        "objects": len(robot_objs),
        "bones": len(armature.data.bones),
        "triangles": sum(per_obj.values()),
        "triangles_per_object": dict(sorted(per_obj.items())),
        "materials": sorted(mats),
        "images": [{"name": n, "size": list(bpy.data.images[n].size)} for n in images if n in bpy.data.images],
        "bbox_min": [round(v, 3) for v in bmin],
        "bbox_max": [round(v, 3) for v in bmax],
        "height": round(bmax.z - bmin.z, 3),
    }


def save_blend(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(path), compress=True, relative_remap=True)
    print(f"[export] saved {path}")


def export_glb(path, objects, **extra):
    """Export only `objects` (armature + parts); modifiers applied, armature kept as a skin."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    op = bpy.ops.export_scene.gltf
    kwargs = compat.operator_kwargs(
        op,
        filepath=os.path.abspath(path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_skins=True,
        export_def_bones=False,
        export_animations=True,
        export_morph=False,
        export_materials="EXPORT",
        export_extras=True,
        export_texcoords=True,
        export_normals=True,
        export_cameras=False,
        export_lights=False,
        **{"export_tangents": True, **extra},  # MikkTSpace tangents = the normal-map bake (exact in three.js)
    )
    # glTF wants skinned meshes at the scene root (their node transform is ignored), but in
    # the .blend the parts stay parented to the rig for easy editing: lift them only while exporting.
    lifted = []
    for o in objects:
        if o.type == "MESH" and o.parent and o.parent.type == "ARMATURE":
            lifted.append((o, o.parent, o.matrix_parent_inverse.copy(), o.matrix_world.copy()))
            o.parent = None
            o.matrix_world = lifted[-1][3]
    try:
        op(**kwargs)
    finally:
        for o, parent, inv, world in lifted:
            o.parent = parent
            o.matrix_parent_inverse = inv
            o.matrix_world = world
    bpy.ops.object.select_all(action="DESELECT")
    print(f"[export] wrote {path} ({os.path.getsize(path) / 1024:.0f} KB)")


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


# --------------------------------------------------------------------------- LODs

LOD_LEVELS = ((1, 20_000, 1024), (2, 7_000, 512))  # (level, triangle budget, texture size)


def _decimate(objs, ratio):
    """Insert a Decimate (collapse) just before each part's Armature modifier."""
    for o in objs:
        arm = next((m for m in o.modifiers if m.type == "ARMATURE"), None)
        rig = arm.object if arm else None
        if arm:
            o.modifiers.remove(arm)
        dec = o.modifiers.get("LOD_Decimate") or o.modifiers.new("LOD_Decimate", "DECIMATE")
        dec.decimate_type = "COLLAPSE"
        dec.ratio = ratio
        dec.use_collapse_triangulate = True
        if rig:
            o.modifiers.new("Armature", "ARMATURE").object = rig


def export_lods(base_path, armature, objs, levels=LOD_LEVELS, **gltf_kw):
    """
    Write <name>_lod1.glb / _lod2.glb next to `base_path`: bevels off, Decimate fitted to the
    triangle budget (DESIGN_RULES: LOD1 ≤ 20k, LOD2 ≤ 7k), textures downscaled and no normal map
    (at LOD distances it adds little, and decimation leaves zero-area UV triangles whose tangents
    would be invalid). The .blend itself is restored afterwards (LOD settings are export-time only).
    """
    bevels = [m for o in objs for m in o.modifiers if m.type == "BEVEL"]
    for m in bevels:
        m.show_viewport = m.show_render = False
    depsgraph = bpy.context.evaluated_depsgraph_get()
    raw = sum(evaluated_tris(o, depsgraph) for o in objs)
    mats = {s.material for o in objs for s in o.material_slots if s.material}
    tex_nodes = [n for m in mats if m.use_nodes for n in m.node_tree.nodes if n.type == "TEX_IMAGE" and n.image]
    normal_links = []
    for m in mats:
        if not m.use_nodes:
            continue
        for link in list(m.node_tree.links):
            if link.from_node.type == "NORMAL_MAP":
                normal_links.append((m.node_tree, link.from_socket, link.to_socket))
                m.node_tree.links.remove(link)
    gltf_kw = {**gltf_kw, "export_tangents": False}
    results = []
    try:
        for level, budget, size in levels:
            ratio = min(1.0, budget * 0.96 / raw)
            for _ in range(4):  # collapse does not hit the ratio exactly: tighten until under budget
                _decimate(objs, ratio)
                tris = sum(evaluated_tris(o, bpy.context.evaluated_depsgraph_get()) for o in objs)
                if tris <= budget:
                    break
                ratio *= budget / tris * 0.97
            swapped = []
            for n in tex_nodes:
                if n.image.size[0] > size and n.outputs["Color"].is_linked:
                    small = n.image.copy()
                    small.scale(size, size)
                    swapped.append((n, n.image, small))
                    n.image = small
            path = base_path.replace(".glb", f"_lod{level}.glb")
            try:
                export_glb(path, [armature, *objs], **gltf_kw)
            finally:
                for n, orig, small in swapped:
                    n.image = orig
                    bpy.data.images.remove(small)
            results.append(
                {"level": level, "triangles": tris, "budget": budget, "texture": size, "bytes": os.path.getsize(path)}
            )
            print(f"[export] LOD{level}: {tris} tris (budget {budget}), {size}px textures")
    finally:
        for o in objs:
            dec = o.modifiers.get("LOD_Decimate")
            if dec:
                o.modifiers.remove(dec)
        for m in bevels:
            m.show_viewport = m.show_render = True
        for nt, a, b in normal_links:
            nt.links.new(a, b)
    return results
