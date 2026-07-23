"""Unit tests for content hashing, hashed naming, and prune. Hashing correctness
is easy to get subtly wrong (determinism, sensitivity), so it is covered
thoroughly here.
"""

import os

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


def _gen(tmp_path, stem, digest, mtime, ext='glb'):
    p = tmp_path / f'{stem}.{digest}.{ext}'
    p.write_text('x')
    os.utime(p, (mtime, mtime))
    return p


def test_prune_keep_last_retains_newest_n_per_variant(tmp_path):
    # Four unreferenced generations, oldest -> newest by mtime.
    a1 = _gen(tmp_path, 'obj_rgb', 'a1a1a1a1', 1000)
    b2 = _gen(tmp_path, 'obj_rgb', 'b2b2b2b2', 1001)
    c3 = _gen(tmp_path, 'obj_rgb', 'c3c3c3c3', 1002)
    d4 = _gen(tmp_path, 'obj_rgb', 'd4d4d4d4', 1003)
    current = _gen(tmp_path, 'obj_rgb', 'e5e5e5e5', 1004)  # referenced

    removed = cache.prune(tmp_path, keep={current.name}, keep_last=2)
    # Retain the 2 newest unreferenced (c3, d4); drop the 2 oldest (a1, b2).
    assert removed == sorted([a1, b2])
    assert c3.exists() and d4.exists() and current.exists()


def test_prune_keep_last_is_per_variant(tmp_path):
    rgb_old = _gen(tmp_path, 'obj_rgb', '11111111', 2000)
    rgb_new = _gen(tmp_path, 'obj_rgb', '22222222', 2001)
    ir_old = _gen(tmp_path, 'obj_ir', '33333333', 2000)
    ir_new = _gen(tmp_path, 'obj_ir', '44444444', 2001)
    # keep_last=1 -> each variant independently keeps its own newest generation.
    removed = cache.prune(tmp_path, keep=set(), keep_last=1)
    assert removed == sorted([rgb_old, ir_old])
    assert rgb_new.exists() and ir_new.exists()


def test_prune_keep_last_zero_drops_all_unreferenced(tmp_path):
    _gen(tmp_path, 'obj_rgb', '11111111', 3000)
    _gen(tmp_path, 'obj_rgb', '22222222', 3001)
    assert len(cache.prune(tmp_path, keep=set(), keep_last=0)) == 2


def test_prune_keep_last_dry_run(tmp_path):
    for i, h in enumerate(('11111111', '22222222', '33333333')):
        _gen(tmp_path, 'obj_rgb', h, 4000 + i)
    removed = cache.prune(tmp_path, keep=set(), keep_last=1, dry_run=True)
    assert len(removed) == 2  # 2 oldest would be dropped...
    assert len(list(tmp_path.iterdir())) == 3  # ...but nothing is unlinked
