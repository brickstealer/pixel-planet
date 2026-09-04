import * as THREE from 'three';
import { VoxelMaterialManager } from './VoxelMaterial.js';

export type TimeOfDayMode = 'day' | 'sunset' | 'night';

export class AtmosphereManager {
  scene: THREE.Scene;
  ambientLight: THREE.AmbientLight;
  hemiLight: THREE.HemisphereLight;
  sunLight: THREE.DirectionalLight;
  fillLight: THREE.DirectionalLight;
  fog: THREE.Fog;
  voxelMatManager: VoxelMaterialManager;
  currentTimeMode: TimeOfDayMode = 'day';

  constructor(scene: THREE.Scene, voxelMatManager: VoxelMaterialManager) {
    this.scene = scene;
    this.voxelMatManager = voxelMatManager;

    // Ambient: bright, crisp natural skylight
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.95);
    this.scene.add(this.ambientLight);

    // Hemisphere fill light: natural ground reflection + sky bounce to illuminate shadow faces
    this.hemiLight = new THREE.HemisphereLight(0xbfe3ff, 0x9c8b73, 0.60);
    this.scene.add(this.hemiLight);

    // Sun / Directional: bright, crisp golden-white daylight
    this.sunLight = new THREE.DirectionalLight(0xfffaed, 1.8);
    this.sunLight.position.set(120, 250, 90);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 600;
    this.sunLight.shadow.camera.left = -250;
    this.sunLight.shadow.camera.right = 250;
    this.sunLight.shadow.camera.top = 250;
    this.sunLight.shadow.camera.bottom = -250;
    this.sunLight.shadow.bias = -0.0005;
    this.scene.add(this.sunLight);

    // Opposite fill light (no shadow): guarantees no side of any structure is pitch black
    this.fillLight = new THREE.DirectionalLight(0xddeeff, 0.45);
    this.fillLight.position.set(-120, 150, -90);
    this.fillLight.castShadow = false;
    this.scene.add(this.fillLight);

    // Linear Fog & Background: keeps foreground clear while gently melting horizon into the sky
    this.fog = new THREE.Fog(0xa0d0ff, 90, 360);
    this.scene.fog = this.fog;
    this.scene.background = new THREE.Color(0xa0d0ff);
  }

  setTimeOfDay(mode: TimeOfDayMode): void {
    this.currentTimeMode = mode;

    if (mode === 'day') {
      (this.scene.background as THREE.Color).set(0xa0d0ff);
      this.fog.color.set(0xa0d0ff);
      this.sunLight.color.set(0xfffaed);
      this.sunLight.intensity = 1.8;
      this.sunLight.position.set(120, 250, 90);
      this.ambientLight.intensity = 0.95;
      this.ambientLight.color.set(0xffffff);
      this.hemiLight.color.set(0xbfe3ff);
      this.hemiLight.groundColor.set(0x9c8b73);
      this.hemiLight.intensity = 0.60;
      this.fillLight.color.set(0xddeeff);
      this.fillLight.intensity = 0.45;
      this.fillLight.position.set(-120, 150, -90);
      this.voxelMatManager.setNightLevel(0.0);
    } else if (mode === 'sunset') {
      // Golden Hour / Warm Twilight: rich amber-gold
      (this.scene.background as THREE.Color).set(0xdf8450);
      this.fog.color.set(0xdca07d);
      this.sunLight.color.set(0xffaa33);
      this.sunLight.intensity = 1.8;
      this.sunLight.position.set(280, 50, -50);
      this.ambientLight.intensity = 0.65;
      this.ambientLight.color.set(0xffe0c8);
      this.hemiLight.color.set(0x6a829c);
      this.hemiLight.groundColor.set(0xa36c46);
      this.hemiLight.intensity = 0.45;
      this.fillLight.color.set(0x7a8899);
      this.fillLight.intensity = 0.30;
      this.fillLight.position.set(-200, 80, 50);
      this.voxelMatManager.setNightLevel(0.4);
    } else if (mode === 'night') {
      (this.scene.background as THREE.Color).set(0x0a0f1d);
      this.fog.color.set(0x0a0f1d);
      this.sunLight.color.set(0x5a7ebb);
      this.sunLight.intensity = 0.35;
      this.sunLight.position.set(-90, 180, -90);
      this.ambientLight.intensity = 0.30;
      this.ambientLight.color.set(0x3a4866);
      this.hemiLight.color.set(0x1a2638);
      this.hemiLight.groundColor.set(0x0f1724);
      this.hemiLight.intensity = 0.15;
      this.fillLight.color.set(0x1a2233);
      this.fillLight.intensity = 0.10;
      this.fillLight.position.set(90, 100, 90);
      this.voxelMatManager.setNightLevel(1.0);
    }
  }

  updateFogDensityForViewDistance(viewDistMeters: number): void {
    if (this.scene.fog && (this.scene.fog as THREE.Fog).isFog) {
      const linearFog = this.scene.fog as THREE.Fog;
      // Linear atmospheric fog: foreground stays bright, horizon seamlessly blends into sky
      linearFog.near = Math.max(80, viewDistMeters * 0.30);
      linearFog.far = Math.max(260, viewDistMeters * 0.98);
    }
  }
}
