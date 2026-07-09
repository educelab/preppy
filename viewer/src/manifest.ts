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
