// The "light ball": a shaded-sphere azimuth dial for the raking light.
//
// It reads as a top-down view of the light hemisphere. DRAGGING sets AZIMUTH only
// (pointer angle → azimuth); elevation is driven separately (the panel's vertical
// slider) and slides the puck RADIALLY: the puck rides at radius = cos(elevation) —
// overhead (el 90°) sits at the centre, grazing (el ~0°) at the rim — so the ball
// always depicts the true light direction. This matches viewer.applyRakingLight's
// azimuth-in-XY / elevation-out-of-plane convention (el 90° = straight-on).
//
// The dial is a `role="slider"` over azimuth (0–360°) with the standard keyboard
// model. The shaded sphere is drawn on a canvas; the puck is a DOM node so it carries
// crisp focus styling. Canvas rendering is guarded so it no-ops under happy-dom.

/** Puck distance from centre for a given elevation, as a fraction-scaled radius. */
export function elevationToRadius(elevationDeg: number, radius: number): number {
  return radius * Math.cos((elevationDeg * Math.PI) / 180);
}

/**
 * Screen-space puck offset (from centre) for an azimuth/elevation, in a top-down view.
 * Azimuth is measured CCW from +X (screen right); +Y world is screen-up, so the
 * returned `y` is negated into screen coordinates (down-positive).
 */
export function azimuthToPoint(
  azimuthDeg: number,
  elevationDeg: number,
  radius: number,
): { x: number; y: number } {
  const r = elevationToRadius(elevationDeg, radius);
  const az = (azimuthDeg * Math.PI) / 180;
  return { x: r * Math.cos(az), y: -r * Math.sin(az) };
}

/** Azimuth (deg, [0,360)) of a screen-space offset from centre (dy is down-positive). */
export function pointToAzimuth(dx: number, dy: number): number {
  const deg = (Math.atan2(-dy, dx) * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

const SIZE = 108; // dial box, px
const RADIUS = 46; // sphere radius within the box, px
const CENTER = SIZE / 2;

export interface LightDialOptions {
  azimuth: number;
  elevation: number;
  /** User changed azimuth (drag/keyboard) or elevation (setElevation with emit). */
  onInput?: (azimuth: number, elevation: number) => void;
  /** Double-click on the ball requests a reset (panel supplies the defaults). */
  onReset?: () => void;
}

export class LightDial {
  readonly root: HTMLDivElement;
  #canvas: HTMLCanvasElement;
  #puck: HTMLDivElement;
  #azimuth: number;
  #elevation: number;
  #onInput: LightDialOptions['onInput'];
  #onReset: LightDialOptions['onReset'];
  #dragging = false;

  constructor(options: LightDialOptions) {
    this.#azimuth = options.azimuth;
    this.#elevation = options.elevation;
    this.#onInput = options.onInput;
    this.#onReset = options.onReset;

    this.root = document.createElement('div');
    this.root.className = 'light-dial';
    this.root.setAttribute('role', 'slider');
    this.root.setAttribute('aria-label', 'Light azimuth');
    this.root.setAttribute('aria-valuemin', '0');
    this.root.setAttribute('aria-valuemax', '360');
    this.root.tabIndex = 0;

    this.#canvas = document.createElement('canvas');
    this.#canvas.className = 'light-dial-face';
    this.#canvas.width = SIZE;
    this.#canvas.height = SIZE;

    this.#puck = document.createElement('div');
    this.#puck.className = 'light-dial-puck';

    this.root.append(this.#canvas, this.#puck);

    this.root.addEventListener('pointerdown', this.#onPointerDown);
    this.root.addEventListener('pointermove', this.#onPointerMove);
    this.root.addEventListener('pointerup', this.#onPointerUp);
    this.root.addEventListener('keydown', this.#onKeyDown);
    this.root.addEventListener('dblclick', () => this.#onReset?.());

    this.#render();
  }

  get azimuth(): number {
    return this.#azimuth;
  }
  get elevation(): number {
    return this.#elevation;
  }

  /** Set azimuth (deg); `emit` fires `onInput` (for user-driven changes). */
  setAzimuth(azimuth: number, emit = false): void {
    const clamped = Math.min(360, Math.max(0, azimuth));
    if (clamped === this.#azimuth && !emit) {
      return;
    }
    this.#azimuth = clamped;
    this.#render();
    if (emit) {
      this.#onInput?.(this.#azimuth, this.#elevation);
    }
  }

  /** Set elevation (deg, clamped 0–90); slides the puck radially. `emit` fires onInput. */
  setElevation(elevation: number, emit = false): void {
    const clamped = Math.min(90, Math.max(0, elevation));
    this.#elevation = clamped;
    this.#render();
    if (emit) {
      this.#onInput?.(this.#azimuth, this.#elevation);
    }
  }

  dispose(): void {
    this.root.remove();
  }

  #onPointerDown = (event: PointerEvent): void => {
    this.#dragging = true;
    this.root.setPointerCapture?.(event.pointerId);
    this.#setFromPointer(event);
  };
  #onPointerMove = (event: PointerEvent): void => {
    if (this.#dragging) {
      this.#setFromPointer(event);
    }
  };
  #onPointerUp = (event: PointerEvent): void => {
    this.#dragging = false;
    this.root.releasePointerCapture?.(event.pointerId);
  };

  /** Drag maps the pointer angle → azimuth; radius (elevation) is left untouched. */
  #setFromPointer(event: PointerEvent): void {
    const rect = this.root.getBoundingClientRect();
    const dx = event.clientX - rect.left - CENTER;
    const dy = event.clientY - rect.top - CENTER;
    if (dx === 0 && dy === 0) {
      return;
    }
    this.setAzimuth(pointToAzimuth(dx, dy), true);
  }

  #onKeyDown = (event: KeyboardEvent): void => {
    const step = event.shiftKey ? 1 : 5;
    let next: number | null = null;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = this.#wrap(this.#azimuth + step);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        next = this.#wrap(this.#azimuth - step);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = 360;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.setAzimuth(next, true);
  };

  /** Wrap an azimuth into [0,360) so arrow-stepping crosses the 0/360 seam cleanly. */
  #wrap(azimuth: number): number {
    return ((azimuth % 360) + 360) % 360;
  }

  #render(): void {
    // aria: report azimuth as the slider value.
    const rounded = Math.round(this.#azimuth);
    this.root.setAttribute('aria-valuenow', String(rounded));
    this.root.setAttribute('aria-valuetext', `${rounded}°`);

    const { x, y } = azimuthToPoint(this.#azimuth, this.#elevation, RADIUS);
    this.#puck.style.left = `${CENTER + x}px`;
    this.#puck.style.top = `${CENTER + y}px`;

    this.#paint(x, y);
  }

  /** Draw the shaded sphere with its highlight toward the current light direction. */
  #paint(lightX: number, lightY: number): void {
    const ctx = this.#canvas.getContext('2d');
    if (!ctx) {
      return; // no 2d context (e.g. happy-dom unit env) — puck + aria still update
    }
    ctx.clearRect(0, 0, SIZE, SIZE);
    // Highlight sits partway toward the light source; fades to a shaded far side.
    const hx = CENTER + lightX * 0.6;
    const hy = CENTER + lightY * 0.6;
    const grad = ctx.createRadialGradient(hx, hy, RADIUS * 0.05, CENTER, CENTER, RADIUS);
    grad.addColorStop(0, '#f6e6c8');
    grad.addColorStop(0.45, '#c79a5b');
    grad.addColorStop(1, '#2a2620');
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(240, 179, 90, 0.35)';
    ctx.stroke();
  }
}
