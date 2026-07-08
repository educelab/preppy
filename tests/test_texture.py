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


def test_normalize_cmd_plain_no_dilation():
    cmd = texture.normalize_cmd(Path('in.tif'), Path('out.png'), max_dim=8192)
    assert cmd[0] == 'magick' and cmd[1] == 'in.tif' and cmd[-1] == 'out.png'
    # Colorspace + depth conversion is always present.
    assert '-colorspace' in cmd and cmd[cmd.index('-colorspace') + 1] == 'sRGB'
    assert '-depth' in cmd and cmd[cmd.index('-depth') + 1] == '8'
    # Resize only shrinks (the trailing '>').
    assert '-resize' in cmd and cmd[cmd.index('-resize') + 1] == '8192x8192>'
    # No dilation machinery when nodata_fill is None.
    assert '-morphology' not in cmd and '-transparent' not in cmd


def test_normalize_cmd_with_dilation():
    cmd = texture.normalize_cmd(Path('in.tif'), Path('out.png'),
                                nodata_fill='#FF7F00', fuzz='7%', dilate=24)
    assert '-transparent' in cmd
    assert cmd[cmd.index('-transparent') + 1] == '#FF7F00'
    assert cmd[cmd.index('-fuzz') + 1] == '7%'
    assert '-morphology' in cmd
    assert cmd[cmd.index('-morphology') + 1] == 'Dilate'
    assert cmd[cmd.index('-morphology') + 2] == 'Diamond:24'
    # Compose the dilated copy under the original, then flatten alpha.
    assert 'DstOver' in cmd and cmd[-2] != '-alpha'  # -alpha off precedes output
    assert 'off' in cmd


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
