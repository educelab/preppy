"""Unit tests for the orchestrator's pure resolvers. The nodataFill cascade
(with its present-but-null override) and config-relative path resolution are the
error-prone bits; the full chain is exercised by the Phase 4 smoke test.
"""

from pathlib import Path

from preppy.apps import file_prep


def test_resolve_obj_path_absolute_and_relative(tmp_path):
    cfg_dir = tmp_path / 'cfg'
    abs_p = tmp_path / 'x.obj'
    assert file_prep.resolve_obj_path(str(abs_p), cfg_dir) == abs_p
    rel = file_prep.resolve_obj_path('sub/y.obj', cfg_dir)
    assert rel == cfg_dir / 'sub' / 'y.obj'


def test_resolve_nodata_fill_cascade():
    r = file_prep.resolve_nodata_fill
    # variant present wins (even null -> disables inherited)
    assert r({'nodataFill': '#FF0000'}, {'nodataFill': '#00FF00'}, '#0000FF') == '#FF0000'
    assert r({'nodataFill': None}, {'nodataFill': '#00FF00'}, '#0000FF') is None
    # variant absent -> object
    assert r({}, {'nodataFill': '#00FF00'}, '#0000FF') == '#00FF00'
    # object absent -> CLI default
    assert r({}, {}, '#0000FF') == '#0000FF'
    # absent everywhere -> no dilation
    assert r({}, {}, None) is None


def test_hash_inputs_includes_obj_mtls_textures(tmp_path):
    (tmp_path / 'mesh.mtl').write_text('newmtl m\nmap_Kd t.png\n')
    obj = tmp_path / 'mesh.obj'
    obj.write_text('mtllib mesh.mtl\n')
    textures = {'m': tmp_path / 't.png'}
    files = file_prep.hash_inputs(obj, textures)
    assert obj in files
    assert tmp_path / 'mesh.mtl' in files
    assert tmp_path / 't.png' in files
