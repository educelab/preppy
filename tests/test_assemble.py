"""Unit tests for assemble command construction and its guards. The real embed
(meshopt + KHR_texture_transform survival) is validated live in the Phase 2
verification.
"""

from pathlib import Path

import pytest

from preppy import assemble


def test_embed_cmd_maps_by_name_and_opaque():
    cmd = assemble.embed_cmd(
        'node', Path('geom.glb'), Path('out.glb'),
        {'material_00': 'a.ktx2', 'material_01': Path('b.ktx2')}, opaque=True)
    assert cmd[0] == 'node' and cmd[1] == str(assemble.EMBED_SCRIPT)
    assert cmd[cmd.index('--geom') + 1] == 'geom.glb'
    assert cmd[cmd.index('--out') + 1] == 'out.glb'
    # Each material becomes a name=path --map pair.
    maps = [cmd[i + 1] for i, a in enumerate(cmd) if a == '--map']
    assert 'material_00=a.ktx2' in maps
    assert 'material_01=b.ktx2' in maps
    assert '--opaque' in cmd


def test_embed_cmd_no_opaque():
    cmd = assemble.embed_cmd('node', Path('g.glb'), Path('o.glb'),
                             {'m': 'x.ktx2'}, opaque=False)
    assert '--opaque' not in cmd


def test_embed_rejects_empty_mapping(monkeypatch):
    monkeypatch.setattr(assemble, '_require_node', lambda: 'node')
    with pytest.raises(ValueError, match='at least one material'):
        assemble.embed('g.glb', {}, 'o.glb')


def test_require_node_missing(monkeypatch):
    monkeypatch.setattr(assemble.shutil, 'which', lambda _: None)
    with pytest.raises(RuntimeError, match='node was not found'):
        assemble._require_node()


def test_require_node_deps_missing(monkeypatch):
    monkeypatch.setattr(assemble.shutil, 'which', lambda _: '/usr/bin/node')
    monkeypatch.setattr(assemble, 'node_deps_installed', lambda: False)
    with pytest.raises(RuntimeError, match='npm install'):
        assemble._require_node()


def test_embed_script_is_bundled():
    # The helper ships inside the package.
    assert assemble.EMBED_SCRIPT.name == 'embed.mjs'
    assert assemble.EMBED_SCRIPT.exists()
