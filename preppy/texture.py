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
  mipmapped KTX2, ETC1S (``basis-lz``, default effort) by default or UASTC.
- :func:`validate_ktx2` — the texture gate (preppy#5): decodes every mip level of
  an encoded KTX2 and compares it against the same mip chain left uncompressed,
  flagging levels where whole 4x4 blocks came out the wrong colour.

The ImageMagick command-building is factored into pure ``*_cmd`` helpers so it
can be unit tested without the tools installed.
"""

import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Sequence, Tuple, Union

from preppy import tools

PathLike = Union[str, Path]

#: KTX2 encode modes -> the ``ktx create`` codec options. ETC1S runs at the
#: encoder's default effort, stated explicitly. That needs the patched encoder
#: (docker/patches/ktx-software): an unpatched one miscomputes the average colour
#: of large bright clusters and encodes them as flat grey blocks (preppy#5).
_KTX_CODEC_ARGS = {
    'etc1s': ['--encode', 'basis-lz', '--clevel', '1'],
    'uastc': ['--encode', 'uastc'],
}

#: The KTX-Software patch ETC1S encoding needs, as declared by the build in
#: ``PREPPY_KTX_PATCHES`` (docker/patches/ktx-software/0001-<this id>.patch).
REQUIRED_KTX_PATCH = 'basisu-etc1-optimizer-double-average'


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


def ktx2_codec_args(mode: str = 'etc1s') -> List[str]:
    """Return the ``ktx create`` codec options for KTX2 ``mode``.

    The same options :func:`encode_ktx2_cmd` passes, exposed so the output hash
    can include them: a change to the encode settings must rename the asset.
    """
    try:
        return list(_KTX_CODEC_ARGS[mode])
    except KeyError:
        raise ValueError(
            f'unknown KTX2 mode {mode!r}; expected one of '
            f'{sorted(_KTX_CODEC_ARGS)}')


def encode_ktx2_cmd(png: Path, dst: Path, mode: str = 'etc1s',
                    threads: Optional[int] = None) -> List[str]:
    """Build the ``ktx create`` argv that encodes ``png`` to a KTX2.

    Uses ``R8G8B8_SRGB`` (photogrammetry textures carry no alpha), forces the
    sRGB transfer function, generates a full mip chain, and encodes to ETC1S
    (``basis-lz``) or UASTC per ``mode`` (see :func:`ktx2_codec_args`).
    """
    return _create_cmd(png, dst, ktx2_codec_args(mode), threads)


def reference_ktx2_cmd(png: Path, dst: Path,
                       threads: Optional[int] = None) -> List[str]:
    """Build the ``ktx create`` argv for the texture gate's reference: the same
    mip chain :func:`encode_ktx2_cmd` generates, left uncompressed.

    Sharing the encode's mip filter matters: against a differently-filtered
    reference (e.g. a box downsample), detailed textures differ more at every
    smaller level and read as compression defects.
    """
    return _create_cmd(png, dst, [], threads)


def _create_cmd(png: Path, dst: Path, codec: List[str],
                threads: Optional[int]) -> List[str]:
    cmd: List[str] = [
        'ktx', 'create',
        '--format', 'R8G8B8_SRGB',
        '--assign-tf', 'srgb',
        *codec,
        '--generate-mipmap',
    ]
    if threads is not None:
        cmd += ['--threads', str(threads)]
    cmd += [str(png), str(dst)]
    return cmd


def extract_levels_cmd(ktx2: Path, out_dir: Path,
                       transcode: bool = True) -> List[str]:
    """Build the ``ktx extract`` argv that writes every mip level of ``ktx2`` as
    tightly packed RGB8 ``.raw`` into ``out_dir``. Raw rather than PNG: on an 8K
    chain, PNG output takes ~8 s and raw ~1 s, before the Python-side decode.
    ``transcode`` decodes a Basis (ETC1S/UASTC) payload to RGB8 first; an
    uncompressed KTX2 is extracted as-is (``ktx`` refuses to transcode one).
    """
    cmd = ['ktx', 'extract', '--raw']
    if transcode:
        cmd += ['--transcode', 'rgb8']
    return cmd + ['--level', 'all', str(ktx2), str(out_dir)]


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


def require_patched_ktx(mode: str) -> None:
    """Refuse an ETC1S encode unless ``ktx`` is declared patched.

    An unpatched basis_universal encoder sums a cluster's colours in float32, so
    large bright areas can come out as flat grey blocks in some mip levels
    (preppy#5). UASTC doesn't use that code path.
    """
    if mode == 'etc1s' and REQUIRED_KTX_PATCH not in tools.ktx_patches():
        raise RuntimeError(
            f'ETC1S needs a ktx built with the {REQUIRED_KTX_PATCH!r} patch '
            f'(docker/patches/ktx-software/, preppy#5); an unpatched encoder can '
            f'write flat grey blocks into large bright areas. Use the preppy '
            f'container, which declares it in {tools.KTX_PATCHES_ENV}, or pass '
            f'--allow-unpatched-ktx (allow_unpatched=True) to encode anyway.')


def encode_ktx2(png: PathLike, dst: Optional[PathLike] = None, *,
                mode: str = 'etc1s', threads: Optional[int] = None,
                allow_unpatched: bool = False) -> Path:
    """Encode ``png`` to a mipmapped KTX2 and return the output path.

    ``dst`` defaults to ``<png stem>.ktx2`` beside the PNG. ETC1S requires a
    patched ``ktx`` (:func:`require_patched_ktx`) unless ``allow_unpatched``.
    """
    if not allow_unpatched:
        require_patched_ktx(mode)
    tools.require('ktx')
    png = Path(png)
    dst = Path(dst) if dst is not None else png.with_suffix('.ktx2')

    cmd = encode_ktx2_cmd(png, dst, mode=mode, threads=threads)
    tools.run(cmd)
    return dst


#: Texture gate (preppy#5). A mip level fails when more than
#: ``TEXTURE_DEFECT_MAX_FRACTION`` of its 4x4 blocks have a mean differing from
#: the same-filter uncompressed reference by more than
#: ``TEXTURE_DEFECT_THRESHOLD`` (8-bit) in any channel. On the measured catalog
#: textures, defective ETC1S encodes reached 7.8-17.8% at their worst level and
#: clean ones stayed under 0.25%.
TEXTURE_DEFECT_THRESHOLD = 25
TEXTURE_DEFECT_MAX_FRACTION = 0.01
#: Levels whose short side is under this are not checked: with only a few
#: hundred blocks, ordinary ETC1S colour error reaches about 2% (1.82% at 127x95
#: on an RGB texture). The levels users see at normal zoom are well above it.
TEXTURE_CHECK_MIN_DIM = 256


@dataclass(frozen=True)
class TextureCheckResult:
    """Outcome of :func:`validate_ktx2`: the defective-block share of each
    checked mip level (index = level), against ``max_fraction``."""
    level_fractions: Tuple[float, ...]
    max_fraction: float = TEXTURE_DEFECT_MAX_FRACTION

    @property
    def worst_level(self) -> Optional[int]:
        """The level with the largest share over ``max_fraction``, or ``None``."""
        over = [(f, i) for i, f in enumerate(self.level_fractions)
                if f > self.max_fraction]
        return max(over)[1] if over else None

    @property
    def passed(self) -> bool:
        return self.worst_level is None


def block_defect_fraction(encoded, reference,
                          threshold: float = TEXTURE_DEFECT_THRESHOLD) -> float:
    """Share of 4x4 blocks whose mean in any channel differs between two
    same-sized ``(h, w, channels)`` uint8 arrays by more than ``threshold``.

    Block means rather than pixels: ETC1S error is per-pixel noise within a
    block, while the defect replaces whole blocks with a flat wrong colour.
    A partial edge row/column of blocks is ignored.
    """
    import numpy as np

    h, w = (encoded.shape[0] // 4) * 4, (encoded.shape[1] // 4) * 4
    if h == 0 or w == 0:
        return 0.0

    def means(a):
        a = a[:h, :w].astype(np.float32)
        return a.reshape(h // 4, 4, w // 4, 4, -1).mean(axis=(1, 3))

    diff = np.abs(means(encoded) - means(reference)).max(axis=-1)
    return float((diff > threshold).mean())


def check_levels(encoded: Sequence, reference: Sequence, *,
                 min_dim: int = TEXTURE_CHECK_MIN_DIM,
                 max_fraction: float = TEXTURE_DEFECT_MAX_FRACTION
                 ) -> TextureCheckResult:
    """Compare decoded mip chains level by level (largest first), stopping at
    the first level whose short side is under ``min_dim``."""
    if len(encoded) != len(reference):
        raise ValueError(f'mip chains differ in length: {len(encoded)} encoded '
                         f'vs {len(reference)} reference levels')
    fractions = []
    for enc, ref in zip(encoded, reference):
        if min(enc.shape[:2]) < min_dim:
            break
        if enc.shape != ref.shape:
            raise ValueError(f'level {len(fractions)}: encoded {enc.shape} vs '
                             f'reference {ref.shape}')
        fractions.append(block_defect_fraction(enc, ref))
    return TextureCheckResult(tuple(fractions), max_fraction)


def validate_ktx2(png: PathLike, ktx2: PathLike, *,
                  tmp_dir: Optional[PathLike] = None,
                  min_dim: int = TEXTURE_CHECK_MIN_DIM,
                  max_fraction: float = TEXTURE_DEFECT_MAX_FRACTION
                  ) -> TextureCheckResult:
    """Check every mip level of the encoded ``ktx2`` against ``png`` (the image
    it was encoded from) for compression defects; see :func:`check_levels`.

    The reference is ``png`` through the encode's own mip generation, left
    uncompressed (:func:`reference_ktx2_cmd`), so only compression error remains.
    Both chains are decoded with ``ktx extract``. The work files (an uncompressed
    8K chain is ~200 MB) live in a temporary directory under ``tmp_dir`` that is
    removed afterwards, so ``--keep-tmp`` archives don't carry them.
    """
    tools.require('ktx')
    with tempfile.TemporaryDirectory(prefix='texcheck-', dir=tmp_dir) as work:
        work = Path(work)
        ref_ktx2 = work / 'reference.ktx2'
        tools.run(reference_ktx2_cmd(Path(png), ref_ktx2))
        reference = _decode_levels(ref_ktx2, work / 'reference', transcode=False)
        encoded = _decode_levels(Path(ktx2), work / 'encoded', transcode=True)
        return check_levels(encoded, reference, min_dim=min_dim,
                            max_fraction=max_fraction)


def _decode_levels(ktx2: Path, out_dir: Path, *, transcode: bool) -> List:
    """Every mip level of ``ktx2`` as an RGB uint8 array, largest first."""
    import numpy as np

    width, height = _ktx2_dimensions(ktx2)
    out_dir.mkdir()
    tools.run(extract_levels_cmd(ktx2, out_dir, transcode=transcode))
    # `ktx extract --level all` names them <stem>_level<N>.raw, or just
    # <stem>.raw when there is one level; sort numerically.
    files = list(out_dir.glob('*.raw'))
    levels = {}
    for p in files:
        m = re.search(r'level(\d+)\.raw$', p.name)
        if m:
            levels[int(m.group(1))] = p
    if not levels and len(files) == 1:
        levels[0] = files[0]
    if not levels:
        # An empty chain would compare nothing and pass the gate.
        raise RuntimeError(f'ktx extract wrote no levels for {ktx2}')
    if sorted(levels) != list(range(len(levels))):
        raise RuntimeError(f'ktx extract wrote unexpected levels {sorted(levels)} '
                           f'for {ktx2}')
    arrays = []
    for i in range(len(levels)):
        w, h = max(1, width >> i), max(1, height >> i)
        a = np.fromfile(levels[i], dtype=np.uint8)
        if a.size != w * h * 3:
            raise RuntimeError(f'{ktx2} level {i}: {a.size} bytes, expected '
                               f'{w}x{h} RGB8 ({w * h * 3})')
        arrays.append(a.reshape(h, w, 3))
    return arrays


#: The 12-byte KTX2 file identifier.
_KTX2_IDENTIFIER = b'\xabKTX 20\xbb\r\n\x1a\n'


def _ktx2_dimensions(ktx2: Path) -> Tuple[int, int]:
    """Level-0 ``(width, height)`` from a KTX2 header."""
    import struct

    with open(ktx2, 'rb') as f:
        head = f.read(28)
    if head[:12] != _KTX2_IDENTIFIER:
        raise ValueError(f'{ktx2}: not a KTX2 file')
    return struct.unpack('<II', head[20:28])
