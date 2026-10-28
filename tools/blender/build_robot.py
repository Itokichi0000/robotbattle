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
    --previews-only       re-render the previews from the saved .blend (no rebuild / re-bake)
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

from robotkit import export, preview, rig, texture  # noqa: E402

DESIGNS = ("raijin", "fujin")
COLLECTION_NAMES = {
    "head": "Head",
    "torso": "Torso",
    "arms": "Arms",
    "legs": "Legs",
    "joints": "Joints",
    "back": "BackUnit",
}


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


def parse_args():
    argv = script_args()
    ap = argparse.ArgumentParser(prog="build_robot.py")
    ap.add_argument("--robot", choices=(*DESIGNS, "all"), default="all")
    ap.add_argument("--stage", choices=("base", "detail"), default="detail")
    ap.add_argument("--models-dir", default=os.path.join(REPO, "assets", "models"))
    ap.add_argument("--glb-dir", default=os.path.join(REPO, "apps", "web", "public", "assets", "robots"))
    ap.add_argument("--no-render", action="store_true")
    ap.add_argument("--previews-only", action="store_true")
    ap.add_argument("--skip-blend", action="store_true")
    ap.add_argument("--skip-glb", action="store_true")
    ap.add_argument(
        "--atlas-size", type=int, default=0, help="override the design's atlas size (e.g. 512 for quick tests)"
    )
    ap.add_argument("--image-format", choices=("WEBP", "JPEG", "AUTO"), default="WEBP")
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


def bake_game_material(design, objs, mats, args):
    """Atlas UVs → Cycles bakes → one game material on every part (except design.ATLAS["keep"])."""
    atlas = design.ATLAS
    t0 = time.time()
    bake_objs = [o for o in objs if o.name not in atlas["keep"]]
    texture.build_atlas_uvs(bake_objs)
    size = args.atlas_size or atlas["size"]
    images = texture.bake_atlas(bake_objs, design.PREFIX, size=size, emissive_strength=atlas["emissive_strength"])
    body = texture.game_material(design.PREFIX, images, atlas["emissive_strength"])
    texture.assign_single_material(bake_objs, body)
    texture.protect_source_materials(mats.values())
    print(f"[build] baked {size}px atlas for {len(bake_objs)} parts in {time.time() - t0:.0f}s")


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

    if args.stage == "detail":
        bake_game_material(design, objs, mats, args)

    stats = export.robot_stats(objs, arm)
    stats["robot"] = key
    stats["stage"] = args.stage
    out_dir = os.path.join(args.models_dir, key)
    print(f"[build] {key}: {stats['objects']} objects, {stats['bones']} bones, {stats['triangles']} tris")

    glb_path = os.path.join(args.glb_dir, f"{key}.glb")
    if not args.skip_glb:
        export.export_glb(
            glb_path,
            [arm, *objs],
            export_image_format=args.image_format,
            export_image_quality=90,
            export_jpeg_quality=90,
        )
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
            for p in preview.render_views(
                os.path.join(out_dir, "previews"), key, cam, pivot, bbox, width=args.width, height=args.height
            )
        ]

    if not args.skip_blend:
        export.save_blend(os.path.join(out_dir, f"{key}.blend"))
    stats["build_seconds"] = round(time.time() - t0, 1)
    export.write_json(os.path.join(out_dir, f"{key}_stats.json"), stats)
    return stats


def previews_only(key, args):
    import json

    from mathutils import Vector  # type: ignore

    out_dir = os.path.join(args.models_dir, key)
    bpy.ops.wm.open_mainfile(filepath=os.path.join(out_dir, f"{key}.blend"))
    stats_path = os.path.join(out_dir, f"{key}_stats.json")
    with open(stats_path, encoding="utf-8") as f:
        stats = json.load(f)
    scene = bpy.context.scene
    preview.configure_render(scene, args.width, args.height)
    bbox = (Vector(stats["bbox_min"]), Vector(stats["bbox_max"]))
    cam, pivot = bpy.data.objects["PV_Camera"], bpy.data.objects["PV_Pivot"]
    paths = preview.render_views(
        os.path.join(out_dir, "previews"), key, cam, pivot, bbox, width=args.width, height=args.height
    )
    stats["previews"] = [os.path.relpath(p, REPO) for p in paths]
    export.write_json(stats_path, stats)


def main():
    args = parse_args()
    keys = DESIGNS if args.robot == "all" else (args.robot,)
    for key in keys:
        if args.previews_only:
            previews_only(key, args)
        else:
            build_one(key, args)
    print("[build] done")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        import traceback

        traceback.print_exc()
        sys.exit(1)
