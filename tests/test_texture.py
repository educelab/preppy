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
    # The no-data fill is done in-memory, never via ImageMagick, so the expensive
    # per-pixel work never touches the full-resolution source.
    assert '-morphology' not in cmd and '-transparent' not in cmd


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


def test_fill_nodata_backfills_from_nearest_chart_pixel(tmp_path):
    """A fill region is fully replaced by the nearest valid chart color, so no
    fill pixels survive to bleed through the mip chain (the old dilate left a
    ring of fill; this eliminates all of it)."""
    np = pytest.importorskip('numpy')
    pytest.importorskip('scipy')
    from PIL import Image

    # Left half chart (red), right half the fill color ff7f25.
    arr = np.zeros((16, 16, 3), dtype=np.uint8)
    arr[:, :8] = (200, 10, 10)         # chart
    arr[:, 8:] = (0xff, 0x7f, 0x25)    # no-data fill
    src = tmp_path / 'tex.png'
    Image.fromarray(arr, 'RGB').save(src)

    texture.fill_nodata(src, 'ff7f25')  # bare hex, as the config writes it

    out = np.asarray(Image.open(src).convert('RGB'))
    # Every fill pixel is gone; the whole image is now the chart color.
    assert not (np.abs(out.astype(int) - (0xff, 0x7f, 0x25)).sum(-1) < 10).any()
    assert (out == (200, 10, 10)).all()


def test_fill_nodata_noop_when_color_absent(tmp_path):
    np = pytest.importorskip('numpy')
    pytest.importorskip('scipy')
    from PIL import Image

    arr = np.full((8, 8, 3), (10, 20, 30), dtype=np.uint8)
    src = tmp_path / 'tex.png'
    Image.fromarray(arr, 'RGB').save(src)
    texture.fill_nodata(src, '#ff7f25')  # no pixel matches -> unchanged
    assert (np.asarray(Image.open(src).convert('RGB')) == (10, 20, 30)).all()


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
