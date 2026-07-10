// The built-in control cluster: an icon bar of the band (layer) pickers plus popover
// panels — Tools (pan/measure/clear), Light (raking "light ball"), Adjust
// (brightness/contrast) — and a reset-view button.
//
// Shown by default (ui !== "none"); a host that wants its own chrome sets ui="none" and
// drives the element via attributes/methods/events instead. The panel is decoupled from
// the element behind ControlsHost so it stays simple and unit-testable.
//
// Responsive (Phase 11): a container query docks the bar to the bottom edge below a
// width breakpoint. There the band pickers stay visible (the primary control) and the
// rest tuck behind an expand toggle (⋯). The band pickers are kept INLINE rather than
// popover-ized: the docked layout is meant to *show* them, and hiding the primary
// layer switch behind a tap would work against feedback #5.

import { LightDial } from './light-dial';
import { PopoverButton, PopoverGroup } from './popover';
import type { ImageAdjust } from './image-adjust';

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
  /** Initial brightness/contrast for the active variant (slider units). */
  readonly imageAdjust: ImageAdjust;
  /** Set the active variant's brightness/contrast. */
  setImageAdjust(adjust: ImageAdjust): void;
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
  #adjust!: PopoverButton;
  #brightnessInput!: HTMLInputElement;
  #contrastInput!: HTMLInputElement;
  #brightnessOut!: HTMLOutputElement;
  #contrastOut!: HTMLOutputElement;
  #tools!: PopoverButton;
  #expandToggle!: HTMLButtonElement;
  #expanded = false;

  constructor(mount: ParentNode, host: ControlsHost) {
    this.#host = host;
    this.#root = document.createElement('div');
    this.#root.className = 'ui';
    this.#root.setAttribute('part', 'controls');

    this.#root.append(this.buildBands(), this.buildSecondary(), this.buildExpandToggle());

    mount.append(this.#root);
  }

  /** The band (layer) pickers — inline amber pills, the primary control (kept visible). */
  private buildBands(): HTMLDivElement {
    const bands = document.createElement('div');
    bands.className = 'bands';
    bands.setAttribute('role', 'group');
    bands.setAttribute('aria-label', 'Band');
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
    return bands;
  }

  /** The tuck-away controls: Tools + Light + Adjust popovers and reset-view. */
  private buildSecondary(): HTMLDivElement {
    const secondary = document.createElement('div');
    secondary.className = 'secondary';

    // Reset-view (Task 9.4): reframe the camera on the current model.
    const resetView = document.createElement('button');
    resetView.type = 'button';
    resetView.className = 'tool reset-view';
    resetView.textContent = '⤢';
    resetView.setAttribute('aria-label', 'Reset view');
    resetView.title = 'Reset view';
    resetView.addEventListener('click', () => this.#host.resetView());

    secondary.append(
      this.buildToolsPopover(),
      this.buildLightPopover(),
      this.buildAdjustPopover(),
      resetView,
    );
    return secondary;
  }

  /** The ⊙ Tools popover: pan + measure toggles and the (conditional) Clear button. */
  private buildToolsPopover(): HTMLDivElement {
    this.#tools = new PopoverButton({
      icon: '⊙',
      label: 'Tools',
      group: this.#popovers,
      buttonClass: 'tools',
    });

    const head = document.createElement('div');
    head.className = 'panel-head';
    const title = document.createElement('span');
    title.className = 'panel-title';
    title.textContent = 'Tools';
    head.append(title);

    const body = document.createElement('div');
    body.className = 'tools-panel';

    // Pan (hand) toggle: makes left-drag pan a first-class gesture for reading the
    // surface up close, alongside the always-on right-drag pan.
    this.#panButton = document.createElement('button');
    this.#panButton.type = 'button';
    this.#panButton.className = 'tool pan';
    this.#panButton.textContent = 'Pan';
    this.#panButton.title = 'Pan (drag). Right-drag always pans.';
    this.#panButton.setAttribute('aria-pressed', 'false');
    this.#panButton.addEventListener('click', () => {
      const on = this.#panButton.getAttribute('aria-pressed') !== 'true';
      this.#host.setPanMode(on);
      if (on) {
        this.#tools.setOpen(false); // free the canvas for the gesture
      }
    });

    this.#measureButton = document.createElement('button');
    this.#measureButton.type = 'button';
    this.#measureButton.className = 'tool measure';
    this.#measureButton.textContent = 'Measure';
    this.#measureButton.setAttribute('aria-pressed', 'false');
    this.#measureButton.addEventListener('click', () => {
      const on = this.#measureButton.getAttribute('aria-pressed') !== 'true';
      this.#host.setMeasuring(on);
      if (on) {
        this.#tools.setOpen(false); // free the canvas for picking points
      }
    });

    // Clear is shown only when a measurement is on screen, so a measurement can persist
    // through orbit/pan/zoom and be dismissed explicitly (Task 6).
    this.#clearButton = document.createElement('button');
    this.#clearButton.type = 'button';
    this.#clearButton.className = 'measure-clear';
    this.#clearButton.textContent = 'Clear measurement';
    this.#clearButton.hidden = true;
    this.#clearButton.addEventListener('click', () => this.#host.clearMeasurement());

    body.append(this.#panButton, this.#measureButton, this.#clearButton);
    this.#tools.panel.append(head, body);
    return this.#tools.root;
  }

  /** The ⋯ expand toggle: reveals the tuck-away controls in the compact docked layout. */
  private buildExpandToggle(): HTMLButtonElement {
    this.#expandToggle = document.createElement('button');
    this.#expandToggle.type = 'button';
    this.#expandToggle.className = 'tool expand-toggle';
    this.#expandToggle.textContent = '⋯';
    this.#expandToggle.setAttribute('aria-label', 'More controls');
    this.#expandToggle.setAttribute('aria-expanded', 'false');
    this.#expandToggle.addEventListener('click', () => this.#setExpanded(!this.#expanded));
    return this.#expandToggle;
  }

  #setExpanded(on: boolean): void {
    this.#expanded = on;
    this.#expandToggle.setAttribute('aria-expanded', String(on));
    if (on) {
      this.#root.dataset['expanded'] = 'true';
    } else {
      delete this.#root.dataset['expanded'];
      this.#popovers.closeAll(); // collapsing hides the triggers; don't strand a popover
    }
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

  /** The ◑ Adjust popover: per-variant brightness + contrast sliders (−100…+100). */
  private buildAdjustPopover(): HTMLDivElement {
    this.#adjust = new PopoverButton({
      icon: '◑',
      label: 'Image adjust',
      group: this.#popovers,
      buttonClass: 'adjust',
    });

    const head = document.createElement('div');
    head.className = 'panel-head';
    const title = document.createElement('span');
    title.className = 'panel-title';
    title.textContent = 'Image adjust';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'panel-reset';
    reset.textContent = 'Reset';
    reset.addEventListener('click', () => this.#resetAdjust());
    head.append(title, reset);

    const body = document.createElement('div');
    body.className = 'adjust-panel';
    // Double-click anywhere in the body resets (image-editor convention).
    body.addEventListener('dblclick', () => this.#resetAdjust());

    const b = this.#adjustSlider('Brightness', this.#host.imageAdjust.brightness);
    const c = this.#adjustSlider('Contrast', this.#host.imageAdjust.contrast);
    this.#brightnessInput = b.input;
    this.#brightnessOut = b.output;
    this.#contrastInput = c.input;
    this.#contrastOut = c.output;
    body.append(b.row, c.row);

    this.#adjust.panel.append(head, body);
    return this.#adjust.root;
  }

  /** A labelled −100…+100 adjust slider (0 = identity) wired to the single sink. */
  #adjustSlider(
    name: string,
    value: number,
  ): { row: HTMLDivElement; input: HTMLInputElement; output: HTMLOutputElement } {
    const row = document.createElement('div');
    row.className = 'adjust-row';
    const tag = document.createElement('span');
    tag.className = 'adjust-tag';
    tag.textContent = name;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '-100';
    input.max = '100';
    input.value = String(Math.round(value));
    input.setAttribute('aria-label', name);
    const output = document.createElement('output');
    output.textContent = String(Math.round(value));
    input.addEventListener('input', () => this.#applyAdjust());
    row.append(tag, input, output);
    return { row, input, output };
  }

  /** Push brightness/contrast to the host and refresh the readouts (single sink). */
  #applyAdjust(): void {
    const brightness = Number(this.#brightnessInput.value);
    const contrast = Number(this.#contrastInput.value);
    this.#brightnessOut.textContent = String(brightness);
    this.#contrastOut.textContent = String(contrast);
    this.#host.setImageAdjust({ brightness, contrast });
  }

  /** Zero the active variant's brightness/contrast. */
  #resetAdjust(): void {
    this.#brightnessInput.value = '0';
    this.#contrastInput.value = '0';
    this.#applyAdjust();
  }

  /** Reflect the active variant's brightness/contrast into the sliders (no host call). */
  setImageAdjust(adjust: ImageAdjust): void {
    this.#brightnessInput.value = String(Math.round(adjust.brightness));
    this.#contrastInput.value = String(Math.round(adjust.contrast));
    this.#brightnessOut.textContent = String(Math.round(adjust.brightness));
    this.#contrastOut.textContent = String(Math.round(adjust.contrast));
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
    this.#tools?.dispose();
    this.#light?.dispose();
    this.#dial?.dispose();
    this.#adjust?.dispose();
    this.#root.remove();
  }
}
