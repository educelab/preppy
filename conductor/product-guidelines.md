# Product Guidelines

## Voice and tone
Concise and technical. This is scholarly tooling for a research initiative;
documentation and UI text should be direct, precise, and unembellished. Prefer
the project's canonical vocabulary (see [../CONTEXT.md](../CONTEXT.md)): *Object*,
*Band*, *Geometry group*, *Scene*.

## Design principles
1. **Simplicity over features.** The pipeline and delivery format stay minimal,
   matching a viewer (in the `dri-voyager` repo) that deliberately does far less
   than DPO Voyager. Resist re-implementing what we chose to drop.
2. **Fidelity where it counts.** Presentation-grade color is acceptable (8-bit,
   lossy), but colorspace conversion must be *correct* (CIELab/16-bit → sRGB),
   and geometry decimation must be error-bounded and validated so on-surface
   measurement stays trustworthy.
3. **Low fragility / low lock-in.** Favor stock, well-supported tools and formats
   (gltfpack/meshopt, KTX2, glTF) over forks and experimental branches. Prefer
   declared-and-verified behavior over silent auto-detection.
4. **Self-contained delivery.** Each variant ships as one self-contained `.glb`
   (geometry + embedded KTX2) with a per-object manifest — no sidecar assets to
   track, and nothing the viewer must fetch from a runtime CDN.
