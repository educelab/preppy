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
from typing import Dict, Iterable, List, Mapping, Optional, Set, Tuple, Union

PathLike = Union[str, Path]

DEFAULT_HASH_LENGTH = 8
_CHUNK = 1 << 20  # 1 MiB — OBJs and textures are large.

#: Matches a hashed asset name: ``...<name>.<8 hex>.<ext>``.
_HASHED_RE = re.compile(r'\.[0-9a-f]{%d}\.[^.]+$' % DEFAULT_HASH_LENGTH)

#: Splits a hashed asset name into its (stem, ext), dropping the hash — so
#: ``MVS_rgb.a1b2c3d4.glb`` groups with ``MVS_rgb.<other>.glb`` but not with
#: ``MVS_ir.*`` — for per-variant keep-last-N retention.
_HASHED_STEM_RE = re.compile(r'^(.*)\.[0-9a-f]{%d}\.([^.]+)$' % DEFAULT_HASH_LENGTH)


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
          keep_last: int = 0, dry_run: bool = False) -> List[Path]:
    """Delete hashed asset files in ``directory`` not named in ``keep``.

    Only files matching the hashed pattern are considered, so stable-named
    manifests/thumbnails are never removed. ``keep`` is the set of basenames
    still referenced by a current manifest. Returns the removed (or, with
    ``dry_run``, the would-be-removed) paths, sorted by name.

    ``keep_last`` (default 0) is a **retention window**: with ``keep_last=N``,
    the newest ``N`` *unreferenced* generations of **each variant** (grouped by
    ``<prefix>_<suffix>.<ext>``, ordered by mtime) are also retained, so a
    manifest served to an in-flight client during a rollover still resolves its
    hashed URIs. ``keep_last=0`` drops every unreferenced hashed file (the
    historic behavior). *Caveat:* ordering is by mtime, which a copy/restore that
    doesn't preserve timestamps can scramble.
    """
    keep_set: Set[str] = set(keep)
    removed: List[Path] = []
    directory = Path(directory)
    if not directory.is_dir():
        return removed

    candidates = [p for p in directory.iterdir()
                  if p.is_file() and is_hashed_asset(p.name)
                  and p.name not in keep_set]

    if keep_last > 0:
        by_stem: Dict[Tuple[str, str], List[Path]] = {}
        for p in candidates:
            m = _HASHED_STEM_RE.match(p.name)
            key = (m.group(1), m.group(2)) if m else (p.name, '')
            by_stem.setdefault(key, []).append(p)
        candidates = []
        for group in by_stem.values():
            group.sort(key=lambda p: p.stat().st_mtime, reverse=True)
            candidates.extend(group[keep_last:])  # keep the newest N per variant

    for p in sorted(candidates):
        removed.append(p)
        if not dry_run:
            p.unlink()
    return removed
