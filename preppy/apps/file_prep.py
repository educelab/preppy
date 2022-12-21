import argparse
import json
import shutil
from pathlib import Path
from typing import Dict

import PIL.Image
from tqdm import tqdm

import preppy.voyager as voyager
from preppy.convert import obj_to_glb, prep_obj


def generate_voyager_scene(model_data: Dict, uri: str, glb_path: Path) -> Dict:
    """
    Generate a Voyager scene dictionary for the given model
    Args:
        model_data: Model's descriptive metadata dict from items.json file
        uri: Root URI for the glb file (e.g. https://foo.com/data/)
        glb_path: Path to the local glb file

    Returns:
        Voyager scene dictionary
    """
    # Get a template scene
    json_data = voyager.default_scene()

    # Voyager object name
    json_data['nodes'][0]['name'] = model_data['stem']

    # glb uri
    glb_uri = f'{uri}{glb_path.name}'
    json_data['models'][0]['derivatives'][0]['assets'][0]['uri'] = glb_uri

    # Descriptive metadata
    json_data['metas'][0]['collection']['title'] = model_data['title']
    if 'titles' in model_data.keys():
        json_data['metas'][0]['collection']['titles'] = model_data['titles']

    return json_data


def process_model(model, out_dir, glb_dir, img_fmt, img_dim, tmp_dir, compress,
                  uri, **kwargs):
    # Get the input obj path
    obj_path = Path(model['obj'])

    # Construct a model stem from the object name
    if 'stem' not in model.keys():
        model['stem'] = obj_path.stem

    # Prep the mesh for glb conversion
    obj_path = prep_obj(obj_path=obj_path, img_fmt=img_fmt, img_dim=img_dim,
                        tmp_dir=tmp_dir)

    # Convert to glb
    glb_path = glb_dir / f'{model["stem"]}.glb'
    obj_to_glb(obj_path, glb_path, compress=compress)

    # Write Voyager json for this model
    json_data = generate_voyager_scene(model, uri, glb_path)
    json_file = f'{model["stem"]}.json'
    json_path = out_dir / json_file
    with json_path.open('w', encoding='utf8') as of:
        json.dump(json_data, of, indent=4)

    # Return the item
    if 'navTitle' in model.keys():
        title = model['navTitle']
    else:
        title = model['title']
    return {'title': title, 'document': json_file}


def main():
    parser = argparse.ArgumentParser(
        description='Prepare OBJ datasets for DRI Voyager.')
    parser.add_argument('-i', '--input', type=str, metavar='FILE',
                        help='JSON file containing batch metadata',
                        required=True)
    parser.add_argument('-o', '--output', type=str, metavar='DIR',
                        help='Output directory generated files',
                        default='preppy/')

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

    meta_opts = parser.add_argument_group('metadata options')
    meta_opts.add_argument('--uri',
                           default='https://infoforest.cs.uky.edu/voyager/data/glb/',
                           help='Root URI where models will be deployed (e.g. '
                                'https://example.com/glb/)')

    adv_opts = parser.add_argument_group('advanced options')
    adv_opts.add_argument('--keep-tmp', default=False,
                          action=argparse.BooleanOptionalAction,
                          help='Keep the temporary files directory')

    args = parser.parse_args()

    print('Loading input config...')
    with Path(args.input).open() as f:
        config = json.load(f)
    num_groups = 0
    num_models = 0
    for m in config:
        if 'documents' in m.keys():
            num_groups += 1
            num_models += len(m['documents'])
        else:
            num_models += 1

    print(f'Loaded: {num_groups} group(s), {num_models} model(s)')

    # Setup output directories
    out_dir = Path(args.output)
    glb_dir = out_dir / 'glb'
    tmp_dir = out_dir / 'tmp'
    for d in [out_dir, glb_dir]:
        d.mkdir(parents=True, exist_ok=True)

    # Get the dataset uri
    uri = args.uri
    if uri[-1] != '/':
        uri += '/'

    # Set Pillow to load large images
    PIL.Image.MAX_IMAGE_PIXELS = 2000000000

    # Save the kwargs in a useful form
    kwargs = {
        'out_dir': out_dir,
        'glb_dir': glb_dir,
        'img_fmt': args.image_format,
        'img_dim': args.max_dim,
        'tmp_dir': tmp_dir,
        'compress': args.compress_draco,
        'uri': uri
    }

    # For every model
    items = []
    outer = tqdm(config)
    inner = tqdm()
    for model in outer:
        # Handle grouped documents
        if 'documents' in model.keys():
            desc = f'Prepping group {model["title"]}'
            outer.set_description_str(desc)
            inner.reset(len(model['documents']))
            sub_items = []
            for sub_item in model['documents']:
                desc = sub_item["title"].rjust(len(desc))
                inner.set_description_str(desc)
                sub_items.append(process_model(model=sub_item, **kwargs))
                inner.update()
            inner.refresh()
            item = {'title': model['title'], 'subitems': sub_items}

        # Handle single documents
        else:
            outer.set_description_str(f'Prepping model {model["title"]}')
            item = process_model(model=model, *kwargs)
        items.append(item)
    del outer, inner

    # Write items file
    print('Writing items.json')
    items_path = out_dir / 'items.json'
    with Path(items_path).open('w', encoding='utf8') as of:
        json.dump(items, of, indent=2)

    # Delete temp files
    if not args.keep_tmp and tmp_dir.exists():
        print('Cleaning up')
        shutil.rmtree(tmp_dir)
    print('Done')


if __name__ == '__main__':
    main()
