# Product Definition

## Name
DRI Voyager Preppy

## Description
A pipeline that prepares captured, textured meshes of physical artifacts
(Herculaneum papyri) for display in an embeddable web 3D viewer — and the
`<dri-viewer>` widget that displays them.

## Problem
Objects are imaged in multiple **bands** (RGB, IR, spectral, PGS…), each a large
mesh (~1.8M verts / 3.6M faces) with a large, scientifically exotic texture
(8K CIELab or 16-bit-grayscale TIFFs). The existing pipeline is fragile and
funnels everything through DPO Voyager, which:
- reloads the whole scene to switch bands, snapping the camera back, and
- has no first-class way to swap textures in place or share geometry across bands.

Scholars need to compare an object's bands quickly, in place, without losing
their view — and the archive needs a lightweight widget that hosts can embed.

## Target users
- **DRI researchers / scholars** studying papyri, who compare bands and take
  measurements on the surface.
- **The public / other institutions** browsing the archive, via widgets embedded
  in host pages.

## Key goals
1. **Camera-preserving band switching** — swap a band without resetting the view
   (the thing Voyager can't do).
2. **Deliver large assets affordably** — decimated meshopt geometry + KTX2/Basis
   textures so ~8K bands load and swap on real devices, including mobile.
3. **A simple, embeddable, single-object viewer** — one scene per widget, no
   heavyweight viewer dependency to maintain.

## Non-goals (for now)
- Annotations, guided tours, AR/USDZ, and other DPO Voyager features.
- Archive/object navigation *inside* the widget (the host page handles that).
- Full LOD ladders (single decimated mesh now; revisit two-tier later).
