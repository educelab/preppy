# Implementation Plan: custom viewer + delivery pipeline

Derived from the grilling session. Decisions and rationale live in
[ADR-0001](adr/0001-custom-threejs-viewer.md) and
[ADR-0002](adr/0002-meshopt-ktx2-delivery.md); vocabulary in
[../CONTEXT.md](../CONTEXT.md).

## Scope & repo boundaries

Two deliverables in two repos:

- **Pipeline** — this repo (`dri-voyager-preppy`). Turns source OBJs + textures
  into geometry `.glb` + `.ktx2` textures + a viewer-native manifest.
- **Viewer** — the `dri-voyager` repo (or a new package). A `<dri-viewer>` web
  component built on three.js that loads **one scene** (a single object's variants).
  It has no archive/per-object navigation — the host page handles browsing
  between objects. The old Voyager site keeps running until the back-catalog
  migrates.

Contract between them = the **per-object manifest**. An `index.json` listing is
optional (for a host to build its own archive UI); the widget doesn't need it.

---

## Workstream A — Pipeline (`dri-voyager-preppy`)

### A0. Dependencies
- **System (new)**: `ktx` (KTX-Software **≥ v5**, `ktx create`), `gltfpack`
  (meshoptimizer), and `gltf-transform` (Node, embeds KTX2 into the variant glb).
  Keep `mogrify` (ImageMagick). Retire `obj2gltf` / `gltf-pipeline` from the new
  path. Add PATH/`.cmd` handling mirroring the existing `platform.system()`
  check. Optional: `pymeshlab` for Hausdorff validation.
- **Python**: keep `Pillow` (image inspection), `natsort`, `tqdm`.

### A1. Input config v2 (`templates/*.schema.json` rewrite)
A flat array of objects (no archive nav nesting — the widget doesn't browse
between objects). Each object declares a flat `variants[]` (no geometry grouping,
ADR-0002 amended). An optional top-level `{title, objects:[…]}` wrapper may remain
purely to shape an optional `index.json` listing, but it is not required.

```jsonc
[
  { "id": "PHerc1061Cr05",
    "prefix": "PHerc1061Cr05",              // optional; defaults to id. Names the output folder + file prefix
    "title": "P.Herc. 1061, Cr. 5",
    "titles": {"en": "…"},                  // optional locale display titles
    "inventory": "P.Herc. 1061",
    "description": "…",                     // string or {locale: string}
    "credit": "(c) University of Kentucky…",
    "date": "2024-06-26",                   // capture date
    "units": "cm",
    "nodataFill": "#FF7F00",                // optional; atlas no-data fill to dilate over (object default)
    "variants": [                           // flat; each = one mesh + its texture(s)
      { "suffix": "rgb",    "label": "Spectral RGB", "obj": "5_spectral_rgb.obj",    "default": true,
        "nodataFill": null },               // per-variant override (this one has no padding)
      { "suffix": "ir1050", "label": "IR 1050",      "obj": "5_spectral_ir1050.obj" },
      { "suffix": "center", "label": "Center",       "obj": "2_center.obj" },
      { "suffix": "pgs",    "label": "PGS IR940",    "obj": "4_pgs_IR940.obj",
        "credit": "…", "date": "…" }        // optional per-variant provenance overrides
    ] }
]
```
- **`suffix`** is the stable variant key: it names the file and is the manifest
  variant `id` (deep-link / selection key); `label` is display-only.
- **Texture(s)** are resolved transitively from each `obj`'s `map_Kd` (one or
  many); an optional `texture` field overrides. No texture in config normally.
- Optional per-variant overrides: `credit`, `date`, `method`, `description`,
  `nodataFill`, `texture`.

### A2. Module changes
- **`obj_helpers.py`** — keep `parse_materials` (mtllib → `map_Kd`). (No
  geometry fingerprinting — shared-geometry grouping is dropped, ADR-0002.)
- **`texture.py`** *(new)* — `normalize(src, nodata_fill=None) -> png` (mogrify:
  CIELab/16-bit → 8-bit sRGB, resize `>8192`, and if `nodata_fill` set,
  edge-dilate chart content over the masked fill); `encode_ktx2(png, mode) ->
  ktx2` (`ktx create`, mips, ETC1S|UASTC; **KTX ≥ v5**).
- **`geometry.py`** *(new)* — `obj_to_geometry_glb(obj, target_error) -> glb`
  (gltfpack: geometry + UV, `-si` error-bounded simplify, `-cc` meshopt; keep UVs
  "used" so the atlas isn't corrupted). **Normals are computed in the viewer**
  (`computeVertexNormals()`), not baked. `validate(orig, decimated)` → Hausdorff
  (pymeshlab) against the deviation budget.
- **`assemble.py`** *(new)* — `embed(geom_glb, ktx2) -> variant_glb` via
  **gltf-transform**: embed the KTX2 as `KHR_texture_basisu`, preserving meshopt +
  `KHR_texture_transform`. Produces the one self-contained glb per variant.
- **`manifest.py`** *(new, replaces `voyager.py`)* — build per-object manifest
  (flat `variants[]`) + optional `index.json`.
- **`apps/file_prep.py`** — rewrite orchestrator (below).

### A3. Orchestration (per object)
For each **variant** (independently — no grouping/verification). A variant's OBJ
may reference **one or more** `map_Kd` textures (multi-chart / atlas-split UV,
e.g. `material_00`, `material_01`); resolve them all transitively via
`parse_materials`:
1. For **each** of the variant's textures: normalize → png (mogrify; dilate
   no-data if `nodataFill` resolves) → encode `.ktx2` (`ktx create`).
2. gltfpack its OBJ → decimated meshopt geometry glb, one primitive per material,
   UVs kept "used".
3. gltf-transform: embed **all** the variant's `.ktx2` (one per material) →
   **one self-contained variant glb**.
4. Hausdorff-validate the decimation against the budget.
Then emit the per-object manifest (flat `variants[]`) + append to optional
`index.json`. Texture count is internal to the glb; the manifest is unchanged.

> **Validation-first (spike gap):** the toolchain spike only exercised
> *single-material* OBJs. The multi-material path (multiple textures → multiple
> primitives → embed) is glTF-native but unvalidated through gltfpack decimation +
> `KHR_texture_transform` + gltf-transform embed. Given how many subtle issues the
> single-texture path surfaced, **validate one real multi-material `mvs` OBJ
> end-to-end before building the batch pipeline.**

### A4. Manifest output
The per-object manifest is the widget's input. `index.json` is an **optional**
flat listing for host pages only.
```jsonc
// index.json (optional — host archive UI only)
{ "objects": [
    { "id":"PHerc1061Cr05", "title":"P.Herc. 1061, Cr. 5",
      "manifest":"PHerc1061Cr05/manifest.json",
      "thumb":"PHerc1061Cr05/PHerc1061Cr05_thumb.jpg" } ] }

// PHerc1061Cr05.json  (the scene the widget loads)  — see ADR-0002 (amended)
{ "id":"PHerc1061Cr05", "title":"…", "inventory":"…", "description":"…",
  "credit":"…", "date":"…", "units":"cm",
  "variants":[
    { "id":"rgb",    "label":"Spectral RGB", "uri":"PHerc1061Cr05_rgb.glb", "default":true }, // self-contained glb
    { "id":"ir1050", "label":"IR 1050",      "uri":"PHerc1061Cr05_ir1050.glb" },              // (meshopt geom + embedded KTX2)
    { "id":"center", "label":"Center",       "uri":"PHerc1061Cr05_center.glb",
      "credit":"…", "date":"…", "method":"…" } ] }                  // optional per-variant overrides
```
Each variant is **one self-contained glb** (no separate `geometries[]`/`tex/`).
`index.json` is optional (host archive UI only).

**Output naming/layout (settled):** per-object directory named by `prefix`;
variant files are **`<prefix>_<suffix>.glb`** (self-identifying, so a glb still
makes sense shared outside the deployment); manifest URIs are relative:
```
out/
  index.json
  PHerc1061Cr05/                       # = prefix (defaults to id)
    manifest.json                      # variants[].uri = "PHerc1061Cr05_rgb.glb"
    PHerc1061Cr05_rgb.glb
    PHerc1061Cr05_ir1050.glb  …
    PHerc1061Cr05_thumb.jpg
```
`prefix` and `suffix` must be URL-safe; case is preserved as authored. `--uri`
prefix retained for absolute-URL hosts.

**Cache-busting** (ADR-0002): global `--hash-names` (**default on**) inserts an
8-hex content hash → `PHerc1061Cr05_rgb.1a2b3c4d.glb`. The hash is over
**inputs + config + tool versions**, not the output glb (basis encoding is
non-deterministic). Hashed assets → `immutable`; `manifest.json`/`index.json`
stay stable-named and revalidated (they carry the current hashed `uri`s), so
hashing is transparent to the widget and deep-links (stable variant `id`) survive
rebuilds. `--no-hash-names` → plain names, assets *not* `immutable`. `--prune`
drops unreferenced hashed files.

### A5. Thumbnails
Derive from the default variant's normalized texture (downscaled crop) via
mogrify — cheap, no offscreen GL. (Loose end: rendered 3D thumbs later.)

### A6. CLI
Keep console-script entry; add `--ktx2-mode {uastc,etc1s}`, `--decimate-error`,
`--no-decimate`, keep `--uri`, `--keep-tmp`. `merge_items` keeps its name (no
rename to `merge_index`); it gained the output-directory merge alongside the
legacy `items.json` one.

---

## Workstream B — Viewer (`<dri-viewer>` web component)

### B1. Stack
three.js + `GLTFLoader`, `MeshoptDecoder`, `KTX2Loader` (+ basis transcoder),
`OrbitControls`. Bundled (vite/esbuild) to one self-contained ESM/IIFE + the
transcoder wasm. No external CDN at runtime.

### B2. Component API
```html
<script type="module" src="dri-viewer.js"></script>
<dri-viewer manifest="…/PHerc1061Cr05.json" variant="rgb"></dri-viewer>
```
Attrs: `manifest` (single-object manifest URL; inline JSON also allowed), `variant`
(initial variant **by `id`**, else the `default`), `ui` (chrome on/off). Sizing via
CSS. Emits a `variant-change` event carrying the variant `id`. One object per widget
instance — no archive/object nav. (Selecting by stable `id`, not display label, is
what makes deep-links like `?object=…&variant=ir1050` durable across relabeling.)

### B3. Load flow
Fetch manifest → load each geometry once (cache `BufferGeometry` by id;
**compute normals if absent**) → load variant `.ktx2` textures (default first,
others lazily) → show default variant.

### B4. Variant switch — **camera never resets**
- Same geometry id → `mesh.material.map = tex; material.needsUpdate = true`.
- Different geometry id → swap the mesh (toggle preloaded meshes / swap
  `geometry`), leave `OrbitControls`/camera untouched.
- Memory: KTX2 stays GPU-compressed; small LRU of decoded textures; geometry
  cached by id. Confirm several 8K variants coexist on mid-range mobile.

### B5. Measurement
Click two surface points → raycast → world distance in **cm** (manifest units).
Render line + label; optional scale bar.

### B6. Lighting
Hemisphere ambient + directional key light with sensible defaults; wire an
azimuth/elevation "raking light" control (default-only acceptable at first) for
reading ink.

### B7. Hosting / embedding
Assets on the existing host; long-max-age cache headers (content-hashed names)
so shared geometry dedupes and revisits are instant. CORS for cross-site embeds.

---

## Sequencing

- **Phase 0 — Spike (de-risk).** On the `mvs` example: gltfpack-decimate one OBJ,
  toktx one texture, load in a throwaway three.js page. Verify camera-preserving
  swap, measurement feel, and that 8K KTX2 variants don't OOM. Confirms the whole
  bet before building infra.
- **Phase 1 — Pipeline v2, single object.** Emit geometry `.glb` + `.ktx2` +
  manifest for the `mvs` set. Hand-write `index.json`.
- **Phase 2 — Viewer MVP.** Web component: load manifest, orbit, variant swap (both
  cases), default lighting.
- **Phase 3 — Feature complete.** Measurement, thumbnails, optional `index.json`
  emission for host archive pages.
- **Phase 4 — Harden.** Decimation tolerance + Hausdorff gate, KTX2 mode choice,
  memory policy, a11y basics, docs (`README`, install of ktx/gltfpack/gltf-transform).
  Cache-busting retention policy (keep-last-N) + host header example (`.htaccess`
  when the target host is known — must revalidate the manifest; hashed assets can
  be long-cached).
- **Phase 5 — Later.** Migrate back-catalog (degenerate manifest); two-tier LOD
  if first-paint still hurts.

## Acceptance criteria
- Camera stays put across every variant switch (same- and different-geometry).
- Several 8K variants swap without OOM on a mid-range phone.
- Measurement within tolerance of a known object dimension.
- Decimated mesh within the deviation budget (Hausdorff).
- Widget embeds with one `<script>` + one element, no runtime CDN.

## Tuning parameters — resolved by the Phase 0 spike (`toolchain-spike_20260706`)
See `spike/FINDINGS.md` for evidence. Go decision: **GO** on the pivot.

1. **Decimation budget:** `gltfpack -si 0.2` (≈20%). d20–d50 look good; **d10 loses too
   much** detail for measurement. Hausdorff at 20% is ~0.01% of bbox — negligible.
2. **KTX2 mode:** **ETC1S** (5.8 MB vs 53 MB UASTC; no visible quality difference on this
   material) — the default `--ktx2-mode` (batch-wide). The spike's *per-variant* UASTC
   override was **deferred** (Task 1.2): no shipping variant needs UASTC and the size cost
   is ~9×. Promote to its own task if a hero/detail variant later needs it.
3. Thumbnail source: unchanged (texture crop for now).
4. **Normals:** the **pipeline bakes** area-weighted smooth normals from the un-quantized
   source (Phase 7) — the spike's "runtime `computeVertexNormals()`" faceted on gltfpack's
   quantized position grid once real delivery builds quantized positions. Policy (Task 1.7):
   bake **only when the source lacks `vn`**; pass source normals through when present (they
   are computed on pristine geometry and may encode creases). `--force-smooth-normals`
   rebakes anyway; `--no-smooth-normals` defers to the viewer. The viewer's
   `computeVertexNormals()` is now a fallback for normalless/legacy glbs only.
5. **Variant alignment:** variants **do** share a frame — registration works once the glTF node
   transform is applied (see #8).

### New hard requirements the spike surfaced (must design into the pipeline/viewer)
6. **KTX-Software ≥ v5.0.0.** `toktx` is removed in v5 — use **`ktx create`** (all `toktx`
   references in this doc/§Tech-stack/Singularity/CI must change to `ktx create`).
7. **Geometry glb must keep UVs "used."** These are MVS atlas meshes with per-wedge UVs;
   if gltfpack sees no texture it welds seam vertices and scrambles the atlas. Feed gltfpack
   an MTL with a **1×1 placeholder `map_Kd`**; the viewer overrides `material.map` with the
   real KTX2. (This also makes `-si` decimation UV-safe.)
8. **Viewer must preserve gltfpack's `KHR_texture_transform` AND the node transform.**
   gltfpack packs UVs into a sub-range (emits `KHR_texture_transform` on the material) and
   stores POSITION dequant on the **node TRS** (quantized `UNSIGNED_SHORT` buffer). The
   viewer must (a) carry the material's UV transform onto swapped-in KTX2 textures, and
   (b) apply the node transform to the **mesh** (never bake into the quantized buffer) —
   required for correct texturing, real-scale **measurement**, and multi-variant **registration**.
9. **Atlas dilation + no-data fill color (NEW pipeline step).** MVS atlases have a
   saturated **orange no-data/seam fill** that bleeds into chart edges via mipmaps as
   yellow-gray splotches. Content itself is neutral (measured 62,62,62), so the tint is the
   fill's *chroma*. Guidance, best→simplest:
   - **(a) Edge-dilate the atlas before KTX2 encoding** — fill each chart's gutter with its
     own neighboring pixels (alpha-weighted spread off a hue/saturation no-data mask). Fixes
     both chroma and luminance halos; independent of fill color. This is the standard
     texture-atlas "gutter/padding" step and the recommended fix.
   - **(b) Keep a distinctive, easily-maskable sentinel fill in the *source*** (orange/magenta
     is fine — trivially detected by hue/saturation) **and dilate over it in the pipeline.**
     Best of both: reliable no-data detection + clean rendering.
   - **(c) If no dilation step:** set the MVS tool's fill to a **neutral gray** (R=G=B, near
     content mean, e.g. `#808080`). Removes the yellow chroma; mild luminance halos remain at
     high-contrast chart edges. **Never** ship a saturated fill without dilation.
   - Also test **linear-space mipmap generation** (reduces edge haloing); dilation is the
     primary fix.
10. **Units:** geometry is in **cm** (confirmed against a known tray dimension;
    bbox diagonal ≈ 57.6 cm). Manifest `units:"cm"`; measurement UI reports cm.

### Still open (deliberately deferred)
- **File deliverables / on-disk layout & manifest schema** — to be settled in a dedicated
  conversation at the start of `delivery-pipeline_20260706`, **before** any implementation.
