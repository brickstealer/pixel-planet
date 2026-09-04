import * as THREE from 'three';
import { CHUNK_SIZE_X, CHUNK_SIZE_Z, VOXEL_SIZE } from '../core/VoxelTypes.js';
import { FlightControls } from '../controls/FlightControls.js';
import { ChunkManager } from '../core/ChunkManager.js';
import { CityConfig } from '../generator/osm/OsmTypes.js';
import { TimeOfDayMode } from '../rendering/AtmosphereManager.js';

import { OsmDataProvider } from '../generator/osm/OsmDataProvider.js';

export interface AdvancedStreamSettings {
  sectorSize: number;
  concurrency: number;
  chunksPerFrame: number;
}

export interface HudCallbacks {
  onSearch: (query: string) => Promise<void>;
  onTimeChange: (mode: TimeOfDayMode) => void;
  onRenderDistanceChange: (val: number) => void;
  onSectorSizeChange?: (size: number) => void;
  onConcurrencyChange?: (concurrency: number) => void;
  onChunksPerFrameChange?: (batch: number) => void;
  onReloadSectors?: () => void;
  onClearCache?: () => Promise<void>;
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
  statusDot = document.getElementById('status-dot');

  renderSlider = document.getElementById('render-dist-slider') as HTMLInputElement | null;
  renderLabel = document.getElementById('render-dist-val');
  instructionsOverlay = document.getElementById('instructions-overlay');
  startBtn = document.getElementById('start-btn');
  timeButtons = document.querySelectorAll('.time-btn');
  searchForm = document.getElementById('search-form');
  searchInput = document.getElementById('search-input') as HTMLInputElement | null;

  // Advanced settings panel elements
  advSettingsModal = document.getElementById('adv-settings-modal');
  advSettingsBtn = document.getElementById('adv-settings-btn');
  openSettingsFullBtn = document.getElementById('open-settings-full-btn');
  closeAdvSettingsBtn = document.getElementById('close-adv-settings-btn');

  presetButtons = document.querySelectorAll('.adv-preset-btn');
  sectorSizeButtons = document.querySelectorAll('#sector-size-options .adv-chip-btn');
  concurrencyButtons = document.querySelectorAll('#concurrency-options .adv-chip-btn');
  chunksBatchSlider = document.getElementById('chunks-batch-slider') as HTMLInputElement | null;

  sectorSizeVal = document.getElementById('sector-size-val');
  concurrencyVal = document.getElementById('concurrency-val');
  chunksBatchVal = document.getElementById('chunks-batch-val');
  advReloadBtn = document.getElementById('adv-reload-sectors-btn');
  advClearCacheBtn = document.getElementById('adv-clear-cache-btn');

  currentSettings: AdvancedStreamSettings = {
    sectorSize: 600,
    concurrency: 2,
    chunksPerFrame: 6
  };

  hudUpdateTimer: number = 0;
  private statusOverride: string | null = null;
  private statusOverrideTimer: number = 0;

  constructor(callbacks: HudCallbacks) {
    this.loadSettingsFromStorage();
    this.initListeners(callbacks);
    this.applySettingsUI(this.currentSettings);
  }

  updateStatus(msg: string, timeoutSeconds: number = 3.5): void {
    this.statusOverride = msg;
    this.statusOverrideTimer = timeoutSeconds;
    if (this.statusEl) this.statusEl.textContent = msg;
    if (this.statusDot) {
      if (msg.toLowerCase().includes('не найдено') || msg.toLowerCase().includes('ошибка')) {
        this.statusDot.className = 'status-dot error';
      } else {
        this.statusDot.className = 'status-dot loading';
      }
    }
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

  toggleSettingsModal(show?: boolean): void {
    if (!this.advSettingsModal) return;
    const isVisible = this.advSettingsModal.style.display !== 'none';
    const shouldShow = show !== undefined ? show : !isVisible;
    this.advSettingsModal.style.display = shouldShow ? 'flex' : 'none';
    if (shouldShow && document.pointerLockElement) {
      document.exitPointerLock();
    }
  }

  loadSettingsFromStorage(): AdvancedStreamSettings {
    try {
      const saved = localStorage.getItem('pixel_planet_stream_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.sectorSize) this.currentSettings.sectorSize = parsed.sectorSize;
        if (parsed.concurrency) this.currentSettings.concurrency = parsed.concurrency;
        if (parsed.chunksPerFrame) this.currentSettings.chunksPerFrame = parsed.chunksPerFrame;
      }
    } catch {
      // default
    }
    return this.currentSettings;
  }

  saveSettingsToStorage(): void {
    try {
      localStorage.setItem('pixel_planet_stream_settings', JSON.stringify(this.currentSettings));
    } catch {}
  }

  applySettingsUI(settings: AdvancedStreamSettings): void {
    this.currentSettings = { ...settings };

    // Sector size UI
    if (this.sectorSizeVal) {
      this.sectorSizeVal.textContent = `${this.currentSettings.sectorSize} × ${this.currentSettings.sectorSize} м`;
    }
    this.sectorSizeButtons.forEach(btn => {
      const b = btn as HTMLElement;
      b.classList.toggle('active', parseInt(b.dataset.val || '0', 10) === this.currentSettings.sectorSize);
    });

    // Concurrency UI
    if (this.concurrencyVal) {
      const c = this.currentSettings.concurrency;
      this.concurrencyVal.textContent = `${c} ${c === 1 ? 'поток' : (c < 5 ? 'потока' : 'потоков')}`;
    }
    this.concurrencyButtons.forEach(btn => {
      const b = btn as HTMLElement;
      b.classList.toggle('active', parseInt(b.dataset.val || '0', 10) === this.currentSettings.concurrency);
    });

    // Chunks per frame UI
    if (this.chunksBatchSlider) {
      this.chunksBatchSlider.value = this.currentSettings.chunksPerFrame.toString();
    }
    if (this.chunksBatchVal) {
      this.chunksBatchVal.textContent = `${this.currentSettings.chunksPerFrame} чанков/кадр`;
    }

    this.updatePresetButtons();
    this.saveSettingsToStorage();
  }

  private updatePresetButtons(): void {
    const s = this.currentSettings;
    const isEco = s.sectorSize === 400 && s.concurrency === 1 && s.chunksPerFrame <= 4;
    const isBalanced = s.sectorSize === 600 && s.concurrency === 2 && s.chunksPerFrame === 6;
    const isTurbo = s.sectorSize >= 800 && s.concurrency >= 3 && s.chunksPerFrame >= 12;

    this.presetButtons.forEach(btn => {
      const b = btn as HTMLElement;
      const p = b.dataset.preset;
      b.classList.toggle('active', (p === 'eco' && isEco) || (p === 'balanced' && isBalanced) || (p === 'turbo' && isTurbo));
    });
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

    // Modal toggles
    this.advSettingsBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleSettingsModal();
    });

    this.openSettingsFullBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleSettingsModal(true);
    });

    this.closeAdvSettingsBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleSettingsModal(false);
    });

    // Close modal on outside click
    window.addEventListener('click', (e) => {
      if (this.advSettingsModal && this.advSettingsModal.style.display !== 'none') {
        const target = e.target as HTMLElement;
        if (!this.advSettingsModal.contains(target) && !this.advSettingsBtn?.contains(target) && !this.openSettingsFullBtn?.contains(target)) {
          this.toggleSettingsModal(false);
        }
      }
    });

    // Preset buttons
    this.presetButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const p = (btn as HTMLElement).dataset.preset;
        if (p === 'eco') {
          this.currentSettings = { sectorSize: 400, concurrency: 1, chunksPerFrame: 3 };
        } else if (p === 'balanced') {
          this.currentSettings = { sectorSize: 600, concurrency: 2, chunksPerFrame: 6 };
        } else if (p === 'turbo') {
          this.currentSettings = { sectorSize: 800, concurrency: 3, chunksPerFrame: 14 };
        }
        this.applySettingsUI(this.currentSettings);
        callbacks.onSectorSizeChange?.(this.currentSettings.sectorSize);
        callbacks.onConcurrencyChange?.(this.currentSettings.concurrency);
        callbacks.onChunksPerFrameChange?.(this.currentSettings.chunksPerFrame);
      });
    });

    // Sector Size chips
    this.sectorSizeButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const val = parseInt((btn as HTMLElement).dataset.val || '600', 10);
        this.currentSettings.sectorSize = val;
        this.applySettingsUI(this.currentSettings);
        callbacks.onSectorSizeChange?.(val);
      });
    });

    // Concurrency chips
    this.concurrencyButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const val = parseInt((btn as HTMLElement).dataset.val || '2', 10);
        this.currentSettings.concurrency = val;
        this.applySettingsUI(this.currentSettings);
        callbacks.onConcurrencyChange?.(val);
      });
    });

    // Chunks Batch slider
    if (this.chunksBatchSlider) {
      this.chunksBatchSlider.addEventListener('input', (e) => {
        const val = parseInt((e.target as HTMLInputElement).value, 10);
        this.currentSettings.chunksPerFrame = val;
        if (this.chunksBatchVal) this.chunksBatchVal.textContent = `${val} чанков/кадр`;
        this.updatePresetButtons();
        this.saveSettingsToStorage();
        callbacks.onChunksPerFrameChange?.(val);
      });
    }

    // Reload nearby sectors button
    this.advReloadBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      callbacks.onReloadSectors?.();
      this.updateStatus('Перезагрузка секторов с новыми настройками...', 3.5);
    });

    // Clear disk cache button
    this.advClearCacheBtn?.addEventListener('click', async (e) => {
      e.stopPropagation();
      this.updateStatus('Очистка локального кэша геометрии...', 2.0);
      await callbacks.onClearCache?.();
      this.updateStatus('Кэш полностью очищен! Свежие данные загружаются...', 4.0);
    });
  }

  update(
    dt: number,
    camera: THREE.Camera,
    controls: FlightControls,
    chunkManager: ChunkManager,
    currentCity: CityConfig | null,
    osmProvider?: OsmDataProvider | null
  ): void {
    if (this.statusOverrideTimer > 0) {
      this.statusOverrideTimer -= dt;
      if (this.statusOverrideTimer <= 0) {
        this.statusOverride = null;
      }
    }

    this.hudUpdateTimer += dt;
    if (this.hudUpdateTimer < 0.1) return; // 10 updates per second is plenty
    this.hudUpdateTimer = 0;

    // Real-time Loading & Generation Indicator
    if (!this.statusOverride && osmProvider) {
      const activeFetches = osmProvider.activeFetches.size;
      const queuedSectors = osmProvider.requestQueue.length;
      const totalOsmPending = activeFetches + queuedSectors;
      const pendingChunks = chunkManager.buildQueue.length;
      const totalFeatures = osmProvider.features.length;

      if (totalOsmPending > 0) {
        if (this.statusDot) this.statusDot.className = 'status-dot loading';
        if (this.statusEl) {
          this.statusEl.textContent = `Загрузка OSM: ${totalOsmPending} сект. (${totalFeatures} объектов)`;
        }
      } else if (pendingChunks > 0) {
        if (this.statusDot) this.statusDot.className = 'status-dot compiling';
        if (this.statusEl) {
          this.statusEl.textContent = `Сборка чанков: ${pendingChunks} в очереди...`;
        }
      } else {
        if (this.statusDot) this.statusDot.className = 'status-dot idle';
        if (this.statusEl) {
          this.statusEl.textContent = `Все объекты загружены (${totalFeatures} в памяти)`;
        }
      }
    }

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
