import { describe, it, expect, beforeEach } from 'vitest';
import { Controls, type ControlsHost } from '../src/controls';

function makeHost(overrides: Partial<ControlsHost> = {}): ControlsHost & {
  selected: string[];
  raked: Array<[number, number]>;
  measured: boolean[];
  adjusted: Array<{ brightness: number; contrast: number }>;
} {
  const selected: string[] = [];
  const raked: Array<[number, number]> = [];
  const measured: boolean[] = [];
  const adjusted: Array<{ brightness: number; contrast: number }> = [];
  return {
    variants: [
      { id: 'rgb', label: 'RGB' },
      { id: 'ir1050', label: 'IR 1050nm' },
    ],
    raking: { azimuth: 45, elevation: 22 },
    imageAdjust: { brightness: 0, contrast: 0 },
    selectVariant: (id) => selected.push(id),
    setRakingLight: (az, el) => raked.push([az, el]),
    setMeasuring: (on) => measured.push(on),
    clearMeasurement: () => {},
    setPanMode: () => {},
    resetView: () => {},
    setImageAdjust: (a) => adjusted.push(a),
    selected,
    raked,
    measured,
    adjusted,
    ...overrides,
  };
}

describe('Controls', () => {
  let mount: HTMLDivElement;

  beforeEach(() => {
    mount = document.createElement('div');
    document.body.append(mount);
  });

  it('renders one band button per variant with labels, in the bands panel', () => {
    new Controls(mount, makeHost());
    const bands = mount.querySelectorAll<HTMLButtonElement>('.bands-panel .band');
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

  it('opens the bands panel on load and the Layers button toggles it', () => {
    new Controls(mount, makeHost());
    const layers = mount.querySelector<HTMLButtonElement>('.tbtn.layers')!;
    const panel = mount.querySelector<HTMLDivElement>('.bands-panel')!;
    expect(panel.hidden).toBe(false); // primary control visible on load
    expect(layers.getAttribute('aria-pressed')).toBe('true');
    layers.click();
    expect(panel.hidden).toBe(true);
    expect(layers.getAttribute('aria-pressed')).toBe('false');
    layers.click();
    expect(panel.hidden).toBe(false);
  });

  it('Light button toggles the raking-light panel (closed on load)', () => {
    new Controls(mount, makeHost());
    const light = mount.querySelector<HTMLButtonElement>('.tbtn.light')!;
    expect(light.getAttribute('aria-label')).toBe('Raking light');
    const panel = mount.querySelector<HTMLDivElement>('.light-panel')!;
    expect(panel.hidden).toBe(true);
    expect(mount.querySelector('.light-dial')).not.toBeNull();
    light.click();
    expect(panel.hidden).toBe(false);
    expect(light.getAttribute('aria-pressed')).toBe('true');
  });

  it('Exposure button toggles the exposure panel and is independent of Light', () => {
    new Controls(mount, makeHost());
    const light = mount.querySelector<HTMLButtonElement>('.tbtn.light')!;
    const exposure = mount.querySelector<HTMLButtonElement>('.tbtn.adjust')!;
    expect(exposure.getAttribute('aria-label')).toBe('Exposure');
    // Open both — panels are toggles, not modals, so they coexist (stacked bottom-right).
    light.click();
    exposure.click();
    expect(mount.querySelector<HTMLDivElement>('.light-panel')!.hidden).toBe(false);
    expect(mount.querySelector<HTMLDivElement>('.adjust-panel')!.hidden).toBe(false);
    expect(light.getAttribute('aria-pressed')).toBe('true');
    expect(exposure.getAttribute('aria-pressed')).toBe('true');
  });

  it('docks the Light and Exposure panels bottom-right, bands bottom-left', () => {
    new Controls(mount, makeHost());
    const br = mount.querySelector<HTMLDivElement>('.dock-br')!;
    const bl = mount.querySelector<HTMLDivElement>('.dock-bl')!;
    expect(br.querySelector('.light-panel')).not.toBeNull();
    expect(br.querySelector('.adjust-panel')).not.toBeNull();
    expect(bl.querySelector('.bands-panel')).not.toBeNull();
  });

  it('seeds the dial from the host; dial keyboard reports azimuth + elevation', () => {
    const host = makeHost();
    new Controls(mount, host);
    const dial = mount.querySelector<HTMLDivElement>('.light-dial')!;
    expect(dial.getAttribute('aria-valuenow')).toBe('45'); // azimuth
    dial.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(host.raked.at(-1)).toEqual([50, 22]); // az +5, elevation unchanged
    dial.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(host.raked.at(-1)).toEqual([50, 27]); // el +5, azimuth unchanged
  });

  it('Reset returns the raking light to the default azimuth/elevation', () => {
    const host = makeHost({ raking: { azimuth: 200, elevation: 80 } });
    new Controls(mount, host);
    const reset = mount.querySelector<HTMLButtonElement>('.light-panel .panel-reset')!;
    reset.click();
    expect(host.raked.at(-1)).toEqual([45, 22]);
    const dial = mount.querySelector<HTMLDivElement>('.light-dial')!;
    expect(dial.getAttribute('aria-valuenow')).toBe('45');
  });

  it('reset-view button asks the host to reframe', () => {
    const framed: number[] = [];
    const host = makeHost({ resetView: () => framed.push(1) });
    new Controls(mount, host);
    mount.querySelector<HTMLButtonElement>('.tbtn.reset-view')!.click();
    expect(framed).toEqual([1]);
  });

  it('toggles measure mode via the host on click', () => {
    const host = makeHost();
    const controls = new Controls(mount, host);
    const button = mount.querySelector<HTMLButtonElement>('.tbtn.measure')!;
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
    const button = mount.querySelector<HTMLButtonElement>('.tbtn.pan')!;
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
    const clear = mount.querySelector<HTMLButtonElement>('.tbtn.measure-clear')!;
    expect(clear.hidden).toBe(true);
    controls.setHasMeasurement(true);
    expect(clear.hidden).toBe(false);
    clear.click();
    expect(cleared).toEqual([1]);
    controls.setHasMeasurement(false);
    expect(clear.hidden).toBe(true);
  });

  it('seeds the exposure sliders from the host and calls the host on input', () => {
    const host = makeHost({ imageAdjust: { brightness: 20, contrast: -10 } });
    new Controls(mount, host);
    const sliders = mount.querySelectorAll<HTMLInputElement>('.adjust-panel input[type="range"]');
    expect(sliders).toHaveLength(2);
    expect(sliders[0]!.value).toBe('20'); // brightness seeded
    expect(sliders[1]!.value).toBe('-10'); // contrast seeded

    sliders[0]!.value = '55';
    sliders[0]!.dispatchEvent(new Event('input'));
    expect(host.adjusted.at(-1)).toEqual({ brightness: 55, contrast: -10 });
  });

  it('Exposure Reset zeroes brightness and contrast', () => {
    const host = makeHost({ imageAdjust: { brightness: 40, contrast: 30 } });
    new Controls(mount, host);
    mount.querySelector<HTMLButtonElement>('.adjust-panel .panel-reset')!.click();
    expect(host.adjusted.at(-1)).toEqual({ brightness: 0, contrast: 0 });
    const sliders = mount.querySelectorAll<HTMLInputElement>('.adjust-panel input[type="range"]');
    expect(sliders[0]!.value).toBe('0');
    expect(sliders[1]!.value).toBe('0');
  });

  it('reflects a variant switch into the exposure sliders without calling the host', () => {
    const host = makeHost();
    const controls = new Controls(mount, host);
    controls.setImageAdjust({ brightness: -25, contrast: 15 });
    const sliders = mount.querySelectorAll<HTMLInputElement>('.adjust-panel input[type="range"]');
    expect(sliders[0]!.value).toBe('-25');
    expect(sliders[1]!.value).toBe('15');
    expect(host.adjusted).toHaveLength(0); // reflection only, no host round-trip
  });

  it('panel toggles expose aria-expanded and aria-controls', () => {
    new Controls(mount, makeHost());
    const layers = mount.querySelector<HTMLButtonElement>('.tbtn.layers')!;
    const light = mount.querySelector<HTMLButtonElement>('.tbtn.light')!;
    expect(layers.getAttribute('aria-expanded')).toBe('true'); // bands open on load
    expect(light.getAttribute('aria-expanded')).toBe('false');
    // aria-controls resolves to the corresponding panel.
    expect(layers.getAttribute('aria-controls')).toBe('dri-panel-layers');
    expect(mount.querySelector(`#${layers.getAttribute('aria-controls')}`)).toBe(
      mount.querySelector('.bands-panel'),
    );
    light.click();
    expect(light.getAttribute('aria-expanded')).toBe('true');
  });

  it('labels the Light and Exposure panels as groups', () => {
    new Controls(mount, makeHost());
    for (const cls of ['.light-panel', '.adjust-panel']) {
      const panel = mount.querySelector<HTMLDivElement>(cls)!;
      expect(panel.getAttribute('role')).toBe('group');
      const title = mount.querySelector(`#${panel.getAttribute('aria-labelledby')}`);
      expect(title?.textContent).toBeTruthy();
    }
  });

  it('associates each exposure slider with its output and voices signed values', () => {
    new Controls(mount, makeHost({ imageAdjust: { brightness: 20, contrast: 0 } }));
    const sliders = mount.querySelectorAll<HTMLInputElement>('.adjust-panel input[type="range"]');
    const outputs = mount.querySelectorAll<HTMLOutputElement>('.adjust-panel output');
    expect(sliders[0]!.id).toBeTruthy();
    expect(outputs[0]!.getAttribute('for')).toBe(sliders[0]!.id); // native association
    expect(sliders[0]!.getAttribute('aria-valuetext')).toBe('+20'); // seeded, signed
    sliders[0]!.value = '-30';
    sliders[0]!.dispatchEvent(new Event('input'));
    expect(sliders[0]!.getAttribute('aria-valuetext')).toBe('-30');
  });

  it('removes its DOM on dispose', () => {
    const controls = new Controls(mount, makeHost());
    expect(mount.querySelector('.ui')).not.toBeNull();
    controls.dispose();
    expect(mount.querySelector('.ui')).toBeNull();
  });
});
