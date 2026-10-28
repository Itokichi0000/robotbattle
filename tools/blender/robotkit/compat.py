"""Version shims. Verified on Blender 4.0.2 (Ubuntu apt build) and 5.2.3 LTS (PyPI bpy)."""

import math

import bpy  # type: ignore

VERSION = bpy.app.version


def eevee_engine() -> str:
    # 4.2–4.5 shipped EEVEE Next under a separate id; 4.0/4.1 and 5.x use BLENDER_EEVEE.
    if (4, 2, 0) <= VERSION < (5, 0, 0):
        return "BLENDER_EEVEE_NEXT"
    return "BLENDER_EEVEE"


def set_smooth_by_angle(mesh, angle_deg: float) -> None:
    """Smooth shading with hard edges above `angle_deg` (auto smooth was removed in 4.1)."""
    mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
    if hasattr(mesh, "set_sharp_from_angle"):
        mesh.set_sharp_from_angle(angle=math.radians(angle_deg))
    else:
        mesh.use_auto_smooth = True
        mesh.auto_smooth_angle = math.radians(angle_deg)


def set_blend_transparent(mat) -> None:
    if hasattr(mat, "surface_render_method"):
        mat.surface_render_method = "BLENDED"
    if hasattr(mat, "blend_method"):
        mat.blend_method = "BLEND"
    if hasattr(mat, "shadow_method"):
        mat.shadow_method = "NONE"
    if hasattr(mat, "use_backface_culling"):
        mat.use_backface_culling = False


def bsdf_input(bsdf, *names):
    """First existing socket among `names` (socket names moved between versions)."""
    for n in names:
        if n in bsdf.inputs:
            return bsdf.inputs[n]
    raise KeyError(f"none of {names} on {bsdf.name}")


def operator_kwargs(op, **kwargs) -> dict:
    """Drop keyword arguments the running Blender's operator does not know."""
    props = op.get_rna_type().properties.keys()
    return {k: v for k, v in kwargs.items() if k in props}


def bloom(scene, enabled: bool) -> None:
    # EEVEE Legacy (≤4.1) has built-in bloom; newer versions need compositor glare,
    # which previews skip (glow still reads from the emissive colour itself).
    eevee = scene.eevee
    if hasattr(eevee, "use_bloom"):
        eevee.use_bloom = enabled
        eevee.bloom_intensity = 0.06
        eevee.bloom_radius = 5.0
        eevee.bloom_threshold = 1.2
