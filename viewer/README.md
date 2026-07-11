# `<dri-viewer>`

An embeddable three.js web component for DRI's multi-variant 3D objects. It loads one
object's **scene** (a per-object `manifest.json`) and switches **variants** (RGB, IR,
spectral, PGS…) **without resetting the camera** — the thing DPO Voyager can't do —
with on-surface measurement in real units and a raking-light control for reading relief.

Each variant is one self-contained `.glb` (meshopt geometry + embedded KTX2), produced
by the `dri-voyager-preppy` pipeline. The widget bundles three.js + the Basis transcoder,
so embedding is **one `<script>` + one element, with no runtime CDN**.

## Embedding

Ship the contents of `dist/` (the bundle **and** its sibling `basis/` folder) on your
host, then:

```html
<script type="module" src="/path/to/dri-viewer.js"></script>

<dri-viewer
  manifest="/objects/PHerc1428Cr04/manifest.json"
  variant="rgb"></dri-viewer>
```

That's it. The element sizes to whatever box you give it (CSS `width`/`height`); it has a
`min-height` so it's never zero-height. See [`examples/embed.html`](./examples/embed.html)
for a complete page.

> The Basis transcoder (`basis_transcoder.js` + `.wasm`) is fetched at runtime from a
> `basis/` folder **next to `dri-viewer.js`**, resolved via `import.meta.url`. Keep the
> two together when you deploy. To place the transcoder elsewhere, set
> `transcoder-path="/some/dir/"` on the element.

### Via npm

```bash
npm install dri-viewer
```

```js
import 'dri-viewer'; // registers <dri-viewer> as a side effect
```

Types (`Manifest`, `Variant`, `MeasureResult`, event types) are exported from the package
root.

## API

### Attributes / properties

| Attribute         | Property        | Description |
| ----------------- | --------------- | ----------- |
| `manifest`        | `manifest`      | URL of the object manifest JSON. |
| `variant`         | `variant`       | Active variant `id`; empty ⇒ the manifest default. Changing it **switches variants, preserving the camera**. Reflected back for deep-linking. |
| `ui`              | `ui`            | Space-separated UI tokens. Default shows the built-in controls; `ui="none"` hides all chrome (drive it yourself via events/methods). |
| `transcoder-path` | —               | Override the Basis transcoder directory (default: `basis/` beside the bundle). Read once on connect. |

Additional JS-only members:

- `manifestData: Manifest | null` — set an inline/programmatic manifest (skips the fetch).
- `activeVariant: string` — the variant currently shown (read-only).
- `setMeasuring(on: boolean)` / `measuring: boolean` — toggle two-point measure mode.
- `setRakingLight(azimuth, elevation)` / `getRakingLight()` — aim the raking key light
  (degrees; low elevation = grazing/relief-revealing). The built-in UI exposes this as the
  ☀ "light ball": **drag the puck** to set azimuth (angle) and elevation (radius — centre
  is overhead, rim is grazing); ←/→ step azimuth and ↑/↓ step elevation; Reset returns to
  az 45° / el 22°.
- `resetView()` — reframe the camera on the current model (the built-in ⤢ button).
- `setImageAdjust({ brightness, contrast })` / `getImageAdjust()` — per-variant runtime
  brightness/contrast on the mesh albedo (slider units −100…+100, 0 = identity). In-memory
  and keyed by variant id: kept when toggling variants, cleared on a new manifest. Exposed
  in the UI as the ◑ Exposure panel; measurement overlays and the raking response are
  unaffected.
- `maxCachedVariants: number` — cap resident variant models (0 = keep all, the default;
  a handful of 8K variants coexist comfortably).
- `getRenderStats()` / `getCameraState()` — diagnostics.

The built-in chrome is a floating cluster of icon buttons in the **top-right** — Layers,
Light (☀), Exposure (◑), Pan, Measure and Reset-view (⤢), plus a Clear button while a
measurement is drawn. Each button is a plain **toggle** that shows/hides a panel docked at
a fixed location: the band (layer) pickers bottom-left (open on load), and the Light +
Exposure panels bottom-right (stacked when both are open). Panels shrink to fit a narrow
embed; the overlay is pointer-transparent so the canvas stays interactive around it.

### Events

All bubble and cross the shadow boundary (`composed`).

| Event            | `detail` | Fired when |
| ---------------- | -------- | ---------- |
| `variant-change` | `{ id }` | A variant becomes active (initial load or switch). |
| `measure`        | `{ distance, unit, points }` | A two-point measurement completes (`distance` in manifest units, e.g. cm). |
| `raking-change`  | `{ azimuth, elevation }` | The raking light is re-aimed (degrees). Lets `ui="none"` hosts track light state. |
| `image-adjust-change` | `{ id, brightness, contrast }` | The active variant's brightness/contrast changed (slider units). |
| `error`          | `{ error }` | WebGL init or a load fails (the element stays mounted). |

## Manifest

The widget consumes the per-object `manifest.json` emitted by the pipeline
(`preppy/manifest.py`): object metadata + a flat `variants[]`, each `{ id, label, uri }`
with exactly one `default`, plus `units` (default `"cm"`). Variant `uri`s resolve relative
to the manifest URL.

## Hosting (CORS + cache headers)

- **Same-origin or CORS:** if the manifest/glbs are served from a different origin than
  the host page, enable CORS (`Access-Control-Allow-Origin`) on the manifest, the `.glb`s,
  and the transcoder — the loaders `fetch()` them.
- **Cache headers:** the pipeline emits **content-hashed** asset names
  (`…_rgb.75f897a3.glb`) — serve those `Cache-Control: public, max-age=31536000, immutable`.
  Serve `manifest.json` / `index.json` (stable names) with a short/`no-cache` +
  revalidation policy so new hashed assets are picked up. Ship `dri-viewer.js` (also
  content-hash it if you version it) and `basis/` together.

## Development

```bash
npm install                # deps; copies the Basis transcoder into public/basis/
npm run dev                # Vite dev server (http://localhost:5173)
#   ?manifest=/fixtures/<obj>/manifest.json&variant=<id>  drives the dev host page
npm run build              # → dist/dri-viewer.js (+ dist/basis/, type declarations)
npm run typecheck          # tsc, strict
npm test                   # unit tests (vitest / happy-dom): manifest + element logic
npm run test:e2e           # Playwright (real WebGL): render, camera-preservation,
                           #   measurement, embedding
```

The e2e/render tests use a sample object under `public/fixtures/` (gitignored); they skip
cleanly when it's absent, so a bare checkout still runs unit tests + the empty-widget check.
