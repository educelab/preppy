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
- Optional: `trimesh` + `pyrender` (`.[preview]`) for the rendered model-preview thumbnail (`preview.py`). Needs an offscreen GL backend; when absent the thumbnail falls back to a texture center-crop.

Python deps (`natsort`, `Pillow`, `numpy`, `scipy`, `tqdm`) install via `pip install .`. `numpy`/`scipy` power the in-memory no-data fill (`texture.fill_nodata`).

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
- **`texture.py`** — `normalize()` (ImageMagick `magick`: CIELab/16-bit → 8-bit sRGB, resize `>max_dim`). When a `nodata_fill` color is set, `normalize()` uses the **nodata-aware** path (`normalize_masked_cmd` + `fill_transparent`): the fill is masked to alpha 0 **at full resolution** (`-transparent`, in sRGB) and IM's alpha-weighted (premultiplied) resize drops it from the resampled edge pixels, so orange never blends into UV-island edges (feedback #1 / Phase 8); `fill_transparent()` (in-memory Pillow+numpy+scipy) then back-fills the still-transparent background from the nearest opaque pixel via `distance_transform_edt` (run on the *downsized* RGBA, off the gigapixel path) and drops alpha. Masking *before* the resize is load-critical — resizing first blended orange into edges and the old color-keyed back-fill re-seeded itself from those orange-tinted edges. Kept in ImageMagick (not numpy) so exotic-source decode/colorspace stays general; costs ~6× the plain resize on a 32k² source (the full-res `-transparent` pass) but completes (~2 min / 30 GB), unlike the earlier `-morphology Dilate` which hung. `nodataFill` hex may omit the leading `#`. Also `encode_ktx2()` (`ktx create`, mips, ETC1S|UASTC), `thumbnail()` (center-crop).
- **`geometry.py`** — `obj_to_geometry_glb()` (gltfpack `-si` decimation + `-cc` meshopt; UVs kept "used" or the atlas scrambles; **smooth vertex normals baked** from the un-quantized source OBJ via `bake_normals()` then octahedral-quantized by gltfpack — computing them before quantization avoids the shading jitter `computeVertexNormals` produced on the quantized grid; `--no-smooth-normals` reverts to viewer-computed normals) and `validate()` (Hausdorff vs a budget via pymeshlab — needs a *plain* glb; it refuses a meshopt one, which segfaults pymeshlab).
- **`assemble.py`** — `embed()` runs the bundled Node helper to swap each material's baseColorTexture for its KTX2 (`KHR_texture_basisu`), preserving `EXT_meshopt_compression` (only if the meshopt encoder is registered — F3) and `KHR_texture_transform`.
- **`preview.py`** — `render_preview()` renders a **proxy model preview** for the default-variant thumbnail (trimesh loads the OBJ + computes normals; pyrender renders one offscreen 3/4-view frame). A `FilePathResolver` subclass swaps the OBJ's `map_Kd` names for the already-normalized PNGs, so the raw (possibly gigapixel) sources are never decoded. It renders the OBJ, **not** the delivered meshopt/KTX2 glb (no offline renderer reads those) — recognizable, not pixel-identical. Raises `PreviewUnavailable` when the toolchain/GL backend is missing so the orchestrator falls back to the texture crop. Gotcha: these OBJs mix `f v/vt` and bare `f v` faces, so trimesh's "mixed data" fallback drops UVs for the whole mesh (and pyrender then compile-fails on a shader sampling a compiled-out `uv_0`); `_recover_uv_by_index` rebuilds `uv[i]=vt[i]` from the file (validated: one `vt` per vertex, matching `v/vt` indices, `process=False` keeps file order), else the model renders untextured.
- **`cache.py`** — content hash over **inputs + config + tool versions** (never the output glb — basis encoding is non-deterministic), `hashed_name()`, and `prune()`.
- **`manifest.py`** (replaced `voyager.py`) — pure builders for the per-object `manifest.json` (flat `variants[] {id,label,uri,default}` + object metadata, `units:"cm"`, per-variant overrides) and the optional `index.json`.
- **`apps/file_prep.py`** — the orchestrator. Per object, per **variant** (no grouping): resolve texture(s) → normalize + encode each → gltfpack → optional Hausdorff gate → embed all by name → one self-contained glb → manifest entry. Emits `manifest.json` per object + a top-level `index.json`. The default-variant thumbnail is a rendered model preview (`preview.render_preview`, `_render_thumbnail` helper) that falls back to a texture crop (`--thumbnail-mode texture`, or automatically when the render toolchain is unavailable).
- **`convert.py` + `apps/obj_to_glb.py`** — the deprecated legacy OBJ→Draco-GLB path (kept until removed).

### Input config format

The `voyager-preppy` input JSON is a flat array of **objects**, validated by `templates/prep-models.schema.json` (examples: `prep-models-example.json`, `mvs-example.json`):

- An **object** needs `id`, `title`, and a `variants` array. Optional `prefix` (output folder/file prefix; defaults to `id`), `titles`, `inventory`, `description`, `credit`, `date`, `units` (default `cm`), `nodataFill`.
- A **variant** needs `suffix` (stable key: names the file + is the manifest variant `id`) and `obj`. Optional `label`, `default`, `nodataFill` (resolved variant ?? object ?? CLI), and per-variant `credit`/`date`/`method`/`description`. Textures are resolved transitively from the OBJ's `map_Kd`. Relative `obj` paths resolve against `--data-root` (default CWD), not the config file's location.

### Output layout

```
out/
  index.json                          # optional host archive listing
  <prefix>/
    manifest.json                     # the scene <dri-viewer> loads (holds hashed uris)
    <prefix>_<suffix>.<hash>.glb      # one self-contained glb per variant (--hash-names default on)
    <prefix>_thumb.jpg                # default-variant thumbnail (rendered model preview; texture-crop fallback)
  tmp/                                # intermediates (deleted unless --keep-tmp)
```

Hashed asset names are served `immutable`; `manifest.json`/`index.json` keep stable names and are revalidated. `--no-hash-names` gives stable asset names; `--prune` drops unreferenced hashed assets (`--prune-keep N` retains the newest N prior generations per variant for rollover safety); `--uri` prefixes manifest URIs for absolute-URL hosts. Host cache-control reference: `docs/hosting/htaccess.example`.

### Delivery conventions

**Surface orientation (+Z):** a delivered glb's dominant imaged surface lies in the XY plane and faces **+Z**. The viewer's initial camera framing (looks down −Z) and raking-light basis (azimuth in XY, elevation toward +Z) assume this — all current back-catalog data are flat XY fragments, so it holds for every asset today. It is documented as a **precondition**, not enforced: an object whose front is not +Z must be pre-oriented in the pipeline before delivery. The matching camera-framing / raking-light assumption lives in the `<dri-viewer>` widget (now in the separate `dri-voyager` repo); that is the other seam to update if a future manifest orientation hint is added.

**Normals:** the delivered glb carries good per-vertex normals — the pipeline bakes smooth normals from the un-quantized source only when the source lacks them (a source shipping `vn` is passed through; `--force-smooth-normals` overrides). See `bake_normals`/`obj_to_geometry_glb` in `geometry.py`.
