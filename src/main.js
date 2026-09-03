import * as THREE from 'three';
import { CHUNK_SIZE_X, CHUNK_SIZE_Z, VOXEL_SIZE } from './core/VoxelTypes.js';
import { ChunkManager } from './core/ChunkManager.js';
import { TerrainGenerator } from './generator/TerrainGenerator.js';
import { OsmDataProvider, FAMOUS_CITIES } from './generator/OsmDataProvider.js';
import { FlightControls } from './controls/FlightControls.js';

// --- 1. Scene & Renderer Setup ---
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  0.5,
  1200
);
camera.position.set(0, 75, 0); // Start flying above city

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

// --- 2. Voxel Material with Night Glowing Windows ---
const voxelUniforms = {
  uNight: { value: 0.0 }
};

const voxelMaterial = new THREE.MeshLambertMaterial({
  vertexColors: true,
  reflectivity: 0.1
});

voxelMaterial.onBeforeCompile = (shader) => {
  shader.uniforms.uNight = voxelUniforms.uNight;

  shader.vertexShader = `
    attribute float aEmissive;
    varying float vEmissive;
    ${shader.vertexShader}
  `;
  shader.vertexShader = shader.vertexShader.replace(
    '#include <color_vertex>',
    `#include <color_vertex>
     vEmissive = aEmissive;`
  );

  shader.fragmentShader = `
    varying float vEmissive;
    uniform float uNight;
    ${shader.fragmentShader}
  `;
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <dithering_fragment>',
    `#include <dithering_fragment>
     if (vEmissive > 0.5) {
       // Warm glowing window boost (especially noticeable at night)
       gl_FragColor.rgb += vec3(0.95, 0.75, 0.25) * (0.6 + uNight * 1.8);
     }
    `
  );
};

// --- 3. Atmosphere, Sun & Lighting ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.55);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xfffaed, 1.4);
sunLight.position.set(120, 250, 90);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.near = 10;
sunLight.shadow.camera.far = 600;
sunLight.shadow.camera.left = -200;
sunLight.shadow.camera.right = 200;
sunLight.shadow.camera.top = 200;
sunLight.shadow.camera.bottom = -200;
scene.add(sunLight);

// Voxel Fog
const fog = new THREE.FogExp2(0xa0d0ff, 0.0028);
scene.fog = fog;
scene.background = new THREE.Color(0xa0d0ff);

// --- 4. Procedural Voxel Clouds ---
const cloudsGroup = new THREE.Group();
const cloudGeo = new THREE.BoxGeometry(1, 1, 1);
const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });

for (let i = 0; i < 35; i++) {
  const cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
  const cx = (Math.random() - 0.5) * 1200;
  const cz = (Math.random() - 0.5) * 1200;
  const cy = 160 + Math.random() * 40;
  const scaleX = 40 + Math.random() * 80;
  const scaleZ = 30 + Math.random() * 60;
  const scaleY = 8 + Math.random() * 12;

  cloudMesh.position.set(cx, cy, cz);
  cloudMesh.scale.set(scaleX, scaleY, scaleZ);
  cloudsGroup.add(cloudMesh);
}
scene.add(cloudsGroup);

// --- 5. Core Systems Initialization ---
const terrainGen = new TerrainGenerator(1337);
const osmProvider = new OsmDataProvider();
const chunkManager = new ChunkManager(scene, terrainGen, osmProvider, voxelMaterial);

// Refresh chunks when new OSM sectors stream in
osmProvider.onFeaturesLoaded = () => {
  chunkManager.refreshNonOsmChunks();
  updateStatus(osmProvider.statusMessage);
};
const controls = new FlightControls(camera, renderer.domElement);

// --- 6. Teleportation & City Navigation ---
let currentCity = FAMOUS_CITIES[0]; // Manhattan default

async function teleportToCity(city) {
  currentCity = city;
  const title = city.title || city.name.split(',')[0].trim();
  const subtitle = city.subtitle || city.zoomDesc || '';

  document.getElementById('loc-tag').textContent = title.toUpperCase();
  const subtitleEl = document.getElementById('loc-subtitle');
  if (subtitleEl) {
    subtitleEl.textContent = subtitle;
    subtitleEl.title = subtitle;
  }

  updateStatus(`Локация: ${title} (${subtitle})...`);

  // Reset camera to spawn position above city center
  camera.position.set(0, 85, 0);
  controls.velocity.set(0, 0, 0);

  // Clear existing voxel chunks
  chunkManager.clearAll();

  // Load OSM data
  await osmProvider.setAnchor(city.lat, city.lon, 900);
  updateStatus(osmProvider.statusMessage);

  // Trigger initial chunk generation around new position
  chunkManager.update(camera.position, controls.getLookDirection());
  savePlayerState();
}

// Search Bar Handling (Nominatim Geocoding with Live Autocomplete)
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const searchDropdown = document.getElementById('search-dropdown');
let searchDebounceTimer = null;
let currentSearchResults = [];

let selectedDropdownIndex = -1;

function updateDropdownHighlight() {
  if (!searchDropdown) return;
  const items = searchDropdown.querySelectorAll('.search-dropdown-item');
  items.forEach((item, idx) => {
    item.classList.toggle('active', idx === selectedDropdownIndex);
  });
}

function hideSearchDropdown() {
  selectedDropdownIndex = -1;
  if (searchDropdown) {
    searchDropdown.style.display = 'none';
    searchDropdown.innerHTML = '';
  }
}

function showSearchResults(results) {
  currentSearchResults = results;
  selectedDropdownIndex = -1; // Reset selection so typing doesn't auto-pick
  if (!searchDropdown || !results || results.length === 0) {
    hideSearchDropdown();
    return;
  }

  searchDropdown.innerHTML = results.map((item, idx) => `
    <div class="search-dropdown-item" data-idx="${idx}">
      <div class="search-dropdown-title">
        <span>📍</span>
        <span>${item.title}</span>
      </div>
      <div class="search-dropdown-subtitle">${item.subtitle}</div>
    </div>
  `).join('');

  searchDropdown.style.display = 'flex';

  searchDropdown.querySelectorAll('.search-dropdown-item').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.idx, 10);
      selectSearchResult(results[idx]);
    });
  });
}

async function selectSearchResult(target) {
  hideSearchDropdown();
  searchInput.value = target.title;
  searchInput.blur();

  const customCity = {
    name: target.title,
    title: target.title,
    subtitle: target.subtitle,
    lat: target.lat,
    lon: target.lon,
    zoomDesc: target.subtitle
  };

  await teleportToCity(customCity);

  setTimeout(() => {
    renderer.domElement.requestPointerLock();
  }, 350);
}

// Clicking on search input ensures pointer lock is released
searchInput.addEventListener('focus', () => {
  if (document.pointerLockElement) {
    document.exitPointerLock();
  }
  if (currentSearchResults.length > 0) {
    searchDropdown.style.display = 'flex';
  }
});

// Arrow key navigation inside suggestions
searchInput.addEventListener('keydown', (e) => {
  if (searchDropdown.style.display !== 'none' && currentSearchResults.length > 0) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedDropdownIndex = (selectedDropdownIndex + 1) % currentSearchResults.length;
      updateDropdownHighlight();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedDropdownIndex = (selectedDropdownIndex - 1 + currentSearchResults.length) % currentSearchResults.length;
      updateDropdownHighlight();
      return;
    }
    if (e.key === 'Escape') {
      hideSearchDropdown();
      return;
    }
  }
});

// Live typing suggestions with debounce
searchInput.addEventListener('input', (e) => {
  const query = e.target.value.trim();
  clearTimeout(searchDebounceTimer);
  selectedDropdownIndex = -1;

  if (query.length < 2) {
    hideSearchDropdown();
    return;
  }

  searchDebounceTimer = setTimeout(async () => {
    const results = await osmProvider.searchLocation(query);
    if (results && results.length > 0) {
      showSearchResults(results);
    } else {
      hideSearchDropdown();
    }
  }, 300);
});

// Close dropdown on outside click
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-wrapper')) {
    hideSearchDropdown();
  }
});

// Form submission on Enter: search EXACTLY what user typed unless an option was explicitly picked
searchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = searchInput.value.trim();
  if (!query) return;

  clearTimeout(searchDebounceTimer);

  // If user explicitly highlighted an item using Arrow keys, use that item
  if (selectedDropdownIndex >= 0 && currentSearchResults[selectedDropdownIndex]) {
    selectSearchResult(currentSearchResults[selectedDropdownIndex]);
    return;
  }

  // Otherwise, user pressed Enter directly on what they typed: search exact query!
  hideSearchDropdown();
  updateStatus(`Поиск "${query}" на планете...`);

  const results = await osmProvider.searchLocation(query);
  if (results && results.length > 0) {
    selectSearchResult(results[0]);
  } else {
    updateStatus(`Место "${query}" не найдено. Уточните название.`);
  }
});

// --- 7. Time of Day & Lighting Control ---
const timeButtons = document.querySelectorAll('.time-btn');
let currentTimeMode = 'day';

function setTimeOfDay(mode) {
  currentTimeMode = mode;
  timeButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.time === mode);
  });

  if (mode === 'day') {
    scene.background.set(0x87ceeb);
    fog.color.set(0xa0d0ff);
    sunLight.color.set(0xfffaed);
    sunLight.intensity = 1.4;
    sunLight.position.set(120, 250, 90);
    ambientLight.intensity = 0.6;
    ambientLight.color.set(0xffffff);
    voxelUniforms.uNight.value = 0.0;
  } else if (mode === 'sunset') {
    scene.background.set(0xe0603a);
    fog.color.set(0xca5838);
    sunLight.color.set(0xff7733);
    sunLight.intensity = 1.1;
    sunLight.position.set(280, 60, -40);
    ambientLight.intensity = 0.45;
    ambientLight.color.set(0xffa07a);
    voxelUniforms.uNight.value = 0.4;
  } else if (mode === 'night') {
    scene.background.set(0x0a0f1d);
    fog.color.set(0x0a0f1d);
    sunLight.color.set(0x5a7ebb);
    sunLight.intensity = 0.35;
    sunLight.position.set(-90, 180, -90);
    ambientLight.intensity = 0.22;
    ambientLight.color.set(0x3a4866);
    voxelUniforms.uNight.value = 1.0;
  }
}

timeButtons.forEach(btn => {
  btn.addEventListener('click', () => setTimeOfDay(btn.dataset.time));
});

// Render Distance Slider
const renderSlider = document.getElementById('render-dist-slider');
const renderLabel = document.getElementById('render-dist-val');
renderSlider.addEventListener('input', (e) => {
  const val = parseInt(e.target.value, 10);
  chunkManager.renderDistance = val;
  renderLabel.textContent = `${val} чанков`;
});

// Start button click & instructions dismiss
const instructionsOverlay = document.getElementById('instructions-overlay');
const startBtn = document.getElementById('start-btn');

function dismissInstructionsAndFly() {
  if (instructionsOverlay) {
    instructionsOverlay.style.display = 'none';
  }
  controls.hasStarted = true;
  renderer.domElement.requestPointerLock();
}

if (startBtn) {
  startBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    dismissInstructionsAndFly();
  });
}

if (instructionsOverlay) {
  instructionsOverlay.addEventListener('click', (e) => {
    if (e.target === instructionsOverlay) {
      dismissInstructionsAndFly();
    }
  });
}

function updateStatus(msg) {
  const statusEl = document.getElementById('status-text');
  if (statusEl) statusEl.textContent = msg;
}

// --- 8. HUD Real-Time Telemetry Updates ---
const statCoords = document.getElementById('stat-coords');
const statAlt = document.getElementById('stat-alt');
const statHeading = document.getElementById('stat-heading');
const statChunk = document.getElementById('stat-chunk');
const statChunksCount = document.getElementById('stat-chunks-count');
const speedVal = document.getElementById('speed-val');
const speedBar = document.getElementById('speed-bar');

let hudUpdateTimer = 0;

function updateHUD(dt) {
  hudUpdateTimer += dt;
  if (hudUpdateTimer < 0.1) return; // 10 updates per second is plenty
  hudUpdateTimer = 0;

  // Speed
  const speedKmh = controls.getSpeedKmh();
  speedVal.textContent = speedKmh;
  const fillPct = Math.min(100, Math.round((speedKmh / 400) * 100));
  speedBar.style.width = `${fillPct}%`;

  // Altitude
  statAlt.textContent = `${Math.round(camera.position.y * 1.5)} m`;

  // Current Chunk
  const cx = Math.floor(camera.position.x / (CHUNK_SIZE_X * VOXEL_SIZE));
  const cz = Math.floor(camera.position.z / (CHUNK_SIZE_Z * VOXEL_SIZE));
  statChunk.textContent = `[${cx}, ${cz}]`;
  statChunksCount.textContent = chunkManager.getChunkCount();

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
  statHeading.textContent = `${angleDeg.toString().padStart(3, '0')}° ${compass}`;

  // Current Global GPS Coordinates
  if (currentCity) {
    const latOffset = -camera.position.z / 110540;
    const lonOffset = camera.position.x / (111320 * Math.cos(currentCity.lat * Math.PI / 180));
    const currentLat = currentCity.lat + latOffset;
    const currentLon = currentCity.lon + lonOffset;

    const latStr = `${Math.abs(currentLat).toFixed(4)}° ${currentLat >= 0 ? 'N' : 'S'}`;
    const lonStr = `${Math.abs(currentLon).toFixed(4)}° ${currentLon >= 0 ? 'E' : 'W'}`;
    statCoords.textContent = `${latStr}, ${lonStr}`;
  }
}

// --- 9. Main Animation Loop ---
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const delta = Math.min(clock.getDelta(), 0.1);

  // Update flight controls
  controls.update(delta);

  // Update voxel streaming chunks
  chunkManager.update(camera.position, controls.getLookDirection());

  // Drift voxel clouds slowly across the sky
  cloudsGroup.position.x += delta * 4;
  if (cloudsGroup.position.x > 600) cloudsGroup.position.x = -600;

  // Update HUD telemetry
  updateHUD(delta);

  // Update Crosshair Target Inspection
  updateBuildingInspection(delta);

  // Auto-save player state every 1.5 seconds
  saveTimer += delta;
  if (saveTimer > 1.5) {
    saveTimer = 0;
    savePlayerState();
  }

  // Render scene
  renderer.render(scene, camera);
}

// --- 8.1 Building Inspection under Crosshair (Raycasting) ---
const raycaster = new THREE.Raycaster();
const screenCenter = new THREE.Vector2(0, 0);

const targetCard = document.getElementById('target-card');
const targetDist = document.getElementById('target-dist');
const targetName = document.getElementById('target-name');
const targetAddress = document.getElementById('target-address');
const targetLevels = document.getElementById('target-levels');
const targetHeight = document.getElementById('target-height');
const targetType = document.getElementById('target-type');
const targetPois = document.getElementById('target-pois');
const crosshairEl = document.getElementById('crosshair');

let inspectTimer = 0;

function updateBuildingInspection(dt) {
  inspectTimer += dt;
  if (inspectTimer < 0.12) return; // 8 times a second
  inspectTimer = 0;

  const activeMeshes = [];
  for (const chunk of chunkManager.activeChunks.values()) {
    if (chunk.mesh) activeMeshes.push(chunk.mesh);
  }

  if (activeMeshes.length === 0) {
    if (targetCard) targetCard.style.display = 'none';
    if (crosshairEl) crosshairEl.classList.remove('targeted');
    return;
  }

  raycaster.setFromCamera(screenCenter, camera);
  raycaster.far = 450;
  const intersects = raycaster.intersectObjects(activeMeshes, false);

  if (intersects.length > 0) {
    const hit = intersects[0];
    const hitPoint = hit.point;

    // Check hit on ground or building structure (ground is at y=20)
    if (hitPoint.y > 19.5) {
      const info = osmProvider.getFeatureAtPoint(hitPoint.x, hitPoint.z);

      if (info) {
        if (targetCard) {
          targetCard.style.display = 'block';
          targetDist.textContent = `${Math.round(hit.distance)} м`;
          targetName.textContent = info.name || 'Городское здание';
          targetAddress.textContent = info.address || (info.city ? `г. ${info.city}` : 'Адрес не указан в OSM');
          targetLevels.textContent = `${info.levels} эт.`;
          targetHeight.textContent = `${info.height} м`;
          targetType.textContent = info.buildingType || 'Объект';

          // Display POIs (Cafes, McDonald's, shops, monuments) inside/near target
          if (info.pois && info.pois.length > 0 && targetPois) {
            targetPois.style.display = 'flex';
            targetPois.innerHTML = info.pois.slice(0, 3).map(p => `
              <div class="target-poi-item">
                <div class="target-poi-main">
                  <span>${p.icon}</span>
                  <span>${p.name}</span>
                </div>
                ${p.openingHours ? `<span class="target-poi-time">${p.openingHours}</span>` : ''}
              </div>
            `).join('');
          } else if (targetPois) {
            targetPois.style.display = 'none';
            targetPois.innerHTML = '';
          }
        }
        if (crosshairEl) crosshairEl.classList.add('targeted');
        return;
      }
    }
  }

  if (targetCard) targetCard.style.display = 'none';
  if (crosshairEl) crosshairEl.classList.remove('targeted');
}

// --- 10. Window Resize Handling ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- 11. State Persistence (Save & Restore Player Position) ---
let saveTimer = 0;

function savePlayerState() {
  if (!currentCity) return;
  const state = {
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
    time: currentTimeMode,
    renderDist: chunkManager.renderDistance
  };
  try {
    localStorage.setItem('pixel_planet_saved_state', JSON.stringify(state));
  } catch (err) {
    // Ignore quota errors
  }
}

window.addEventListener('beforeunload', (e) => {
  savePlayerState();
  if (controls && controls.isLocked) {
    e.preventDefault();
    e.returnValue = '';
    return '';
  }
});

async function bootApp() {
  let restored = false;
  const savedStateRaw = localStorage.getItem('pixel_planet_saved_state');

  if (savedStateRaw) {
    try {
      const saved = JSON.parse(savedStateRaw);
      if (saved && saved.city && saved.pos) {
        currentCity = saved.city;
        const title = saved.city.title || saved.city.name.split(',')[0].trim();
        const subtitle = saved.city.subtitle || saved.city.zoomDesc || '';
        document.getElementById('loc-tag').textContent = title.toUpperCase();
        const subtitleEl = document.getElementById('loc-subtitle');
        if (subtitleEl) subtitleEl.textContent = subtitle;

        updateStatus(`Восстановление позиции: ${title} (${subtitle})...`);

        // Restore camera position & view angles
        camera.position.set(saved.pos.x, saved.pos.y, saved.pos.z);
        if (saved.rot) {
          controls.setLookAngles(saved.rot.yaw, saved.rot.pitch);
        }
        controls.resetVelocity();

        // Restore time mode
        if (saved.time) {
          setTimeOfDay(saved.time);
        }

        // Restore render distance
        if (saved.renderDist) {
          chunkManager.renderDistance = saved.renderDist;
          if (renderSlider) renderSlider.value = saved.renderDist;
          if (renderLabel) renderLabel.textContent = `${saved.renderDist} чанков`;
        }

        // Initialize OSM anchor around saved city
        chunkManager.clearAll();
        await osmProvider.setAnchor(saved.city.lat, saved.city.lon, 900);
        updateStatus(osmProvider.statusMessage);

        // Stream chunks at player's exact saved position
        osmProvider.checkStreaming(camera.position.x, camera.position.z);
        chunkManager.update(camera.position, controls.getLookDirection());

        restored = true;
      }
    } catch (err) {
      console.warn('Failed to restore saved player state:', err);
    }
  }

  if (!restored) {
    await teleportToCity(FAMOUS_CITIES[0]);
  }

  animate();
}

bootApp();
