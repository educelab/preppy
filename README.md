# Preppy

Mesh preparation for DRI Voyager.

## Installation

The pipeline shells out to several command-line tools that must be on `PATH`.

```shell
# System tools
brew install imagemagick        # `mogrify` — texture normalization
brew install ktx                # KTX-Software >= v5 (`ktx create`) — KTX2 encoding
brew install node               # Node 24+ LTS (for the tools below)

# Node tools
npm install -g gltfpack          # meshoptimizer geometry decimation/compression

# Python package. Optional extras:
#   [validate] — pymeshlab, for the Hausdorff decimation gate
#   [preview]  — trimesh + pyrender, to render the model-preview thumbnail
pip install .
pip install '.[validate,preview]'

# KTX2 embed helper (Node): install its deps once, in the installed package dir
npm install --prefix "$(python -c 'import preppy, pathlib; print(pathlib.Path(preppy.__file__).parent / "node")')"
```

The KTX2-into-glb embed step runs a bundled Node helper
(`preppy/node/embed.mjs`, using `@gltf-transform/core` + `meshoptimizer`) rather
than the `gltf-transform` CLI, so it needs `node` (24+ LTS) plus that helper's npm
deps installed once as shown above.

> **KTX-Software must be >= v5.0.0** — `toktx` was removed in v5 and the pipeline
> uses `ktx create`. If `brew install ktx` is unavailable on your platform, grab a
> release from https://github.com/KhronosGroup/KTX-Software/releases.

Verify everything is installed and new enough:

```shell
preppy-check-tools               # all CLI tools + optional model-preview backend
preppy-check-tools preview       # just probe the model-preview render toolchain
```

The `preview` line is informational: it renders a tiny offscreen frame to confirm
the `preview` extra and a GL backend actually work. When it reports `SKIP`, the
pipeline still runs — thumbnails fall back to a texture crop.

## Usage

`preppy` turns source OBJs + textures into **one self-contained `.glb`
per variant** (meshopt geometry with embedded KTX2) plus a viewer-native
per-object manifest.

```shell
preppy -i config.json -o out/
```

The input config is a flat array of **objects**, each with a flat `variants[]`
(one mesh + its texture(s) per variant). See
[`templates/prep-models.schema.json`](templates/prep-models.schema.json) for the
full schema and [`templates/mvs-example.json`](templates/mvs-example.json) for a
worked example. Each variant's texture(s) are resolved transitively from its
OBJ's `map_Kd` — no texture paths in the config normally.

Relative `obj` paths resolve against `--data-root` (default: the current working
directory), so the config file can live anywhere:

```shell
preppy -i config.json -o out/ --data-root /path/to/meshes/
```

Output layout (per-object directory named by `prefix`, defaults to `id`):

```
out/
  index.json                          # optional host archive listing
  <prefix>/
    manifest.json                     # the scene the viewer loads
    <prefix>_<suffix>.<hash>.glb      # one self-contained glb per variant
    <prefix>_thumb.jpg                # default-variant thumbnail (model preview)
```

Asset filenames carry an inputs+config content hash by default (served
`immutable`); `manifest.json` / `index.json` keep stable names and hold the
current hashed URIs. Useful flags:

| Flag | Effect |
| --- | --- |
| `--ktx2-mode {etc1s,uastc}` | KTX2/Basis codec (default `etc1s`) |
| `-s/--decimate-error FLOAT` | gltfpack `-si` target (default `0.2`) |
| `--no-decimate` | meshopt-compress without simplifying |
| `--nodata-fill COLOR` | default atlas no-data fill (hex, `#` optional) to back-fill from the nearest chart pixel |
| `--no-hash-names` | stable asset names (not cacheable `immutable`) |
| `--data-root DIR` | root that relative `obj` paths resolve against (default: CWD) |
| `--uri PREFIX` | absolute-URL prefix for manifest `uri`s |
| `--prune` | delete hashed assets no longer referenced by a manifest |
| `--prune-keep N` | with `--prune`, also keep the newest `N` prior generations of each variant (rollover window; default `0`) |
| `--thumbnail-mode {render,texture}` | thumbnail source: a rendered model preview of the default variant (default; needs the `preview` extra, falls back to `texture` if unavailable) or a texture center-crop |
| `--preview-bg COLOR` | background the rendered preview composites over (hex, `#` optional; default `222222`) |
| `--keep-tmp` | keep intermediate PNG/KTX2/geometry files |

The default `<prefix>_thumb.jpg` is a **rendered preview of the default variant's
model** (a 3/4 view with computed normals), not a crop of its texture atlas. It is
a proxy: it renders the OBJ geometry with the *normalized* textures rather than
the delivered meshopt/KTX2 glb, so it is recognizable but not a pixel-identical
capture of what `<dri-viewer>` shows. Rendering needs the `preview` extra
(`trimesh` + `pyrender`) and a working offscreen GL backend; when either is
missing the run falls back to the texture center-crop (`--thumbnail-mode
texture`) automatically.

Run `preppy -h` for the complete list.

### Merging catalogs

Objects built in separate runs (or on separate machines) combine into one
servable catalog with `preppy-merge-items`. Each per-object subdirectory is
copied into the output directory and the `index.json` listings are merged:

```shell
preppy-merge-items run1/ run2/ run3/ -o catalog/
```

Object `id` is the merge key, and relative `manifest`/`thumb` URIs are preserved
by keeping each object's subdirectory name. Duplicate ids across sources are an
error — pass `--overwrite` to let the last source win, which is how a rebuilt
object replaces its older assets in place. The whole merge is validated before
anything is copied, and `--no-sort` keeps source order instead of sorting by
title.

Passing `.json` files instead of directories runs the deprecated `items.json`
document-list merge (`--merge-duplicates`).

### Hosting / caching

Serve the catalog with a two-tier cache policy so cache-busting is safe:

- **hashed assets** (`…​.<hash>.glb` / `.ktx2`) never change under a given name —
  cache them `immutable`, effectively forever;
- **`manifest.json` / `index.json`** keep stable names — serve them `no-cache`
  (always revalidate) so a viewer immediately picks up new hashed URIs.

A rebuild that changes an input mints new hashed names and rewrites the manifest;
the viewer revalidates the manifest and pulls the new immutable assets. Pair this
with `--prune --prune-keep N` so a manifest already served to an in-flight client
during a rollover can still resolve its (now-previous-generation) hashed URIs.

See [`docs/hosting/htaccess.example`](docs/hosting/htaccess.example) for a
ready-to-adapt Apache configuration (final host TBD; tune to your deployment).

## Testing

```shell
pip install -e '.[test]'    # pytest (+ pymeshlab/pyrender via [validate]/[preview])
python -m pytest tests/
```

Tests that need the external toolchain (`magick`/`ktx`/`gltfpack`/`node`), `pymeshlab`,
or an offscreen-GL backend **skip cleanly** when those are absent, so a bare run still
covers the pure logic. CI runs this across Python 3.11–3.13 (plus a manual `integration`
job that exercises the full toolchain); see [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Docker

A prebuilt multi-arch (amd64/arm64) image bundling the full toolchain is published
to the GitHub Container Registry on every push to `develop` (tag `edge`) and on
release tags (`vX.Y.Z`, `latest`):

```shell
docker pull ghcr.io/educelab/preppy:edge

# The image's default command is `preppy -h`; run the pipeline over a mounted dir:
docker run --rm -v "$PWD":/data -w /data ghcr.io/educelab/preppy:edge \
    preppy -i config.json -o out/

# Any of the console scripts work as the command, e.g.:
docker run --rm ghcr.io/educelab/preppy:edge preppy-check-tools
```

To build it locally (see [`Dockerfile`](Dockerfile)):

```shell
docker build -t preppy .
```

### ImageMagick resource limits

Distro ImageMagick ships a `policy.xml` that caps the pixel cache (Debian: 1GiB
memory / 2GiB map / 2GiB disk, 256MP area). Our textures blow straight through
it — a 16384×16384 source is 268MP, so `magick` spills to disk and then aborts
with `cache resources exhausted`. The container images raise those ceilings
(16GiB memory / 32GiB map / 128GiB disk, 4GP area, 128KP width/height); a
non-container install on Linux needs the same edit to
`/etc/ImageMagick-*/policy.xml`. Check the effective limits with
`identify -list resource`.

Policy values are per-instance *maximums*, so a run can only tighten them:
`MAGICK_MEMORY_LIMIT` / `MAGICK_MAP_LIMIT` / `MAGICK_DISK_LIMIT` lower the
ceiling on a RAM-constrained node. Anything spilled past the memory limit is
written to `MAGICK_TMPDIR` (else `TMPDIR`, else `/tmp`) — point that at scratch,
not a small tmpfs, when processing 32K sources.

> The `<dri-viewer>` web component that consumes this pipeline's output lives in a
> separate repository (`dri-voyager`), with its own TypeScript/Vitest/Playwright
> suite. This repo is the model-preparation pipeline only.

### Legacy path (deprecated)

The single-object `preppy-obj2glb` tool (and its `convert.py` core) still uses
`obj2gltf` + `gltf-pipeline` to emit a Draco-compressed GLB. It is **deprecated**
in favor of the delivery pipeline above and will be removed. To keep using it
during the transition:

```shell
npm install -g obj2gltf gltf-pipeline
```
