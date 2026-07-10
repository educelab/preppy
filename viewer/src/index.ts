// Public entry point for the <dri-viewer> widget bundle.
//
// Importing this module (or loading the built dist/dri-viewer.js) registers the
// <dri-viewer> custom element as a side effect. The rendering core is wired in
// Task 1.3 and Phase 2+.

import { defineDriViewer } from './dri-viewer';

export const VERSION = '0.1.0';

export { DriViewer, defineDriViewer } from './dri-viewer';
export type {
  VariantChangeDetail,
  VariantChangeEvent,
  MeasureEvent,
  RakingChangeDetail,
  RakingChangeEvent,
  ImageAdjustChangeDetail,
  ImageAdjustChangeEvent,
} from './dri-viewer';
export type { ImageAdjust } from './image-adjust';
export type { MeasureResult } from './measure';
export type { Manifest, Variant } from './manifest';

defineDriViewer();
