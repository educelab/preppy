"""Texture leaf module: normalize exotic source images to 8-bit sRGB PNG and
encode them to KTX2/Basis.

Two steps, each a thin, testable wrapper over an external CLI (see the validated
chain in the Phase 0 findings):

- :func:`normalize` — ImageMagick ``magick`` converts CIELab / 16-bit source
  images to 8-bit sRGB PNG, downsizes anything larger than ``max_dim``, and
  optionally edge-dilates chart content over a ``nodata_fill`` color so the fill
  does not bleed into chart edges through the mip chain.
- :func:`encode_ktx2` — ``ktx create`` (KTX-Software >= v5) encodes the PNG to a
  mipmapped KTX2, ETC1S (``basis-lz``) by default or UASTC.

The command-building is factored into pure ``*_cmd`` helpers so it can be unit
tested without the tools installed.
"""

import subprocess as sp
from pathlib import Path
from typing import List, Optional, Union

from preppy import tools

PathLike = Union[str, Path]

#: KTX2 encode modes -> ``ktx create --encode`` codec.
_KTX_CODECS = {'etc1s': 'basis-lz', 'uastc': 'uastc'}


def normalize_cmd(src: Path, dst: Path, max_dim: int = 8192,
                  nodata_fill: Optional[str] = None, fuzz: str = '5%',
                  dilate: int = 16) -> List[str]:
    """Build the ``magick`` argv that normalizes ``src`` to an 8-bit sRGB PNG.

    - ``-colorspace sRGB -depth 8`` converts exotic inputs (CIELab, 16-bit) to
      8-bit sRGB, the only correct color path for these textures.
    - ``-resize {max_dim}x{max_dim}>`` shrinks only images larger than the limit
      (the ``>`` flag never upscales).
    - When ``nodata_fill`` is given, chart content is edge-dilated over the fill
      color before the resize so the saturated fill cannot bleed into chart
      edges via mipmaps. ``fuzz`` is the color-match tolerance and ``dilate`` the
      number of pixel rings to grow (enough to cover the mip footprint).

    Note: the dilation path is unvalidated on real no-data data (Phase 0 F4 ran
    without dilation); the ``nodata_fill=None`` path is the validated default.
    """
    cmd: List[str] = ['magick', str(src)]

    if nodata_fill is not None:
        # Mask the fill to transparent, grow the remaining (opaque) chart pixels
        # outward by `dilate` rings via max-dilation, keep originals on top
        # (DstOver), then drop the alpha for an opaque texture.
        cmd += ['-alpha', 'set', '-fuzz', fuzz, '-transparent', nodata_fill]
        cmd += ['(', '+clone', '-channel', 'RGBA',
                '-morphology', 'Dilate', f'Diamond:{dilate}', '+channel', ')',
                '-compose', 'DstOver', '-composite']
        cmd += ['-alpha', 'off']

    cmd += ['-resize', f'{max_dim}x{max_dim}>']
    cmd += ['-colorspace', 'sRGB', '-depth', '8', str(dst)]
    return cmd


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


def normalize(src: PathLike, dst: Optional[PathLike] = None, *,
              tmp_dir: Optional[PathLike] = None, max_dim: int = 8192,
              nodata_fill: Optional[str] = None, fuzz: str = '5%',
              dilate: int = 16) -> Path:
    """Normalize ``src`` to an 8-bit sRGB PNG and return the output path.

    ``dst`` defaults to ``<src stem>.png`` in ``tmp_dir`` (or beside ``src`` if
    no ``tmp_dir`` given).
    """
    tools.require('magick')
    src = Path(src)
    if dst is None:
        out_dir = Path(tmp_dir) if tmp_dir is not None else src.parent
        out_dir.mkdir(parents=True, exist_ok=True)
        dst = out_dir / f'{src.stem}.png'
    dst = Path(dst)

    cmd = normalize_cmd(src, dst, max_dim=max_dim, nodata_fill=nodata_fill,
                        fuzz=fuzz, dilate=dilate)
    sp.run(cmd, check=True)
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
    sp.run(cmd, check=True)
    return dst
