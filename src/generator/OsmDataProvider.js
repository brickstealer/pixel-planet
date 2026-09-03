import {
  CHUNK_SIZE_X,
  CHUNK_SIZE_Y,
  CHUNK_SIZE_Z,
  VOXEL_SIZE,
  BlockType
} from '../core/VoxelTypes.js';

export const FAMOUS_CITIES = [
  { name: 'Manhattan, New York', lat: 40.7484, lon: -73.9857, zoomDesc: 'Empire State & Midtown Skyscrapers', groundY: 20 },
  { name: 'Paris (Eiffel Tower)', lat: 48.8584, lon: 2.2945, zoomDesc: 'Champ de Mars & Haussmann Quarters', groundY: 20 },
  { name: 'Tokyo (Shibuya)', lat: 35.6595, lon: 139.7004, zoomDesc: 'Shibuya Crossing & Neon Towers', groundY: 20 },
  { name: 'Moscow (Red Square)', lat: 55.7539, lon: 37.6208, zoomDesc: 'Kremlin Towers & Historic Center', groundY: 20 },
  { name: 'London (Westminster)', lat: 51.5007, lon: -0.1246, zoomDesc: 'Big Ben, River Thames & Bridges', groundY: 20 },
  { name: 'Dubai (Burj Khalifa)', lat: 25.1972, lon: 55.2744, zoomDesc: 'Downtown Mega Skyscrapers', groundY: 18 },
  { name: 'Rome (Colosseum)', lat: 41.8902, lon: 12.4922, zoomDesc: 'Colosseum & Roman Forum Ruins', groundY: 20 },
  { name: 'San Francisco (Downtown)', lat: 37.7891, lon: -122.4014, zoomDesc: 'Financial District & Bay Coast', groundY: 22 },
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
    this.lastCheckPos = { x: 0, z: 0 };

    this.overpassMirrors = [
      'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
      'https://overpass.private.coffee/api/interpreter',
      'https://overpass-api.de/api/interpreter'
    ];
  }

  /**
   * Search city or landmark using Nominatim Geocoding
   */
  async searchLocation(query) {
    try {
      this.statusMessage = `Поиск "${query}"...`;
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5`;
      const res = await fetch(url, {
        headers: { 'Accept-Language': 'ru,en' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data || data.length === 0) {
        this.statusMessage = 'Место не найдено';
        return null;
      }
      return data.map(item => ({
        name: item.display_name,
        lat: parseFloat(item.lat),
        lon: parseFloat(item.lon)
      }));
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
    this.fetchedSectors.clear();
    this.activeFetches.clear();

    this.isLoading = true;
    this.statusMessage = `Загрузка OSM для [${lat.toFixed(3)}, ${lon.toFixed(3)}]...`;

    // Fetch central sector (0, 0) and immediate neighbors
    await this.fetchSectorByWorld(0, 0, initialRadius);
    this.isLoading = false;
  }

  /**
   * Continually checks and streams OSM sectors as player flies (debounced every 100m)
   */
  checkStreaming(playerWorldX, playerWorldZ) {
    const distSinceCheck = Math.hypot(playerWorldX - this.lastCheckPos.x, playerWorldZ - this.lastCheckPos.z);
    if (distSinceCheck < 100 && this.fetchedSectors.size > 0) return;
    this.lastCheckPos = { x: playerWorldX, z: playerWorldZ };

    const SECTOR_SIZE = 600;
    const currentSectorX = Math.floor(playerWorldX / SECTOR_SIZE);
    const currentSectorZ = Math.floor(playerWorldZ / SECTOR_SIZE);

    // Prioritize current sector, then immediate neighbors
    const sectors = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const sx = currentSectorX + dx;
        const sz = currentSectorZ + dz;
        const key = `${sx},${sz}`;
        const dist = Math.hypot(dx, dz);
        sectors.push({ sx, sz, key, dist });
      }
    }
    sectors.sort((a, b) => a.dist - b.dist);

    for (const s of sectors) {
      if (!this.fetchedSectors.has(s.key) && !this.queuedSectors.has(s.key)) {
        this.queuedSectors.add(s.key);
        const centerX = (s.sx + 0.5) * SECTOR_SIZE;
        const centerZ = (s.sz + 0.5) * SECTOR_SIZE;
        this.requestQueue.push({
          worldX: centerX,
          worldZ: centerZ,
          radiusMeters: SECTOR_SIZE / 2 + 60,
          sectorKey: s.key
        });
      }
    }

    this.processRequestQueue();
  }

  async processRequestQueue() {
    if (this.isProcessingQueue || this.requestQueue.length === 0) return;
    this.isProcessingQueue = true;

    while (this.requestQueue.length > 0) {
      const task = this.requestQueue.shift();
      await this.fetchSectorByWorld(task.worldX, task.worldZ, task.radiusMeters, task.sectorKey);
      // Polite interval between queries to protect from rate limits
      await new Promise(resolve => setTimeout(resolve, 1200));
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
      );
      out geom;
    `.trim();

    let success = false;

    for (const mirror of this.overpassMirrors) {
      try {
        const res = await fetch(mirror, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'PixelPlanet3D/1.0 (tester@pixelplanet.local)'
          },
          body: 'data=' + encodeURIComponent(query)
        });

        if (res.ok) {
          const data = await res.json();
          this.processOsmData(data);
          this.statusMessage = `OSM Онлайн: ${this.features.length} реальных зданий & объектов`;
          success = true;
          break;
        }
      } catch (err) {
        // try next mirror
      }
    }

    if (sectorKey) {
      this.activeFetches.delete(sectorKey);
      this.fetchedSectors.add(sectorKey);
      this.queuedSectors.delete(sectorKey);
    }

    if (success && this.onFeaturesLoaded) {
      this.onFeaturesLoaded();
    }
  }

  /**
   * Process raw Overpass data with geom arrays (both ways & relation multipolygons)
   */
  processOsmData(osmData) {
    if (!osmData || !osmData.elements) return;

    for (const elem of osmData.elements) {
      const tags = elem.tags || {};

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

          // Material Palette based on real OSM tags
          let blockType = BlockType.BUILDING_CONCRETE;
          const mat = (tags['building:material'] || '').toLowerCase();
          if (mat.includes('brick') || tags.building === 'house') {
            blockType = BlockType.BUILDING_BRICK;
          } else if (mat.includes('glass') || heightMeters > 38) {
            blockType = BlockType.BUILDING_GLASS;
          } else if (mat.includes('stone')) {
            blockType = BlockType.STONE;
          }

          const feature = {
            id: elem.id,
            name: tags['name:ru'] || tags.name || tags['name:en'] || null,
            address: fullAddress,
            city: city,
            levels: levels,
            height: Math.round(heightMeters),
            buildingType: tags.building !== 'yes' ? tags.building : (tags.amenity || tags.shop || tags.office || 'здание'),
            amenity: tags.amenity || tags.shop || tags.tourism || null,
            type: 'building',
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

        } else if (tags.leisure === 'park' || tags.leisure === 'garden' || tags.landuse === 'grass') {
          const feature = {
            id: elem.id,
            type: 'park',
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

    // 1. Fill ground base with sidewalk / urban pavement
    for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
      for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
        for (let y = 0; y <= groundY; y++) {
          setBlock(lx, y, lz, y === groundY ? BlockType.SIDEWALK : (y > groundY - 3 ? BlockType.DIRT : BlockType.STONE));
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
      } else if (feat.type === 'park') {
        for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
          const worldVX = startX + (lx + 0.5) * VOXEL_SIZE;
          for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
            const worldVZ = startZ + (lz + 0.5) * VOXEL_SIZE;
            if (this.pointInPolygon(worldVX, worldVZ, feat.points)) {
              hasFeatures = true;
              setBlock(lx, groundY, lz, BlockType.GRASS);
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

  /**
   * Find building/road feature at world coordinates (worldX, worldZ)
   */
  getFeatureAtPoint(worldX, worldZ) {
    const margin = 8.0;
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
        if (dist < minBuildingDist && dist < 22) {
          minBuildingDist = dist;
          targetBuilding = feat;
        }
      }
    }

    if (!targetBuilding) return null;

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

    return {
      name: targetBuilding.name || (targetBuilding.amenity ? `${targetBuilding.amenity.toUpperCase()}` : null),
      address: targetBuilding.address || (nearestStreetName ? `ок. ${nearestStreetName}` : null),
      city: targetBuilding.city,
      levels: targetBuilding.levels,
      height: targetBuilding.height,
      buildingType: targetBuilding.buildingType,
      amenity: targetBuilding.amenity
    };
  }
}
