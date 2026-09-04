import * as THREE from 'three';
import { CHUNK_SIZE_X, CHUNK_SIZE_Z, VOXEL_SIZE } from '../core/VoxelTypes.js';
import { FlightControls } from '../controls/FlightControls.js';
import { ChunkManager } from '../core/ChunkManager.js';
import { CityConfig } from '../generator/osm/OsmTypes.js';
import { TimeOfDayMode } from '../rendering/AtmosphereManager.js';

export interface HudCallbacks {
  onSearch: (query: string) => Promise<void>;
  onTimeChange: (mode: TimeOfDayMode) => void;
  onRenderDistanceChange: (val: number) => void;
}

export class HudManager {
  statCoords = document.getElementById('stat-coords');
  statAlt = document.getElementById('stat-alt');
  statHeading = document.getElementById('stat-heading');
  statChunk = document.getElementById('stat-chunk');
  statChunksCount = document.getElementById('stat-chunks-count');
  speedVal = document.getElementById('speed-val');
  speedBar = document.getElementById('speed-bar');
  statusEl = document.getElementById('status-text');

  renderSlider = document.getElementById('render-dist-slider') as HTMLInputElement | null;
  renderLabel = document.getElementById('render-dist-val');
  instructionsOverlay = document.getElementById('instructions-overlay');
  startBtn = document.getElementById('start-btn');
  timeButtons = document.querySelectorAll('.time-btn');
  searchForm = document.getElementById('search-form');
  searchInput = document.getElementById('search-input') as HTMLInputElement | null;

  hudUpdateTimer: number = 0;

  constructor(callbacks: HudCallbacks) {
    this.initListeners(callbacks);
  }

  updateStatus(msg: string): void {
    if (this.statusEl) this.statusEl.textContent = msg;
  }

  setLocationHeader(title: string, subtitle: string): void {
    const locTag = document.getElementById('loc-tag');
    if (locTag) locTag.textContent = title.toUpperCase();

    const subtitleEl = document.getElementById('loc-subtitle');
    if (subtitleEl) {
      subtitleEl.textContent = subtitle;
      subtitleEl.title = subtitle;
    }
  }

  setTimeButtonsActive(mode: TimeOfDayMode): void {
    this.timeButtons.forEach(btn => {
      const b = btn as HTMLElement;
      b.classList.toggle('active', b.dataset.time === mode);
    });
  }

  setRenderDistanceSlider(val: number): void {
    if (this.renderSlider) this.renderSlider.value = val.toString();
    if (this.renderLabel) this.renderLabel.textContent = `${val} чанков`;
  }

  dismissInstructions(): void {
    if (this.instructionsOverlay) {
      this.instructionsOverlay.style.display = 'none';
    }
  }

  private initListeners(callbacks: HudCallbacks): void {
    this.timeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = (btn as HTMLElement).dataset.time as TimeOfDayMode;
        callbacks.onTimeChange(mode);
      });
    });

    if (this.renderSlider) {
      this.renderSlider.addEventListener('input', (e) => {
        const val = parseInt((e.target as HTMLInputElement).value, 10);
        callbacks.onRenderDistanceChange(val);
      });
    }

    if (this.searchForm && this.searchInput) {
      this.searchInput.addEventListener('focus', () => {
        if (document.pointerLockElement) {
          document.exitPointerLock();
        }
      });

      this.searchForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const query = this.searchInput?.value.trim();
        if (!query) return;
        this.searchInput?.blur();
        await callbacks.onSearch(query);
      });
    }

    if (this.startBtn) {
      this.startBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.dismissInstructions();
      });
    }

    if (this.instructionsOverlay) {
      this.instructionsOverlay.addEventListener('click', (e) => {
        if (e.target === this.instructionsOverlay) {
          this.dismissInstructions();
        }
      });
    }
  }

  update(
    dt: number,
    camera: THREE.Camera,
    controls: FlightControls,
    chunkManager: ChunkManager,
    currentCity: CityConfig | null
  ): void {
    this.hudUpdateTimer += dt;
    if (this.hudUpdateTimer < 0.1) return; // 10 updates per second is plenty
    this.hudUpdateTimer = 0;

    // Speed
    const speedKmh = controls.getSpeedKmh();
    if (this.speedVal) this.speedVal.textContent = speedKmh.toString();
    const fillPct = Math.min(100, Math.round((speedKmh / 400) * 100));
    if (this.speedBar) this.speedBar.style.width = `${fillPct}%`;

    // Altitude
    if (this.statAlt) this.statAlt.textContent = `${Math.round(camera.position.y * 1.5)} m`;

    // Current Chunk
    const cx = Math.floor(camera.position.x / (CHUNK_SIZE_X * VOXEL_SIZE));
    const cz = Math.floor(camera.position.z / (CHUNK_SIZE_Z * VOXEL_SIZE));
    if (this.statChunk) this.statChunk.textContent = `[${cx}, ${cz}]`;
    if (this.statChunksCount) this.statChunksCount.textContent = chunkManager.getChunkCount().toString();

    // Heading calculation
    const lookDir = controls.getLookDirection();
    let angleDeg = Math.round((Math.atan2(lookDir.x, -lookDir.z) * 180 / Math.PI + 360) % 360);
    let compass = 'N';
    if (angleDeg >= 22.5 && angleDeg < 67.5) compass = 'NE';
    else if (angleDeg >= 67.5 && angleDeg < 112.5) compass = 'E';
    else if (angleDeg >= 112.5 && angleDeg < 157.5) compass = 'SE';
    else if (angleDeg >= 157.5 && angleDeg < 202.5) compass = 'S';
    else if (angleDeg >= 202.5 && angleDeg < 247.5) compass = 'SW';
    else if (angleDeg >= 247.5 && angleDeg < 292.5) compass = 'W';
    else if (angleDeg >= 292.5 && angleDeg < 337.5) compass = 'NW';
    if (this.statHeading) this.statHeading.textContent = `${angleDeg.toString().padStart(3, '0')}° ${compass}`;

    // Current Global GPS Coordinates
    if (currentCity && this.statCoords) {
      const latOffset = -camera.position.z / 110540;
      const lonOffset = camera.position.x / (111320 * Math.cos(currentCity.lat * Math.PI / 180));
      const currentLat = currentCity.lat + latOffset;
      const currentLon = currentCity.lon + lonOffset;

      const latStr = `${Math.abs(currentLat).toFixed(4)}° ${currentLat >= 0 ? 'N' : 'S'}`;
      const lonStr = `${Math.abs(currentLon).toFixed(4)}° ${currentLon >= 0 ? 'E' : 'W'}`;
      this.statCoords.textContent = `${latStr}, ${lonStr}`;
    }
  }
}
