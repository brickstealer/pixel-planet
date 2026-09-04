import * as THREE from 'three';

export class WebGpuRendererContext {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  container: HTMLElement;
  isWebGPU: boolean = false;

  constructor(container: HTMLElement) {
    this.container = container;

    this.camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.5,
      4500
    );
    this.camera.position.set(0, 75, 0);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.isWebGPU = false;
  }

  async init(): Promise<void> {

    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.20;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.container.appendChild(this.renderer.domElement);

    window.addEventListener('resize', () => this.onWindowResize());
  }

  onWindowResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement as HTMLCanvasElement;
  }
}
