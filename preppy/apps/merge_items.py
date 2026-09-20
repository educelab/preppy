"""Merge separately-built catalogs into one.

Two input shapes, auto-detected:

* **output directories** (or their ``index.json``) — each per-object
  subdirectory is copied into the output directory and the ``index.json``
  ``objects[]`` lists are merged into one. Object ``id`` is the merge key.
  ``--update`` merges into an existing catalog in place (only the named
  sources move); ``--index-only`` merges the listings and copies nothing.
* **legacy ``items.json`` files** — the deprecated Voyager document list, merged
  and de-duplicated in place (no assets involved).
"""

import argparse
import json
import shutil
from collections import OrderedDict
from operator import itemgetter
from pathlib import Path, PurePosixPath

from natsort import natsorted

from preppy import manifest

#: Stable name of the top-level archive listing in an output directory.
INDEX_NAME = 'index.json'


def merge_document_lists(a, b):
    """Merge two lists of documents"""
    return list(OrderedDict((frozenset(i.items()), i) for i in a + b).values())


def merge_duplicates(data, sort_key=None):
    """Remove duplicates from a mixed list of documents and document groups"""
    keyed = OrderedDict()
    for d in data:
        # Get the merge key
        is_group = 'subitems' in d.keys()
        key = f'{d["title"]}G' if is_group else f'{d["title"]}S'

        # Simple case, we've not seen this key before
        if key not in keyed.keys():
            if is_group:
                keyed[key] = d
            else:
                keyed[key] = [d]
            continue

        entry = keyed[key]
        # merge d['subitems] into entry['subitems']
        if is_group:
            entry['subitems'] = merge_document_lists(entry['subitems'],
                                                     d['subitems'])

        # remove duplicate single items
        else:
            keyed[key] = merge_document_lists(entry, [d])

    # Merge everything back into a mixed list
    data = []
    for item in keyed.values():
        if isinstance(item, list):
            if sort_key is not None:
                item = natsorted(item, key=itemgetter(*[sort_key]))
            data.extend(item)
        else:
            if sort_key is not None:
                item['subitems'] = natsorted(item['subitems'],
                                             key=itemgetter(*[sort_key]))
            data.append(item)
    return data


def get_num_docs(data):
    """Get the number of documents and groups in the mixed document list"""
    num_docs = 0
    num_groups = 0
    for d in data:
        if 'subitems' in d.keys():
            num_groups += 1
            num_docs += len(d['subitems'])
        else:
            num_docs += 1
    return num_docs, num_groups


def is_index_input(path):
    """True if ``path`` looks like an output directory (or its index.json)."""
    path = Path(path)
    return path.is_dir() or path.name == INDEX_NAME


def index_root(path):
    """The directory an index's ``manifest``/``thumb`` URIs resolve against.

    Accepts either the output directory or its ``index.json``.
    """
    path = Path(path)
    return path.parent if path.name == INDEX_NAME else path


def load_index(path):
    """Load an output directory's listing; return ``(root_dir, objects)``.

    ``path`` is either the directory holding ``index.json`` or the file itself;
    ``root_dir`` is the directory the entries' ``manifest``/``thumb`` URIs are
    relative to.
    """
    root = index_root(path)
    index = root / INDEX_NAME
    if not index.is_file():
        raise FileNotFoundError(f"no '{INDEX_NAME}' in '{root}'")

    with index.open(encoding='utf8') as f:
        data = json.load(f)
    objects = data.get('objects') if isinstance(data, dict) else None
    if not isinstance(objects, list):
        raise ValueError(f"'{index}' is not an index.json (no 'objects' list)")
    return index.parent, objects


def object_subdir(entry):
    """The per-object subdirectory an index entry lives in."""
    parts = PurePosixPath(entry['manifest']).parts
    if len(parts) < 2:
        raise ValueError(
            f"object '{entry.get('id')}' manifest '{entry['manifest']}' is not "
            f'in a per-object subdirectory; nothing to merge')
    return parts[0]


def plan_merge(sources, *, overwrite=False, base=None):
    """Resolve sources to a list of ``(src_dir, subdir_name, entry)`` to copy.

    Duplicate object ``id``s across sources are an error unless ``overwrite``,
    in which case the last source wins. Two different objects claiming the same
    subdirectory is always an error — one would clobber the other's assets.

    ``base`` is an existing catalog seeding the merge (an incremental update):
    its objects are planned with a ``src_dir`` of ``None`` — already in place,
    nothing to copy — and keep their position in the listing. A source
    redeclaring one replaces it without ``overwrite``; that is the point.
    """
    planned = OrderedDict()
    claimed = {}
    replaceable = set()

    stages = [(base, True)] if base is not None else []
    stages += [(source, False) for source in sources]
    for source, is_base in stages:
        root, objects = load_index(source)
        for entry in objects:
            oid = entry.get('id')
            if not oid:
                raise ValueError(f"'{root}' has an index entry without an 'id'")
            subdir = object_subdir(entry)

            owner = claimed.get(subdir)
            if owner is not None and owner != oid:
                raise ValueError(
                    f"objects '{owner}' and '{oid}' both use subdirectory "
                    f"'{subdir}'")
            if oid in planned and oid not in replaceable and not overwrite:
                raise ValueError(
                    f"duplicate object '{oid}' in '{root}'; pass --overwrite "
                    f'to let the last source win')

            claimed[subdir] = oid
            planned[oid] = (None if is_base else root / subdir, subdir, entry)
            if is_base:
                replaceable.add(oid)
            else:
                replaceable.discard(oid)
    return list(planned.values())


def copy_object_dir(src, dst):
    """Copy an object's asset directory, replacing any existing one."""
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)


def merge_output_dirs(sources, out_dir, *, overwrite=False, sort_key=None,
                      base=None, index_only=False):
    """Merge output directories into ``out_dir``; return the merged entries.

    Copies every object's subdirectory, then writes the combined
    ``index.json``. The plan is resolved up front, so a collision fails before
    anything is copied.

    ``base`` (normally ``out_dir`` itself) makes this an incremental update:
    only the sources' objects are copied and the rest of the catalog is left
    alone. ``index_only`` merges the listings and copies nothing, for a catalog
    whose assets are not reachable from here.
    """
    out_dir = Path(out_dir)
    planned = plan_merge(sources, overwrite=overwrite, base=base)

    out_dir.mkdir(parents=True, exist_ok=True)
    entries = []
    for src, subdir, entry in planned:
        if src is not None and not index_only:
            if not src.is_dir():
                raise FileNotFoundError(f"missing object directory '{src}'")
            copy_object_dir(src, out_dir / subdir)
        entries.append(entry)

    if sort_key is not None:
        entries = natsorted(
            entries, key=lambda e: str(e.get(sort_key) or e.get('id') or ''))

    manifest.write_json(manifest.build_index(entries), out_dir / INDEX_NAME)
    return entries


def merge_indexes(args):
    """``main`` handler for the output-directory merge."""
    base = args.update
    out_dir = index_root(base) if base else Path(args.output_file or 'merged')
    sort_key = args.sort_key if args.sort else None
    entries = merge_output_dirs(args.items, out_dir, overwrite=args.overwrite,
                                sort_key=sort_key, base=base,
                                index_only=args.index_only)
    target = out_dir / INDEX_NAME if args.index_only else out_dir
    print(f'{"Updated" if base else "Merged"} {len(args.items)} source(s): '
          f'{len(entries)} object(s) -> \'{target}\'')


def merge_legacy_items(args):
    """``main`` handler for the deprecated items.json merge."""
    # Load everything into one list
    data = []
    for i in args.items:
        with Path(i).open() as in_file:
            new_data = json.load(in_file)
            if isinstance(new_data, list):
                data.extend(new_data)
            else:
                print(f'Warning: \'{i}\' is not a list. Ignoring.')

    num_docs, num_groups = get_num_docs(data)
    print(f'Loaded: {num_groups} group(s), {num_docs} documents(s)')

    # Sort the list
    sort_key = None
    if args.sort:
        sort_key = args.sort_key
        print(f'Sorting by \'{sort_key}\'')
        data = natsorted(data, key=itemgetter(*[sort_key]))

    # Remove duplicates
    if args.merge_duplicates:
        print('Merging duplicates')
        data = merge_duplicates(data, sort_key)

    num_docs, num_groups = get_num_docs(data)
    print(f'Result: {num_groups} group(s), {num_docs} documents(s)')

    # Save the output
    output = args.output_file or 'merged.json'
    print(f'Writing to \'{output}\'')
    with Path(output).open('w', encoding='utf8') as of:
        json.dump(data, of, indent=2)
    print('Done')


def main():
    parser = argparse.ArgumentParser(
        description='Merge preppy output directories (or legacy items.json '
                    'files) into one catalog.')
    parser.add_argument('items', metavar='PATH', type=str, nargs='+',
                        help='Output directories (or their index.json), or '
                             'legacy items.json files')
    parser.add_argument('-o', '--output-file', metavar='PATH', type=str,
                        default=None,
                        help='Output directory for a directory merge (default '
                             '\'merged\'), else the merged items list '
                             '(default \'merged.json\')')
    parser.add_argument('--sort', default=True,
                        action=argparse.BooleanOptionalAction,
                        help='If enabled, sort the merged entries')
    parser.add_argument('--sort-key', default='title', type=str,
                        choices=['title', 'id', 'sort', 'inventory',
                                 'document'],
                        help='Key to use when sorting the merged entries')
    parser.add_argument('--overwrite', default=False, action='store_true',
                        help='Directory merge: let the last source win when '
                             'two sources provide the same object id')
    parser.add_argument('--update', metavar='CATALOG', type=str, default=None,
                        help='Directory merge: merge the sources into an '
                             'existing catalog (a directory or its '
                             'index.json) in place, replacing only their '
                             'objects and leaving the rest untouched')
    parser.add_argument('--index-only', default=False, action='store_true',
                        help='Directory merge: merge the index.json listings '
                             'without copying any assets')
    parser.add_argument('--merge-duplicates', default=True,
                        action=argparse.BooleanOptionalAction,
                        help='items.json merge: merge duplicate entries '
                             '(title and document match)')
    args = parser.parse_args()

    if args.update and args.output_file:
        parser.error('--update rewrites the catalog in place; -o is unused')

    dir_only = (('--update', args.update), ('--index-only', args.index_only))
    dir_flags = [flag for flag, given in dir_only if given]
    index_inputs = [is_index_input(i) for i in args.items]
    if all(index_inputs):
        try:
            merge_indexes(args)
        except (ValueError, OSError) as e:
            parser.error(str(e))
    elif any(index_inputs):
        parser.error('cannot mix output directories and items.json files')
    elif dir_flags:
        parser.error(f'{", ".join(dir_flags)} only applies to an '
                     f'output-directory merge')
    else:
        merge_legacy_items(args)


if __name__ == '__main__':
    main()
