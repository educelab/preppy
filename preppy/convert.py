import shutil
import subprocess as sp
from pathlib import Path
from typing import Union

from PIL import Image

from preppy.obj_helpers import parse_materials


def prep_obj(obj_path: Union[str, Path],
             img_fmt: str = 'jpeg',
             img_dim: int = 8192,
             tmp_dir: Union[str, Path] = Path('tmp/')) -> Path:
    """
    Prepare an obj file for conversion to a glb and return the path to the
    prepped version of the obj. If the input can be converted to glb directly,
    returns the path to the original file. Otherwise, copies the original files
    to tmp_dir, modifies them for glb conversion, and returns the path to this
    intermediate obj file.

    Args:
        obj_path: Path to the original obj file
        img_fmt: Image format for all associated texture images
        img_dim: Maximum dimension for all associated texture images
        tmp_dir: Working directory for storing intermediate files. Will be
        created if does not already exist.

    Returns:
        Path to an obj file which can be directly converted to a glb
    """
    # Find and parse the mtl files
    obj_path = Path(obj_path)
    mtls = parse_materials(obj_path)

    # Find the images that need to be resaved or resized
    imgs_to_convert = []
    for mtl, data in mtls.items():
        mtl_path = obj_path.parent / mtl
        for img_path in data['images']:
            img_path = mtl_path.parent / img_path
            with Image.open(img_path) as img:
                # Check if the image matches the target image format
                if img.format.lower() != img_fmt:
                    imgs_to_convert.append((mtl_path, img_path))
                # Check if the image dimensions are larger than the limit
                elif any([i > img_dim for i in img.size]):
                    imgs_to_convert.append((mtl_path, img_path))

    # If we don't need to transform images, we can just use the original mesh
    if len(imgs_to_convert) == 0:
        return obj_path

    # Set up the temp folder
    tmp_dir = Path(tmp_dir)
    if not tmp_dir.exists():
        tmp_dir.mkdir(exist_ok=True, parents=True)

    # Copy all files (obj, mtls, images) to the temp directory
    shutil.copy(obj_path, tmp_dir)
    for mtl, data in mtls.items():
        mtl_path = obj_path.parent / mtl
        shutil.copy(mtl_path, tmp_dir)
        for img in data['images']:
            img_path = mtl_path.parent / img
            shutil.copy(img_path, tmp_dir)

    # Convert all non-conforming images using mogrify
    cmd = ['mogrify',
           '-resize', f'{img_dim}x{img_dim}>',
           '-format', img_fmt,
           '-path', str(tmp_dir)
           ]
    cmd.extend([str(i) for _, i in imgs_to_convert])
    sp.run(cmd, stdout=sp.DEVNULL, stderr=sp.DEVNULL, check=True)

    # Update the mtl files with the new conforming image names
    for mtl_path, img_path in imgs_to_convert:
        mtl_path = tmp_dir / mtl_path.name
        d = mtl_path.read_text()
        d = d.replace(img_path.name, img_path.with_suffix(f'.{img_fmt}').name)
        mtl_path.write_text(d)

    # Return the path to the obj
    return tmp_dir / obj_path.name


def obj_to_glb(obj_file: Union[str, Path], glb_file: Union[str, Path],
               compress=True):
    """
    Convert obj_file file to the glb format.

    Args:
        obj_file: Path to obj file
        glb_file: Path to output glb file
        compress: If True, convert apply DRACO compression
    """
    # Convert to glb
    cmd = ['obj2gltf',
           '-i', str(obj_file),
           '-o', str(glb_file)
           ]
    sp.run(cmd, stdout=sp.DEVNULL, stderr=sp.DEVNULL, check=True)

    if not compress:
        return

    # Compress glb
    cmd = ['gltf-pipeline',
           '-i', str(glb_file),
           '-o', str(glb_file),
           '-d',
           '--draco.compressionLevel', '6',
           '--draco.quantizePositionBits', '16',
           '--draco.quantizeTexcoordBits', '14',
           '--draco.quantizeNormalBits', '10'
           ]
    sp.run(cmd, stdout=sp.DEVNULL, stderr=sp.DEVNULL, check=True)
