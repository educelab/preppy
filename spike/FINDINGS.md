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

## Phase 2 — viewer spike (three.js)  [code complete; visual verification pending]
Throwaway page: `spike/index.html` (single file; import-map to pinned three@0.169.0 +
addons + basis transcoder — throwaway convenience, *not* the production no-CDN rule).
Serve: `python3 -m http.server 8777 --directory spike` → http://127.0.0.1:8777/

Loaders wired: `GLTFLoader` + `MeshoptDecoder` + `KTX2Loader`(basis) + `OrbitControls`.
Assets (gitignored, in `spike/assets/`):
- geometry-only meshopt glbs w/ UVs: `5_spectral.glb`, `2_center.glb`, `4_pgs.glb`,
  and `5_spectral_baked.glb` (with baked NORMALs).
- KTX2: band 5 rgb & ir1050 (ETC1S+UASTC), band 2 & 4 (ETC1S), all 8K, mipmapped.

**Per-wedge UV finding (Task 2.2).** gltfpack's *input* count was 3× triangles
(10,944,252 verts / 3,648,084 tris) — the signature of per-wedge (unshared) UVs.
gltfpack welds by (pos,uv), but UV-seam vertices stay split, so runtime
`computeVertexNormals()` breaks the shading across every UV island. **Baking** smooth
normals *before* the split (MeshLab `compute_normal_per_vertex` on the position-welded
mesh → carried through gltfpack via `-kv`) gives both sides of a seam the same normal,
so seams disappear. The page's "Normals A/B" buttons load computed vs baked for direct
comparison. **RESOLVED (viewer session):** computed and baked look *identical* on these
near-flat trays, so the seam risk did not materialize — **use runtime
`computeVertexNormals()`, no pipeline bake step.** (Revisit only if a future object has
strong curvature across UV seams.)

### ⚠ CRITICAL FINDING — geometry-only glb corrupts atlas UVs unless UVs stay "used"
First viewer render showed **scrambled textures at every decimation level, including
full-res** (shuffled atlas patches). Isolation via unlit reference loads:
- `obj2gltf` glb (proven pipeline, no gltfpack): **coherent**.
- gltfpack + meshopt glb *with the texture still referenced*: **coherent**.
- gltfpack geometry-only glb (stripped material, `-kv`): **scrambled**.

**Mechanism.** These MVS meshes have per-wedge UVs — two vertices share a position
but carry different UVs at every atlas-chart seam. When the material has no texture,
gltfpack treats TEXCOORD_0 as *unused*, so it welds those seam vertices by position and
keeps one arbitrary UV, shuffling the atlas. `-kv` keeps the attribute data but does
**not** prevent the bad weld. When a texture is referenced, UVs become a weld key, seam
vertices stay split, and the mapping is preserved — and gltfpack's `-si` decimation then
respects UV seams too.

**Pipeline rule (decision):** the geometry glb **must keep UVs "used."** Cheapest way:
reference a 1×1 placeholder `map_Kd` in the MTL fed to gltfpack (embeds a few bytes); the
viewer overrides `material.map` with the real KTX2 band at runtime. This one change fixes
both the scramble and makes gltfpack decimation UV-safe. (Fix applied to all spike glbs.)

### ⚠ CRITICAL FINDING #2 — gltfpack UV quantization emits KHR_texture_transform
Even with UVs preserved, a fresh material still scrambled while the glb's own material was
fine. Cause: gltfpack packs UVs into a sub-range as normalized `UNSIGNED_SHORT` and emits a
**`KHR_texture_transform`** on the material (band 5 `scale≈[14.06,14.38]`, band 2
`scale≈[15.99,4.80]`) to rescale them. A viewer that builds its own material / swaps
`material.map` **must carry that transform onto the swapped-in texture** (three.js:
copy `.offset/.repeat/.rotation/.center` from the glb's map). **CONFIRMED FIXED** — copying
the transform onto the KTX2 makes all bands render coherently.

**Pipeline rule (decision):** the production `<dri-viewer>` must, when swapping KTX2 bands,
preserve the geometry material's `KHR_texture_transform` (don't discard the loaded material).
Alternative: encode geometry with `gltfpack -vtf` (float UVs, no quantization → no transform)
at the cost of larger geometry buffers. **Recommend honoring the transform** (keep the
compression win); the viewer swap must reuse the loaded material or replicate its UV transform.

### ⚠ CRITICAL FINDING #3 — gltfpack stores POSITION dequant on the NODE transform
gltfpack (KHR_mesh_quantization) stores positions as `UNSIGNED_SHORT` and puts the
dequant **scale + translation on the node TRS** (band 2: `scale≈0.00284`, `translation≈
[-23.1,-15.9,-0.79]`). Extracting bare geometry and dropping the node transform caused
two bugs: (a) **measurements in quantized units** (~4000 instead of ~11 real units), and
(b) **bands not registering** (each missing its own translation). Fix: bake the node's
world matrix. **Do NOT bake into the quantized buffer** — `applyMatrix4` on the
`UNSIGNED_SHORT` position array truncates and collapses the mesh (v7 bug). Correct fix:
apply the node matrix to the **mesh transform** (`mesh.applyMatrix4(node.matrixWorld)`),
leaving the geometry buffer intact. **CONFIRMED in v8:** topology intact, measurement
reads real scale, bands register.

**Pipeline/viewer rule:** measurement + multi-band overlay require the node transform on
the mesh (keep the loaded node hierarchy; never bake into the quantized position buffer).

### Observed decisions from the viewer session (user)
- **Decimation budget:** `-si 0.2` (20%) — d20–d50 look acceptable, **d10 loses too much**
  detail for measurement. (Earlier 10% proposal revised up.)
- **Normals:** computed == baked, **both fine** → runtime `computeVertexNormals()` is
  sufficient; **no pipeline normal-bake step needed** (simplifies the pipeline; the
  per-wedge seam risk did not manifest visibly on these near-flat trays).
- **KTX2 mode:** **ETC1S** — no visible quality difference vs UASTC; use ETC1S (9× smaller).
- **Atlas "no-data" padding bleed (NEW):** band 2's source atlas has an **orange no-data
  background**; it bleeds into chart edges (worse via mipmaps) as a yellow tint. Confirmed
  it is *not* the downscale and *not* ETC1S (decoded KTX2 == source). **Pipeline must
  dilate/pad atlas charts** (edge-extend into the no-data region) before KTX2 encoding, or
  have the MVS texturing step emit dilated atlases.
- **Units:** distances are in **source units**; likely **mm** (user to confirm externally).

### Phase 2 verification — CONFIRMED (viewer session, BUILD v8)
- 2.1 GLTFLoader + MeshoptDecoder + KTX2Loader + OrbitControls render the decimated
  geometry with a KTX2 texture. ✓ (once findings #1–#3 fixed)
- 2.2 lit surface not black; computed == baked. ✓
- 2.3 texture-only (5 RGB⇄IR1050) and mesh-swap (2⇄4) both coherent; camera preserved;
  bands register in the shared frame. ✓
- 2.4 all bands loaded at real positions; no OOM / context-loss. ✓
- 2.5 two-click raycast distance reads a plausible real-scale value. ✓

## Go / No-Go
**GO.** The pivot (gltfpack meshopt geometry + KTX2 textures + three.js viewer) is viable
on real `mvs` data: camera-preserving band switching (both same-geometry and mesh-swap),
multiple 8K KTX2 bands resident without OOM, and feasible raycast measurement — **provided
the pipeline/viewer honor the hard requirements the spike surfaced** (KTX≥5, UVs-used
placeholder, `KHR_texture_transform`, node transform on the mesh, atlas dilation). These
are recorded in `docs/implementation-plan.md` §Tuning parameters.

**Deferred:** on-disk file deliverables + manifest schema — to be decided in a dedicated
conversation at the start of `delivery-pipeline_20260706`, before implementation.
