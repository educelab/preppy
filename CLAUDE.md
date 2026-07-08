# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

DRI Voyager Preppy prepares textured OBJ meshes for display in [Smithsonian Voyager](https://smithsonian.github.io/dpo-voyager/). It converts OBJs to Draco-compressed GLBs, normalizes their texture images, and emits the Voyager scene descriptors (`*.svx.json`) and navigation manifest (`items.json`) that a Voyager deployment consumes.

## External dependencies (not pip-installable)

The core work is done by shelling out to CLI tools that must be on `PATH`:

- **ImageMagick** (`mogrify`) — resize/re-encode textures. `brew install imagemagick`
- **Node** tools — `npm install -g obj2gltf gltf-pipeline` (`obj2gltf` does OBJ→GLB, `gltf-pipeline` applies Draco). On Windows these are invoked as `obj2gltf.cmd` / `gltf-pipeline.cmd` (see `platform.system()` check in `convert.py`).

Python deps (`natsort`, `Pillow`, `tqdm`) install via `pip install .`.

## Commands

```bash
pip install -e .                    # editable install; exposes the three console scripts

voyager-preppy -i input.json -o out/    # batch: OBJs → GLBs + scene JSON + items.json
voyager-obj2glb -i mesh.obj -o mesh.glb  # single OBJ → GLB
voyager-merge-items a/items.json b/items.json -o merged.json  # combine/dedupe manifests
```

There is **no test suite**. CI (`.gitlab-ci.yml`) only smoke-tests that `voyager-preppy -h` runs after install on Python 3.9/3.10. To verify changes, run the console scripts against a real OBJ.

The `singularity/dri-voyager-preppy.def` builds a container (`singularity build ...`) bundling all deps; use it for reproducible/HPC runs.

## Architecture

Three entrypoints in `preppy/apps/` are thin argparse CLIs over the library modules in `preppy/`:

- **`preppy/obj_helpers.py`** — `parse_materials()` mmap-scans an OBJ for `mtllib` references, then each `.mtl` for `map_Kd` texture paths. Returns `{mtl_name: {'images': [...]}}`. OBJs are large, hence mmap.
- **`preppy/convert.py`** — the conversion core.
  - `prep_obj()`: decides whether textures need work. If every image already matches the target format and is under `img_dim`, it returns the **original** OBJ path untouched (no temp files). Otherwise it copies OBJ+MTLs+images into `tmp_dir`, runs `mogrify` to convert/resize, rewrites the MTL `map_Kd` extensions to match, and returns the temp OBJ path.
  - `obj_to_glb()`: runs `obj2gltf`, then (if `compress`) `gltf-pipeline` with fixed Draco quantization settings.
- **`preppy/voyager.py`** — `default_scene()` returns the Voyager `.svx.json` skeleton dict that `file_prep.py` fills in per model.
- **`preppy/apps/file_prep.py`** — orchestrator. Reads the input config, and for each model calls `prep_obj` → `obj_to_glb` → `generate_voyager_scene`, writing one `<stem>.svx.json` per model plus a top-level `items.json` navigation manifest. Output layout: `out/glb/*.glb`, `out/*.svx.json`, `out/items.json`, `out/tmp/` (deleted unless `--keep-tmp`).

### Input config format

The `voyager-preppy` input JSON is an array of **documents** and/or **document groups**, validated by `templates/prep-models.schema.json` (example in `templates/prep-models-example.json`):

- A **document** needs `obj`, `stem` (unique short name, used for output filenames), and `title`. Optional `navTitle` (nav-menu label) and `titles` (locale dict).
- A **document group** has a `title` and a `documents` array; groups become nested `subitems` in `items.json`.

`merge_items.py` combines multiple `items.json` files: dedupes by title (groups keyed `<title>G`, singles `<title>S`), merges group `subitems`, and natsorts by `title` or `document`.
