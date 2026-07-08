"""Assembly leaf module: embed pre-encoded KTX2 textures into the meshopt
geometry glb to produce one self-contained variant glb.

The embed is delegated to a bundled Node helper (:data:`EMBED_SCRIPT`) run under
``node``. A CLI cannot do it: the KTX2 must be matched to its material **by name**
(gltfpack scrambles material order — Phase 0 F1), and ``EXT_meshopt_compression``
only survives the gltf-transform round-trip when the meshopt encoder is
registered as a write dependency (F3). ``KHR_texture_transform`` is preserved
because only the image bytes are swapped.

Before first use, install the helper's Node dependencies::

    npm install --prefix preppy/node

(:func:`node_deps_installed` reports whether that has been done.)
"""

import shutil
import subprocess as sp
from pathlib import Path
from typing import List, Mapping, Optional, Union

PathLike = Union[str, Path]

#: The bundled Node helper and its dependency directory.
NODE_DIR = Path(__file__).resolve().parent / 'node'
EMBED_SCRIPT = NODE_DIR / 'embed.mjs'


def node_deps_installed() -> bool:
    """True if ``npm install`` has been run for the bundled helper."""
    return (NODE_DIR / 'node_modules' / '@gltf-transform' / 'core').is_dir()


def _require_node() -> str:
    node = shutil.which('node')
    if node is None:
        raise RuntimeError(
            'node was not found on PATH; Node.js 20+ is required for the KTX2 '
            'embed step (see README).')
    if not node_deps_installed():
        raise RuntimeError(
            'The embed helper dependencies are not installed. Run:\n'
            f'  npm install --prefix {NODE_DIR}')
    return node


def embed_cmd(node: str, geom_glb: Path, out_glb: Path,
              ktx2_by_material: Mapping[str, PathLike],
              opaque: bool = True) -> List[str]:
    """Build the ``node embed.mjs`` argv (pure; unit tested)."""
    cmd: List[str] = [node, str(EMBED_SCRIPT),
                      '--geom', str(geom_glb), '--out', str(out_glb)]
    for name, ktx2 in ktx2_by_material.items():
        cmd += ['--map', f'{name}={Path(ktx2)}']
    if opaque:
        cmd.append('--opaque')
    return cmd


def embed(geom_glb: PathLike, ktx2_by_material: Mapping[str, PathLike],
          out_glb: PathLike, *, opaque: bool = True) -> Path:
    """Embed each material's KTX2 into ``geom_glb`` -> a self-contained variant
    glb at ``out_glb``; return that path.

    ``ktx2_by_material`` maps each glb material **name** to its KTX2 file.
    ``opaque`` forces OPAQUE alpha mode (defensive fix for the OpenMVS ``Tr 1.0``
    ambiguity, F2); leave it on unless a variant legitimately has transparency.
    """
    node = _require_node()
    geom_glb, out_glb = Path(geom_glb), Path(out_glb)
    if not ktx2_by_material:
        raise ValueError('ktx2_by_material must map at least one material name')
    out_glb.parent.mkdir(parents=True, exist_ok=True)

    cmd = embed_cmd(node, geom_glb, out_glb, ktx2_by_material, opaque=opaque)
    sp.run(cmd, check=True)
    return out_glb
