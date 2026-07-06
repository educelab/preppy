# Tracks Registry

| Status | Track ID | Title | Created | Updated |
| ------ | -------- | ----- | ------- | ------- |
| [~] | toolchain-spike_20260706 | Toolchain spike (de-risk the approach) | 2026-07-06 | 2026-07-06 |
| [ ] | delivery-pipeline_20260706 | Delivery pipeline (meshopt geometry + KTX2 + manifest) | 2026-07-06 | 2026-07-06 |
| [ ] | viewer-widget_20260706 | `<dri-viewer>` web component | 2026-07-06 | 2026-07-06 |
| [ ] | harden-migrate_20260706 | Harden & migrate | 2026-07-06 | 2026-07-06 |

<!-- Tracks registered by /conductor:new-track -->

## Dependency order
`toolchain-spike` → `delivery-pipeline` → `viewer-widget` → `harden-migrate`
(the viewer can start against a hand-authored manifest in parallel with the
pipeline; harden-migrate needs both).
