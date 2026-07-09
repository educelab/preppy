"""Unit tests for per-object manifest assembly (the widget's contract). Manifest
shape is easy to get subtly wrong — field pruning, the single-default invariant,
override pass-through — so it is covered thoroughly here.
"""

import json

import pytest

from preppy import manifest


def test_default_variant_index_explicit_and_fallback():
    variants = [{'suffix': 'rgb'}, {'suffix': 'ir', 'default': True}]
    assert manifest.default_variant_index(variants) == 1
    # No explicit default -> first variant.
    assert manifest.default_variant_index([{'suffix': 'rgb'}]) == 0
    # First explicit default wins.
    both = [{'suffix': 'a', 'default': True}, {'suffix': 'b', 'default': True}]
    assert manifest.default_variant_index(both) == 0


def test_default_variant_index_empty():
    with pytest.raises(ValueError, match='at least one variant'):
        manifest.default_variant_index([])


def test_variant_entry_minimal():
    e = manifest.variant_entry({'suffix': 'ir1050'}, 'o_ir1050.glb')
    assert e == {'id': 'ir1050', 'label': 'ir1050', 'uri': 'o_ir1050.glb'}
    assert 'default' not in e  # only present when set


def test_variant_entry_default_and_overrides():
    cfg = {'suffix': 'rgb', 'label': 'Spectral RGB', 'credit': 'X',
           'method': 'PGS', 'date': None}  # None override is dropped
    e = manifest.variant_entry(cfg, 'o_rgb.glb', default=True)
    assert e['id'] == 'rgb' and e['label'] == 'Spectral RGB'
    assert e['default'] is True
    assert e['credit'] == 'X' and e['method'] == 'PGS'
    assert 'date' not in e


def test_variant_entry_requires_suffix():
    with pytest.raises(KeyError, match='suffix'):
        manifest.variant_entry({'label': 'x'}, 'o.glb')


def test_build_manifest_shape_and_field_pruning():
    obj = {'id': 'OBJ', 'title': 'T', 'inventory': 'INV',
           'description': None, 'units': 'mm'}
    entries = [manifest.variant_entry({'suffix': 'rgb'}, 'OBJ_rgb.glb',
                                      default=True)]
    m = manifest.build_manifest(obj, entries)
    assert m['id'] == 'OBJ'
    assert m['title'] == 'T' and m['inventory'] == 'INV'
    assert 'description' not in m          # None pruned
    assert m['units'] == 'mm'              # honored over default
    assert m['variants'] == entries
    # id first, variants last.
    keys = list(m)
    assert keys[0] == 'id' and keys[-1] == 'variants'


def test_build_manifest_defaults_units_to_cm():
    entries = [manifest.variant_entry({'suffix': 'rgb'}, 'u.glb', default=True)]
    m = manifest.build_manifest({'id': 'OBJ'}, entries)
    assert m['units'] == manifest.DEFAULT_UNITS == 'cm'


def test_build_manifest_requires_exactly_one_default():
    two = [manifest.variant_entry({'suffix': 'a'}, 'a.glb', default=True),
           manifest.variant_entry({'suffix': 'b'}, 'b.glb', default=True)]
    with pytest.raises(ValueError, match='exactly one default'):
        manifest.build_manifest({'id': 'O'}, two)

    none = [manifest.variant_entry({'suffix': 'a'}, 'a.glb')]
    with pytest.raises(ValueError, match='exactly one default'):
        manifest.build_manifest({'id': 'O'}, none)


def test_build_manifest_requires_id_and_variants():
    with pytest.raises(KeyError, match='id'):
        manifest.build_manifest({}, [{'id': 'x', 'default': True}])
    with pytest.raises(ValueError, match='no variant entries'):
        manifest.build_manifest({'id': 'O'}, [])


def test_index_entry_and_build_index():
    e = manifest.index_entry('OBJ', 'Title', 'OBJ/manifest.json',
                             thumb='OBJ/OBJ_thumb.jpg')
    assert e == {'id': 'OBJ', 'title': 'Title',
                 'manifest': 'OBJ/manifest.json', 'thumb': 'OBJ/OBJ_thumb.jpg'}
    no_thumb = manifest.index_entry('OBJ', 'Title', 'OBJ/manifest.json')
    assert 'thumb' not in no_thumb
    idx = manifest.build_index([e])
    assert idx == {'objects': [e]}


def test_write_json_roundtrip(tmp_path):
    data = {'id': 'OBJ', 'variants': [{'id': 'rgb'}]}
    out = manifest.write_json(data, tmp_path / 'sub' / 'manifest.json')
    assert out.exists()
    assert json.loads(out.read_text()) == data
    assert out.read_text().endswith('\n')
