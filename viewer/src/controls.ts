// The built-in control cluster: band selector, raking-light sliders, measure toggle.
//
// Shown by default (ui !== "none"); a host that wants its own chrome sets ui="none" and
// drives the element via attributes/methods/events instead. The panel is decoupled from
// the element behind ControlsHost so it stays simple and unit-testable.

/** What the controls need from their host (the <dri-viewer> element). */
export interface ControlsHost {
  /** Variants to list, in manifest order. */
  readonly variants: ReadonlyArray<{ id: string; label: string }>;
  /** Initial raking-light angles (degrees). */
  readonly raking: { azimuth: number; elevation: number };
  /** Request a variant switch (camera preserved). */
  selectVariant(id: string): void;
  /** Aim the raking light. */
  setRakingLight(azimuth: number, elevation: number): void;
  /** Toggle two-point measure mode. */
  setMeasuring(on: boolean): void;
}

export class Controls {
  #host: ControlsHost;
  #root: HTMLDivElement;
  #bands = new Map<string, HTMLButtonElement>();
  #measureButton: HTMLButtonElement;

  constructor(mount: ParentNode, host: ControlsHost) {
    this.#host = host;
    this.#root = document.createElement('div');
    this.#root.className = 'ui';
    this.#root.setAttribute('part', 'controls');

    this.#root.append(this.buildBands(), this.buildRaking());
    this.#measureButton = this.buildMeasure();
    this.#root.append(this.#measureButton);

    mount.append(this.#root);
  }

  private group(labelText: string): HTMLDivElement {
    const group = document.createElement('div');
    group.className = 'group';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = labelText;
    group.append(label);
    return group;
  }

  private buildBands(): HTMLDivElement {
    const group = this.group('Band');
    const bands = document.createElement('div');
    bands.className = 'bands';
    for (const variant of this.#host.variants) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'band';
      button.textContent = variant.label;
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => this.#host.selectVariant(variant.id));
      this.#bands.set(variant.id, button);
      bands.append(button);
    }
    group.append(bands);
    return group;
  }

  private buildRaking(): HTMLDivElement {
    const group = this.group('Raking light');
    group.append(
      this.slider('Az', 0, 360, Math.round(this.#host.raking.azimuth), '°', (az) =>
        this.#host.setRakingLight(az, this.#currentElevation()),
      ),
      this.slider('El', 0, 90, Math.round(this.#host.raking.elevation), '°', (el) =>
        this.#host.setRakingLight(this.#currentAzimuth(), el),
      ),
    );
    return group;
  }

  #azInput!: HTMLInputElement;
  #elInput!: HTMLInputElement;

  private slider(
    name: string,
    min: number,
    max: number,
    value: number,
    unit: string,
    onInput: (value: number) => void,
  ): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'slider';
    const tag = document.createElement('span');
    tag.textContent = name;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.value = String(value);
    input.setAttribute('aria-label', `${name === 'Az' ? 'Azimuth' : 'Elevation'} (degrees)`);
    const output = document.createElement('output');
    output.textContent = `${value}${unit}`;
    input.addEventListener('input', () => {
      const v = Number(input.value);
      output.textContent = `${v}${unit}`;
      onInput(v);
    });
    if (name === 'Az') {
      this.#azInput = input;
    } else {
      this.#elInput = input;
    }
    row.append(tag, input, output);
    return row;
  }

  #currentAzimuth(): number {
    return Number(this.#azInput.value);
  }
  #currentElevation(): number {
    return Number(this.#elInput.value);
  }

  private buildMeasure(): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'measure';
    button.textContent = 'Measure';
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () =>
      this.#host.setMeasuring(button.getAttribute('aria-pressed') !== 'true'),
    );
    return button;
  }

  /** Reflect the active variant on the band buttons. */
  setActiveVariant(id: string): void {
    for (const [variantId, button] of this.#bands) {
      button.setAttribute('aria-pressed', String(variantId === id));
    }
  }

  /** Reflect measure-mode state on the toggle. */
  setMeasuring(on: boolean): void {
    this.#measureButton.setAttribute('aria-pressed', String(on));
  }

  dispose(): void {
    this.#root.remove();
  }
}
