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
  component built on three.js that loads **one scene** (a single object's bands).
  It has no archive/per-object navigation — the host page handles browsing
  between objects. The old Voyager site keeps running until the back-catalog
  migrates.

Contract between them = the **per-object manifest**. An `index.json` listing is
optional (for a host to build its own archive UI); the widget doesn't need it.

---

## Workstream A — Pipeline (`dri-voyager-preppy`)

### A0. Dependencies
- **System (new)**: `toktx` (KTX-Software) and `gltfpack` (meshoptimizer).
  Keep `mogrify` (ImageMagick). Retire `obj2gltf` / `gltf-pipeline` from the new
  path. Add PATH/`.cmd` handling mirroring the existing `platform.system()`
  check. Optional: `pymeshlab` for Hausdorff validation.
- **Python**: keep `Pillow` (image inspection), `natsort`, `tqdm`.

### A1. Input config v2 (`templates/*.schema.json` rewrite)
A flat array of objects (no archive nav nesting — the widget doesn't browse
between objects). Each object declares its **geometry groups** (bands sharing
geometry). An optional top-level `{title, objects:[…]}` wrapper may remain purely
to shape an optional `index.json` listing, but it is not required.

```jsonc
[
  { "id": "PHerc1061Cr05", "title": "P.Herc. 1061, Cr. 5",
    "titles": {"en": "…"},                 // optional locale display titles
    "inventory": "P.Herc. 1061",
    "description": "…",                     // string or {locale: string}
    "credit": "(c) University of Kentucky…",
    "date": "2024-06-26",                   // capture date
    "groups": [                             // DECLARED geometry groups
      { "bands": [
        {"label": "Spectral RGB", "obj": "5_spectral_rgb.obj", "default": true},
        {"label": "IR 1050",      "obj": "5_spectral_ir1050.obj"} ] },
      { "bands": [ {"label": "Center",    "obj": "2_center.obj"} ] },
      { "bands": [ {"label": "PGS IR940", "obj": "4_pgs_IR940.obj"} ] }
    ] }
]
```

### A2. Module changes
- **`obj_helpers.py`** — add `geometry_fingerprint(obj)` → hash of the exact
  `vt` byte-block and `f` byte-block (+ counts) via mmap, for group verification.
  Keep `parse_materials`.
- **`texture.py`** *(new)* — `normalize(src) -> png` (mogrify: CIELab/16-bit →
  8-bit sRGB, resize `>8192`); `encode_ktx2(png, mode) -> ktx2` (toktx, mips,
  UASTC|ETC1S).
- **`geometry.py`** *(new)* — `obj_to_geometry_glb(obj, target_error) -> glb`
  (gltfpack: geometry-only, `-si` error-bounded simplify, `-cc` meshopt).
  **Generate normals** — source OBJs have `vn=0`; either bake here (Blender/
  MeshLab) or compute in the viewer (see V-notes). `validate(orig, decimated)`
  → Hausdorff (pymeshlab) against the deviation budget.
- **`manifest.py`** *(new, replaces `voyager.py`)* — build per-object manifest +
  `index.json` (with nav grouping).
- **`apps/file_prep.py`** — rewrite orchestrator (below).

### A3. Orchestration (per object)
For each declared geometry group:
1. Pick the first band's OBJ as the geometry source.
2. **Verify**: compare every other band's `geometry_fingerprint`. Match → one
   shared geometry `.glb`. Mismatch → **warn** and split the offending band into
   its own single-band geometry (fallback), so it still renders correctly.
3. Decimate + emit the geometry `.glb` once per resulting geometry.
4. For each band: normalize texture → `.ktx2`.
5. Assemble manifest entries (`geometries[]`, `bands[]` referencing geometry id).
Then emit the per-object manifest and append to `index.json`.

### A4. Manifest output
The per-object manifest is the widget's input. `index.json` is an **optional**
flat listing for host pages only.
```jsonc
// index.json (optional — host archive UI only)
{ "objects": [
    { "id":"PHerc1061Cr05", "title":"P.Herc. 1061, Cr. 5",
      "manifest":"PHerc1061Cr05.json", "thumb":"thumb/PHerc1061Cr05.jpg" } ] }

// PHerc1061Cr05.json  (the scene the widget loads)
{ "id":"PHerc1061Cr05", "title":"…", "inventory":"…", "description":"…",
  "credit":"…", "date":"…", "units":"cm",
  "geometries":[ {"id":"g0","uri":"geom/…_g0.glb"}, {"id":"g1","uri":"geom/…_g1.glb"} ],
  "bands":[ {"label":"Spectral RGB","geometry":"g0","texture":"tex/…_rgb.ktx2","default":true},
            {"label":"IR 1050","geometry":"g0","texture":"tex/…_ir1050.ktx2"},
            {"label":"Center","geometry":"g1","texture":"tex/…_center.ktx2"} ] }
```
Output layout: `out/index.json`, `out/<id>.json`, `out/geom/*.glb`,
`out/tex/*.ktx2`, `out/thumb/*.jpg`. URIs prefixed by `--uri` (as today).

### A5. Thumbnails
Derive from the default band's normalized texture (downscaled crop) via mogrify —
cheap, no offscreen GL. (Loose end: rendered 3D thumbs later.)

### A6. CLI
Keep console-script entry; add `--ktx2-mode {uastc,etc1s}`, `--decimate-error`,
`--no-decimate`, keep `--uri`, `--keep-tmp`. `merge_items` → `merge_index` later.

---

## Workstream B — Viewer (`<dri-viewer>` web component)

### B1. Stack
three.js + `GLTFLoader`, `MeshoptDecoder`, `KTX2Loader` (+ basis transcoder),
`OrbitControls`. Bundled (vite/esbuild) to one self-contained ESM/IIFE + the
transcoder wasm. No external CDN at runtime.

### B2. Component API
```html
<script type="module" src="dri-viewer.js"></script>
<dri-viewer manifest="…/PHerc1061Cr05.json" band="Spectral RGB"></dri-viewer>
```
Attrs: `manifest` (single-object manifest URL; inline JSON also allowed), `band`
(initial band, else the `default`), `ui` (chrome on/off). Sizing via CSS. Emits a
`band-change` event. One object per widget instance — no archive/object nav.

### B3. Load flow
Fetch manifest → load each geometry once (cache `BufferGeometry` by id;
**compute normals if absent**) → load band `.ktx2` textures (default first,
others lazily) → show default band.

### B4. Band switch — **camera never resets**
- Same geometry id → `mesh.material.map = tex; material.needsUpdate = true`.
- Different geometry id → swap the mesh (toggle preloaded meshes / swap
  `geometry`), leave `OrbitControls`/camera untouched.
- Memory: KTX2 stays GPU-compressed; small LRU of decoded textures; geometry
  cached by id. Confirm several 8K bands coexist on mid-range mobile.

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
  swap, measurement feel, and that 8K KTX2 bands don't OOM. Confirms the whole
  bet before building infra.
- **Phase 1 — Pipeline v2, single object.** Emit geometry `.glb` + `.ktx2` +
  manifest for the `mvs` set. Hand-write `index.json`.
- **Phase 2 — Viewer MVP.** Web component: load manifest, orbit, band swap (both
  cases), default lighting.
- **Phase 3 — Feature complete.** Measurement, thumbnails, optional `index.json`
  emission for host archive pages.
- **Phase 4 — Harden.** Decimation tolerance + Hausdorff gate, KTX2 mode choice,
  memory policy, a11y basics, docs (`README`, install of toktx/gltfpack).
- **Phase 5 — Later.** Migrate back-catalog (degenerate manifest); two-tier LOD
  if first-paint still hurts.

## Acceptance criteria
- Camera stays put across every band switch (same- and different-geometry).
- Several 8K bands swap without OOM on a mid-range phone.
- Measurement within tolerance of a known object dimension.
- Decimated mesh within the deviation budget (Hausdorff).
- Widget embeds with one `<script>` + one element, no runtime CDN.

## Tuning parameters — resolved by the Phase 0 spike (`toolchain-spike_20260706`)
See `spike/FINDINGS.md` for evidence. Go decision: **GO** on the pivot.

1. **Decimation budget:** `gltfpack -si 0.2` (≈20%). d20–d50 look good; **d10 loses too
   much** detail for measurement. Hausdorff at 20% is ~0.01% of bbox — negligible.
2. **KTX2 mode:** **ETC1S** (5.8 MB vs 53 MB UASTC; no visible quality difference on this
   material). Revisit per-band only if legibility needs it.
3. Thumbnail source: unchanged (texture crop for now).
4. **Normals:** **runtime `computeVertexNormals()`** in the viewer — computed vs baked were
   visually identical on these near-flat trays; no pipeline bake step needed.
5. **Band alignment:** bands **do** share a frame — registration works once the glTF node
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
   required for correct texturing, real-scale **measurement**, and multi-band **registration**.
9. **Atlas dilation (NEW pipeline step).** MVS atlases have an **orange "no-data" background**
   that bleeds into chart edges (worse via mipmaps) as a color tint. Add an atlas
   edge-dilation/inpaint step before KTX2 encoding (or have the MVS texturing emit dilated
   atlases).
10. **Units:** geometry is in **source units** (likely **mm** — confirm against a known
    dimension); measurement UI should label/convert accordingly.

### Still open (deliberately deferred)
- **File deliverables / on-disk layout & manifest schema** — to be settled in a dedicated
  conversation at the start of `delivery-pipeline_20260706`, **before** any implementation.
