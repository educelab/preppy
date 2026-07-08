"""Validate the shipped input schema and example configs against each other, so
the object -> variants[] contract stays consistent (spec/A1). Requires the
test-only `jsonschema` dependency.
"""

import json
from pathlib import Path

import pytest

jsonschema = pytest.importorskip('jsonschema')

TEMPLATES = Path(__file__).resolve().parents[1] / 'templates'
SCHEMA = TEMPLATES / 'prep-models.schema.json'
EXAMPLES = ['prep-models-example.json', 'mvs-example.json']


@pytest.fixture(scope='module')
def validator():
    schema = json.loads(SCHEMA.read_text())
    jsonschema.Draft202012Validator.check_schema(schema)
    return jsonschema.Draft202012Validator(schema)


@pytest.mark.parametrize('name', EXAMPLES)
def test_examples_validate(validator, name):
    data = json.loads((TEMPLATES / name).read_text())
    errors = list(validator.iter_errors(data))
    assert not errors, [f'{list(e.path)}: {e.message}' for e in errors]


def _obj(**over):
    base = {'id': 'OBJ', 'title': 'T',
            'variants': [{'suffix': 'rgb', 'obj': 'a.obj'}]}
    base.update(over)
    return [base]


def test_rejects_missing_required(validator):
    assert list(validator.iter_errors(_obj(id=None)))            # id must be string
    assert list(validator.iter_errors([{'id': 'OBJ', 'title': 'T'}]))  # no variants
    assert list(validator.iter_errors(
        [{'id': 'OBJ', 'title': 'T', 'variants': [{'suffix': 's'}]}]))  # no obj


def test_rejects_non_url_safe_ids(validator):
    assert list(validator.iter_errors(_obj(id='bad id!')))
    assert list(validator.iter_errors(
        [{'id': 'OBJ', 'title': 'T',
          'variants': [{'suffix': 'has space', 'obj': 'a.obj'}]}]))


def test_rejects_unknown_fields(validator):
    assert list(validator.iter_errors(_obj(bogus='x')))


def test_accepts_optional_shapes(validator):
    # localized description, nodataFill null override, provenance overrides.
    cfg = _obj(description={'en': 'hi', 'fr': 'salut'}, nodataFill='#FF7F00')
    cfg[0]['variants'] = [
        {'suffix': 'rgb', 'obj': 'a.obj', 'default': True, 'nodataFill': None},
        {'suffix': 'ir', 'obj': 'b.obj', 'credit': 'c', 'method': 'm',
         'texture': ['t0.tif', 't1.tif']},
    ]
    assert not list(validator.iter_errors(cfg))
