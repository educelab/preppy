"""Geometry leaf module: OBJ -> decimated, meshopt-compressed geometry glb via
gltfpack, plus optional Hausdorff validation of the decimation.

- :func:`obj_to_geometry_glb` — runs ``gltfpack`` with error-bounded
  simplification (``-si``) and meshopt compression (``-cc``). Textures are left
  referenced so gltfpack keeps UVs "used" (Phase 0 rule — dropping them corrupts
  the atlas). With ``smooth_normals`` (the delivery default) it first bakes
  per-vertex smooth normals into a temp OBJ via :func:`bake_normals` and packs
  *that*, so the delivered glb carries a NORMAL attribute.
- :func:`bake_normals` — the smooth-normal pre-pass (Phase 7). Computes
  area-weighted vertex normals from the **un-quantized** source OBJ and writes a
  normal-bearing copy; gltfpack then octahedral-quantizes them (``-vn 8``).
  Computing normals *before* gltfpack quantizes positions
  (``KHR_mesh_quantization``) avoids the high-frequency shading jitter that
  ``computeVertexNormals`` on the quantized grid produced in the viewer.
- :func:`validate` — samples the Hausdorff distance between the original and the
  decimated mesh with pymeshlab and checks it against a deviation budget.

pymeshlab's glTF reader **segfaults** on an ``EXT_meshopt_compression`` glb, so
:func:`validate` refuses one (raising a clear error) and expects a plain,
pymeshlab-readable mesh — build one with ``obj_to_geometry_glb(..., meshopt=False,
quantize=False)`` or export to OBJ/PLY. That reader also aborts on any embedded
image it can't decode, so run a plain glb through :func:`strip_textures` first
(validation is geometry-only).
"""

import json
import shutil
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Union

from preppy import tools

PathLike = Union[str, Path]

#: Default error-bounded simplification target (gltfpack ``-si``), from the spike.
DEFAULT_TARGET_ERROR = 0.2


def obj_to_geometry_glb_cmd(obj: Path, out: Path,
                            target_error: Optional[float] = DEFAULT_TARGET_ERROR,
                            meshopt: bool = True, quantize: bool = True,
                            extra: Optional[List[str]] = None) -> List[str]:
    """Build the ``gltfpack`` argv for OBJ -> geometry glb.

    - ``-si <target_error>`` — error-bounded simplification. ``target_error=None``
      omits ``-si`` entirely (``--no-decimate``: meshopt-compress without
      simplifying).
    - ``-cc`` — meshopt compression (delivery build). Disable (``meshopt=False``)
      to get a mesh that pymeshlab can read for :func:`validate`.
    - ``-noq`` — disable vertex quantization when ``quantize`` is False (also
      needed for a pymeshlab-readable validation mesh).

    This builder does not touch normals: with ``smooth_normals`` the caller
    :func:`obj_to_geometry_glb` feeds gltfpack an already normal-bearing OBJ
    (see :func:`bake_normals`), which gltfpack octahedral-quantizes by default.
    """
    cmd: List[str] = [tools.TOOLS['gltfpack'].executable,
                      '-i', str(obj), '-o', str(out)]
    if target_error is not None:
        cmd += ['-si', str(target_error)]
    if meshopt:
        cmd.append('-cc')
    if not quantize:
        cmd.append('-noq')
    if extra:
        cmd.extend(extra)
    return cmd


def obj_to_geometry_glb(obj: PathLike, out: PathLike, *,
                        target_error: Optional[float] = DEFAULT_TARGET_ERROR,
                        meshopt: bool = True, quantize: bool = True,
                        smooth_normals: bool = False,
                        force_smooth_normals: bool = False,
                        extra: Optional[List[str]] = None) -> Path:
    """Run gltfpack to produce the decimated geometry glb; return its path.

    Normals policy (``smooth_normals``, the delivery default):

    - The delivered glb must carry good per-vertex normals. If the **source OBJ
      already ships** them (``vn`` lines — common in photogrammetry/MVS
      exporters, which compute them on the pristine full-res mesh) they are
      passed straight through to gltfpack: they are computed on better geometry
      than we can reconstruct downstream and may encode intentional creases.
    - If the source has **no** normals, we bake area-weighted smooth normals from
      the un-quantized source positions via :func:`bake_normals` first, so the
      viewer never has to compute them off gltfpack's quantized position grid
      (which facets/jitters — Phase 7).
    - ``force_smooth_normals`` overrides the pass-through and rebakes even when
      the source ships normals (escape hatch for a source with bad/faceted
      normals). ``smooth_normals=False`` skips both — the viewer computes.

    Leave ``smooth_normals`` off for the plain validation re-pack — Hausdorff is
    geometry-only and baking would just cost time.
    """
    tools.require('gltfpack')
    obj, out = Path(obj), Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    src = obj
    if smooth_normals and (force_smooth_normals or not _obj_has_normals(obj)):
        src = bake_normals(obj, out.with_name(out.stem + '.normals.obj'))
    cmd = obj_to_geometry_glb_cmd(src, out, target_error=target_error,
                                  meshopt=meshopt, quantize=quantize, extra=extra)
    tools.run(cmd)
    return out


def _is_vn_line(line: str) -> bool:
    """True if ``line`` is a vertex-normal (``vn``) declaration.

    Keys on the first whitespace-delimited token, so it tolerates *any* separator
    after the keyword — a tab or multiple spaces, not just the single space a
    naive ``startswith('vn ')`` assumes (the Wavefront grammar allows either).
    """
    return line.split(maxsplit=1)[:1] == ['vn']


def _obj_has_normals(obj: PathLike) -> bool:
    """Whether the OBJ declares any vertex normals (``vn`` lines)."""
    with Path(obj).open() as f:
        return any(_is_vn_line(line) for line in f)


def bake_normals(obj_in: PathLike, obj_out: PathLike) -> Path:
    """Write a copy of ``obj_in`` with per-vertex smooth normals, return its path.

    Computes area-weighted vertex normals from the source positions (before any
    gltfpack quantization) and emits a ``vn`` block plus face refs that point
    each corner's normal at its own vertex (``v/vt`` → ``v/vt/v``, bare ``v`` →
    ``v//v``). Everything else — ``usemtl`` bindings, ``v``/``vt`` data, face
    topology — is copied through untouched so gltfpack still resolves the same
    materials and keeps the UVs "used".

    Each referenced ``.mtl`` is **copied next to the output OBJ** and ``mtllib``
    is rewritten to its bare basename. gltfpack cannot load an *absolute*
    ``mtllib`` path — it reports "materials could not be loaded" and then prunes
    the now-unused UVs — so the material must sit beside the OBJ under a relative
    name. The material's ``map_Kd`` image need not resolve: gltfpack keeps the
    material (and the UVs) even when it can't decode the texture, exactly as it
    does for the undecodable source TIFFs. Polygons are fan-triangulated for the
    area weighting only; the written faces keep their original arity (gltfpack
    triangulates).

    Any ``vn`` block already present in the source is **dropped** and every face
    normal ref is rewritten to the corner's own (freshly baked) vertex normal, so
    the result is idempotent regardless of what the source shipped. The caller
    (:func:`obj_to_geometry_glb`) decides *whether* to rebake; this always does.
    """
    import numpy as np

    obj_in, obj_out = Path(obj_in), Path(obj_out)
    src_dir = obj_in.parent
    lines = obj_in.read_text().splitlines()

    positions: List[tuple] = []
    tri: List[tuple] = []  # 0-based vertex-index triples, for normal accumulation
    for line in lines:
        if line.startswith('v '):
            p = line.split()
            positions.append((float(p[1]), float(p[2]), float(p[3])))
        elif line.startswith('f '):
            n = len(positions)  # vertices seen so far (to resolve relative refs)
            corners = [_vidx(t.split('/', 1)[0], n) for t in line.split()[1:]]
            for i in range(1, len(corners) - 1):  # fan-triangulate
                tri.append((corners[0], corners[i], corners[i + 1]))

    pos = np.asarray(positions, dtype=np.float64)
    faces = np.asarray(tri, dtype=np.int64)
    # Un-normalized cross product == 2*area*unit_normal, so summing it per vertex
    # is area-weighted by construction.
    fn = np.cross(pos[faces[:, 1]] - pos[faces[:, 0]],
                  pos[faces[:, 2]] - pos[faces[:, 0]])
    vn = np.zeros_like(pos)
    for k in range(3):
        np.add.at(vn, faces[:, k], fn)
    lens = np.linalg.norm(vn, axis=1, keepdims=True)
    lens[lens == 0] = 1.0  # isolated/degenerate vertices -> leave a zero normal
    vn /= lens

    with obj_out.open('w') as out:
        wrote_normals = False
        nverts = 0
        for line in lines:
            if line.startswith('v '):
                nverts += 1
                out.write(line + '\n')
            elif _is_vn_line(line):
                continue  # drop source normals; the baked block replaces them
            elif line.startswith('f '):
                if not wrote_normals:  # emit the baked vn block just before first use
                    for x, y, z in vn:
                        out.write(f'vn {x:.6f} {y:.6f} {z:.6f}\n')
                    wrote_normals = True
                out.write(_face_with_normals(line, nverts))
            elif line.startswith('mtllib '):
                libs = line.split()[1:]
                for lib in libs:  # copy each .mtl next to the baked OBJ
                    src_mtl = (src_dir / lib)
                    if src_mtl.is_file():
                        shutil.copy(src_mtl, obj_out.parent / Path(lib).name)
                out.write('mtllib ' + ' '.join(
                    Path(lib).name for lib in libs) + '\n')
            else:
                out.write(line + '\n')
    return obj_out


def _vidx(tok: str, nverts: int) -> int:
    """Resolve an OBJ vertex reference token to a 0-based index.

    Positive tokens are 1-based absolute; **negative** tokens are relative to the
    vertices declared so far (``-1`` == the most recently declared), per the
    Wavefront spec. ``nverts`` is that running count. Naive ``int(tok) - 1`` wraps
    silently under numpy fancy-indexing for negatives — this doesn't.
    """
    i = int(tok)
    return nverts + i if i < 0 else i - 1


def _face_with_normals(line: str, nverts: int) -> str:
    """Rewrite an OBJ ``f`` line so each corner references its own vertex normal.

    The baked ``vn`` block has one entry per vertex (1:1 with ``v``) and is
    emitted in full before any face, so each corner's normal index is its
    **absolute** 1-based vertex index (via :func:`_vidx`, so relative/negative
    refs point at the right baked normal). Positions/UVs are copied verbatim
    (still valid at their original positions); only the normal field is
    (re)written, dropping any source normal index. ``v/vt`` → ``v/vt/N``, bare
    ``v`` → ``v//N``.
    """
    out = ['f']
    for ref in line.split()[1:]:
        fields = ref.split('/')
        v = fields[0]
        n_abs = _vidx(v, nverts) + 1  # absolute 1-based index into the baked block
        if len(fields) >= 2 and fields[1]:
            out.append(f'{v}/{fields[1]}/{n_abs}')
        else:
            out.append(f'{v}//{n_abs}')
    return ' '.join(out) + '\n'


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


#: glTF extensions that only make sense alongside textures/materials; dropped
#: with them so a stripped glb doesn't declare an extension it no longer uses.
_TEXTURE_EXTENSIONS = frozenset({
    'KHR_texture_basisu', 'KHR_texture_transform', 'KHR_materials_unlit'})


def _read_glb_chunks(data: bytes):
    """Parse a binary glb into an ordered list of ``(chunk_type, payload)``."""
    if len(data) < 12 or data[:4] != b'glTF':
        raise ValueError('not a binary glb')
    total = struct.unpack('<I', data[8:12])[0]
    chunks = []
    off = 12
    while off + 8 <= total:
        clen = struct.unpack('<I', data[off:off + 4])[0]
        ctype = data[off + 4:off + 8]
        payload = data[off + 8:off + 8 + clen]
        chunks.append((ctype, payload))
        off += 8 + clen
    return chunks


def _write_glb_chunks(path: Path, chunks) -> None:
    """Write ``(chunk_type, payload)`` chunks back out as a binary glb.

    JSON chunks are padded with spaces and BIN chunks with zero bytes to the
    4-byte alignment the glTF spec requires.
    """
    body = bytearray()
    for ctype, payload in chunks:
        pad = (-len(payload)) % 4
        payload = payload + (b' ' if ctype == b'JSON' else b'\x00') * pad
        body += struct.pack('<I', len(payload)) + ctype + payload
    header = b'glTF' + struct.pack('<II', 2, 12 + len(body))
    path.write_bytes(header + bytes(body))


def strip_textures(path: PathLike) -> Path:
    """Rewrite a **plain** glb in place, dropping every image/texture/material.

    :func:`validate` only measures geometry, but gltfpack embeds each material's
    ``map_Kd`` image into the glb — and pymeshlab's glTF reader (STB) aborts on
    any image it can't decode (e.g. a placeholder image an untextured material
    leaves behind: ``image[0] name = ""``). Removing the images, textures,
    samplers, materials, and primitive material bindings leaves a
    geometry-only mesh pymeshlab loads cleanly. The BIN chunk is left untouched
    (now-unreferenced image bytes are harmless).
    """
    path = Path(path)
    chunks = _read_glb_chunks(path.read_bytes())
    for i, (ctype, payload) in enumerate(chunks):
        if ctype != b'JSON':
            continue
        doc = json.loads(payload)
        for key in ('images', 'textures', 'samplers', 'materials'):
            doc.pop(key, None)
        for mesh in doc.get('meshes', []):
            for prim in mesh.get('primitives', []):
                prim.pop('material', None)
        for key in ('extensionsUsed', 'extensionsRequired'):
            if key in doc:
                kept = [e for e in doc[key] if e not in _TEXTURE_EXTENSIONS]
                if kept:
                    doc[key] = kept
                else:
                    doc.pop(key)
        chunks[i] = (ctype, json.dumps(doc, separators=(',', ':')).encode())
        break
    _write_glb_chunks(path, chunks)
    return path


@dataclass
class HausdorffResult:
    """Outcome of a Hausdorff comparison, in mesh units."""
    max_distance: float
    mean: float
    rms: float
    bbox_diagonal: Optional[float] = None
    budget: Optional[float] = None
    budget_frac: Optional[float] = None

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

    @property
    def within_frac_budget(self) -> Optional[bool]:
        """Whether the deviation stays under ``budget_frac`` (a fraction of the
        bbox diagonal). ``None`` when no fractional budget is set or the diagonal
        is unknown."""
        if self.budget_frac is None:
            return None
        frac = self.max_fraction_of_diagonal
        if frac is None:
            return None
        return frac <= self.budget_frac

    @property
    def over_budget(self) -> bool:
        """True when either budget (absolute or fractional) is set and exceeded.
        False when no budget is set (report-only)."""
        return self.within_budget is False or self.within_frac_budget is False


def validate(original: PathLike, decimated: PathLike, *,
             budget: Optional[float] = None, budget_frac: Optional[float] = None,
             samplenum: int = 100000,
             symmetric: bool = True) -> HausdorffResult:
    """Hausdorff-check the ``decimated`` mesh against the ``original``.

    Both must be pymeshlab-readable (OBJ/PLY/STL or a **plain** glb — not a
    meshopt-compressed one, which crashes pymeshlab). Returns a
    :class:`HausdorffResult`; when ``budget`` (absolute mesh units) or
    ``budget_frac`` (a fraction of the bbox diagonal, scale-independent) is
    given, ``within_budget`` / ``within_frac_budget`` report whether the max
    deviation stays under each, and ``over_budget`` is True if either is
    exceeded.

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
        bbox_diagonal=res.get('diag_mesh_0'), budget=budget,
        budget_frac=budget_frac)
