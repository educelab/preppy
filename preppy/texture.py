"""Texture leaf module: normalize exotic source images to 8-bit sRGB PNG and
encode them to KTX2/Basis.

- :func:`normalize` — ImageMagick ``magick`` converts CIELab / 16-bit source
  images to 8-bit sRGB PNG and downsizes anything larger than ``max_dim``. When a
  ``nodata_fill`` color is given it then runs :func:`fill_nodata` on the
  *downsized* image so the saturated fill does not bleed into chart edges through
  the mip chain.
- :func:`fill_nodata` — an in-memory (Pillow + numpy + scipy) nearest-valid-pixel
  fill: every pixel matching the fill color is replaced by its nearest non-fill
  neighbour via a Euclidean distance transform, eliminating the fill entirely so
  nothing bleeds at *any* mip level. This replaces an earlier ImageMagick
  ``-morphology Dilate`` step that ran at full source resolution before the
  resize and hung on gigapixel textures (a 32768² source is ~1 Gpx; a diamond-16
  dilation over it never returns in practice).
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

    The no-data fill is *not* done here — it runs in-memory on the downsized
    output (:func:`fill_nodata`), so the expensive per-pixel work never touches
    the full-resolution source.
    """
    return ['magick', str(src),
            '-resize', f'{max_dim}x{max_dim}>',
            '-colorspace', 'sRGB', '-depth', '8', str(dst)]


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


def fill_nodata(path: PathLike, nodata_fill: str, *, fuzz: float = 0.05) -> Path:
    """Replace every ``nodata_fill``-colored pixel in ``path`` with its nearest
    non-fill neighbour, in place; return ``path``.

    Pixels within ``fuzz`` (a fraction of the full RGB diagonal) of the fill
    color are treated as no-data and back-filled from the nearest valid chart
    pixel via :func:`scipy.ndimage.distance_transform_edt`. Because *all* fill is
    eliminated (not just an N-pixel ring), the fill cannot bleed into chart edges
    at any mip level. A no-op when nothing matches (or everything matches, which
    would leave nothing to fill from).
    """
    import numpy as np
    from PIL import Image
    from scipy import ndimage

    path = Path(path)
    arr = np.asarray(Image.open(path).convert('RGB'))
    fill = np.array(parse_hex_color(nodata_fill), dtype=np.int16)

    # Squared Euclidean distance to the fill color; compare against a squared
    # threshold to avoid the sqrt. Full diagonal is sqrt(3)*255.
    diff = arr.astype(np.int16) - fill
    dist2 = np.einsum('...c,...c->...', diff, diff)  # sum of squares per pixel
    tol = fuzz * (3.0 ** 0.5) * 255.0
    mask = dist2 <= tol * tol

    if not mask.any() or mask.all():
        return path  # nothing to fill, or nothing valid to fill from

    # For each no-data pixel (mask True), index of the nearest valid pixel.
    idx = ndimage.distance_transform_edt(
        mask, return_distances=False, return_indices=True)
    filled = arr[tuple(idx)]
    Image.fromarray(filled, 'RGB').save(path)
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

    ImageMagick handles the color-correct decode + resize; when ``nodata_fill``
    is given, the fill is then eliminated in-memory on the downsized image
    (:func:`fill_nodata`). ``dst`` defaults to ``<src stem>.png`` in ``tmp_dir``
    (or beside ``src`` if no ``tmp_dir`` given).
    """
    tools.require('magick')
    src = Path(src)
    if dst is None:
        out_dir = Path(tmp_dir) if tmp_dir is not None else src.parent
        out_dir.mkdir(parents=True, exist_ok=True)
        dst = out_dir / f'{src.stem}.png'
    dst = Path(dst)

    tools.run(normalize_cmd(src, dst, max_dim=max_dim))
    if nodata_fill is not None:
        fill_nodata(dst, nodata_fill, fuzz=fuzz)
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
