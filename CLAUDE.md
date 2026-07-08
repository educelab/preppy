# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

DRI Voyager Preppy turns source OBJs + textures into web-ready 3D assets for the custom `<dri-viewer>` web component. Each imaged object has several **variants** (RGB, IR, PGS, …); the pipeline emits **one self-contained `.glb` per variant** (meshopt-compressed geometry with its KTX2 texture(s) embedded) plus a viewer-native per-object **`manifest.json`** and an optional top-level `index.json`.

This replaced the original Smithsonian-Voyager path (`.svx.json` scene descriptors + `items.json`, via `obj2gltf` + `gltf-pipeline`). That legacy path survives only as the deprecated `voyager-obj2glb` tool (`convert.py`).

## External dependencies (not pip-installable)

The pipeline shells out to CLI tools that must be on `PATH` (see README for install; `tools.py` detects them, `voyager-check-tools` reports status). npm-installed CLIs are invoked as `<name>.cmd` on Windows (`platform.system()` check in `tools.py`).

- **ImageMagick** (`magick`/`mogrify`) — normalize textures to 8-bit sRGB; crop thumbnails.
- **`ktx`** (KTX-Software **≥ v5**, `ktx create` — `toktx` was removed in v5) — KTX2/Basis encoding.
- **`gltfpack`** (meshoptimizer) — OBJ → decimated, meshopt-compressed geometry glb.
- **`node`** (20+) + the bundled `@gltf-transform/core` helper (`preppy/node/embed.mjs`) — embeds KTX2 into the geometry glb. Install its deps once: `npm install --prefix preppy/node`.
- Legacy only: `obj2gltf` + `gltf-pipeline` (for `voyager-obj2glb`).
- Optional: `pymeshlab` (`.[validate]`) for the Hausdorff decimation gate.

Python deps (`natsort`, `Pillow`, `tqdm`) install via `pip install .`.

## Commands

```bash
pip install -e '.[validate,test]'       # editable install + optional pymeshlab/pytest
npm install --prefix preppy/node        # KTX2 embed helper deps (once)

voyager-preppy -i config.json -o out/   # batch: variants → self-contained glbs + manifest.json + index.json
voyager-check-tools                     # report external toolchain status
voyager-obj2glb -i mesh.obj -o mesh.glb # LEGACY single OBJ → Draco GLB (deprecated)
voyager-merge-items a.json b.json -o merged.json  # LEGACY items.json merge (deprecated)
```

There **is** a test suite now (`tests/`, pytest): `python -m pytest tests/`. Tests that need the external tools (or pymeshlab) skip cleanly when they're absent, so a bare run still covers the pure logic. CI (`.gitlab-ci.yml`) smoke-tests `voyager-preppy -h`. The `singularity/dri-voyager-preppy.def` bundles all deps for reproducible/HPC runs.

## Architecture

Console entrypoints in `preppy/apps/` are thin argparse CLIs over the library modules in `preppy/`. Leaf modules factor command-building into pure `*_cmd` helpers so they unit-test without the tools installed.

- **`obj_helpers.py`** — `parse_materials()` (mtllib → `map_Kd`, mmap-scanned) and `parse_material_textures()` which maps each `newmtl` **name** → resolved texture path. Name-keying is essential: gltfpack orders materials by MTL declaration, not numeric name, so the embed matches by name (Phase 0 finding F1).
- **`texture.py`** — `normalize()` (mogrify: CIELab/16-bit → 8-bit sRGB, resize `>max_dim`, optional edge-dilation over a `nodata_fill`), `encode_ktx2()` (`ktx create`, mips, ETC1S|UASTC), `thumbnail()` (center-crop).
- **`geometry.py`** — `obj_to_geometry_glb()` (gltfpack `-si` decimation + `-cc` meshopt; UVs kept "used" or the atlas scrambles; **normals computed in the viewer**, not baked) and `validate()` (Hausdorff vs a budget via pymeshlab — needs a *plain* glb; it refuses a meshopt one, which segfaults pymeshlab).
- **`assemble.py`** — `embed()` runs the bundled Node helper to swap each material's baseColorTexture for its KTX2 (`KHR_texture_basisu`), preserving `EXT_meshopt_compression` (only if the meshopt encoder is registered — F3) and `KHR_texture_transform`.
- **`cache.py`** — content hash over **inputs + config + tool versions** (never the output glb — basis encoding is non-deterministic), `hashed_name()`, and `prune()`.
- **`manifest.py`** (replaced `voyager.py`) — pure builders for the per-object `manifest.json` (flat `variants[] {id,label,uri,default}` + object metadata, `units:"cm"`, per-variant overrides) and the optional `index.json`.
- **`apps/file_prep.py`** — the orchestrator. Per object, per **variant** (no grouping): resolve texture(s) → normalize + encode each → gltfpack → optional Hausdorff gate → embed all by name → one self-contained glb → manifest entry. Emits `manifest.json` per object + a top-level `index.json`.
- **`convert.py` + `apps/obj_to_glb.py`** — the deprecated legacy OBJ→Draco-GLB path (kept until removed).

### Input config format

The `voyager-preppy` input JSON is a flat array of **objects**, validated by `templates/prep-models.schema.json` (examples: `prep-models-example.json`, `mvs-example.json`):

- An **object** needs `id`, `title`, and a `variants` array. Optional `prefix` (output folder/file prefix; defaults to `id`), `titles`, `inventory`, `description`, `credit`, `date`, `units` (default `cm`), `nodataFill`.
- A **variant** needs `suffix` (stable key: names the file + is the manifest variant `id`) and `obj`. Optional `label`, `default`, `nodataFill` (resolved variant ?? object ?? CLI), `texture` override, and per-variant `credit`/`date`/`method`/`description`. Textures are otherwise resolved transitively from the OBJ's `map_Kd`. Relative `obj` paths resolve against `--data-root` (default CWD), not the config file's location.

### Output layout

```
out/
  index.json                          # optional host archive listing
  <prefix>/
    manifest.json                     # the scene <dri-viewer> loads (holds hashed uris)
    <prefix>_<suffix>.<hash>.glb      # one self-contained glb per variant (--hash-names default on)
    <prefix>_thumb.jpg                # default-variant thumbnail
  tmp/                                # intermediates (deleted unless --keep-tmp)
```

Hashed asset names are served `immutable`; `manifest.json`/`index.json` keep stable names and are revalidated. `--no-hash-names` gives stable asset names; `--prune` drops unreferenced hashed assets; `--uri` prefixes manifest URIs for absolute-URL hosts.
