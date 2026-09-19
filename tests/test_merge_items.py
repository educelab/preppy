"""Unit tests for the catalog merge tool. The directory merge moves real assets
around, so the collision rules (duplicate ids, shared subdirectories) and the
up-front plan — nothing is copied until the whole merge is known to be valid —
are what's covered here.
"""

import json

import pytest

from preppy.apps import merge_items


def make_output_dir(root, object_id, title=None, subdir=None):
    """Build a minimal preppy output directory with one object."""
    subdir = subdir or object_id
    obj_dir = root / subdir
    obj_dir.mkdir(parents=True)
    (obj_dir / 'manifest.json').write_text(json.dumps({'id': object_id}))
    (obj_dir / f'{subdir}_rgb.abc12345.glb').write_bytes(b'glb')
    entry = {'id': object_id, 'title': title or object_id,
             'manifest': f'{subdir}/manifest.json',
             'thumb': f'{subdir}/{subdir}_thumb.jpg'}
    (root / 'index.json').write_text(json.dumps({'objects': [entry]}))
    return root


def test_is_index_input(tmp_path):
    d = tmp_path / 'out'
    d.mkdir()
    assert merge_items.is_index_input(d)
    assert merge_items.is_index_input(d / 'index.json')
    assert not merge_items.is_index_input(tmp_path / 'items.json')


def test_load_index_accepts_dir_or_file(tmp_path):
    make_output_dir(tmp_path / 'a', 'OBJ')
    root, objects = merge_items.load_index(tmp_path / 'a')
    assert root == tmp_path / 'a'
    assert objects[0]['id'] == 'OBJ'
    # The index.json itself resolves to the same root.
    assert merge_items.load_index(tmp_path / 'a' / 'index.json')[0] == root


def test_load_index_rejects_missing_and_malformed(tmp_path):
    (tmp_path / 'empty').mkdir()
    with pytest.raises(FileNotFoundError, match='index.json'):
        merge_items.load_index(tmp_path / 'empty')

    bad = tmp_path / 'bad'
    bad.mkdir()
    (bad / 'index.json').write_text(json.dumps([{'id': 'OBJ'}]))  # a list
    with pytest.raises(ValueError, match='not an index.json'):
        merge_items.load_index(bad)


def test_object_subdir_requires_a_subdirectory():
    assert merge_items.object_subdir({'manifest': 'OBJ/manifest.json'}) == 'OBJ'
    with pytest.raises(ValueError, match='per-object subdirectory'):
        merge_items.object_subdir({'id': 'OBJ', 'manifest': 'manifest.json'})


def test_merge_output_dirs_copies_assets_and_merges_index(tmp_path):
    a = make_output_dir(tmp_path / 'a', 'PHerc10Cr1', 'P.Herc. 10')
    b = make_output_dir(tmp_path / 'b', 'PHerc2Cr1', 'P.Herc. 2')
    out = tmp_path / 'merged'

    entries = merge_items.merge_output_dirs([a, b], out, sort_key='title')

    # Natural sort: 2 before 10.
    assert [e['id'] for e in entries] == ['PHerc2Cr1', 'PHerc10Cr1']
    index = json.loads((out / 'index.json').read_text())
    assert [o['id'] for o in index['objects']] == ['PHerc2Cr1', 'PHerc10Cr1']
    # Assets came along, and the relative uris still resolve.
    for entry in entries:
        assert (out / entry['manifest']).is_file()
        assert list((out / entry['id']).glob('*.glb'))


def test_merge_output_dirs_unsorted_keeps_source_order(tmp_path):
    a = make_output_dir(tmp_path / 'a', 'B')
    b = make_output_dir(tmp_path / 'b', 'A')
    entries = merge_items.merge_output_dirs([a, b], tmp_path / 'out')
    assert [e['id'] for e in entries] == ['B', 'A']


def test_merge_output_dirs_refuses_duplicate_ids(tmp_path):
    a = make_output_dir(tmp_path / 'a', 'OBJ')
    b = make_output_dir(tmp_path / 'b', 'OBJ')
    out = tmp_path / 'merged'
    with pytest.raises(ValueError, match='duplicate object'):
        merge_items.merge_output_dirs([a, b], out)
    assert not out.exists()  # planned up front: nothing was copied


def test_merge_output_dirs_overwrite_takes_last_source(tmp_path):
    a = make_output_dir(tmp_path / 'a', 'OBJ', 'Old')
    b = make_output_dir(tmp_path / 'b', 'OBJ', 'New')
    (b / 'OBJ' / 'OBJ_rgb.abc12345.glb').write_bytes(b'newer')
    out = tmp_path / 'merged'

    entries = merge_items.merge_output_dirs([a, b], out, overwrite=True)

    assert len(entries) == 1 and entries[0]['title'] == 'New'
    assert (out / 'OBJ' / 'OBJ_rgb.abc12345.glb').read_bytes() == b'newer'


def test_merge_output_dirs_refuses_shared_subdir(tmp_path):
    a = make_output_dir(tmp_path / 'a', 'ONE', subdir='shared')
    b = make_output_dir(tmp_path / 'b', 'TWO', subdir='shared')
    with pytest.raises(ValueError, match='both use subdirectory'):
        merge_items.merge_output_dirs([a, b], tmp_path / 'merged')


def test_merge_output_dirs_replaces_stale_object_dir(tmp_path):
    a = make_output_dir(tmp_path / 'a', 'OBJ')
    out = tmp_path / 'merged'
    stale = out / 'OBJ'
    stale.mkdir(parents=True)
    (stale / 'OBJ_rgb.deadbeef.glb').write_bytes(b'old generation')

    merge_items.merge_output_dirs([a], out)

    assert not (stale / 'OBJ_rgb.deadbeef.glb').exists()
    assert (stale / 'OBJ_rgb.abc12345.glb').is_file()


def test_merge_duplicates_legacy_items():
    data = [{'title': 'A', 'document': 'a.json'},
            {'title': 'A', 'document': 'a.json'},
            {'title': 'G', 'subitems': [{'title': 'S', 'document': 's.json'}]},
            {'title': 'G', 'subitems': [{'title': 'T', 'document': 't.json'}]}]
    merged = merge_items.merge_duplicates(data, 'title')
    assert merge_items.get_num_docs(merged) == (3, 1)
