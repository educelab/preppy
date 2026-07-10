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
  background: #15171c;
}
:host([hidden]) { display: none; }

.stage { position: absolute; inset: 0; }
.stage canvas { display: block; width: 100%; height: 100%; touch-action: none; }
.stage[data-measuring="true"] canvas { cursor: crosshair; }

/* --- Control panel -------------------------------------------------------- */
.ui {
  position: absolute;
  left: 14px;
  bottom: 14px;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: min(320px, calc(100% - 28px));
  padding: 13px 14px 14px;
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
@keyframes dri-rise {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .ui { animation: none; }
}

.group { display: flex; flex-direction: column; gap: 7px; }
.label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--dri-dim);
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

/* Measure toggle. */
.measure {
  appearance: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  align-self: flex-start;
  padding: 6px 12px 6px 10px;
  font: inherit;
  font-size: 12px;
  color: var(--dri-ink);
  background: transparent;
  border: 1px solid rgba(236, 231, 221, 0.2);
  border-radius: 8px;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}
.measure::before {
  content: "";
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 2px solid currentColor;
  opacity: 0.7;
}
.measure:hover { border-color: var(--dri-accent); }
.measure[aria-pressed="true"] {
  color: #1b1512;
  background: var(--dri-accent);
  border-color: var(--dri-accent);
  font-weight: 600;
}
.measure:focus-visible { outline: 2px solid var(--dri-accent); outline-offset: 2px; }

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
