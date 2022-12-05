import argparse
import json
from collections import OrderedDict
from operator import itemgetter
from pathlib import Path

from natsort import natsorted

from preppy import voyager


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
    print(f'Loaded {len(data)} items')

    # Sort the list
    if args.sort:
        print(f'Sorting by \'{args.sort_key}\'')
        data = natsorted(data, key=itemgetter(*[args.sort_key]))

    # Remove duplicates
    if args.merge_duplicates:
        print('Merging duplicates')
        len_orig = len(data)
        data = OrderedDict(
            (frozenset(item.items()), item) for item in data).values()
        print(f'Merged {len_orig - len(data)} duplicates')

    # Save the output
    print(f'Writing to \'{args.output_file}\'')
    voyager.write_items_file(output_path=args.output_file, data=data)
    print('Done')


if __name__ == '__main__':
    main()
