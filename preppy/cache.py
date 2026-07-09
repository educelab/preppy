"""Content-hash cache-busting for delivered assets.

The hash is computed over the **inputs + config** (source OBJ + texture bytes,
pipeline parameters, and tool versions) — **never the output glb**, because
basis (ETC1S/UASTC) encoding is multithreaded and non-deterministic, so hashing
the output would churn every URL on a no-op rebuild (ADR-0002).

- :func:`content_hash` — the 8-hex fingerprint.
- :func:`hashed_name` — ``<prefix>_<suffix>.<hash>.glb``.
- :func:`prune` — remove hashed asset files no longer referenced by a manifest.
"""

import hashlib
import json
import re
from pathlib import Path
from typing import Iterable, List, Mapping, Optional, Set, Union

PathLike = Union[str, Path]

DEFAULT_HASH_LENGTH = 8
_CHUNK = 1 << 20  # 1 MiB — OBJs and textures are large.

#: Matches a hashed asset name: ``...<name>.<8 hex>.<ext>``.
_HASHED_RE = re.compile(r'\.[0-9a-f]{%d}\.[^.]+$' % DEFAULT_HASH_LENGTH)


def content_hash(inputs: Iterable[PathLike],
                 config: Optional[Mapping] = None,
                 tool_versions: Optional[Mapping[str, str]] = None,
                 length: int = DEFAULT_HASH_LENGTH) -> str:
    """Return a short hex fingerprint of the given input files + config.

    ``inputs`` are hashed by content (sorted by name so caller order does not
    matter); ``config`` and ``tool_versions`` are folded in as canonical JSON.
    """
    h = hashlib.sha256()

    for src in sorted((Path(p) for p in inputs), key=lambda p: p.name):
        # Domain-separate each file and bind its name so a rename busts the hash.
        h.update(b'\x00file\x00')
        h.update(src.name.encode('utf-8'))
        h.update(b'\x00')
        with src.open('rb') as f:
            for chunk in iter(lambda: f.read(_CHUNK), b''):
                h.update(chunk)

    h.update(b'\x00config\x00')
    h.update(json.dumps(config or {}, sort_keys=True,
                        separators=(',', ':'), default=str).encode('utf-8'))
    h.update(b'\x00tools\x00')
    h.update(json.dumps(tool_versions or {}, sort_keys=True,
                        separators=(',', ':')).encode('utf-8'))

    return h.hexdigest()[:length]


def hashed_name(prefix: str, suffix: str, digest: Optional[str] = None,
                ext: str = 'glb') -> str:
    """Build an asset filename.

    With ``digest``: ``<prefix>_<suffix>.<digest>.<ext>`` (cache-busting, served
    ``immutable``). Without: the stable ``<prefix>_<suffix>.<ext>``.
    """
    stem = f'{prefix}_{suffix}'
    return f'{stem}.{digest}.{ext}' if digest else f'{stem}.{ext}'


def is_hashed_asset(name: str) -> bool:
    """True if ``name`` looks like a content-hashed asset file."""
    return bool(_HASHED_RE.search(name))


def prune(directory: PathLike, keep: Iterable[str], *,
          dry_run: bool = False) -> List[Path]:
    """Delete hashed asset files in ``directory`` not named in ``keep``.

    Only files matching the hashed pattern are considered, so stable-named
    manifests/thumbnails are never removed. ``keep`` is the set of basenames
    still referenced by a current manifest. Returns the removed (or, with
    ``dry_run``, the would-be-removed) paths.
    """
    keep_set: Set[str] = set(keep)
    removed: List[Path] = []
    directory = Path(directory)
    if not directory.is_dir():
        return removed
    for p in sorted(directory.iterdir()):
        if p.is_file() and is_hashed_asset(p.name) and p.name not in keep_set:
            removed.append(p)
            if not dry_run:
                p.unlink()
    return removed
