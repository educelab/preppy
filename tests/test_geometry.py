"""Unit tests for geometry command construction, the meshopt-glb guard, and the
HausdorffResult budget logic. The live gltfpack + pymeshlab run is exercised in
the Phase 2 verification.
"""

import json
import struct
from pathlib import Path

import pytest

from preppy import geometry
from preppy.geometry import HausdorffResult


def _make_glb(doc: dict, bin_data: bytes = b'') -> bytes:
    """Assemble a minimal binary glb from a JSON doc + optional BIN chunk."""
    json_bytes = json.dumps(doc).encode()
    json_bytes += b' ' * ((-len(json_bytes)) % 4)
    body = struct.pack('<I', len(json_bytes)) + b'JSON' + json_bytes
    if bin_data:
        bin_data += b'\x00' * ((-len(bin_data)) % 4)
        body += struct.pack('<I', len(bin_data)) + b'BIN\x00' + bin_data
    return b'glTF' + struct.pack('<II', 2, 12 + len(body)) + body


def test_geometry_cmd_delivery_defaults():
    cmd = geometry.obj_to_geometry_glb_cmd(Path('m.obj'), Path('g.glb'))
    assert cmd[0] in ('gltfpack', 'gltfpack.cmd')
    assert cmd[cmd.index('-i') + 1] == 'm.obj'
    assert cmd[cmd.index('-o') + 1] == 'g.glb'
    assert cmd[cmd.index('-si') + 1] == '0.2'  # DEFAULT_TARGET_ERROR
    assert '-cc' in cmd          # meshopt on by default
    assert '-noq' not in cmd     # quantization on by default


def test_geometry_cmd_validation_variant():
    # Plain, pymeshlab-readable output: no meshopt, no quantization.
    cmd = geometry.obj_to_geometry_glb_cmd(
        Path('m.obj'), Path('g.glb'), target_error=0.5,
        meshopt=False, quantize=False, extra=['-kn'])
    assert cmd[cmd.index('-si') + 1] == '0.5'
    assert '-cc' not in cmd
    assert '-noq' in cmd
    assert cmd[-1] == '-kn'


def test_geometry_cmd_no_decimate_omits_si():
    cmd = geometry.obj_to_geometry_glb_cmd(
        Path('m.obj'), Path('g.glb'), target_error=None)
    assert '-si' not in cmd      # --no-decimate: no simplification
    assert '-cc' in cmd          # still meshopt-compressed


def test_bake_normals_flat_quad(tmp_path):
    # Two CCW triangles in the z=0 plane -> every vertex normal is +z.
    obj = tmp_path / 'm.obj'
    obj.write_text(
        'mtllib m.mtl\n'
        'v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\n'
        'vt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\n'
        'usemtl mat\n'
        'f 1/1 2/2 3/3\n'
        'f 1/1 3/3 4/4\n')
    out = geometry.bake_normals(obj, tmp_path / 'm.normals.obj')
    text = out.read_text()

    # One vn per vertex, all pointing +z.
    assert text.count('vn 0.000000 0.000000 1.000000\n') == 4
    # Faces reference each corner's own vertex normal (v/vt -> v/vt/v).
    assert 'f 1/1/1 2/2/2 3/3/3\n' in text
    assert 'f 1/1/1 3/3/3 4/4/4\n' in text
    # vt data and usemtl binding are preserved.
    assert 'vt 1 1\n' in text
    assert 'usemtl mat\n' in text
    # The vn block is emitted before the first face that uses it.
    assert text.index('vn ') < text.index('f ')


def test_bake_normals_bare_faces_and_mtl_copy(tmp_path):
    src = tmp_path / 'src'
    src.mkdir()
    (src / 'm.mtl').write_text('newmtl mat\nmap_Kd tex.tif\n')
    obj = src / 'm.obj'
    obj.write_text(
        'mtllib m.mtl\n'
        'v 0 0 0\nv 1 0 0\nv 0 1 0\n'
        'f 1 2 3\n')  # bare v faces (no vt)
    out_dir = tmp_path / 'out'
    out_dir.mkdir()
    out = geometry.bake_normals(obj, out_dir / 'm.normals.obj')
    text = out.read_text()

    assert 'f 1//1 2//2 3//3\n' in text  # bare v -> v//v
    # mtllib is a bare basename (gltfpack rejects absolute mtllib paths)...
    mtllib = next(l for l in text.splitlines() if l.startswith('mtllib '))
    assert mtllib == 'mtllib m.mtl'
    # ...and the .mtl is copied next to the baked OBJ so it resolves relatively.
    assert (out_dir / 'm.mtl').read_text() == 'newmtl mat\nmap_Kd tex.tif\n'


def test_bake_normals_strips_existing_vn(tmp_path):
    # A flat quad that ALSO ships a bogus vn block + explicit v/vt/vn faces.
    obj = tmp_path / 'm.obj'
    obj.write_text(
        'mtllib m.mtl\n'
        'v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\n'
        'vt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\n'
        'vn 0 0 -1\nvn 0 0 -1\nvn 0 0 -1\nvn 0 0 -1\n'  # bogus -z source normals
        'usemtl mat\n'
        'f 1/1/1 2/2/2 3/3/3\n'
        'f 1/1/4 3/3/2 4/4/1\n')  # deliberately mismatched normal refs
    out = geometry.bake_normals(obj, tmp_path / 'm.normals.obj')
    text = out.read_text()

    # Source normals stripped; exactly one baked block, all +z.
    assert 'vn 0.000000 0.000000 -1.000000\n' not in text
    assert text.count('vn ') == 4
    assert text.count('vn 0.000000 0.000000 1.000000\n') == 4
    # Faces rewritten so each corner's normal == its own (absolute) vertex.
    assert 'f 1/1/1 2/2/2 3/3/3\n' in text
    assert 'f 1/1/1 3/3/3 4/4/4\n' in text
    assert text.index('vn ') < text.index('f ')


def test_is_vn_line_tolerates_whitespace():
    # Keyword may be followed by a tab or extra spaces, not just one space.
    assert geometry._is_vn_line('vn 0 0 1')
    assert geometry._is_vn_line('vn\t0 0 1')
    assert geometry._is_vn_line('vn  0 0 1\n')
    # Not a vn line: vertex, uv, or a token that merely starts with "vn".
    assert not geometry._is_vn_line('v 0 0 0')
    assert not geometry._is_vn_line('vt 0 0')
    assert not geometry._is_vn_line('vnfoo 0 0 1')
    assert not geometry._is_vn_line('')


def test_bake_normals_strips_tab_delimited_vn(tmp_path):
    # A source whose vn block uses TABs must still be detected + stripped, else
    # the source normals survive alongside the baked block and misalign indices.
    obj = tmp_path / 'm.obj'
    obj.write_text(
        'v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\n'
        'vn\t0 0 -1\nvn\t0 0 -1\nvn\t0 0 -1\nvn\t0 0 -1\n'  # tab-separated, bogus
        'f 1//1 2//2 3//3\n'
        'f 1//1 3//3 4//4\n')
    assert geometry._obj_has_normals(obj)  # detected despite the tab
    out = geometry.bake_normals(obj, tmp_path / 'm.normals.obj')
    text = out.read_text()
    assert '-1.000000' not in text            # source -z normals gone
    assert text.count('vn ') == 4             # exactly one baked block
    assert text.count('vn 0.000000 0.000000 1.000000\n') == 4


def test_bake_normals_negative_indices(tmp_path):
    # Same flat quad, but faces use OBJ relative (negative) indices.
    obj = tmp_path / 'm.obj'
    obj.write_text(
        'mtllib m.mtl\n'
        'v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\n'
        'vt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\n'
        'usemtl mat\n'
        'f -4/-4 -3/-3 -2/-2\n'
        'f -4/-4 -2/-2 -1/-1\n')
    out = geometry.bake_normals(obj, tmp_path / 'm.normals.obj')
    text = out.read_text()

    # Relatives resolved (not silently wrapped) -> all +z normals.
    assert text.count('vn 0.000000 0.000000 1.000000\n') == 4
    # Normal index is the absolute vertex; position/UV refs kept verbatim.
    assert 'f -4/-4/1 -3/-3/2 -2/-2/3\n' in text
    assert 'f -4/-4/1 -2/-2/3 -1/-1/4\n' in text


def _stub_gltfpack(monkeypatch):
    monkeypatch.setattr(geometry.tools, 'require', lambda *a, **k: None)
    monkeypatch.setattr(geometry.tools, 'run', lambda *a, **k: None)
    monkeypatch.setattr(geometry, 'obj_to_geometry_glb_cmd', lambda *a, **k: [])


def test_obj_to_geometry_glb_passes_source_normals_through(tmp_path, monkeypatch):
    obj = tmp_path / 'm.obj'
    obj.write_text('v 0 0 0\nvn 0 0 1\nf 1//1\n')  # source already ships normals
    calls = []
    _stub_gltfpack(monkeypatch)
    monkeypatch.setattr(geometry, 'bake_normals',
                        lambda i, o, **k: calls.append(o) or Path(o))
    # Default: source has vn -> no bake (pass through).
    geometry.obj_to_geometry_glb(obj, tmp_path / 'g.glb', smooth_normals=True)
    assert calls == []
    # --force-smooth-normals -> rebake even though the source ships normals.
    geometry.obj_to_geometry_glb(obj, tmp_path / 'g2.glb', smooth_normals=True,
                                 force_smooth_normals=True)
    assert len(calls) == 1


def test_obj_to_geometry_glb_bakes_when_normals_absent(tmp_path, monkeypatch):
    obj = tmp_path / 'm.obj'
    obj.write_text('v 0 0 0\nf 1\n')  # no vn in the source
    calls = []
    _stub_gltfpack(monkeypatch)
    monkeypatch.setattr(geometry, 'bake_normals',
                        lambda i, o, **k: calls.append(o) or Path(o))
    geometry.obj_to_geometry_glb(obj, tmp_path / 'g.glb', smooth_normals=True)
    assert len(calls) == 1


def test_hausdorff_result_budget():
    r = HausdorffResult(max_distance=0.03, mean=0.001, rms=0.002,
                        bbox_diagonal=3.0, budget=0.05)
    assert r.within_budget is True
    assert abs(r.max_fraction_of_diagonal - 0.01) < 1e-9

    r2 = HausdorffResult(max_distance=0.1, mean=0.01, rms=0.02, budget=0.05)
    assert r2.within_budget is False

    r3 = HausdorffResult(max_distance=0.1, mean=0.01, rms=0.02)
    assert r3.within_budget is None            # no budget set
    assert r3.max_fraction_of_diagonal is None  # no diagonal


def test_hausdorff_result_frac_budget():
    # Fractional budget compares max_distance/bbox_diagonal against budget_frac.
    r = HausdorffResult(max_distance=0.03, mean=0.001, rms=0.002,
                        bbox_diagonal=3.0, budget_frac=0.02)  # 1% <= 2%
    assert r.within_frac_budget is True
    assert r.over_budget is False

    r2 = HausdorffResult(max_distance=0.09, mean=0.01, rms=0.02,
                         bbox_diagonal=3.0, budget_frac=0.02)  # 3% > 2%
    assert r2.within_frac_budget is False
    assert r2.over_budget is True

    r3 = HausdorffResult(max_distance=0.09, mean=0.01, rms=0.02,
                         budget_frac=0.02)      # no diagonal -> unknown
    assert r3.within_frac_budget is None
    assert r3.over_budget is False

    # over_budget OR's the two budgets: within absolute but over fractional.
    r4 = HausdorffResult(max_distance=0.09, mean=0.01, rms=0.02,
                         bbox_diagonal=3.0, budget=1.0, budget_frac=0.02)
    assert r4.within_budget is True
    assert r4.within_frac_budget is False
    assert r4.over_budget is True

    # neither budget set -> report-only, never over budget.
    r5 = HausdorffResult(max_distance=99.0, mean=1.0, rms=1.0, bbox_diagonal=3.0)
    assert r5.over_budget is False


def test_validate_rejects_meshopt_glb(monkeypatch, tmp_path):
    # Guard converts a would-be pymeshlab segfault into a clear error.
    monkeypatch.setattr(geometry, 'is_meshopt_glb', lambda p: True)
    with pytest.raises(ValueError, match='meshopt'):
        geometry.validate(tmp_path / 'a.glb', tmp_path / 'b.glb')


def test_is_meshopt_glb_on_nonglb(tmp_path):
    p = tmp_path / 'notaglb.obj'
    p.write_text('v 0 0 0\n')
    assert geometry.is_meshopt_glb(p) is False


def test_strip_textures_drops_images_keeps_geometry(tmp_path):
    bin_data = b'\x01\x02\x03\x04' * 4
    doc = {
        'asset': {'version': '2.0'},
        'extensionsUsed': ['KHR_texture_transform', 'KHR_mesh_quantization'],
        'images': [{'name': '', 'bufferView': 1}],
        'textures': [{'source': 0}],
        'samplers': [{}],
        'materials': [{'pbrMetallicRoughness': {
            'baseColorTexture': {'index': 0}}}],
        'meshes': [{'primitives': [{'attributes': {'POSITION': 0},
                                    'material': 0}]}],
        'accessors': [{'bufferView': 0, 'componentType': 5126,
                       'count': 3, 'type': 'VEC3'}],
        'bufferViews': [{'buffer': 0, 'byteOffset': 0, 'byteLength': 16}],
        'buffers': [{'byteLength': len(bin_data)}],
    }
    p = tmp_path / 'plain.glb'
    p.write_bytes(_make_glb(doc, bin_data))

    geometry.strip_textures(p)

    out = geometry._glb_json(p)
    assert 'images' not in out
    assert 'textures' not in out
    assert 'samplers' not in out
    assert 'materials' not in out
    # texture-only extension dropped, geometry one kept
    assert out['extensionsUsed'] == ['KHR_mesh_quantization']
    # primitive material binding removed, geometry preserved
    prim = out['meshes'][0]['primitives'][0]
    assert 'material' not in prim
    assert prim['attributes'] == {'POSITION': 0}
    assert out['accessors'] and out['bufferViews']
    # BIN chunk left intact
    chunks = geometry._read_glb_chunks(p.read_bytes())
    assert (b'BIN\x00', bin_data) in chunks


def test_strip_textures_roundtrips_no_extensions(tmp_path):
    doc = {'asset': {'version': '2.0'},
           'meshes': [{'primitives': [{'attributes': {'POSITION': 0}}]}]}
    p = tmp_path / 'plain.glb'
    p.write_bytes(_make_glb(doc))
    geometry.strip_textures(p)
    out = geometry._glb_json(p)
    assert out['meshes'][0]['primitives'][0]['attributes'] == {'POSITION': 0}
