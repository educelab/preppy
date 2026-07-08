import argparse
import sys

from preppy import tools


def main():
    parser = argparse.ArgumentParser(
        description='Check that the external CLI tools the delivery pipeline '
                    'needs are installed and new enough.')
    parser.add_argument('names', nargs='*', metavar='TOOL',
                        help='Only check these tools (default: all). '
                             f'Choices: {", ".join(tools.TOOLS)}')
    args = parser.parse_args()

    names = args.names or None
    if names:
        unknown = [n for n in names if n not in tools.TOOLS]
        if unknown:
            parser.error(f'unknown tool(s): {", ".join(unknown)}')

    statuses = tools.check_all(names)
    print('External tool check:')
    print(tools.format_report(statuses))

    # The KTX2 embed step also needs the bundled Node helper's npm deps.
    deps_ok = True
    if not names or 'node' in names:
        from preppy import assemble
        deps_ok = assemble.node_deps_installed()
        mark = 'OK' if deps_ok else 'MISSING'
        detail = (str(assemble.NODE_DIR) if deps_ok
                  else f'run: npm install --prefix {assemble.NODE_DIR}')
        print(f'  [{mark:>7}] embed helper deps: {detail}')

    all_ok = deps_ok and all(st.ok for st in statuses.values())
    if not all_ok:
        sys.stdout.flush()
        print('\nSome tools are missing or too old. See the README for install '
              'instructions.', file=sys.stderr)
    return 0 if all_ok else 1


if __name__ == '__main__':
    sys.exit(main())
