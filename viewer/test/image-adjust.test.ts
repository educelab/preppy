import { describe, it, expect, vi } from 'vitest';
import type { Material } from 'three';
import {
  adjustDisplay,
  toFactor,
  isIdentity,
  IDENTITY_ADJUST,
  installAdjustShader,
} from '../src/image-adjust';

describe('image-adjust formula', () => {
  it('is the identity at brightness=0, contrast=0 for every channel value', () => {
    for (const c of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      expect(adjustDisplay(c, 0, 0)).toBeCloseTo(c, 12);
    }
  });

  it('brightness offsets the channel and clamps to [0,1]', () => {
    expect(adjustDisplay(0.5, 0.2, 0)).toBeCloseTo(0.7);
    expect(adjustDisplay(0.5, -0.2, 0)).toBeCloseTo(0.3);
    expect(adjustDisplay(0.9, 0.5, 0)).toBe(1); // clamped high
    expect(adjustDisplay(0.1, -0.5, 0)).toBe(0); // clamped low
  });

  it('contrast pivots about mid-grey (0.5 is a fixed point)', () => {
    expect(adjustDisplay(0.5, 0, 0.8)).toBeCloseTo(0.5);
    expect(adjustDisplay(0.75, 0, 1)).toBeCloseTo(1); // (0.25)*2 + 0.5
    expect(adjustDisplay(0.25, 0, 1)).toBeCloseTo(0); // (-0.25)*2 + 0.5
    expect(adjustDisplay(0.75, 0, -1)).toBeCloseTo(0.5); // flat at k=-1
    expect(adjustDisplay(0.25, 0, -1)).toBeCloseTo(0.5);
  });

  it('is monotonically non-decreasing in the channel (contrast > -1)', () => {
    for (const k of [-0.5, 0, 0.5, 1]) {
      let prev = -1;
      for (let c = 0; c <= 1.0001; c += 0.05) {
        const v = adjustDisplay(c, 0, k);
        expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = v;
      }
    }
  });

  it('is monotonically non-decreasing in brightness', () => {
    let prev = -1;
    for (let b = -1; b <= 1.0001; b += 0.1) {
      const v = adjustDisplay(0.5, b, 0);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });
});

describe('toFactor', () => {
  it('maps slider units (−100…100) to the −1…1 shader range and clamps', () => {
    expect(toFactor(0)).toBe(0);
    expect(toFactor(100)).toBe(1);
    expect(toFactor(-100)).toBe(-1);
    expect(toFactor(50)).toBe(0.5);
    expect(toFactor(250)).toBe(1); // clamped
    expect(toFactor(-250)).toBe(-1); // clamped
  });
});

describe('isIdentity', () => {
  it('recognises the identity adjust', () => {
    expect(isIdentity(IDENTITY_ADJUST)).toBe(true);
    expect(isIdentity({ brightness: 0, contrast: 0 })).toBe(true);
    expect(isIdentity({ brightness: 1, contrast: 0 })).toBe(false);
    expect(isIdentity({ brightness: 0, contrast: -3 })).toBe(false);
  });
});

// A fake material/shader so the patch is exercised off the GPU (happy-dom).
function fakeMaterial(type = 'MeshStandardMaterial'): Material {
  return { type, needsUpdate: false } as unknown as Material;
}
function fakeShader(fragmentShader = '#include <common>\n#include <map_fragment>') {
  return { uniforms: {} as Record<string, unknown>, fragmentShader };
}
function compile(mat: Material, shader: ReturnType<typeof fakeShader>): void {
  (mat as unknown as { onBeforeCompile: (s: unknown) => void }).onBeforeCompile(shader);
}
const uniformCount = (s: string) => (s.match(/uniform float uBrightness/g) ?? []).length;

describe('installAdjustShader', () => {
  it('injects the header + body once and defines the uniforms', () => {
    const mat = fakeMaterial();
    installAdjustShader(mat);
    const shader = fakeShader();
    compile(mat, shader);
    expect(uniformCount(shader.fragmentShader)).toBe(1);
    expect(shader.fragmentShader).toContain('driLinToSRGB');
    expect(shader.uniforms['uBrightness']).toBeDefined();
    expect(shader.uniforms['uContrast']).toBeDefined();
  });

  it('is idempotent per material: a second install is a no-op returning the same handle', () => {
    const mat = fakeMaterial();
    const h1 = installAdjustShader(mat);
    const h2 = installAdjustShader(mat);
    expect(h2).toBe(h1);
    const shader = fakeShader();
    compile(mat, shader);
    // NOT 2 — a double patch would inject the header twice (duplicate-uniform compile error).
    expect(uniformCount(shader.fragmentShader)).toBe(1);
  });

  it('applies a set() issued before compile once the shader compiles', () => {
    const mat = fakeMaterial();
    const handle = installAdjustShader(mat);
    handle.set({ brightness: 100, contrast: -100 });
    const shader = fakeShader();
    compile(mat, shader);
    expect((shader.uniforms['uBrightness'] as { value: number }).value).toBeCloseTo(1);
    expect((shader.uniforms['uContrast'] as { value: number }).value).toBeCloseTo(-1);
  });

  it('warns in dev when the material lacks the PBR shader chunks', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mat = fakeMaterial('LineBasicMaterial');
    installAdjustShader(mat);
    compile(mat, fakeShader('void main() {}'));  // no <common>/<map_fragment>
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
