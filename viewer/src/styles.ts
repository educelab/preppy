// All shadow-DOM styling for <dri-viewer>, in one adopted stylesheet.
//
// Aesthetic: a quiet scientific-instrument panel — warm amber on charcoal glass — so
// the widget reads as an archival tool and never competes with the artifact. No web
// fonts (the no-runtime-CDN rule): a refined system stack for chrome, a monospace
// stack for tabular numerics (measurements, angles). Everything is scoped to the shadow
// root, so a host page's CSS can't leak in or out.
//
// Layout (feedback 2026-07-10): a transparent full-stage overlay carrying a floating
// TOP-RIGHT cluster of icon buttons that toggle panels docked at fixed corners — bands
// bottom-left, Light + Exposure stacked bottom-right. The overlay is pointer-transparent
// so the canvas keeps receiving orbit/zoom/pan everywhere the chrome isn't.

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
  /* Establish a container so the chrome can respond to the widget's own width (not the
     page's) — panels shrink to fit when embedded narrow. */
  container-type: inline-size;
  background: #15171c;
}
:host([hidden]) { display: none; }

.stage { position: absolute; inset: 0; }
.stage canvas { display: block; width: 100%; height: 100%; touch-action: none; }
.stage[data-measuring="true"] canvas { cursor: crosshair; }
.stage[data-panning="true"] canvas { cursor: grab; }
.stage[data-panning="true"] canvas:active { cursor: grabbing; }

/* --- Overlay -------------------------------------------------------------- */
/* Fills the stage but is pointer-transparent, so only the actual buttons/panels catch
   events and the canvas stays interactive everywhere else. */
.ui {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  color: var(--dri-ink);
  font-family: var(--dri-sans);
  font-size: 13px;
}

/* --- Floating top-right button cluster ------------------------------------ */
.toolbar {
  position: absolute;
  top: 14px;
  right: 14px;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
  max-width: 118px;              /* wraps ~3 icon buttons per row */
}
.tbtn {
  pointer-events: auto;
  appearance: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  padding: 0;
  color: var(--dri-ink);
  background: var(--dri-glass);
  border: 1px solid var(--dri-glass-line);
  border-radius: 8px;
  box-shadow: var(--dri-shadow);
  backdrop-filter: blur(9px) saturate(1.1);
  -webkit-backdrop-filter: blur(9px) saturate(1.1);
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}
.tbtn svg { width: 18px; height: 18px; display: block; }
.tbtn .glyph { font-size: 16px; line-height: 1; }
.tbtn:hover { border-color: var(--dri-accent); }
.tbtn[aria-pressed="true"] {
  color: #1b1512;
  background: var(--dri-accent);
  border-color: var(--dri-accent);
}
.tbtn:focus-visible { outline: 2px solid var(--dri-accent); outline-offset: 2px; }
.tbtn[hidden] { display: none; }

/* --- Docked panels -------------------------------------------------------- */
.dock { position: absolute; z-index: 2; display: flex; pointer-events: none; }
.dock > * { pointer-events: auto; }
.dock-bl { left: 14px; bottom: 14px; }
.dock-br {
  right: 14px;
  bottom: 14px;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
}

.panel {
  min-width: 180px;
  max-width: min(300px, calc(100cqw - 20px));
  padding: 12px 13px 13px;
  color: var(--dri-ink);
  background: var(--dri-glass);
  border: 1px solid var(--dri-glass-line);
  border-radius: 11px;
  box-shadow: var(--dri-shadow);
  backdrop-filter: blur(9px) saturate(1.1);
  -webkit-backdrop-filter: blur(9px) saturate(1.1);
  animation: dri-pop 0.16s cubic-bezier(0.2, 0.7, 0.2, 1) both;
}
.panel[hidden] { display: none; }
.bands-panel { min-width: 0; padding: 10px 12px; }
@keyframes dri-pop {
  from { opacity: 0; transform: translateY(6px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .panel { animation: none; }
}

.panel-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
.panel-title {
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

/* --- Bands panel: amber-outlined pills, filled when active ---------------- */
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

/* --- Range sliders (Exposure) --------------------------------------------- */
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

/* --- Light panel: shaded-sphere dial (puck sets azimuth + elevation) ------ */
.light-body { display: flex; justify-content: center; }
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
.light-readout {
  margin-top: 10px;
  display: flex;
  justify-content: center;
  gap: 14px;
  font-family: var(--dri-mono);
  font-size: 11px;
  color: var(--dri-ink);
}
.light-readout .dim { color: var(--dri-dim); }

/* --- Exposure panel: brightness + contrast sliders ------------------------ */
.adjust-body { display: flex; flex-direction: column; gap: 12px; min-width: 190px; }
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

/* --- Floating measurement label + hint ------------------------------------ */
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
