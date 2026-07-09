"""Tests for the model-preview thumbnail (``preppy.preview``) and the
orchestrator's fallback to a texture crop when the render toolchain is absent.

The live render test skips cleanly when trimesh/pyrender (the ``preview`` extra)
are not installed; the fallback test is pure logic and always runs.
"""

import argparse
import logging
import os
import subprocess as sp
from pathlib import Path

import pytest

from preppy import preview


def test_stderr_to_log_captures_native_fd2(caplog):
    """Text written to the C-level stderr (fd 2) inside the context is captured
    and re-emitted through the logger, not leaked to the terminal."""
    with caplog.at_level(logging.DEBUG, logger='preppy.preview'):
        with preview._stderr_to_log():
            os.write(2, b'native-noise-from-fd2\n')
    assert any('native-noise-from-fd2' in r.getMessage()
               for r in caplog.records)


def _backend_available() -> bool:
    try:
        import trimesh  # noqa: F401
        import pyrender  # noqa: F401
        return True
    except Exception:
        return False


def _write_textured_obj(tmp_path: Path) -> Path:
    """A 2-material OBJ + normalized PNGs; MTL references source names that do
    NOT exist on disk, so a successful render proves the resolver swapped in the
    normalized textures rather than reading the (absent) sources."""
    src = tmp_path / 'src'
    src.mkdir()
    sp.run(['magick', '-size', '32x32', 'gradient:red-yellow',
            'PNG24:' + str(src / 'norm_00.png')], check=True)
    sp.run(['magick', '-size', '32x32', 'gradient:blue-cyan',
            'PNG24:' + str(src / 'norm_01.png')], check=True)
    (src / 'mesh.mtl').write_text(
        'newmtl material_01\nKd 1 1 1\nmap_Kd source_01.png\n\n'
        'newmtl material_00\nKd 1 1 1\nmap_Kd source_00.png\n')
    (src / 'mesh.obj').write_text('\n'.join([
        'mtllib mesh.mtl',
        'v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0',
        'v 2 0 0', 'v 3 0 0', 'v 3 1 0', 'v 2 1 0',
        'vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0 1',
        'usemtl material_00', 'f 1/1 2/2 3/3', 'f 1/1 3/3 4/4',
        'usemtl material_01', 'f 5/1 6/2 7/3', 'f 5/1 7/3 8/4',
    ]) + '\n')
    return src


@pytest.mark.skipif(not _backend_available(),
                    reason='preview extra (trimesh/pyrender) not installed')
def test_render_preview_writes_jpeg_from_normalized_textures(tmp_path):
    try:
        sp.run(['magick', '-version'], check=True, capture_output=True)
    except Exception:
        pytest.skip('ImageMagick not available to build the test textures')

    src = _write_textured_obj(tmp_path)
    # source_*.png deliberately absent; only norm_*.png exist.
    textures = {'source_00.png': src / 'norm_00.png',
                'source_01.png': src / 'norm_01.png'}
    dst = tmp_path / 'preview.jpg'

    from PIL import Image
    try:
        out = preview.render_preview(src / 'mesh.obj', textures, dst,
                                     size=128, bg='ffffff')
    except preview.PreviewUnavailable as e:
        pytest.skip(f'headless GL unavailable: {e}')

    assert out == dst and dst.is_file()
    im = Image.open(dst)
    assert im.size == (128, 128) and im.mode == 'RGB'
    # The model does not fill the frame, so the background color must appear.
    colors = {c for _, c in im.getcolors(maxcolors=1 << 16) or []}
    assert (255, 255, 255) in colors


def _write_mixed_face_obj(path: Path, *, matching: bool) -> int:
    """Write an OBJ that mixes `f v/vt` and bare `f v` faces (trimesh drops UVs
    for such meshes). ``matching`` controls whether the v/vt indices line up
    (so uv[i]=vt[i]). Returns the vertex count."""
    lines = ['mtllib m.mtl',
             'v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0',
             'vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0 1',
             'usemtl m']
    if matching:
        lines += ['f 1/1 2/2 3/3']          # v == vt
    else:
        lines += ['f 1/4 2/3 3/2']          # v != vt
    lines += ['f 1 3 4']                    # bare face -> triggers mixed-data
    path.write_text('\n'.join(lines) + '\n')
    return 4


def test_recover_uv_by_index_matching(tmp_path):
    obj = tmp_path / 'mesh.obj'
    n = _write_mixed_face_obj(obj, matching=True)
    uv = preview._recover_uv_by_index(obj, n)
    assert uv is not None and uv.shape == (n, 2)


def test_recover_uv_by_index_rejects_mismatched_indices(tmp_path):
    obj = tmp_path / 'mesh.obj'
    n = _write_mixed_face_obj(obj, matching=False)
    # v/vt indices don't line up, so uv[i]=vt[i] would mis-map: refuse.
    assert preview._recover_uv_by_index(obj, n) is None


def test_recover_uv_by_index_rejects_count_mismatch(tmp_path):
    obj = tmp_path / 'mesh.obj'
    n = _write_mixed_face_obj(obj, matching=True)
    assert preview._recover_uv_by_index(obj, n + 1) is None


def test_probe_returns_bool_and_detail():
    """probe() never raises; it returns (ok, detail) either way."""
    ok, detail = preview.probe()
    assert isinstance(ok, bool) and isinstance(detail, str) and detail


def test_probe_reports_missing_extra(monkeypatch):
    """A genuinely-missing module yields a False result that names the extra."""
    def missing():
        raise preview.PreviewUnavailable("'pyrender' not installed; install "
                                         'the "preview" extra: pip install '
                                         '".[preview]"')
    monkeypatch.setattr(preview, '_require_backend', missing)
    ok, detail = preview.probe()
    assert ok is False and 'preview' in detail


def _run_check_tools(monkeypatch, argv):
    """Invoke check_tools.main() with argv; return (exit_code, stdout)."""
    import io
    import contextlib
    from preppy.apps import check_tools

    monkeypatch.setattr('sys.argv', ['voyager-check-tools', *argv])
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        code = check_tools.main()
    return code, buf.getvalue()


def test_check_tools_preview_target_is_informational(monkeypatch):
    """The 'preview' pseudo-target probes the renderer and, even when it reports
    unavailable, does not fail the exit code (the pipeline falls back)."""
    from preppy import preview as preview_mod

    monkeypatch.setattr(preview_mod, 'probe',
                        lambda: (False, 'no GL backend here'))
    code, out = _run_check_tools(monkeypatch, ['preview'])
    assert code == 0
    assert 'model preview (optional)' in out and 'SKIP' in out
    # 'preview' alone must not drag in the CLI tool report.
    assert 'magick' not in out


def test_check_tools_rejects_unknown_target(monkeypatch):
    with pytest.raises(SystemExit):
        _run_check_tools(monkeypatch, ['bogus'])


@pytest.mark.skipif(not _backend_available(),
                    reason='preview extra (trimesh/pyrender) not installed')
def test_render_preview_survives_mixed_face_mesh(tmp_path):
    """A mesh mixing `f v/vt` and bare `f v` faces makes trimesh drop UVs; the
    renderer must recover them (or degrade) instead of crashing on a shader that
    samples a compiled-out uv_0."""
    obj = tmp_path / 'mesh.obj'
    _write_mixed_face_obj(obj, matching=True)
    (tmp_path / 'm.mtl').write_text('newmtl m\nKd 1 1 1\nmap_Kd t.png\n')
    tex = tmp_path / 'norm.png'
    sp.run(['magick', '-size', '32x32', 'gradient:red-yellow',
            'PNG24:' + str(tex)], check=True)
    dst = tmp_path / 'preview.jpg'
    try:
        preview.render_preview(obj, {'t.png': tex}, dst, size=96)
    except preview.PreviewUnavailable as e:
        pytest.skip(f'headless GL unavailable: {e}')
    assert dst.is_file()


def _min_opts(**over) -> argparse.Namespace:
    base = dict(thumbnail_mode='render', thumbnail_size=64, preview_bg='ffffff')
    base.update(over)
    return argparse.Namespace(**base)


def test_render_thumbnail_falls_back_to_texture_crop(tmp_path, monkeypatch):
    """When the preview backend is unavailable, ``_render_thumbnail`` logs and
    falls back to the texture center-crop instead of aborting the run."""
    from preppy.apps import file_prep

    def boom(*a, **k):
        raise preview.PreviewUnavailable('no backend for test')

    monkeypatch.setattr(file_prep.preview, 'render_preview', boom)

    crop_src = tmp_path / 'norm.png'
    sp.run(['magick', '-size', '32x32', 'xc:#336699', str(crop_src)], check=True)
    dst = tmp_path / 'thumb.jpg'
    result = {'obj_path': tmp_path / 'mesh.obj', 'preview_textures': {},
              'thumb_src': crop_src}

    assert file_prep._render_thumbnail(result, dst, _min_opts()) is True
    assert dst.is_file()  # produced by the texture-crop fallback


def test_render_thumbnail_texture_mode_skips_render(tmp_path, monkeypatch):
    """``--thumbnail-mode texture`` must not invoke the renderer at all."""
    from preppy.apps import file_prep

    def fail(*a, **k):
        raise AssertionError('render_preview must not be called in texture mode')

    monkeypatch.setattr(file_prep.preview, 'render_preview', fail)

    crop_src = tmp_path / 'norm.png'
    sp.run(['magick', '-size', '32x32', 'xc:#336699', str(crop_src)], check=True)
    dst = tmp_path / 'thumb.jpg'
    result = {'obj_path': tmp_path / 'mesh.obj', 'preview_textures': {},
              'thumb_src': crop_src}

    assert file_prep._render_thumbnail(
        result, dst, _min_opts(thumbnail_mode='texture')) is True
    assert dst.is_file()
