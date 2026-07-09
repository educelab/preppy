import mmap
import re
from pathlib import Path
from typing import Dict


def _mtllibs(obj_path: Path):
    """Yield the resolved paths of every ``mtllib`` referenced by an OBJ.

    Uses mmap because OBJs are large; the mtllib lines live in the header.
    """
    with obj_path.open() as obj_file:
        mm = mmap.mmap(obj_file.fileno(), 0, access=mmap.ACCESS_READ)
        refs = re.findall(rb'mtllib (.+)', mm)
    for ref in refs:
        yield obj_path.parent / ref.decode().strip()


def parse_material_textures(obj_path) -> Dict[str, Path]:
    """Map each material's ``newmtl`` name to its resolved ``map_Kd`` image path.

    Scans every ``mtllib`` the OBJ references (line-by-line, tracking the current
    ``newmtl``) so the texture is associated with the **material name** gltfpack
    will emit — the only safe embed key, since gltfpack orders materials by MTL
    declaration, not numeric name (Phase 0 F1). Materials with no ``map_Kd``
    (e.g. an untextured default) are omitted. Paths resolve relative to the MTL
    file's directory (textures normally sit beside the OBJ).
    """
    obj_path = Path(obj_path)
    materials: Dict[str, Path] = {}
    for mtl_path in _mtllibs(obj_path):
        current = None
        with mtl_path.open() as mtl_file:
            for line in mtl_file:
                line = line.strip()
                if line.startswith('newmtl '):
                    current = line[len('newmtl '):].strip()
                elif line.startswith('map_Kd ') and current is not None:
                    img = line[len('map_Kd '):].strip()
                    materials[current] = (mtl_path.parent / img).resolve()
    return materials


def parse_materials(obj_path) -> Dict:
    """
    Parse an obj file for its mtls and texture images.
    Args:
        obj_path: Path to obj file

    Returns:
        Dictionary of mtl file keys with lists of texture images as values.
    """
    # Make sure we have a path
    obj_path = Path(obj_path)

    # Load a list of mtl files
    # use mmap because OBJs tend to be large
    with obj_path.open() as obj_file:
        mm = mmap.mmap(obj_file.fileno(), 0, access=mmap.ACCESS_READ)
        mtl_files = re.findall(rb'mtllib (.+)', mm)
    mtl_files = [m.decode() for m in mtl_files]

    # Load each mtl and get the texture images
    mtls = dict()
    for mtl in mtl_files:
        mtl_path = obj_path.parent / mtl
        with mtl_path.open() as mtl_file:
            images = re.findall(r'map_Kd (.+)', mtl_file.read(), flags=re.M)
        mtls[mtl] = {'images': images}
    return mtls


def test():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('-i', '--input-obj', type=str, required=True)
    args = parser.parse_args()

    mtls = parse_materials(args.input_obj)
    print(mtls)


if __name__ == '__main__':
    test()
