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


def test_fill_transparent_partial_rim_does_not_speckle(tmp_path):
    """A thin partial-alpha rim carrying an amplified/saturated color must be
    weighted down by its coverage (composited), not kept at full strength — the
    fringe bug. A ~5%-coverage 'orange' rim next to a solid gray field should
    composite to essentially gray, never survive as orange."""
    np = pytest.importorskip('numpy')
    pytest.importorskip('scipy')
    from PIL import Image

    arr = np.zeros((8, 8, 4), dtype=np.uint8)
    arr[:, :4] = (128, 128, 128, 255)     # solid chart
    arr[:, 4] = (255, 127, 9, 13)         # thin rim, ~5% coverage, saturated
    arr[:, 5:] = (255, 127, 9, 0)         # nodata (masked), saturated leftover
    src = tmp_path / 'tex.png'
    Image.fromarray(arr, 'RGBA').save(src)

    texture.fill_transparent(src)

    px = np.asarray(Image.open(src).convert('RGB')).astype(int)
    d_orange = np.abs(px - (0xff, 0x7f, 0x25)).sum(-1)
    d_gray = np.abs(px - 128).sum(-1)
    assert (d_gray < d_orange).all(), 'no pixel should read as orange'


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
    # The encoder's default effort, stated explicitly. It is clean only with the
    # patched encoder (docker/patches/ktx-software, preppy#5); --clevel 2 was a
    # mitigation for the unpatched one.
    assert cmd[cmd.index('--clevel') + 1] == '1'
    assert '--generate-mipmap' in cmd
    assert cmd[-2:] == ['t.png', 't.ktx2']


def test_encode_ktx2_cmd_uastc_and_threads():
    cmd = texture.encode_ktx2_cmd(Path('t.png'), Path('t.ktx2'),
                                  mode='uastc', threads=4)
    assert cmd[cmd.index('--encode') + 1] == 'uastc'
    assert '--clevel' not in cmd  # BasisLZ-only option
    assert cmd[cmd.index('--threads') + 1] == '4'


def test_encode_ktx2_cmd_rejects_bad_mode():
    with pytest.raises(ValueError):
        texture.encode_ktx2_cmd(Path('t.png'), Path('t.ktx2'), mode='jpeg')


# --- texture gate (preppy#5) ------------------------------------------------

def test_reference_ktx2_cmd_is_the_encode_without_the_codec():
    # The gate's reference must come from the same mip filter as the encode, or
    # filter differences on detailed textures read as compression defects.
    for mode in ('etc1s', 'uastc'):
        enc = texture.encode_ktx2_cmd(Path('t.png'), Path('t.ktx2'), mode=mode)
        ref = texture.reference_ktx2_cmd(Path('t.png'), Path('t.ktx2'))
        codec = texture.ktx2_codec_args(mode)
        i = enc.index(codec[0])
        assert enc[:i] + enc[i + len(codec):] == ref


def test_extract_levels_cmd():
    cmd = texture.extract_levels_cmd(Path('a.ktx2'), Path('out'))
    assert cmd[:2] == ['ktx', 'extract']
    assert '--raw' in cmd  # ~8x faster than PNG output on an 8K chain
    assert cmd[cmd.index('--transcode') + 1] == 'rgb8'
    assert cmd[cmd.index('--level') + 1] == 'all'
    assert cmd[-2:] == ['a.ktx2', 'out']
    raw = texture.extract_levels_cmd(Path('a.ktx2'), Path('out'), transcode=False)
    assert '--transcode' not in raw  # an uncompressed KTX2 isn't transcodable


def test_block_defect_fraction():
    np = pytest.importorskip('numpy')
    ref = np.full((16, 16, 3), 200, dtype=np.uint8)
    assert texture.block_defect_fraction(ref, ref) == 0.0

    # One flat grey 4x4 block out of 16, as in the FE2 defect.
    enc = ref.copy()
    enc[4:8, 8:12] = 160
    assert texture.block_defect_fraction(enc, ref) == pytest.approx(1 / 16)

    # Below the threshold, or a lone noisy pixel, is ordinary ETC1S error.
    enc = ref.copy()
    enc[4:8, 8:12] = 180
    assert texture.block_defect_fraction(enc, ref) == 0.0
    enc = ref.copy()
    enc[5, 9] = 0
    assert texture.block_defect_fraction(enc, ref) == 0.0

    # Any one channel off is enough (a colour shift, not just a luma one).
    enc = ref.copy()
    enc[0:4, 0:4, 2] = 150
    assert texture.block_defect_fraction(enc, ref) == pytest.approx(1 / 16)


def test_check_levels_flags_a_defective_level():
    np = pytest.importorskip('numpy')
    ref = [np.full((s, s, 3), 200, dtype=np.uint8) for s in (512, 256, 128)]
    enc = [a.copy() for a in ref]
    enc[1][:64, :] = 150  # 25% of level 1's blocks

    res = texture.check_levels(enc, ref, min_dim=256, max_fraction=0.01)
    assert res.level_fractions == (0.0, pytest.approx(0.25))  # level 2 skipped
    assert res.worst_level == 1
    assert not res.passed

    res = texture.check_levels(ref, ref, min_dim=256, max_fraction=0.01)
    assert res.passed and res.worst_level is None


def test_check_levels_skips_small_levels():
    np = pytest.importorskip('numpy')
    ref = [np.full((s, s, 3), 200, dtype=np.uint8) for s in (512, 128)]
    enc = [ref[0].copy(), np.full((128, 128, 3), 100, dtype=np.uint8)]
    assert texture.check_levels(enc, ref, min_dim=256, max_fraction=0.01).passed


def test_check_levels_rejects_mismatched_chains():
    np = pytest.importorskip('numpy')
    a = [np.zeros((256, 256, 3), dtype=np.uint8)]
    with pytest.raises(ValueError):
        texture.check_levels(a, a + a)


def _fake_extract(monkeypatch, names, width=8, height=8):
    """Make tools.run write empty-but-sized .raw files named `names`, as
    `ktx extract --raw` would, without needing ktx."""
    def run(cmd, **k):
        out = Path(cmd[-1])
        for i, name in enumerate(names):
            w, h = max(1, width >> i), max(1, height >> i)
            (out / name).write_bytes(bytes(w * h * 3))
    monkeypatch.setattr(texture.tools, 'run', run)


def _ktx2_header(path, width=8, height=8):
    path.write_bytes(texture._KTX2_IDENTIFIER + bytes(8)
                     + width.to_bytes(4, 'little') + height.to_bytes(4, 'little'))
    return path


def test_decode_levels_reads_a_single_level_file(monkeypatch, tmp_path):
    # `ktx extract --level all` names a one-level texture `output.raw`, with no
    # `_level0` suffix; it must still decode as level 0, not as no levels.
    _fake_extract(monkeypatch, ['output.raw'])
    levels = texture._decode_levels(_ktx2_header(tmp_path / 'a.ktx2'),
                                    tmp_path / 'out', transcode=True)
    assert [a.shape for a in levels] == [(8, 8, 3)]


def test_decode_levels_refuses_an_empty_extract(monkeypatch, tmp_path):
    # Decoding nothing must fail loudly: an empty chain would pass the gate.
    _fake_extract(monkeypatch, [])
    with pytest.raises(RuntimeError, match='no levels'):
        texture._decode_levels(_ktx2_header(tmp_path / 'a.ktx2'),
                               tmp_path / 'out', transcode=True)


def test_decode_levels_reads_a_mip_chain(monkeypatch, tmp_path):
    _fake_extract(monkeypatch, [f'output_level{i}.raw' for i in range(4)])
    levels = texture._decode_levels(_ktx2_header(tmp_path / 'a.ktx2'),
                                    tmp_path / 'out', transcode=True)
    assert [a.shape[:2] for a in levels] == [(8, 8), (4, 4), (2, 2), (1, 1)]


def test_require_patched_ktx(monkeypatch):
    # An unpatched ktx writes flat grey blocks into large bright areas (preppy#5),
    # so ETC1S refuses to run without the patch marker. UASTC is unaffected.
    monkeypatch.delenv(texture.tools.KTX_PATCHES_ENV, raising=False)
    with pytest.raises(RuntimeError, match='preppy#5'):
        texture.require_patched_ktx('etc1s')
    texture.require_patched_ktx('uastc')
    monkeypatch.setenv(texture.tools.KTX_PATCHES_ENV, texture.REQUIRED_KTX_PATCH)
    texture.require_patched_ktx('etc1s')


def test_encode_ktx2_refuses_unpatched_ktx(monkeypatch, tmp_path):
    monkeypatch.delenv(texture.tools.KTX_PATCHES_ENV, raising=False)
    monkeypatch.setattr(texture.tools, 'require', lambda *names: None)
    ran = []
    monkeypatch.setattr(texture.tools, 'run', lambda cmd, **k: ran.append(cmd))
    with pytest.raises(RuntimeError, match='allow-unpatched-ktx'):
        texture.encode_ktx2(tmp_path / 't.png')
    assert ran == []  # refused before encoding anything
    texture.encode_ktx2(tmp_path / 't.png', allow_unpatched=True)
    assert len(ran) == 1


def test_validate_ktx2_passes_a_clean_encode(tmp_path):
    """Real ktx round trip on a small detailed texture: no false positive at the
    default effort, and the check's intermediates are cleaned up. Needs ktx."""
    np = pytest.importorskip('numpy')
    from PIL import Image
    from preppy import tools
    if not tools.check_all(('ktx',))['ktx'].ok:
        pytest.skip('ktx not available')

    rng = np.random.default_rng(5)
    y, x = np.mgrid[0:512, 0:512]
    a = np.stack([x // 2, y // 2, (x + y) // 4], -1) + rng.integers(0, 24, (512, 512, 1))
    src = tmp_path / 't.png'
    Image.fromarray(a.clip(0, 255).astype(np.uint8), 'RGB').save(src)
    # A 512² texture can't trigger the unpatched encoder's bug (it needs a cluster
    # of ~16.8M bright pixels), so this runs on whatever ktx is installed.
    ktx2 = texture.encode_ktx2(src, tmp_path / 't.ktx2', allow_unpatched=True)

    work = tmp_path / 'work'
    work.mkdir()
    res = texture.validate_ktx2(src, ktx2, tmp_dir=work)
    assert res.passed, res.level_fractions
    assert len(res.level_fractions) == 2  # 512 and 256; smaller levels skipped
    assert list(work.iterdir()) == []
