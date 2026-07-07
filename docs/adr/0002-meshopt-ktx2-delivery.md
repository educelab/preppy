# Delivery format: meshopt geometry + KTX2 textures, normalized shared-geometry manifest

## Status
accepted

## Context
Bands of one object are ~1.8M-vert / 3.6M-face meshes with ~8K textures. An
uncompressed 8K texture is ~200 MB of VRAM, so instant in-place band swapping
(ADR-0001) is infeasible with plain JPEG. Geometry must also be decimated for
mobile/first-load without harming measurement accuracy. Occasionally two bands
are byte-identical in vertices *and* UVs and can share one geometry asset, but
in practice matching UVs are hard to produce and this will be rare.

## Decision
- **Textures**: ImageMagick `mogrify` normalizes exotic source TIFs (CIELab,
  16-bit) to 8-bit sRGB, then `toktx` encodes `.ktx2` (UASTC/ETC1S + mipmaps) as
  separate files. This is what makes camera-preserving swaps viable in VRAM.
- **Geometry**: `gltfpack` (meshoptimizer) ingests OBJ and does error-bounded
  simplification + meshopt compression to a geometry-only `.glb`. Chosen over
  the previous `obj2gltf` + `gltf-pipeline`/Draco because it consolidates
  decimation and compression, and meshopt decodes natively in three.js.
  Decimation targets are driven by a geometric-deviation tolerance and validated
  (Hausdorff) so measurement stays trustworthy — not a blind face count.
- **Manifest**: replaces Voyager `items.json` + `*.svx.json`. The widget's unit
  of consumption is a **per-object manifest** (one scene). Each object carries
  `title`, inventory/shelf number, description (localizable), credit/copyright,
  capture date, `units`, a normalized `geometries[]` list, and `bands[]` that
  reference a geometry id. Independent-geometry bands are the common case; shared
  geometry is the degenerate case where two bands reference the same geometry id.
  An optional flat `index.json` listing may be emitted for host pages to build
  their own archive navigation, but the widget does not require it.
- **Grouping**: which bands share geometry is **declared** in the input config
  and **verified** (vt+f byte-identical) by the pipeline; on mismatch it warns
  and falls back to independent geometry per band. Never auto-detected.

## Consequences
- New build-time dependencies: `toktx` (KTX-Software) and `gltfpack`. `mogrify`
  stays; `obj2gltf`/`gltf-pipeline` are retired from the new path.
- Legacy single-band objects are just the degenerate manifest case, so later
  migration off Voyager is mechanical.
