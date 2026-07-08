# DRI Voyager Preppy

Mesh preparation for DRI Voyager.

## Installation

The pipeline shells out to several command-line tools that must be on `PATH`.

```shell
# System tools
brew install imagemagick        # `mogrify` — texture normalization
brew install ktx                # KTX-Software >= v5 (`ktx create`) — KTX2 encoding
brew install node               # Node 20+ (for the tools below)

# Node tools
npm install -g gltfpack          # meshoptimizer geometry decimation/compression

# Python package (optionally with pymeshlab for Hausdorff validation)
pip install .
pip install '.[validate]'        # includes pymeshlab

# KTX2 embed helper (Node): install its deps once, in the installed package dir
npm install --prefix "$(python -c 'import preppy, pathlib; print(pathlib.Path(preppy.__file__).parent / "node")')"
```

The KTX2-into-glb embed step runs a bundled Node helper
(`preppy/node/embed.mjs`, using `@gltf-transform/core` + `meshoptimizer`) rather
than the `gltf-transform` CLI, so it needs `node` (20+) plus that helper's npm
deps installed once as shown above.

> **KTX-Software must be >= v5.0.0** — `toktx` was removed in v5 and the pipeline
> uses `ktx create`. If `brew install ktx` is unavailable on your platform, grab a
> release from https://github.com/KhronosGroup/KTX-Software/releases.

Verify everything is installed and new enough:

```shell
voyager-check-tools
```

## Usage

`voyager-preppy` turns source OBJs + textures into **one self-contained `.glb`
per variant** (meshopt geometry with embedded KTX2) plus a viewer-native
per-object manifest.

```shell
voyager-preppy -i config.json -o out/
```

The input config is a flat array of **objects**, each with a flat `variants[]`
(one mesh + its texture(s) per variant). See
[`templates/prep-models.schema.json`](templates/prep-models.schema.json) for the
full schema and [`templates/mvs-example.json`](templates/mvs-example.json) for a
worked example. Each variant's texture(s) are resolved transitively from its
OBJ's `map_Kd` — no texture paths in the config normally.

Output layout (per-object directory named by `prefix`, defaults to `id`):

```
out/
  index.json                          # optional host archive listing
  <prefix>/
    manifest.json                     # the scene the viewer loads
    <prefix>_<suffix>.<hash>.glb      # one self-contained glb per variant
    <prefix>_thumb.jpg                # default-variant thumbnail
```

Asset filenames carry an inputs+config content hash by default (served
`immutable`); `manifest.json` / `index.json` keep stable names and hold the
current hashed URIs. Useful flags:

| Flag | Effect |
| --- | --- |
| `--ktx2-mode {etc1s,uastc}` | KTX2/Basis codec (default `etc1s`) |
| `-s/--decimate-error FLOAT` | gltfpack `-si` target (default `0.2`) |
| `--no-decimate` | meshopt-compress without simplifying |
| `--nodata-fill COLOR` | default atlas no-data fill to dilate over |
| `--no-hash-names` | stable asset names (not cacheable `immutable`) |
| `--uri PREFIX` | absolute-URL prefix for manifest `uri`s |
| `--prune` | delete hashed assets no longer referenced by a manifest |
| `--keep-tmp` | keep intermediate PNG/KTX2/geometry files |

Run `voyager-preppy -h` for the complete list.

### Legacy path (deprecated)

The single-object `voyager-obj2glb` tool (and its `convert.py` core) still uses
`obj2gltf` + `gltf-pipeline` to emit a Draco-compressed GLB. It is **deprecated**
in favor of the delivery pipeline above and will be removed. To keep using it
during the transition:

```shell
npm install -g obj2gltf gltf-pipeline
```
