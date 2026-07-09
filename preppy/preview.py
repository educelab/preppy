"""Render a proxy preview of a variant's *model* (not just its texture) for the
per-object thumbnail.

The delivered ``.glb`` is meshopt-compressed with KTX2/Basis textures and — per
the viewer contract — carries **no baked normals** (the viewer computes them).
No offline CPU renderer reads that asset, so this renders a *proxy*: it loads the
variant's OBJ geometry + UVs with :mod:`trimesh`, computes vertex normals, swaps
in the already-normalized 8-bit sRGB textures (so the exotic/gigapixel *source*
images are never read — see :class:`NormalizedTextureResolver`), and renders one
offscreen frame with :mod:`pyrender`. It is a recognizable stand-in for what
``<dri-viewer>`` shows, not a pixel-identical capture of the compressed asset.

``trimesh`` + ``pyrender`` are an optional extra (``.[preview]``); import failure
or a headless-GL initialization failure raises :class:`PreviewUnavailable` so the
orchestrator can fall back to the cheap texture center-crop.

``pyrender`` selects its offscreen backend from the environment on Linux
(``PYOPENGL_PLATFORM=egl`` for GPU nodes, ``osmesa`` for pure-CPU); the bundled
Singularity image sets one. On macOS it uses the platform GL via ``pyglet``.
"""

from pathlib import Path
from typing import Mapping, Union

from preppy.texture import parse_hex_color

PathLike = Union[str, Path]

#: Default 3/4 view direction (unit-ish, +z front with mild azimuth/elevation) so
#: the preview reads as 3D rather than a flat face. Normalized at use.
_VIEW_DIR = (0.45, 0.35, 1.0)


class PreviewUnavailable(RuntimeError):
    """Raised when the render toolchain (trimesh/pyrender + a GL backend) is not
    usable, so the caller can fall back to a texture-crop thumbnail."""


def probe() -> "tuple[bool, str]":
    """Best-effort check that the model-preview backend can render offscreen.

    Returns ``(ok, detail)``. Imports trimesh + pyrender and then actually
    initializes an :class:`~pyrender.OffscreenRenderer` and renders a trivial
    scene — the GL-context creation is the part that fails on headless nodes, so
    a bare import check would report a false positive. Used by
    ``voyager-check-tools`` to tell whether the rendered thumbnail is available
    (the pipeline falls back to a texture crop when it is not).
    """
    import os

    try:
        _require_backend()
        import numpy as np
        import pyrender
    except PreviewUnavailable as e:
        return False, str(e)
    except Exception as e:  # unexpected import-time failure
        return False, f'trimesh/pyrender import failed: {e}'

    platform = os.environ.get('PYOPENGL_PLATFORM', 'default')
    try:
        scene = pyrender.Scene()
        scene.add(pyrender.PerspectiveCamera(yfov=1.0), pose=np.eye(4))
        renderer = pyrender.OffscreenRenderer(16, 16)
        try:
            renderer.render(scene)
        finally:
            renderer.delete()
    except Exception as e:
        return False, (f'offscreen GL backend failed to initialize '
                       f'(PYOPENGL_PLATFORM={platform}): {e}')
    return True, f'offscreen GL OK (PYOPENGL_PLATFORM={platform})'


def _require_backend():
    """Import trimesh + pyrender or raise :class:`PreviewUnavailable`."""
    try:
        import trimesh  # noqa: F401
        import pyrender  # noqa: F401
    except ModuleNotFoundError as e:  # the extra is genuinely not installed
        raise PreviewUnavailable(
            f'{e.name!r} not installed; install the "preview" extra: '
            f'pip install ".[preview]"')
    except Exception as e:  # installed, but a GL/pyglet import-time failure
        raise PreviewUnavailable(f'render backend import failed (GL backend?): {e}')


def _look_at(eye, target, up=(0.0, 1.0, 0.0)):
    """4x4 camera-to-world pose looking from ``eye`` toward ``target`` (glTF/
    pyrender convention: camera looks down its local -z)."""
    import numpy as np

    eye = np.asarray(eye, dtype=float)
    target = np.asarray(target, dtype=float)
    up = np.asarray(up, dtype=float)
    forward = target - eye
    n = np.linalg.norm(forward)
    if n == 0:
        forward = np.array([0.0, 0.0, -1.0])
    else:
        forward /= n
    side = np.cross(forward, up)
    sn = np.linalg.norm(side)
    # Guard against a forward vector parallel to up (degenerate side vector).
    side = np.array([1.0, 0.0, 0.0]) if sn == 0 else side / sn
    true_up = np.cross(side, forward)
    pose = np.eye(4)
    pose[:3, 0] = side
    pose[:3, 1] = true_up
    pose[:3, 2] = -forward
    pose[:3, 3] = eye
    return pose


def _make_resolver(obj_path: Path, swap: Mapping[str, Path]):
    """Build a :class:`trimesh.resolvers.FilePathResolver` that serves the
    pre-normalized PNGs in place of the OBJ/MTL's ``map_Kd`` textures (matched by
    basename), so the raw source images — which may be 16-bit CIELab gigapixel
    files — are never decoded. Everything else (the ``.mtl`` itself, etc.) loads
    from disk. A factory because the base class only imports with the backend."""
    from trimesh.resolvers import FilePathResolver

    class NormalizedTextureResolver(FilePathResolver):
        def __init__(self, source, swap_by_basename):
            super().__init__(str(source))
            self._swap = dict(swap_by_basename)

        def get(self, name):
            repl = self._swap.get(Path(name).name)
            if repl is not None:
                return Path(repl).read_bytes()
            return super().get(name)

    by_basename = {Path(k).name: Path(v) for k, v in swap.items()}
    return NormalizedTextureResolver(obj_path, by_basename)


def _frame_camera(scene, yfov: float, margin: float = 1.15):
    """Camera pose that frames ``scene``'s bounds in a mild 3/4 view."""
    import numpy as np

    bounds = scene.bounds  # (2, 3) min/max
    center = bounds.mean(axis=0)
    radius = float(np.linalg.norm(bounds[1] - bounds[0]) / 2.0) or 1.0
    dist = radius / np.sin(yfov / 2.0) * margin
    direction = np.asarray(_VIEW_DIR, dtype=float)
    direction /= np.linalg.norm(direction)
    eye = center + direction * dist
    return _look_at(eye, center), center, dist


def render_preview(obj_path: PathLike, textures: Mapping[str, Path],
                   dst: PathLike, *, size: int = 512,
                   bg: str = 'ffffff') -> Path:
    """Render a proxy preview of the model at ``obj_path`` to ``dst`` (JPEG).

    ``textures`` maps each material's *referenced* texture path (as written in the
    OBJ/MTL, matched by basename) to its already-normalized 8-bit sRGB PNG. ``bg``
    is a hex color (``#`` optional) for the opaque background the model composites
    over. Returns ``dst``.

    Raises :class:`PreviewUnavailable` if the render toolchain cannot be used
    (missing extra, or headless GL initialization failure) — the caller should
    fall back to a texture-crop thumbnail.
    """
    _require_backend()
    import numpy as np
    import pyrender
    import trimesh
    from PIL import Image

    obj_path = Path(obj_path)
    dst = Path(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    bg_rgb = parse_hex_color(bg)

    resolver = _make_resolver(obj_path, textures)
    try:
        scene = trimesh.load(obj_path, resolver=resolver, force='scene',
                             process=False)
    except Exception as e:
        raise PreviewUnavailable(f'trimesh could not load {obj_path}: {e}')

    geometries = list(scene.geometry.values())
    if not geometries:
        raise PreviewUnavailable(f'no geometry loaded from {obj_path}')

    # KTX2/pyrender want truecolor; ImageMagick may emit palette/grayscale PNGs.
    for g in geometries:
        mat = getattr(g.visual, 'material', None)
        img = getattr(mat, 'image', None)
        if img is not None and img.mode != 'RGB':
            mat.image = img.convert('RGB')

    yfov = np.pi / 4.0
    render_scene = pyrender.Scene(bg_color=[0, 0, 0, 0],
                                  ambient_light=[0.4, 0.4, 0.4])
    for g in geometries:
        # smooth=True shades from computed vertex normals, matching the viewer,
        # which also computes (not bakes) normals.
        render_scene.add(pyrender.Mesh.from_trimesh(g, smooth=True))

    cam_pose, center, dist = _frame_camera(scene, yfov)
    render_scene.add(pyrender.PerspectiveCamera(yfov=yfov), pose=cam_pose)
    # A key light offset from the camera plus a fill from the camera itself, so
    # the 3/4 view has visible form without a hard black side.
    key_pose = _look_at(center + np.array([dist, dist, dist]), center)
    render_scene.add(pyrender.DirectionalLight(color=[1, 1, 1], intensity=4.0),
                     pose=key_pose)
    render_scene.add(pyrender.DirectionalLight(color=[1, 1, 1], intensity=2.0),
                     pose=cam_pose)

    try:
        renderer = pyrender.OffscreenRenderer(size, size)
        try:
            color, _ = renderer.render(
                render_scene, flags=pyrender.RenderFlags.RGBA)
        finally:
            renderer.delete()
    except Exception as e:
        raise PreviewUnavailable(f'offscreen render failed: {e}')

    # Composite the RGBA render over the opaque background, save as JPEG.
    rgba = Image.fromarray(color, 'RGBA')
    canvas = Image.new('RGB', rgba.size, bg_rgb)
    canvas.paste(rgba, mask=rgba.split()[3])
    canvas.save(dst, quality=90)
    return dst
