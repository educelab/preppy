import argparse
import sys

from preppy import tools

#: Optional pseudo-target: the model-preview render toolchain (the `preview`
#: extra + a working offscreen GL backend). Not a CLI tool in ``tools.TOOLS`` and,
#: because the pipeline falls back to a texture crop, its status is informational
#: and never affects the exit code.
_PREVIEW = 'preview'


def main():
    parser = argparse.ArgumentParser(
        description='Check that the external CLI tools the delivery pipeline '
                    'needs are installed and new enough.')
    parser.add_argument('names', nargs='*', metavar='TOOL',
                        help='Only check these targets (default: all). '
                             f'Choices: {", ".join(tools.TOOLS)}, {_PREVIEW}')
    args = parser.parse_args()

    # 'preview' is an optional extra, not a PATH tool; peel it off before the
    # tool-name validation and remember whether it was asked for.
    selected = args.names
    check_preview = (not selected) or (_PREVIEW in selected)
    tool_names = [n for n in selected if n != _PREVIEW]
    if selected:
        unknown = [n for n in tool_names if n not in tools.TOOLS]
        if unknown:
            parser.error(f'unknown target(s): {", ".join(unknown)}')

    # No explicit names -> check everything. Explicit names (after peeling off
    # 'preview') -> just those; an empty list means only 'preview' was asked for.
    names = None if not selected else tool_names

    statuses = tools.check_all(names) if names or not selected else {}
    print('External tool check:')
    if statuses:
        print(tools.format_report(statuses))

    # The KTX2 embed step also needs the bundled Node helper's npm deps.
    deps_ok = True
    if not selected or 'node' in tool_names:
        from preppy import assemble
        deps_ok = assemble.node_deps_installed()
        mark = 'OK' if deps_ok else 'MISSING'
        detail = (str(assemble.NODE_DIR) if deps_ok
                  else f'run: npm install --prefix {assemble.NODE_DIR}')
        print(f'  [{mark:>7}] embed helper deps: {detail}')

    # Optional model-preview render toolchain. Informational only: 'SKIP' (not a
    # failure) when unavailable, since the thumbnail falls back to a texture crop.
    if check_preview:
        from preppy import preview
        ok, detail = preview.probe()
        mark = 'OK' if ok else 'SKIP'
        print(f'  [{mark:>7}] model preview (optional): {detail}')

    all_ok = deps_ok and all(st.ok for st in statuses.values())
    if not all_ok:
        sys.stdout.flush()
        print('\nSome tools are missing or too old. See the README for install '
              'instructions.', file=sys.stderr)
    return 0 if all_ok else 1


if __name__ == '__main__':
    sys.exit(main())
