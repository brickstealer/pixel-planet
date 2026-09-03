import {
  CHUNK_SIZE_X,
  CHUNK_SIZE_Y,
  CHUNK_SIZE_Z,
  VOXEL_SIZE,
  BlockType
} from '../core/VoxelTypes.js';
import { OsmCache } from '../utils/OsmCache.js';

export const FAMOUS_CITIES = [
  { name: 'Манхэттен', subtitle: 'Нью-Йорк, США', lat: 40.7484, lon: -73.9857, zoomDesc: 'Empire State & Midtown Skyscrapers', groundY: 20 },
  { name: 'Париж', subtitle: 'Франция • Эйфелева башня', lat: 48.8584, lon: 2.2945, zoomDesc: 'Champ de Mars & Haussmann Quarters', groundY: 20 },
  { name: 'Токио', subtitle: 'Япония • Сибуя', lat: 35.6595, lon: 139.7004, zoomDesc: 'Shibuya Crossing & Neon Towers', groundY: 20 },
  { name: 'Москва', subtitle: 'Россия • Красная площадь', lat: 55.7539, lon: 37.6208, zoomDesc: 'Кремлевские башни и исторический центр', groundY: 20 },
  { name: 'Лондон', subtitle: 'Великобритания • Вестминстер', lat: 51.5007, lon: -0.1246, zoomDesc: 'Big Ben, River Thames & Bridges', groundY: 20 },
  { name: 'Дубай', subtitle: 'ОАЭ • Бурдж-Халифа', lat: 25.1972, lon: 55.2744, zoomDesc: 'Downtown Mega Skyscrapers', groundY: 18 },
  { name: 'Рим', subtitle: 'Италия • Колизей', lat: 41.8902, lon: 12.4922, zoomDesc: 'Colosseum & Roman Forum Ruins', groundY: 20 },
  { name: 'Сан-Франциско', subtitle: 'США • Финансовый район', lat: 37.7891, lon: -122.4014, zoomDesc: 'Financial District & Bay Coast', groundY: 22 },
];

export class OsmDataProvider {
  constructor() {
    this.anchorLat = 0;
    this.anchorLon = 0;

    // Spatial hash grid: "gridX,gridZ" -> Array of features
    this.spatialBuckets = new Map();
    this.features = [];

    // Track fetched sector grid coordinates (each sector ~ 600m x 600m)
    this.fetchedSectors = new Set();
    this.activeFetches = new Set();

    this.isLoading = false;
    this.statusMessage = 'Ready';
    this.onFeaturesLoaded = null; // callback to refresh chunks

    this.requestQueue = [];
    this.isProcessingQueue = false;
    this.queuedSectors = new Set();
    this.failedSectors = new Map(); // sectorKey -> retry timestamp
    this.lastCheckPos = { x: 0, z: 0 };
    this.playerPos = { x: 0, z: 0 };
    this.subwayStations = []; // registry of stations for entrance name resolution
    this.cache = new OsmCache();

    this.overpassMirrors = [
      'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
      'https://overpass.private.coffee/api/interpreter',
      'https://overpass-api.de/api/interpreter'
    ];
  }

  /**
   * Search city or landmark using Nominatim Geocoding with detailed address breakdown
   */
  async searchLocation(query) {
    try {
      this.statusMessage = `Поиск "${query}"...`;
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=8&addressdetails=1&accept-language=ru,en`;
      const res = await fetch(url, {
        headers: { 'Accept-Language': 'ru,en' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data || data.length === 0) {
        this.statusMessage = 'Место не найдено';
        return null;
      }
      return data.map(item => {
        const addr = item.address || {};
        const title = addr.road || addr.suburb || item.name || item.display_name.split(',')[0].trim();
        const cityName = addr.city || addr.town || addr.village || addr.municipality || addr.county || '';
        const region = addr.state || '';
        const country = addr.country || '';

        const subtitleParts = [cityName, region, country].filter(p => p && p !== title);
        const subtitle = subtitleParts.join(', ') || item.display_name;

        return {
          title: title,
          subtitle: subtitle,
          fullName: item.display_name,
          city: cityName || region || country,
          lat: parseFloat(item.lat),
          lon: parseFloat(item.lon)
        };
      });
    } catch (err) {
      console.warn('Nominatim error:', err);
      this.statusMessage = 'Ошибка поиска';
      return null;
    }
  }

  /**
   * Set new global anchor and initiate initial sector loading
   */
  async setAnchor(lat, lon, initialRadius = 700) {
    this.anchorLat = lat;
    this.anchorLon = lon;
    this.spatialBuckets.clear();
    this.features = [];
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

    // Fetch central sector (0, 0) and immediate neighbors
    await this.fetchSectorByWorld(0, 0, initialRadius);
    this.isLoading = false;
  }

  /**
   * Continually checks and streams OSM sectors as player flies, prioritizing closest sectors
   */
  checkStreaming(playerWorldX, playerWorldZ) {
    this.playerPos = { x: playerWorldX, z: playerWorldZ };

    const SECTOR_SIZE = 600;
    const currentSectorX = Math.floor(playerWorldX / SECTOR_SIZE);
    const currentSectorZ = Math.floor(playerWorldZ / SECTOR_SIZE);
    const currentKey = `${currentSectorX},${currentSectorZ}`;

    const distSinceCheck = Math.hypot(playerWorldX - this.lastCheckPos.x, playerWorldZ - this.lastCheckPos.z);
    const currentSectorMissing = !this.fetchedSectors.has(currentKey);

    // If player hasn't moved much and the current sector is already loaded, skip
    if (distSinceCheck < 75 && this.fetchedSectors.size > 0 && !currentSectorMissing) {
      return;
    }
    this.lastCheckPos = { x: playerWorldX, z: playerWorldZ };

    // Prune distant tasks (> 1400m) to keep the pipeline fresh and unclogged
    this.requestQueue = this.requestQueue.filter(task => {
      const d = Math.hypot(task.worldX - playerWorldX, task.worldZ - playerWorldZ);
      if (d > 1400) {
        this.queuedSectors.delete(task.sectorKey);
        return false;
      }
      return true;
    });

    const sectors = [];
    const now = Date.now();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const sx = currentSectorX + dx;
        const sz = currentSectorZ + dz;
        const key = `${sx},${sz}`;

        // If sector failed recently, wait until cooldown expires
        if (this.failedSectors.has(key) && now < this.failedSectors.get(key)) {
          continue;
        }

        const centerX = (sx + 0.5) * SECTOR_SIZE;
        const centerZ = (sz + 0.5) * SECTOR_SIZE;
        const dist = Math.hypot(centerX - playerWorldX, centerZ - playerWorldZ);
        sectors.push({ sx, sz, key, centerX, centerZ, dist });
      }
    }

    // Always sort so closest sector comes first
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

    // Sort queue strictly by distance to player current position
    this.requestQueue.sort((a, b) => {
      const distA = Math.hypot(a.worldX - playerWorldX, a.worldZ - playerWorldZ);
      const distB = Math.hypot(b.worldX - playerWorldX, b.worldZ - playerWorldZ);
      return distA - distB;
    });

    this.processRequestQueue();
  }

  async processRequestQueue() {
    if (this.isProcessingQueue || this.requestQueue.length === 0) return;
    this.isProcessingQueue = true;

    while (this.requestQueue.length > 0) {
      // Re-sort remaining queue by distance to live player position
      this.requestQueue.sort((a, b) => {
        const distA = Math.hypot(a.worldX - this.playerPos.x, a.worldZ - this.playerPos.z);
        const distB = Math.hypot(b.worldX - this.playerPos.x, b.worldZ - this.playerPos.z);
        return distA - distB;
      });

      const task = this.requestQueue.shift();
      const res = await this.fetchSectorByWorld(task.worldX, task.worldZ, task.radiusMeters, task.sectorKey);

      // If loaded from network, wait 1100ms. If from local disk cache, instant 0ms!
      if (!res || !res.fromCache) {
        await new Promise(resolve => setTimeout(resolve, 1100));
      }
    }

    this.isProcessingQueue = false;
  }

  async fetchSectorByWorld(worldX, worldZ, radiusMeters, sectorKey = null) {
    if (sectorKey) this.activeFetches.add(sectorKey);

    // Convert world metric coordinates back to Lat/Lon
    const latOffset = -worldZ / 110540;
    const lonOffset = worldX / (111320 * Math.cos(this.anchorLat * Math.PI / 180));
    const targetLat = this.anchorLat + latOffset;
    const targetLon = this.anchorLon + lonOffset;

    const deltaLat = radiusMeters / 110540;
    const deltaLon = radiusMeters / (111320 * Math.cos(targetLat * Math.PI / 180));

    const south = targetLat - deltaLat;
    const north = targetLat + deltaLat;
    const west = targetLon - deltaLon;
    const east = targetLon + deltaLon;

    // Comprehensive Overpass query: buildings, relations, parts, highways, water, parks, parking
    const query = `
      [out:json][timeout:15];
      (
        way["building"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        relation["building"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        way["building:part"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        relation["building:part"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        way["highway"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        way["waterway"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        way["natural"="water"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        relation["natural"="water"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        way["leisure"="park"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        relation["leisure"="park"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        way["landuse"="grass"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        way["amenity"="parking"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        node["amenity"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        node["shop"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        node["tourism"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        node["historic"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        node["natural"="tree"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        way["natural"="tree_row"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        way["natural"="wood"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        relation["natural"="wood"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        way["landuse"="forest"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        relation["landuse"="forest"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        node["railway"="subway_entrance"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        node["station"="subway"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        way["station"="subway"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        node["railway"="station"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
      );
      out geom;
    `.trim();

    let success = false;
    let fromCache = false;
    const cacheKey = `osm_v3_${south.toFixed(4)}_${west.toFixed(4)}_${north.toFixed(4)}_${east.toFixed(4)}`;

    // 1. Check local IndexedDB disk cache
    const cachedData = await this.cache.get(cacheKey);
    if (cachedData) {
      this.processOsmData(cachedData);
      this.statusMessage = `OSM (Кэш): ${this.features.length} реальных зданий & объектов`;
      success = true;
      fromCache = true;
    } else {
      // 2. Query network mirror if not in cache (with 7.5s timeout per mirror)
      for (const mirror of this.overpassMirrors) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 7500);

        try {
          const res = await fetch(mirror, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'User-Agent': 'PixelPlanet3D/1.0 (tester@pixelplanet.local)'
            },
            body: 'data=' + encodeURIComponent(query),
            signal: controller.signal
          });
          clearTimeout(timeoutId);

          if (res.ok) {
            const data = await res.json();
            this.processOsmData(data);
            this.statusMessage = `OSM Онлайн: ${this.features.length} реальных зданий & объектов`;
            // Save response in IndexedDB
            await this.cache.set(cacheKey, data);
            success = true;
            break;
          }
        } catch (err) {
          clearTimeout(timeoutId);
          // try next mirror
        }
      }
    }

    if (sectorKey) {
      this.activeFetches.delete(sectorKey);
      this.queuedSectors.delete(sectorKey);

      if (success) {
        this.fetchedSectors.add(sectorKey);
        this.failedSectors.delete(sectorKey);
      } else {
        // Retry after 12s cooldown if network failed
        this.failedSectors.set(sectorKey, Date.now() + 12000);
      }
    }

    if (success && this.onFeaturesLoaded) {
      this.onFeaturesLoaded();
    }

    return { success, fromCache };
  }

  isDesertRegion() {
    const lat = this.anchorLat;
    const lon = this.anchorLon;
    // Egypt (Cairo, Giza, Luxor), Arabian Peninsula (Dubai, Riyadh), Sahara
    const isEgypt = (lat >= 21 && lat <= 33 && lon >= 24 && lon <= 36);
    const isArabia = (lat >= 12 && lat <= 33 && lon >= 36 && lon <= 60);
    return isEgypt || isArabia;
  }

  /**
   * Process raw Overpass data with geom arrays (both ways & relation multipolygons & POI nodes)
   */
  processOsmData(osmData) {
    if (!osmData || !osmData.elements) return;

    for (const elem of osmData.elements) {
      const tags = elem.tags || {};

      // 1. Process Standalone Point of Interest (POI) nodes
      if (elem.type === 'node') {
        const isSubway = tags.railway === 'subway_entrance' ||
                         tags.station === 'subway' ||
                         tags.subway === 'yes' ||
                         (tags.railway === 'station' && tags.station === 'subway');
        const isRailway = tags.railway === 'station';

        if (tags.amenity || tags.shop || tags.tourism || tags.historic || tags.cuisine || isSubway || isRailway) {
          const mx = (elem.lon - this.anchorLon) * (111320 * Math.cos(this.anchorLat * Math.PI / 180));
          const mz = -(elem.lat - this.anchorLat) * 110540;

          // Register station center for entrance lookup
          if (tags.station === 'subway' || (tags.railway === 'station' && (tags.subway === 'yes' || tags.station === 'subway'))) {
            const sName = tags['name:ru'] || tags.name || tags['name:en'] || null;
            if (sName) {
              this.subwayStations.push({
                name: sName,
                line: tags.line || tags.network || tags.operator || null,
                x: mx,
                z: mz
              });
            }
          }

          let category = tags.amenity || tags.shop || tags.tourism || tags.historic;
          if (isSubway) category = 'subway';
          else if (isRailway) category = 'railway';

          const stationTag = tags.station || tags['station:name'] || tags['subway:name'] || null;
          let name = tags['name:ru'] || tags.name || tags['name:en'] || stationTag || tags.brand;
          if (!name) {
            if (tags.railway === 'subway_entrance') {
              name = tags.ref ? `Вход в метро (Выход №${tags.ref})` : 'Вход в метро';
            } else {
              name = this.getPoiCategoryName(tags);
            }
          }

          const poi = {
            id: elem.id,
            name: name,
            stationName: stationTag,
            ref: tags.ref || null,
            brand: tags.brand || tags.network || tags.operator || tags.line || null,
            category: category,
            isSubway: isSubway,
            cuisine: tags.cuisine || null,
            openingHours: tags.opening_hours || null,
            icon: this.getPoiIcon(tags),
            type: 'poi',
            x: mx,
            z: mz,
            bounds: [mx - 6, mz - 6, mx + 6, mz + 6]
          };

          this.addFeatureToSpatialBuckets(poi);
          this.features.push(poi);
        }

        // 1.1 Process Standalone Trees (natural=tree)
        if (tags.natural === 'tree') {
          const mx = (elem.lon - this.anchorLon) * (111320 * Math.cos(this.anchorLat * Math.PI / 180));
          const mz = -(elem.lat - this.anchorLat) * 110540;

          const parsedH = parseFloat(tags.height);
          const heightMeters = (!isNaN(parsedH) && parsedH > 2 && parsedH < 35) ? parsedH : 6;
          const species = tags['species:ru'] || tags.species || tags.genus || tags['name:ru'] || tags.name || 'Дерево';
          const isConifer = tags.leaf_type === 'needleleaved' ||
                            species.toLowerCase().includes('picea') ||
                            species.toLowerCase().includes('ель') ||
                            species.toLowerCase().includes('сосна');

          const treeFeat = {
            id: elem.id,
            type: 'tree',
            x: mx,
            z: mz,
            height: heightMeters,
            species: species,
            leafType: isConifer ? 'needleleaved' : 'broadleaved',
            bounds: [mx - 4, mz - 4, mx + 4, mz + 4]
          };

          this.addFeatureToSpatialBuckets(treeFeat);
          this.features.push(treeFeat);
        }
        continue;
      }

      // Gather outer geometry rings for both ways and relation multipolygons
      const geometryList = [];
      if (elem.type === 'way' && elem.geometry && elem.geometry.length >= 2) {
        geometryList.push(elem.geometry);
      } else if (elem.type === 'relation' && elem.members) {
        for (const m of elem.members) {
          if (m.role === 'outer' && m.geometry && m.geometry.length >= 2) {
            geometryList.push(m.geometry);
          }
        }
      }

      if (geometryList.length === 0) continue;

      for (const geom of geometryList) {
        const pts = [];
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;

        for (const pt of geom) {
          const mx = (pt.lon - this.anchorLon) * (111320 * Math.cos(this.anchorLat * Math.PI / 180));
          const mz = -(pt.lat - this.anchorLat) * 110540;
          pts.push([mx, mz]);
          if (mx < minX) minX = mx;
          if (mx > maxX) maxX = mx;
          if (mz < minZ) minZ = mz;
          if (mz > maxZ) maxZ = mz;
        }

        // Deduplicate closing point
        if (pts.length > 3 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) {
          pts.pop();
        }

        if (tags.building || tags['building:part']) {
          // Real Height in meters
          let heightMeters = 14;
          let levels = 3;
          if (tags.height) {
            const parsed = parseFloat(tags.height);
            if (!isNaN(parsed) && parsed > 0) heightMeters = parsed;
          }
          if (tags['building:levels']) {
            const parsedL = parseFloat(tags['building:levels']);
            if (!isNaN(parsedL) && parsedL > 0) {
              levels = Math.round(parsedL);
              if (!tags.height) heightMeters = levels * 3.6;
            }
          } else {
            levels = Math.max(1, Math.round(heightMeters / 3.6));
          }

          // Parse Address
          const street = tags['addr:street'] || tags['addr:street:ru'] || tags['addr:street:en'] || null;
          const houseNumber = tags['addr:housenumber'] || null;
          const city = tags['addr:city'] || null;
          let fullAddress = null;
          if (street && houseNumber) fullAddress = `${street}, ${houseNumber}`;
          else if (street) fullAddress = street;
          else if (houseNumber) fullAddress = `д. ${houseNumber}`;

          // Pyramid check: tag historic=pyramid, roof:shape=pyramid, building:shape=pyramid, or name containing "пирамида" / "pyramid"
          const nameLower = (tags['name:ru'] || tags.name || tags['name:en'] || '').toLowerCase();
          const isPyramid = tags.historic === 'pyramid' ||
                            tags.man_made === 'pyramid' ||
                            tags['building:shape'] === 'pyramid' ||
                            tags['roof:shape'] === 'pyramid' ||
                            tags.ruins === 'pyramid' ||
                            nameLower.includes('пирамида') ||
                            nameLower.includes('pyramid') ||
                            nameLower.includes('хеопс') ||
                            nameLower.includes('хефрен') ||
                            nameLower.includes('микерин') ||
                            nameLower.includes('cheops') ||
                            nameLower.includes('khufu');

          // Material Palette based on real OSM tags
          let blockType = BlockType.BUILDING_CONCRETE;
          const mat = (tags['building:material'] || '').toLowerCase();
          if (isPyramid) {
            blockType = BlockType.SAND; // Ancient limestone / sandstone
          } else if (mat.includes('brick') || tags.building === 'house') {
            blockType = BlockType.BUILDING_BRICK;
          } else if (mat.includes('glass') || (heightMeters > 38 && !this.isDesertRegion())) {
            blockType = BlockType.BUILDING_GLASS;
          } else if (mat.includes('stone') || this.isDesertRegion()) {
            blockType = BlockType.SAND;
          }

          const feature = {
            id: elem.id,
            name: tags['name:ru'] || tags.name || tags['name:en'] || null,
            address: fullAddress,
            city: city,
            levels: isPyramid ? 1 : levels,
            height: Math.round(heightMeters),
            buildingType: isPyramid ? 'Древняя пирамида' : (tags.building !== 'yes' ? tags.building : (tags.amenity || tags.shop || tags.office || 'здание')),
            amenity: tags.amenity || tags.shop || tags.tourism || null,
            type: 'building',
            isPyramid: isPyramid,
            points: pts,
            blockType: blockType,
            bounds: [minX, minZ, maxX, maxZ]
          };

          this.addFeatureToSpatialBuckets(feature);
          this.features.push(feature);

        } else if (tags.highway) {
          let width = 4;
          if (tags.highway === 'primary' || tags.highway === 'motorway' || tags.highway === 'trunk') width = 8;
          else if (tags.highway === 'secondary' || tags.highway === 'tertiary') width = 6;
          else if (tags.highway === 'pedestrian' || tags.highway === 'footway' || tags.highway === 'path') width = 3;

          const feature = {
            id: elem.id,
            name: tags['name:ru'] || tags.name || tags['name:en'] || null,
            type: 'road',
            points: pts,
            width: width,
            bounds: [minX, minZ, maxX, maxZ]
          };

          this.addFeatureToSpatialBuckets(feature);
          this.features.push(feature);

        } else if (tags.waterway || tags.natural === 'water') {
          const feature = {
            id: elem.id,
            type: 'water',
            points: pts,
            bounds: [minX, minZ, maxX, maxZ]
          };
          this.addFeatureToSpatialBuckets(feature);
          this.features.push(feature);

        } else if (tags.natural === 'tree_row') {
          for (let i = 0; i < pts.length - 1; i++) {
            const p1 = pts[i];
            const p2 = pts[i + 1];
            const segDist = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
            const steps = Math.max(1, Math.round(segDist / 9));
            for (let s = 0; s <= steps; s++) {
              const t = s / steps;
              const tx = p1[0] + (p2[0] - p1[0]) * t;
              const tz = p1[1] + (p2[1] - p1[1]) * t;
              const treeFeat = {
                id: `${elem.id}_row_${i}_${s}`,
                type: 'tree',
                x: tx,
                z: tz,
                height: 7,
                species: tags['species:ru'] || tags.species || 'Аллея деревьев',
                leafType: tags.leaf_type || 'broadleaved',
                bounds: [tx - 4, tz - 4, tx + 4, tz + 4]
              };
              this.addFeatureToSpatialBuckets(treeFeat);
              this.features.push(treeFeat);
            }
          }

        } else if (tags.leisure === 'park' || tags.leisure === 'garden' || tags.landuse === 'grass' || tags.natural === 'wood' || tags.landuse === 'forest') {
          const isForest = (tags.natural === 'wood' || tags.landuse === 'forest');
          const feature = {
            id: elem.id,
            type: isForest ? 'forest' : 'park',
            points: pts,
            bounds: [minX, minZ, maxX, maxZ]
          };
          this.addFeatureToSpatialBuckets(feature);
          this.features.push(feature);

        } else if (tags.amenity === 'parking') {
          const feature = {
            id: elem.id,
            type: 'parking',
            points: pts,
            bounds: [minX, minZ, maxX, maxZ]
          };
          this.addFeatureToSpatialBuckets(feature);
          this.features.push(feature);
        }
      }
    }
  }

  /**
   * Spatial Bucket indexing (buckets of 128m)
   */
  addFeatureToSpatialBuckets(feature) {
    const BUCKET_SIZE = 128;
    const [minX, minZ, maxX, maxZ] = feature.bounds;

    const bMinX = Math.floor(minX / BUCKET_SIZE);
    const bMaxX = Math.floor(maxX / BUCKET_SIZE);
    const bMinZ = Math.floor(minZ / BUCKET_SIZE);
    const bMaxZ = Math.floor(maxZ / BUCKET_SIZE);

    for (let bx = bMinX; bx <= bMaxX; bx++) {
      for (let bz = bMinZ; bz <= bMaxZ; bz++) {
        const key = `${bx},${bz}`;
        let bucket = this.spatialBuckets.get(key);
        if (!bucket) {
          bucket = [];
          this.spatialBuckets.set(key, bucket);
        }
        bucket.push(feature);
      }
    }
  }

  getFeaturesInBounds(minX, minZ, maxX, maxZ) {
    const BUCKET_SIZE = 128;
    const bMinX = Math.floor(minX / BUCKET_SIZE);
    const bMaxX = Math.floor(maxX / BUCKET_SIZE);
    const bMinZ = Math.floor(minZ / BUCKET_SIZE);
    const bMaxZ = Math.floor(maxZ / BUCKET_SIZE);

    const candidates = new Set();

    for (let bx = bMinX; bx <= bMaxX; bx++) {
      for (let bz = bMinZ; bz <= bMaxZ; bz++) {
        const bucket = this.spatialBuckets.get(`${bx},${bz}`);
        if (bucket) {
          for (const feat of bucket) {
            candidates.add(feat);
          }
        }
      }
    }

    return Array.from(candidates);
  }

  isPointInLoadedSector(worldX, worldZ) {
    const SECTOR_SIZE = 600;
    const sx = Math.floor(worldX / SECTOR_SIZE);
    const sz = Math.floor(worldZ / SECTOR_SIZE);
    return this.fetchedSectors.has(`${sx},${sz}`);
  }

  /**
   * Populates a voxel chunk using spatial OSM features
   */
  populateChunk(chunkX, chunkZ, voxels, groundY = 20) {
    const startX = chunkX * CHUNK_SIZE_X * VOXEL_SIZE;
    const endX = startX + CHUNK_SIZE_X * VOXEL_SIZE;
    const startZ = chunkZ * CHUNK_SIZE_Z * VOXEL_SIZE;
    const endZ = startZ + CHUNK_SIZE_Z * VOXEL_SIZE;

    const midX = (startX + endX) / 2;
    const midZ = (startZ + endZ) / 2;
    const isSectorActive = this.isPointInLoadedSector(midX, midZ);

    const nearbyFeatures = this.getFeaturesInBounds(startX, startZ, endX, endZ);
    if (!isSectorActive && nearbyFeatures.length === 0) return false;

    let hasFeatures = false;

    const setBlock = (x, y, z, type) => {
      if (x < 0 || x >= CHUNK_SIZE_X || y < 0 || y >= CHUNK_SIZE_Y || z < 0 || z >= CHUNK_SIZE_Z) return;
      const idx = (y * CHUNK_SIZE_Z + z) * CHUNK_SIZE_X + x;
      voxels[idx] = type;
    };

    const getBlock = (x, y, z) => {
      if (x < 0 || x >= CHUNK_SIZE_X || y < 0 || y >= CHUNK_SIZE_Y || z < 0 || z >= CHUNK_SIZE_Z) return BlockType.AIR;
      const idx = (y * CHUNK_SIZE_Z + z) * CHUNK_SIZE_X + x;
      return voxels[idx];
    };

    // 1. Fill ground base: Desert sand in Egypt/Arabia, urban sidewalk in cities
    const groundBlock = this.isDesertRegion() ? BlockType.SAND : BlockType.SIDEWALK;
    const subGroundBlock = this.isDesertRegion() ? BlockType.SAND : BlockType.DIRT;

    for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
      for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
        for (let y = 0; y <= groundY; y++) {
          setBlock(lx, y, lz, y === groundY ? groundBlock : (y > groundY - 3 ? subGroundBlock : BlockType.STONE));
        }
      }
    }

    // 2. Rasterize Roads, Parks, Parking & Water
    for (const feat of nearbyFeatures) {
      if (feat.type === 'road') {
        for (let i = 0; i < feat.points.length - 1; i++) {
          const p1 = feat.points[i];
          const p2 = feat.points[i + 1];

          // Check line segment bounding box
          const minPX = Math.min(p1[0], p2[0]) - feat.width;
          const maxPX = Math.max(p1[0], p2[0]) + feat.width;
          const minPZ = Math.min(p1[1], p2[1]) - feat.width;
          const maxPZ = Math.max(p1[1], p2[1]) + feat.width;

          if (maxPX < startX || minPX > endX || maxPZ < startZ || minPZ > endZ) continue;

          hasFeatures = true;
          const dist = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
          const steps = Math.max(1, Math.ceil(dist / 2));

          for (let s = 0; s <= steps; s++) {
            const t = s / steps;
            const rx = p1[0] + (p2[0] - p1[0]) * t;
            const rz = p1[1] + (p2[1] - p1[1]) * t;

            const lcx = Math.floor((rx - startX) / VOXEL_SIZE);
            const lcz = Math.floor((rz - startZ) / VOXEL_SIZE);
            const radiusVoxels = Math.ceil(feat.width / (2 * VOXEL_SIZE));

            for (let ox = -radiusVoxels; ox <= radiusVoxels; ox++) {
              for (let oz = -radiusVoxels; oz <= radiusVoxels; oz++) {
                const vx = lcx + ox;
                const vz = lcz + oz;
                if (vx >= 0 && vx < CHUNK_SIZE_X && vz >= 0 && vz < CHUNK_SIZE_Z) {
                  setBlock(vx, groundY, vz, BlockType.ROAD);
                }
              }
            }
          }
        }
      } else if (feat.type === 'park' || feat.type === 'forest') {
        const isForest = (feat.type === 'forest');
        for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
          const worldVX = startX + (lx + 0.5) * VOXEL_SIZE;
          for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
            const worldVZ = startZ + (lz + 0.5) * VOXEL_SIZE;
            if (this.pointInPolygon(worldVX, worldVZ, feat.points)) {
              hasFeatures = true;
              setBlock(lx, groundY, lz, BlockType.GRASS);

              // Inside dense forests, populate natural tree stands
              if (isForest) {
                const spacing = 8;
                const cellX = Math.floor(worldVX / spacing);
                const cellZ = Math.floor(worldVZ / spacing);
                const hash = Math.sin(cellX * 12.9898 + cellZ * 78.233) * 43758.5453;
                const rand = Math.abs(hash - Math.floor(hash));

                if (rand > 0.4 && (Math.abs(Math.floor(worldVX)) % spacing === 0) && (Math.abs(Math.floor(worldVZ)) % spacing === 0)) {
                  const trunkH = 3 + Math.floor(rand * 3);
                  for (let ty = groundY + 1; ty <= groundY + trunkH; ty++) {
                    setBlock(lx, ty, lz, BlockType.TREE_TRUNK);
                  }
                  const cY = groundY + trunkH;
                  for (let dy = -1; dy <= 2; dy++) {
                    const r = (dy === -1 || dy === 2) ? 1 : 2;
                    for (let ox = -r; ox <= r; ox++) {
                      for (let oz = -r; oz <= r; oz++) {
                        if (r === 2 && Math.abs(ox) === 2 && Math.abs(oz) === 2) continue;
                        if (getBlock(lx + ox, cY + dy, lz + oz) === BlockType.AIR) {
                          setBlock(lx + ox, cY + dy, lz + oz, BlockType.TREE_LEAVES);
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      } else if (feat.type === 'parking') {
        for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
          const worldVX = startX + (lx + 0.5) * VOXEL_SIZE;
          for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
            const worldVZ = startZ + (lz + 0.5) * VOXEL_SIZE;
            if (this.pointInPolygon(worldVX, worldVZ, feat.points)) {
              hasFeatures = true;
              setBlock(lx, groundY, lz, BlockType.ROAD);
            }
          }
        }
      } else if (feat.type === 'water') {
        for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
          const worldVX = startX + (lx + 0.5) * VOXEL_SIZE;
          for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
            const worldVZ = startZ + (lz + 0.5) * VOXEL_SIZE;
            if (this.pointInPolygon(worldVX, worldVZ, feat.points)) {
              hasFeatures = true;
              for (let wy = groundY - 3; wy <= groundY; wy++) {
                setBlock(lx, wy, lz, BlockType.WATER);
              }
            }
          }
        }
      }
    }

    // 3. Rasterize Real Buildings
    for (const feat of nearbyFeatures) {
      if (feat.type !== 'building') continue;

      const [minBX, minBZ, maxBX, maxBZ] = feat.bounds;
      if (maxBX < startX || minBX > endX || maxBZ < startZ || minBZ > endZ) continue;

      hasFeatures = true;
      const bHeightVoxels = Math.min(CHUNK_SIZE_Y - groundY - 2, Math.max(3, Math.floor(feat.height / VOXEL_SIZE)));
      const bCenterX = (minBX + maxBX) / 2;
      const bCenterZ = (minBZ + maxBZ) / 2;
      const isSmall = (maxBX - minBX < 6 || maxBZ - minBZ < 6);

      // 3.1 Special Architecture: Ancient Stepped/Sloping Pyramids
      if (feat.isPyramid) {
        const halfWidth = (maxBX - minBX) / 2;
        const halfDepth = (maxBZ - minBZ) / 2;

        for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
          const worldVX = startX + (lx + 0.5) * VOXEL_SIZE;
          if (worldVX < minBX - VOXEL_SIZE || worldVX > maxBX + VOXEL_SIZE) continue;

          for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
            const worldVZ = startZ + (lz + 0.5) * VOXEL_SIZE;
            if (worldVZ < minBZ - VOXEL_SIZE || worldVZ > maxBZ + VOXEL_SIZE) continue;

            const dx = Math.abs(worldVX - bCenterX);
            const dz = Math.abs(worldVZ - bCenterZ);

            for (let by = groundY; by <= groundY + bHeightVoxels; by++) {
              const t = (by - groundY) / bHeightVoxels; // 0.0 at base -> 1.0 at peak
              const curLimitX = Math.max(1.0, halfWidth * (1.0 - t));
              const curLimitZ = Math.max(1.0, halfDepth * (1.0 - t));

              if (dx <= curLimitX && dz <= curLimitZ) {
                const isApex = (by >= groundY + bHeightVoxels - 2);
                if (isApex) {
                  // Golden pyramidion capstone at apex
                  setBlock(lx, by, lz, BlockType.GOLD);
                } else {
                  // Ancient weathered sandstone / limestone
                  setBlock(lx, by, lz, BlockType.SAND);
                }
              }
            }
          }
        }
        continue;
      }

      for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
        const worldVX = startX + (lx + 0.5) * VOXEL_SIZE;
        if (worldVX < minBX - VOXEL_SIZE || worldVX > maxBX + VOXEL_SIZE) continue;

        for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
          const worldVZ = startZ + (lz + 0.5) * VOXEL_SIZE;
          if (worldVZ < minBZ - VOXEL_SIZE || worldVZ > maxBZ + VOXEL_SIZE) continue;

          // Check polygon or small building center fallback
          const isInside = this.pointInPolygon(worldVX, worldVZ, feat.points) ||
            (isSmall && Math.abs(worldVX - bCenterX) <= VOXEL_SIZE && Math.abs(worldVZ - bCenterZ) <= VOXEL_SIZE);

          if (isInside) {
            const isPerimeter = isSmall ? true : this.isPerimeterVoxel(worldVX, worldVZ, feat.points, VOXEL_SIZE);

            for (let by = groundY; by <= groundY + bHeightVoxels; by++) {
              if (by === groundY + bHeightVoxels) {
                setBlock(lx, by, lz, BlockType.BUILDING_ROOF);
              } else if (isPerimeter) {
                // Windows layout on real facade
                const isWindowHeight = ((by - groundY) % 2 === 1);
                const isWindowCol = ((lx + lz) % 2 === 0);

                if (isWindowHeight && isWindowCol && (by > groundY + 1)) {
                  // Glowing window at night
                  const isLit = (Math.sin(worldVX * 7.1 + worldVZ * 11.3 + by * 13.7) > 0.0);
                  setBlock(lx, by, lz, isLit ? BlockType.WINDOW_LIT : BlockType.WINDOW_DARK);
                } else {
                  setBlock(lx, by, lz, feat.blockType);
                }
              } else {
                setBlock(lx, by, lz, feat.blockType);
              }
            }
          }
        }
      }
    }

    // 4. Rasterize Standalone POIs (Monuments, Statues, Fountains, Food Kiosks)
    for (const feat of nearbyFeatures) {
      if (feat.type !== 'poi') continue;

      const lx = Math.floor((feat.x - startX) / VOXEL_SIZE);
      const lz = Math.floor((feat.z - startZ) / VOXEL_SIZE);

      // Check if POI is inside or near chunk bounds
      if (lx < -1 || lx > CHUNK_SIZE_X || lz < -1 || lz > CHUNK_SIZE_Z) continue;

      hasFeatures = true;
      const cat = (feat.category || '').toLowerCase();
      const name = (feat.name || '').toLowerCase();

      // A. Monument, Statue, Memorial, Obelisk
      if (cat.includes('monument') || cat.includes('memorial') || cat.includes('statue') || cat.includes('artwork') || name.includes('памятник') || name.includes('монумент') || name.includes('обелиск')) {
        // Step 1: Broad Stone Pedestal Base (3x3 blocks at ground level + 1)
        for (let ox = -1; ox <= 1; ox++) {
          for (let oz = -1; oz <= 1; oz++) {
            setBlock(lx + ox, groundY + 1, lz + oz, BlockType.STONE);
          }
        }
        // Step 2: Concrete Pedestal Core
        setBlock(lx, groundY + 2, lz, BlockType.BUILDING_CONCRETE);

        // Step 3: Patinated Bronze Column & Statue Figure (up to +5 voxels)
        for (let y = groundY + 3; y <= groundY + 5; y++) {
          setBlock(lx, y, lz, BlockType.MONUMENT_BRONZE);
        }
        // Sculpture details (arms / wings / cross)
        setBlock(lx - 1, groundY + 4, lz, BlockType.MONUMENT_BRONZE);
        setBlock(lx + 1, groundY + 4, lz, BlockType.MONUMENT_BRONZE);

        // Step 4: Golden Crown / Peak / Head
        setBlock(lx, groundY + 6, lz, BlockType.GOLD);

      } else if (cat.includes('fountain')) {
        // B. Fountain (3x3 Stone basin with water in middle)
        for (let ox = -1; ox <= 1; ox++) {
          for (let oz = -1; oz <= 1; oz++) {
            const isEdge = (Math.abs(ox) === 1 || Math.abs(oz) === 1);
            setBlock(lx + ox, groundY + 1, lz + oz, isEdge ? BlockType.STONE : BlockType.WATER);
          }
        }
        setBlock(lx, groundY + 2, lz, BlockType.WATER);

      } else if (cat.includes('kiosk') || cat.includes('fast_food')) {
        // C. Street Food Booth / Kiosk (2x2 with roof)
        for (let ox = 0; ox <= 1; ox++) {
          for (let oz = 0; oz <= 1; oz++) {
            setBlock(lx + ox, groundY + 1, lz + oz, BlockType.BUILDING_BRICK);
            setBlock(lx + ox, groundY + 2, lz + oz, BlockType.WINDOW_LIT);
            setBlock(lx + ox, groundY + 3, lz + oz, BlockType.BUILDING_ROOF);
          }
        }
      } else if (cat.includes('subway') || name.includes('метро') || feat.isSubway) {
        // D. Subway Station Entrance Pavilion (3x3 with canopy and descent stairs)
        for (let ox = -1; ox <= 1; ox++) {
          for (let oz = -1; oz <= 1; oz++) {
            const isRim = (Math.abs(ox) === 1 || oz === -1);
            if (isRim) {
              setBlock(lx + ox, groundY + 1, lz + oz, BlockType.METAL);
            } else {
              // Cutout stairwell descent into ground
              setBlock(lx + ox, groundY, lz + oz, BlockType.AIR);
              setBlock(lx + ox, groundY - 1, lz + oz, BlockType.STONE);
            }
            // Glass canopy overhead
            setBlock(lx + ox, groundY + 3, lz + oz, BlockType.BUILDING_GLASS);
          }
        }
        // Glowing metro entrance sign
        setBlock(lx, groundY + 2, lz + 1, BlockType.WINDOW_LIT);
      }
    }

    // 5. Rasterize Real Trees from OSM (natural=tree and natural=tree_row)
    for (const feat of nearbyFeatures) {
      if (feat.type !== 'tree') continue;

      const lx = Math.floor((feat.x - startX) / VOXEL_SIZE);
      const lz = Math.floor((feat.z - startZ) / VOXEL_SIZE);

      if (lx < -1 || lx > CHUNK_SIZE_X || lz < -1 || lz > CHUNK_SIZE_Z) continue;

      // Don't plant tree on roads or in water
      const currentGround = getBlock(lx, groundY, lz);
      if (currentGround === BlockType.ROAD || currentGround === BlockType.WATER) continue;

      hasFeatures = true;
      const trunkHeight = Math.max(2, Math.min(6, Math.floor(feat.height / VOXEL_SIZE)));
      const canopyY = groundY + trunkHeight;

      // 5.1 Wood Trunk
      for (let ty = groundY + 1; ty <= canopyY; ty++) {
        setBlock(lx, ty, lz, BlockType.TREE_TRUNK);
      }

      // 5.2 Tree Canopy Foliage
      const isConifer = (feat.leafType === 'needleleaved');

      if (isConifer) {
        // Conical tree shape (ель, сосна)
        for (let dy = 0; dy <= 3; dy++) {
          const r = (dy === 0) ? 2 : (dy === 1 ? 1 : 0);
          for (let ox = -r; ox <= r; ox++) {
            for (let oz = -r; oz <= r; oz++) {
              if (r === 2 && Math.abs(ox) === 2 && Math.abs(oz) === 2) continue;
              if (getBlock(lx + ox, canopyY + dy, lz + oz) === BlockType.AIR) {
                setBlock(lx + ox, canopyY + dy, lz + oz, BlockType.TREE_LEAVES);
              }
            }
          }
        }
      } else {
        // Fluffy rounded canopy (липа, дуб, клен, береза)
        for (let dy = -1; dy <= 2; dy++) {
          const r = (dy === -1 || dy === 2) ? 1 : 2;
          for (let ox = -r; ox <= r; ox++) {
            for (let oz = -r; oz <= r; oz++) {
              if (r === 2 && Math.abs(ox) === 2 && Math.abs(oz) === 2 && dy !== 0) continue;
              if (getBlock(lx + ox, canopyY + dy, lz + oz) === BlockType.AIR) {
                setBlock(lx + ox, canopyY + dy, lz + oz, BlockType.TREE_LEAVES);
              }
            }
          }
        }
      }
    }

    return isSectorActive || hasFeatures;
  }

  pointInPolygon(x, z, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], zi = poly[i][1];
      const xj = poly[j][0], zj = poly[j][1];
      const intersect = ((zi > z) !== (zj > z)) &&
        (x < (xj - xi) * (z - zi) / (zj - zi + 0.0000001) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  isPerimeterVoxel(x, z, poly, margin) {
    const offsets = [[margin, 0], [-margin, 0], [0, margin], [0, -margin]];
    for (const [ox, oz] of offsets) {
      if (!this.pointInPolygon(x + ox, z + oz, poly)) return true;
    }
    return false;
  }

  getPoiIcon(tags) {
    if (tags.railway === 'subway_entrance' || tags.station === 'subway' || tags.subway === 'yes') return '🚇';
    if (tags.railway === 'station') return '🚆';
    if (tags.amenity === 'fast_food') return '🍔';
    if (tags.amenity === 'cafe') return '☕';
    if (tags.amenity === 'restaurant') return '🍽️';
    if (tags.amenity === 'bar' || tags.amenity === 'pub') return '🍺';
    if (tags.shop === 'supermarket' || tags.shop === 'convenience' || tags.shop === 'grocery') return '🛒';
    if (tags.shop) return '🛍️';
    if (tags.historic === 'monument' || tags.historic === 'memorial') return '🗿';
    if (tags.tourism === 'attraction' || tags.tourism === 'museum') return '🏛️';
    if (tags.tourism === 'hotel') return '🏨';
    if (tags.tourism === 'viewpoint') return '🔭';
    if (tags.amenity === 'pharmacy') return '💊';
    if (tags.amenity === 'bank' || tags.amenity === 'atm') return '🏦';
    if (tags.amenity === 'cinema' || tags.amenity === 'theatre') return '🎭';
    if (tags.amenity === 'fuel') return '⛽';
    if (tags.amenity === 'hospital' || tags.amenity === 'clinic') return '🏥';
    return '📍';
  }

  getPoiCategoryName(tags) {
    if (tags.railway === 'subway_entrance') return tags.ref ? `Выход в метро №${tags.ref}` : 'Вход в метро';
    if (tags.station === 'subway' || tags.subway === 'yes') return 'Станция метро';
    if (tags.railway === 'station') return 'Ж/Д Вокзал / Станция';
    if (tags.amenity === 'fast_food') return tags.cuisine ? `Фастфуд (${tags.cuisine})` : 'Фастфуд';
    if (tags.amenity === 'cafe') return 'Кофейня';
    if (tags.amenity === 'restaurant') return 'Ресторан';
    if (tags.amenity === 'bar') return 'Бар';
    if (tags.shop === 'supermarket') return 'Супермаркет';
    if (tags.shop) return `Магазин (${tags.shop})`;
    if (tags.historic === 'monument') return 'Памятник';
    if (tags.historic === 'memorial') return 'Мемориал';
    if (tags.tourism === 'museum') return 'Музей';
    if (tags.tourism === 'attraction') return 'Достопримечательность';
    if (tags.tourism === 'hotel') return 'Отель';
    if (tags.amenity === 'pharmacy') return 'Аптека';
    if (tags.amenity === 'bank') return 'Банк';
    if (tags.amenity === 'cinema') return 'Кинотеатр';
    return tags.amenity || tags.shop || tags.tourism || 'Заведение';
  }

  findNearestSubwayStation(worldX, worldZ, maxDist = 450) {
    let nearest = null;
    let minDist = Infinity;
    for (const st of this.subwayStations) {
      const d = Math.hypot(worldX - st.x, worldZ - st.z);
      if (d < minDist && d < maxDist) {
        minDist = d;
        nearest = st;
      }
    }
    return nearest;
  }

  getSectorInfo(worldX, worldZ) {
    const SECTOR_SIZE = 600;
    const sx = Math.floor(worldX / SECTOR_SIZE);
    const sz = Math.floor(worldZ / SECTOR_SIZE);
    const key = `${sx},${sz}`;

    const centerX = (sx + 0.5) * SECTOR_SIZE;
    const centerZ = (sz + 0.5) * SECTOR_SIZE;
    const latOffset = -centerZ / 110540;
    const lonOffset = centerX / (111320 * Math.cos(this.anchorLat * Math.PI / 180));
    const targetLat = this.anchorLat + latOffset;
    const targetLon = this.anchorLon + lonOffset;

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

  /**
   * Find building/road/POI feature at world coordinates (worldX, worldZ)
   */
  getFeatureAtPoint(worldX, worldZ) {
    const margin = 12.0;
    const candidates = this.getFeaturesInBounds(worldX - margin, worldZ - margin, worldX + margin, worldZ + margin);

    // 1. Look for building containing or closest to this point
    let targetBuilding = null;
    let minBuildingDist = Infinity;

    for (const feat of candidates) {
      if (feat.type === 'building') {
        if (this.pointInPolygon(worldX, worldZ, feat.points)) {
          targetBuilding = feat;
          minBuildingDist = 0;
          break;
        }
        const cx = (feat.bounds[0] + feat.bounds[2]) / 2;
        const cz = (feat.bounds[1] + feat.bounds[3]) / 2;
        const dist = Math.hypot(worldX - cx, worldZ - cz);
        if (dist < minBuildingDist && dist < 26) {
          minBuildingDist = dist;
          targetBuilding = feat;
        }
      }
    }

    // 2. Find nearest named road if building has no explicit address
    let nearestStreetName = null;
    let minRoadDist = Infinity;

    for (const feat of candidates) {
      if (feat.type === 'road' && feat.name) {
        for (const pt of feat.points) {
          const d = Math.hypot(worldX - pt[0], worldZ - pt[1]);
          if (d < minRoadDist) {
            minRoadDist = d;
            nearestStreetName = feat.name;
          }
        }
      }
    }

    // 3. Find POIs inside or near this building / point
    const nearbyPois = [];
    for (const feat of candidates) {
      if (feat.type === 'poi') {
        const dist = Math.hypot(worldX - feat.x, worldZ - feat.z);
        if (dist < 32) {
          let poiTitle = feat.name;

          // Resolve Metro station name for subway entrances
          if (feat.isSubway) {
            let stName = feat.stationName;
            if (!stName) {
              const nearestSt = this.findNearestSubwayStation(feat.x, feat.z);
              if (nearestSt) stName = nearestSt.name;
            }
            if (stName) {
              poiTitle = `${stName} (${feat.ref ? `Выход №${feat.ref}` : 'Вход'})`;
            }
          }

          nearbyPois.push({
            name: poiTitle,
            brand: feat.brand,
            category: feat.category,
            cuisine: feat.cuisine,
            openingHours: feat.openingHours,
            icon: feat.icon,
            isSubway: feat.isSubway,
            ref: feat.ref,
            x: feat.x,
            z: feat.z
          });
        }
      }
    }

    // If no building, check if aiming at a standalone monument, outdoor venue, or subway entrance
    if (!targetBuilding) {
      if (nearbyPois.length > 0) {
        const p = nearbyPois[0];

        // Specific handling for Subway Entrances
        if (p.isSubway || p.category === 'subway' || (p.name && p.name.toLowerCase().includes('метро'))) {
          let stationName = p.stationName;
          let line = p.brand;
          if (!stationName) {
            const nearestSt = this.findNearestSubwayStation(p.x, p.z);
            if (nearestSt) {
              stationName = nearestSt.name;
              if (!line) line = nearestSt.line;
            }
          }

          const exitText = p.ref ? `Выход №${p.ref}` : (p.name && p.name.includes('Выход') ? p.name : 'Вход в метро');
          const title = stationName ? `🚇 ${stationName}` : (p.name || '🚇 Станция метро');
          const subtitle = stationName ? `${exitText}${line ? ` • ${line}` : ''}` : (nearestStreetName ? `ок. ${nearestStreetName}` : 'Вход в метро');

          return {
            name: title,
            address: subtitle,
            city: null,
            levels: 1,
            height: 4,
            buildingType: 'Станция метро',
            amenity: 'subway',
            pois: nearbyPois
          };
        }

        return {
          name: `${p.icon} ${p.name}`,
          address: nearestStreetName ? `ок. ${nearestStreetName}` : (p.openingHours ? `Часы: ${p.openingHours}` : null),
          city: null,
          levels: 1,
          height: 4,
          buildingType: p.category,
          amenity: p.category,
          pois: nearbyPois
        };
      }

      // Check if aiming at a real tree from OSM
      let targetTree = null;
      let minTreeDist = Infinity;
      for (const feat of candidates) {
        if (feat.type === 'tree') {
          const d = Math.hypot(worldX - feat.x, worldZ - feat.z);
          if (d < minTreeDist && d < 6.0) {
            minTreeDist = d;
            targetTree = feat;
          }
        }
      }

      if (targetTree) {
        return {
          name: `🌳 ${targetTree.species}`,
          address: nearestStreetName ? `ок. ${nearestStreetName}` : `Высота: ${Math.round(targetTree.height)} м`,
          city: null,
          levels: 1,
          height: Math.round(targetTree.height),
          buildingType: 'Дерево / Зеленые насаждения',
          amenity: 'tree',
          pois: []
        };
      }

      // Check if aiming at an unloaded warning hazard sector
      if (!this.isPointInLoadedSector(worldX, worldZ)) {
        const info = this.getSectorInfo(worldX, worldZ);
        return {
          name: `⚠️ Сектор OSM [${info.sx}, ${info.sz}]`,
          address: `${info.status} • GPS: ${info.targetLat.toFixed(4)}°, ${info.targetLon.toFixed(4)}°`,
          city: null,
          levels: 0,
          height: 0,
          buildingType: 'Гео-ресурс Overpass (600×600 м)',
          amenity: 'warning',
          pois: []
        };
      }

      return null;
    }

    const primaryPoi = nearbyPois.length > 0 ? nearbyPois[0] : null;
    const title = targetBuilding.name || (primaryPoi ? `${primaryPoi.icon} ${primaryPoi.name}` : null) || (targetBuilding.amenity ? `${targetBuilding.amenity.toUpperCase()}` : null);

    return {
      name: title,
      address: targetBuilding.address || (nearestStreetName ? `ок. ${nearestStreetName}` : null),
      city: targetBuilding.city,
      levels: targetBuilding.levels,
      height: targetBuilding.height,
      buildingType: targetBuilding.buildingType,
      amenity: targetBuilding.amenity,
      pois: nearbyPois
    };
  }
}
