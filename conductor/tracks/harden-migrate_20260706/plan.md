# Implementation Plan: Harden & migrate

**Track ID:** harden-migrate_20260706
**Spec:** [spec.md](./spec.md)
**Created:** 2026-07-06
**Status:** [ ] Not Started (revised 2026-07-07)

## Overview
Harden first (enforce tuning gates, memory, cache-busting policy, a11y, docs, CI),
then migrate the back-catalog, with an optional two-tier LOD stretch if
first-paint still hurts. Core tuning values are already chosen in the spike;
this track *enforces/records* them.

## Phase 1: Harden (Phase 4)
### Tasks
- [x] Task 1.1: Enforce the decimation budget (spike: `-si 0.2`) as a Hausdorff
      gate in the pipeline (fail/warn on over-budget).
- [ ] Task 1.2: Confirm + record KTX2 mode (spike: ETC1S default, per-variant
      UASTC option) as the default `--ktx2-mode`.
- [ ] Task 1.3: Validate viewer memory policy on a mid-range phone across many
      variants; tune the loaded-glb/decoded-texture LRU. NB (MR !8 review): the
      default `maxCachedVariants: 0` keeps **all** variants resident and
      `#preloadOthers` eagerly loads every variant — tuned to the ~4-variant test
      object. Decide whether the default should stay unbounded or cap/opt-out
      preload for many-variant objects, and document the chosen policy.
- [ ] Task 1.4: Cache-busting retention policy (keep-last-N via `--prune`) + host
      `Cache-Control` example (`.htaccess`: revalidate manifest, `immutable`
      hashed assets) once the target host is known.
- [ ] Task 1.5: Accessibility basics on the widget (keyboard, focus, labels).
- [ ] Task 1.6: Docs — README, `ktx`(≥v5)/`gltfpack`/`gltf-transform` install;
      rework `.gitlab-ci.yml` for the new toolchain (keep the `-h` smoke test).
      Also wire the **viewer** typecheck/unit(vitest)/e2e(Playwright) into CI
      (deferred out of viewer-widget).

### Generalization / robustness (deferred from viewer-widget MR !8 review)
These are places the pipeline + viewer were shaped to the one test object
(`PHerc1428Cr04`, an MVS scroll fragment) and should be generalized before the
back-catalog migration (Phase 2) feeds them arbitrary legacy objects.

- [ ] Task 1.7: **`bake_normals` assumes the source OBJ carries no vertex
      normals** (`preppy/geometry.py`). It appends a fresh `vn` block and rewrites
      normalless faces as `v/vt/v` / `v//v` using *vertex index = normal index* —
      correct only when no `vn` lines pre-exist. A source that already ships
      normals (common in photogrammetry/MVS exporters) keeps its original `vn`
      block, so the vertex-indexed refs land in the wrong block → silently
      mis-shaded normals, on the `smooth_normals=True` **default** path. Fix:
      detect a pre-existing `vn` and either skip baking or strip source
      `vn` + `/vn` refs first. Also guard **negative (relative) OBJ face indices**
      (`int(...) - 1` on a negative index silently wraps under numpy). Add
      regression tests for a normal-bearing OBJ and a negative-index OBJ (current
      `test_bake_normals_*` only cover normalless inputs).
- [ ] Task 1.8: **Viewer assumes the surface faces +Z** — `Viewer.applyRakingLight()`
      builds the light basis "relative to the surface (which faces +Z)" and
      `frameObject()` always parks the camera at `center + (0,0,radius*2.6)`.
      Correct for a flat fragment in XY; for an object whose front isn't +Z the
      raking azimuth/elevation are relative to world +Z and the initial framing can
      be edge-on/behind. Decide the contract: either document "delivery convention:
      dominant surface faces +Z" as a precondition, or derive the framing axis /
      raking basis from the model extent or a manifest hint. (Scale already
      generalizes — near/far, light position, and marker sizing are all derived
      from the bounding sphere.)
- [ ] Task 1.9: **Image-adjust shader robustness** (`viewer/src/image-adjust.ts`).
      `installAdjustShader` string-replaces `#include <map_fragment>` /
      `#include <common>`, which only exist on standard PBR materials (fine for the
      pipeline's current output). If a variant ever arrives with a different
      material the replace silently no-ops and Exposure does nothing — add a
      dev-mode warning when the token is absent. Also: the "idempotent per material"
      doc claim is inaccurate (a second patch injects the GLSL header twice →
      duplicate uniforms → compile error); make it truly idempotent (guard flag) or
      correct the comment. Minor: tidy the double-negative control flow in
      `DriViewer.#preloadOthers` while here.
### Verification
- [ ] Over-budget decimation is caught; CI green on the new toolchain (incl. viewer
      tests); a11y pass.
- [ ] `bake_normals` correct for a normal-bearing and a negative-index OBJ
      (regression tests green); viewer memory policy documented; +Z assumption
      either removed or documented as a delivery precondition.

## Phase 2: Migrate back-catalog (Phase 5)
### Tasks
- [ ] Task 2.1: Author input configs for existing objects (single-variant
      manifest).
- [ ] Task 2.2: Batch-run the pipeline; spot-check each migrated object in the
      widget.
- [ ] Task 2.3: Stand up the migrated catalog on the host; verify embeds.
- [ ] Task 2.4: Retire the old Voyager path once the migrated catalog is verified.
### Verification
- [ ] Migrated objects render correctly in the widget; no broken embeds.

## Phase 3: Two-tier LOD (stretch, optional)
### Tasks
- [ ] Task 3.1: Only if first-paint still hurts — add a preview mesh + background
      full-res load; wire the viewer swap.
### Verification
- [ ] First-paint improves measurably without harming measurement accuracy.

## Final Verification
- [ ] All success criteria met.
- [ ] Back-catalog migrated and verified live.
- [ ] Tuning parameters recorded in `docs/implementation-plan.md`.
- [ ] Ready for review.

---

_Generated by Conductor. Tasks will be marked [~] in progress and [x] complete._
