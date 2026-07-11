import { describe, it, expect, beforeEach } from 'vitest';
import {
  LightDial,
  type LightDialOptions,
  azimuthToPoint,
  pointToAzimuth,
  elevationToRadius,
  radiusToElevation,
} from '../src/light-dial';

const R = 100;
const near = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('light-dial mappings', () => {
  it('elevationToRadius: overhead → centre, grazing → rim', () => {
    near(elevationToRadius(90, R), 0); // straight-on: puck at centre
    near(elevationToRadius(0, R), R); // grazing: puck at rim
    near(elevationToRadius(60, R), R * 0.5); // cos60 = 0.5
  });

  it('radiusToElevation inverts elevationToRadius and clamps past the rim', () => {
    near(radiusToElevation(0, R), 90); // centre → overhead
    near(radiusToElevation(R, R), 0); // rim → grazing
    near(radiusToElevation(R * 0.5, R), 60); // acos(0.5) = 60°
    near(radiusToElevation(R * 1.5, R), 0); // beyond the rim clamps to grazing
  });

  it('azimuthToPoint places the puck around the circle (screen y down-positive)', () => {
    let p = azimuthToPoint(0, 0, R);
    near(p.x, R);
    near(p.y, 0); // az 0 → +X (right)
    p = azimuthToPoint(90, 0, R);
    near(p.x, 0);
    near(p.y, -R); // az 90 → screen-up
    p = azimuthToPoint(180, 0, R);
    near(p.x, -R);
    near(p.y, 0);
    p = azimuthToPoint(270, 0, R);
    near(p.x, 0);
    near(p.y, R); // az 270 → screen-down
  });

  it('azimuthToPoint puck radius follows elevation', () => {
    const p = azimuthToPoint(0, 60, R);
    near(p.x, R * 0.5); // radius halved at el 60
  });

  it('pointToAzimuth inverts azimuthToPoint and normalises to [0,360)', () => {
    expect(pointToAzimuth(R, 0)).toBeCloseTo(0);
    expect(pointToAzimuth(0, -R)).toBeCloseTo(90); // screen-up → az 90
    expect(pointToAzimuth(-R, 0)).toBeCloseTo(180);
    expect(pointToAzimuth(0, R)).toBeCloseTo(270); // screen-down → az 270
  });
});

describe('LightDial interaction', () => {
  let mount: HTMLDivElement;
  beforeEach(() => {
    mount = document.createElement('div');
    document.body.append(mount);
  });

  function make(over: Partial<LightDialOptions> = {}) {
    const inputs: Array<[number, number]> = [];
    const dial = new LightDial({
      azimuth: 45,
      elevation: 22,
      onInput: (az, el) => inputs.push([az, el]),
      ...over,
    });
    mount.append(dial.root);
    return { dial, inputs };
  }

  it('exposes role=slider with azimuth aria state (valuetext voices elevation too)', () => {
    const { dial } = make();
    expect(dial.root.getAttribute('role')).toBe('slider');
    expect(dial.root.getAttribute('aria-valuemin')).toBe('0');
    expect(dial.root.getAttribute('aria-valuemax')).toBe('360');
    expect(dial.root.getAttribute('aria-valuenow')).toBe('45');
    expect(dial.root.getAttribute('aria-valuetext')).toBe('azimuth 45°, elevation 22°');
    expect(dial.root.getAttribute('aria-label')).toContain('Light direction');
  });

  it('left/right arrows step azimuth by 5° (1° with Shift) and emit', () => {
    const { dial, inputs } = make();
    dial.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(dial.azimuth).toBe(50);
    dial.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true }));
    expect(dial.azimuth).toBe(49);
    expect(inputs).toEqual([
      [50, 22],
      [49, 22],
    ]);
  });

  it('up/down arrows step elevation (clamped 0–90) without touching azimuth', () => {
    const { dial, inputs } = make();
    dial.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(dial.elevation).toBe(27); // 22 + 5
    expect(dial.azimuth).toBe(45);
    dial.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true }));
    expect(dial.elevation).toBe(26); // 27 − 1
    expect(inputs).toEqual([
      [45, 27],
      [45, 26],
    ]);
  });

  it('arrow stepping wraps across the 0/360 seam', () => {
    const { dial } = make({ azimuth: 2 });
    dial.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(dial.azimuth).toBe(357); // 2 - 5 wraps to 357
  });

  it('Home/End jump to the ends', () => {
    const { dial } = make();
    dial.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }));
    expect(dial.azimuth).toBe(0);
    dial.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));
    expect(dial.azimuth).toBe(360);
  });

  it('setElevation slides the puck radially and does not change azimuth', () => {
    const { dial } = make();
    dial.setElevation(90); // overhead → puck at centre
    expect(dial.elevation).toBe(90);
    expect(dial.azimuth).toBe(45);
    // aria-valuenow tracks azimuth only, unaffected by elevation.
    expect(dial.root.getAttribute('aria-valuenow')).toBe('45');
  });

  it('dragging into the centre snaps to overhead (el 90°) keeping azimuth', () => {
    const { dial, inputs } = make({ azimuth: 45, elevation: 22 });
    // happy-dom gives a 0-origin rect; the dial centre is at (SIZE/2, SIZE/2) = (54,54).
    // A pointer a few px from there is inside the snap zone → pin overhead, azimuth kept.
    dial.root.dispatchEvent(new PointerEvent('pointerdown', { clientX: 57, clientY: 52 }));
    expect(dial.elevation).toBe(90);
    expect(dial.azimuth).toBe(45);
    expect(inputs.at(-1)).toEqual([45, 90]);
  });

  it('double-click requests a reset', () => {
    let reset = 0;
    const { dial } = make({ onReset: () => (reset += 1) });
    dial.root.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(reset).toBe(1);
  });
});
