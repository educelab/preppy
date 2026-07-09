// Types for the per-object manifest the widget consumes.
//
// Mirrors the pipeline's builder in preppy/manifest.py (ADR-0002, amended): one
// manifest per object (one scene) with object-level metadata plus a flat
// `variants[]`, each a self-contained glb referenced by `uri` with a stable `id`
// (the variant suffix / selection + deep-link key). Exactly one variant is flagged
// `default`. The manifest-fetch/validate helpers land in Phase 2 (Task 2.1).

/** One selectable variant: a self-contained glb (meshopt geometry + embedded KTX2). */
export interface Variant {
  /** Stable selection / deep-link key (the pipeline variant `suffix`). */
  id: string;
  /** Human-readable display name; the pipeline falls back to `id`. */
  label: string;
  /** URI of the variant's self-contained glb, relative to the manifest. */
  uri: string;
  /** Present and `true` on exactly one variant. */
  default?: boolean;
  // Optional per-variant provenance overrides (VARIANT_OVERRIDE_FIELDS).
  credit?: string;
  date?: string;
  method?: string;
  description?: string;
}

/** A single object's scene descriptor: metadata + its variants. */
export interface Manifest {
  /** Object id. */
  id: string;
  title?: string;
  /** Optional locale-specific display titles. */
  titles?: Record<string, string>;
  inventory?: string;
  description?: string;
  credit?: string;
  date?: string;
  /** Measurement units for the scene; the pipeline defaults to `"cm"`. */
  units: string;
  variants: Variant[];
}

/** Thrown when a manifest is malformed or a requested variant is missing. */
export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestError';
  }
}

/**
 * Narrow parsed JSON to a {@link Manifest}, checking the invariants the widget relies
 * on: a non-empty `variants[]` where every entry has a string `id` and `uri`. `units`
 * defaults to `"cm"` and each variant's `label` defaults to its `id` (mirroring the
 * pipeline). Throws {@link ManifestError} on any violation.
 */
export function parseManifest(data: unknown): Manifest {
  if (typeof data !== 'object' || data === null) {
    throw new ManifestError('manifest must be a JSON object');
  }
  const obj = data as Record<string, unknown>;
  if (typeof obj['id'] !== 'string') {
    throw new ManifestError("manifest requires a string 'id'");
  }
  if (!Array.isArray(obj['variants']) || obj['variants'].length === 0) {
    throw new ManifestError('manifest requires a non-empty variants array');
  }

  const variants: Variant[] = obj['variants'].map((raw, i) => {
    if (typeof raw !== 'object' || raw === null) {
      throw new ManifestError(`variant ${i} must be an object`);
    }
    const v = raw as Record<string, unknown>;
    if (typeof v['id'] !== 'string') {
      throw new ManifestError(`variant ${i} requires a string 'id'`);
    }
    if (typeof v['uri'] !== 'string') {
      throw new ManifestError(`variant ${v['id']} requires a string 'uri'`);
    }
    const entry: Variant = {
      id: v['id'],
      label: typeof v['label'] === 'string' ? v['label'] : v['id'],
      uri: v['uri'],
    };
    if (v['default'] === true) {
      entry.default = true;
    }
    for (const field of ['credit', 'date', 'method', 'description'] as const) {
      if (typeof v[field] === 'string') {
        entry[field] = v[field] as string;
      }
    }
    return entry;
  });

  const manifest: Manifest = {
    id: obj['id'],
    units: typeof obj['units'] === 'string' ? obj['units'] : 'cm',
    variants,
  };
  for (const field of ['title', 'inventory', 'description', 'credit', 'date'] as const) {
    if (typeof obj[field] === 'string') {
      manifest[field] = obj[field] as string;
    }
  }
  if (typeof obj['titles'] === 'object' && obj['titles'] !== null) {
    manifest.titles = obj['titles'] as Record<string, string>;
  }
  return manifest;
}

/**
 * Fetch and parse a manifest from `src` (a URL). Returns the manifest and the absolute
 * base URL its variant `uri`s resolve against.
 */
export async function fetchManifest(
  src: string,
  base: string = document.baseURI,
): Promise<{ manifest: Manifest; baseUrl: string }> {
  const url = new URL(src, base).href;
  const response = await fetch(url);
  if (!response.ok) {
    throw new ManifestError(`failed to fetch manifest ${url}: HTTP ${response.status}`);
  }
  const manifest = parseManifest(await response.json());
  return { manifest, baseUrl: url };
}

/**
 * Select the variant to show: the one whose `id` matches `id` if given (throws if
 * absent), else the one flagged `default`, else the first (mirrors the pipeline's
 * default-selection rule).
 */
export function resolveVariant(manifest: Manifest, id?: string): Variant {
  if (id) {
    const found = manifest.variants.find((v) => v.id === id);
    if (!found) {
      throw new ManifestError(`no variant with id '${id}' in manifest '${manifest.id}'`);
    }
    return found;
  }
  return manifest.variants.find((v) => v.default) ?? manifest.variants[0]!;
}

/** Resolve a variant's `uri` against the manifest's base URL to an absolute URL. */
export function resolveVariantUrl(variant: Variant, baseUrl: string): string {
  return new URL(variant.uri, baseUrl).href;
}
