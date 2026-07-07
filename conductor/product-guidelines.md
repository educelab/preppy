# Product Guidelines

## Voice and tone
Concise and technical. This is scholarly tooling for a research initiative;
documentation and UI text should be direct, precise, and unembellished. Prefer
the project's canonical vocabulary (see [../CONTEXT.md](../CONTEXT.md)): *Object*,
*Band*, *Geometry group*, *Scene*.

## Design principles
1. **Simplicity over features.** The viewer deliberately does far less than DPO
   Voyager. Resist re-implementing what we chose to drop.
2. **Fidelity where it counts.** Presentation-grade color is acceptable (8-bit,
   lossy), but colorspace conversion must be *correct* (CIELab/16-bit → sRGB),
   and geometry decimation must be error-bounded and validated so on-surface
   measurement stays trustworthy.
3. **Low fragility / low lock-in.** Favor stock, well-supported tools and formats
   (three.js, meshopt, KTX2) over forks and experimental branches. Prefer
   declared-and-verified behavior over silent auto-detection.
4. **Embeddable and self-contained.** The widget ships as one script + a custom
   element with no runtime CDN dependency.
