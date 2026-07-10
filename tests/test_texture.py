"""Unit tests for texture command construction (colorspace/resize decisions and
KTX2 encode flags). The actual conversions are validated live against a real
image in the Phase 2 verification, not here.
"""

from pathlib import Path

import pytest

from preppy import texture


def test_thumbnail_cmd_square_center_crop():
    cmd = texture.thumbnail_cmd(Path('a.png'), Path('t.jpg'), size=256)
    assert cmd[0] == 'magick' and cmd[1] == 'a.png' and cmd[-1] == 't.jpg'
    assert cmd[cmd.index('-resize') + 1] == '256x256^'   # fill the box
    assert cmd[cmd.index('-gravity') + 1] == 'center'
    assert cmd[cmd.index('-extent') + 1] == '256x256'    # crop to square


def test_normalize_cmd_resize_and_colorspace():
    cmd = texture.normalize_cmd(Path('in.tif'), Path('out.png'), max_dim=8192)
    assert cmd[0] == 'magick' and cmd[1] == 'in.tif' and cmd[-1] == 'out.png'
    # Colorspace + depth conversion is always present.
    assert '-colorspace' in cmd and cmd[cmd.index('-colorspace') + 1] == 'sRGB'
    assert '-depth' in cmd and cmd[cmd.index('-depth') + 1] == '8'
    # Resize only shrinks (the trailing '>').
    assert '-resize' in cmd and cmd[cmd.index('-resize') + 1] == '8192x8192>'
    # The plain path never masks; the fill is handled by normalize_masked_cmd.
    assert '-morphology' not in cmd and '-transparent' not in cmd


def test_normalize_masked_cmd_masks_before_resize():
    """The nodata-aware path must mask the fill *before* the resize (so it can't
    blend into island edges) and emit RGBA for the alpha back-fill."""
    cmd = texture.normalize_masked_cmd(
        Path('in.tif'), Path('out.png'), 'ff7f25', max_dim=8192, fuzz=0.10)
    # Fill is masked to alpha 0 in sRGB space, then the image is resized.
    ti, ri = cmd.index('-transparent'), cmd.index('-resize')
    ci = cmd.index('-colorspace')
    assert ci < ti < ri, 'colorspace -> transparent -> resize ordering is load-critical'
    # Bare hex is normalized to a #rrggbb color IM accepts.
    assert cmd[ti + 1] == '#ff7f25'
    # fuzz fraction -> IM percentage.
    assert cmd[cmd.index('-fuzz') + 1] == '10%'
    assert cmd[ri + 1] == '8192x8192>'
    # RGBA output so fill_transparent can read the mask back.
    assert cmd[-1] == 'PNG32:out.png'


def test_normalize_masked_cmd_rejects_bad_color():
    with pytest.raises(ValueError):
        texture.normalize_masked_cmd(Path('a.tif'), Path('b.png'), 'nothex')


@pytest.mark.parametrize('text,expected', [
    ('#ff7f25', (0xff, 0x7f, 0x25)),
    ('ff7f25', (0xff, 0x7f, 0x25)),   # bare hex (as config files write it)
    ('#FF7F00', (0xff, 0x7f, 0x00)),
    ('f72', (0xff, 0x77, 0x22)),      # 3-digit shorthand
])
def test_parse_hex_color(text, expected):
    assert texture.parse_hex_color(text) == expected


@pytest.mark.parametrize('bad', ['', 'ff', 'gggggg', '#12345'])
def test_parse_hex_color_rejects_bad(bad):
    with pytest.raises(ValueError):
        texture.parse_hex_color(bad)


def test_fill_transparent_backfills_from_nearest_opaque_pixel(tmp_path):
    """Every masked (alpha 0) pixel is replaced by the nearest opaque chart
    color and the alpha channel is dropped, so no hole survives to bleed through
    the mip chain — and the fill color is never re-seeded (it's not in the RGBA
    at all, only the mask is)."""
    np = pytest.importorskip('numpy')
    pytest.importorskip('scipy')
    from PIL import Image

    # Left half chart (red, opaque), right half masked (alpha 0). The masked
    # RGB is the premultiplied-black the resize would leave — must not survive.
    arr = np.zeros((16, 16, 4), dtype=np.uint8)
    arr[:, :8] = (200, 10, 10, 255)    # chart, opaque
    arr[:, 8:] = (0, 0, 0, 0)          # nodata, transparent
    src = tmp_path / 'tex.png'
    Image.fromarray(arr, 'RGBA').save(src)

    texture.fill_transparent(src)

    out = Image.open(src)
    assert out.mode == 'RGB'                 # alpha dropped
    px = np.asarray(out)
    assert (px == (200, 10, 10)).all()       # every hole filled from the chart


def test_fill_transparent_noop_on_plain_rgb(tmp_path):
    """A plain RGB image (the no-fill path) is returned untouched."""
    np = pytest.importorskip('numpy')
    from PIL import Image

    arr = np.full((8, 8, 3), (10, 20, 30), dtype=np.uint8)
    src = tmp_path / 'tex.png'
    Image.fromarray(arr, 'RGB').save(src)
    texture.fill_transparent(src)
    assert (np.asarray(Image.open(src).convert('RGB')) == (10, 20, 30)).all()


def test_normalize_masked_path_leaves_no_orange(tmp_path):
    """End-to-end mask-aware normalize on a synthetic orange atlas: after the
    full-res mask + alpha-weighted downscale + back-fill, essentially no orange-
    tinted pixel survives (feedback #1). Needs ImageMagick; skips without it."""
    np = pytest.importorskip('numpy')
    pytest.importorskip('scipy')
    from PIL import Image
    from preppy import tools
    if not tools.check_all(('magick',))['magick'].ok:
        pytest.skip('ImageMagick not available')

    # A small gray island in a large orange field (like the real 2/3-orange PGS).
    a = np.full((512, 512, 3), (0xff, 0x7f, 0x25), dtype=np.uint8)
    a[220:300, 220:300] = (128, 128, 128)
    src = tmp_path / 'atlas.png'
    Image.fromarray(a, 'RGB').save(src)

    out = texture.normalize(src, dst=tmp_path / 'out.png',
                            max_dim=128, nodata_fill='ff7f25', fuzz=0.10)

    px = np.asarray(Image.open(out).convert('RGB')).astype(int)
    d_orange = np.abs(px - (0xff, 0x7f, 0x25)).sum(-1)
    d_gray = np.abs(px - 128).sum(-1)
    # No pixel should be closer to the orange fill than to the real chart gray.
    orange_tinted = (d_orange < d_gray).mean()
    assert orange_tinted < 0.001, f'orange-tinted fraction {orange_tinted:.4f}'


def test_encode_ktx2_cmd_etc1s_default():
    cmd = texture.encode_ktx2_cmd(Path('t.png'), Path('t.ktx2'))
    assert cmd[:2] == ['ktx', 'create']
    assert cmd[cmd.index('--format') + 1] == 'R8G8B8_SRGB'
    assert cmd[cmd.index('--assign-tf') + 1] == 'srgb'
    assert cmd[cmd.index('--encode') + 1] == 'basis-lz'  # ETC1S
    assert '--generate-mipmap' in cmd
    assert cmd[-2:] == ['t.png', 't.ktx2']


def test_encode_ktx2_cmd_uastc_and_threads():
    cmd = texture.encode_ktx2_cmd(Path('t.png'), Path('t.ktx2'),
                                  mode='uastc', threads=4)
    assert cmd[cmd.index('--encode') + 1] == 'uastc'
    assert cmd[cmd.index('--threads') + 1] == '4'


def test_encode_ktx2_cmd_rejects_bad_mode():
    with pytest.raises(ValueError):
        texture.encode_ktx2_cmd(Path('t.png'), Path('t.ktx2'), mode='jpeg')
