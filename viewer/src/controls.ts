// The built-in control chrome: a cluster of floating icon buttons in the TOP-RIGHT of
// the stage that toggle panels docked at fixed screen locations (feedback 2026-07-10).
//
//   top-right buttons : Layers · Light (☀) · Exposure (◑) · Pan · Measure · Reset-view
//                       · Clear (shown only while a measurement is drawn)
//   bottom-left panel : the band (layer) pickers   — open on load (the primary control)
//   bottom-right      : the Light + Exposure panels — stacked when both are open
//
// The buttons are plain TOGGLES, not modals: a panel opens/closes at its dock and is
// otherwise persistent (no click-outside dismissal, no focus trap, no mutual exclusion —
// Light and Exposure can sit stacked together). Panel toggles are disclosures —
// `aria-expanded` + `aria-controls` point at the panel they show (and mirror it on
// `aria-pressed` too); Pan/Measure mirror their mode via `aria-pressed` instead.
//
// Shown by default (ui !== "none"); a host that wants its own chrome sets ui="none" and
// drives the element via attributes/methods/events instead. The panel is decoupled from
// the element behind ControlsHost so it stays simple and unit-testable.

import { LightDial } from './light-dial';
import type { ImageAdjust } from './image-adjust';

/** Raking-light default when the Light panel is reset (matches Viewer's initial rig). */
const RAKING_DEFAULT = { azimuth: 45, elevation: 22 };

/** Format a slider value with an explicit sign for screen readers (+20 / -10 / 0). */
function signed(value: number): string {
  const n = Math.round(value);
  return n > 0 ? `+${n}` : String(n);
}

/** Inline monochrome SVG icons (no web font / CDN). `currentColor` inherits button ink. */
const ICONS: Record<string, string> = {
  // Google Material "layers".
  layers:
    'M11.99 18.54l-7.37-5.73L3 14.07l9 7 9-7-1.63-1.27-7.38 5.74zM12 16l7.36-5.73L21 9l-9-7-9 7 1.63 1.27L12 16z',
  // Material "open_with" (four-way move) for pan.
  pan: 'M10 9V6H7l5-5 5 5h-3v3h-4zM9 10H6V7l-5 5 5 5v-3h3v-4zm6 0v4h3v3l5-5-5-5v3h-3zm-1 5h-4v3H7l5 5 5-5h-3v-3z',
  // Material "straighten" (ruler) for measure.
  measure:
    'M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 10H3V8h2v4h2V8h2v4h2V8h2v4h2V8h2v4h2V8h2v8z',
  // Material "center_focus_strong" (viewfinder brackets + centre dot) for reset-view —
  // reads as "reframe/recentre on the subject", unlike the old expand-arrows glyph
  // (feedback 2026-07-10).
  'reset-view':
    'M5 15H3v4c0 1.1.9 2 2 2h4v-2H5v-4zM5 5h4V3H5c-1.1 0-2 .9-2 2v4h2V5zm14-2h-4v2h4v4h2V5c0-1.1-.9-2-2-2zm0 16h-4v2h4c1.1 0 2-.9 2-2v-4h-2v4zM12 9c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z',
};

/** Build an inline SVG element for `name` (24×24 viewBox, filled with currentColor). */
function svgIcon(name: keyof typeof ICONS): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', ICONS[name]!);
  path.setAttribute('fill', 'currentColor');
  svg.append(path);
  return svg;
}

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

/** A toolbar button bound to a docked panel: clicking toggles the panel's visibility. */
class PanelToggle {
  #open = false;
  constructor(
    readonly button: HTMLButtonElement,
    readonly panel: HTMLElement,
  ) {
    if (panel.id) {
      button.setAttribute('aria-controls', panel.id);
    }
    button.addEventListener('click', () => this.setOpen(!this.#open));
  }
  get open(): boolean {
    return this.#open;
  }
  setOpen(on: boolean): void {
    this.#open = on;
    this.panel.hidden = !on;
    this.button.setAttribute('aria-expanded', String(on)); // disclosure semantics
    this.button.setAttribute('aria-pressed', String(on));
  }
}

export class Controls {
  #host: ControlsHost;
  #root: HTMLDivElement;
  #bands = new Map<string, HTMLButtonElement>();
  #panButton!: HTMLButtonElement;
  #measureButton!: HTMLButtonElement;
  #clearButton!: HTMLButtonElement;
  #layersToggle!: PanelToggle;
  #lightToggle!: PanelToggle;
  #adjustToggle!: PanelToggle;
  #dial!: LightDial;
  #azReadout!: HTMLSpanElement;
  #elReadout!: HTMLSpanElement;
  #brightnessInput!: HTMLInputElement;
  #contrastInput!: HTMLInputElement;
  #brightnessOut!: HTMLOutputElement;
  #contrastOut!: HTMLOutputElement;

  constructor(mount: ParentNode, host: ControlsHost) {
    this.#host = host;
    this.#root = document.createElement('div');
    this.#root.className = 'ui';
    this.#root.setAttribute('part', 'controls');

    // Docked panels live in fixed corners; the toolbar floats top-right and toggles them.
    const bandsPanel = this.buildBandsPanel();
    const lightPanel = this.buildLightPanel();
    const adjustPanel = this.buildAdjustPanel();

    const dockBL = document.createElement('div');
    dockBL.className = 'dock dock-bl';
    dockBL.append(bandsPanel);

    const dockBR = document.createElement('div');
    dockBR.className = 'dock dock-br';
    dockBR.append(lightPanel, adjustPanel);

    this.#root.append(this.buildToolbar(bandsPanel, lightPanel, adjustPanel), dockBL, dockBR);

    // Bands open on load (the primary control); Light/Exposure closed until toggled.
    this.#layersToggle.setOpen(true);
    this.#lightToggle.setOpen(false);
    this.#adjustToggle.setOpen(false);

    mount.append(this.#root);
  }

  /** The floating top-right icon buttons that toggle panels / drive tool modes. */
  private buildToolbar(
    bandsPanel: HTMLElement,
    lightPanel: HTMLElement,
    adjustPanel: HTMLElement,
  ): HTMLDivElement {
    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';

    // Layers → bands panel (bottom-left). Uses the Material "layers" glyph.
    const layers = this.#iconButton('layers', 'Layers', svgIcon('layers'));
    this.#layersToggle = new PanelToggle(layers, bandsPanel);

    // Light → raking-light panel (bottom-right).
    const light = this.#iconButton('light', 'Raking light', '☀');
    this.#lightToggle = new PanelToggle(light, lightPanel);

    // Exposure → brightness/contrast panel (bottom-right, stacks with Light).
    const adjust = this.#iconButton('adjust', 'Exposure', '◑');
    this.#adjustToggle = new PanelToggle(adjust, adjustPanel);

    // Pan / Measure are mutually-exclusive mode toggles (both claim left-drag).
    this.#panButton = this.#iconButton('pan', 'Pan (drag). Right-drag always pans.', svgIcon('pan'));
    this.#panButton.setAttribute('aria-pressed', 'false');
    this.#panButton.addEventListener('click', () => {
      this.#host.setPanMode(this.#panButton.getAttribute('aria-pressed') !== 'true');
    });

    this.#measureButton = this.#iconButton('measure', 'Measure', svgIcon('measure'));
    this.#measureButton.setAttribute('aria-pressed', 'false');
    this.#measureButton.addEventListener('click', () => {
      this.#host.setMeasuring(this.#measureButton.getAttribute('aria-pressed') !== 'true');
    });

    // Reset-view is a plain action (reframe the camera).
    const resetView = this.#iconButton('reset-view', 'Reset view', svgIcon('reset-view'));
    resetView.addEventListener('click', () => this.#host.resetView());

    // Clear removes the drawn measurement; only shown while one exists.
    this.#clearButton = this.#iconButton('measure-clear', 'Clear measurement', '✕');
    this.#clearButton.hidden = true;
    this.#clearButton.addEventListener('click', () => this.#host.clearMeasurement());

    toolbar.append(
      layers,
      light,
      adjust,
      this.#panButton,
      this.#measureButton,
      resetView,
      this.#clearButton,
    );
    return toolbar;
  }

  /** A square icon-only toolbar button (`content` is an SVG element or a glyph string). */
  #iconButton(className: string, label: string, content: SVGSVGElement | string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `tbtn ${className}`;
    button.setAttribute('aria-label', label);
    button.title = label;
    if (typeof content === 'string') {
      const glyph = document.createElement('span');
      glyph.className = 'glyph';
      glyph.setAttribute('aria-hidden', 'true');
      glyph.textContent = content;
      button.append(glyph);
    } else {
      button.append(content);
    }
    return button;
  }

  /** The band (layer) pickers — inline amber pills — docked bottom-left. */
  private buildBandsPanel(): HTMLDivElement {
    const panel = document.createElement('div');
    panel.className = 'panel bands-panel';
    panel.id = 'dri-panel-layers';
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
    panel.append(bands);
    return panel;
  }

  /** The raking-light panel: the shaded-sphere dial (puck sets azimuth + elevation). */
  private buildLightPanel(): HTMLDivElement {
    const panel = document.createElement('div');
    panel.className = 'panel light-panel';
    panel.id = 'dri-panel-light';
    panel.hidden = true;
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-labelledby', 'dri-panel-light-title');

    const head = document.createElement('div');
    head.className = 'panel-head';
    const title = document.createElement('span');
    title.className = 'panel-title';
    title.id = 'dri-panel-light-title';
    title.textContent = 'Raking light';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'panel-reset';
    reset.textContent = 'Reset';
    reset.addEventListener('click', () => this.#resetLight());
    head.append(title, reset);

    const body = document.createElement('div');
    body.className = 'light-body';
    this.#dial = new LightDial({
      azimuth: this.#host.raking.azimuth,
      elevation: this.#host.raking.elevation,
      onInput: (az, el) => this.#applyRaking(az, el),
      onReset: () => this.#resetLight(),
    });
    body.append(this.#dial.root);

    // Numeric az/el readouts.
    const readout = document.createElement('div');
    readout.className = 'light-readout';
    this.#azReadout = document.createElement('span');
    this.#elReadout = document.createElement('span');
    this.#updateReadout(this.#host.raking.azimuth, this.#host.raking.elevation);
    readout.append(this.#labelled('Az', this.#azReadout), this.#labelled('El', this.#elReadout));

    panel.append(head, body, readout);
    return panel;
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
    this.#applyRaking(RAKING_DEFAULT.azimuth, RAKING_DEFAULT.elevation);
  }

  /** The Exposure panel: per-variant brightness + contrast sliders (−100…+100). */
  private buildAdjustPanel(): HTMLDivElement {
    const panel = document.createElement('div');
    panel.className = 'panel adjust-panel';
    panel.id = 'dri-panel-exposure';
    panel.hidden = true;
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-labelledby', 'dri-panel-exposure-title');

    const head = document.createElement('div');
    head.className = 'panel-head';
    const title = document.createElement('span');
    title.className = 'panel-title';
    title.id = 'dri-panel-exposure-title';
    title.textContent = 'Exposure';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'panel-reset';
    reset.textContent = 'Reset';
    reset.addEventListener('click', () => this.#resetAdjust());
    head.append(title, reset);

    const body = document.createElement('div');
    body.className = 'adjust-body';
    // Double-click anywhere in the body resets (image-editor convention).
    body.addEventListener('dblclick', () => this.#resetAdjust());

    const b = this.#adjustSlider('Brightness', this.#host.imageAdjust.brightness);
    const c = this.#adjustSlider('Contrast', this.#host.imageAdjust.contrast);
    this.#brightnessInput = b.input;
    this.#brightnessOut = b.output;
    this.#contrastInput = c.input;
    this.#contrastOut = c.output;
    body.append(b.row, c.row);

    panel.append(head, body);
    return panel;
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
    input.id = `dri-adjust-${name.toLowerCase()}`;
    input.setAttribute('aria-label', name);
    input.setAttribute('aria-valuetext', signed(value));  // voice signed values (+20 / −10)
    const output = document.createElement('output');
    output.setAttribute('for', input.id);                 // native output↔input association
    output.textContent = String(Math.round(value));
    input.addEventListener('input', () => {
      input.setAttribute('aria-valuetext', signed(Number(input.value)));
      this.#applyAdjust();
    });
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
    this.#dial?.dispose();
    this.#root.remove();
  }
}
