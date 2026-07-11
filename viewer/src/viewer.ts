// three.js rendering core for <dri-viewer>, decoupled from the custom element so it
// unit-tests / reuses independently. Task 1.3 scope: renderer + scene + camera +
// OrbitControls, the loader stack (GLTFLoader + MeshoptDecoder + KTX2Loader), a
// default light rig, a ResizeObserver-driven resize, and the render loop. Loading /
// switching / measurement build on this in Phase 2+.

import {
  Box3,
  BufferGeometry,
  Color,
  HemisphereLight,
  DirectionalLight,
  MathUtils,
  Material,
  Mesh,
  MOUSE,
  type Object3D,
  PerspectiveCamera,
  Scene,
  Sphere,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

export interface ViewerOptions {
  /**
   * Directory holding the Basis transcoder (`basis_transcoder.js` + `.wasm`). Defaults
   * to a sibling `basis/` of the widget bundle (dev server serves it at `/basis/`).
   */
  transcoderPath?: string;
}

/** Resolve the default transcoder directory for the current build mode. */
function defaultTranscoderPath(): string {
  // The Vite dev server serves public/ at the site root; the built library ships
  // basis/ next to the bundle, resolved relative to this module's URL.
  if (import.meta.env.DEV) {
    return '/basis/';
  }
  // Resolve at runtime relative to the emitted bundle (dist/dri-viewer.js →
  // dist/basis/). The base is held in a variable so Vite does not treat this as a
  // build-time asset reference (basis/ is a directory copied in separately).
  const base = import.meta.url;
  return new URL('basis/', base).href;
}

/**
 * Owns the three.js renderer, scene graph, camera, controls, and loaders. Construction
 * initializes the renderer (throws if WebGL is unavailable — the element catches this
 * and degrades). Call {@link dispose} on teardown.
 */
export class Viewer {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly gltfLoader: GLTFLoader;
  readonly ktx2Loader: KTX2Loader;

  readonly #container: HTMLElement;
  readonly #resizeObserver: ResizeObserver;
  #frame = 0;
  #disposed = false;
  #currentModel: Object3D | null = null;
  #modelCenter = new Vector3();
  /** Controllable grazing "raking" light for revealing surface relief (Task 4.2). */
  #rakingLight!: DirectionalLight;
  #rakingAzimuth = 45;
  #rakingElevation = 22;
  /** Per-frame callbacks (e.g. keeping the measurement label pinned to the line). */
  readonly #frameCallbacks = new Set<() => void>();

  constructor(container: HTMLElement, options: ViewerOptions = {}) {
    this.#container = container;

    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new Scene();
    this.scene.background = new Color(0x15171c);

    this.camera = new PerspectiveCamera(50, 1, 0.01, 5000);
    this.camera.position.set(0, 0, 60);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    // Right-drag pans by default; pan mode (below) also maps left-drag to pan so
    // reading the surface up close is a first-class, single-button gesture.
    this.controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };

    this.setupLights();

    // Loaders. KTX2Loader.detectSupport needs the renderer; the transcoder wasm is
    // only fetched when a KTX2 texture is actually transcoded (Phase 2 loads).
    this.ktx2Loader = new KTX2Loader()
      .setTranscoderPath(options.transcoderPath ?? defaultTranscoderPath())
      .detectSupport(this.renderer);
    this.gltfLoader = new GLTFLoader()
      .setMeshoptDecoder(MeshoptDecoder)
      .setKTX2Loader(this.ktx2Loader);

    // Size to the container now and on any resize.
    this.#resizeObserver = new ResizeObserver(() => this.resize());
    this.#resizeObserver.observe(container);
    this.resize();

    this.#renderLoop();
  }

  /**
   * Light rig: a hemisphere fill so the surface is never black, plus a controllable
   * grazing "raking" key light that reveals relief (fibres, script, damage) — the
   * scholarly reason a raking control exists. The raking light aims at the model centre
   * so its azimuth/elevation are relative to the surface, not the world origin.
   */
  private setupLights(): void {
    this.scene.add(new HemisphereLight(0xffffff, 0x444455, 0.85));

    this.#rakingLight = new DirectionalLight(0xffffff, 1.6);
    this.scene.add(this.#rakingLight);
    this.scene.add(this.#rakingLight.target);
    this.applyRakingLight();
  }

  /** Position the raking light from its azimuth/elevation about the model centre. */
  private applyRakingLight(): void {
    const az = MathUtils.degToRad(this.#rakingAzimuth);
    const el = MathUtils.degToRad(this.#rakingElevation);
    // Direction the light comes FROM, relative to the surface (which faces +Z): azimuth
    // sweeps in the XY plane, elevation lifts out of it toward the viewer.
    const dir = new Vector3(
      Math.cos(el) * Math.cos(az),
      Math.cos(el) * Math.sin(az),
      Math.sin(el),
    );
    this.#rakingLight.target.position.copy(this.#modelCenter);
    this.#rakingLight.position.copy(this.#modelCenter).addScaledVector(dir, 100);
    this.#rakingLight.target.updateMatrixWorld();
  }

  /**
   * Aim the raking light. `azimuth` sweeps around the surface normal (degrees, 0–360);
   * `elevation` is the grazing angle above the surface (degrees, ~5 = very raking,
   * 90 = straight-on). Low elevations exaggerate relief.
   */
  setRakingLight(azimuth: number, elevation: number): void {
    this.#rakingAzimuth = azimuth;
    this.#rakingElevation = MathUtils.clamp(elevation, 0, 90);
    this.applyRakingLight();
  }

  /** Current raking-light angles (degrees). */
  getRakingLight(): { azimuth: number; elevation: number } {
    return { azimuth: this.#rakingAzimuth, elevation: this.#rakingElevation };
  }

  /** Whether left-drag pans (pan mode) instead of orbiting. */
  #panning = false;

  /** Map left-drag to pan (`on`) or orbit (`off`); right-drag always pans. */
  setPanMode(on: boolean): void {
    this.#panning = on;
    this.controls.mouseButtons.LEFT = on ? MOUSE.PAN : MOUSE.ROTATE;
  }

  /** True when left-drag pans (pan mode). */
  get panning(): boolean {
    return this.#panning;
  }

  /** Register a callback run every frame (after controls.update); returns an unsubscribe. */
  onFrame(callback: () => void): () => void {
    this.#frameCallbacks.add(callback);
    return () => this.#frameCallbacks.delete(callback);
  }

  /** The currently displayed model root (a loaded glb scene), or null. */
  get currentModel(): Object3D | null {
    return this.#currentModel;
  }

  /**
   * Snapshot of render + camera state, for diagnostics and verification. `triangles`
   * reflects the last rendered frame; `cameraDistance` is the eye→target distance.
   */
  getRenderStats(): {
    triangles: number;
    geometries: number;
    textures: number;
    meshCount: number;
    hasTexturedMaterial: boolean;
    hasNormals: boolean;
    cameraDistance: number;
    boundingDiagonal: number;
  } {
    let meshCount = 0;
    let hasTexturedMaterial = false;
    let hasNormals = false;
    this.#currentModel?.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) {
        return;
      }
      meshCount += 1;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (mats.some((m) => m && 'map' in m && (m as { map: unknown }).map)) {
        hasTexturedMaterial = true;
      }
      if ((mesh.geometry as BufferGeometry).getAttribute('normal')) {
        hasNormals = true;
      }
    });
    // World-space bbox diagonal in scene units (cm). A regression that dropped the node
    // transform would read quantized units (thousands) instead of the real tens of cm.
    const boundingDiagonal = this.#currentModel
      ? new Box3()
          .setFromObject(this.#currentModel)
          .getSize(new Vector3())
          .length()
      : 0;
    return {
      triangles: this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      meshCount,
      hasTexturedMaterial,
      hasNormals,
      cameraDistance: this.camera.position.distanceTo(this.controls.target),
      boundingDiagonal,
    };
  }

  /**
   * Load a variant's self-contained glb. GLTFLoader transcodes the embedded KTX2 and
   * applies any `KHR_texture_transform`. Delivery glbs now ship smooth normals baked
   * in the pipeline (Phase 7), so `computeVertexNormals` only fires as a fallback for
   * a glb that lacks a NORMAL attribute (older assets / `--no-smooth-normals`). The
   * node transform (gltfpack's KHR_mesh_quantization dequant + registration) is left on
   * the returned scene graph — never baked into the quantized buffer — so world
   * coordinates read real scale for measurement.
   */
  async loadModel(url: string): Promise<Object3D> {
    const gltf: GLTF = await this.gltfLoader.loadAsync(url);
    const root = gltf.scene;
    root.updateWorldMatrix(true, true);
    root.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh) {
        const geom = mesh.geometry as BufferGeometry;
        if (!geom.getAttribute('normal')) {
          geom.computeVertexNormals();
        }
      }
    });
    return root;
  }

  /**
   * Show `root`, removing the previous model from the scene (NOT disposing it — the
   * caller owns model lifecycle so variants can be cached for instant re-display). With
   * `frame: true` the camera is framed on the new model (initial load only); a variant
   * switch passes `frame: false` so the camera/controls are left exactly as the user
   * left them — the widget's core invariant.
   */
  setModel(root: Object3D, { frame = false }: { frame?: boolean } = {}): void {
    if (this.#currentModel && this.#currentModel !== root) {
      this.scene.remove(this.#currentModel);
    }
    this.scene.add(root);
    this.#currentModel = root;
    // Track the centre so the raking light aims at the surface (variants register in the
    // same frame, so this barely moves across a switch).
    new Box3().setFromObject(root).getCenter(this.#modelCenter);
    this.applyRakingLight();
    if (frame) {
      this.frameObject(root);
    }
  }

  /**
   * Read one framebuffer pixel (RGBA 0–255) at normalized canvas coordinates
   * (0,0 = top-left, 1,1 = bottom-right), for headless verification. Renders once and
   * reads immediately (before the next clear), so it works without preserveDrawingBuffer.
   */
  samplePixel(nx: number, ny: number): [number, number, number, number] {
    this.renderer.render(this.scene, this.camera);
    const gl = this.renderer.getContext();
    const w = this.renderer.domElement.width;
    const h = this.renderer.domElement.height;
    const x = Math.min(w - 1, Math.max(0, Math.floor(nx * w)));
    // GL's framebuffer origin is bottom-left; flip y so callers think top-left.
    const y = Math.min(h - 1, Math.max(0, Math.floor((1 - ny) * h)));
    const px = new Uint8Array(4);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return [px[0]!, px[1]!, px[2]!, px[3]!];
  }

  /** Camera + controls state, for the camera-preservation invariant check (Task 3.3). */
  getCameraState(): { position: number[]; quaternion: number[]; target: number[] } {
    return {
      position: this.camera.position.toArray(),
      quaternion: this.camera.quaternion.toArray(),
      target: this.controls.target.toArray(),
    };
  }

  /** Release GPU resources for a model that was loaded but never shown (stale load). */
  disposeModel(root: Object3D): void {
    disposeObject(root);
  }

  /** Frame the camera + controls target on `obj`'s bounding sphere (initial load). */
  frameObject(obj: Object3D): void {
    const sphere = new Box3().setFromObject(obj).getBoundingSphere(new Sphere());
    if (sphere.radius === 0 || !Number.isFinite(sphere.radius)) {
      return;
    }
    this.controls.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).add(new Vector3(0, 0, sphere.radius * 2.6));
    this.camera.near = sphere.radius / 100;
    this.camera.far = sphere.radius * 100;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  /** Match the renderer + camera to the container's current size. */
  resize(): void {
    const { clientWidth: w, clientHeight: h } = this.#container;
    if (w === 0 || h === 0) {
      return;
    }
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  #renderLoop = (): void => {
    if (this.#disposed) {
      return;
    }
    this.#frame = requestAnimationFrame(this.#renderLoop);
    this.controls.update();
    for (const callback of this.#frameCallbacks) {
      callback();
    }
    this.renderer.render(this.scene, this.camera);
  };

  /** Stop rendering and release GL / DOM / observer resources. Idempotent. */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    cancelAnimationFrame(this.#frame);
    this.#frameCallbacks.clear();
    this.#resizeObserver.disconnect();
    // Remove (do not dispose) the current model — the caller's cache owns model
    // lifecycle and disposes every loaded variant on teardown.
    if (this.#currentModel) {
      this.scene.remove(this.#currentModel);
      this.#currentModel = null;
    }
    this.controls.dispose();
    this.ktx2Loader.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

/** Release GPU resources (geometries, materials, textures) held by a model subtree. */
function disposeObject(root: Object3D): void {
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) {
      return;
    }
    mesh.geometry?.dispose();
    const material = mesh.material;
    const materials: Material[] = Array.isArray(material) ? material : material ? [material] : [];
    for (const mat of materials) {
      for (const value of Object.values(mat)) {
        if (value && typeof value === 'object' && 'isTexture' in value && value.isTexture) {
          (value as { dispose(): void }).dispose();
        }
      }
      mat.dispose();
    }
  });
}
