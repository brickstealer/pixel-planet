import { OsmCache } from '../../utils/OsmCache.js';
import { FAMOUS_CITIES, SubwayStation, InspectedFeatureInfo, SectorInfo, NominatimResult } from './OsmTypes.js';
import { GeoCoords } from './GeoCoords.js';
import { OverpassClient } from './OverpassClient.js';
import { NominatimService } from './NominatimService.js';
import { OsmParser } from './OsmParser.js';
import { SpatialFeatureStore } from './SpatialFeatureStore.js';
import { OsmVoxelRasterizer } from './OsmVoxelRasterizer.js';

export { FAMOUS_CITIES };

interface QueueTask {
  worldX: number;
  worldZ: number;
  radiusMeters: number;
  sectorKey: string;
}

export class OsmDataProvider {
  anchorLat: number = 0;
  anchorLon: number = 0;

  store: SpatialFeatureStore = new SpatialFeatureStore();
  subwayStations: SubwayStation[] = [];
  cache: OsmCache = new OsmCache();
  client: OverpassClient;

  fetchedSectors: Set<string> = new Set();
  activeFetches: Set<string> = new Set();
  queuedSectors: Set<string> = new Set();
  failedSectors: Map<string, number> = new Map();

  requestQueue: QueueTask[] = [];
  isProcessingQueue: boolean = false;

  isLoading: boolean = false;
  statusMessage: string = 'Ready';
  onFeaturesLoaded: (() => void) | null = null;

  lastCheckPos = { x: 0, z: 0 };
  lastCheckTime: number = 0;
  playerPos = { x: 0, z: 0 };

  sectorSize: number = 600;
  maxActiveFetches: number = 2;

  constructor() {
    this.client = new OverpassClient(this.cache);
  }

  setSectorSize(newSize: number): void {
    if (this.sectorSize === newSize) return;
    this.sectorSize = Math.max(100, Math.min(1500, newSize));
    this.fetchedSectors.clear();
    this.queuedSectors.clear();
    this.requestQueue = [];
    this.lastCheckPos = { x: 0, z: 0 };
    this.lastCheckTime = 0;
  }

  setConcurrency(val: number): void {
    this.maxActiveFetches = Math.max(1, Math.min(6, val));
  }

  reloadNearbySectors(playerWorldX: number, playerWorldZ: number): void {
    this.fetchedSectors.clear();
    this.queuedSectors.clear();
    this.requestQueue = [];
    this.store.clear();
    this.lastCheckPos = { x: 0, z: 0 };
    this.lastCheckTime = 0;
    this.checkStreaming(playerWorldX, playerWorldZ, 20);
  }

  async clearCache(): Promise<void> {
    await this.cache.clear();
    this.reloadNearbySectors(this.playerPos.x, this.playerPos.z);
  }

  get features() {
    return this.store.features;
  }

  get spatialBuckets() {
    return this.store.spatialBuckets;
  }

  async searchLocation(query: string): Promise<NominatimResult[] | null> {
    this.statusMessage = `Поиск "${query}"...`;
    const results = await NominatimService.searchLocation(query);
    if (!results || results.length === 0) {
      this.statusMessage = 'Место не найдено';
      return null;
    }
    return results;
  }

  async setAnchor(lat: number, lon: number, initialRadius: number = 700): Promise<void> {
    this.anchorLat = lat;
    this.anchorLon = lon;
    this.store.clear();
    this.subwayStations = [];
    this.fetchedSectors.clear();
    this.activeFetches.clear();
    this.queuedSectors.clear();
    this.failedSectors.clear();
    this.requestQueue = [];
    this.isProcessingQueue = false;
    this.lastCheckPos = { x: 0, z: 0 };

    this.isLoading = true;
    this.statusMessage = `Загрузка OSM для [${lat.toFixed(3)}, ${lon.toFixed(3)}]...`;

    // Fetch initial master sector
    const res = await this.fetchSectorByWorld(0, 0, initialRadius, '0,0');
    this.isLoading = false;

    if (res.success) {
      // Mark all grid sectors within initialRadius as successfully fetched!
      const rSectors = Math.ceil(initialRadius / this.sectorSize);
      for (let sx = -rSectors; sx <= rSectors; sx++) {
        for (let sz = -rSectors; sz <= rSectors; sz++) {
          const cX = (sx + 0.5) * this.sectorSize;
          const cZ = (sz + 0.5) * this.sectorSize;
          if (Math.hypot(cX, cZ) <= initialRadius + this.sectorSize * 0.5) {
            this.fetchedSectors.add(`${sx},${sz}`);
          }
        }
      }
    }
  }

  checkStreaming(playerWorldX: number, playerWorldZ: number, renderDistChunks: number = 10): void {
    this.playerPos = { x: playerWorldX, z: playerWorldZ };
    const now = Date.now();

    const distSinceCheck = Math.hypot(playerWorldX - this.lastCheckPos.x, playerWorldZ - this.lastCheckPos.z);
    if (distSinceCheck < 30 && (now - this.lastCheckTime) < 1200) {
      return;
    }
    this.lastCheckTime = now;
    this.lastCheckPos = { x: playerWorldX, z: playerWorldZ };

    const SECTOR_SIZE = this.sectorSize;
    const currentSectorX = Math.floor(playerWorldX / SECTOR_SIZE);
    const currentSectorZ = Math.floor(playerWorldZ / SECTOR_SIZE);

    const viewDistMeters = renderDistChunks * 32;
    const sectorR = Math.min(16, Math.max(1, Math.ceil(viewDistMeters / SECTOR_SIZE)));

    // Prune queue to active view distance + buffer so distant sectors don't block close ones
    const maxActiveDist = viewDistMeters + 150;
    this.requestQueue = this.requestQueue.filter(task => {
      const d = Math.hypot(task.worldX - playerWorldX, task.worldZ - playerWorldZ);
      if (d > maxActiveDist) {
        this.queuedSectors.delete(task.sectorKey);
        return false;
      }
      return true;
    });

    const sectors: { sx: number; sz: number; key: string; centerX: number; centerZ: number; dist: number }[] = [];
    for (let dx = -sectorR; dx <= sectorR; dx++) {
      for (let dz = -sectorR; dz <= sectorR; dz++) {
        const sx = currentSectorX + dx;
        const sz = currentSectorZ + dz;
        const key = `${sx},${sz}`;

        if (this.failedSectors.has(key)) {
          if (now >= (this.failedSectors.get(key) || 0)) {
            this.failedSectors.delete(key);
          } else {
            continue;
          }
        }

        const centerX = (sx + 0.5) * SECTOR_SIZE;
        const centerZ = (sz + 0.5) * SECTOR_SIZE;
        const dist = Math.hypot(centerX - playerWorldX, centerZ - playerWorldZ);
        sectors.push({ sx, sz, key, centerX, centerZ, dist });
      }
    }

    sectors.sort((a, b) => a.dist - b.dist);

    for (const s of sectors) {
      if (!this.fetchedSectors.has(s.key) && !this.queuedSectors.has(s.key) && !this.activeFetches.has(s.key)) {
        this.queuedSectors.add(s.key);
        this.requestQueue.push({
          worldX: s.centerX,
          worldZ: s.centerZ,
          radiusMeters: SECTOR_SIZE / 2 + 60,
          sectorKey: s.key
        });
      }
    }

    this.requestQueue.sort((a, b) => {
      const distA = Math.hypot(a.worldX - playerWorldX, a.worldZ - playerWorldZ);
      const distB = Math.hypot(b.worldX - playerWorldX, b.worldZ - playerWorldZ);
      return distA - distB;
    });

    this.processRequestQueue();
  }

  async processRequestQueue(): Promise<void> {
    if (this.isProcessingQueue || this.requestQueue.length === 0) return;
    this.isProcessingQueue = true;

    while (this.requestQueue.length > 0) {
      // Limit concurrency to user configured maxActiveFetches
      while (this.activeFetches.size >= this.maxActiveFetches) {
        await new Promise(resolve => setTimeout(resolve, 80));
      }

      if (this.requestQueue.length === 0) break;

      this.requestQueue.sort((a, b) => {
        const distA = Math.hypot(a.worldX - this.playerPos.x, a.worldZ - this.playerPos.z);
        const distB = Math.hypot(b.worldX - this.playerPos.x, b.worldZ - this.playerPos.z);
        return distA - distB;
      });

      const task = this.requestQueue.shift();
      if (!task) break;
      this.queuedSectors.delete(task.sectorKey);

      // Launch worker
      this.fetchSectorByWorld(task.worldX, task.worldZ, task.radiusMeters, task.sectorKey).then(async (res) => {
        if (!res || !res.fromCache) {
          await new Promise(resolve => setTimeout(resolve, 600));
        }
      }).catch(err => {
        console.warn('Sector fetch error:', err);
      });

      // Small throttle between spawning concurrent workers
      await new Promise(resolve => setTimeout(resolve, 120));
    }

    // Wait until in-flight workers finish
    while (this.activeFetches.size > 0) {
      await new Promise(resolve => setTimeout(resolve, 80));
    }

    this.isProcessingQueue = false;
  }

  async fetchSectorByWorld(worldX: number, worldZ: number, radiusMeters: number, sectorKey: string | null = null): Promise<{ success: boolean; fromCache: boolean }> {
    if (sectorKey) this.activeFetches.add(sectorKey);

    const [targetLat, targetLon] = GeoCoords.worldToLatLon(worldX, worldZ, this.anchorLat, this.anchorLon);

    const deltaLat = radiusMeters / 110540;
    const deltaLon = radiusMeters / (111320 * Math.cos(targetLat * Math.PI / 180));

    const south = targetLat - deltaLat;
    const north = targetLat + deltaLat;
    const west = targetLon - deltaLon;
    const east = targetLon + deltaLon;

    const res = await this.client.fetchSector(south, west, north, east);

    if (res.success && res.data) {
      this.processOsmData(res.data);
      this.statusMessage = res.fromCache
        ? `OSM (Кэш): ${this.store.features.length} реальных зданий & объектов`
        : `OSM Онлайн: ${this.store.features.length} реальных зданий & объектов`;
    }

    if (sectorKey) {
      this.activeFetches.delete(sectorKey);
      this.queuedSectors.delete(sectorKey);

      if (res.success) {
        this.fetchedSectors.add(sectorKey);
        this.failedSectors.delete(sectorKey);
      } else {
        this.failedSectors.set(sectorKey, Date.now() + 12000);
      }
    }

    if (res.success && this.onFeaturesLoaded) {
      this.onFeaturesLoaded();
    }

    return { success: res.success, fromCache: res.fromCache };
  }

  processOsmData(osmData: any): void {
    if (!osmData || !osmData.elements) return;
    OsmParser.parseElements(osmData.elements, this.anchorLat, this.anchorLon, this.store, this.subwayStations);
  }

  isDesertRegion(): boolean {
    return GeoCoords.isDesertRegion(this.anchorLat, this.anchorLon);
  }

  isPointInLoadedSector(worldX: number, worldZ: number): boolean {
    const SECTOR_SIZE = this.sectorSize;
    const sx = Math.floor(worldX / SECTOR_SIZE);
    const sz = Math.floor(worldZ / SECTOR_SIZE);
    if (this.fetchedSectors.has(`${sx},${sz}`)) return true;

    // Anchor initial radius (~850m) is already fetched and stored in memory upon city teleport!
    if (Math.hypot(worldX, worldZ) <= 850) {
      return true;
    }

    return false;
  }

  populateChunk(chunkX: number, chunkZ: number, voxels: Uint8Array, groundY: number = 20): boolean {
    const startX = chunkX * 16 * 2.0;
    const endX = startX + 16 * 2.0;
    const startZ = chunkZ * 16 * 2.0;
    const endZ = startZ + 16 * 2.0;

    const midX = (startX + endX) / 2;
    const midZ = (startZ + endZ) / 2;
    const isSectorActive = this.isPointInLoadedSector(midX, midZ);
    const nearbyFeatures = this.store.getFeaturesInBounds(startX, startZ, endX, endZ);

    return OsmVoxelRasterizer.rasterizeChunk(
      chunkX,
      chunkZ,
      voxels,
      nearbyFeatures,
      isSectorActive,
      this.isDesertRegion(),
      groundY
    );
  }

  getSectorInfo(worldX: number, worldZ: number): SectorInfo {
    const SECTOR_SIZE = this.sectorSize;
    const sx = Math.floor(worldX / SECTOR_SIZE);
    const sz = Math.floor(worldZ / SECTOR_SIZE);
    const key = `${sx},${sz}`;

    const centerX = (sx + 0.5) * SECTOR_SIZE;
    const centerZ = (sz + 0.5) * SECTOR_SIZE;
    const [targetLat, targetLon] = GeoCoords.worldToLatLon(centerX, centerZ, this.anchorLat, this.anchorLon);

    let status = 'Ожидает приближения';
    if (this.fetchedSectors.has(key)) {
      status = 'Загружен (в памяти / кэше)';
    } else if (this.activeFetches.has(key)) {
      status = 'Скачивается по сети (HTTP in-flight)...';
    } else if (this.queuedSectors.has(key)) {
      const idx = this.requestQueue.findIndex(t => t.sectorKey === key);
      status = idx >= 0 ? `В очереди (#${idx + 1})` : 'В очереди';
    }

    return {
      sectorKey: key,
      sx, sz,
      targetLat, targetLon,
      status
    };
  }

  getFeatureAtPoint(worldX: number, worldZ: number): InspectedFeatureInfo | null {
    return this.store.getFeatureAtPoint(
      worldX,
      worldZ,
      this.subwayStations,
      (x, z) => this.isPointInLoadedSector(x, z),
      (x, z) => this.getSectorInfo(x, z)
    );
  }
}
