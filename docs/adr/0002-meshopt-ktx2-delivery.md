# Delivery format: meshopt geometry + KTX2 textures, one self-contained glb per variant

## Status
accepted — **amended 2026-07-07** (manifest reworked from a normalized
shared-geometry model to one self-contained glb per variant; see *Amendment*).

## Context
Variants of one object are ~1.8M-vert / 3.6M-face meshes with ~8K textures. An
uncompressed 8K texture is ~200 MB of VRAM, so instant camera-preserving variant
switching (ADR-0001) is infeasible with plain JPEG. Geometry must also be
decimated for mobile/first-load without harming measurement accuracy. A few
variants are byte-identical in vertices *and* UVs (a "geometry group"), but in
practice matching UVs are rare and this is not worth designing the format around
(see *Amendment*).

## Decision
- **Textures**: ImageMagick `mogrify` normalizes exotic source TIFs (CIELab,
  16-bit) to 8-bit sRGB, then `ktx create` encodes `.ktx2` (ETC1S default; UASTC
  optional per variant) with mipmaps. **Requires KTX-Software ≥ v5.0.0** (`toktx`
  was removed in v5). KTX2 stays GPU-compressed in VRAM — this is what makes
  camera-preserving swaps viable.
- **Geometry**: `gltfpack` (meshoptimizer) ingests OBJ and does error-bounded
  simplification (`-si ≈ 0.2`) + meshopt compression to geometry (position + UV
  only; **normals are computed in the viewer**, not baked). Decimation is driven
  by a geometric-deviation tolerance, Hausdorff-checked so measurement stays
  trustworthy. UVs must stay "used" during packing or gltfpack corrupts the atlas
  (see spike FINDINGS).
- **Packaging (amended)**: **one self-contained `.glb` per variant** = meshopt
  geometry with its KTX2 texture **embedded** via `KHR_texture_basisu`. Because
  the local `gltfpack` build lacks BasisU, the KTX2 is embedded with
  **`gltf-transform`** (Node) after `ktx create`, preserving meshopt +
  `KHR_texture_transform`.
- **Manifest**: replaces Voyager `items.json` + `*.svx.json`. The widget's unit
  of consumption is a **per-object manifest** (one scene): object-level `title`,
  inventory/shelf number, description, credit/copyright, capture date, `units`
  (**cm**), and a flat **`variants[]`**, each `{ label, uri, default }` with
  optional per-variant `credit` / `date` / `method` / `description` overrides.
  An optional flat `index.json` may be emitted for host archive navigation; the
  widget does not require it.
- **Atlas dilation**: MVS atlases can carry a saturated "no-data" fill that bleeds
  into chart edges via mipmaps. The pipeline edge-dilates chart content over it
  before encoding. Triggered/parameterized by an optional **`nodataFill`** color
  (+ tolerance) resolved as *variant ?? object ?? CLI default*; absent → no
  dilation. `null` on a variant disables an inherited default.
- **Naming/layout**: per-object directory named by a config **`prefix`** (defaults
  to the object `id`); each variant file is **`<prefix>_<suffix>.glb`** where
  `suffix` is the variant's stable key (also its manifest `id` for deep-linking).
  Filenames repeat the prefix deliberately so a glb is self-identifying when shared
  outside the deployment; manifest URIs stay relative within the folder. Texture(s)
  are resolved transitively from each OBJ's `map_Kd` (one or many — multi-chart UV
  is normal), overridable per variant.
- **Cache-busting**: optional content-hash in asset filenames — global
  `--hash-names` (**default on**) → `<prefix>_<suffix>.<hash>.glb` (8 hex). The
  hash is over **inputs + config** (source OBJ + texture bytes, pipeline params,
  tool versions), **not the output glb**, because basis (ETC1S/UASTC) encoding is
  multithreaded and non-deterministic — hashing output would churn every URL on
  no-op rebuilds. Contract: hashed assets are served `immutable`; `manifest.json`
  and `index.json` keep **stable names** and are **revalidated** (they hold the
  current hashed `uri`s). The widget reads `uri` from the manifest, so hashing is
  transparent to it, and deep-links use the stable variant `id`, not the filename.
  With `--no-hash-names`, assets take stable names and must *not* be cached
  `immutable`. `--prune` removes hashed files no longer referenced by a current
  manifest (retention policy deferred to harden). Host must revalidate the
  manifest; hashed assets are forgiving of long caches (Apache `.htaccess`
  example to be added when the target host is known).
- **Grouping (removed)**: no shared-geometry declaration or byte-identical
  verification. Each variant ships its own geometry even when two are identical.

## Consequences
- Build-time deps: `ktx` (KTX-Software ≥ v5), `gltfpack`, **`gltf-transform`**
  (KTX2 embed), `mogrify`. `obj2gltf`/`gltf-pipeline` retired.
- **Portable**: deploying a single variant = copying one `.glb`.
- **Simpler viewer**: it uses each glb's own material, so `KHR_texture_transform`
  is handled by `GLTFLoader` — no placeholder-`map_Kd` trick and no manual
  texture-transform reapplication (both were needed by the shared-geometry path).
  The node transform is kept on the mesh so raycast measurement reads real cm.
- **Storage**: byte-identical geometry (rare) is duplicated across its variants
  (~2.4 MB per shared pair, ~7% of a 4-variant object) instead of shared —
  accepted for the simplicity/portability win.
- Geometry-fingerprinting / group-verification code and tests are dropped.
- Legacy single-variant objects are just a one-entry `variants[]`.

## Amendment — 2026-07-07: one glb per variant, not a shared-geometry manifest
The original decision (same day) normalized `geometries[]` + `bands[]` so
byte-identical variants could share one geometry and swap only the texture. The
toolchain spike reversed this:
1. **Camera preservation is viewer behavior**, demonstrated across a full
   mesh-swap (different glbs), so it does *not* require shared geometry or
   separate texture files.
2. **Sharing saves little**: only the RGB/IR pair was byte-identical; compressed
   geometry is ~2.4 MB, so dedup saves ~7% of an object.
3. **The shared path forced brittle viewer workarounds** — a placeholder
   `map_Kd` so gltfpack kept UVs "used" (else the atlas scrambled), plus manual
   `KHR_texture_transform` reapplication when swapping textures onto a bare
   material.

One self-contained glb per variant is simpler, portable, and viewer-native. The
term **band → variant** (see CONTEXT.md); "geometry group" is now a data
observation, not a delivered asset.
