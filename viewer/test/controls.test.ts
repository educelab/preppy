import { describe, it, expect, beforeEach } from 'vitest';
import { Controls, type ControlsHost } from '../src/controls';

function makeHost(overrides: Partial<ControlsHost> = {}): ControlsHost & {
  selected: string[];
  raked: Array<[number, number]>;
  measured: boolean[];
} {
  const selected: string[] = [];
  const raked: Array<[number, number]> = [];
  const measured: boolean[] = [];
  return {
    variants: [
      { id: 'rgb', label: 'RGB' },
      { id: 'ir1050', label: 'IR 1050nm' },
    ],
    raking: { azimuth: 45, elevation: 22 },
    selectVariant: (id) => selected.push(id),
    setRakingLight: (az, el) => raked.push([az, el]),
    setMeasuring: (on) => measured.push(on),
    clearMeasurement: () => {},
    setPanMode: () => {},
    resetView: () => {},
    selected,
    raked,
    measured,
    ...overrides,
  };
}

describe('Controls', () => {
  let mount: HTMLDivElement;

  beforeEach(() => {
    mount = document.createElement('div');
    document.body.append(mount);
  });

  it('renders one band button per variant with labels', () => {
    new Controls(mount, makeHost());
    const bands = mount.querySelectorAll<HTMLButtonElement>('.band');
    expect(bands).toHaveLength(2);
    expect([...bands].map((b) => b.textContent)).toEqual(['RGB', 'IR 1050nm']);
  });

  it('calls selectVariant when a band button is clicked', () => {
    const host = makeHost();
    new Controls(mount, host);
    mount.querySelectorAll<HTMLButtonElement>('.band')[1]!.click();
    expect(host.selected).toEqual(['ir1050']);
  });

  it('reflects the active variant via aria-pressed', () => {
    const controls = new Controls(mount, makeHost());
    controls.setActiveVariant('ir1050');
    const bands = mount.querySelectorAll<HTMLButtonElement>('.band');
    expect(bands[0]!.getAttribute('aria-pressed')).toBe('false');
    expect(bands[1]!.getAttribute('aria-pressed')).toBe('true');
  });

  it('houses the raking controls in a Light popover behind the ☀ button', () => {
    new Controls(mount, makeHost());
    const trigger = mount.querySelector<HTMLButtonElement>('.popover-trigger.light')!;
    expect(trigger).not.toBeNull();
    expect(trigger.getAttribute('aria-label')).toBe('Raking light');
    // The panel exists but is hidden until the button is clicked.
    const panel = mount.querySelector<HTMLDivElement>('.popover-panel')!;
    expect(panel.hidden).toBe(true);
    expect(mount.querySelector('.light-dial')).not.toBeNull();
    trigger.click();
    expect(panel.hidden).toBe(false);
  });

  it('seeds the dial + elevation slider from the host; elevation slider reports angles', () => {
    const host = makeHost();
    new Controls(mount, host);
    const dial = mount.querySelector<HTMLDivElement>('.light-dial')!;
    expect(dial.getAttribute('aria-valuenow')).toBe('45'); // azimuth
    const el = mount.querySelector<HTMLInputElement>('.light-el input[type="range"]')!;
    expect(el.value).toBe('22'); // elevation

    el.value = '5';
    el.dispatchEvent(new Event('input'));
    expect(host.raked.at(-1)).toEqual([45, 5]); // current azimuth + new elevation
  });

  it('dragging-equivalent dial keyboard input reports azimuth with current elevation', () => {
    const host = makeHost();
    new Controls(mount, host);
    const dial = mount.querySelector<HTMLDivElement>('.light-dial')!;
    dial.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(host.raked.at(-1)).toEqual([50, 22]); // az +5, elevation unchanged
  });

  it('Reset returns the raking light to the default azimuth/elevation', () => {
    const host = makeHost({ raking: { azimuth: 200, elevation: 80 } });
    new Controls(mount, host);
    const reset = mount.querySelector<HTMLButtonElement>('.panel-reset')!;
    reset.click();
    expect(host.raked.at(-1)).toEqual([45, 22]);
    const el = mount.querySelector<HTMLInputElement>('.light-el input[type="range"]')!;
    expect(el.value).toBe('22');
  });

  it('reset-view button asks the host to reframe', () => {
    const framed: number[] = [];
    const host = makeHost({ resetView: () => framed.push(1) });
    new Controls(mount, host);
    mount.querySelector<HTMLButtonElement>('.reset-view')!.click();
    expect(framed).toEqual([1]);
  });

  it('toggles measure mode via the host on click', () => {
    const host = makeHost();
    const controls = new Controls(mount, host);
    const button = mount.querySelector<HTMLButtonElement>('.measure')!;
    button.click();
    expect(host.measured).toEqual([true]);
    // Host reflects state back onto the button; a second click requests the opposite.
    controls.setMeasuring(true);
    button.click();
    expect(host.measured).toEqual([true, false]);
  });

  it('toggles pan mode via the host and reflects state back', () => {
    const panned: boolean[] = [];
    const host = makeHost({ setPanMode: (on) => panned.push(on) });
    const controls = new Controls(mount, host);
    const button = mount.querySelector<HTMLButtonElement>('.tool.pan')!;
    button.click();
    expect(panned).toEqual([true]);
    controls.setPanning(true);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    button.click();
    expect(panned).toEqual([true, false]);
  });

  it('shows the Clear button only when a measurement exists and calls the host', () => {
    const cleared: number[] = [];
    const host = makeHost({ clearMeasurement: () => cleared.push(1) });
    const controls = new Controls(mount, host);
    const clear = mount.querySelector<HTMLButtonElement>('.measure-clear')!;
    expect(clear.hidden).toBe(true);
    controls.setHasMeasurement(true);
    expect(clear.hidden).toBe(false);
    clear.click();
    expect(cleared).toEqual([1]);
    controls.setHasMeasurement(false);
    expect(clear.hidden).toBe(true);
  });

  it('removes its DOM on dispose', () => {
    const controls = new Controls(mount, makeHost());
    expect(mount.querySelector('.ui')).not.toBeNull();
    controls.dispose();
    expect(mount.querySelector('.ui')).toBeNull();
  });
});
