# Phase 0 — multi-material validation findings

Validated the full delivery path end-to-end on a real **multi-material** `mvs`
OBJ before building the batch pipeline (spec risk #1). Confirmed GO for the
multi-material case; below are the decisions Phases 2–3 must bake in.

## Test asset
`~/temp/pgs-test/recon/mvs/20260708125109_AvignonHotelDesMonnaies.obj`
- 170,002 v / 338,476 f / 1,015,428 vt; 3 materials, each a 4096² sRGB JPEG.
- MTL lists materials **out of numeric order**: `material_00, material_02,
  material_01` — deliberately exercises the index-vs-name risk below.

## Chain executed (the intended production path)
1. `magick <jpg> -colorspace sRGB -depth 8 mat_NN.png` (mogrify normalize).
2. `ktx create --format R8G8B8_SRGB --assign-tf srgb --encode basis-lz
   --generate-mipmap` → ETC1S KTX2 + mips; `ktx validate` clean.
3. `gltfpack -i obj -o geom.glb -si 0.2 -cc` — textures kept so UVs stay "used"
   (spike rule); 338,476 → 67,691 tris; 3 primitives; emits
   `KHR_mesh_quantization` + `EXT_meshopt_compression` + `KHR_texture_transform`.
4. gltf-transform embed: replace each material's baseColorTexture with the
   matching KTX2, **matched by material name**; write with meshopt re-encoded.
Result: one self-contained `variant.glb` (6.1 MB), all four extensions intact,
renders coherently (operator-confirmed).

## Findings / decisions for the batch pipeline

### F1 — Match KTX2 → material by NAME, never by index (HIGH)
gltfpack's material array follows MTL declaration order, which is not numeric
order (`[00, 02, 01]` here). Index-based embedding would swap textures across
regions (material-level atlas scramble). `parse_materials` already keys by
material name — carry that name through normalize → encode → embed and match on
it in `assemble.embed()`.

### F2 — `Tr 1.0` opacity ambiguity → invisible mesh (being fixed upstream)
OpenMVS writes `Tr 1.000000` meaning opaque, but that's the `d`-convention value
on the `Tr` keyword (MTL: `d` 1.0 = opaque; `Tr` 1.0 = fully transparent,
`Tr = 1 − d`). gltfpack applies the literal spec → `baseColorFactor.a = 0` +
`alphaMode = BLEND` → mesh renders fully invisible.
- **Primary fix: upstream in the MVS pipeline** (operator decision) — MVS will
  emit correct opacity, so the OBJ won't carry the ambiguous `Tr`.
- **Pipeline safety net (optional):** `assemble` can force `alphaMode = OPAQUE`
  (spec: OPAQUE ignores the alpha channel) + reset `baseColorFactor.a = 1` for
  textured photogrammetry materials. Cheap insurance against older/other inputs;
  make it a defensive default, not a hard requirement.

### F3 — Embed preserves meshopt only if the encoder is registered (MED)
Reading a meshopt/quantized glb into gltf-transform and writing it back **drops
`EXT_meshopt_compression`** unless `MeshoptEncoder` is registered as a writer
dependency (`registerDependencies({'meshopt.encoder': MeshoptEncoder})`) — spec
risk #2. With it wired, all four extensions survive the embed. `assemble.py`
must register the encoder (or shell to a Node helper that does).

### F4 — nodata / empty-value bleed is real on this data (KNOWN)
Visible fill bleed at chart edges, as anticipated. Handled by the operator-
supplied `nodataFill` dilation input (`texture.normalize(nodata_fill=...)`); not
a blocker. No dilation was applied in this validation run.

### F5 — scale
This test mesh is **unscaled**, so the ~2.9-unit bbox diagonal is not real-world
truth here. Real assets carry cm scale (spike: `units:"cm"`). No pipeline action;
noted so the bbox number isn't mistaken for a scale bug.

## Reproduction
Scratchpad: `scratchpad/phase0/` — `embed.mjs` (name-matched embed + OPAQUE
fix + meshopt re-encode), `index.html` (three.js check), `alpha.mjs` (material
inspector). Throwaway; not committed.
