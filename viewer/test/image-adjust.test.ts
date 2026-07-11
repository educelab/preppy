import { describe, it, expect } from 'vitest';
import {
  adjustDisplay,
  toFactor,
  isIdentity,
  IDENTITY_ADJUST,
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
