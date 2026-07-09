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
});
