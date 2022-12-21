import argparse
import json
from collections import OrderedDict
from operator import itemgetter
from pathlib import Path

from natsort import natsorted


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


def main():
    parser = argparse.ArgumentParser(description='Merge items.json files.')
    parser.add_argument('items', metavar='FILE', type=str, nargs='+',
                        help='List of items.json files')
    parser.add_argument('-o', '--output-file', metavar='FILE', type=str,
                        default='merged.json',
                        help='Output path for merged items list')
    parser.add_argument('--sort', default=True,
                        action=argparse.BooleanOptionalAction,
                        help='If enabled, sort the merged items file')
    parser.add_argument('--sort-key', default='title', type=str,
                        choices=['title', 'document'],
                        help='Key to use when sorting the merged items file')
    parser.add_argument('--merge-duplicates', default=True,
                        action=argparse.BooleanOptionalAction,
                        help='If enabled, merge duplicate entries '
                             '(title and document match)')
    args = parser.parse_args()

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
    print(f'Writing to \'{args.output_file}\'')
    with Path(args.output_file).open('w', encoding='utf8') as of:
        json.dump(data, of, indent=2)
    print('Done')


if __name__ == '__main__':
    main()
