import { BlockType } from '../../core/VoxelTypes.js';
import {
  OsmPoi,
  OsmTree,
  OsmPeak,
  OsmBuilding,
  OsmRoad,
  OsmWater,
  OsmArea,
  OsmRailway,
  SubwayStation
} from './OsmTypes.js';
import { GeoCoords } from './GeoCoords.js';
import { SpatialFeatureStore } from './SpatialFeatureStore.js';

export class OsmParser {
  static getPoiIcon(tags: Record<string, string>): string {
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

  static getPoiCategoryName(tags: Record<string, string>): string {
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

  static parseElements(
    elements: any[],
    anchorLat: number,
    anchorLon: number,
    store: SpatialFeatureStore,
    subwayStations: SubwayStation[]
  ): void {
    const isDesert = GeoCoords.isDesertRegion(anchorLat, anchorLon);

    // Track relation member way IDs only for building multipolygons to avoid skipping valid buildings/parts
    const relationMemberWayIds = new Set<string | number>();
    for (const elem of elements) {
      if (elem.type === 'relation' && elem.tags && elem.tags.type === 'multipolygon' && (elem.tags.building || elem.tags['building:part'])) {
        if (elem.members) {
          for (const m of elem.members) {
            if (m.role === 'outer' && m.type === 'way' && m.ref) {
              relationMemberWayIds.add(m.ref);
            }
          }
        }
      }
    }

    for (const elem of elements) {
      const tags = elem.tags || {};

      // If this way is already part of a building multipolygon and lacks unique attributes, skip duplicate outline
      if (elem.type === 'way' && relationMemberWayIds.has(elem.id)) {
        const hasUniqueLandmark = tags.historic || tags.tourism || tags.amenity || tags['name:ru'] || tags.name || tags['building:levels'] || tags.height;
        if (!hasUniqueLandmark) {
          continue;
        }
      }

      // 1. Process Standalone Point of Interest (POI) nodes
      if (elem.type === 'node') {
        const isSubway = tags.railway === 'subway_entrance' ||
          tags.station === 'subway' ||
          tags.subway === 'yes' ||
          (tags.railway === 'station' && tags.station === 'subway');
        const isRailway = tags.railway === 'station';

        if (tags.amenity || tags.shop || tags.tourism || tags.historic || tags.cuisine || isSubway || isRailway) {
          const [mx, mz] = GeoCoords.latLonToWorld(elem.lat, elem.lon, anchorLat, anchorLon);

          // Register station center for entrance lookup
          if (tags.station === 'subway' || (tags.railway === 'station' && (tags.subway === 'yes' || tags.station === 'subway'))) {
            const sName = tags['name:ru'] || tags.name || tags['name:en'] || null;
            if (sName) {
              subwayStations.push({
                name: sName,
                line: tags.line || tags.network || tags.operator || null,
                x: mx,
                z: mz
              });
            }
          }

          let icon = '📍';
          let category = tags.amenity || tags.shop || tags.tourism || tags.historic || 'poi';
          const isPlaque = tags.memorial === 'plaque' || tags.historic === 'memorial_plaque';
          if (isSubway) {
            icon = '🚇';
            category = 'subway';
          } else if (tags.amenity === 'cafe') icon = '☕';
          else if (tags.amenity === 'restaurant') icon = '🍴';
          else if (tags.amenity === 'fast_food') icon = '🍔';
          else if (tags.amenity === 'bar' || tags.amenity === 'pub') icon = '🍸';
          else if (tags.amenity === 'pharmacy') icon = '💊';
          else if (tags.amenity === 'bank' || tags.amenity === 'atm') icon = '💳';
          else if (tags.shop === 'supermarket' || tags.shop === 'convenience') icon = '🛒';
          else if (tags.shop === 'clothes') icon = '👗';
          else if (tags.tourism === 'hotel') icon = '🏨';
          else if (isPlaque) {
            icon = '📜';
            category = 'plaque';
          } else if (tags.historic === 'monument' || tags.historic === 'memorial') {
            icon = '🗿';
            category = 'monument';
          } else if (tags.amenity === 'fountain') {
            icon = '⛲';
            category = 'fountain';
          } else if (tags.tourism === 'viewpoint') icon = '🔭';

          let defaultName = 'Заведение';
          if (isSubway) defaultName = 'Вход в метро';
          else if (isPlaque) defaultName = 'Мемориальная доска';
          else if (tags.historic === 'monument') defaultName = 'Памятник';
          else if (tags.amenity === 'fountain') defaultName = 'Фонтан';

          const poiName = tags['name:ru'] || tags.name || tags['name:en'] || defaultName;
          const poiFeat: OsmPoi = {
            id: elem.id,
            type: 'poi',
            name: poiName,
            stationName: tags['name:ru'] || tags.name || tags['name:en'] || null,
            ref: tags.ref || null,
            brand: tags.brand || tags.operator || null,
            category: category,
            isSubway: isSubway,
            cuisine: tags.cuisine || null,
            openingHours: tags.opening_hours || null,
            icon: icon,
            x: mx,
            z: mz,
            bounds: [mx - 2, mz - 2, mx + 2, mz + 2]
          };

          store.addFeature(poiFeat);
        }

        // 1.1 Process Standalone Trees (natural=tree)
        if (tags.natural === 'tree') {
          const [mx, mz] = GeoCoords.latLonToWorld(elem.lat, elem.lon, anchorLat, anchorLon);
          const parsedH = parseFloat(tags.height);
          const heightMeters = (!isNaN(parsedH) && parsedH > 0) ? parsedH : 6.5;
          const species = tags['species:ru'] || tags.species || tags['genus:ru'] || tags.genus || 'Городское дерево';
          const isConifer = tags.leaf_type === 'needleleaved' || (tags.species && tags.species.toLowerCase().includes('pinus'));

          const treeFeat: OsmTree = {
            id: elem.id,
            type: 'tree',
            x: mx,
            z: mz,
            height: heightMeters,
            species: species,
            leafType: isConifer ? 'needleleaved' : 'broadleaved',
            bounds: [mx - 4, mz - 4, mx + 4, mz + 4]
          };

          store.addFeature(treeFeat);
        }

        // 1.2 Process Mountain Peaks & Volcanoes (natural=peak, natural=volcano)
        if (tags.natural === 'peak' || tags.natural === 'volcano' || tags.volcano === 'yes') {
          const [mx, mz] = GeoCoords.latLonToWorld(elem.lat, elem.lon, anchorLat, anchorLon);
          const parsedEle = parseFloat(tags.ele);
          const eleMeters = (!isNaN(parsedEle) && parsedEle > 50) ? parsedEle : 1200;
          const peakName = tags['name:ru'] || tags.name || tags['name:en'] || (tags.natural === 'volcano' ? 'Вулкан' : 'Горная вершина');
          const isVolcano = tags.natural === 'volcano' || tags.volcano === 'yes' || peakName.toLowerCase().includes('везувий') || peakName.toLowerCase().includes('вулкан');
          const radiusMeters = Math.min(2600, Math.max(700, eleMeters * 0.35));

          const peakFeat: OsmPeak = {
            id: elem.id,
            type: 'peak',
            name: peakName,
            ele: Math.round(eleMeters),
            isVolcano: isVolcano,
            x: mx,
            z: mz,
            radius: radiusMeters,
            bounds: [mx - radiusMeters, mz - radiusMeters, mx + radiusMeters, mz + radiusMeters]
          };

          store.addFeature(peakFeat);
        }
        continue;
      }

      // Gather outer and part geometry rings for both ways and relations
      const geometryList: { lat: number; lon: number }[][] = [];
      if (elem.type === 'way' && elem.geometry && elem.geometry.length >= 2) {
        geometryList.push(elem.geometry);
      } else if (elem.type === 'relation' && elem.members) {
        for (const m of elem.members) {
          if ((m.role === 'outer' || m.role === 'part') && m.geometry && m.geometry.length >= 2) {
            geometryList.push(m.geometry);
          }
        }
      }

      if (geometryList.length === 0) continue;

      for (const geom of geometryList) {
        const pts: [number, number][] = [];
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        let sumLat = 0, sumLon = 0;

        for (const pt of geom) {
          sumLat += pt.lat;
          sumLon += pt.lon;
          const [mx, mz] = GeoCoords.latLonToWorld(pt.lat, pt.lon, anchorLat, anchorLon);
          pts.push([mx, mz]);
          if (mx < minX) minX = mx;
          if (mx > maxX) maxX = mx;
          if (mz < minZ) minZ = mz;
          if (mz > maxZ) maxZ = mz;
        }

        const centerLat = sumLat / (geom.length || 1);
        const centerLon = sumLon / (geom.length || 1);

        // Deduplicate closing point
        if (pts.length > 3 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) {
          pts.pop();
        }

        if (tags.building || tags['building:part']) {
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

          const street = tags['addr:street'] || tags['addr:street:ru'] || tags['addr:street:en'] || null;
          const houseNumber = tags['addr:housenumber'] || null;
          const city = tags['addr:city'] || null;
          let fullAddress: string | null = null;
          if (street && houseNumber) fullAddress = `${street}, ${houseNumber}`;
          else if (street) fullAddress = street;
          else if (houseNumber) fullAddress = `д. ${houseNumber}`;

          const nameLower = (tags['name:ru'] || tags.name || tags['name:en'] || '').toLowerCase();
          const isPyramid = tags.historic === 'pyramid' ||
            tags.man_made === 'pyramid' ||
            tags.building === 'pyramid' ||
            tags['building:part'] === 'pyramid' ||
            tags.archaeological_site === 'pyramid' ||
            tags.tomb === 'pyramid' ||
            tags['building:shape'] === 'pyramid' ||
            tags['roof:shape'] === 'pyramid' ||
            tags.ruins === 'pyramid' ||
            nameLower.includes('пирамида') ||
            nameLower.includes('pyramid') ||
            nameLower.includes('хеопс') ||
            nameLower.includes('хефрен') ||
            nameLower.includes('микерин') ||
            nameLower.includes('джосер') ||
            nameLower.includes('саккара') ||
            nameLower.includes('cheops') ||
            nameLower.includes('khufu') ||
            nameLower.includes('khafre') ||
            nameLower.includes('menkaure') ||
            nameLower.includes('djoser');

          const isRuins = !isPyramid && (
            tags.building === 'ruins' ||
            tags.historic === 'ruins' ||
            tags.historic === 'archaeological_site' ||
            tags.historic === 'tomb'
          );

          if (isPyramid) {
            if (!tags.height || heightMeters <= 15) {
              if (nameLower.includes('хеопс') || nameLower.includes('cheops') || nameLower.includes('khufu')) {
                heightMeters = 139;
              } else if (nameLower.includes('хефрен') || nameLower.includes('khafre')) {
                heightMeters = 136;
              } else if (nameLower.includes('микерин') || nameLower.includes('menkaure')) {
                heightMeters = 65;
              } else if (nameLower.includes('джосер') || nameLower.includes('djoser')) {
                heightMeters = 62;
              } else {
                const halfBase = Math.max(minX !== Infinity ? (maxX - minX) / 2 : 45, minZ !== Infinity ? (maxZ - minZ) / 2 : 45);
                heightMeters = Math.max(45, Math.round(halfBase * 1.25));
              }
            }
          } else if (isRuins) {
            // Ancient ruins & archaeological excavation sites: low weathered stone remnants
            heightMeters = Math.min(5, tags.height ? parseFloat(tags.height) : 3.5);
            levels = 1;
          } else if (isDesert || (centerLat > 29.96 && centerLat < 30.01 && centerLon > 31.11 && centerLon < 31.16)) {
            // Near Giza archaeological plateau / desert towns: realistic low rise (max 12m, 1-3 floors)
            heightMeters = Math.min(12, heightMeters);
            levels = Math.min(3, Math.max(1, Math.round(heightMeters / 3.6)));
          }

          const isSaintBasils = nameLower.includes('василия блаженного') ||
            nameLower.includes('покровский собор') ||
            (tags['addr:street'] && tags['addr:street'].includes('Красная') && tags['addr:housenumber'] === '2');

          const isCathedral = isSaintBasils ||
            tags.amenity === 'place_of_worship' ||
            tags.building === 'cathedral' ||
            tags.building === 'church' ||
            tags.building === 'chapel' ||
            tags.building === 'temple' ||
            tags.building === 'mosque' ||
            tags.building === 'monastery' ||
            tags.historic === 'monastery' ||
            tags.historic === 'church' ||
            nameLower.includes('собор') ||
            nameLower.includes('храм') ||
            nameLower.includes('церковь') ||
            nameLower.includes('cathedral') ||
            nameLower.includes('basilica') ||
            nameLower.includes('church');

          const isCommercialOrLiving = tags.building === 'hotel' ||
            tags.building === 'apartments' ||
            tags.building === 'residential' ||
            tags.tourism === 'hotel' ||
            tags.amenity === 'restaurant' ||
            tags.amenity === 'cafe' ||
            tags.shop != null ||
            nameLower.includes('campanile') ||
            nameLower.includes('hotel') ||
            nameLower.includes('hôtel') ||
            nameLower.includes('mercure') ||
            nameLower.includes('bistro') ||
            nameLower.includes('pharmacie') ||
            nameLower.includes('résidence');

          const distFromParisEiffel = Math.hypot((centerLat - 48.85837) * 110540, (centerLon - 2.29448) * 73000);
          const isParisEiffelArea = distFromParisEiffel < 200;

          const isEiffelWikidata = tags.wikidata === 'Q243';
          const isEiffelWiki = tags.wikipedia === 'fr:Tour Eiffel' || tags.wikipedia === 'en:Eiffel Tower' || tags.wikipedia === 'ru:Эйфелева башня';

          const isSubComponent = tags['building:part'] === 'yes' ||
            tags['building'] === 'pavilion' ||
            nameLower.includes('étage') ||
            nameLower.includes('etage') ||
            nameLower.includes('pavillon') ||
            nameLower.includes('plateforme') ||
            nameLower.includes('sommet') ||
            nameLower.includes('pilier') ||
            nameLower.includes('société') ||
            nameLower.includes('societe');

          const isRealParisEiffelMaster = (isEiffelWikidata || isEiffelWiki || (isParisEiffelArea && tags.man_made === 'tower' && !isSubComponent && elem.type === 'way')) && !isCommercialOrLiving;

          const isEiffelNameExact = (nameLower === 'tour eiffel' ||
            nameLower === 'la tour eiffel' ||
            nameLower === 'eiffel tower' ||
            nameLower === 'эйфелева башня') && !isSubComponent;

          const isEiffelTower = isRealParisEiffelMaster || (isEiffelNameExact && tags.man_made === 'tower' && tags['building:part'] !== 'yes');

          const isTower = isEiffelTower ||
            (!isCommercialOrLiving && (tags.man_made === 'tower' ||
              tags['tower:type'] === 'lattice' ||
              tags['tower:type'] === 'communication' ||
              tags['tower:type'] === 'observation' ||
              tags.building === 'tower'));

          let blockType = BlockType.BUILDING_CONCRETE;
          const mat = (tags['building:material'] || '').toLowerCase();
          if (isPyramid) {
            blockType = BlockType.SAND;
          } else if (isRuins) {
            blockType = BlockType.SAND;
          } else if (isSaintBasils) {
            blockType = BlockType.BUILDING_BRICK;
          } else if (isCathedral) {
            blockType = (mat.includes('brick') || mat.includes('red')) ? BlockType.BUILDING_BRICK : BlockType.BUILDING_CONCRETE;
          } else if (isEiffelTower || isTower) {
            blockType = BlockType.METAL;
          } else if (mat.includes('brick') || tags.building === 'house') {
            blockType = BlockType.BUILDING_BRICK;
          } else if ((mat.includes('glass') || (heightMeters > 38 && !isDesert)) && !isTower) {
            blockType = BlockType.BUILDING_GLASS;
          } else if (mat.includes('stone') || isDesert) {
            blockType = BlockType.SAND;
          }

          const isChimney = tags.man_made === 'chimney' || tags.building === 'chimney';
          const isIndustrial = isChimney || isRuins ||
            tags.building === 'industrial' ||
            tags.building === 'warehouse' ||
            tags.building === 'hangar' ||
            tags.building === 'garage' ||
            tags.building === 'silo' ||
            tags.man_made === 'silo' ||
            tags.man_made === 'storage_tank';

          let buildingName = tags['name:ru'] || tags.name || tags['name:en'] || null;
          if (!buildingName && tags.wikipedia) {
            const match = tags.wikipedia.match(/^ru:(.+)$/);
            if (match) {
              try {
                buildingName = decodeURIComponent(match[1].replace(/_/g, ' '));
              } catch {
                buildingName = match[1].replace(/_/g, ' ');
              }
            }
          }

          let displayBuildingType = 'здание';
          const rawType = tags.building !== 'yes' ? tags.building : (tags.amenity || tags.shop || tags.office || 'здание');
          if (rawType === 'apartments' || rawType === 'residential') displayBuildingType = 'Жилой дом';
          else if (rawType === 'university' || rawType === 'college') displayBuildingType = 'Университетский корпус';
          else if (rawType === 'school') displayBuildingType = 'Школа / Гимназия';
          else if (rawType === 'civic' || rawType === 'public') displayBuildingType = 'Общественное / административное здание';
          else if (rawType === 'hospital' || rawType === 'clinic') displayBuildingType = 'Медицинский корпус';
          else if (rawType === 'commercial' || rawType === 'office') displayBuildingType = 'Офисно-деловой центр';
          else if (rawType === 'hotel') displayBuildingType = 'Отель / Гостиница';
          else if (rawType !== 'yes') displayBuildingType = rawType;

          const feature: OsmBuilding = {
            id: elem.id,
            name: buildingName,
            address: fullAddress,
            city: city,
            levels: (isEiffelTower || isTower || isPyramid || isCathedral || isChimney || isRuins) ? (isRuins ? 1 : 2) : levels,
            height: isEiffelTower ? 330 : Math.round(heightMeters),
            buildingType: isPyramid ? 'Древняя пирамида' : (isRuins ? 'Археологические руины' : (isSaintBasils ? 'Храм Василия Блаженного (Покровский собор)' : (isEiffelTower ? 'Эйфелева башня (ажурная металлическая башня)' : (isCathedral ? 'Православный собор / храм' : (isTower ? 'Теле-/радиобашня' : (isChimney ? 'Промышленная дымовая труба' : displayBuildingType)))))),
            amenity: tags.amenity || tags.shop || tags.tourism || null,
            type: 'building',
            isPyramid,
            isCathedral,
            isSaintBasils,
            isEiffelTower,
            isTower,
            isChimney,
            isIndustrial,
            points: pts,
            blockType,
            bounds: [minX, minZ, maxX, maxZ]
          };

          store.addFeature(feature);

        } else if (tags.highway) {
          let width = 4;
          if (tags.highway === 'primary' || tags.highway === 'motorway' || tags.highway === 'trunk') width = 8;
          else if (tags.highway === 'secondary' || tags.highway === 'tertiary') width = 6;
          else if (tags.highway === 'pedestrian' || tags.highway === 'footway' || tags.highway === 'path') width = 3;

          const feature: OsmRoad = {
            id: elem.id,
            name: tags['name:ru'] || tags.name || tags['name:en'] || null,
            type: 'road',
            points: pts,
            width: width,
            bounds: [minX, minZ, maxX, maxZ]
          };

          store.addFeature(feature);

        } else if (tags.waterway || tags.natural === 'water' || tags.water || tags.amenity === 'fountain') {
          // Identify architectural fountains & decorative reflecting pools
          const isFountain = tags.amenity === 'fountain' ||
            tags.water === 'fountain' ||
            tags.water === 'reflecting_pool' ||
            tags.waterway === 'fountain' ||
            tags.fountain === 'yes';

          // Skip underground rivers / culverts (e.g. Neglinnaya in Moscow, Fleet in London, Bièvre in Paris)
          const isUndergroundWater = !isFountain && (
            tags.tunnel === 'yes' ||
            tags.tunnel === 'culvert' ||
            tags.location === 'underground' ||
            tags.covered === 'yes' ||
            (tags.layer && parseInt(tags.layer, 10) < 0) ||
            (tags.name && tags.name.toLowerCase().includes('неглинн'))
          );

          if (isUndergroundWater) {
            continue;
          }

          let defaultFountainName: string | null = null;
          if (isFountain) {
            defaultFountainName = tags.tourism === 'attraction' ? 'Фонтан-достопримечательность' : 'Фонтанный комплекс';
          }

          const waterName = tags['name:ru'] || tags.name || tags['name:en'] || defaultFountainName;
          let waterType = 'Водный объект';
          if (isFountain) {
            waterType = tags.tourism === 'attraction' ? 'Фонтан-достопримечательность' : 'Городской фонтан';
          } else if (tags.waterway === 'river') waterType = 'Судоходная река';
          else if (tags.waterway === 'canal') waterType = 'Судоходный канал';
          else if (tags.waterway === 'stream' || tags.waterway === 'brook') waterType = 'Ручей / Речка';
          else if (tags.water === 'lake' || tags.natural === 'water') waterType = 'Озеро';
          else if (tags.water === 'pond') waterType = 'Городской пруд';
          else if (tags.water === 'reservoir') waterType = 'Водохранилище';
          else if (tags.natural === 'bay' || tags.water === 'bay') waterType = 'Морской залив / Бухта';
          else if (tags.waterway) waterType = 'Река / Канал';

          // Critical check: is this a closed polygon (lake/pond/riverbank area/fountain basin) or an open river centerline?
          const isClosed = pts.length >= 4 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 6.0;
          const isPolygon = isClosed && (tags.natural === 'water' || tags.water || tags.waterway === 'riverbank' || tags.landuse === 'basin' || isFountain);

          let riverWidth = 45;
          if (tags.width) {
            const parsedW = parseFloat(tags.width);
            if (!isNaN(parsedW) && parsedW > 0) riverWidth = parsedW;
          } else if (tags.waterway === 'river') {
            riverWidth = 55;
          } else if (tags.waterway === 'canal') {
            riverWidth = 25;
          } else if (tags.waterway === 'stream' || tags.waterway === 'brook') {
            riverWidth = 6;
          }

          const feature: OsmWater = {
            id: elem.id,
            type: 'water',
            name: waterName,
            waterType: waterType,
            isPolygon,
            isFountain,
            width: riverWidth,
            points: pts,
            bounds: [minX, minZ, maxX, maxZ]
          };
          store.addFeature(feature);

        } else if (tags.railway && (tags.railway === 'rail' || tags.railway === 'tram' || tags.railway === 'light_rail' || tags.railway === 'subway' || tags.railway === 'narrow_gauge')) {
          // Skip underground subway tunnels
          const isUndergroundRail = tags.tunnel === 'yes' ||
            tags.tunnel === 'culvert' ||
            tags.location === 'underground' ||
            (tags.layer && parseInt(tags.layer, 10) < 0) ||
            (tags.railway === 'subway' && tags.cutting !== 'yes' && tags.bridge !== 'yes');

          if (isUndergroundRail) {
            continue;
          }

          let width = 4.0;
          if (tags.railway === 'tram') width = 2.5;
          else if (tags.railway === 'narrow_gauge') width = 3.0;

          const rName = tags['name:ru'] || tags.name || tags['name:en'] || tags.ref || null;
          const feature: OsmRailway = {
            id: elem.id,
            name: rName,
            type: 'railway',
            railwayType: tags.railway,
            points: pts,
            width: width,
            bounds: [minX, minZ, maxX, maxZ]
          };

          store.addFeature(feature);

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
              const treeFeat: OsmTree = {
                id: `${elem.id}_row_${i}_${s}`,
                type: 'tree',
                x: tx,
                z: tz,
                height: 7,
                species: tags['species:ru'] || tags.species || 'Аллея деревьев',
                leafType: tags.leaf_type || 'broadleaved',
                bounds: [tx - 4, tz - 4, tx + 4, tz + 4]
              };
              store.addFeature(treeFeat);
            }
          }

        } else if (tags.leisure === 'park' || tags.leisure === 'garden' || tags.landuse === 'grass' || tags.natural === 'wood' || tags.landuse === 'forest') {
          const isForest = (tags.natural === 'wood' || tags.landuse === 'forest');
          const feature: OsmArea = {
            id: elem.id,
            type: isForest ? 'forest' : 'park',
            points: pts,
            bounds: [minX, minZ, maxX, maxZ]
          };
          store.addFeature(feature);

        } else if (tags.amenity === 'parking') {
          const feature: OsmArea = {
            id: elem.id,
            type: 'parking',
            points: pts,
            bounds: [minX, minZ, maxX, maxZ]
          };
          store.addFeature(feature);
        }
      }
    }
  }
}
