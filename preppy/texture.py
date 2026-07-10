"""Texture leaf module: normalize exotic source images to 8-bit sRGB PNG and
encode them to KTX2/Basis.

- :func:`normalize` — ImageMagick ``magick`` converts CIELab / 16-bit source
  images to 8-bit sRGB PNG and downsizes anything larger than ``max_dim``. When a
  ``nodata_fill`` color is given the downscale is made *nodata-aware* so the
  saturated fill never blends into the chart edges: the fill color is masked to
  alpha 0 at full resolution (a cheap per-pixel threshold, ``-transparent``) and
  ImageMagick's alpha-weighted (premultiplied) resize then downsizes it, so a
  masked pixel contributes *nothing* to the resampled edge pixels. The still-
  transparent background is finally back-filled by :func:`fill_transparent`.
  Doing the mask before the resize is the whole point — resizing first (the old
  order) blended orange into UV-island edges, and a color-keyed back-fill then
  seeded itself from those orange-tinted edges, rimming every island (feedback #1).
- :func:`fill_transparent` — an in-memory (Pillow + numpy + scipy) nearest-valid-
  pixel fill keyed on the *alpha* channel: every fully-transparent (masked) pixel
  is replaced by its nearest opaque neighbour via a Euclidean distance transform,
  then the alpha channel is dropped. Because *all* masked pixels are replaced by
  real chart color (not the fill color), nothing bleeds at *any* mip level. It
  runs on the already-downsized image, keeping the distance transform off the
  gigapixel path — an earlier full-resolution ImageMagick ``-morphology Dilate``
  hung on gigapixel textures (a 32768² source is ~1 Gpx; a diamond-16 dilation
  over it never returns in practice).
- :func:`encode_ktx2` — ``ktx create`` (KTX-Software >= v5) encodes the PNG to a
  mipmapped KTX2, ETC1S (``basis-lz``) by default or UASTC.

The ImageMagick command-building is factored into pure ``*_cmd`` helpers so it
can be unit tested without the tools installed.
"""

from pathlib import Path
from typing import List, Optional, Tuple, Union

from preppy import tools

PathLike = Union[str, Path]

#: KTX2 encode modes -> ``ktx create --encode`` codec.
_KTX_CODECS = {'etc1s': 'basis-lz', 'uastc': 'uastc'}


def normalize_cmd(src: Path, dst: Path, max_dim: int = 8192) -> List[str]:
    """Build the ``magick`` argv that normalizes ``src`` to an 8-bit sRGB PNG.

    - ``-colorspace sRGB -depth 8`` converts exotic inputs (CIELab, 16-bit) to
      8-bit sRGB, the only correct color path for these textures.
    - ``-resize {max_dim}x{max_dim}>`` shrinks only images larger than the limit
      (the ``>`` flag never upscales).

    The no-data fill is *not* done here; when a fill color is configured the
    orchestrator uses :func:`normalize_masked_cmd` instead, which masks the fill
    before the resize. This plain path is the no-fill case.
    """
    return ['magick', str(src),
            '-resize', f'{max_dim}x{max_dim}>',
            '-colorspace', 'sRGB', '-depth', '8', str(dst)]


def normalize_masked_cmd(src: Path, dst: Path, nodata_fill: str, *,
                         max_dim: int = 8192, fuzz: float = 0.05) -> List[str]:
    """Build the ``magick`` argv for the nodata-aware normalize (RGBA output).

    Ordering is load-critical: the fill color is converted to 8-bit sRGB and
    masked to alpha 0 (``-transparent``) *at full resolution*, and only then is
    the image resized. ImageMagick's resize is alpha-weighted (premultiplied), so
    a masked pixel contributes nothing to the resampled edge pixels — the fill
    can never blend into a UV-island edge. Resizing first (see
    :func:`normalize_cmd`) is exactly the bug this avoids. ``PNG32:`` forces an
    RGBA output so :func:`fill_transparent` can read the mask back.

    ``-transparent`` is a cheap per-pixel threshold (unlike the distance
    transform / dilate), so running it on the full-resolution source is fine.
    ``fuzz`` is a fraction of the color-distance range, passed to ImageMagick as
    a percentage.
    """
    r, g, b = parse_hex_color(nodata_fill)   # validates; IM rejects bare hex
    color = f'#{r:02x}{g:02x}{b:02x}'
    return ['magick', str(src),
            '-colorspace', 'sRGB', '-depth', '8',
            '-fuzz', f'{fuzz * 100:g}%', '-transparent', color,
            '-resize', f'{max_dim}x{max_dim}>',
            f'PNG32:{dst}']


def parse_hex_color(color: str) -> Tuple[int, int, int]:
    """Parse a hex color to an ``(r, g, b)`` 0-255 tuple.

    Accepts ``'ff7f25'`` or ``'#ff7f25'`` (6 digit) and the 3-digit shorthand
    ``'f72'``. The leading ``#`` is optional because config files routinely omit
    it — ImageMagick, by contrast, *rejects* a bare hex string as an unknown
    color, which silently disabled the old fill path.
    """
    s = color.lstrip('#').strip()
    if len(s) == 3:
        s = ''.join(c * 2 for c in s)
    if len(s) != 6:
        raise ValueError(f'invalid hex color {color!r}; expected #rrggbb or rgb')
    try:
        return int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16)
    except ValueError:
        raise ValueError(f'invalid hex color {color!r}; expected #rrggbb or rgb')


def fill_transparent(path: PathLike) -> Path:
    """Composite the masked RGBA ``path`` over a nodata back-fill, drop the alpha
    channel, and rewrite ``path`` as RGB in place; return ``path``.

    :func:`normalize_masked_cmd`'s alpha-weighted resize leaves the nodata
    background at alpha 0 and the island rims at *partial* alpha (fractional
    coverage). Two rules keep any trace of the fill off the rendered surface:

    - The back-fill is extruded (nearest-neighbour, via
      :func:`scipy.ndimage.distance_transform_edt`) only from **fully-opaque**
      pixels — real chart color, no fill contribution — so extruding it can never
      reintroduce the fill.
    - The result is the resized image *composited over* that back-fill
      (``alpha*rgb + (1-alpha)*fill``), not the un-premultiplied color. Dividing a
      thin rim by its small alpha would amplify sub-pixel noise into saturated
      speckle (a fringe); compositing weights each rim pixel by its true coverage
      instead, so a nearly-transparent rim contributes almost nothing.

    Runs on the already-downsized image, keeping the distance transform off the
    gigapixel path. A plain RGB PNG (no alpha) is returned unchanged.
    """
    import numpy as np
    from PIL import Image

    path = Path(path)
    img = Image.open(path)
    if img.mode != 'RGBA':
        return path  # no mask to act on (plain no-fill path)

    arr = np.asarray(img).astype(np.float32)
    rgb, alpha = arr[..., :3], arr[..., 3:4] / 255.0
    solid = arr[..., 3] == 255            # fully-valid chart pixels only

    fill = rgb
    if solid.any() and not solid.all():
        from scipy import ndimage
        # For every pixel, the color of the nearest fully-opaque chart pixel.
        idx = ndimage.distance_transform_edt(
            ~solid, return_distances=False, return_indices=True)
        fill = rgb[tuple(idx)]

    out = alpha * rgb + (1.0 - alpha) * fill
    out = np.ascontiguousarray(np.rint(out).clip(0, 255).astype(np.uint8))
    Image.fromarray(out, 'RGB').save(path)
    return path


def encode_ktx2_cmd(png: Path, dst: Path, mode: str = 'etc1s',
                    threads: Optional[int] = None) -> List[str]:
    """Build the ``ktx create`` argv that encodes ``png`` to a KTX2.

    Uses ``R8G8B8_SRGB`` (photogrammetry textures carry no alpha), forces the
    sRGB transfer function, generates a full mip chain, and encodes to ETC1S
    (``basis-lz``) or UASTC per ``mode``.
    """
    try:
        codec = _KTX_CODECS[mode]
    except KeyError:
        raise ValueError(
            f'unknown KTX2 mode {mode!r}; expected one of {sorted(_KTX_CODECS)}')

    cmd: List[str] = [
        'ktx', 'create',
        '--format', 'R8G8B8_SRGB',
        '--assign-tf', 'srgb',
        '--encode', codec,
        '--generate-mipmap',
    ]
    if threads is not None:
        cmd += ['--threads', str(threads)]
    cmd += [str(png), str(dst)]
    return cmd


def thumbnail_cmd(src: Path, dst: Path, size: int = 512) -> List[str]:
    """Build the ``magick`` argv for a square, center-cropped thumbnail.

    ``-resize {size}x{size}^`` fills the box (shortest side = ``size``), then
    ``-gravity center -extent`` crops to a centered square. Cheap, no offscreen
    GL (A5 — thumbnails come from the default variant's normalized texture).
    """
    return ['magick', str(src),
            '-resize', f'{size}x{size}^',
            '-gravity', 'center', '-extent', f'{size}x{size}',
            str(dst)]


def thumbnail(src: PathLike, dst: PathLike, *, size: int = 512) -> Path:
    """Write a square center-cropped thumbnail of ``src`` to ``dst``; return it."""
    tools.require('magick')
    src, dst = Path(src), Path(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    tools.run(thumbnail_cmd(src, dst, size=size))
    return dst


def normalize(src: PathLike, dst: Optional[PathLike] = None, *,
              tmp_dir: Optional[PathLike] = None, max_dim: int = 8192,
              nodata_fill: Optional[str] = None, fuzz: float = 0.05) -> Path:
    """Normalize ``src`` to an 8-bit sRGB PNG and return the output path.

    ImageMagick handles the color-correct decode + resize. When ``nodata_fill``
    is given the downscale is made nodata-aware (:func:`normalize_masked_cmd`):
    the fill is masked to alpha 0 at full resolution and dropped from the resized
    edge pixels, then :func:`fill_transparent` back-fills the still-transparent
    background from real chart color. Keeping the decode + colorspace conversion
    inside ImageMagick means this works for exotic sources (CIELab / 16-bit)
    regardless of whether a colorspace conversion is actually needed. ``dst``
    defaults to ``<src stem>.png`` in ``tmp_dir`` (or beside ``src`` if no
    ``tmp_dir`` given).
    """
    tools.require('magick')
    src = Path(src)
    if dst is None:
        out_dir = Path(tmp_dir) if tmp_dir is not None else src.parent
        out_dir.mkdir(parents=True, exist_ok=True)
        dst = out_dir / f'{src.stem}.png'
    dst = Path(dst)

    if nodata_fill is None:
        tools.run(normalize_cmd(src, dst, max_dim=max_dim))
    else:
        tools.run(normalize_masked_cmd(src, dst, nodata_fill,
                                       max_dim=max_dim, fuzz=fuzz))
        fill_transparent(dst)
    return dst


def encode_ktx2(png: PathLike, dst: Optional[PathLike] = None, *,
                mode: str = 'etc1s', threads: Optional[int] = None) -> Path:
    """Encode ``png`` to a mipmapped KTX2 and return the output path.

    ``dst`` defaults to ``<png stem>.ktx2`` beside the PNG.
    """
    tools.require('ktx')
    png = Path(png)
    dst = Path(dst) if dst is not None else png.with_suffix('.ktx2')

    cmd = encode_ktx2_cmd(png, dst, mode=mode, threads=threads)
    tools.run(cmd)
    return dst
