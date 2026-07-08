"""Manifest builder: the viewer-native, per-object descriptor that replaces the
Voyager ``items.json`` + ``*.svx.json`` pair (ADR-0002, amended).

The ``<dri-viewer>`` widget consumes **one manifest per object** (one scene):
object-level metadata (``title``, ``inventory``, ``description``, ``credit``,
``date``, ``units``) plus a flat ``variants[]``, each a self-contained glb
referenced by ``uri`` with a stable ``id`` (the variant ``suffix``, used for
deep-linking) and a display ``label``. Exactly one variant is flagged
``default``. Variants may carry per-variant provenance overrides (``credit``,
``date``, ``method``, ``description``).

An optional flat ``index.json`` lists objects for a host archive UI; the widget
does not require it.

Builders are pure dict factories (no I/O) so they unit-test without the
toolchain; :func:`write_json` is the only side-effecting helper.
"""

import json
from pathlib import Path
from typing import Dict, List, Mapping, Optional, Sequence, Union

PathLike = Union[str, Path]

#: Default measurement units for a scene (spike: geometry is in cm).
DEFAULT_UNITS = 'cm'

#: Object-level metadata copied verbatim into the manifest, in manifest order.
#: ``id`` and ``units`` are handled explicitly; ``variants`` is appended last.
OBJECT_META_FIELDS = ('title', 'titles', 'inventory', 'description',
                      'credit', 'date')

#: Optional per-variant provenance overrides copied into a variant entry.
VARIANT_OVERRIDE_FIELDS = ('credit', 'date', 'method', 'description')


def default_variant_index(variants: Sequence[Mapping]) -> int:
    """Return the index of the variant to mark ``default``.

    The first variant whose config sets ``"default": true`` wins; if none do,
    the first variant is the default. Raises if ``variants`` is empty.
    """
    if not variants:
        raise ValueError('an object must declare at least one variant')
    for i, v in enumerate(variants):
        if v.get('default'):
            return i
    return 0


def variant_entry(variant_cfg: Mapping, uri: str, *,
                  default: bool = False) -> Dict:
    """Build one manifest ``variants[]`` entry.

    ``id`` is the variant's stable ``suffix`` (deep-link / selection key),
    ``label`` its display name (falls back to the suffix), ``uri`` the emitted
    self-contained glb. ``default`` adds ``"default": true`` only when set (the
    non-default entries omit the key). Present, non-null override fields
    (:data:`VARIANT_OVERRIDE_FIELDS`) are copied through.
    """
    try:
        vid = variant_cfg['suffix']
    except KeyError:
        raise KeyError("variant config requires a 'suffix'")

    entry: Dict = {
        'id': vid,
        'label': variant_cfg.get('label', vid),
        'uri': uri,
    }
    if default:
        entry['default'] = True
    for field in VARIANT_OVERRIDE_FIELDS:
        val = variant_cfg.get(field)
        if val is not None:
            entry[field] = val
    return entry


def build_manifest(object_cfg: Mapping,
                   variant_entries: Sequence[Mapping]) -> Dict:
    """Assemble the per-object manifest dict.

    Copies present, non-null object metadata (:data:`OBJECT_META_FIELDS`) from
    ``object_cfg``, defaults ``units`` to :data:`DEFAULT_UNITS`, and appends the
    already-built ``variant_entries``. Requires an ``id`` and at least one
    variant; exactly one variant should be flagged ``default`` (see
    :func:`default_variant_index`).
    """
    try:
        oid = object_cfg['id']
    except KeyError:
        raise KeyError("object config requires an 'id'")
    if not variant_entries:
        raise ValueError(f"object {oid!r} has no variant entries")

    manifest: Dict = {'id': oid}
    for field in OBJECT_META_FIELDS:
        val = object_cfg.get(field)
        if val is not None:
            manifest[field] = val
    manifest['units'] = object_cfg.get('units') or DEFAULT_UNITS
    manifest['variants'] = list(variant_entries)

    defaults = [v for v in variant_entries if v.get('default')]
    if len(defaults) != 1:
        raise ValueError(
            f"object {oid!r} must have exactly one default variant, "
            f"got {len(defaults)}")
    return manifest


def index_entry(object_id: str, title: str, manifest_uri: str, *,
                thumb: Optional[str] = None) -> Dict:
    """Build one ``index.json`` ``objects[]`` entry (host archive UI only)."""
    entry: Dict = {'id': object_id, 'title': title, 'manifest': manifest_uri}
    if thumb is not None:
        entry['thumb'] = thumb
    return entry


def build_index(objects: Sequence[Mapping]) -> Dict:
    """Wrap ``index_entry`` results into the optional top-level ``index.json``."""
    return {'objects': list(objects)}


def write_json(data: Mapping, path: PathLike, *, indent: int = 2) -> Path:
    """Write ``data`` as UTF-8 JSON to ``path`` (creating parents); return it."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w', encoding='utf8') as f:
        json.dump(data, f, indent=indent, ensure_ascii=False)
        f.write('\n')
    return path
