from typing import Dict


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