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

### Legacy path (deprecated)

The original `voyager-obj2glb` / `voyager-preppy` OBJ→GLB path uses `obj2gltf`
and `gltf-pipeline` and is **deprecated** — it will be removed once the new
delivery pipeline lands. To keep using it during the transition:

```shell
npm install -g obj2gltf gltf-pipeline
```
