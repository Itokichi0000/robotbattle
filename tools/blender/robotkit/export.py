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
        "images": [
            {"name": n, "size": list(bpy.data.images[n].size)} for n in images if n in bpy.data.images
        ],
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
        export_tangents=False,
        export_cameras=False,
        export_lights=False,
        **extra,
    )
    op(**kwargs)
    bpy.ops.object.select_all(action="DESELECT")
    print(f"[export] wrote {path} ({os.path.getsize(path) / 1024:.0f} KB)")


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
