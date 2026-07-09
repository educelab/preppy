"""Unit tests for content hashing, hashed naming, and prune. Hashing correctness
is easy to get subtly wrong (determinism, sensitivity), so it is covered
thoroughly here.
"""

from preppy import cache


def _mk(tmp_path, name, data):
    p = tmp_path / name
    p.write_bytes(data)
    return p


def test_hash_is_deterministic_and_short(tmp_path):
    a = _mk(tmp_path, 'a.obj', b'geometry')
    b = _mk(tmp_path, 'b.jpg', b'texture')
    h1 = cache.content_hash([a, b], config={'si': 0.2})
    h2 = cache.content_hash([a, b], config={'si': 0.2})
    assert h1 == h2
    assert len(h1) == cache.DEFAULT_HASH_LENGTH
    assert all(c in '0123456789abcdef' for c in h1)


def test_hash_order_independent(tmp_path):
    a = _mk(tmp_path, 'a.obj', b'geometry')
    b = _mk(tmp_path, 'b.jpg', b'texture')
    assert cache.content_hash([a, b]) == cache.content_hash([b, a])


def test_hash_sensitive_to_content(tmp_path):
    a = _mk(tmp_path, 'a.obj', b'geometry')
    h1 = cache.content_hash([a])
    a.write_bytes(b'geometry!')  # one byte different
    assert cache.content_hash([a]) != h1


def test_hash_sensitive_to_config_and_tools(tmp_path):
    a = _mk(tmp_path, 'a.obj', b'geometry')
    base = cache.content_hash([a], config={'si': 0.2})
    assert cache.content_hash([a], config={'si': 0.5}) != base
    assert cache.content_hash([a], config={'si': 0.2},
                              tool_versions={'ktx': '5.0.0'}) != base


def test_hash_sensitive_to_rename(tmp_path):
    a = _mk(tmp_path, 'a.obj', b'same-bytes')
    b = _mk(tmp_path, 'b.obj', b'same-bytes')
    assert cache.content_hash([a]) != cache.content_hash([b])


def test_hashed_name():
    assert cache.hashed_name('obj', 'rgb', 'deadbeef') == 'obj_rgb.deadbeef.glb'
    assert cache.hashed_name('obj', 'rgb') == 'obj_rgb.glb'
    assert cache.hashed_name('obj', 'ir', 'deadbeef', ext='ktx2') == \
        'obj_ir.deadbeef.ktx2'


def test_is_hashed_asset():
    assert cache.is_hashed_asset('obj_rgb.deadbeef.glb')
    assert not cache.is_hashed_asset('obj_rgb.glb')       # stable name
    assert not cache.is_hashed_asset('manifest.json')
    assert not cache.is_hashed_asset('obj_rgb.deadbee.glb')  # 7 hex, not 8


def test_prune_removes_only_unreferenced_hashed(tmp_path):
    keep = tmp_path / 'obj_rgb.aaaaaaaa.glb'
    drop = tmp_path / 'obj_rgb.bbbbbbbb.glb'
    stable = tmp_path / 'manifest.json'
    for p in (keep, drop, stable):
        p.write_text('x')

    removed = cache.prune(tmp_path, keep={'obj_rgb.aaaaaaaa.glb'})
    assert removed == [drop]
    assert not drop.exists()
    assert keep.exists() and stable.exists()  # referenced + stable untouched


def test_prune_dry_run(tmp_path):
    drop = tmp_path / 'obj_rgb.bbbbbbbb.glb'
    drop.write_text('x')
    removed = cache.prune(tmp_path, keep=set(), dry_run=True)
    assert removed == [drop]
    assert drop.exists()  # dry run leaves it in place


def test_prune_missing_dir(tmp_path):
    assert cache.prune(tmp_path / 'nope', keep=set()) == []
