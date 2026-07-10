// All shadow-DOM styling for <dri-viewer>, in one adopted stylesheet.
//
// Aesthetic: a quiet scientific-instrument panel — warm amber on charcoal glass — so
// the widget reads as an archival tool and never competes with the artifact. No web
// fonts (the no-runtime-CDN rule): a refined system stack for chrome, a monospace
// stack for tabular numerics (measurements, angles). Everything is scoped to the shadow
// root, so a host page's CSS can't leak in or out.

export const CSS_TEXT = `
:host {
  --dri-ink: #ece7dd;
  --dri-dim: #9a938a;
  --dri-accent: #f0b35a;         /* warm amber, echoing papyrus + ink */
  --dri-glass: rgba(22, 21, 19, 0.72);
  --dri-glass-line: rgba(240, 179, 90, 0.22);
  --dri-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
  --dri-sans: ui-sans-serif, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
  --dri-mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;

  display: block;
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 240px;
  overflow: hidden;
  contain: content;
  /* Establish a container so the control bar can respond to the widget's own width
     (not the page's) and dock to the bottom when embedded narrow. */
  container-type: inline-size;
  background: #15171c;
}
:host([hidden]) { display: none; }

.stage { position: absolute; inset: 0; }
.stage canvas { display: block; width: 100%; height: 100%; touch-action: none; }
.stage[data-measuring="true"] canvas { cursor: crosshair; }
.stage[data-panning="true"] canvas { cursor: grab; }
.stage[data-panning="true"] canvas:active { cursor: grabbing; }

/* --- Control panel -------------------------------------------------------- */
.ui {
  position: absolute;
  left: 14px;
  bottom: 14px;
  z-index: 2;
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
  max-width: min(560px, calc(100% - 28px));
  padding: 10px 12px;
  color: var(--dri-ink);
  font-family: var(--dri-sans);
  font-size: 13px;
  background: var(--dri-glass);
  border: 1px solid var(--dri-glass-line);
  border-radius: 11px;
  box-shadow: var(--dri-shadow);
  backdrop-filter: blur(9px) saturate(1.1);
  -webkit-backdrop-filter: blur(9px) saturate(1.1);
  animation: dri-rise 0.4s cubic-bezier(0.2, 0.7, 0.2, 1) both;
}
.secondary { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
/* The expand toggle only appears in the compact docked layout (below). The
   .tool.expand-toggle two-class specificity beats the later single-class .tool rule. */
.tool.expand-toggle { display: none; }
.expand-toggle::before { display: none; }

/* Tools popover body: pan/measure toggles stacked, then the conditional Clear. */
.tools-panel { display: flex; flex-direction: column; align-items: stretch; gap: 8px; }
.tools-panel .tool { justify-content: flex-start; }
.tools-panel .measure-clear { margin-top: 2px; }

/* Compact: below a widget-width breakpoint, dock the bar to the bottom edge and tuck
   the secondary controls behind the ⋯ toggle; the band pickers stay visible. */
@container (max-width: 460px) {
  .ui {
    left: 0;
    right: 0;
    bottom: 0;
    max-width: none;
    justify-content: center;
    border-radius: 12px 12px 0 0;
    padding: 10px 12px calc(10px + env(safe-area-inset-bottom, 0px));
  }
  .tool.expand-toggle { display: inline-flex; }
  .ui:not([data-expanded="true"]) .secondary { display: none; }
}
@keyframes dri-rise {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .ui { animation: none; }
}

/* Band selector: amber-outlined pills, filled when active. */
.bands { display: flex; flex-wrap: wrap; gap: 6px; }
.band {
  appearance: none;
  cursor: pointer;
  padding: 5px 11px;
  font: inherit;
  font-size: 12px;
  line-height: 1.2;
  color: var(--dri-ink);
  background: transparent;
  border: 1px solid rgba(236, 231, 221, 0.2);
  border-radius: 999px;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}
.band:hover { border-color: var(--dri-accent); }
.band[aria-pressed="true"] {
  color: #1b1512;
  background: var(--dri-accent);
  border-color: var(--dri-accent);
  font-weight: 600;
}
.band:focus-visible { outline: 2px solid var(--dri-accent); outline-offset: 2px; }

/* Raking-light sliders with tabular numeric readouts. */
.slider { display: grid; grid-template-columns: 1.6em 1fr 2.8em; align-items: center; gap: 8px; }
.slider > span:first-child { font-size: 11px; color: var(--dri-dim); }
.slider output { font-family: var(--dri-mono); font-size: 11px; color: var(--dri-ink); text-align: right; }
input[type="range"] {
  appearance: none;
  width: 100%;
  height: 3px;
  border-radius: 2px;
  background: rgba(236, 231, 221, 0.22);
  outline: none;
}
input[type="range"]::-webkit-slider-thumb {
  appearance: none;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: var(--dri-accent);
  border: 2px solid #1b1512;
  cursor: pointer;
}
input[type="range"]::-moz-range-thumb {
  width: 13px;
  height: 13px;
  border: 2px solid #1b1512;
  border-radius: 50%;
  background: var(--dri-accent);
  cursor: pointer;
}
input[type="range"]:focus-visible { outline: 2px solid var(--dri-accent); outline-offset: 3px; }

/* Tool toggles (Pan, Measure) + Clear (Clear appears only while a measurement is drawn). */
.tool {
  appearance: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px 6px 10px;
  font: inherit;
  font-size: 12px;
  color: var(--dri-ink);
  background: transparent;
  border: 1px solid rgba(236, 231, 221, 0.2);
  border-radius: 8px;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}
.tool::before {
  content: "";
  width: 9px;
  height: 9px;
  opacity: 0.7;
}
/* Measure = ring; Pan = a small square (hand/move affordance) to read distinctly. */
.tool.measure::before { border: 2px solid currentColor; border-radius: 50%; }
.tool.pan::before { border: 2px solid currentColor; border-radius: 2px; }
.tool:hover { border-color: var(--dri-accent); }
.tool[aria-pressed="true"] {
  color: #1b1512;
  background: var(--dri-accent);
  border-color: var(--dri-accent);
  font-weight: 600;
}
.tool:focus-visible { outline: 2px solid var(--dri-accent); outline-offset: 2px; }

.measure-clear {
  appearance: none;
  cursor: pointer;
  padding: 6px 11px;
  font: inherit;
  font-size: 12px;
  color: var(--dri-dim);
  background: transparent;
  border: 1px solid rgba(236, 231, 221, 0.16);
  border-radius: 8px;
  transition: color 0.15s ease, border-color 0.15s ease;
}
.measure-clear[hidden] { display: none; }
.measure-clear:hover { color: var(--dri-ink); border-color: var(--dri-accent); }
.measure-clear:focus-visible { outline: 2px solid var(--dri-accent); outline-offset: 2px; }

/* --- Popover primitive (icon button → anchored panel) --------------------- */
/* A tool button that floats a small panel out of itself (Light, Adjust, …). The
   panel anchors to the button and opens upward, since the control cluster sits at
   the bottom-left of the stage. */
.popover { position: relative; display: inline-flex; }
.popover-trigger { padding: 6px 10px; }
.popover-trigger::before { display: none; } /* icon glyph is the label, no leading dot */
.popover-panel {
  position: absolute;
  left: 0;
  bottom: calc(100% + 8px);
  z-index: 4;
  min-width: 180px;
  padding: 12px 13px 13px;
  color: var(--dri-ink);
  background: var(--dri-glass);
  border: 1px solid var(--dri-glass-line);
  border-radius: 10px;
  box-shadow: var(--dri-shadow);
  backdrop-filter: blur(9px) saturate(1.1);
  -webkit-backdrop-filter: blur(9px) saturate(1.1);
  animation: dri-pop 0.16s cubic-bezier(0.2, 0.7, 0.2, 1) both;
}
.popover-panel[hidden] { display: none; }
@keyframes dri-pop {
  from { opacity: 0; transform: translateY(4px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .popover-panel { animation: none; }
}
.popover-panel .panel-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
.popover-panel .panel-title {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--dri-dim);
}
.panel-reset {
  appearance: none;
  cursor: pointer;
  padding: 2px 8px;
  font: inherit;
  font-size: 11px;
  color: var(--dri-dim);
  background: transparent;
  border: 1px solid rgba(236, 231, 221, 0.16);
  border-radius: 6px;
  transition: color 0.15s ease, border-color 0.15s ease;
}
.panel-reset:hover { color: var(--dri-ink); border-color: var(--dri-accent); }
.panel-reset:focus-visible { outline: 2px solid var(--dri-accent); outline-offset: 2px; }

/* --- Light panel: shaded-sphere azimuth dial + elevation slider ----------- */
.light-panel { display: flex; gap: 14px; align-items: stretch; }
.light-dial {
  position: relative;
  width: 108px;
  height: 108px;
  flex: 0 0 auto;
  border-radius: 50%;
  cursor: grab;
  touch-action: none;
}
.light-dial:active { cursor: grabbing; }
.light-dial:focus-visible { outline: 2px solid var(--dri-accent); outline-offset: 3px; }
.light-dial-face { display: block; width: 108px; height: 108px; }
.light-dial-puck {
  position: absolute;
  width: 12px;
  height: 12px;
  margin: -6px 0 0 -6px; /* centre on its (left,top) */
  border-radius: 50%;
  background: var(--dri-ink);
  border: 2px solid #1b1512;
  box-shadow: 0 0 6px rgba(246, 230, 200, 0.8);
  pointer-events: none;
}
/* Vertical elevation slider beside the ball (native range, rotated). */
.light-el { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.light-el .el-track {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 92px;
}
.light-el input[type="range"] {
  writing-mode: vertical-lr;
  direction: rtl; /* low elevation at the bottom */
  width: 3px;
  height: 92px;
}
.light-el .el-cap { font-size: 10px; color: var(--dri-dim); }
.light-readout {
  margin-top: 10px;
  display: flex;
  gap: 14px;
  font-family: var(--dri-mono);
  font-size: 11px;
  color: var(--dri-ink);
}
.light-readout .dim { color: var(--dri-dim); }

/* --- Image-adjust panel: brightness + contrast sliders -------------------- */
.adjust-panel { display: flex; flex-direction: column; gap: 12px; min-width: 190px; }
.adjust-row { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 4px 8px; }
.adjust-tag { font-size: 11px; color: var(--dri-dim); }
.adjust-row output {
  font-family: var(--dri-mono);
  font-size: 11px;
  color: var(--dri-ink);
  text-align: right;
  min-width: 2.6em;
}
.adjust-row input[type="range"] { grid-column: 1 / -1; }

/* --- Floating measurement label ------------------------------------------- */
.measure-label {
  position: absolute;
  z-index: 3;
  transform: translate(-50%, -140%);
  padding: 3px 8px;
  font-family: var(--dri-mono);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  color: #1b1512;
  background: var(--dri-accent);
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
  pointer-events: none;
}
.measure-hint {
  position: absolute;
  left: 50%;
  top: 14px;
  transform: translateX(-50%);
  z-index: 3;
  padding: 5px 12px;
  font-family: var(--dri-sans);
  font-size: 12px;
  color: var(--dri-ink);
  background: var(--dri-glass);
  border: 1px solid var(--dri-glass-line);
  border-radius: 999px;
  pointer-events: none;
  backdrop-filter: blur(9px);
  -webkit-backdrop-filter: blur(9px);
}
`;
