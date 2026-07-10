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
  Mesh,
  MeshBasicMaterial,
  Box3,
  Group,
  Raycaster,
  Sphere,
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

export class MeasureTool {
  #viewer: Viewer;
  #container: HTMLElement;
  #group = new Group();
  #label: HTMLDivElement;
  #hint: HTMLDivElement;
  #raycaster = new Raycaster();
  #picks: Vector3[] = [];
  #enabled = false;
  #unit = 'cm';
  #onMeasure: ((result: MeasureResult) => void) | null = null;
  #unsubscribeFrame: (() => void) | null = null;

  constructor(viewer: Viewer, container: HTMLElement) {
    this.#viewer = viewer;
    this.#container = container;
    viewer.scene.add(this.#group);

    this.#label = document.createElement('div');
    this.#label.className = 'measure-label';
    this.#label.hidden = true;

    this.#hint = document.createElement('div');
    this.#hint.className = 'measure-hint';
    this.#hint.hidden = true;
    this.#hint.textContent = 'Click two points to measure';

    container.append(this.#hint, this.#label);
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  /** Set the unit label shown next to distances (from the manifest). */
  setUnit(unit: string): void {
    this.#unit = unit;
  }

  /** Callback invoked when a two-point measurement completes. */
  onMeasure(callback: ((result: MeasureResult) => void) | null): void {
    this.#onMeasure = callback;
  }

  /** Enter measure mode: clicks pick surface points; the label tracks the line. */
  enable(): void {
    if (this.#enabled) {
      return;
    }
    this.#enabled = true;
    this.#viewer.renderer.domElement.addEventListener('pointerdown', this.#onPointerDown);
    this.#unsubscribeFrame = this.#viewer.onFrame(this.#updateLabel);
    this.#hint.hidden = false;
  }

  /** Leave measure mode and clear any drawn measurement. */
  disable(): void {
    if (!this.#enabled) {
      return;
    }
    this.#enabled = false;
    this.#viewer.renderer.domElement.removeEventListener('pointerdown', this.#onPointerDown);
    this.#unsubscribeFrame?.();
    this.#unsubscribeFrame = null;
    this.#hint.hidden = true;
    this.reset();
  }

  /** Clear picks, markers, line, and the label. */
  reset(): void {
    this.#picks = [];
    for (const child of [...this.#group.children]) {
      this.#group.remove(child);
      const withGeom = child as Mesh | Line;
      withGeom.geometry?.dispose();
      const mat = withGeom.material;
      (Array.isArray(mat) ? mat : [mat]).forEach((m) => m?.dispose());
    }
    this.#label.hidden = true;
    if (this.#enabled) {
      this.#hint.hidden = false;
    }
  }

  dispose(): void {
    this.disable();
    this.reset();
    this.#viewer.scene.remove(this.#group);
    this.#label.remove();
    this.#hint.remove();
  }

  /** Marker radius scaled to the model so points are visible but not obtrusive. */
  #markerRadius(): number {
    const model = this.#viewer.currentModel;
    if (!model) {
      return 0.2;
    }
    const radius = new Box3().setFromObject(model).getBoundingSphere(new Sphere()).radius;
    return Math.max(radius * 0.012, 1e-4);
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
      this.reset(); // start a fresh measurement
    }
    this.#picks.push(hit.point.clone());

    const marker = new Mesh(
      new SphereGeometry(this.#markerRadius(), 16, 16),
      new MeshBasicMaterial({ color: ACCENT }),
    );
    marker.position.copy(hit.point);
    this.#group.add(marker);

    if (this.#picks.length === 2) {
      this.#complete();
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
