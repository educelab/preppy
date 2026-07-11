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
