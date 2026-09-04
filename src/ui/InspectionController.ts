import * as THREE from 'three';
import { ChunkManager } from '../core/ChunkManager.js';
import { OsmDataProvider } from '../generator/osm/OsmDataProvider.js';

export class InspectionController {
  camera: THREE.Camera;
  chunkManager: ChunkManager;
  osmProvider: OsmDataProvider;

  raycaster: THREE.Raycaster = new THREE.Raycaster();
  screenCenter: THREE.Vector2 = new THREE.Vector2(0, 0);

  targetCard = document.getElementById('target-card');
  targetDist = document.getElementById('target-dist');
  targetName = document.getElementById('target-name');
  targetAddress = document.getElementById('target-address');
  targetLevels = document.getElementById('target-levels');
  targetHeight = document.getElementById('target-height');
  targetType = document.getElementById('target-type');
  targetPois = document.getElementById('target-pois');
  crosshairEl = document.getElementById('crosshair');

  inspectTimer: number = 0;

  constructor(camera: THREE.Camera, chunkManager: ChunkManager, osmProvider: OsmDataProvider) {
    this.camera = camera;
    this.chunkManager = chunkManager;
    this.osmProvider = osmProvider;
  }

  update(dt: number): void {
    this.inspectTimer += dt;
    if (this.inspectTimer < 0.12) return; // 8 times a second
    this.inspectTimer = 0;

    const activeMeshes: THREE.Mesh[] = [];
    for (const chunk of this.chunkManager.activeChunks.values()) {
      if (chunk.mesh) activeMeshes.push(chunk.mesh);
    }

    if (activeMeshes.length === 0) {
      if (this.targetCard) this.targetCard.style.display = 'none';
      if (this.crosshairEl) this.crosshairEl.classList.remove('targeted');
      return;
    }

    this.raycaster.setFromCamera(this.screenCenter, this.camera);
    this.raycaster.far = 450;
    const intersects = this.raycaster.intersectObjects(activeMeshes, false);

    if (intersects.length > 0) {
      const hit = intersects[0];
      const hitPoint = hit.point;

      // Flat ground/sidewalk surface is at y = (groundY + 1) * VOXEL_SIZE = 42.0m.
      // Elevated structures (buildings, trees, monuments, mountains) have y > 42.1m.
      const isElevated = hitPoint.y > 42.1;
      const isUnloaded = !this.osmProvider.isPointInLoadedSector(hitPoint.x, hitPoint.z);

      if (isElevated || isUnloaded) {
        const info = this.osmProvider.getFeatureAtPoint(hitPoint.x, hitPoint.z);

        if (info) {
          if (this.targetCard) {
            this.targetCard.style.display = 'block';
            if (this.targetDist) this.targetDist.textContent = `${Math.round(hit.distance)} м`;
            if (this.targetName) this.targetName.textContent = info.name || 'Городское здание';
            if (this.targetAddress) this.targetAddress.textContent = info.address || (info.city ? `г. ${info.city}` : 'Адрес не указан в OSM');
            if (this.targetLevels) this.targetLevels.textContent = `${info.levels} эт.`;
            if (this.targetHeight) this.targetHeight.textContent = `${info.height} м`;
            if (this.targetType) this.targetType.textContent = info.buildingType || 'Объект';

            if (info.pois && info.pois.length > 0 && this.targetPois) {
              this.targetPois.style.display = 'flex';
              this.targetPois.innerHTML = info.pois.slice(0, 3).map(p => `
                <div class="target-poi-item">
                  <div class="target-poi-main">
                    <span>${p.icon}</span>
                    <span>${p.name}</span>
                  </div>
                  ${p.openingHours ? `<span class="target-poi-time">${p.openingHours}</span>` : ''}
                </div>
              `).join('');
            } else if (this.targetPois) {
              this.targetPois.style.display = 'none';
              this.targetPois.innerHTML = '';
            }
          }
          if (this.crosshairEl) this.crosshairEl.classList.add('targeted');
          return;
        }
      }
    }

    if (this.targetCard) this.targetCard.style.display = 'none';
    if (this.crosshairEl) this.crosshairEl.classList.remove('targeted');
  }
}
