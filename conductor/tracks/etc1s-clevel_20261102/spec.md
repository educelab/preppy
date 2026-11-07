# Specification: ETC1S encoder float32 bug: patch the encoder, triage and rebuild the catalog

**Track ID:** etc1s-clevel_20261102
**Type:** Bug
**Created:** 2026-11-02
**Status:** Draft
**Issue:** [educelab/preppy#5](https://github.com/educelab/preppy/issues/5) (from [educelab/dri-voyager#13](https://gitlab.com/educelab/dri-voyager/-/work_items/13))
**Branch:** `5-etc1s-encode-at-default-clevel-corrupts-near-white-regions-of-grayscale-textures`

## Summary
Grey 4×4 blocks replace near-white areas in some mip levels of ETC1S-encoded textures,
and the viewer shows them at normal zoom. The root cause is a float32 accumulation bug
in the basis_universal ETC1S encoder that KTX-Software vendors and preppy runs via
`ktx create` (plan, Phase 3 *Root cause*). This track:
- shipped a mitigation (`--clevel 2`) and a cache-hash fix;
- built a temporary texture gate, used to triage the published catalog;
- patches the encoder in preppy's container (the actual fix, until upstream fixes it);
- rebuilds the affected assets;
- removes the gate once the fix is verified.

## Context
Goal 2 of product.md ("preserve measurement fidelity … scientifically trustworthy")
covers geometry with the Hausdorff gate but has no counterpart for textures. The ETC1S
default came from the toolchain spike's visual comparison (`spike/FINDINGS.md`: "no
visible quality difference vs UASTC") and was recorded in harden-migrate Task 1.2. This
defect is content-dependent and appears only at mid zoom, which that comparison didn't
sample.

## Problem Description
- **Affected asset:** `PHerc1166Cr01_ir1050_fe2.aa9e04c1.glb` (live). Mip levels 2/3
  have 11.5% / 14.3% of 4×4 blocks off by more than 25 against level 0. Level means are
  190.8 / 188.8 against about 200 at every other level.
- **Reproduce:** from the webify `intermediate.tar.gz`, take
  `voyager/tmp/PHerc1166Cr01/ir1050_fe2/material_0.png` and run preppy's exact argv with
  KTX-Software 5.0.0-rc2:
  `ktx create --format R8G8B8_SRGB --assign-tf srgb --encode basis-lz --generate-mipmap`.
  The output is byte-identical to the archived `.ktx2` and to the texture in the live GLB.
- **Expected:** every mip level matches a downsample of level 0 (≤0.5% bad blocks).
- **Actual:** L2/L3 contain large regions of grey blocks.
- **Fix evidence:** adding `--clevel 2` gives a clean result (0.00% / 0.06% at L2/L3) at
  +3.4% size and about 2× encode time. On a stand-in input, `--qlevel 255` and
  4096-entry codebooks do **not** fix it; `--clevel 2/3/5` and UASTC do.
- **Negative control:** PHerc1116 Scorza FE2 (grayscale, same encoder) is clean at the
  default effort.

## Acceptance Criteria
- [x] The ETC1S effort level is the one chosen in plan Task 4.5: the default
      `--clevel 1`, with the patched encoder; UASTC is unchanged.
- [ ] The cache hash includes the encode parameters, so an encode-flag change gives a
      new hashed asset name. (Before this track it covered only `ktx2_mode` and tool
      versions, so a fixed asset would keep its `immutable` name and stale copies
      would keep serving.)
- [x] KTX-Software v5.0.0-rc2 built from source with the encoder patch re-encodes
      PHerc1166Cr01 FE2 cleanly at the old default effort, and every sampled flagged
      texture from the triage comes out clean.
- [ ] preppy's Docker image and Singularity definition build the patched encoder, and
      patched outputs get new hashed asset names (a patch marker in the hash).
- [ ] preppy's behaviour on an unpatched `ktx` outside the container is decided,
      implemented and documented.
- [ ] Published catalog triaged; affected objects rebuilt via `pipeline_webify` with the
      patched container and republished; a re-triage finds no flagged variants.
- [ ] The texture gate, a temporary tool for the triage, is removed after the above,
      with its tests, flags and docs.
- [ ] ADR 0002, `tech-stack.md`, `spike/FINDINGS.md` and harden-migrate Task 1.2 record
      the effort level, the patched encoder and the gate's removal, pointing to this
      track.

## Dependencies
- KTX-Software 5.0.0-rc2 (Dockerfile pin; newest release as of 2026-11-02), now built
  from source with the encoder patch instead of installed from the release `.deb`.
- Catalog rebuild: preppy container rebuilt (GHCR → cluster `preppy*.sif`), then
  acquisition-workflow `pipeline_webify` re-run per affected object. No webify code
  change: it calls preppy with default flags and picks up the newest container.
- Removing the patch: a KTX-Software release that vendors a basis_universal with the
  accumulation fix.

## Out of Scope
- Changing `pipeline_webify.py` or any acquisition-workflow code.
- Switching the default codec to UASTC (avoids the bug, but 3.3× size).
- Viewer (`dri-voyager`) changes. The viewer renders valid data faithfully.
- Fixing basis_universal or KTX-Software upstream. Reported as basis_universal#476 and
  KTX-Software#1324; the patch is dropped once a release vendors the fix.

## Technical Notes
- The gate (plan Task 2.1) decodes with `ktx extract --raw` and compares each level
  against the same mip chain left uncompressed. A level fails at more than 1% of 4×4
  blocks off by more than 25. It is temporary (plan Phase 6).
- ETC1S at `--clevel 2` roughly doubles encode time (about 42 s → 89 s per 8K texture on
  a workstation); Task 4.5 decides whether the patched build keeps it.
- The patch is one change in `etc1_optimizer::init`: accumulate the cluster average in
  `double`. Proven with an instrumented standalone build of the same basis_universal
  source (plan, *Root cause*); Phase 4 proves it in the real `ktx` build.

## Open Questions
- ~~Does KTX-Software 5.0.0-rc1 (the spike's version) show the same defect?~~ Yes;
  identical per-level result (plan Task 3.5).
- Does the ETC1S encode time at the chosen effort level fit webify's `--time=1:00:00`
  Slurm limit on cluster nodes? (Task 3.6)
- ~~Report upstream to basis_universal (cc KTX-Software, which vendors it)?~~
  **Reported 2026-11-07:** [BinomialLLC/basis_universal#476](https://github.com/BinomialLLC/basis_universal/issues/476)
  and [KhronosGroup/KTX-Software#1324](https://github.com/KhronosGroup/KTX-Software/issues/1324)
  (plan Task 3.5).
- What should preppy do with an unpatched `ktx` once the gate is gone? (Task 5.4)

---

_Generated by Conductor. Review and edit as needed._
