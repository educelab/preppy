# Implementation Plan: `<dri-viewer>` web component

**Track ID:** viewer-widget_20260706
**Spec:** [spec.md](./spec.md)
**Created:** 2026-07-06
**Status:** [~] Reopened 2026-07-10 for post-delivery feedback (Phases 5–10); Phases 1–4 complete 2026-07-09

## Overview
Scaffold the TS/bundler/web-component skeleton, get one variant rendering, then
land the camera-preserving variant switch (the crux), then measurement + lighting
+ embedding. Develop against a hand-authored manifest + the spike glbs until the
pipeline produces real assets. Each variant is its own self-contained glb.

## Phase 1: Scaffolding & stack (B1)
### Tasks
- [x] Task 1.1: TS project + bundler (Vite/esbuild) in `dri-voyager`; output one
      self-contained ESM/IIFE + transcoder wasm, no runtime CDN.
- [x] Task 1.2: `<dri-viewer>` custom-element skeleton with
      `manifest`/`variant`/`ui` attributes and a `variant-change` event (carrying
      the variant `id`); CSS sizing.
- [x] Task 1.3: Wire GLTFLoader + MeshoptDecoder + KTX2Loader + OrbitControls.
### Verification
- [x] Empty widget mounts, sizes via CSS, and initializes the renderer.
      (unit-tested in happy-dom; real-WebGL renderer init verified headless via
      Playwright/Chromium — e2e/phase1.spec.ts.)

## Phase 2: Load & render one variant (B2, B3, B6 defaults)
### Tasks
- [x] Task 2.1: Fetch manifest (URL or inline); load the default variant's glb
      (GLTFLoader handles embedded KTX2 + `KHR_texture_transform`); compute
      normals (`computeVertexNormals()`); apply the node transform to the mesh
      (real cm scale).
- [x] Task 2.2: Show the default variant; orbit/zoom/pan; frame on load.
- [x] Task 2.3: Default light rig (hemisphere ambient + directional key).
### Verification
- [x] A real per-object manifest (PHerc1428Cr04) renders correctly lit, camera
      framed, texture coherent — verified headless (e2e/phase2.spec.ts) + screenshot.

## Phase 3: Camera-preserving variant switch (B4)
### Tasks
- [x] Task 3.1: Variant switch — load/show the target variant's glb, add to scene,
      remove the previous; **never touch camera/controls**. Select by variant `id`.
- [x] Task 3.2: Memory/preload policy — cache loaded variant glbs; KTX2 stays GPU
      compressed; optional LRU if many large variants; preload others after default.
- [x] Task 3.3: Automated check asserting camera state is identical across a switch.
### Verification
- [x] Variant switch preserves the camera (numeric + visual, e2e/phase3.spec.ts);
      all 4 real 8K KTX2 variants coexist resident without OOM / context loss.

## Phase 4: Measurement, raking light, embedding (B5, B6, B7)
### Tasks
- [x] Task 4.1: Two-point raycast measurement → distance in **cm**; line + label;
      optional scale bar.
- [x] Task 4.2: Raking-light azimuth/elevation control (good default).
- [x] Task 4.3: Packaging + embed docs; CORS/cache-header guidance (assets are
      `immutable` when hashed; revalidate the manifest).
### Verification
- [x] Measurement returns a real cm distance (24.36 cm on PHerc1428Cr04, e2e); raking
      slider drives light elevation; built-in controls render and ui="none" hides them.
- [x] Built bundle embeds with one script + one element on a static host page
      (e2e/embed.spec.ts); transcoder loads from sibling dist/basis/ (no CDN).

## Final Verification
- [x] All acceptance criteria met (spec.md): scene loads + orbit/zoom/pan +
      variant-change; camera-preserving switch; multiple 8K KTX2 variants without OOM;
      two-point cm measurement; default lighting + raking control; one-script embed.
- [x] Camera-preservation and measurement checks passing (e2e/phase3, phase4).
- [x] Embed + asset-hosting docs written (README.md, examples/embed.html).
- [x] Ready for review. Suites: typecheck clean, 19 unit + 8 e2e green.

---

# Post-delivery feedback (2026-07-10)

Reopened after a live dev-server review. Each item below is a self-contained
phase; findings are recorded inline so a phase can be picked up in fresh context
without re-deriving. Dev host: `npm run dev` in `viewer/`, fixtures under
`viewer/public/fixtures/` (NOT `dist/`); drive via
`/?manifest=/fixtures/PHerc1428Cr04/manifest.json&variant=<id>`. Verify with the
headless Playwright/SwiftShader harness (see `e2e/`).

## Phase 5: Blank-render race + measurement UX (feedback #6, #7) — COMPLETE
### Tasks
- [x] Task 5.1: Fix blank render when `manifest` + `variant` are set in the same
      tick (reload() invalidated #manifest; variant handler defers until a manifest
      is loaded). Commit 813cac5.
- [x] Task 5.2: Measurement persists after leaving measure mode; explicit "Clear"
      button (shown only when a measurement exists); a 3rd pick still starts fresh.
- [x] Task 5.3: Markers rescale per-frame to a constant ~5px on-screen radius
      (was a fixed world radius that ballooned when zoomed in). Commit 7cd41ce.
### Verification
- [x] Headless: 2 picks → "24.78 cm"; persists + Clear works after disable;
      markers stay small when zoomed. typecheck clean, 26 unit + phase1–4 e2e green.

## Phase 6: Pan as a first-class tool (feedback #2) — COMPLETE
### Tasks
- [x] Task 6.1: Pan (hand) toggle in the controls, mutually exclusive with Measure.
      Pan mode swaps OrbitControls left-drag to PAN
      (`controls.mouseButtons.LEFT = MOUSE.PAN`), restoring ROTATE when off. Exposes
      `setPanMode(on)`/`panning` on `<dri-viewer>` + `Viewer.setPanMode`. Right-drag
      still pans in both modes.
- [x] Task 6.2: Cursor affordance (grab/grabbing) via a `data-panning` stage attr,
      mirroring the `data-measuring` crosshair.
### Verification
- [x] Headless: orbit mode targetΔ=0 (rotates); pan mode targetΔ=7.7 (pans); pan⇔
      measure mutually exclusive. typecheck clean, 27 unit + 7 e2e green.

## Phase 7: Smooth-shaded normals (feedback #4) — pipeline — COMPLETE
Finding: geometry is well-indexed (404k verts / 729k tris) but ships **no
normals**; the viewer runs `computeVertexNormals()`. gltfpack quantizes positions
(`KHR_mesh_quantization`), so computing normals from the quantized grid amplifies
into high-frequency normal jitter → jagged shading under raking light.
### Tasks
- [x] Task 7.1: Compute smooth vertex normals in the pipeline from the **un-quantized**
      OBJ mesh (before gltfpack quantization) and bake them; let gltfpack octahedral-
      quantize the normals (small size cost). Options: compute in a pre-pass and feed
      gltfpack a normal-bearing mesh, or a gltf-transform normal pass. Reverses the
      current "normals computed in the viewer" choice — update `geometry.py` docstring,
      CLAUDE.md, and the viewer's `loadModel` (skip compute when normals present).
- [~] Task 7.2: Regenerate the PHerc1428Cr04 fixture (all variants) → copy to
      `viewer/public/fixtures/`.
### Verification
- [x] Delivered glb has a NORMAL attribute; viewer shows smooth shading under a
      grazing raking light (headless screenshot before/after). Geometry byte size
      delta noted. Verified: NORMAL (octahedral BYTE) on all 4 variants + TEXCOORD_0;
      getRenderStats().hasNormals=true; ~+1 MB/variant; 9/9 e2e + 97/97 pipeline green;
      user-confirmed smooth under grazing light in the running viewer (2026-07-10).

## Phase 8: PGS nodataFill orange-fringe fix (feedback #1) — pipeline — COMPLETE
Finding (confirmed w/ repro): PGS = `2_center.jpg`, a 32768² grayscale atlas with
`nodataFill: #ff7f25` covering ~2/3 of the image. `normalize()` resizes to 8192
**before** `fill_nodata()`, so the 4× downscale blends orange into UV-island edges;
`fill_nodata` (fuzz 0.05) then back-fills the background *from those orange-tinted
edge pixels*. Repro: 0% pure orange remains but ~30% is orange-tinted; bright
orange fringes rim every island → orange specks on the surface.

**Not a defect — PGS is meant to be grayscale.** Confirmed with the user: PGS
(`2_center.jpg`) is a genuinely grayscale band that the upstream MVS pipeline
re-encoded as 3-channel RGB (32768² sRGB). So the flat/grey appearance is correct
data, not a pipeline washout — do NOT try to "restore color." Only the orange
nodataFill fringes (Task 8.1) are the bug. (Optional future nicety: collapse such
grayscale-as-RGB textures to single-channel before KTX2 to save size — out of scope
here.)
### Tasks
- [x] Task 8.1: Make the downscale nodata-aware so orange never blends in: at full
      res build the orange mask (cheap threshold), set masked pixels to alpha 0,
      resize RGBA (alpha-weighted so orange contributes nothing), then fill the
      still-transparent regions (nearest-valid, existing EDT) instead of matching a
      color. Keep it off the gigapixel EDT path (the old full-res dilate hung).
- [x] Task 8.2: Regenerate PGS variant → copy to fixtures. Trimmed pgs-only config
      regen (hash inputs unchanged → same name `PHerc1428Cr04_pgs.890bf49a.glb`,
      dropped over the fixture; manifest untouched).
### Verification
- [x] Residual orange-tinted fraction ≈ 0 at fuzz 0.10 on the normalized image;
      no orange fringes on the surface. Verified on the real 32k PGS atlas: orange-
      tinted fraction **0.0000%** at fuzz 0.10 (was ~15% mid-fix with a divide path,
      ~30% before Phase 8); mask covers 73% (nodata) leaving 0% orange among opaque
      chart pixels; background back-fill is neutral gray (unsampled by geometry).
      Added 3 unit tests incl. an end-to-end synthetic-atlas normalize and a
      partial-rim speckle regression test. Full suite 101/101 green. Refinement found
      during 8.2 verification (rim-speckle from divide amplification) fixed in 8cdbdf1.

## Phase 9: Light-direction widget — "light ball" (feedback #3) — viewer
Replace the two Az/El sliders with a 2D disc: drag a puck; angle = azimuth,
radius = elevation (centre = straight-on/90°, rim = grazing/0°). Keep the numeric
readouts; keep `setRakingLight`/`getRakingLight`. **Confirm interaction model with
the user before building.**
### Tasks
- [ ] Task 9.1: Build the disc control (canvas or SVG in the shadow DOM), pointer-
      drag → (az, el); reflect current light state; keyboard-accessible.
- [ ] Task 9.2: Swap it into the controls panel; keep `ui="none"` hiding it.
### Verification
- [ ] Dragging drives light az/el (headless: getRakingLight changes as expected);
      a11y (focus/arrow keys); unit test for angle↔position mapping.

## Phase 10: Responsive control panel (feedback #5) — viewer
Below a width breakpoint, dock the panel to the bottom showing only the band
(layer) pickers; tuck raking + measure/pan behind an expandable "more" panel.
### Tasks
- [ ] Task 10.1: Container-query/media-query layout in `styles.ts`; a compact
      docked mode + an expand toggle in `controls.ts`.
- [ ] Task 10.2: Ensure the measure hint/label + light widget still work docked.
### Verification
- [ ] Headless screenshots at wide + narrow viewports; controls reachable in both;
      no horizontal overflow.

---

_Generated by Conductor. Tasks will be marked [~] in progress and [x] complete._
