import { describe, it, expect, beforeAll } from 'vitest';
import { DriViewer, defineDriViewer } from '../src/dri-viewer';

beforeAll(() => {
  defineDriViewer();
});

describe('<dri-viewer> element skeleton', () => {
  it('registers the custom element', () => {
    expect(customElements.get('dri-viewer')).toBe(DriViewer);
  });

  it('mounts a shadow root with a stage container', () => {
    const el = document.createElement('dri-viewer');
    document.body.append(el);
    expect(el.shadowRoot).not.toBeNull();
    expect(el.shadowRoot!.querySelector('.stage')).not.toBeNull();
    el.remove();
  });

  it('reflects manifest / variant / ui between attributes and properties', () => {
    const el = document.createElement('dri-viewer');
    el.manifest = 'obj/manifest.json';
    el.variant = 'ir1050';
    el.ui = 'controls measure';
    expect(el.getAttribute('manifest')).toBe('obj/manifest.json');
    expect(el.getAttribute('variant')).toBe('ir1050');
    expect(el.getAttribute('ui')).toBe('controls measure');

    el.setAttribute('variant', 'rgb');
    expect(el.variant).toBe('rgb');
  });

  it('defaults reflected properties to empty strings', () => {
    const el = document.createElement('dri-viewer');
    expect(el.manifest).toBe('');
    expect(el.variant).toBe('');
    expect(el.ui).toBe('');
  });

  it('emits a composed, bubbling variant-change event carrying the id', () => {
    // Exercise the protected emitter via a minimal subclass (the switch logic that
    // calls it lands in Phase 3; here we assert the event contract itself).
    class Probe extends DriViewer {
      fire(id: string): void {
        (this as unknown as { emitVariantChange(id: string): void }).emitVariantChange(id);
      }
    }
    if (!customElements.get('dri-viewer-probe')) {
      customElements.define('dri-viewer-probe', Probe);
    }
    const el = document.createElement('dri-viewer-probe') as Probe;
    document.body.append(el);

    let received: string | null = null;
    let bubbled = false;
    document.body.addEventListener('variant-change', (e) => {
      received = (e as CustomEvent<{ id: string }>).detail.id;
      bubbled = true;
    });
    el.fire('ir1050');
    expect(received).toBe('ir1050');
    expect(bubbled).toBe(true);
    el.remove();
  });

  it('observes the max-cached-variants attribute', () => {
    expect(DriViewer.observedAttributes).toContain('max-cached-variants');
  });

  it('clamps and floors the maxCachedVariants cap', () => {
    const el = document.createElement('dri-viewer') as DriViewer;
    el.maxCachedVariants = -3;
    expect(el.maxCachedVariants).toBe(0); // negatives clamp to 0 (keep-all default)
    el.maxCachedVariants = 2.9;
    expect(el.maxCachedVariants).toBe(2); // floored
    el.maxCachedVariants = 5;
    expect(el.maxCachedVariants).toBe(5);
  });

  it('reports zero cached variants before any model loads', () => {
    // (Real cap eviction + bounded preload need WebGL; covered in e2e/phase3.)
    const el = document.createElement('dri-viewer') as DriViewer;
    expect(el.cachedVariantCount).toBe(0);
  });

  it('image adjust defaults to identity and is a no-op without an active variant', () => {
    const el = document.createElement('dri-viewer');
    document.body.append(el); // WebGL init fails under happy-dom → no variant is shown
    let events = 0;
    el.addEventListener('image-adjust-change', () => (events += 1));
    expect(el.getImageAdjust()).toEqual({ brightness: 0, contrast: 0 });
    el.setImageAdjust({ brightness: 40, contrast: -20 });
    expect(el.getImageAdjust()).toEqual({ brightness: 0, contrast: 0 }); // no variant → ignored
    expect(events).toBe(0);
    el.remove();
  });

  it('emits a composed, bubbling image-adjust-change carrying id + values', () => {
    class Probe extends DriViewer {
      fire(id: string, brightness: number, contrast: number): void {
        (
          this as unknown as {
            emitImageAdjustChange(id: string, a: { brightness: number; contrast: number }): void;
          }
        ).emitImageAdjustChange(id, { brightness, contrast });
      }
    }
    if (!customElements.get('dri-viewer-adjust-probe')) {
      customElements.define('dri-viewer-adjust-probe', Probe);
    }
    const el = document.createElement('dri-viewer-adjust-probe') as Probe;
    document.body.append(el);
    let detail: { id: string; brightness: number; contrast: number } | null = null;
    document.body.addEventListener('image-adjust-change', (e) => {
      detail = (e as CustomEvent).detail;
    });
    el.fire('pgs', 30, -15);
    expect(detail).toEqual({ id: 'pgs', brightness: 30, contrast: -15 });
    el.remove();
  });
});
