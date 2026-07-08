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
- `Pillow` — image inspection (format, colorspace, dimensions).
- `natsort`, `tqdm` — ordering and progress.
- `pymeshlab` *(new, optional)* — Hausdorff validation of decimated geometry.

Deps may be bumped freely to current releases.

### External CLI tools (must be on PATH)
- **ImageMagick `mogrify`** *(kept)* — normalizes exotic textures (CIELab,
  16-bit) to 8-bit sRGB. The only correct color path.
- **`toktx`** (KTX-Software) *(new)* — encodes `.ktx2` (UASTC/ETC1S + mipmaps).
- **`gltfpack`** (meshoptimizer) *(new)* — OBJ → error-bounded-decimated,
  meshopt-compressed geometry-only `.glb`.
- **Retired**: `obj2gltf`, `gltf-pipeline` (replaced by gltfpack + toktx).

## Viewer
- **three.js** + `GLTFLoader`, `MeshoptDecoder`, `KTX2Loader` (+ Basis
  transcoder), `OrbitControls`.
- Delivered as a **web component** (`<dri-viewer>`), bundled self-contained
  (Vite/esbuild) into one ESM/IIFE plus the transcoder wasm. No runtime CDN.

## Node.js
Node is now a first-class build/runtime requirement:
- **Node 20+** (the Singularity image uses Node 20/22).
- Runs the viewer build toolchain (bundler, three.js) and can install/run
  `gltfpack` where a binary isn't available.

## Data / storage
- **No database.** Output is static files: geometry `.glb`, `.ktx2` textures,
  per-object manifest JSON, optional `index.json`, thumbnails.

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
