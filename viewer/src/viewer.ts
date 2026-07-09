// three.js rendering core for <dri-viewer>, decoupled from the custom element so it
// unit-tests / reuses independently. Task 1.3 scope: renderer + scene + camera +
// OrbitControls, the loader stack (GLTFLoader + MeshoptDecoder + KTX2Loader), a
// default light rig, a ResizeObserver-driven resize, and the render loop. Loading /
// switching / measurement build on this in Phase 2+.

import {
  Color,
  HemisphereLight,
  DirectionalLight,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
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
    this.controls.dispose();
    this.ktx2Loader.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
