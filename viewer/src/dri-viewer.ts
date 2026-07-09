// The <dri-viewer> custom element.
//
// The element owns attributes/events/DOM; the three.js rendering core (Viewer) is
// created on connect and disposed on disconnect. Loading, switching, and measurement
// build on the Viewer in Phase 2+.

import { Viewer } from './viewer';

/** Detail payload of the `variant-change` event. */
export interface VariantChangeDetail {
  /** The now-active variant `id`. */
  id: string;
}

/** Typed `variant-change` CustomEvent. */
export type VariantChangeEvent = CustomEvent<VariantChangeDetail>;

const TAG_NAME = 'dri-viewer';

// Host sizing: the element is a block that the host page sizes (width/height via
// CSS). The stage fills it and hosts the renderer canvas. `position: relative` so
// absolutely-positioned overlays (controls, measurement labels) anchor to the stage.
const STYLE = `
:host {
  display: block;
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 240px;
  overflow: hidden;
  contain: content;
  background: #15171c;
}
:host([hidden]) { display: none; }
.stage {
  position: absolute;
  inset: 0;
}
.stage canvas {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
}
`;

let sheet: CSSStyleSheet | null = null;

/** True when the platform supports constructable + adopted stylesheets. */
function supportsAdopted(): boolean {
  return (
    typeof CSSStyleSheet !== 'undefined' &&
    'replaceSync' in CSSStyleSheet.prototype &&
    'adoptedStyleSheets' in ShadowRoot.prototype
  );
}

/** Apply the host stylesheet to a shadow root (adopted sheet, or a `<style>` fallback). */
function applyStyle(root: ShadowRoot): void {
  if (supportsAdopted()) {
    if (!sheet) {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(STYLE);
    }
    root.adoptedStyleSheets = [sheet];
  } else {
    const el = document.createElement('style');
    el.textContent = STYLE;
    root.append(el);
  }
}

export class DriViewer extends HTMLElement {
  static readonly observedAttributes = ['manifest', 'variant', 'ui'] as const;

  /** Container for the renderer canvas and any UI overlays. */
  readonly #stage: HTMLDivElement;

  /** The three.js rendering core; null before connect or if WebGL init failed. */
  #viewer: Viewer | null = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    applyStyle(root);
    this.#stage = document.createElement('div');
    this.#stage.className = 'stage';
    root.append(this.#stage);
  }

  // --- Reflected attributes -------------------------------------------------

  /** URL of the manifest JSON to load (or empty to load nothing yet). */
  get manifest(): string {
    return this.getAttribute('manifest') ?? '';
  }
  set manifest(value: string) {
    this.setAttribute('manifest', value);
  }

  /** The active variant `id`; empty means "use the manifest default". */
  get variant(): string {
    return this.getAttribute('variant') ?? '';
  }
  set variant(value: string) {
    this.setAttribute('variant', value);
  }

  /** Space-separated UI feature tokens (e.g. "controls measure"); "none" hides chrome. */
  get ui(): string {
    return this.getAttribute('ui') ?? '';
  }
  set ui(value: string) {
    this.setAttribute('ui', value);
  }

  /** The stage element the renderer draws into (canvas host). */
  protected get stage(): HTMLDivElement {
    return this.#stage;
  }

  /** The rendering core, or null if not connected / WebGL unavailable. */
  protected get viewer(): Viewer | null {
    return this.#viewer;
  }

  // --- Lifecycle ------------------------------------------------------------

  connectedCallback(): void {
    if (this.#viewer) {
      return;
    }
    try {
      const transcoderPath = this.getAttribute('transcoder-path') ?? undefined;
      this.#viewer = new Viewer(this.#stage, { transcoderPath });
    } catch (error) {
      // No WebGL (or renderer init failed): stay mounted but non-rendering, and let
      // the host react (e.g. show a fallback image).
      this.dispatchEvent(
        new CustomEvent('error', {
          detail: { error },
          bubbles: true,
          composed: true,
        }),
      );
    }
    // Manifest loading is wired in Phase 2 (Task 2.1).
  }

  disconnectedCallback(): void {
    this.#viewer?.dispose();
    this.#viewer = null;
  }

  attributeChangedCallback(
    _name: (typeof DriViewer.observedAttributes)[number],
    _oldValue: string | null,
    _newValue: string | null,
  ): void {
    // Attribute-driven reloads are wired in Phase 2/3.
  }

  // --- Events ---------------------------------------------------------------

  /**
   * Dispatch `variant-change` carrying the now-active variant `id`. Bubbles and
   * crosses the shadow boundary (`composed`) so host pages can listen on the element.
   */
  protected emitVariantChange(id: string): void {
    this.dispatchEvent(
      new CustomEvent<VariantChangeDetail>('variant-change', {
        detail: { id },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

/** Register the element (idempotent). Called for its side effect from index.ts. */
export function defineDriViewer(): void {
  if (!customElements.get(TAG_NAME)) {
    customElements.define(TAG_NAME, DriViewer);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'dri-viewer': DriViewer;
  }
  interface HTMLElementEventMap {
    'variant-change': VariantChangeEvent;
  }
}
