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
  installAdjustShader,
  IDENTITY_ADJUST,
  type ImageAdjust,
  type AdjustHandle,
} from './image-adjust';
import { Mesh, type Material } from 'three';
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

/** Detail payload of the `raking-change` event (current raking-light angles, degrees). */
export interface RakingChangeDetail {
  azimuth: number;
  elevation: number;
}

/** Typed `raking-change` CustomEvent (emitted whenever the raking light is re-aimed). */
export type RakingChangeEvent = CustomEvent<RakingChangeDetail>;

/** Detail payload of the `image-adjust-change` event (current variant's adjust). */
export interface ImageAdjustChangeDetail {
  /** The variant `id` the adjustment applies to. */
  id: string;
  /** Brightness in slider units (−100…100; 0 = identity). */
  brightness: number;
  /** Contrast in slider units (−100…100; 0 = identity). */
  contrast: number;
}

/** Typed `image-adjust-change` CustomEvent (per-variant brightness/contrast changed). */
export type ImageAdjustChangeEvent = CustomEvent<ImageAdjustChangeDetail>;

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

  /**
   * Per-variant brightness/contrast, keyed by variant `id` (in-memory, viewer-only).
   * Survives LRU eviction (re-applied when the model reloads) but is cleared on a new
   * manifest/object. Absent ⇒ identity (0/0).
   */
  readonly #imageAdjust = new Map<string, ImageAdjust>();
  /** Live shader handles per resident variant model; dropped when the model is evicted. */
  readonly #adjustHandles = new Map<string, AdjustHandle[]>();

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

  /** Read one framebuffer pixel (RGBA 0–255) at normalized coords; null if not rendering. */
  samplePixel(nx: number, ny: number): [number, number, number, number] | null {
    return this.#viewer?.samplePixel(nx, ny) ?? null;
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
    this.#measure.onChange(() =>
      this.#controls?.setHasMeasurement(this.#measure?.hasMeasurement ?? false),
    );
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
      // Before a manifest has loaded (e.g. `manifest` + `variant` set in the same tick),
      // defer: the in-flight/upcoming reload() reads `this.variant` and shows it, framed.
      if (this.#manifest && newValue && newValue !== this.#activeVariantId) {
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
    // A (re)load implies a (possibly) new manifest — the old variants no longer apply,
    // and the manifest is not valid again until the new one resolves. Clearing it here
    // lets a `variant` attribute set in the same tick defer to this load (below) instead
    // of racing an empty manifest.
    this.#clearCache();
    this.#manifest = null;
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
    // Reflect this variant's stored brightness/contrast into the Adjust panel.
    this.#controls?.setImageAdjust(this.getImageAdjust());
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
    this.#installImageAdjust(variant.id, model);
    this.#evictIfNeeded(variant.id);
    return model;
  }

  /**
   * Patch the base mesh material(s) with the brightness/contrast shader and apply this
   * variant's stored adjust (identity if none). Markers/lines are added elsewhere (the
   * MeasureTool's own group), so only the model's albedo is touched.
   */
  #installImageAdjust(id: string, model: Object3D): void {
    const handles: AdjustHandle[] = [];
    model.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) {
        return;
      }
      const mats: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        if (mat) {
          handles.push(installAdjustShader(mat));
        }
      }
    });
    this.#adjustHandles.set(id, handles);
    const adjust = this.#imageAdjust.get(id) ?? IDENTITY_ADJUST;
    for (const handle of handles) {
      handle.set(adjust);
    }
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
        if (token !== this.#loadToken || !this.isConnected) {
          return;  // a newer load started or we were disconnected: abandon preload
        }
        if (this.#cache.has(variant.id)) {
          continue;  // already resident
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
      // Drop the model's shader handles (recreated on reload); KEEP its #imageAdjust so
      // the correction is restored if the variant is loaded again (only a new manifest
      // clears the stored state).
      this.#adjustHandles.delete(id);
      this.#viewer?.disposeModel(model);
    }
  }

  /** Dispose and drop every cached model (and, for a new manifest, its adjust state). */
  #clearCache(): void {
    for (const model of this.#cache.values()) {
      this.#viewer?.disposeModel(model);
    }
    this.#cache.clear();
    this.#adjustHandles.clear();
    this.#imageAdjust.clear();
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
    if (on) {
      this.setPanMode(false); // measure + pan both claim left-drag; keep them exclusive
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

  /** Whether pan mode (left-drag pans) is active. */
  get panning(): boolean {
    return this.#viewer?.panning ?? false;
  }

  /** Enter/leave pan mode: left-drag pans instead of orbiting (right-drag always pans). */
  setPanMode(on: boolean): void {
    if (!this.#viewer || on === this.#viewer.panning) {
      return;
    }
    if (on) {
      this.setMeasuring(false); // mutually exclusive with measure (both use left-drag)
    }
    this.#viewer.setPanMode(on);
    this.#stage.dataset['panning'] = String(on);
    this.#controls?.setPanning(on);
  }

  /** Remove the drawn measurement (markers, line, label). Leaves measure mode as-is. */
  clearMeasurement(): void {
    this.#measure?.clear();
  }

  /**
   * Aim the raking key light. `azimuth` sweeps around the surface normal (deg); low
   * `elevation` (deg, grazing) exaggerates relief. No-op if not rendering.
   */
  setRakingLight(azimuth: number, elevation: number): void {
    if (!this.#viewer) {
      return;
    }
    this.#viewer.setRakingLight(azimuth, elevation);
    // Emit the clamped angles the viewer settled on, so ui="none" hosts stay in sync.
    const raking = this.#viewer.getRakingLight();
    this.emitRakingChange(raking.azimuth, raking.elevation);
  }

  /** Current raking-light angles (degrees), or null if not rendering. */
  getRakingLight(): { azimuth: number; elevation: number } | null {
    return this.#viewer?.getRakingLight() ?? null;
  }

  /** Reframe the camera on the current model (reset view); no-op if not rendering. */
  resetView(): void {
    const viewer = this.#viewer;
    const model = viewer?.currentModel;
    if (viewer && model) {
      viewer.frameObject(model);
    }
  }

  /**
   * The active variant's brightness/contrast (slider units, −100…100; 0/0 = identity).
   * Returns identity when nothing is shown. See {@link setImageAdjust}.
   */
  getImageAdjust(): ImageAdjust {
    return { ...(this.#imageAdjust.get(this.#activeVariantId) ?? IDENTITY_ADJUST) };
  }

  /**
   * Set the active variant's brightness/contrast (partial merge; slider units clamped to
   * −100…100). Per-variant and in-memory — kept when toggling variants, cleared on a new
   * manifest. Emits `image-adjust-change`. No-op when no variant is shown.
   */
  setImageAdjust(adjust: Partial<ImageAdjust>): void {
    const id = this.#activeVariantId;
    if (!id) {
      return;
    }
    const current = this.#imageAdjust.get(id) ?? IDENTITY_ADJUST;
    const clamp = (v: number) => Math.min(100, Math.max(-100, v));
    const next: ImageAdjust = {
      brightness: clamp(adjust.brightness ?? current.brightness),
      contrast: clamp(adjust.contrast ?? current.contrast),
    };
    this.#imageAdjust.set(id, next);
    for (const handle of this.#adjustHandles.get(id) ?? []) {
      handle.set(next);
    }
    this.emitImageAdjustChange(id, next);
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
      clearMeasurement: () => this.clearMeasurement(),
      setPanMode: (on) => this.setPanMode(on),
      resetView: () => this.resetView(),
      imageAdjust: this.getImageAdjust(),
      setImageAdjust: (adjust) => this.setImageAdjust(adjust),
    });
    if (this.#activeVariantId) {
      this.#controls.setActiveVariant(this.#activeVariantId);
    }
    this.#controls.setMeasuring(this.#measuring);
    this.#controls.setHasMeasurement(this.#measure?.hasMeasurement ?? false);
    this.#controls.setPanning(this.panning);
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

  /** Dispatch `raking-change` with the current raking-light angles (composed/bubbling). */
  protected emitRakingChange(azimuth: number, elevation: number): void {
    this.dispatchEvent(
      new CustomEvent<RakingChangeDetail>('raking-change', {
        detail: { azimuth, elevation },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Dispatch `image-adjust-change` for the given variant (composed/bubbling). */
  protected emitImageAdjustChange(id: string, adjust: ImageAdjust): void {
    this.dispatchEvent(
      new CustomEvent<ImageAdjustChangeDetail>('image-adjust-change', {
        detail: { id, brightness: adjust.brightness, contrast: adjust.contrast },
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
    'raking-change': RakingChangeEvent;
    'image-adjust-change': ImageAdjustChangeEvent;
  }
}
