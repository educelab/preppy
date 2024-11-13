import argparse
from pathlib import Path
import json


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input-files', '-i', nargs='+', metavar='FILE',
                        required=True, help='List of input mesh files')
    parser.add_argument('--output-file', '-o', metavar='FILE',
                        default='preppy.json', help='Output file')
    parser.add_argument('--group', '-g',  action='store_true',
                        help='If provided, files are part of a group')
    args = parser.parse_args()

    # output list
    objects = []
    if args.group:
        group_title = input('Enter the group title: ').strip()
        group = {'title': group_title, 'documents': []}
        objects.append(group)
        active = group['documents']
        print(f'\n{"=" * 5} Group: \'{group_title}\' {"=" * 5}\n')
    else:
        active = objects


    # get input for each file
    for input_file in args.input_files:
        msg = f'- File: \'{input_file}\''
        print(msg)

        # get the main display title
        title = input('Enter the full title: ').strip()
        # get the navigation bar title
        nav_title = input('Enter the navigation bar title: ').strip()
        # get the file stem
        stem = input(f'Enter the file stem '
                     f'(default: \'{Path(input_file).stem}\'): ').strip()
        if len(stem) == 0:
            stem = Path(input_file).stem
        # report the results
        print(f'\n'
              f'  Title: {title}\n'
              f'  Navigation title: {nav_title}\n'
              f'  File stem: {stem}')
        data = {
            'obj': input_file,
            'title': title,
            'navTitle': nav_title,
            'stem': stem,
        }
        # save to the metadata
        active.append(data)
        print()

    # write out the json
    with Path(args.output_file).open('w') as of:
        json.dump(objects, of, indent=2)

if __name__ == '__main__':
    main()