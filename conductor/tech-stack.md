# Tech Stack

Two components: the **pipeline** (Python + external CLIs) and the **viewer**
(three.js web component). Versions are open to upgrade — treat the numbers below
as the intended modern floor, not the current `setup.cfg` values.

## Languages
- **Python 3.11+** for the pipeline. (Upgrading from the current `>=3.9` floor;
  the Singularity image already targets 3.11.)
- **TypeScript** for the viewer widget.
- **HTML/CSS** for the widget's minimal chrome.

## Pipeline

### Python dependencies
- `Pillow` — image inspection; also used by the legacy `convert.py` path.
- `natsort`, `tqdm` — ordering and progress (`natsort` used by `merge-items`).
- `pymeshlab` *(optional, `.[validate]`)* — Hausdorff validation of decimated
  geometry.
- `jsonschema` *(optional, `.[test]`)* — validates example configs against the
  input schema in the test suite.

Deps may be bumped freely to current releases.

### External CLI tools (must be on PATH)
- **ImageMagick `magick`/`mogrify`** *(kept)* — normalizes exotic textures
  (CIELab, 16-bit) to 8-bit sRGB (the only correct color path) and crops
  thumbnails.
- **`ktx` (KTX-Software ≥ v5, `ktx create`)** *(new)* — encodes `.ktx2`
  (ETC1S default / UASTC + mipmaps). `toktx` was **removed in v5** — the pipeline
  uses `ktx create` (spike hard requirement).
- **`gltfpack`** (meshoptimizer) *(new)* — OBJ → error-bounded-decimated,
  meshopt-compressed geometry `.glb` (UVs kept "used"; normals computed in the
  viewer).
- **`node` (24+ LTS) + bundled `@gltf-transform/core` helper** *(new)* — embeds each
  KTX2 into the geometry glb (`KHR_texture_basisu`), preserving meshopt +
  `KHR_texture_transform`. Run via `preppy/node/embed.mjs`; deps installed with
  `npm install --prefix <preppy>/node`.
- **Retired**: `obj2gltf`, `gltf-pipeline` (replaced by gltfpack + ktx +
  the gltf-transform embed helper). `toktx` never used (v5 removed it).

## Viewer
- **three.js** + `GLTFLoader`, `MeshoptDecoder`, `KTX2Loader` (+ Basis
  transcoder), `OrbitControls`.
- Delivered as a **web component** (`<dri-viewer>`), bundled self-contained
  (Vite/esbuild) into one ESM/IIFE plus the transcoder wasm. No runtime CDN.

## Node.js
Node is now a first-class build/runtime requirement:
- **Node 24+ LTS** (CI and the Singularity image both install Node 24).
- Runs the viewer build toolchain (bundler, three.js) and can install/run
  `gltfpack` where a binary isn't available.

## Data / storage
- **No database.** Output is static files: one self-contained `.glb` per variant
  (meshopt geometry + embedded KTX2), a per-object `manifest.json`, an optional
  top-level `index.json`, and per-object thumbnails. Replaces the old Voyager
  `*.svx.json` + `items.json` pair.

## Infrastructure
- Static hosting on the existing DRI web host (e.g. `infoforest.cs.uky.edu`),
  with long-lived cache headers for assets.
- **Singularity** container (`singularity/`) bundles all deps for reproducible /
  HPC batch runs.
- CI on GitLab (`.gitlab-ci.yml`) — currently a smoke test (`voyager-preppy -h`);
  to be updated for the new toolchain.

## Repos
- `dri-voyager-preppy` (this repo) — the pipeline.
- `dri-voyager` — the host site / where the `<dri-viewer>` widget lives.
