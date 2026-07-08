# Replace DPO Voyager with a custom three.js viewer

## Status
accepted

## Context
The archive needs an embeddable widget that lets a viewer browse objects and
switch between an object's **bands** (RGB, IR, spectral, …) **without the camera
resetting**. DPO Voyager selects a scene per document and reloads it on every
switch, snapping the view back; it also has no first-class runtime
texture/band switcher (only an experimental branch). Voyager's other
features — annotations, tours, AR, articles — are not needed here. The only
capability beyond orbit/swap/browse that is required is on-surface
**measurement**, plus good default lighting (a rakeable key light for reading
ink); both are cheap in three.js.

## Decision
Build a minimal custom three.js viewer (GLTFLoader + MeshoptDecoder +
KTX2Loader + OrbitControls + a band selector + a measurement tool) delivered as
an embeddable web component (`<dri-viewer>`), instead of extending or forking
DPO Voyager. `voyager-preppy` will stop being the primary consumer of a Voyager
scene; the pipeline emits a viewer-native manifest instead (see ADR-0002).

The widget loads exactly **one scene** — a single object's set of bands. It has
no archive/per-object navigation; browsing between objects is the host page's
responsibility (it embeds one `<dri-viewer>` per object, or swaps the manifest).

## Consequences
- We own a viewer and its accessibility/maintenance, but it is small and stable
  versus tracking Voyager's evolving SVX schema and the hand-rolled
  `navigation.js` wrapper.
- Band switching preserves the camera in all cases: same-geometry bands swap
  only `material.map`; different-geometry bands swap the whole loaded mesh with
  the camera untouched.
- Migration is incremental: the custom viewer launches for the new multi-band
  Herculaneum data; the existing Voyager site keeps serving the back-catalog
  until it is migrated.
- We give up Voyager's annotations, tours, AR/USDZ, and built-in a11y.
