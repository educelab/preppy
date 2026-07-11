// Per-variant runtime brightness/contrast correction for the visible base mesh.
//
// Some variants' textures differ in brightness; this is a viewer-only, per-material
// corrective applied via `onBeforeCompile` on the mesh albedo, in DISPLAY (sRGB) space
// (image-editor semantics), leaving the raking-light response and the measurement
// overlays untouched. The math is a pure function (`adjustDisplay`) mirrored exactly by
// the injected GLSL, so the formula is unit-tested off the GPU. Sliders run −100…+100
// with 0 = exact identity; `toFactor` maps that to the shader's −1…1 range.

import type { Material } from 'three';

/** Brightness/contrast in slider units (−100…+100); 0/0 is the identity. */
export interface ImageAdjust {
  brightness: number;
  contrast: number;
}

export const IDENTITY_ADJUST: ImageAdjust = { brightness: 0, contrast: 0 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Map a slider value (−100…100) to the shader factor (−1…1). */
export function toFactor(sliderValue: number): number {
  return clamp(sliderValue, -100, 100) / 100;
}

/**
 * Display-space brightness/contrast reference — the exact math the GLSL mirrors.
 * `c` is a display (sRGB) channel in [0,1]; `b`/`k` are the −1…1 factors. Contrast
 * pivots about mid-grey (0.5) then brightness offsets; result is clamped to [0,1].
 * Identity when b=k=0; monotonic in `c` (k>−1) and in `b`.
 */
export function adjustDisplay(c: number, b: number, k: number): number {
  let v = (c - 0.5) * (1 + k) + 0.5;
  v = v + b;
  return clamp(v, 0, 1);
}

/** Whether an adjust is the identity (no shader effect). */
export function isIdentity(a: ImageAdjust): boolean {
  return a.brightness === 0 && a.contrast === 0;
}

// GLSL injected into the standard material. `driLinToSRGB`/`driSRGBToLin` are the
// standard piecewise transfer functions (WebGL2 / GLSL ES 3.00 componentwise mix).
const GLSL_HEADER = /* glsl */ `
uniform float uBrightness;
uniform float uContrast;
vec3 driLinToSRGB(vec3 c) {
  vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  vec3 lo = c * 12.92;
  return mix(hi, lo, vec3(lessThanEqual(c, vec3(0.0031308))));
}
vec3 driSRGBToLin(vec3 c) {
  vec3 hi = pow((c + 0.055) / 1.055, vec3(2.4));
  vec3 lo = c / 12.92;
  return mix(hi, lo, vec3(lessThanEqual(c, vec3(0.04045))));
}
`;

const GLSL_BODY = /* glsl */ `
{
  vec3 driC = driLinToSRGB(diffuseColor.rgb);
  driC = (driC - 0.5) * (1.0 + uContrast) + 0.5;
  driC = driC + uBrightness;
  diffuseColor.rgb = driSRGBToLin(clamp(driC, 0.0, 1.0));
}
`;

/** Handle for updating a patched material's adjust after it compiles. */
export interface AdjustHandle {
  set(adjust: ImageAdjust): void;
}

interface AdjustUniforms {
  uBrightness: { value: number };
  uContrast: { value: number };
}

/** A three material extended enough to patch (onBeforeCompile + needsUpdate), plus
 * a private marker stashing the installed handle so re-installs are true no-ops. */
type PatchableMaterial = Material & {
  onBeforeCompile: (shader: { uniforms: Record<string, unknown>; fragmentShader: string }) => void;
  __driAdjustHandle?: AdjustHandle;
};

/**
 * Install the display-space brightness/contrast shader on `material`. Truly
 * idempotent per material: a second call returns the same handle without patching
 * again (a double patch would inject the GLSL header twice → duplicate uniforms →
 * compile error). Returns a handle whose `set()` updates the live uniforms — no
 * recompile. Values are stashed until the shader compiles, so `set()` is safe
 * immediately.
 *
 * The patch string-replaces the standard `#include <common>` / `#include
 * <map_fragment>` chunks, which only exist on standard PBR materials. On any other
 * material the replace no-ops (adjust does nothing); in dev builds that emits a
 * warning rather than failing silently.
 */
export function installAdjustShader(material: Material): AdjustHandle {
  const mat = material as PatchableMaterial;
  if (mat.__driAdjustHandle) return mat.__driAdjustHandle;  // already patched

  const state = { b: 0, k: 0 };
  let uniforms: AdjustUniforms | null = null;

  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader) => {
    prev?.call(mat, shader as never);
    shader.uniforms['uBrightness'] = { value: state.b };
    shader.uniforms['uContrast'] = { value: state.k };
    const hadTokens = shader.fragmentShader.includes('#include <common>')
      && shader.fragmentShader.includes('#include <map_fragment>');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_HEADER}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n${GLSL_BODY}`);
    const dev = (import.meta as { env?: { DEV?: boolean } }).env?.DEV;
    if (dev && !hadTokens) {
      console.warn(
        '[dri-viewer] installAdjustShader: material has no <map_fragment>/<common> '
          + 'chunk (non-PBR material?); brightness/contrast will have no effect',
        (material as { type?: string }).type ?? material);
    }
    uniforms = shader.uniforms as unknown as AdjustUniforms;
  };
  material.needsUpdate = true;

  const handle: AdjustHandle = {
    set(adjust: ImageAdjust): void {
      state.b = toFactor(adjust.brightness);
      state.k = toFactor(adjust.contrast);
      if (uniforms) {
        uniforms.uBrightness.value = state.b;
        uniforms.uContrast.value = state.k;
      }
    },
  };
  mat.__driAdjustHandle = handle;
  return handle;
}
