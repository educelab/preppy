"""Unit tests for the orchestrator's pure resolvers. The nodataFill cascade
(with its present-but-null override) and config-relative path resolution are the
error-prone bits; the full chain is exercised by the Phase 4 smoke test.
"""

import logging
from pathlib import Path
from types import SimpleNamespace

import pytest

from preppy.apps import file_prep
from preppy.geometry import HausdorffResult


def test_resolve_obj_path_absolute_and_relative(tmp_path):
    data_root = tmp_path / 'root'
    abs_p = tmp_path / 'x.obj'
    assert file_prep.resolve_obj_path(str(abs_p), data_root) == abs_p
    rel = file_prep.resolve_obj_path('sub/y.obj', data_root)
    assert rel == data_root / 'sub' / 'y.obj'


def test_normalize_args_data_root_defaults_to_cwd():
    ns = SimpleNamespace(data_root=None, no_decimate=False, decimate_error=0.2,
                         uri='')
    file_prep._normalize_args(ns)
    assert ns.data_root == Path.cwd()


def test_normalize_args_data_root_explicit_is_resolved(tmp_path):
    ns = SimpleNamespace(data_root=str(tmp_path), no_decimate=False,
                         decimate_error=0.2, uri='')
    file_prep._normalize_args(ns)
    assert ns.data_root == tmp_path.resolve()


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


def test_ktx2_mode_cli_default_is_etc1s():
    # Task 1.2: lock the recorded default so it can't silently drift. The
    # encode-side default is covered in tests/test_texture.py.
    parser = file_prep._build_parser()
    args = parser.parse_args(['-i', 'x.json'])
    assert args.ktx2_mode == 'etc1s'
    action = next(a for a in parser._actions if a.dest == 'ktx2_mode')
    assert action.choices == ['etc1s', 'uastc']


def test_prune_keep_cli_parsing():
    parser = file_prep._build_parser()
    args = parser.parse_args(['-i', 'x.json', '--prune', '--prune-keep', '3'])
    assert args.prune is True and args.prune_keep == 3
    assert parser.parse_args(['-i', 'x.json']).prune_keep == 0  # default


def _stub_opts(**over):
    base = dict(max_dim=8192, nodata_fill=None, target_error=0.2, validate=True,
                deviation_budget=0.05, deviation_budget_frac=None,
                on_over_budget='fail', ktx2_mode='etc1s', hash_names=False,
                tool_versions={}, uri='', smooth_normals=True,
                force_smooth_normals=False)
    base.update(over)
    return SimpleNamespace(**base)


def _patch_chain(monkeypatch, tmp_path, validate_result):
    """Stub every external step so process_variant runs toolless; validate()
    returns the supplied HausdorffResult so only the gate logic is exercised."""
    monkeypatch.setattr(file_prep, 'parse_material_textures',
                        lambda p: {'m': tmp_path / 't.png'})
    monkeypatch.setattr(file_prep.texture, 'normalize',
                        lambda img, **k: tmp_path / 'n.png')
    monkeypatch.setattr(file_prep.texture, 'encode_ktx2',
                        lambda png, **k: tmp_path / 'm.ktx2')
    monkeypatch.setattr(file_prep.geometry, 'obj_to_geometry_glb',
                        lambda obj, out, **k: Path(out))
    monkeypatch.setattr(file_prep.geometry, 'strip_textures',
                        lambda p: Path(p))
    monkeypatch.setattr(file_prep.geometry, 'validate',
                        lambda *a, **k: validate_result)
    monkeypatch.setattr(file_prep.assemble, 'embed',
                        lambda geom, mapping, out, **k: Path(out))


def _run_variant(tmp_path, opts):
    (tmp_path / 'mesh.obj').write_text('mtllib x\n')
    return file_prep.process_variant(
        {'id': 'O'}, {'suffix': 'rgb', 'obj': 'mesh.obj'},
        prefix='O', data_root=tmp_path, obj_out_dir=tmp_path / 'out',
        tmp_dir=tmp_path / 'tmp', opts=opts)


def test_validate_gate_fails_over_budget(monkeypatch, tmp_path):
    _patch_chain(monkeypatch, tmp_path,
                 HausdorffResult(max_distance=0.1, mean=0.01, rms=0.02,
                                 bbox_diagonal=3.0, budget=0.05))
    with pytest.raises(RuntimeError, match='exceeds'):
        _run_variant(tmp_path, _stub_opts())


def test_validate_gate_passes_within_budget(monkeypatch, tmp_path):
    _patch_chain(monkeypatch, tmp_path,
                 HausdorffResult(max_distance=0.01, mean=0.001, rms=0.002,
                                 bbox_diagonal=3.0, budget=0.05))
    res = _run_variant(tmp_path, _stub_opts())
    assert res['name'] == 'O_rgb.glb'


def test_validate_report_only_without_budget(monkeypatch, tmp_path):
    # No budget -> within_budget is None -> never raises (report-only).
    _patch_chain(monkeypatch, tmp_path,
                 HausdorffResult(max_distance=99.0, mean=1.0, rms=1.0,
                                 bbox_diagonal=3.0, budget=None))
    res = _run_variant(tmp_path, _stub_opts(deviation_budget=None))
    assert res['name'] == 'O_rgb.glb'


def test_validate_gate_warns_over_budget(monkeypatch, tmp_path, caplog):
    # --on-over-budget warn logs but does not raise; the asset still writes.
    _patch_chain(monkeypatch, tmp_path,
                 HausdorffResult(max_distance=0.1, mean=0.01, rms=0.02,
                                 bbox_diagonal=3.0, budget=0.05))
    with caplog.at_level(logging.WARNING):
        res = _run_variant(tmp_path, _stub_opts(on_over_budget='warn'))
    assert res['name'] == 'O_rgb.glb'
    assert any('exceeds' in r.message for r in caplog.records)


def test_validate_gate_fractional_budget_fails(monkeypatch, tmp_path):
    # No absolute budget, but the fractional budget (2% of bbox) is exceeded.
    _patch_chain(monkeypatch, tmp_path,
                 HausdorffResult(max_distance=0.3, mean=0.01, rms=0.02,
                                 bbox_diagonal=3.0, budget_frac=0.02))  # 10% > 2%
    with pytest.raises(RuntimeError, match='budget-frac'):
        _run_variant(tmp_path, _stub_opts(deviation_budget=None,
                                          deviation_budget_frac=0.02))


def test_validate_gate_within_fractional_budget(monkeypatch, tmp_path):
    _patch_chain(monkeypatch, tmp_path,
                 HausdorffResult(max_distance=0.03, mean=0.001, rms=0.002,
                                 bbox_diagonal=3.0, budget_frac=0.02))  # 1% <= 2%
    res = _run_variant(tmp_path, _stub_opts(deviation_budget=None,
                                            deviation_budget_frac=0.02))
    assert res['name'] == 'O_rgb.glb'
