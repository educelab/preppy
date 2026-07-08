"""Geometry leaf module: OBJ -> decimated, meshopt-compressed geometry glb via
gltfpack, plus optional Hausdorff validation of the decimation.

- :func:`obj_to_geometry_glb` — runs ``gltfpack`` with error-bounded
  simplification (``-si``) and meshopt compression (``-cc``). Textures are left
  referenced so gltfpack keeps UVs "used" (Phase 0 rule — dropping them corrupts
  the atlas). **Normals are not baked**; the viewer computes them.
- :func:`validate` — samples the Hausdorff distance between the original and the
  decimated mesh with pymeshlab and checks it against a deviation budget.

pymeshlab's glTF reader **segfaults** on an ``EXT_meshopt_compression`` glb, so
:func:`validate` refuses one (raising a clear error) and expects a plain,
pymeshlab-readable mesh — build one with ``obj_to_geometry_glb(..., meshopt=False,
quantize=False)`` or export to OBJ/PLY.
"""

import json
import struct
import subprocess as sp
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Union

from preppy import tools

PathLike = Union[str, Path]

#: Default error-bounded simplification target (gltfpack ``-si``), from the spike.
DEFAULT_TARGET_ERROR = 0.2


def obj_to_geometry_glb_cmd(obj: Path, out: Path,
                            target_error: float = DEFAULT_TARGET_ERROR,
                            meshopt: bool = True, quantize: bool = True,
                            extra: Optional[List[str]] = None) -> List[str]:
    """Build the ``gltfpack`` argv for OBJ -> geometry glb.

    - ``-si <target_error>`` — error-bounded simplification.
    - ``-cc`` — meshopt compression (delivery build). Disable (``meshopt=False``)
      to get a mesh that pymeshlab can read for :func:`validate`.
    - ``-noq`` — disable vertex quantization when ``quantize`` is False (also
      needed for a pymeshlab-readable validation mesh).

    Normals are never generated here; the viewer computes them.
    """
    cmd: List[str] = [tools.TOOLS['gltfpack'].executable,
                      '-i', str(obj), '-o', str(out),
                      '-si', str(target_error)]
    if meshopt:
        cmd.append('-cc')
    if not quantize:
        cmd.append('-noq')
    if extra:
        cmd.extend(extra)
    return cmd


def obj_to_geometry_glb(obj: PathLike, out: PathLike, *,
                        target_error: float = DEFAULT_TARGET_ERROR,
                        meshopt: bool = True, quantize: bool = True,
                        extra: Optional[List[str]] = None) -> Path:
    """Run gltfpack to produce the decimated geometry glb; return its path."""
    tools.require('gltfpack')
    obj, out = Path(obj), Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    cmd = obj_to_geometry_glb_cmd(obj, out, target_error=target_error,
                                  meshopt=meshopt, quantize=quantize, extra=extra)
    sp.run(cmd, check=True)
    return out


def _glb_json(path: Path) -> Optional[dict]:
    """Return the JSON chunk of a binary glb, or None if not a glb/parse fails."""
    try:
        with path.open('rb') as f:
            header = f.read(12)
            if len(header) < 12 or header[:4] != b'glTF':
                return None
            chunk_len = struct.unpack('<I', f.read(4))[0]
            chunk_type = f.read(4)
            if chunk_type != b'JSON':
                return None
            return json.loads(f.read(chunk_len))
    except (OSError, ValueError, struct.error):
        return None


def is_meshopt_glb(path: PathLike) -> bool:
    """True if ``path`` is a glb declaring EXT_meshopt_compression."""
    doc = _glb_json(Path(path))
    if not doc:
        return False
    used = doc.get('extensionsUsed', []) or []
    return 'EXT_meshopt_compression' in used


@dataclass
class HausdorffResult:
    """Outcome of a Hausdorff comparison, in mesh units."""
    max_distance: float
    mean: float
    rms: float
    bbox_diagonal: Optional[float] = None
    budget: Optional[float] = None

    @property
    def within_budget(self) -> Optional[bool]:
        if self.budget is None:
            return None
        return self.max_distance <= self.budget

    @property
    def max_fraction_of_diagonal(self) -> Optional[float]:
        if not self.bbox_diagonal:
            return None
        return self.max_distance / self.bbox_diagonal


def validate(original: PathLike, decimated: PathLike, *,
             budget: Optional[float] = None, samplenum: int = 100000,
             symmetric: bool = True) -> HausdorffResult:
    """Hausdorff-check the ``decimated`` mesh against the ``original``.

    Both must be pymeshlab-readable (OBJ/PLY/STL or a **plain** glb — not a
    meshopt-compressed one, which crashes pymeshlab). Returns a
    :class:`HausdorffResult`; when ``budget`` is given, ``within_budget`` reports
    whether the max deviation stays under it.

    Requires the optional ``pymeshlab`` dependency (``pip install .[validate]``).
    """
    original, decimated = Path(original), Path(decimated)
    for p in (original, decimated):
        if is_meshopt_glb(p):
            raise ValueError(
                f'{p} is a meshopt-compressed glb; pymeshlab cannot read it '
                f'(it segfaults). Pass a plain mesh — e.g. build one with '
                f'obj_to_geometry_glb(..., meshopt=False, quantize=False).')

    try:
        import pymeshlab as ml
    except ImportError as e:  # pragma: no cover - optional dependency
        raise RuntimeError(
            'pymeshlab is required for geometry validation; install it with '
            "`pip install '.[validate]'`.") from e

    ms = ml.MeshSet()
    ms.load_new_mesh(str(original))   # mesh 0
    ms.load_new_mesh(str(decimated))  # mesh 1

    def _measure(sampled: int, target: int) -> dict:
        return ms.get_hausdorff_distance(
            sampledmesh=sampled, targetmesh=target,
            samplevert=True, samplenum=samplenum)

    res = _measure(1, 0)
    max_d, mean_d, rms_d = res['max'], res['mean'], res['RMS']
    if symmetric:
        rev = _measure(0, 1)
        if rev['max'] > max_d:
            max_d = rev['max']
        mean_d = max(mean_d, rev['mean'])
        rms_d = max(rms_d, rev['RMS'])

    return HausdorffResult(
        max_distance=max_d, mean=mean_d, rms=rms_d,
        bbox_diagonal=res.get('diag_mesh_0'), budget=budget)
