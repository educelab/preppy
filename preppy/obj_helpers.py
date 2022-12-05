import mmap
import re
from pathlib import Path
from typing import Dict


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
