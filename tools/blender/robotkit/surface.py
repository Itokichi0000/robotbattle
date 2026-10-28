"""
Procedural surface detail for the *source* materials (baked into the atlas later):
panel lines, edge softening, roughness breakup, and two generated tile patterns —
seigaiha waves (RAIJIN armour) and a glowing circuit network (FUJIN armour).
Everything is generated here (numpy), so no external texture files are needed.
"""

import random

import bpy  # type: ignore
import numpy as np

from . import compat

# --------------------------------------------------------------------------- tile generators


def _seigaiha(size, rings=4, cols=4):
    """
    Seigaiha (青海波) scale pattern: rows of overlapping concentric discs, each lower row
    drawn over the one above, so only the upper fan of every disc shows. Tileable.
    """
    y, x = np.mgrid[0:size, 0:size].astype(np.float32) / size
    R = 1.0 / cols
    row_h = R / 2
    nrows = int(round(1.0 / row_h))
    best = np.full((size, size), np.inf, dtype=np.float32)  # wrapped (pixel - centre) y offset
    best_d = np.zeros((size, size), dtype=np.float32)
    for r in range(nrows):
        cy = r * row_h
        off = (R / 2) if r % 2 else 0.0
        for c in range(cols):
            cx = c * R + off
            dx = (x - cx + 0.5) % 1.0 - 0.5
            dy = (y - cy + 0.5) % 1.0 - 0.5
            d = np.sqrt(dx * dx + dy * dy)
            # The front-most covering disc is the one whose centre lies furthest below the pixel.
            upd = (d < R) & (dy < best)
            best = np.where(upd, dy, best)
            best_d = np.where(upd, d, best_d)
    t = best_d / R * rings
    f = t - np.floor(t)
    line = np.clip(1.0 - np.minimum(f, 1.0 - f) / 0.14, 0.0, 1.0)
    return line.astype(np.float32)


def _circuit(size, cells=12, seed=7):
    """Glowing circuit network: random traces between grid nodes (0/45/90°) with pads. Tileable."""
    rnd = random.Random(seed)
    img = np.zeros((size, size), dtype=np.float32)
    step = size / cells
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)
    width = size * 0.0032
    edges = set()
    degree = {}
    for i in range(cells):
        for j in range(cells):
            for di, dj in ((1, 0), (0, 1), (1, 1), (1, -1)):
                p = 0.42 if di == 0 or dj == 0 else 0.16
                if rnd.random() < p:
                    a, b = (i, j), (i + di, j + dj)
                    edges.add((a, b))
                    for n in (a, (b[0] % cells, b[1] % cells)):
                        degree[n] = degree.get(n, 0) + 1

    def seg(x0, y0, x1, y1):
        nonlocal img
        for ox in (-size, 0, size):  # wrap so the tile repeats seamlessly
            for oy in (-size, 0, size):
                ax, ay, bx, by = x0 + ox, y0 + oy, x1 + ox, y1 + oy
                lo_x, hi_x = int(max(0, min(ax, bx) - 3 * width)), int(min(size, max(ax, bx) + 3 * width + 1))
                lo_y, hi_y = int(max(0, min(ay, by) - 3 * width)), int(min(size, max(ay, by) + 3 * width + 1))
                if lo_x >= hi_x or lo_y >= hi_y:
                    continue
                px, py = x[lo_y:hi_y, lo_x:hi_x], y[lo_y:hi_y, lo_x:hi_x]
                vx, vy = bx - ax, by - ay
                L2 = vx * vx + vy * vy or 1.0
                t = np.clip(((px - ax) * vx + (py - ay) * vy) / L2, 0, 1)
                d = np.hypot(px - (ax + t * vx), py - (ay + t * vy))
                v = np.clip(1.0 - (d - width) / 1.2, 0, 1)
                img[lo_y:hi_y, lo_x:hi_x] = np.maximum(img[lo_y:hi_y, lo_x:hi_x], v)

    def pad(cx, cy, r, ring):
        for ox in (-size, 0, size):
            for oy in (-size, 0, size):
                d = np.hypot(x - cx - ox, y - cy - oy)
                v = np.clip(1.0 - np.abs(d - r) / 1.3, 0, 1) if ring else np.clip(1.0 - (d - r) / 1.2, 0, 1)
                np.maximum(img, v, out=img)

    for (i, j), (k, m) in edges:
        seg((i + 0.5) * step, (j + 0.5) * step, (k + 0.5) * step, (m + 0.5) * step)
    for (i, j), deg in degree.items():
        if deg == 1:
            pad((i + 0.5) * step, (j + 0.5) * step, width * 2.6, True)
        elif deg >= 4:
            pad((i + 0.5) * step, (j + 0.5) * step, width * 1.8, False)
    return img


def _nodes(size, count=26, seed=11):
    """
    Lightning-Network-like motif: glowing nodes joined to their nearest neighbours by thin
    straight routes (an abstract graph, not a real topology). Tileable.
    """
    rnd = random.Random(seed)
    pts = []
    while len(pts) < count:  # Poisson-disc style spacing so nodes do not clump
        p = (rnd.random(), rnd.random())
        if all(
            min(abs(p[0] - q[0]), 1 - abs(p[0] - q[0])) ** 2 + min(abs(p[1] - q[1]), 1 - abs(p[1] - q[1])) ** 2 > 0.012
            for q in pts
        ):
            pts.append(p)
    img = np.zeros((size, size), dtype=np.float32)
    y, x = np.mgrid[0:size, 0:size].astype(np.float32) / size

    def wrap_d(a, b):
        d = (a - b + 0.5) % 1.0 - 0.5
        return d

    edges = set()
    for i, p in enumerate(pts):
        near = sorted(
            range(len(pts)),
            key=lambda j: wrap_d(pts[j][0], p[0]) ** 2 + wrap_d(pts[j][1], p[1]) ** 2,
        )[1:3]
        for j in near:
            edges.add((min(i, j), max(i, j)))
    line_w = 0.006
    for i, j in edges:
        p, q = pts[i], pts[j]
        vx, vy = wrap_d(q[0], p[0]), wrap_d(q[1], p[1])
        px, py = wrap_d(x, p[0]), wrap_d(y, p[1])
        L2 = vx * vx + vy * vy
        t = np.clip((px * vx + py * vy) / L2, 0, 1)
        d = np.hypot(px - t * vx, py - t * vy)
        np.maximum(img, np.clip(1.0 - (d - line_w) * size / 1.5, 0, 1) * 0.85, out=img)
    for p in pts:
        d = np.hypot(wrap_d(x, p[0]), wrap_d(y, p[1]))
        r = 0.022 + 0.012 * rnd.random()
        np.maximum(img, np.clip(1.0 - (d - r) * size / 1.5, 0, 1), out=img)
    return img


GENERATORS = {"seigaiha": _seigaiha, "circuit": _circuit, "nodes": _nodes}


def pattern_image(kind, size=512):
    name = f"SW_Pattern_{kind}"
    img = bpy.data.images.get(name)
    if img:
        return img
    data = GENERATORS[kind](size)
    rgba = np.empty((size, size, 4), dtype=np.float32)
    rgba[..., 0] = rgba[..., 1] = rgba[..., 2] = data
    rgba[..., 3] = 1.0
    img = bpy.data.images.new(name, size, size, alpha=False)
    img.colorspace_settings.name = "Non-Color"
    img.pixels.foreach_set(rgba.ravel())
    img.pack()
    img.use_fake_user = True
    return img


# --------------------------------------------------------------------------- node helpers


class _Graph:
    def __init__(self, mat):
        self.mat = mat
        self.nt = mat.node_tree
        self.bsdf = next(n for n in self.nt.nodes if n.type == "BSDF_PRINCIPLED")
        self.x = -900

    def node(self, kind, **props):
        n = self.nt.nodes.new(kind)
        n.location = (self.x, -200 * len(self.nt.nodes) % 1600)
        for k, v in props.items():
            setattr(n, k, v)
        return n

    def link(self, a, b):
        self.nt.links.new(a, b)

    def math(self, op, a, b=None, clamp=False):
        n = self.node("ShaderNodeMath", operation=op, use_clamp=clamp)
        for i, v in enumerate((a, b)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                self.link(v, n.inputs[i])
        return n.outputs[0]

    def coords(self):
        tc = self.node("ShaderNodeTexCoord")
        return tc.outputs["Object"], tc.outputs["Normal"]

    def mix_color(self, factor, a, b, blend="MIX"):
        n = self.node("ShaderNodeMix", data_type="RGBA", blend_type=blend)
        self.link(factor, n.inputs[0])
        for sock, v in ((n.inputs[6], a), (n.inputs[7], b)):
            if isinstance(v, tuple):
                sock.default_value = v
            else:
                self.link(v, sock)
        return n.outputs[2]

    def input_value(self, name):
        sock = compat.bsdf_input(self.bsdf, name)
        if sock.is_linked:
            return sock.links[0].from_socket
        v = sock.default_value
        return tuple(v) if hasattr(v, "__len__") else v

    def bump_chain(self):
        """Socket feeding the BSDF normal so several bumps/bevels can stack."""
        sock = compat.bsdf_input(self.bsdf, "Normal")
        return sock.links[0].from_socket if sock.is_linked else None


def panel_mask(g, spacing=(0.32, 0.30, 0.26), width=0.006):
    """Grid of panel lines in object space, suppressing the axis along the surface normal."""
    obj, nrm = g.coords()
    sep = g.node("ShaderNodeSeparateXYZ")
    g.link(obj, sep.inputs[0])
    sepn = g.node("ShaderNodeSeparateXYZ")
    g.link(nrm, sepn.inputs[0])
    out = None
    for axis, sp in enumerate(spacing):
        p = g.math("MULTIPLY", sep.outputs[axis], 1.0 / sp)
        d = g.math("PINGPONG", p, 0.5)  # distance to the nearest grid line, in cells
        d = g.math("MULTIPLY", d, sp)  # back to metres
        line = g.math("SUBTRACT", 1.0, g.math("DIVIDE", d, width), clamp=True)
        along = g.math("ABSOLUTE", sepn.outputs[axis])
        w = g.math("SUBTRACT", 1.0, g.math("MULTIPLY", along, 1.15), clamp=True)
        lw = g.math("MULTIPLY", line, w)
        out = lw if out is None else g.math("MAXIMUM", out, lw)
    return out


def tiled_mask(g, image, scale):
    """Box-projected tile pattern (no UVs needed: works on any part before the atlas exists)."""
    obj, _n = g.coords()
    m = g.node("ShaderNodeMapping")
    m.inputs["Scale"].default_value = (scale, scale, scale)
    g.link(obj, m.inputs["Vector"])
    t = g.node("ShaderNodeTexImage", image=image, projection="BOX", projection_blend=0.25, interpolation="Linear")
    g.link(m.outputs["Vector"], t.inputs["Vector"])
    return t.outputs["Color"]


def detail(
    mat,
    *,
    panels=True,
    panel_darken=0.45,
    spacing=(0.32, 0.30, 0.26),
    bevel_radius=0.01,
    rough_noise=0.12,
    pattern=None,
    pattern_scale=2.0,
    pattern_mode="emboss",
    pattern_color=None,
    pattern_strength=0.0,
    pattern_patches=0.0,
    pattern_tint=None,
    seam_glow=None,
    bump=0.35,
):
    """Add procedural detail to a source material in place."""
    g = _Graph(mat)
    base = g.input_value("Base Color")
    height = None

    if panels:
        pm = panel_mask(g, spacing)
        darker = tuple(c * (1.0 - panel_darken) for c in base[:3]) + (1.0,) if isinstance(base, tuple) else base
        base_out = g.mix_color(pm, base, darker)
        g.link(base_out, compat.bsdf_input(g.bsdf, "Base Color"))
        base = base_out
        height = g.math("MULTIPLY", pm, -1.0)
        if seam_glow:
            # Glowing seams between armour blocks ("PoW" stacked-block look), in patches.
            color, strength, patches = seam_glow
            seam = pm
            if patches:
                obj, _n = g.coords()
                nz = g.node("ShaderNodeTexNoise")
                nz.inputs["Scale"].default_value = patches
                nz.inputs["Detail"].default_value = 1.0
                g.link(obj, nz.inputs["Vector"])
                ramp = g.node("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP")
                ramp.inputs["From Min"].default_value = 0.52  # roughly a third of the seams glow
                ramp.inputs["From Max"].default_value = 0.60
                g.link(nz.outputs["Fac"], ramp.inputs["Value"])
                seam = g.math("MULTIPLY", pm, ramp.outputs["Result"])
            col = g.mix_color(seam, (0, 0, 0, 1), (*color, 1.0))
            g.link(col, compat.bsdf_input(g.bsdf, "Emission Color", "Emission"))
            compat.bsdf_input(g.bsdf, "Emission Strength").default_value = strength

    if pattern:
        pat = tiled_mask(g, pattern_image(pattern), pattern_scale)
        bw = g.node("ShaderNodeRGBToBW")
        g.link(pat, bw.inputs[0])
        mask = bw.outputs[0]
        if pattern_patches:
            # Large-scale noise keeps the pattern to patches instead of wallpapering every surface.
            obj, _n = g.coords()
            nz = g.node("ShaderNodeTexNoise")
            nz.inputs["Scale"].default_value = pattern_patches
            nz.inputs["Detail"].default_value = 1.0
            g.link(obj, nz.inputs["Vector"])
            ramp = g.node("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP")
            ramp.inputs["From Min"].default_value = 0.47
            ramp.inputs["From Max"].default_value = 0.55
            g.link(nz.outputs["Fac"], ramp.inputs["Value"])
            mask = g.math("MULTIPLY", mask, ramp.outputs["Result"])
        if pattern_mode == "emboss":
            lighter = g.mix_color(g.math("MULTIPLY", mask, 0.35), base, (1.0, 0.92, 0.75, 1.0), "SCREEN")
            g.link(lighter, compat.bsdf_input(g.bsdf, "Base Color"))
            h = g.math("MULTIPLY", mask, 0.5)
            height = h if height is None else g.math("ADD", height, h)
        else:  # glowing traces
            if pattern_tint:  # darken the albedo under the traces so they read on light armour
                tinted = g.mix_color(mask, base, (*pattern_tint, 1.0))
                g.link(tinted, compat.bsdf_input(g.bsdf, "Base Color"))
            col = g.mix_color(mask, (0, 0, 0, 1), (*pattern_color, 1.0))
            g.link(col, compat.bsdf_input(g.bsdf, "Emission Color", "Emission"))
            compat.bsdf_input(g.bsdf, "Emission Strength").default_value = pattern_strength
            h = g.math("MULTIPLY", mask, -0.5)
            height = h if height is None else g.math("ADD", height, h)

    if rough_noise:
        obj, _n = g.coords()
        nz = g.node("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = 6.0
        nz.inputs["Detail"].default_value = 4.0
        g.link(obj, nz.inputs["Vector"])
        r0 = compat.bsdf_input(g.bsdf, "Roughness").default_value
        rr = g.math(
            "ADD", g.math("MULTIPLY", g.math("SUBTRACT", nz.outputs["Fac"], 0.5), rough_noise * 2), r0, clamp=True
        )
        g.link(rr, compat.bsdf_input(g.bsdf, "Roughness"))

    normal = None
    if bevel_radius:
        bv = g.node("ShaderNodeBevel", samples=8)
        bv.inputs["Radius"].default_value = bevel_radius
        normal = bv.outputs["Normal"]
    if height is not None:
        b = g.node("ShaderNodeBump")
        b.inputs["Strength"].default_value = bump
        b.inputs["Distance"].default_value = 0.01
        g.link(height, b.inputs["Height"])
        if normal is not None:
            g.link(normal, b.inputs["Normal"])
        normal = b.outputs["Normal"]
    if normal is not None:
        g.link(normal, compat.bsdf_input(g.bsdf, "Normal"))
    return mat
