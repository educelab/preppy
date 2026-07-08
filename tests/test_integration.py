"""End-to-end smoke test: run the ``voyager-preppy`` orchestrator over a trimmed,
synthetic multi-material sample (standing in for the large `mvs` data, which
can't be committed) and assert the emitted manifest + asset set.

The sample deliberately declares its two materials out of numeric order
(``material_01`` before ``material_00``) — the Phase 0 F1 trap — so the test
also guards that textures embed by material name, not index.

Skipped whole-module when the external pipeline tools (magick/ktx/gltfpack/node
+ the embed helper's npm deps) aren't installed, so it degrades to the historic
``-h`` smoke coverage in a bare CI.
"""

import json
import struct
import subprocess as sp
import sys
from pathlib import Path

import pytest

from preppy import assemble, tools

_NEEDED = ('magick', 'ktx', 'gltfpack', 'node')


def _tools_available() -> bool:
    statuses = tools.check_all(_NEEDED)
    return (all(s.ok for s in statuses.values())
            and assemble.node_deps_installed())


pytestmark = pytest.mark.skipif(
    not _tools_available(),
    reason='external pipeline tools (magick/ktx/gltfpack/node) not available')


def _glb_json(path: Path) -> dict:
    with path.open('rb') as f:
        f.read(12)
        clen = struct.unpack('<I', f.read(4))[0]
        assert f.read(4) == b'JSON'
        return json.loads(f.read(clen))


@pytest.fixture
def sample(tmp_path):
    """Write a 2-material OBJ (materials reversed vs numeric order) + textures +
    a two-variant config, and return (config_path, out_dir)."""
    src = tmp_path / 'src'
    src.mkdir()
    sp.run(['magick', '-size', '32x32', 'xc:#c81e1e', str(src / 'tex_00.png')],
           check=True)
    sp.run(['magick', '-size', '32x32', 'xc:#1e6ec8', str(src / 'tex_01.png')],
           check=True)
    # material_01 declared BEFORE material_00 (numeric order reversed — F1).
    (src / 'mesh.mtl').write_text(
        'newmtl material_01\nKd 1 1 1\nmap_Kd tex_01.png\n\n'
        'newmtl material_00\nKd 1 1 1\nmap_Kd tex_00.png\n')
    (src / 'mesh.obj').write_text('\n'.join([
        'mtllib mesh.mtl',
        'v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0',
        'v 2 0 0', 'v 3 0 0', 'v 3 1 0', 'v 2 1 0',
        'vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0 1',
        'usemtl material_00', 'f 1/1 2/2 3/3', 'f 1/1 3/3 4/4',
        'usemtl material_01', 'f 5/1 6/2 7/3', 'f 5/1 7/3 8/4',
    ]) + '\n')

    config = [{
        'id': 'MVS', 'title': 'MVS Sample', 'inventory': 'MVS-1',
        'credit': '(c) UK', 'date': '2026-07-08', 'units': 'cm',
        'variants': [
            {'suffix': 'rgb', 'label': 'RGB', 'obj': 'src/mesh.obj',
             'default': True},
            {'suffix': 'ir', 'label': 'IR', 'obj': 'src/mesh.obj',
             'credit': 'IR credit'},
        ],
    }]
    config_path = tmp_path / 'config.json'
    config_path.write_text(json.dumps(config))
    return config_path, tmp_path / 'out'


def _run(config_path, out_dir, *extra):
    argv = ['voyager-preppy', '-i', str(config_path), '-o', str(out_dir),
            *extra]
    from preppy.apps import file_prep
    old = sys.argv
    sys.argv = argv
    try:
        file_prep.main()
    finally:
        sys.argv = old


def test_pipeline_emits_manifest_and_assets(sample):
    config_path, out_dir = sample
    _run(config_path, out_dir)

    # index.json lists the object with a thumbnail.
    index = json.loads((out_dir / 'index.json').read_text())
    assert [o['id'] for o in index['objects']] == ['MVS']
    assert index['objects'][0]['thumb'] == 'MVS/MVS_thumb.jpg'
    assert (out_dir / 'MVS' / 'MVS_thumb.jpg').is_file()

    # per-object manifest shape.
    man = json.loads((out_dir / 'MVS' / 'manifest.json').read_text())
    assert man['id'] == 'MVS' and man['units'] == 'cm'
    assert [v['id'] for v in man['variants']] == ['rgb', 'ir']
    assert [v for v in man['variants'] if v.get('default')] == [man['variants'][0]]
    assert man['variants'][1]['credit'] == 'IR credit'  # per-variant override

    # every variant uri resolves to a self-contained glb with the right
    # extensions and name-matched (not index-matched) textures.
    for v in man['variants']:
        glb = out_dir / 'MVS' / v['uri']
        assert glb.is_file(), v['uri']
        assert v['uri'].startswith(f"MVS_{v['id']}.")  # <prefix>_<suffix>.<hash>.glb
        doc = _glb_json(glb)
        used = set(doc.get('extensionsUsed', []))
        assert {'EXT_meshopt_compression', 'KHR_texture_basisu',
                'KHR_texture_transform'} <= used
        assert {m['name'] for m in doc['materials']} == {'material_00',
                                                         'material_01'}
        assert all(i['mimeType'] == 'image/ktx2' for i in doc['images'])

    # tmp cleaned by default.
    assert not (out_dir / 'tmp').exists()


def test_pipeline_no_hash_names_stable_assets(sample):
    config_path, out_dir = sample
    _run(config_path, out_dir, '--no-hash-names')
    man = json.loads((out_dir / 'MVS' / 'manifest.json').read_text())
    assert {v['uri'] for v in man['variants']} == {'MVS_rgb.glb', 'MVS_ir.glb'}
    for v in man['variants']:
        assert (out_dir / 'MVS' / v['uri']).is_file()
