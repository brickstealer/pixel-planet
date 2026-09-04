import {
  OsmFeature,
  OsmBuilding,
  OsmRoad,
  OsmPoi,
  OsmTree,
  OsmPeak,
  SubwayStation,
  InspectedFeatureInfo,
  SectorInfo
} from './OsmTypes.js';
import { GeoCoords } from './GeoCoords.js';

export class SpatialFeatureStore {
  private BUCKET_SIZE = 128;
  spatialBuckets: Map<string, OsmFeature[]> = new Map();
  features: OsmFeature[] = [];

  clear(): void {
    this.spatialBuckets.clear();
    this.features = [];
  }

  addFeature(feature: OsmFeature): void {
    if (feature.type === 'building') {
      const b = feature as OsmBuilding;
      if (b.isPyramid) {
        const [pMinX, pMinZ, pMaxX, pMaxZ] = b.bounds;
        const pad = 35;
        // Purge any existing non-pyramid buildings whose bounds overlap this pyramid sanctuary
        let purged = false;
        this.features = this.features.filter(f => {
          if (f.type === 'building' && !(f as OsmBuilding).isPyramid) {
            const [fMinX, fMinZ, fMaxX, fMaxZ] = f.bounds;
            const overlaps = (fMinX <= pMaxX + pad && fMaxX >= pMinX - pad && fMinZ <= pMaxZ + pad && fMaxZ >= pMinZ - pad);
            if (overlaps) {
              purged = true;
              return false; // Remove overlapping building in pyramid sanctuary
            }
          }
          return true;
        });
        if (purged) {
          this.rebuildSpatialBuckets();
        }
      } else if (b.isEiffelTower) {
        const [eMinX, eMinZ, eMaxX, eMaxZ] = b.bounds;
        const eCenterX = (eMinX + eMaxX) / 2;
        const eCenterZ = (eMinZ + eMaxZ) / 2;
        const sanctuaryRadius = 95; // Clear esplanade under & around 125x125m Eiffel Tower base
        let purged = false;
        this.features = this.features.filter(f => {
          if (f.type === 'building' && !(f as OsmBuilding).isEiffelTower) {
            const [fMinX, fMinZ, fMaxX, fMaxZ] = f.bounds;
            const fcX = (fMinX + fMaxX) / 2;
            const fcZ = (fMinZ + fMaxZ) / 2;
            if (Math.hypot(fcX - eCenterX, fcZ - eCenterZ) < sanctuaryRadius) {
              purged = true;
              return false; // Remove conflicting building inside Eiffel sanctuary
            }
          }
          return true;
        });
        if (purged) {
          this.rebuildSpatialBuckets();
        }
      } else {
        // If adding a regular building, check if it overlaps any known pyramid or Eiffel sanctuary
        const [minX, minZ, maxX, maxZ] = b.bounds;
        const pad = 35;
        const bcX = (minX + maxX) / 2;
        const bcZ = (minZ + maxZ) / 2;
        for (const f of this.features) {
          if (f.type === 'building') {
            const bFeat = f as OsmBuilding;
            if (bFeat.isPyramid) {
              const [pMinX, pMinZ, pMaxX, pMaxZ] = bFeat.bounds;
              const overlaps = (minX <= pMaxX + pad && maxX >= pMinX - pad && minZ <= pMaxZ + pad && maxZ >= pMinZ - pad);
              if (overlaps) {
                return; // Skip adding non-pyramid building in pyramid sanctuary!
              }
            } else if (bFeat.isEiffelTower) {
              const [eMinX, eMinZ, eMaxX, eMaxZ] = bFeat.bounds;
              const eCenterX = (eMinX + eMaxX) / 2;
              const eCenterZ = (eMinZ + eMaxZ) / 2;
              if (Math.hypot(bcX - eCenterX, bcZ - eCenterZ) < 95) {
                return; // Skip adding building inside Eiffel sanctuary!
              }
            }
          }
        }
      }
    }

    const [minX, minZ, maxX, maxZ] = feature.bounds;

    const bMinX = Math.floor(minX / this.BUCKET_SIZE);
    const bMaxX = Math.floor(maxX / this.BUCKET_SIZE);
    const bMinZ = Math.floor(minZ / this.BUCKET_SIZE);
    const bMaxZ = Math.floor(maxZ / this.BUCKET_SIZE);

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
    this.features.push(feature);
  }

  private rebuildSpatialBuckets(): void {
    this.spatialBuckets.clear();
    for (const feat of this.features) {
      const [minX, minZ, maxX, maxZ] = feat.bounds;
      const bMinX = Math.floor(minX / this.BUCKET_SIZE);
      const bMaxX = Math.floor(maxX / this.BUCKET_SIZE);
      const bMinZ = Math.floor(minZ / this.BUCKET_SIZE);
      const bMaxZ = Math.floor(maxZ / this.BUCKET_SIZE);

      for (let bx = bMinX; bx <= bMaxX; bx++) {
        for (let bz = bMinZ; bz <= bMaxZ; bz++) {
          const key = `${bx},${bz}`;
          let bucket = this.spatialBuckets.get(key);
          if (!bucket) {
            bucket = [];
            this.spatialBuckets.set(key, bucket);
          }
          bucket.push(feat);
        }
      }
    }
  }

  getFeaturesInBounds(minX: number, minZ: number, maxX: number, maxZ: number): OsmFeature[] {
    const bMinX = Math.floor(minX / this.BUCKET_SIZE);
    const bMaxX = Math.floor(maxX / this.BUCKET_SIZE);
    const bMinZ = Math.floor(minZ / this.BUCKET_SIZE);
    const bMaxZ = Math.floor(maxZ / this.BUCKET_SIZE);

    const candidates = new Set<OsmFeature>();

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

  findNearestSubwayStation(worldX: number, worldZ: number, subwayStations: SubwayStation[], maxDist: number = 450): SubwayStation | null {
    let nearest: SubwayStation | null = null;
    let minDist = Infinity;
    for (const st of subwayStations) {
      const d = Math.hypot(worldX - st.x, worldZ - st.z);
      if (d < minDist && d < maxDist) {
        minDist = d;
        nearest = st;
      }
    }
    return nearest;
  }

  /**
   * Find building/road/POI feature at world coordinates (worldX, worldZ) for HUD raycast inspection
   */
  getFeatureAtPoint(
    worldX: number,
    worldZ: number,
    subwayStations: SubwayStation[],
    isPointInLoadedSector: (x: number, z: number) => boolean,
    getSectorInfo: (x: number, z: number) => SectorInfo
  ): InspectedFeatureInfo | null {
    const margin = 12.0;
    const candidates = this.getFeaturesInBounds(worldX - margin, worldZ - margin, worldX + margin, worldZ + margin);

    // 1. Look for building containing or closest to this point
    let targetBuilding: OsmBuilding | null = null;
    let minBuildingDist = Infinity;

    for (const feat of candidates) {
      if (feat.type === 'building') {
        const b = feat as OsmBuilding;
        if (GeoCoords.pointInPolygon(worldX, worldZ, b.points)) {
          targetBuilding = b;
          minBuildingDist = 0;
          break;
        }
        // Small tolerance (up to 2.5m, ~1 voxel) for ray hits on outer wall faces
        const distToPoly = GeoCoords.distanceToPolygon(worldX, worldZ, b.points);
        if (distToPoly < minBuildingDist && distToPoly <= 2.5) {
          minBuildingDist = distToPoly;
          targetBuilding = b;
        }
      }
    }

    // 2. Find nearest named road if building has no explicit address
    let nearestStreetName: string | null = null;
    let minRoadDist = Infinity;

    for (const feat of candidates) {
      if (feat.type === 'road') {
        const r = feat as OsmRoad;
        if (r.name) {
          for (const pt of r.points) {
            const d = Math.hypot(worldX - pt[0], worldZ - pt[1]);
            if (d < minRoadDist) {
              minRoadDist = d;
              nearestStreetName = r.name;
            }
          }
        }
      }
    }

    // 3. Find POIs inside or near this building / point
    const nearbyPois: any[] = [];
    for (const feat of candidates) {
      if (feat.type === 'poi') {
        const p = feat as OsmPoi;
        const dist = Math.hypot(worldX - p.x, worldZ - p.z);
        if (dist < 32) {
          let poiTitle = p.name;

          // Resolve Metro station name for subway entrances
          if (p.isSubway) {
            let stName = p.stationName;
            if (!stName) {
              const nearestSt = this.findNearestSubwayStation(p.x, p.z, subwayStations);
              if (nearestSt) stName = nearestSt.name;
            }
            if (stName) {
              poiTitle = `${stName} (${p.ref ? `Выход №${p.ref}` : 'Вход'})`;
            }
          }

          nearbyPois.push({
            name: poiTitle,
            brand: p.brand,
            category: p.category,
            cuisine: p.cuisine,
            openingHours: p.openingHours,
            icon: p.icon,
            isSubway: p.isSubway,
            ref: p.ref,
            x: p.x,
            z: p.z
          });
        }
      }
    }

    // If no building, check if aiming at a mountain peak, standalone monument, or subway entrance
    if (!targetBuilding) {
      const nearbyPeak = candidates.find(f => f.type === 'peak' && Math.hypot(worldX - (f as OsmPeak).x, worldZ - (f as OsmPeak).z) < (f as OsmPeak).radius) as OsmPeak | undefined;
      if (nearbyPeak) {
        return {
          id: nearbyPeak.id,
          name: nearbyPeak.isVolcano ? `🌋 ${nearbyPeak.name}` : `🏔️ ${nearbyPeak.name}`,
          address: `Высота: ${nearbyPeak.ele} м над уровнем моря`,
          city: null,
          levels: 1,
          height: nearbyPeak.ele,
          buildingType: nearbyPeak.isVolcano ? 'Действующий стратовулкан' : 'Горная вершина',
          pois: []
        };
      }

      if (nearbyPois.length > 0) {
        const p = nearbyPois[0];

        // Specific handling for Subway Entrances
        if (p.isSubway || p.category === 'subway' || (p.name && p.name.toLowerCase().includes('метро'))) {
          let stationName = p.stationName;
          let line = p.brand;
          if (!stationName) {
            const nearestSt = this.findNearestSubwayStation(p.x, p.z, subwayStations);
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
      let targetTree: OsmTree | null = null;
      let minTreeDist = Infinity;
      for (const feat of candidates) {
        if (feat.type === 'tree') {
          const t = feat as OsmTree;
          const d = Math.hypot(worldX - t.x, worldZ - t.z);
          if (d < minTreeDist && d < 6.0) {
            minTreeDist = d;
            targetTree = t;
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
      if (!isPointInLoadedSector(worldX, worldZ)) {
        const info = getSectorInfo(worldX, worldZ);
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

    // Prioritize genuine building name, or address / building type.
    // Do not overwrite building title with arbitrary POIs (like fountains or generic kiosks) unless it's a prominent named institution
    const prominentPoi = nearbyPois.find(p => !p.name.includes('Заведение') && !p.name.includes('Фонтан') && (p.category === 'museum' || p.category === 'theatre' || p.category === 'university' || p.category === 'hotel' || p.category === 'hospital'));
    const title = targetBuilding.name ||
      (prominentPoi ? `${prominentPoi.icon} ${prominentPoi.name}` : null) ||
      (targetBuilding.address ? `${targetBuilding.buildingType || 'Здание'} (${targetBuilding.address})` : null) ||
      targetBuilding.buildingType ||
      'Городское здание';

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
