import json
from pathlib import Path
from typing import Dict, List, Union


def default_scene() -> Dict:
    """Returns the default Voyager scene metadata dictionary"""
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
                    "title": ""
                }
            }
        ]
    }


def write_items_file(output_path: Union[str, Path], data: List):
    """Write an items.json file for DRI Voyager"""
    # Uses custom json formatting
    with Path(output_path).open('w', encoding='utf8') as of:
        of.write('[\n')
        for idx, line in enumerate(data):
            of.write('  ')
            json.dump(line, of)
            if idx != len(data) - 1:
                of.write(',')
            of.write('\n')
        of.write(']\n')
