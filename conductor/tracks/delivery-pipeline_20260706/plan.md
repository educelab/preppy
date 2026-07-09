# Implementation Plan: Delivery pipeline

**Track ID:** delivery-pipeline_20260706
**Spec:** [spec.md](./spec.md)
**Created:** 2026-07-06
**Status:** [x] Complete (closed out 2026-07-09)

## Overview
Validate the untested multi-material path first, then build bottom-up:
dependencies → leaf modules (texture, geometry, embed) → per-variant orchestration
+ manifest → input schema, CLI, thumbnails. Prove end-to-end on the `mvs` object.
No geometry grouping/fingerprinting (ADR-0002 amended) — each variant is one
self-contained glb.

## Phase 0: Multi-material validation-first
### Tasks
- [x] Task 0.1: Take one real **multi-material** `mvs` OBJ (multiple `map_Kd`)
      through the full chain by hand: mogrify → `ktx create` (per texture) →
      gltfpack (`-si 0.2`, UVs "used", multi-primitive) → gltf-transform embed →
      load in a three.js check. Confirm coherent textures, preserved
      `KHR_texture_transform`, correct scale. See [phase0-findings.md](./phase0-findings.md).
### Verification
- [x] A multi-texture variant glb renders correctly (no atlas scramble, right
      scale). If not, resolve before building the batch pipeline.
      **PASS** (operator-confirmed): texture mapping coherent; transparency fixed
      upstream (F2); bleed = known nodata-dilation input (F4); mesh unscaled (F5).

## Phase 1: Dependencies & scaffolding (A0)
### Tasks
- [x] Task 1.1: Add `ktx`(≥v5)/`gltfpack`/`gltf-transform` PATH detection (mirror
      the existing `platform.system()` `.cmd` handling); document install.
- [x] Task 1.2: Bump Python floor to 3.11+, refresh deps; add optional
      `pymeshlab`. Update `setup.cfg`, `requirements.txt`, Singularity def.
- [x] Task 1.3: Mark `obj2gltf`/`gltf-pipeline` path deprecated (keep old
      entrypoint working until the new one lands).
### Verification
- [x] Fresh install exposes console scripts; tool detection reports clearly when
      `ktx`/`gltfpack`/`gltf-transform` are missing (and if `ktx < v5`).
      **PASS** — `voyager-check-tools` reports every tool with version + path,
      shows the `ktx [needs >= 5.0.0]` / `node [needs >= 20.0.0]` gates, the embed
      helper deps, and the optional model-preview GL backend.

## Phase 2: Leaf modules (A2)
### Tasks
- [x] Task 2.1: `texture.py` — `normalize(src, nodata_fill=None)` (mogrify
      CIELab/16-bit → 8-bit sRGB, resize `>8192`, edge-dilate over `nodata_fill`)
      + `encode_ktx2(png, mode)` (`ktx create`, mips, ETC1S|UASTC).
- [x] Task 2.2: `geometry.py` — `obj_to_geometry_glb()` (gltfpack geometry+UV,
      `-si 0.2`, `-cc`, UVs kept "used"; **no** normal bake) + `validate()`
      Hausdorff vs budget.
- [x] Task 2.3: `assemble.py` — `embed(geom_glb, ktx2s)` via gltf-transform
      (`KHR_texture_basisu`), preserving meshopt + `KHR_texture_transform`.
- [x] Task 2.4: Content-hash helper (input+config SHA-256, 8 hex) + `--prune`.
### Verification
- [x] Colorspace + dilation produce correct KTX2; a variant glb embeds its KTX2,
      loads in the spike page, and keeps its transform; embed round-trip keeps
      meshopt. **PASS** — mechanical chain verified end-to-end on a synthetic
      multi-material asset (F1 name-match correct with reversed MTL order; all four
      extensions — meshopt/quantization/texture_transform/texture_basisu — survive
      the embed; F2 OPAQUE forced). Render on real multi-material data
      operator-confirmed in Phase 0.

## Phase 3: Orchestration & manifest (A3, A4)
### Tasks
- [x] Task 3.1: `manifest.py` (replaces `voyager.py`) — per-object manifest with
      flat `variants[] {id,label,uri,default}` + object metadata (`units:"cm"`) +
      optional per-variant overrides; optional `index.json`.
- [x] Task 3.2: Rewrite `apps/file_prep.py` — **per variant** (no grouping):
      resolve texture(s) transitively via `parse_materials` → normalize+encode
      each → gltfpack → embed all → one self-contained glb → manifest entry.
- [x] Task 3.3: Output layout `out/<prefix>/<prefix>_<suffix>.glb` +
      `manifest.json` + thumb; `--hash-names` (default on), `--uri` prefixing.
      (Thumbnail is Task 4.3; layout/hashing/uri done here.)
### Verification
- [x] Full `mvs` run yields a per-object manifest + one self-contained glb per
      variant; assets load and switch (camera-preserving) in the spike page.
      **PASS** — synthetic multi-variant run emits the A4 layout
      (`out/<prefix>/manifest.json` + `<prefix>_<suffix>.<hash>.glb` + `index.json`),
      manifest matches the spec (single default, overrides, `units:cm`), and each
      glb keeps all four extensions. Real-`mvs` render/switch **operator-confirmed**
      (sign-off 2026-07-09).

## Phase 4: Input schema, CLI, thumbnails (A1, A5, A6)
### Tasks
- [x] Task 4.1: Rewrite `templates/*.schema.json` for the **object → `variants[]`**
      shape (`prefix`, `suffix`, `label`, `obj`, `default`, `nodataFill`, optional
      `texture`/provenance overrides); add an `mvs` example config.
- [x] Task 4.2: CLI flags `--ktx2-mode {etc1s,uastc}`, `-si`/`--decimate-error`,
      `--no-decimate`, `--hash-names`/`--no-hash-names`, `--prune`, `--nodata-fill`;
      keep `--uri`, `--keep-tmp`.
- [x] Task 4.3: Texture-crop thumbnails via mogrify (default variant).
- [x] Task 4.4: Integration smoke test against a trimmed `mvs` sample.
### Verification
- [x] Config validates against schema; CLI flags behave; smoke test asserts the
      emitted manifest + self-contained variant glbs. **PASS** — `test_schema`
      validates both example configs (+ negatives); flags exercised
      (`--decimate-error` rehashes, `--prune` removes stale, `--no-hash-names`,
      `--uri`, thumbnails); `test_integration` asserts the full manifest + asset
      set end-to-end on a trimmed multi-material sample.

## Final Verification
- [x] All acceptance criteria met on real `mvs` data. **Operator-confirmed
      2026-07-09.** Hausdorff decimation gating is wired
      (`--validate`/`--deviation-budget`: plain re-pack + pymeshlab check, fails
      over budget).
- [x] Unit + smoke tests passing (91/91); `voyager-preppy -h` green;
      `voyager-check-tools` reports the full toolchain OK (incl. optional
      model-preview GL backend).
- [x] `tech-stack.md` / README updated for the new toolchain.
- [x] Ready for review — MR !7 into `develop`
      (https://gitlab.com/educelab/dri-voyager-preppy/-/merge_requests/7).

## Post-plan work (not in the original task list; landed on the branch)
These shipped after the plan was written and are covered by the test suite (91 tests):
- **Rendered model-preview thumbnail** (`preview.py`) — trimesh+pyrender proxy
  render of the default variant for `<prefix>_thumb.jpg`, with a texture-crop
  fallback (`--thumbnail-mode texture`) when the GL backend is unavailable;
  `--preview-bg` (default `222222`). Optional `.[preview]` extra.
- **`nodataFill` hang fix** — in-memory nearest-valid-pixel fill on the downsized
  image (`texture.fill_nodata`), replacing the full-res ImageMagick dilate that
  hung on gigapixel textures.
- **Relative `obj` paths** resolve against `--data-root` (default CWD).
- **Removed** the `--opaque` defensive alpha fix (handled upstream).
- **tqdm progress bars** kept clean (logging + captured subprocess output).

---

_Generated by Conductor. Tasks will be marked [~] in progress and [x] complete._
