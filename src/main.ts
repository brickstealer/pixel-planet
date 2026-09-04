import * as THREE from 'three';
import { CHUNK_SIZE_X, VOXEL_SIZE } from './core/VoxelTypes.js';
import { ChunkManager } from './core/ChunkManager.js';
import { TerrainGenerator } from './generator/TerrainGenerator.js';
import { OsmDataProvider, FAMOUS_CITIES, CityConfig } from './generator/OsmDataProvider.js';
import { FlightControls } from './controls/FlightControls.js';
import { WebGpuRendererContext } from './rendering/WebGpuRenderer.js';
import { VoxelMaterialManager } from './rendering/VoxelMaterial.js';
import { AtmosphereManager, TimeOfDayMode } from './rendering/AtmosphereManager.js';
import { CloudSystem } from './rendering/CloudSystem.js';
import { HudManager } from './ui/HudManager.js';
import { InspectionController } from './ui/InspectionController.js';
import { StorageService } from './services/StorageService.js';

async function initApplication() {
  const container = document.getElementById('canvas-container');
  if (!container) throw new Error('canvas-container element not found');

  // 1. Rendering Setup
  const gpuCtx = new WebGpuRendererContext(container);
  await gpuCtx.init();

  const scene = new THREE.Scene();
  const camera = gpuCtx.camera;
  const renderer = gpuCtx.renderer;

  // 2. Materials & Atmosphere
  const voxelMatManager = new VoxelMaterialManager();
  const atmosphere = new AtmosphereManager(scene, voxelMatManager);
  const clouds = new CloudSystem(scene);

  // 3. World Generation & Streaming
  const terrainGen = new TerrainGenerator(1337);
  const osmProvider = new OsmDataProvider();
  const chunkManager = new ChunkManager(scene, terrainGen, osmProvider, voxelMatManager.material);

  // Expose global debug handle
  (window as any).__app = {
    chunkManager,
    osmProvider,
    atmosphere,
    scene
  };

  // 4. Controls & Controllers
  const controls = new FlightControls(camera, gpuCtx.domElement);
  const inspector = new InspectionController(camera, chunkManager, osmProvider);

  let currentCity: CityConfig = FAMOUS_CITIES[0];

  // Callback for when new OSM data arrives in background
  osmProvider.onFeaturesLoaded = () => {
    chunkManager.refreshNonOsmChunks();
    hud.updateStatus(osmProvider.statusMessage);
  };

  // 5. HUD Setup
  const hud = new HudManager({
    onSearch: async (query: string) => {
      hud.updateStatus(`Поиск "${query}" на планете...`);
      const results = await osmProvider.searchLocation(query);
      if (results && results.length > 0) {
        const target = results[0];
        const customCity: CityConfig = {
          name: target.title,
          title: target.title,
          subtitle: target.subtitle,
          lat: target.lat,
          lon: target.lon,
          zoomDesc: target.subtitle,
          groundY: 20
        };
        await teleportToCity(customCity);
        setTimeout(() => {
          gpuCtx.domElement.requestPointerLock();
        }, 350);
      } else {
        hud.updateStatus(`Место "${query}" не найдено. Уточните название.`);
      }
    },
    onTimeChange: (mode: TimeOfDayMode) => {
      atmosphere.setTimeOfDay(mode);
      hud.setTimeButtonsActive(mode);
      saveState();
    },
    onRenderDistanceChange: (val: number) => {
      updateRenderDistance(val);
      saveState();
    }
  });

  function updateRenderDistance(val: number): void {
    chunkManager.renderDistance = val;
    hud.setRenderDistanceSlider(val);

    const viewDistMeters = val * CHUNK_SIZE_X * VOXEL_SIZE;
    camera.far = Math.max(2500, viewDistMeters * 1.5);
    camera.updateProjectionMatrix();

    atmosphere.updateFogDensityForViewDistance(viewDistMeters);

    chunkManager.lastPlayerChunk = { cx: null, cz: null };
    chunkManager.update(camera.position, controls.getLookDirection());
  }

  async function teleportToCity(city: CityConfig): Promise<void> {
    currentCity = city;
    const title = city.title || city.name.split(',')[0].trim();
    const subtitle = city.subtitle || city.zoomDesc || '';

    hud.setLocationHeader(title, subtitle);
    hud.updateStatus(`Локация: ${title} (${subtitle})...`);

    camera.position.set(0, 85, 0);
    controls.velocity.set(0, 0, 0);

    chunkManager.clearAll();
    chunkManager.update(camera.position, controls.getLookDirection());
    saveState();

    // Background load OSM data
    osmProvider.setAnchor(city.lat, city.lon, 900).then(() => {
      hud.updateStatus(osmProvider.statusMessage);
      chunkManager.refreshNonOsmChunks();
    }).catch(err => {
      console.warn('OSM fetch error:', err);
    });
  }

  function saveState(): void {
    if (!currentCity) return;
    StorageService.saveState({
      city: currentCity,
      pos: {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z
      },
      rot: {
        yaw: controls.yaw,
        pitch: controls.pitch
      },
      time: atmosphere.currentTimeMode,
      renderDist: chunkManager.renderDistance
    });
  }

  // 6. Main Animation Loop
  const clock = new THREE.Clock();
  let saveTimer = 0;

  function onFrame(): void {
    const delta = Math.min(clock.getDelta(), 0.1);

    // Controls update
    controls.update(delta);

    // Voxel chunks update
    chunkManager.update(camera.position, controls.getLookDirection());

    // Clouds drift
    clouds.update(delta);

    // HUD telemetry update
    hud.update(delta, camera, controls, chunkManager, currentCity);

    // Crosshair inspection update
    inspector.update(delta);

    // Periodic state autosave
    saveTimer += delta;
    if (saveTimer > 1.5) {
      saveTimer = 0;
      saveState();
    }

    // Render frame
    renderer.render(scene, camera);
  }

  // Set modern WebGPU animation loop immediately
  if ('setAnimationLoop' in renderer && typeof (renderer as any).setAnimationLoop === 'function') {
    (renderer as any).setAnimationLoop(onFrame);
  } else {
    const loop = () => {
      requestAnimationFrame(loop);
      onFrame();
    };
    loop();
  }

  // Restore saved state or spawn at Manhattan default
  let restored = false;
  const saved = StorageService.loadState();
  if (saved && saved.city && saved.pos) {
    currentCity = saved.city;
    const title = saved.city.title || saved.city.name.split(',')[0].trim();
    const subtitle = saved.city.subtitle || saved.city.zoomDesc || '';
    hud.setLocationHeader(title, subtitle);
    hud.updateStatus(`Восстановление позиции: ${title} (${subtitle})...`);

    camera.position.set(saved.pos.x, saved.pos.y, saved.pos.z);
    if (saved.rot) {
      controls.setLookAngles(saved.rot.yaw, saved.rot.pitch);
    }
    controls.resetVelocity();

    if (saved.time) {
      atmosphere.setTimeOfDay(saved.time);
      hud.setTimeButtonsActive(saved.time);
    }

    if (saved.renderDist) {
      updateRenderDistance(saved.renderDist);
    }

    chunkManager.clearAll();
    chunkManager.update(camera.position, controls.getLookDirection());

    osmProvider.setAnchor(saved.city.lat, saved.city.lon, 900).then(() => {
      hud.updateStatus(osmProvider.statusMessage);
      chunkManager.refreshNonOsmChunks();
    });

    restored = true;
  }

  if (!restored) {
    await teleportToCity(FAMOUS_CITIES[0]);
  }

  window.addEventListener('beforeunload', () => {
    saveState();
  });
}

// Bootstrap
initApplication().catch(err => {
  console.error('Fatal initialization error:', err);
});
