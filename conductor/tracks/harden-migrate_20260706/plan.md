# Implementation Plan: Harden & migrate

**Track ID:** harden-migrate_20260706
**Spec:** [spec.md](./spec.md)
**Created:** 2026-07-06
**Status:** [x] Complete (closed 2026-07-23)

## Overview
Harden first (enforce tuning gates, memory, cache-busting policy, a11y, docs, CI),
then migrate the back-catalog, with an optional two-tier LOD stretch if
first-paint still hurts. Core tuning values are already chosen in the spike;
this track *enforces/records* them.

## Phase 1: Harden (Phase 4)
### Tasks
- [x] Task 1.1: Enforce the decimation budget (spike: `-si 0.2`) as a Hausdorff
      gate in the pipeline (fail/warn on over-budget).
- [x] Task 1.2: Confirm + record KTX2 mode (spike: ETC1S default, per-variant
      UASTC option) as the default `--ktx2-mode`.
- [x] Task 1.3: Validate viewer memory policy on a mid-range phone across many
      variants; tune the loaded-glb/decoded-texture LRU. NB (MR !8 review): the
      default `maxCachedVariants: 0` keeps **all** variants resident and
      `#preloadOthers` eagerly loads every variant — tuned to the ~4-variant test
      object. Decide whether the default should stay unbounded or cap/opt-out
      preload for many-variant objects, and document the chosen policy.
- [x] Task 1.4: Cache-busting retention policy (keep-last-N via `--prune`) + host
      `Cache-Control` example (`.htaccess`: revalidate manifest, `immutable`
      hashed assets) once the target host is known.
- [x] Task 1.5: Accessibility basics on the widget (keyboard, focus, labels).
- [x] Task 1.6: Docs — README, `ktx`(≥v5)/`gltfpack`/`gltf-transform` install;
      rework `.gitlab-ci.yml` for the new toolchain (keep the `-h` smoke test).
      Also wire the **viewer** typecheck/unit(vitest)/e2e(Playwright) into CI
      (deferred out of viewer-widget).

### Generalization / robustness (deferred from viewer-widget MR !8 review)
These are places the pipeline + viewer were shaped to the one test object
(`PHerc1428Cr04`, an MVS scroll fragment) and should be generalized before the
back-catalog migration (Phase 2) feeds them arbitrary legacy objects.

- [x] Task 1.7: **`bake_normals` assumes the source OBJ carries no vertex
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
- [x] Task 1.8: **Viewer assumes the surface faces +Z** — `Viewer.applyRakingLight()`
      builds the light basis "relative to the surface (which faces +Z)" and
      `frameObject()` always parks the camera at `center + (0,0,radius*2.6)`.
      Correct for a flat fragment in XY; for an object whose front isn't +Z the
      raking azimuth/elevation are relative to world +Z and the initial framing can
      be edge-on/behind. Decide the contract: either document "delivery convention:
      dominant surface faces +Z" as a precondition, or derive the framing axis /
      raking basis from the model extent or a manifest hint. (Scale already
      generalizes — near/far, light position, and marker sizing are all derived
      from the bounding sphere.)
- [x] Task 1.9: **Image-adjust shader robustness** (`viewer/src/image-adjust.ts`).
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
- [x] Over-budget decimation is caught (unit + live gate tests); CI reworked for the
      new toolchain (jobs verified locally: pytest 3.11–3.13 + `-h`, viewer
      typecheck/unit/e2e); a11y basics pass (unit + phase4 e2e).
- [x] `bake_normals` correct for a normal-bearing and a negative-index OBJ
      (regression tests green + verified on real vn-bearing spike OBJs); viewer
      memory policy documented; +Z assumption documented as a delivery precondition.

_Deferred (external/manual, tracked): on-device many-variant memory pass (1.3);
host-specific `Cache-Control` tuning once the host is known (1.4); provisioning
e2e fixtures on CI so the WebGL specs run there (1.6); keyboard camera navigation
as its own follow-up (1.5)._

## Phase 2: Consumption handoff (rescoped 2026-07-11 — was: Migrate back-catalog)
**Rescope note.** The back-catalog migration and host stand-up are **not** done in
this repo. The pipeline already emits the new format (manifest + per-variant glb +
thumbnail); *consuming* it — re-emitting/serving objects and swapping the DPO
Voyager embed for `<dri-viewer>` — is owned by the **DRI Viewer application** team.
This phase's deliverable is the handoff document that lets them do it. The original
migrate/host/retire tasks move out of scope for this track (see below).
### Tasks
- [x] Task 2.1: Produce the consumption/migration handoff for the DRI Viewer repo
      — why Voyager was dropped, old→new concept map, `manifest.json`/`index.json`
      schema, how to obtain + embed the widget, the full widget API, hosting/CORS +
      cache headers, the +Z delivery precondition, and a migration checklist.
      Authored here, then relocated to the `dri-voyager` repo alongside the widget
      when the viewer was migrated out of this repo.
### Out of scope (ownership moved to the DRI Viewer app / pipeline operators)
- Author input configs for existing objects (single-variant manifests).
- Batch-run the pipeline; spot-check each migrated object in the widget.
- Stand up the migrated catalog on the host; verify embeds.
- Retire the old Voyager path once the migrated catalog is verified live.
### Verification
- [x] Handoff guide delivered; accuracy cross-checked against the pipeline's
      delivery format (`preppy/manifest.py` + ADR-0001/0002) at authoring time.
      Now maintained with the widget in the `dri-voyager` repo.

## Phase 3: Two-tier LOD (stretch, optional) — descoped 2026-07-23
**Descope note.** This stretch was always viewer-side work — Task 3.1 explicitly
"wire the viewer swap." The `<dri-viewer>` widget was migrated out to the
`dri-voyager` repo, so any preview-mesh/background-load swap is now owned there,
not in this pipeline repo. First-paint on the current back-catalog (flat XY
fragments) was acceptable without it, so the stretch was never triggered.
### Tasks
- [x] ~~Task 3.1: preview mesh + background full-res load; wire the viewer swap~~
      — descoped: viewer-owned, moved to `dri-voyager`; first-paint acceptable.
### Verification
- [x] ~~First-paint improves measurably~~ — N/A; LOD not needed and now viewer-owned.

## Final Verification
- [x] All (in-scope) success criteria met.
- [x] ~~Back-catalog migrated and verified live~~ — rescoped 2026-07-11: migration
      + host stand-up moved to the DRI Viewer app; replaced by the consumption
      handoff (Phase 2), which now lives with the widget in the `dri-voyager` repo.
- [x] Tuning parameters recorded in `docs/implementation-plan.md` (see "Tuning
      parameters — resolved by the Phase 0 spike").
- [x] Ready for review. Track closed 2026-07-23 — viewer migrated to `dri-voyager`;
      only the optional viewer-side LOD stretch remained and it moved with the widget.

---

_Generated by Conductor. Tasks will be marked [~] in progress and [x] complete._
