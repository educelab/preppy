import argparse
import json
import subprocess
import sys
from pathlib import Path


def new_scene_file():
    return {
        "asset": {
            "type": "application/si-dpo-3d.document+json",
            "version": "1.0",
            "generator": "dri-voyager-preppy",
            "copyright": "(c) University of Kentucky. All rights reserved."
        },
        "scene": 0,
        "scenes": [
            {
                "name": "Scene",
                "units": "cm",
                "nodes": [0],
                "meta": 0
            }
        ],
        "nodes": [
            {
                "name": "",
                "model": 0
            }
        ],
        "models": [
            {
                "units": "cm",
                "derivatives": [
                    {
                        "usage": "Web3D",
                        "quality": "High",
                        "assets": [
                            {
                                "uri": "",
                                "type": "Model"
                            }
                        ]
                    }
                ]
            }
        ],
        "metas": [
            {
                "collection": {
                    "title": "",
                    "titles": {}
                }
            }
        ]
    }


def positive_int(x):
    """This function is to throw error if the max dimension if provided <1 by
    the user.

        Args:
            x (int or float): A numerical value

        Returns:
            Error if x<1 else x
    """
    x = int(x)
    if x < 1:
        raise argparse.ArgumentTypeError("Minimum dim is 1")
    return x


def convert(model, image_type, max_dimension):
    """
    Making the GLB file for dri-voyager.

    Args:
        model (String): Model contains information about the scroll name,
        title, and the path of the scroll OBJ files.
        image_type (String): Image type (JPG, PNG).
        max_dimension (Integer): Maximum image dimension.
    """

    p = Path(model["fname"])
    objfqfname = model["fname"]
    mtlfname = ''
    texfname = ''
    with Path(objfqfname).open() as file:
        for line in file:
            if line.startswith("mtllib"):
                mtlfname = line.rstrip().split(' ')[-1]
                break
    mtlfqfname = p.parents[0] / mtlfname

    with Path(mtlfqfname).open() as file:
        for line in file:
            if line.startswith("map_Kd"):
                texfname = line.rstrip().split(' ')[-1]
                break

    texfqfname = p.parents[0] / texfname

    newtexfname = texfqfname.with_suffix("." + image_type)

    # Convert to image-type
    print(f'Converting to {image_type}.')
    subprocess.run(
        f'convert -resize {max_dimension}x{max_dimension} '
        f'{texfqfname} {newtexfname}',
        shell=True, check=True)

    oldtexfnameline = f'map_Kd {texfname}'
    newtexfnameline = f'map_Kd {newtexfname.name}'

    tmpfile = Path(mtlfqfname)
    # Replace the old texture file in the mtl file that starts with map_Kd
    tmpfile.write_text(
        tmpfile.read_text().replace(oldtexfnameline, newtexfnameline))


def makeglb(model, outdir):
    """
    Making the GLB file for dri-voyager.

    Args:
        model (String): Model contains information about the scroll name,
        title, and the path of the scroll OBJ files.
        outdir (String): Output directory where the GLB file will be saved

    Return:
        pname (Path): Path to store the dri-config json file.
        dracoglbfqfname (Path): Fully qualified path for the draco compressed
        GLB file created.

    """
    print("Making GLB")
    pname = Path(outdir) / Path(model["sname"])
    pname.mkdir(parents=True, exist_ok=True)

    print(f'fname: {model["fname"]}')
    glbfname = Path(model["fname"]).with_suffix('.glb').name
    glbfqfname = pname / glbfname

    subprocess.run(f'obj2gltf -i {model["fname"]} -o {glbfqfname}', shell=True,
                   check=True)

    dracoglbfname = glbfqfname.stem + '_d.glb'
    dracoglbfqfname = glbfqfname.parents[0] / dracoglbfname

    subprocess.run(
        f'gltf-pipeline -i {str(glbfqfname)} -o {str(dracoglbfqfname)} '
        f'-d --draco.compressionLevel 6 --draco.quantizePositionBits 16 '
        f'--draco.quantizeTexcoordBits 14 --draco.quantizeNormalBits 10',
        shell=True, check=True)
    return pname, dracoglbfqfname


def makedrijson(path, name, uri, model):
    """
    Making the configuration file for dri-voyager.

    Args:
        path (pathlib.Path): Output path for the JSON config file
        name (String): Name of the file to which .json should be appended.
        For example, if name is "PHerc01", the file name will be "PHerc01.json"
        uri (pathlib.Path or String): The URI of the model file.
        model (String): Model contains information about the scroll name,
        title, and the path of the scroll OBJ files.
    """
    file = model['sname'] + '.json'
    configfname = path / file
    content = new_scene_file()
    content['nodes'][0]['name'] = name
    content['models'][0]['derivatives'][0]['assets'][0]['uri'] = str(uri)
    content['metas'][0]['collection']['title'] = model['title']
    if 'titles' not in model:
        print('Titles not present.')
        content['metas'][0]['collection']['titles'] = {'EN': model['title']}
    else:
        content['metas'][0]['collection']['titles'] = model['titles']

    with configfname.open('w', encoding='utf8') as json_file:
        json.dump(content, json_file, indent=4)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("-i", "--input", type=str,
                        help="JSON file containing batch metadata",
                        required=True)
    parser.add_argument("-o", "--output", type=str,
                        help="Output directory for the glb",
                        default="glb-files")
    parser.add_argument("-t", "--image-type", type=str.lower,
                        help="Texture image encoding",
                        choices=["png", "jpg"],
                        default="png")
    parser.add_argument("-m", "--max-dimension", type=positive_int,
                        help="Maximum image dimension for texture.",
                        default=8192)

    args = parser.parse_args()

    print(f'Arguments are: {args}')

    print("Starting Automation")
    config = {}
    try:
        with Path(args.input).open() as f:
            config = json.load(f)
    except (OSError, json.JSONDecodeError) as err:
        print(err)
        sys.exit(1)  # unrecoverable errors

    for model in config:
        print(f'Filename: {model["fname"]}\nScrollname: {model["sname"]}\n')
        convert(model=model, image_type=args.image_type,
                max_dimension=args.max_dimension)
        pname, dracoglbfqfname = makeglb(model, args.outdir)
        pobj = Path(model["fname"])
        makedrijson(path=pname, name=pobj.stem, uri=dracoglbfqfname,
                    model=model)


if __name__ == '__main__':
    main()
