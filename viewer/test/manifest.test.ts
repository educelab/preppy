import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseManifest,
  fetchManifest,
  resolveVariant,
  resolveVariantUrl,
  ManifestError,
  type Manifest,
} from '../src/manifest';

const RAW = {
  id: 'obj-1',
  title: 'Papyrus 1',
  units: 'cm',
  variants: [
    { id: 'rgb', label: 'RGB', uri: 'obj-1_rgb.abc123.glb', default: true },
    { id: 'ir1050', uri: 'obj-1_ir1050.def456.glb', method: 'IR 1050nm' },
  ],
};

describe('parseManifest', () => {
  it('parses a valid manifest and keeps object + variant fields', () => {
    const m = parseManifest(RAW);
    expect(m.id).toBe('obj-1');
    expect(m.title).toBe('Papyrus 1');
    expect(m.units).toBe('cm');
    expect(m.variants).toHaveLength(2);
    expect(m.variants[0]).toMatchObject({ id: 'rgb', label: 'RGB', default: true });
    expect(m.variants[1]!.method).toBe('IR 1050nm');
  });

  it('defaults units to cm and a variant label to its id', () => {
    const m = parseManifest({ id: 'x', variants: [{ id: 'only', uri: 'a.glb' }] });
    expect(m.units).toBe('cm');
    expect(m.variants[0]!.label).toBe('only');
    expect(m.variants[0]!.default).toBeUndefined();
  });

  it.each([
    ['non-object', 42],
    ['missing id', { variants: [{ id: 'a', uri: 'a.glb' }] }],
    ['empty variants', { id: 'x', variants: [] }],
    ['variant without id', { id: 'x', variants: [{ uri: 'a.glb' }] }],
    ['variant without uri', { id: 'x', variants: [{ id: 'a' }] }],
  ])('throws ManifestError on %s', (_label, bad) => {
    expect(() => parseManifest(bad)).toThrow(ManifestError);
  });
});

describe('resolveVariant', () => {
  const m: Manifest = parseManifest(RAW);

  it('returns the requested variant by id', () => {
    expect(resolveVariant(m, 'ir1050').id).toBe('ir1050');
  });

  it('falls back to the default variant when no id given', () => {
    expect(resolveVariant(m).id).toBe('rgb');
  });

  it('falls back to the first variant when none is flagged default', () => {
    const noDefault = parseManifest({
      id: 'x',
      variants: [{ id: 'a', uri: 'a.glb' }, { id: 'b', uri: 'b.glb' }],
    });
    expect(resolveVariant(noDefault).id).toBe('a');
  });

  it('throws for an unknown id', () => {
    expect(() => resolveVariant(m, 'nope')).toThrow(ManifestError);
  });
});

describe('resolveVariantUrl', () => {
  it('resolves the variant uri against the manifest base url', () => {
    const m = parseManifest(RAW);
    const url = resolveVariantUrl(m.variants[0]!, 'https://host.example/objs/obj-1/manifest.json');
    expect(url).toBe('https://host.example/objs/obj-1/obj-1_rgb.abc123.glb');
  });
});

describe('fetchManifest', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fetches, parses, and returns the absolute base url', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(RAW), { status: 200 })),
    );
    const { manifest, baseUrl } = await fetchManifest(
      'obj-1/manifest.json',
      'https://host.example/',
    );
    expect(manifest.id).toBe('obj-1');
    expect(baseUrl).toBe('https://host.example/obj-1/manifest.json');
  });

  it('throws ManifestError on an HTTP error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 404 })),
    );
    await expect(
      fetchManifest('missing.json', 'https://host.example/'),
    ).rejects.toThrow(ManifestError);
  });
});
