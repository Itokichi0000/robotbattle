"""
Preview renders: front / side / back / 45°. The light rig turns with the camera so
every view is lit the same way (key + fill from the camera side, two team-coloured
rims from behind), on the arena's dark navy (#070D1A) background.
"""

import math
import os

import bpy  # type: ignore
from mathutils import Vector  # type: ignore

from . import compat
from .parts import hex_rgb, make_material

# view name -> (azimuth degrees, elevation degrees). Azimuth 0 = in front of the robot (-Y);
# positive azimuth swings the camera toward the robot's left side (+X).
VIEWS = {
    "front": (0, 4),
    "side": (90, 4),
    "back": (180, 4),
    "45": (40, 14),
}


def _look_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def setup_stage(collection, team_color, *, ground_radius=4.5):
    scene = bpy.context.scene
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (*hex_rgb("#070D1A"), 1.0)
    bg.inputs[1].default_value = 1.0

    ground_mat = make_material("PV_Ground", "#0B1426", metallic=0.2, roughness=0.35)
    ring_mat = make_material("PV_GroundRing", team_color, emission=team_color, strength=1.5)
    mesh = bpy.data.meshes.new("PV_Ground")
    verts, faces = [], []
    seg = 64
    for i in range(seg):
        a = math.tau * i / seg
        verts.append((ground_radius * math.cos(a), ground_radius * math.sin(a), 0.0))
    faces.append(tuple(range(seg)))
    mesh.from_pydata(verts, [], faces)
    mesh.materials.append(ground_mat)
    ground = bpy.data.objects.new("PV_Ground", mesh)
    collection.objects.link(ground)
    ring_mesh = bpy.data.meshes.new("PV_GroundRing")
    rv, rf = [], []
    for i in range(seg):
        a = math.tau * i / seg
        for r in (ground_radius - 0.06, ground_radius):
            rv.append((r * math.cos(a), r * math.sin(a), 0.002))
    for i in range(seg):
        j = (i + 1) % seg
        rf.append((2 * i, 2 * j, 2 * j + 1, 2 * i + 1))
    ring_mesh.from_pydata(rv, [], rf)
    ring_mesh.materials.append(ring_mat)
    ring = bpy.data.objects.new("PV_GroundRing", ring_mesh)
    collection.objects.link(ring)

    pivot = bpy.data.objects.new("PV_Pivot", None)
    collection.objects.link(pivot)

    def light(name, kind, energy, color, loc, size=2.0):
        data = bpy.data.lights.new(name, kind)
        data.energy = energy
        data.color = color
        if kind == "AREA":
            data.size = size
        obj = bpy.data.objects.new(name, data)
        collection.objects.link(obj)
        obj.location = loc
        obj.parent = pivot
        _look_at(obj, (0, 0, 2.2))
        return obj

    tc = hex_rgb(team_color)
    light("PV_Key", "AREA", 2600, (1.0, 0.95, 0.9), (-5.5, -7.5, 7.5), 4.0)
    light("PV_Fill", "AREA", 900, (0.75, 0.85, 1.0), (7.0, -6.0, 3.5), 5.0)
    light("PV_RimL", "AREA", 1800, tc, (-5.0, 6.5, 5.5), 3.0)
    light("PV_RimR", "AREA", 1400, (0.7, 0.8, 1.0), (5.5, 6.0, 4.0), 3.0)
    light("PV_Top", "AREA", 700, (1.0, 1.0, 1.0), (0.0, -1.0, 10.0), 6.0)

    cam_data = bpy.data.cameras.new("PV_Camera")
    cam_data.lens = 70
    cam_data.sensor_fit = "AUTO"
    cam = bpy.data.objects.new("PV_Camera", cam_data)
    collection.objects.link(cam)
    scene.camera = cam
    return cam, pivot


def configure_render(scene, width, height, samples=48):
    scene.render.engine = compat.eevee_engine()
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.film_transparent = False
    ee = scene.eevee
    if hasattr(ee, "taa_render_samples"):
        ee.taa_render_samples = samples
    if hasattr(ee, "use_gtao"):
        ee.use_gtao = True
        ee.gtao_distance = 0.6
    if hasattr(ee, "use_soft_shadows"):
        ee.use_soft_shadows = True
    if hasattr(ee, "shadow_cube_size"):
        ee.shadow_cube_size = "1024"
    if hasattr(ee, "use_ssr"):
        ee.use_ssr = True
    compat.bloom(scene, True)
    vs = scene.view_settings
    vs.view_transform = "AgX" if "AgX" in [i.identifier for i in vs.bl_rna.properties["view_transform"].enum_items] else "Filmic"
    vs.look = "None"
    vs.exposure = 0.0


def frame_distance(bbox_min, bbox_max, lens, sensor, aspect):
    """Camera distance that fits the robot's bounding box with a margin."""
    h = bbox_max.z - bbox_min.z
    w = max(bbox_max.x - bbox_min.x, bbox_max.y - bbox_min.y)
    vfov = 2 * math.atan((sensor / 2) / lens)  # portrait: sensor spans the height
    hfov = 2 * math.atan(math.tan(vfov / 2) * aspect)
    return 1.12 * max((h / 2) / math.tan(vfov / 2), (w / 2) / math.tan(hfov / 2)) + w / 2


def render_views(out_dir, basename, cam, pivot, bbox, *, width=1080, height=1350, views=VIEWS):
    scene = bpy.context.scene
    bmin, bmax = bbox
    center = (bmin + bmax) / 2
    target = Vector((0.0, 0.0, center.z))
    dist = frame_distance(bmin, bmax, cam.data.lens, cam.data.sensor_width, width / height)
    os.makedirs(out_dir, exist_ok=True)
    written = []
    for name, (az, el) in views.items():
        a, e = math.radians(az), math.radians(el)
        cam.location = target + Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * dist
        _look_at(cam, target)
        pivot.rotation_euler = (0.0, 0.0, a)
        path = os.path.join(out_dir, f"{basename}_{name}.png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        written.append(path)
        print(f"[preview] wrote {path}")
    return written
