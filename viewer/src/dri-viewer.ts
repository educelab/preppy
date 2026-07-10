// The <dri-viewer> custom element.
//
// The element owns attributes/events/DOM; the three.js rendering core (Viewer) is
// created on connect and disposed on disconnect. Loading, switching, and measurement
// build on the Viewer in Phase 2+.

import type { Object3D } from 'three';
import { Viewer } from './viewer';
import { CSS_TEXT } from './styles';
import { Controls } from './controls';
import { MeasureTool, type MeasureResult } from './measure';
import {
  type Manifest,
  type Variant,
  fetchManifest,
  resolveVariant,
  resolveVariantUrl,
} from './manifest';

/** Detail payload of the `variant-change` event. */
export interface VariantChangeDetail {
  /** The now-active variant `id`. */
  id: string;
}

/** Typed `variant-change` CustomEvent. */
export type VariantChangeEvent = CustomEvent<VariantChangeDetail>;

/** Typed `measure` CustomEvent, dispatched when a two-point measurement completes. */
export type MeasureEvent = CustomEvent<MeasureResult>;

const TAG_NAME = 'dri-viewer';

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
      sheet.replaceSync(CSS_TEXT);
    }
    root.adoptedStyleSheets = [sheet];
  } else {
    const el = document.createElement('style');
    el.textContent = CSS_TEXT;
    root.append(el);
  }
}

export class DriViewer extends HTMLElement {
  static readonly observedAttributes = ['manifest', 'variant', 'ui'] as const;

  /** Container for the renderer canvas and any UI overlays. */
  readonly #stage: HTMLDivElement;

  /** The three.js rendering core; null before connect or if WebGL init failed. */
  #viewer: Viewer | null = null;

  /** The active manifest and the base URL its variant `uri`s resolve against. */
  #manifest: Manifest | null = null;
  #baseUrl = '';
  /** Inline manifest set via the `.manifestData` property (bypasses fetching). */
  #inlineManifest: Manifest | null = null;
  /** The variant currently shown (guards against reacting to our own attr writes). */
  #activeVariantId = '';
  /** Monotonic load generation so a slow load can't clobber a newer one. */
  #loadToken = 0;
  /**
   * Loaded variant models keyed by variant `id`, in LRU order (most-recently-used last).
   * KTX2 textures stay GPU-compressed here, so switching is instant and the geometry /
   * texture is not re-fetched. The element owns these models' lifecycle.
   */
  readonly #cache = new Map<string, Object3D>();
  /** Cache cap; 0 (default) keeps every variant resident. See `maxCachedVariants`. */
  #maxCached = 0;

  /** Built-in control cluster (null when ui="none" or before a manifest loads). */
  #controls: Controls | null = null;
  /** Two-point measurement tool (created with the Viewer). */
  #measure: MeasureTool | null = null;
  #measuring = false;

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

  /** The `id` of the variant currently displayed (empty until one is shown). */
  get activeVariant(): string {
    return this.#activeVariantId;
  }

  /** Render + camera stats for diagnostics / verification; null if not rendering. */
  getRenderStats(): ReturnType<Viewer['getRenderStats']> | null {
    return this.#viewer?.getRenderStats() ?? null;
  }

  /** Camera + controls state, for the camera-preservation check; null if not rendering. */
  getCameraState(): ReturnType<Viewer['getCameraState']> | null {
    return this.#viewer?.getCameraState() ?? null;
  }

  /** Number of variant models currently resident in the cache (diagnostics / tests). */
  get cachedVariantCount(): number {
    return this.#cache.size;
  }

  /**
   * Max number of variant models kept resident. 0 (default) keeps all variants cached
   * for instant switching (a handful of 8K KTX2 variants coexist comfortably). Set a
   * positive cap to LRU-evict when many large variants would otherwise exhaust memory.
   */
  get maxCachedVariants(): number {
    return this.#maxCached;
  }
  set maxCachedVariants(value: number) {
    this.#maxCached = Math.max(0, Math.floor(value));
    this.#evictIfNeeded(this.#activeVariantId);
  }

  /**
   * The active manifest object. Set this to render an inline / programmatic manifest
   * without a network fetch (takes precedence over the `manifest` attribute).
   */
  get manifestData(): Manifest | null {
    return this.#manifest;
  }
  set manifestData(manifest: Manifest | null) {
    this.#inlineManifest = manifest;
    if (this.isConnected) {
      void this.reload();
    }
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
      this.emitError(error);
      return;
    }
    this.#measure = new MeasureTool(this.#viewer, this.#stage);
    this.#measure.onMeasure((result) => this.#onMeasureComplete(result));
    void this.reload();
  }

  disconnectedCallback(): void {
    this.#destroyControls();
    this.#measure?.dispose();
    this.#measure = null;
    this.#measuring = false;
    this.#clearCache();
    this.#viewer?.dispose();
    this.#viewer = null;
    this.#manifest = null;
    this.#activeVariantId = '';
  }

  attributeChangedCallback(
    name: (typeof DriViewer.observedAttributes)[number],
    oldValue: string | null,
    newValue: string | null,
  ): void {
    if (oldValue === newValue || !this.#viewer) {
      return;
    }
    if (name === 'manifest') {
      void this.reload();
    } else if (name === 'variant') {
      // Switch to the requested variant, preserving the camera. Skip when it already
      // matches what's shown (e.g. our own reflected write of the resolved default).
      if (newValue && newValue !== this.#activeVariantId) {
        void this.switchTo(newValue);
      }
    } else if (name === 'ui') {
      if (this.#manifest) {
        this.#syncControls();
      }
    }
  }

  // --- Loading --------------------------------------------------------------

  /**
   * Resolve the active manifest (inline property or `manifest` attribute) and show the
   * selected variant (the `variant` attribute, else the default), framing the camera.
   * Safe to call repeatedly; a newer call supersedes an in-flight one.
   */
  protected async reload(): Promise<void> {
    const viewer = this.#viewer;
    if (!viewer) {
      return;
    }
    const token = ++this.#loadToken;
    // A (re)load implies a (possibly) new manifest — the old variants no longer apply.
    this.#clearCache();
    try {
      if (this.#inlineManifest) {
        this.#manifest = this.#inlineManifest;
        this.#baseUrl = document.baseURI;
      } else if (this.manifest) {
        const { manifest, baseUrl } = await fetchManifest(this.manifest);
        if (token !== this.#loadToken) {
          return;
        }
        this.#manifest = manifest;
        this.#baseUrl = baseUrl;
      } else {
        return; // nothing to load yet
      }
      this.#measure?.setUnit(this.#manifest.units);
      this.#syncControls();
      await this.showVariant(this.variant || undefined, { frame: true, token });
      this.#preloadOthers(token);
    } catch (error) {
      if (token === this.#loadToken) {
        this.emitError(error);
      }
    }
  }

  /**
   * Switch to variant `id`, preserving the camera/controls (frame: false). A newer call
   * supersedes an in-flight one.
   */
  protected async switchTo(id: string): Promise<void> {
    const token = ++this.#loadToken;
    try {
      await this.showVariant(id, { frame: false, token });
    } catch (error) {
      if (token === this.#loadToken) {
        this.emitError(error);
      }
    }
  }

  /**
   * Load and display a variant by `id` (or the manifest default when omitted), from the
   * cache when present. `frame` frames the camera (initial load only); `token` guards a
   * stale load from winning. Reflects the active id to the `variant` attribute and emits
   * `variant-change`.
   */
  protected async showVariant(
    id: string | undefined,
    { frame = false, token = this.#loadToken }: { frame?: boolean; token?: number } = {},
  ): Promise<void> {
    const viewer = this.#viewer;
    const manifest = this.#manifest;
    if (!viewer || !manifest) {
      return;
    }
    const variant = resolveVariant(manifest, id);
    const model = await this.#loadVariantModel(variant);
    if (token !== this.#loadToken) {
      return; // superseded — the model stays cached for a later switch
    }
    viewer.setModel(model, { frame });
    this.#activeVariantId = variant.id;
    this.#controls?.setActiveVariant(variant.id);
    if (this.getAttribute('variant') !== variant.id) {
      this.setAttribute('variant', variant.id); // reflect for deep-linking (guarded above)
    }
    this.emitVariantChange(variant.id);
  }

  // --- Cache / preload ------------------------------------------------------

  /** Return the variant's model from cache (LRU-touched) or load, cache, and evict. */
  async #loadVariantModel(variant: Variant): Promise<Object3D> {
    const cached = this.#cache.get(variant.id);
    if (cached) {
      this.#cache.delete(variant.id);
      this.#cache.set(variant.id, cached); // move to MRU end
      return cached;
    }
    const url = resolveVariantUrl(variant, this.#baseUrl);
    const model = await this.#viewer!.loadModel(url);
    this.#cache.set(variant.id, model);
    this.#evictIfNeeded(variant.id);
    return model;
  }

  /** Preload the remaining variants into cache after the default is shown (idle-ish). */
  #preloadOthers(token: number): void {
    const manifest = this.#manifest;
    // Only worth preloading when the cache is unbounded enough to hold them.
    if (!manifest || (this.#maxCached > 0 && this.#maxCached < manifest.variants.length)) {
      return;
    }
    void (async () => {
      for (const variant of manifest.variants) {
        if (token !== this.#loadToken || !this.isConnected || this.#cache.has(variant.id)) {
          if (token !== this.#loadToken || !this.isConnected) {
            return;
          }
          continue;
        }
        try {
          await this.#loadVariantModel(variant);
        } catch {
          // Preload is best-effort; a failed variant surfaces if the user selects it.
        }
      }
    })();
  }

  /** Evict least-recently-used models past the cap, never the active/just-loaded one. */
  #evictIfNeeded(keepId: string): void {
    if (this.#maxCached <= 0) {
      return;
    }
    for (const id of [...this.#cache.keys()]) {
      if (this.#cache.size <= this.#maxCached) {
        break;
      }
      if (id === keepId || id === this.#activeVariantId) {
        continue;
      }
      const model = this.#cache.get(id)!;
      this.#cache.delete(id);
      this.#viewer?.disposeModel(model);
    }
  }

  /** Dispose and drop every cached model. */
  #clearCache(): void {
    for (const model of this.#cache.values()) {
      this.#viewer?.disposeModel(model);
    }
    this.#cache.clear();
  }

  // --- Measurement & lighting ----------------------------------------------

  /** Whether two-point measure mode is active. */
  get measuring(): boolean {
    return this.#measuring;
  }

  /** Enter/leave two-point measure mode (clicks pick surface points → distance in cm). */
  setMeasuring(on: boolean): void {
    if (!this.#measure || on === this.#measuring) {
      return;
    }
    this.#measuring = on;
    if (on) {
      this.#measure.enable();
    } else {
      this.#measure.disable();
    }
    this.#stage.dataset['measuring'] = String(on);
    this.#controls?.setMeasuring(on);
  }

  /**
   * Aim the raking key light. `azimuth` sweeps around the surface normal (deg); low
   * `elevation` (deg, grazing) exaggerates relief. No-op if not rendering.
   */
  setRakingLight(azimuth: number, elevation: number): void {
    this.#viewer?.setRakingLight(azimuth, elevation);
  }

  /** Current raking-light angles (degrees), or null if not rendering. */
  getRakingLight(): { azimuth: number; elevation: number } | null {
    return this.#viewer?.getRakingLight() ?? null;
  }

  #onMeasureComplete(result: MeasureResult): void {
    this.dispatchEvent(
      new CustomEvent<MeasureResult>('measure', {
        detail: result,
        bubbles: true,
        composed: true,
      }),
    );
  }

  // --- Built-in controls ----------------------------------------------------

  /** True unless the `ui` attribute opts out of built-in chrome (ui="none"). */
  #wantsControls(): boolean {
    return !this.ui.split(/\s+/).includes('none');
  }

  /** Build, rebuild, or tear down the control cluster to match manifest + ui state. */
  #syncControls(): void {
    this.#destroyControls();
    if (!this.#viewer || !this.#manifest || !this.#wantsControls()) {
      return;
    }
    const raking = this.#viewer.getRakingLight();
    this.#controls = new Controls(this.#stage, {
      variants: this.#manifest.variants.map((v) => ({ id: v.id, label: v.label })),
      raking,
      selectVariant: (id) => {
        this.variant = id;
      },
      setRakingLight: (az, el) => this.setRakingLight(az, el),
      setMeasuring: (on) => this.setMeasuring(on),
    });
    if (this.#activeVariantId) {
      this.#controls.setActiveVariant(this.#activeVariantId);
    }
    this.#controls.setMeasuring(this.#measuring);
  }

  #destroyControls(): void {
    this.#controls?.dispose();
    this.#controls = null;
  }

  // --- Events ---------------------------------------------------------------

  /** Dispatch a composed, bubbling `error` event carrying the underlying error. */
  protected emitError(error: unknown): void {
    this.dispatchEvent(
      new CustomEvent('error', {
        detail: { error },
        bubbles: true,
        composed: true,
      }),
    );
  }

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
    measure: MeasureEvent;
  }
}
