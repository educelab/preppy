import argparse
import shutil
from pathlib import Path

import PIL.Image

import preppy.convert as convert


def main():
    parser = argparse.ArgumentParser(description='Convert .obj to .glb.')
    parser.add_argument('-i', '--input', type=str, metavar='FILE',
                        help='OBJ file path', required=True)
    parser.add_argument('-o', '--output', type=str, metavar='FILE',
                        help='Output glb path', required=True)

    glb_opts = parser.add_argument_group('glb options')
    glb_opts.add_argument('-f', '--image-format', type=str.lower,
                          help='Texture image encoding format',
                          choices=['png', 'jpeg'],
                          default='jpeg')
    glb_opts.add_argument('-d', '--max-dim', default=8192, metavar='INT',
                          help='Maximum image dimension for texture')
    glb_opts.add_argument('--compress-draco', default=True,
                          action=argparse.BooleanOptionalAction,
                          help='Apply Draco compression to the output glb')

    adv_opts = parser.add_argument_group('advanced options')
    adv_opts.add_argument('--keep-tmp', default=False,
                          action=argparse.BooleanOptionalAction,
                          help='Keep the temporary files directory')
    args = parser.parse_args()

    # Setup paths
    in_path = Path(args.input)
    out_path = Path(args.output)
    out_dir = out_path.parent
    tmp_dir = out_dir / 'tmp'

    # Set Pillow to load large images
    PIL.Image.MAX_IMAGE_PIXELS = 2000000000

    # Prep the mesh
    print('Prepping mesh')
    in_path = convert.prep_obj(obj_path=in_path,
                               img_fmt=args.image_format,
                               img_dim=args.max_dim,
                               tmp_dir=tmp_dir)

    # Convert to glb
    print('Converting to glb')
    convert.obj_to_glb(in_path, out_path, compress=args.compress_draco)

    # Delete temp files
    if not args.keep_tmp and tmp_dir.exists():
        print('Cleaning up')
        shutil.rmtree(tmp_dir)
    print('Done')


if __name__ == '__main__':
    main()
