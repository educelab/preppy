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
  Material,
  Mesh,
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
   * Default light rig: hemisphere fill + a directional key. Tuned for reading a papyrus
   * surface; Task 2.3 refines against real data and Task 4.2 adds a raking-light control.
   */
  private setupLights(): void {
    this.scene.add(new HemisphereLight(0xffffff, 0x444455, 1.1));
    const key = new DirectionalLight(0xffffff, 1.4);
    key.position.set(1, 1, 2);
    this.scene.add(key);
    const fill = new DirectionalLight(0xffffff, 0.6);
    fill.position.set(-1, -0.5, -1);
    this.scene.add(fill);
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
    cameraDistance: number;
  } {
    let meshCount = 0;
    let hasTexturedMaterial = false;
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
    });
    return {
      triangles: this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      meshCount,
      hasTexturedMaterial,
      cameraDistance: this.camera.position.distanceTo(this.controls.target),
    };
  }

  /**
   * Load a variant's self-contained glb. GLTFLoader transcodes the embedded KTX2 and
   * applies any `KHR_texture_transform`; we only add the normals the source geometry
   * lacks. The node transform (gltfpack's KHR_mesh_quantization dequant + registration)
   * is left on the returned scene graph — never baked into the quantized buffer — so
   * world coordinates read real scale for measurement.
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
    if (frame) {
      this.frameObject(root);
    }
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
    this.renderer.render(this.scene, this.camera);
  };

  /** Stop rendering and release GL / DOM / observer resources. Idempotent. */
  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    cancelAnimationFrame(this.#frame);
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
