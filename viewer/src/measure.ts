// Two-point on-surface measurement.
//
// The delivered geometry carries gltfpack's node transform (KHR_mesh_quantization
// dequant + registration), so a raycast hit's world coordinates are already in the
// manifest's real units (cm) — the distance between two picks is a true surface
// measurement with no extra scaling. Markers + a connecting line are drawn in the
// scene; a DOM label (kept pinned to the line's midpoint each frame) shows the value.

import {
  BufferGeometry,
  Line,
  LineBasicMaterial,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Group,
  Raycaster,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';
import type { Viewer } from './viewer';

const ACCENT = 0xf0b35a;

/** Result of a completed two-point measurement. */
export interface MeasureResult {
  /** Distance between the two picked points, in the scene's units. */
  distance: number;
  /** Unit label (from the manifest; e.g. "cm"). */
  unit: string;
  /** The two picked world-space points as [x, y, z]. */
  points: [number[], number[]];
}

/** Target on-screen marker radius, in CSS pixels, held constant across zoom. */
const MARKER_SCREEN_PX = 5;
/** A unit-radius sphere; each marker is this geometry scaled per frame (Task 7). */
const MARKER_GEOMETRY = new SphereGeometry(1, 16, 16);

export class MeasureTool {
  #viewer: Viewer;
  #container: HTMLElement;
  #group = new Group();
  #label: HTMLDivElement;
  #hint: HTMLDivElement;
  #raycaster = new Raycaster();
  #picks: Vector3[] = [];
  #markers: Mesh[] = [];
  #enabled = false;
  #unit = 'cm';
  #onMeasure: ((result: MeasureResult) => void) | null = null;
  #onChange: (() => void) | null = null;
  /** Frame callback runs for the tool's lifetime: rescales markers + pins the label,
   * so a completed measurement stays legible and correctly sized as the user orbits,
   * pans, and zooms — even after measure mode is turned off. */
  #unsubscribeFrame: (() => void) | null = null;

  constructor(viewer: Viewer, container: HTMLElement) {
    this.#viewer = viewer;
    this.#container = container;
    viewer.scene.add(this.#group);

    this.#label = document.createElement('div');
    this.#label.className = 'measure-label';
    this.#label.hidden = true;
    // Announce the completed measurement to assistive tech (polite live region).
    this.#label.setAttribute('role', 'status');
    this.#label.setAttribute('aria-live', 'polite');
    this.#label.setAttribute('aria-atomic', 'true');

    this.#hint = document.createElement('div');
    this.#hint.className = 'measure-hint';
    this.#hint.hidden = true;
    this.#hint.setAttribute('role', 'status');
    this.#hint.setAttribute('aria-live', 'polite');
    this.#hint.textContent = 'Click two points to measure';

    container.append(this.#hint, this.#label);
    this.#unsubscribeFrame = viewer.onFrame(this.#onFrameTick);
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  /** True while a drawn measurement is on screen (persists after measure mode ends). */
  get hasMeasurement(): boolean {
    return this.#markers.length > 0;
  }

  /** Set the unit label shown next to distances (from the manifest). */
  setUnit(unit: string): void {
    this.#unit = unit;
  }

  /** Callback invoked when a two-point measurement completes. */
  onMeasure(callback: ((result: MeasureResult) => void) | null): void {
    this.#onMeasure = callback;
  }

  /** Callback invoked when a measurement is drawn or cleared (for UI affordances). */
  onChange(callback: (() => void) | null): void {
    this.#onChange = callback;
  }

  /** Enter measure mode: clicks pick surface points; the label tracks the line. */
  enable(): void {
    if (this.#enabled) {
      return;
    }
    this.#enabled = true;
    this.#viewer.renderer.domElement.addEventListener('pointerdown', this.#onPointerDown);
    if (!this.hasMeasurement) {
      this.#hint.hidden = false;
    }
  }

  /** Leave measure mode. The drawn measurement stays visible (clear it explicitly). */
  disable(): void {
    if (!this.#enabled) {
      return;
    }
    this.#enabled = false;
    this.#viewer.renderer.domElement.removeEventListener('pointerdown', this.#onPointerDown);
    this.#hint.hidden = true;
  }

  /** Remove the drawn measurement (markers, line, label) and reset picks. */
  clear(): void {
    const had = this.#picks.length > 0 || this.#markers.length > 0;
    this.#picks = [];
    this.#markers = [];
    for (const child of [...this.#group.children]) {
      this.#group.remove(child);
      const withGeom = child as Mesh | Line;
      // Markers share MARKER_GEOMETRY (never disposed); only dispose per-object geometry.
      if (withGeom.geometry && withGeom.geometry !== MARKER_GEOMETRY) {
        withGeom.geometry.dispose();
      }
      const mat = withGeom.material;
      (Array.isArray(mat) ? mat : [mat]).forEach((m) => m?.dispose());
    }
    this.#label.hidden = true;
    if (this.#enabled) {
      this.#hint.hidden = false;
    }
    if (had) {
      this.#onChange?.();
    }
  }

  dispose(): void {
    this.disable();
    this.clear();
    this.#unsubscribeFrame?.();
    this.#unsubscribeFrame = null;
    this.#viewer.scene.remove(this.#group);
    this.#label.remove();
    this.#hint.remove();
  }

  #onPointerDown = (event: PointerEvent): void => {
    const model = this.#viewer.currentModel;
    if (!model || event.button !== 0) {
      return;
    }
    const canvas = this.#viewer.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const ndc = new Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.#raycaster.setFromCamera(ndc, this.#viewer.camera);
    const hit = this.#raycaster.intersectObject(model, true)[0];
    if (!hit) {
      return;
    }

    if (this.#picks.length >= 2) {
      this.clear(); // start a fresh measurement
    }
    this.#picks.push(hit.point.clone());

    const marker = new Mesh(MARKER_GEOMETRY, new MeshBasicMaterial({ color: ACCENT }));
    marker.position.copy(hit.point);
    this.#group.add(marker);
    this.#markers.push(marker);
    this.#scaleMarker(marker); // size correctly before the first frame

    if (this.#picks.length === 2) {
      this.#complete();
    }
    if (this.#picks.length === 1) {
      this.#onChange?.(); // a measurement now exists (first point placed)
    }
  };

  #complete(): void {
    const [a, b] = this.#picks as [Vector3, Vector3];
    this.#group.add(
      new Line(
        new BufferGeometry().setFromPoints([a, b]),
        new LineBasicMaterial({ color: ACCENT }),
      ),
    );
    const distance = a.distanceTo(b);
    this.#label.textContent = `${distance.toFixed(2)} ${this.#unit}`;
    this.#label.hidden = false;
    this.#hint.hidden = true;
    this.#onMeasure?.({
      distance,
      unit: this.#unit,
      points: [a.toArray(), b.toArray()],
    });
  }

  /** World radius that projects to ~MARKER_SCREEN_PX at `point`'s depth (perspective). */
  #screenConstantRadius(point: Vector3): number {
    const camera = this.#viewer.camera;
    const height = this.#viewer.renderer.domElement.clientHeight || 1;
    const dist = camera.position.distanceTo(point);
    const worldPerPixel = (2 * dist * Math.tan(MathUtils.degToRad(camera.fov) / 2)) / height;
    return Math.max(MARKER_SCREEN_PX * worldPerPixel, 1e-5);
  }

  /** Scale a marker (a unit sphere) so it holds a constant on-screen size (Task 7). */
  #scaleMarker(marker: Mesh): void {
    marker.scale.setScalar(this.#screenConstantRadius(marker.position));
  }

  /** Per-frame: hold markers at a constant screen size and keep the label pinned. */
  #onFrameTick = (): void => {
    for (const marker of this.#markers) {
      this.#scaleMarker(marker);
    }
    this.#updateLabel();
  };

  /** Keep the label pinned to the on-screen midpoint of the measured segment. */
  #updateLabel = (): void => {
    if (this.#picks.length !== 2 || this.#label.hidden) {
      return;
    }
    const [a, b] = this.#picks as [Vector3, Vector3];
    const mid = a.clone().add(b).multiplyScalar(0.5).project(this.#viewer.camera);
    if (mid.z > 1) {
      this.#label.style.visibility = 'hidden';
      return;
    }
    this.#label.style.visibility = 'visible';
    const rect = this.#viewer.renderer.domElement.getBoundingClientRect();
    const host = this.#container.getBoundingClientRect();
    const x = (mid.x * 0.5 + 0.5) * rect.width + (rect.left - host.left);
    const y = (-mid.y * 0.5 + 0.5) * rect.height + (rect.top - host.top);
    this.#label.style.left = `${x}px`;
    this.#label.style.top = `${y}px`;
  };
}
