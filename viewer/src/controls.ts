// The built-in control cluster: band selector, tool row (pan/measure/clear), and
// popover panels (Light, and — Phase 10 — Adjust).
//
// Shown by default (ui !== "none"); a host that wants its own chrome sets ui="none" and
// drives the element via attributes/methods/events instead. The panel is decoupled from
// the element behind ControlsHost so it stays simple and unit-testable. The raking-light
// controls live in a popover behind a ☀ button (the "light ball", Phase 9): a
// shaded-sphere azimuth dial + a vertical elevation slider.

import { LightDial } from './light-dial';
import { PopoverButton, PopoverGroup } from './popover';

/** Raking-light default when the Light panel is reset (matches Viewer's initial rig). */
const RAKING_DEFAULT = { azimuth: 45, elevation: 22 };

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
  /** Remove the drawn measurement. */
  clearMeasurement(): void;
  /** Toggle pan mode (left-drag pans instead of orbiting). */
  setPanMode(on: boolean): void;
  /** Reframe the camera on the current model (reset view). */
  resetView(): void;
}

export class Controls {
  #host: ControlsHost;
  #root: HTMLDivElement;
  #bands = new Map<string, HTMLButtonElement>();
  #panButton!: HTMLButtonElement;
  #measureButton!: HTMLButtonElement;
  #clearButton!: HTMLButtonElement;
  #popovers = new PopoverGroup();
  #light!: PopoverButton;
  #dial!: LightDial;
  #elInput!: HTMLInputElement;
  #azReadout!: HTMLSpanElement;
  #elReadout!: HTMLSpanElement;

  constructor(mount: ParentNode, host: ControlsHost) {
    this.#host = host;
    this.#root = document.createElement('div');
    this.#root.className = 'ui';
    this.#root.setAttribute('part', 'controls');

    this.#root.append(this.buildBands(), this.buildToolRow());

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

  private buildToolRow(): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'tool-row';

    // Pan (hand) toggle: makes left-drag pan a first-class gesture for reading the
    // surface up close, alongside the always-on right-drag pan.
    this.#panButton = document.createElement('button');
    this.#panButton.type = 'button';
    this.#panButton.className = 'tool pan';
    this.#panButton.textContent = 'Pan';
    this.#panButton.title = 'Pan (drag). Right-drag always pans.';
    this.#panButton.setAttribute('aria-pressed', 'false');
    this.#panButton.addEventListener('click', () =>
      this.#host.setPanMode(this.#panButton.getAttribute('aria-pressed') !== 'true'),
    );

    this.#measureButton = document.createElement('button');
    this.#measureButton.type = 'button';
    this.#measureButton.className = 'tool measure';
    this.#measureButton.textContent = 'Measure';
    this.#measureButton.setAttribute('aria-pressed', 'false');
    this.#measureButton.addEventListener('click', () =>
      this.#host.setMeasuring(this.#measureButton.getAttribute('aria-pressed') !== 'true'),
    );

    // Clear is shown only when a measurement is on screen, so a measurement can persist
    // through orbit/pan/zoom and be dismissed explicitly (Task 6).
    this.#clearButton = document.createElement('button');
    this.#clearButton.type = 'button';
    this.#clearButton.className = 'measure-clear';
    this.#clearButton.textContent = 'Clear';
    this.#clearButton.hidden = true;
    this.#clearButton.addEventListener('click', () => this.#host.clearMeasurement());

    // Reset-view (Task 9.4): reframe the camera on the current model.
    const resetView = document.createElement('button');
    resetView.type = 'button';
    resetView.className = 'tool reset-view';
    resetView.textContent = '⤢';
    resetView.setAttribute('aria-label', 'Reset view');
    resetView.title = 'Reset view';
    resetView.addEventListener('click', () => this.#host.resetView());

    row.append(
      this.#panButton,
      this.#measureButton,
      this.#clearButton,
      this.buildLightPopover(),
      resetView,
    );
    return row;
  }

  /** The ☀ Light popover: the shaded-sphere azimuth dial + a vertical elevation slider. */
  private buildLightPopover(): HTMLDivElement {
    this.#light = new PopoverButton({
      icon: '☀',
      label: 'Raking light',
      group: this.#popovers,
      buttonClass: 'light',
    });

    const head = document.createElement('div');
    head.className = 'panel-head';
    const title = document.createElement('span');
    title.className = 'panel-title';
    title.textContent = 'Raking light';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'panel-reset';
    reset.textContent = 'Reset';
    reset.addEventListener('click', () => this.#resetLight());
    head.append(title, reset);

    const body = document.createElement('div');
    body.className = 'light-panel';

    this.#dial = new LightDial({
      azimuth: this.#host.raking.azimuth,
      elevation: this.#host.raking.elevation,
      onInput: (az, el) => this.#applyRaking(az, el),
      onReset: () => this.#resetLight(),
    });

    // Vertical elevation slider (grazing at the bottom, straight-on at the top).
    const elCol = document.createElement('div');
    elCol.className = 'light-el';
    const capTop = document.createElement('span');
    capTop.className = 'el-cap';
    capTop.textContent = '90°';
    const track = document.createElement('div');
    track.className = 'el-track';
    this.#elInput = document.createElement('input');
    this.#elInput.type = 'range';
    this.#elInput.min = '0';
    this.#elInput.max = '90';
    this.#elInput.value = String(Math.round(this.#host.raking.elevation));
    this.#elInput.setAttribute('aria-label', 'Light elevation (degrees)');
    this.#elInput.addEventListener('input', () =>
      this.#dial.setElevation(Number(this.#elInput.value), true),
    );
    track.append(this.#elInput);
    const capBot = document.createElement('span');
    capBot.className = 'el-cap';
    capBot.textContent = '0°';
    elCol.append(capTop, track, capBot);

    body.append(this.#dial.root, elCol);

    // Numeric az/el readouts.
    const readout = document.createElement('div');
    readout.className = 'light-readout';
    this.#azReadout = document.createElement('span');
    this.#elReadout = document.createElement('span');
    this.#updateReadout(this.#host.raking.azimuth, this.#host.raking.elevation);
    readout.append(this.#labelled('Az', this.#azReadout), this.#labelled('El', this.#elReadout));

    this.#light.panel.append(head, body, readout);
    return this.#light.root;
  }

  #labelled(name: string, value: HTMLSpanElement): HTMLSpanElement {
    const wrap = document.createElement('span');
    const dim = document.createElement('span');
    dim.className = 'dim';
    dim.textContent = `${name} `;
    wrap.append(dim, value);
    return wrap;
  }

  /** Push raking angles to the host and refresh the numeric readout (single sink). */
  #applyRaking(azimuth: number, elevation: number): void {
    this.#updateReadout(azimuth, elevation);
    this.#host.setRakingLight(azimuth, elevation);
  }

  #updateReadout(azimuth: number, elevation: number): void {
    this.#azReadout.textContent = `${Math.round(azimuth)}°`;
    this.#elReadout.textContent = `${Math.round(elevation)}°`;
  }

  /** Return the raking light to its default azimuth/elevation. */
  #resetLight(): void {
    this.#dial.setAzimuth(RAKING_DEFAULT.azimuth);
    this.#dial.setElevation(RAKING_DEFAULT.elevation);
    this.#elInput.value = String(RAKING_DEFAULT.elevation);
    this.#applyRaking(RAKING_DEFAULT.azimuth, RAKING_DEFAULT.elevation);
  }

  /** Show/hide the Clear button to match whether a measurement is drawn. */
  setHasMeasurement(has: boolean): void {
    this.#clearButton.hidden = !has;
  }

  /** Reflect pan-mode state on the toggle. */
  setPanning(on: boolean): void {
    this.#panButton.setAttribute('aria-pressed', String(on));
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
    this.#light?.dispose();
    this.#dial?.dispose();
    this.#root.remove();
  }
}
