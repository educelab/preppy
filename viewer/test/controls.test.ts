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

  it('seeds the raking sliders from the host and reports both angles on input', () => {
    const host = makeHost();
    new Controls(mount, host);
    const sliders = mount.querySelectorAll<HTMLInputElement>('input[type="range"]');
    expect(sliders).toHaveLength(2);
    expect(sliders[0]!.value).toBe('45'); // azimuth
    expect(sliders[1]!.value).toBe('22'); // elevation

    sliders[1]!.value = '5';
    sliders[1]!.dispatchEvent(new Event('input'));
    expect(host.raked.at(-1)).toEqual([45, 5]); // current azimuth + new elevation
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

  it('removes its DOM on dispose', () => {
    const controls = new Controls(mount, makeHost());
    expect(mount.querySelector('.ui')).not.toBeNull();
    controls.dispose();
    expect(mount.querySelector('.ui')).toBeNull();
  });
});
