"""Unit tests for the pure logic in ``preppy.tools`` — version parsing,
comparison, executable-name resolution, and report formatting. These are the
easy-to-get-wrong bits; the actual subprocess probing is covered by the
``voyager-check-tools`` console script against a real install.
"""

import preppy.tools as tools
from preppy.tools import ToolSpec, ToolStatus


def test_parse_version_variants():
    assert tools._parse_version('ktx version: v5.0.0') == (5, 0, 0)
    assert tools._parse_version('gltfpack 0.22') == (0, 22, 0)
    assert tools._parse_version('4.3.2~28') == (4, 3, 2)
    assert tools._parse_version('v1.2.3-alpha') == (1, 2, 3)
    assert tools._parse_version('no version here') is None
    assert tools._parse_version('') is None


def test_version_tuples_compare_numerically():
    # A naive string compare would rank '5' below '10'; tuple compare must not.
    assert (5, 0, 0) < (10, 0, 0)
    assert (4, 9, 9) < (5, 0, 0)


def test_executable_name_node_cli_windows(monkeypatch):
    monkeypatch.setattr(tools, '_IS_WINDOWS', True)
    assert ToolSpec('gltf-transform', node_cli=True).executable == \
        'gltf-transform.cmd'
    # Native binaries are never suffixed, even on Windows.
    assert ToolSpec('ktx', node_cli=False).executable == 'ktx'


def test_executable_name_posix(monkeypatch):
    monkeypatch.setattr(tools, '_IS_WINDOWS', False)
    assert ToolSpec('gltf-transform', node_cli=True).executable == \
        'gltf-transform'
    assert ToolSpec('ktx', node_cli=False).executable == 'ktx'


def test_registry_has_new_toolchain_and_not_legacy():
    assert set(tools.TOOLS) == {'mogrify', 'ktx', 'gltfpack', 'gltf-transform'}
    assert 'obj2gltf' not in tools.TOOLS
    assert 'gltf-pipeline' not in tools.TOOLS
    assert tools.TOOLS['ktx'].min_version == (5, 0, 0)


def test_status_ok_semantics():
    spec = tools.TOOLS['ktx']
    assert not ToolStatus(spec=spec, found=False).ok
    # Present, version too old.
    assert not ToolStatus(spec=spec, found=True, version_ok=False).ok
    # Present, meets minimum.
    assert ToolStatus(spec=spec, found=True, version_ok=True).ok
    # Present, no minimum applies (version_ok stays None).
    assert ToolStatus(spec=tools.TOOLS['gltfpack'], found=True).ok


def test_check_tool_reports_missing(monkeypatch):
    monkeypatch.setattr(tools.shutil, 'which', lambda _: None)
    st = tools.check_tool(tools.TOOLS['ktx'])
    assert not st.found and not st.ok
    assert 'not found' in st.messages[0]


def test_check_tool_flags_old_ktx(monkeypatch):
    monkeypatch.setattr(tools.shutil, 'which', lambda _: '/usr/bin/ktx')

    class _Proc:
        stdout = 'ktx version: v4.3.2'
        stderr = ''

    monkeypatch.setattr(tools.sp, 'run', lambda *a, **k: _Proc())
    st = tools.check_tool(tools.TOOLS['ktx'])
    assert st.found and st.version == (4, 3, 2)
    assert st.version_ok is False and not st.ok


def test_require_raises_with_all_problems(monkeypatch):
    monkeypatch.setattr(tools.shutil, 'which', lambda _: None)
    try:
        tools.require('ktx', 'gltfpack')
    except RuntimeError as e:
        assert 'ktx' in str(e) and 'gltfpack' in str(e)
    else:  # pragma: no cover
        raise AssertionError('require() should have raised')
