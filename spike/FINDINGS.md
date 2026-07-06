# Toolchain spike — findings

Track: `toolchain-spike_20260706`. Throwaway work; findings feed
`docs/implementation-plan.md` open-parameters. Assets live in `spike/assets/`
(gitignored). Source data: `~/temp/herculaneum/retexture_final/mvs`.

## Task 1.1 — tools & versions
| Tool | Version | Notes |
| --- | --- | --- |
| `gltfpack` | 1.2 | `npm i -g gltfpack`; on PATH at `/opt/homebrew/bin/gltfpack` |
| `ktx` | v5.0.0-rc1 | KTX-Software 4.4.2 pkg / v5 rc. **`toktx` is removed in v5** — use `ktx create` (encode) instead. |
| `mogrify` | ImageMagick 7.1.2-18 Q16-HDRI | pre-existing |
| `node` / `npm` | v26.4.0 / 11.17.0 | |

**Decision / hard requirement:** `toktx` is removed as of **KTX-Software v5.0.0**.
The pipeline **requires KTX-Software ≥ v5.0.0** and uses `ktx create` for KTX2
encoding — not `toktx`. This version floor must be recorded in `tech-stack.md`,
the Singularity def, and CI. (Verified against `ktx v5.0.0-rc1`.)

### Source band inventory (relevant)
- `2_center` (jpg tex) and `4_pgs_IR940` (jpg tex) — different geometry → mesh-swap path.
- `5_spectral_rgb` / `5_spectral_ir1050` (tif tex) — OBJs differ by exactly 3 bytes
  (the `mtllib` filename `rgb`→`ir1050`); geometry+UV identical → texture-only swap path.

## Task 1.2 — gltfpack decimation sweep (band `2_center`)
Geometry-only (stripped MTL, no `map_Kd`), meshopt `-cc`. Source:
**3,648,084 triangles / 10,944,252 verts**. Baseline `-cc` no-simplify glb = **8.2 MB**.
gltfpack encode ~3.3 s.

| `-si` ratio | out triangles | out verts | glb size |
| --- | --- | --- | --- |
| 1.0 (none) | 3,648,084 | 10,944,252 | 8.2 MB |
| 0.5 | 1,824,041 | 914,849 | 4.4 MB |
| 0.2 | 729,615 | 367,490 | 1.8 MB |
| 0.1 | 364,807 | 184,856 | 969 KB |
| 0.05 | 182,402 | 93,321 | 505 KB |
| 0.02 | 72,959 | 38,029 | 213 KB |

**Error bound not the limiter:** at every ratio the target was hit exactly; `-se 0.01`
never clamped, and re-running `-si 0.02` with a 10x tighter `-se 0.001` gave *identical*
output. The scan is dense/smooth enough to decimate ~50x before the 1% deviation cap
would engage. Decimation budget is a visual/measurement call, not a gltfpack-error call
(see Task 1.4). Meshopt `-cc` compresses well: 8.2 MB -> sub-MB by `-si 0.1`.

## Task 1.3 — texture normalize + KTX2 encode (band `5_spectral_rgb`)
Source `.tif`: **CIELab, 8/16-bit, 8176x6132** — exactly the exotic input `mogrify`
exists to fix (validates tech-stack "only correct color path").

1. **Normalize** (mogrify path): `magick <tif> -colorspace sRGB -depth 8 out.png`
   -> 8176x6132 sRGB 8-bit PNG, 64 MB, **~18.5 s**.
2. **Encode** `ktx create --format R8G8B8_SRGB --assign-tf srgb --generate-mipmap ...`:

| KTX2 mode | flags | size | mip levels | encode time |
| --- | --- | --- | --- | --- |
| ETC1S | `--encode basis-lz` | **5.8 MB** | 13 | ~32 s |
| UASTC | `--encode uastc --zstd 18` | **52.9 MB** | 13 | ~42 s |

Both `ktx validate` clean; full mip chain (8176 -> 1 = 13 levels). ETC1S is ~9x smaller
than UASTC+zstd; UASTC is the higher-quality/larger option.

**Notes for the pipeline:**
- Always pass `--assign-tf srgb` — without it ktx warns and guesses the transfer
  function from the 8-bit PNG.
- **Dimensions need NOT be multiples of 4.** Verified 1023x1021 encodes cleanly in
  both `basis-lz` and `uastc` (valid files, 10 mips) — ktx pads blocks internally, so
  no pre-crop/pad step is required for arbitrary source sizes.
- Pending decision (**KTX2 mode**): ETC1S vs UASTC is a quality/size trade to settle
  visually in Phase 2 against these `.ktx2` files.

## Task 1.4 — decimation deviation spot-check (band `2_center`)
pymeshlab (py3.11 venv) quadric-edge-collapse to target %, Hausdorff vs full-res source.
Bbox diagonal = **57.59 source units**; source = 3,648,084 faces.

| target | faces | Hausdorff max | rms | mean | max % of bbox | rms % |
| --- | --- | --- | --- | --- | --- | --- |
| 10% | 364,808 | 0.00718 | 0.00098 | 0.00068 | 0.0125% | 0.0017% |
| 5%  | 182,404 | 0.01296 | 0.00174 | 0.00124 | 0.0225% | 0.0030% |

Deviation is negligible — ~0.01–0.02% of the object extent even at 20x decimation, far
under gltfpack's 1% `-se` cap. **Caveat:** this uses pymeshlab's quadric decimator as a
*proxy* for meshoptimizer's simplifier (both quadric-error based, comparable order);
gltfpack's own `-se` guarantee corroborates. For cm-scale measurement, decimation error
is not the limiting factor.

**Decimation budget (proposed):** `-si 0.1` (10%) is a safe default — ~365k faces,
sub-MB meshopt glb, ~0.01% surface deviation. Revisit only if Phase 2 visual/measurement
says otherwise.

## Phase 1 verification
- `.glb` (geometry-only, meshopt `EXT_meshopt_compression`, glTF 2.0) produced at
  several ratios; `.ktx2` in both ETC1S and UASTC produced and **`ktx validate` clean**
  with full mip chains. Definitive "opens in a glTF inspector" = loading in three.js,
  done in Phase 2 (that page is the inspector).
