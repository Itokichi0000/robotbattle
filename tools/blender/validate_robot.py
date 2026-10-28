"""
Validate a built robot by reopening the saved files in Blender (not the in-memory scene):

    blender -b --factory-startup -P tools/blender/validate_robot.py -- --robot raijin

  .blend  collections, rig (19 named bones), every part skinned 100% to one existing bone,
          Armature modifier → rig, mesh validity, atlas UVs, packed power-of-two images,
          source materials kept for re-baking, no text/logo objects
  .glb    re-imported into an empty scene with Blender's own glTF importer: joints, parts,
          triangle count vs the .blend, materials, textures, height
Writes assets/models/<robot>/<robot>_validation.json; exits 1 if any check fails.
"""

import argparse
import json
import math
import os
import sys

import bpy  # type: ignore

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)

from robotkit import rig  # noqa: E402

PREFIX = {"raijin": "RJ", "fujin": "FJ"}
GROUPS = ("head", "torso", "arms", "legs", "joints", "back")


class Report:
    def __init__(self):
        self.checks = []

    def check(self, name, ok, detail=""):
        self.checks.append({"check": name, "ok": bool(ok), "detail": detail})
        print(f"  {'✓' if ok else '✗'} {name}{(': ' + str(detail)) if detail else ''}")
        return ok

    @property
    def ok(self):
        return all(c["ok"] for c in self.checks)


def tris_of(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    total = 0
    for o in objs:
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        total += len(me.loop_triangles)
        ev.to_mesh_clear()
    return total


def validate_blend(path, key, rep):
    print(f"[validate] {path}")
    bpy.ops.wm.open_mainfile(filepath=path)
    pre = PREFIX[key]
    names = {c.name for c in bpy.data.collections}
    expected = {key.upper(), *(f"{pre}_{n}" for n in ("Head", "Torso", "Arms", "Legs", "Joints", "BackUnit", "Rig"))}
    rep.check("collections", expected <= names, sorted(expected - names))

    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    rep.check("one armature", len(arms) == 1, [a.name for a in arms])
    arm = arms[0]
    spec = [b[0] for b in rig.bone_spec(key)]
    bones = [b.name for b in arm.data.bones]
    rep.check("bones match shared skeleton", sorted(bones) == sorted(spec), f"{len(bones)} bones")
    heads_ok = all((arm.data.bones[n].head_local - rig.bone_head(key, n)).length < 1e-4 for n in spec)
    rep.check("joint positions match the in-game rig", heads_ok)
    if hasattr(arm.data, "collections"):
        rep.check("bone collections", len(arm.data.collections) >= 6, [c.name for c in arm.data.collections])

    parts = [o for o in bpy.data.objects if o.type == "MESH" and o.get("sw_part")]
    rep.check("parts", len(parts) >= 25, len(parts))
    groups = {g: [o.name for o in parts if o["sw_part"] == g] for g in GROUPS}
    rep.check(
        "head/torso/arms/legs/joints/back all present", all(groups.values()), {g: len(v) for g, v in groups.items()}
    )

    bad_skin, bad_mesh, nan = [], [], []
    for o in parts:
        mods = [m for m in o.modifiers if m.type == "ARMATURE"]
        vg = o.vertex_groups
        bone = o.get("sw_bone")
        weights_ok = True
        if len(vg) == 1 and vg[0].name == bone:
            gi = vg[0].index
            for v in o.data.vertices:
                w = [g.weight for g in v.groups if g.group == gi]
                if not w or abs(w[0] - 1.0) > 1e-6:
                    weights_ok = False
                    break
        else:
            weights_ok = False
        if not (o.parent == arm and len(mods) == 1 and mods[0].object == arm and bone in bones and weights_ok):
            bad_skin.append(o.name)
        if o.data.validate(verbose=False):  # True = it had to fix something
            bad_mesh.append(o.name)
        if any(not all(math.isfinite(c) for c in v.co) for v in o.data.vertices):
            nan.append(o.name)
    rep.check("every part rigidly skinned to one existing bone", not bad_skin, bad_skin)
    rep.check("mesh data valid", not bad_mesh, bad_mesh)
    rep.check("no NaN vertices", not nan, nan)
    rep.check("no text / logo objects", not [o for o in bpy.data.objects if o.type == "FONT"])

    stage = arm.get("sw_stage", "base")
    if stage == "detail":
        body = f"{pre}_Body"
        atlas_parts = [o for o in parts if any(sl.material and sl.material.name == body for sl in o.material_slots)]
        no_uv = [o.name for o in atlas_parts if "UVMap" not in o.data.uv_layers]
        rep.check("atlas UVs on every atlas part", len(atlas_parts) >= 25 and not no_uv, f"{len(atlas_parts)} parts {no_uv}")
        imgs = [i for i in bpy.data.images if i.name.startswith(f"{pre}_")]
        rep.check("baked images packed", imgs and all(i.packed_file for i in imgs), [i.name for i in imgs])
        rep.check(
            "images power-of-two ≤ 2048",
            all(i.size[0] == i.size[1] and i.size[0] <= 2048 and math.log2(i.size[0]) % 1 == 0 for i in imgs),
            [f"{i.name} {i.size[0]}" for i in imgs],
        )
        game = {s.material.name for o in parts for s in o.material_slots if s.material}
        rep.check("parts share the atlas material", len(game) <= 2, sorted(game))
        sources = [m.name for m in bpy.data.materials if m.use_fake_user]
        rep.check("source materials kept for re-baking", len(sources) >= 4, sources)
    tris = tris_of(parts)
    rep.check("triangle budget (≤ 60k target, 100k max)", tris <= 60000, tris)
    return {"stage": stage, "parts": len(parts), "triangles": tris, "groups": groups}


def validate_glb(path, key, blend_tris, rep):
    print(f"[validate] {path}")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    # Only skinned meshes are robot parts (newer importers also add bone-shape helper meshes).
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers)]
    rep.check("GLB imports with one armature", len(arms) == 1)
    bones = {b.name for b in arms[0].data.bones} if arms else set()
    spec = {b[0] for b in rig.bone_spec(key)}
    rep.check("GLB joints", spec <= bones, sorted(spec - bones))
    rep.check("GLB parts", len(meshes) >= 25, len(meshes))
    tris = tris_of(meshes)
    rep.check("GLB triangles equal the .blend", tris == blend_tris, f"{tris} vs {blend_tris}")
    mats = {s.material.name for o in meshes for s in o.material_slots if s.material}
    imgs = [i for i in bpy.data.images if i.size[0] > 0]
    rep.check(
        "GLB materials / textures",
        len(mats) <= 2 and len(imgs) in (0, 4),
        f"{sorted(mats)} / {[i.size[:] for i in imgs]}",
    )
    zs = [(o.matrix_world @ v.co).z for o in meshes for v in o.data.vertices]
    height = max(zs) - min(zs)
    rep.check(
        "GLB height 4.5–5.5 m, standing on the ground",
        4.5 < height < 5.5 and abs(min(zs)) < 0.02,
        f"{height:.3f} m, min z {min(zs):.3f}",
    )
    rep.check(
        "GLB has no animation clips (procedural clips drive it)", len(bpy.data.actions) == 0, len(bpy.data.actions)
    )
    return {"triangles": tris, "materials": sorted(mats), "height": round(height, 3), "bytes": os.path.getsize(path)}


def script_args():
    """Arguments after `--` (blender -P script.py -- ...), or argv[1:] when run with the bpy module."""
    if "--" in sys.argv:
        args = sys.argv[sys.argv.index("--") + 1 :]
        while args and args[0] == "--":  # `pnpm models:build -- --robot x` forwards a second "--"
            args = args[1:]
        return args
    if os.path.basename(sys.argv[0]).lower().startswith("blender"):
        return []
    return sys.argv[1:]


def main():
    argv = script_args()
    ap = argparse.ArgumentParser()
    ap.add_argument("--robot", choices=("raijin", "fujin", "all"), default="all")
    ap.add_argument("--models-dir", default=os.path.join(REPO, "assets", "models"))
    ap.add_argument("--glb-dir", default=os.path.join(REPO, "apps", "web", "public", "assets", "robots"))
    args = ap.parse_args(argv)
    failed = False
    for key in ("raijin", "fujin") if args.robot == "all" else (args.robot,):
        rep = Report()
        blend = validate_blend(os.path.join(args.models_dir, key, f"{key}.blend"), key, rep)
        glb = validate_glb(os.path.join(args.glb_dir, f"{key}.glb"), key, blend["triangles"], rep)
        out = {
            "robot": key,
            "blender": bpy.app.version_string,
            "ok": rep.ok,
            "blend": blend,
            "glb": glb,
            "checks": rep.checks,
        }
        path = os.path.join(args.models_dir, key, f"{key}_validation.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(out, f, indent=2, ensure_ascii=False)
            f.write("\n")
        print(f"[validate] {key}: {'OK' if rep.ok else 'FAILED'} → {path}")
        failed |= not rep.ok
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
