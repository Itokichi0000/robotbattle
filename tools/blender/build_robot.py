"""
Build a SATS WARS robot in Blender from code, then save / export / render it.

    blender -b --factory-startup -P tools/blender/build_robot.py -- --robot raijin
    blender -b --factory-startup -P tools/blender/build_robot.py -- --robot all --stage detail

Outputs (defaults, relative to the repository root):
    assets/models/<robot>/<robot>.blend            editable source (parts, rig, modifiers live)
    apps/web/public/assets/robots/<robot>.glb      game asset (glTF 2.0 binary, +Y up, +Z forward)
    assets/models/<robot>/previews/<robot>_{front,side,back,45}.png
    assets/models/<robot>/<robot>_stats.json       triangle counts, materials, textures, bbox
Options:
    --stage base|detail   base = blockout with rig and flat PBR materials;
                          detail = adds bevels/greebles and the baked texture atlas
    --no-render           skip preview renders (fast iteration)
    --skip-blend / --skip-glb
"""

import argparse
import os
import sys
import time

import bpy  # type: ignore

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
for p in (HERE, os.path.join(HERE, "robots")):
    if p not in sys.path:
        sys.path.insert(0, p)

from robotkit import export, preview, rig  # noqa: E402

DESIGNS = ("raijin", "fujin")
COLLECTION_NAMES = {
    "head": "Head",
    "torso": "Torso",
    "arms": "Arms",
    "legs": "Legs",
    "joints": "Joints",
    "back": "BackUnit",
}


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    ap = argparse.ArgumentParser(prog="build_robot.py")
    ap.add_argument("--robot", choices=(*DESIGNS, "all"), default="all")
    ap.add_argument("--stage", choices=("base", "detail"), default="detail")
    ap.add_argument("--models-dir", default=os.path.join(REPO, "assets", "models"))
    ap.add_argument("--glb-dir", default=os.path.join(REPO, "apps", "web", "public", "assets", "robots"))
    ap.add_argument("--no-render", action="store_true")
    ap.add_argument("--skip-blend", action="store_true")
    ap.add_argument("--skip-glb", action="store_true")
    ap.add_argument("--width", type=int, default=1080)
    ap.add_argument("--height", type=int, default=1350)
    return ap.parse_args(argv)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.render.fps = 30
    return scene


def build_one(key, args):
    import importlib

    design = importlib.import_module(key)
    t0 = time.time()
    scene = reset_scene()
    root = bpy.data.collections.new(key.upper())
    scene.collection.children.link(root)
    colls = {}
    for g, name in COLLECTION_NAMES.items():
        c = bpy.data.collections.new(f"{design.PREFIX}_{name}")
        root.children.link(c)
        colls[g] = c
    rig_coll = bpy.data.collections.new(f"{design.PREFIX}_Rig")
    root.children.link(rig_coll)

    arm = rig.build_armature(key, f"{design.PREFIX}_Rig", rig_coll)
    robot, mats = design.build(detail=args.stage == "detail")
    objs = [p.build(colls[p.group], arm) for p in robot.parts]
    arm["sw_robot"] = key
    arm["sw_stage"] = args.stage

    if args.stage == "detail" and hasattr(design, "finish"):
        objs = design.finish(robot, objs, arm, args) or objs

    stats = export.robot_stats(objs, arm)
    stats["robot"] = key
    stats["stage"] = args.stage
    out_dir = os.path.join(args.models_dir, key)
    print(f"[build] {key}: {stats['objects']} objects, {stats['bones']} bones, {stats['triangles']} tris, height {stats['height']} m")

    glb_path = os.path.join(args.glb_dir, f"{key}.glb")
    if not args.skip_glb:
        export.export_glb(glb_path, [arm, *objs])
        stats["glb_bytes"] = os.path.getsize(glb_path)

    # Preview stage lives in its own collection so it never ends up in the GLB.
    pv = bpy.data.collections.new("Preview")
    scene.collection.children.link(pv)
    cam, pivot = preview.setup_stage(pv, design.TEAM_COLOR)
    preview.configure_render(scene, args.width, args.height)
    if not args.no_render:
        from mathutils import Vector  # type: ignore

        bbox = (Vector(stats["bbox_min"]), Vector(stats["bbox_max"]))
        stats["previews"] = [
            os.path.relpath(p, REPO)
            for p in preview.render_views(os.path.join(out_dir, "previews"), key, cam, pivot, bbox, width=args.width, height=args.height)
        ]

    if not args.skip_blend:
        export.save_blend(os.path.join(out_dir, f"{key}.blend"))
    stats["build_seconds"] = round(time.time() - t0, 1)
    export.write_json(os.path.join(out_dir, f"{key}_stats.json"), stats)
    return stats


def main():
    args = parse_args()
    keys = DESIGNS if args.robot == "all" else (args.robot,)
    for key in keys:
        build_one(key, args)
    print("[build] done")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        import traceback

        traceback.print_exc()
        sys.exit(1)
