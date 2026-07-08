"""Detection and version checks for the external CLI tools the delivery
pipeline shells out to.

The pipeline does its real work by invoking command-line tools that must be on
``PATH``:

- ``mogrify`` (ImageMagick) — texture normalization.
- ``ktx`` (KTX-Software **>= v5**, ``ktx create``) — KTX2/Basis encoding.
- ``gltfpack`` (meshoptimizer) — OBJ -> decimated, meshopt-compressed geometry.
- ``gltf-transform`` (Node) — embeds the KTX2 into the variant glb.

Node-installed CLIs are invoked as ``<name>.cmd`` on Windows (npm creates a
``.cmd`` shim); this mirrors the historical ``platform.system()`` handling that
``convert.py`` used for ``obj2gltf`` / ``gltf-pipeline``. Native binaries
(``ktx``, ``mogrify``) are resolved by :func:`shutil.which` as-is.

Use :func:`check_all` (or the ``voyager-check-tools`` console script) to report
what is available, and :func:`require` in the leaf modules to fail early with an
actionable message when a needed tool is missing or too old.
"""

import platform
import re
import shutil
import subprocess as sp
from dataclasses import dataclass, field
from typing import Dict, Iterable, Optional, Tuple

_IS_WINDOWS = platform.system() == 'Windows'

# Semantic-version-ish token, optionally prefixed by 'v' (e.g. "v5.0.0", "0.22").
_VERSION_RE = re.compile(r'v?(\d+)\.(\d+)(?:\.(\d+))?')


@dataclass(frozen=True)
class ToolSpec:
    """Static description of an external CLI dependency."""
    name: str
    #: True for npm-installed CLIs, which are invoked as ``<name>.cmd`` on
    #: Windows. Native binaries (resolved by :func:`shutil.which`) stay False.
    node_cli: bool = False
    #: Arguments used to coax the tool into printing its version. gltfpack has no
    #: version flag, so an empty tuple runs it with no args and parses the usage
    #: banner. Nonzero exit is tolerated; only the output is inspected.
    version_args: Tuple[str, ...] = ('--version',)
    #: Minimum acceptable version, inclusive. ``None`` means any version is fine.
    min_version: Optional[Tuple[int, int, int]] = None

    @property
    def executable(self) -> str:
        """Platform-appropriate executable name to hand to subprocess."""
        if self.node_cli and _IS_WINDOWS:
            return f'{self.name}.cmd'
        return self.name


# The tools the new delivery path depends on. ``mogrify`` is included because it
# is still required; ``obj2gltf`` / ``gltf-pipeline`` are intentionally absent
# (legacy path, deprecated).
TOOLS: Dict[str, ToolSpec] = {
    'mogrify': ToolSpec('mogrify', node_cli=False, version_args=('--version',)),
    'ktx': ToolSpec('ktx', node_cli=False, version_args=('--version',),
                    min_version=(5, 0, 0)),
    # gltfpack is distributed on npm (a .cmd shim on Windows) and has no version
    # flag; running it with no args prints a usage banner beginning with the
    # version.
    'gltfpack': ToolSpec('gltfpack', node_cli=True, version_args=()),
    'gltf-transform': ToolSpec('gltf-transform', node_cli=True,
                               version_args=('--version',)),
}


@dataclass
class ToolStatus:
    """Result of probing a single tool."""
    spec: ToolSpec
    found: bool
    path: Optional[str] = None
    version: Optional[Tuple[int, int, int]] = None
    version_str: Optional[str] = None
    #: True/False when a ``min_version`` applies and the version could be read;
    #: None when there is no minimum or the version could not be parsed.
    version_ok: Optional[bool] = None
    messages: list = field(default_factory=list)

    @property
    def name(self) -> str:
        return self.spec.name

    @property
    def ok(self) -> bool:
        """Usable: present and, if a minimum applies, not known to be too old."""
        return self.found and self.version_ok is not False


def _parse_version(text: str) -> Optional[Tuple[int, int, int]]:
    """Extract the first semantic-version-ish token from tool output."""
    m = _VERSION_RE.search(text or '')
    if not m:
        return None
    major, minor, patch = m.group(1), m.group(2), m.group(3)
    return int(major), int(minor), int(patch) if patch is not None else 0


def _fmt_version(v: Optional[Tuple[int, int, int]]) -> str:
    return '.'.join(str(p) for p in v) if v else 'unknown'


def check_tool(spec: ToolSpec) -> ToolStatus:
    """Probe a single tool: resolve it on ``PATH`` and read its version."""
    exe = spec.executable
    path = shutil.which(exe)
    if path is None:
        return ToolStatus(
            spec=spec, found=False,
            messages=[f'{spec.name!r} not found on PATH (looked for {exe!r})'],
        )

    status = ToolStatus(spec=spec, found=True, path=path)

    try:
        proc = sp.run([exe, *spec.version_args], capture_output=True, text=True)
        output = (proc.stdout or '') + (proc.stderr or '')
    except OSError as e:  # pragma: no cover - defensive
        status.messages.append(f'could not run {exe!r}: {e}')
        return status

    version = _parse_version(output)
    if version is None:
        status.messages.append('found, but could not determine version')
    else:
        status.version = version
        status.version_str = _fmt_version(version)

    if spec.min_version is not None:
        if version is None:
            status.messages.append(
                f'requires >= {_fmt_version(spec.min_version)}; version unknown')
        elif version < spec.min_version:
            status.version_ok = False
            status.messages.append(
                f'version {_fmt_version(version)} is older than the required '
                f'{_fmt_version(spec.min_version)}')
        else:
            status.version_ok = True

    return status


def check_all(names: Optional[Iterable[str]] = None) -> Dict[str, ToolStatus]:
    """Probe every registered tool (or the named subset)."""
    if names is None:
        names = TOOLS.keys()
    return {name: check_tool(TOOLS[name]) for name in names}


def require(*names: str) -> None:
    """Raise :class:`RuntimeError` unless every named tool is present and, where
    a minimum applies, new enough. Call this from leaf modules before shelling
    out so failures are actionable rather than a raw ``FileNotFoundError``.
    """
    problems = []
    for name in names:
        spec = TOOLS.get(name)
        if spec is None:  # pragma: no cover - programmer error
            raise KeyError(f'unknown tool {name!r}')
        status = check_tool(spec)
        if not status.ok:
            detail = '; '.join(status.messages) or 'unavailable'
            problems.append(f'  - {name}: {detail}')
    if problems:
        raise RuntimeError(
            'Required external tool(s) unavailable:\n' + '\n'.join(problems)
            + '\nSee the README for installation instructions.')


def format_report(statuses: Dict[str, ToolStatus]) -> str:
    """Human-readable one-line-per-tool summary for the console script."""
    lines = []
    for name, st in statuses.items():
        if not st.found:
            mark, detail = 'MISSING', st.messages[0] if st.messages else ''
        elif st.version_ok is False:
            mark = 'TOO OLD'
            detail = st.messages[-1] if st.messages else ''
        else:
            mark = 'OK'
            detail = f'{_fmt_version(st.version)}  ({st.path})'
        min_note = ''
        if st.spec.min_version is not None:
            min_note = f' [needs >= {_fmt_version(st.spec.min_version)}]'
        lines.append(f'  [{mark:>7}] {name}{min_note}: {detail}')
    return '\n'.join(lines)
