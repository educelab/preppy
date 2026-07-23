# Product Definition

## Name
DRI Voyager Preppy

## Description
A pipeline that turns captured, textured meshes of physical artifacts
(Herculaneum papyri) into web-ready 3D assets: decimated meshopt geometry with
embedded KTX2 textures, one self-contained `.glb` per variant, plus a per-object
`manifest.json`. The assets are consumed by the `<dri-viewer>` web component,
which lives in the separate `dri-voyager` repo.

## Problem
Objects are imaged in multiple **variants** (RGB, IR, spectral, PGS…), each a
large mesh (~1.8M verts / 3.6M faces) with a large, scientifically exotic texture
(8K CIELab or 16-bit-grayscale TIFFs). Delivered raw — as the old DPO Voyager path
did, via `*.svx.json` scene descriptors + loose assets — they are far too heavy to
load and switch between on real devices. The pipeline must produce assets light
enough that the viewer can compare an object's variants quickly and in place: the
geometry decimated (without harming on-surface measurement) and the textures kept
GPU-compressed, so an ~8K variant loads and swaps affordably.

## Target users
- **Pipeline operators** who batch-prepare the back-catalog and new captures into
  the delivery format.
- **DRI researchers / scholars** and **the public**, downstream — they consume the
  assets in the viewer (compare variants, measure on the surface); the pipeline
  exists to feed them trustworthy, affordable data.

## Key goals
1. **Deliver large assets affordably** — decimated meshopt geometry + KTX2/Basis
   textures so an ~8K variant loads and swaps on real devices, including mobile.
2. **Preserve measurement fidelity** — error-bounded, Hausdorff-validated
   decimation and correct CIELab/16-bit → sRGB color, so a delivered asset stays
   scientifically trustworthy.
3. **A viewer-native, self-contained delivery format** — one `.glb` per variant
   (geometry + embedded texture) plus a per-object `manifest.json` and optional
   `index.json`, so the widget needs no sidecar assets and can swap a variant while
   preserving the camera. Replaces the Voyager `*.svx.json` + `items.json` pair.

## Non-goals (for now)
- The viewer itself and its features (variant-switch UI, measurement, raking
  light, annotations/tours/AR) — those live in the `dri-voyager` repo.
- Full LOD ladders (single decimated mesh now; revisit two-tier later).
- Archive/object navigation (a host page's concern, not the pipeline's).
