"""Unit tests for material->texture resolution. The name-keyed mapping is what
keeps the embed correct when gltfpack reorders materials (Phase 0 F1), so the
declaration-order and missing-map_Kd cases are covered explicitly.
"""

from preppy import obj_helpers


def _write_obj(tmp_path, mtllibs, body=''):
    obj = tmp_path / 'mesh.obj'
    lines = [f'mtllib {m}' for m in mtllibs] + [body]
    obj.write_text('\n'.join(lines) + '\n')
    return obj


def test_parse_material_textures_keys_by_name_reversed_order(tmp_path):
    # MTL declares material_01 before material_00 (numeric order reversed) — the
    # exact F1 trap. The map must still associate each name with its own image.
    (tmp_path / 'mesh.mtl').write_text(
        'newmtl material_01\nmap_Kd tex_01.png\n'
        'newmtl material_00\nmap_Kd tex_00.png\n')
    obj = _write_obj(tmp_path, ['mesh.mtl'])
    mats = obj_helpers.parse_material_textures(obj)
    assert set(mats) == {'material_00', 'material_01'}
    assert mats['material_00'].name == 'tex_00.png'
    assert mats['material_01'].name == 'tex_01.png'
    assert mats['material_00'].is_absolute()  # resolved beside the MTL


def test_parse_material_textures_skips_untextured_material(tmp_path):
    (tmp_path / 'mesh.mtl').write_text(
        'newmtl textured\nmap_Kd a.png\n'
        'newmtl bare\nKd 1 1 1\n')  # no map_Kd -> omitted
    obj = _write_obj(tmp_path, ['mesh.mtl'])
    mats = obj_helpers.parse_material_textures(obj)
    assert set(mats) == {'textured'}


def test_parse_material_textures_spans_multiple_mtllibs(tmp_path):
    (tmp_path / 'a.mtl').write_text('newmtl m_a\nmap_Kd a.png\n')
    (tmp_path / 'b.mtl').write_text('newmtl m_b\nmap_Kd b.png\n')
    obj = _write_obj(tmp_path, ['a.mtl', 'b.mtl'])
    mats = obj_helpers.parse_material_textures(obj)
    assert set(mats) == {'m_a', 'm_b'}


def test_mtllibs_resolves_beside_obj(tmp_path):
    (tmp_path / 'mesh.mtl').write_text('newmtl m\nmap_Kd a.png\n')
    obj = _write_obj(tmp_path, ['mesh.mtl'])
    libs = list(obj_helpers._mtllibs(obj))
    assert libs == [tmp_path / 'mesh.mtl']
