import { BlockType } from '../../core/VoxelTypes.js';

export interface CityConfig {
  name: string;
  subtitle: string;
  lat: number;
  lon: number;
  zoomDesc: string;
  groundY: number;
  title?: string;
}

export const FAMOUS_CITIES: CityConfig[] = [
  { name: 'Манхэттен', subtitle: 'Нью-Йорк, США', lat: 40.7484, lon: -73.9857, zoomDesc: 'Empire State & Midtown Skyscrapers', groundY: 20 },
  { name: 'Гиза', subtitle: 'Египет • Пирамида Хеопса', lat: 29.9792, lon: 31.1342, zoomDesc: 'Великие пирамиды Гизы и Сфинкс', groundY: 18 },
  { name: 'Париж', subtitle: 'Франция • Эйфелева башня', lat: 48.8584, lon: 2.2945, zoomDesc: 'Champ de Mars & Haussmann Quarters', groundY: 20 },
  { name: 'Токио', subtitle: 'Япония • Сибуя', lat: 35.6595, lon: 139.7004, zoomDesc: 'Shibuya Crossing & Neon Towers', groundY: 20 },
  { name: 'Москва', subtitle: 'Россия • Красная площадь', lat: 55.7539, lon: 37.6208, zoomDesc: 'Кремлевские башни и исторический центр', groundY: 20 },
  { name: 'Лондон', subtitle: 'Великобритания • Вестминстер', lat: 51.5007, lon: -0.1246, zoomDesc: 'Big Ben, River Thames & Bridges', groundY: 20 },
  { name: 'Дубай', subtitle: 'ОАЭ • Бурдж-Халифа', lat: 25.1972, lon: 55.2744, zoomDesc: 'Downtown Mega Skyscrapers', groundY: 18 },
  { name: 'Рим', subtitle: 'Италия • Колизей', lat: 41.8902, lon: 12.4922, zoomDesc: 'Colosseum & Roman Forum Ruins', groundY: 20 },
  { name: 'Сан-Франциско', subtitle: 'США • Финансовый район', lat: 37.7891, lon: -122.4014, zoomDesc: 'Financial District & Bay Coast', groundY: 22 },
];

export interface NominatimResult {
  title: string;
  subtitle: string;
  fullName: string;
  city: string;
  lat: number;
  lon: number;
}

export interface SubwayStation {
  name: string;
  line: string | null;
  x: number;
  z: number;
}

export interface BaseFeature {
  id: number | string;
  type: string;
  bounds: [number, number, number, number]; // [minX, minZ, maxX, maxZ]
}

export interface OsmPoi extends BaseFeature {
  type: 'poi';
  name: string;
  stationName: string | null;
  ref: string | null;
  brand: string | null;
  category: string;
  isSubway: boolean;
  cuisine: string | null;
  openingHours: string | null;
  icon: string;
  x: number;
  z: number;
}

export interface OsmTree extends BaseFeature {
  type: 'tree';
  x: number;
  z: number;
  height: number;
  species: string;
  leafType: 'needleleaved' | 'broadleaved';
}

export interface OsmPeak extends BaseFeature {
  type: 'peak';
  name: string;
  ele: number;
  isVolcano: boolean;
  x: number;
  z: number;
  radius: number;
}

export interface OsmBuilding extends BaseFeature {
  type: 'building';
  name: string | null;
  address: string | null;
  city: string | null;
  levels: number;
  height: number;
  buildingType: string;
  amenity: string | null;
  isPyramid: boolean;
  isCathedral: boolean;
  isSaintBasils: boolean;
  isEiffelTower: boolean;
  isTower: boolean;
  isChimney: boolean;
  isIndustrial: boolean;
  points: [number, number][];
  blockType: BlockType;
}

export interface OsmRoad extends BaseFeature {
  type: 'road';
  name: string | null;
  points: [number, number][];
  width: number;
}

export interface OsmWater extends BaseFeature {
  type: 'water';
  name: string | null;
  waterType: string;
  isPolygon: boolean;
  isFountain?: boolean;
  width: number;
  points: [number, number][];
}

export interface OsmRailway extends BaseFeature {
  type: 'railway';
  name: string | null;
  railwayType: string;
  points: [number, number][];
  width: number;
}

export interface OsmArea extends BaseFeature {
  type: 'park' | 'forest' | 'parking';
  points: [number, number][];
}

export type OsmFeature = OsmPoi | OsmTree | OsmPeak | OsmBuilding | OsmRoad | OsmWater | OsmArea | OsmRailway;

export interface InspectedFeatureInfo {
  id?: number | string;
  name: string | null;
  address: string | null;
  city: string | null;
  levels: number;
  height: number;
  buildingType: string;
  amenity?: string | null;
  pois: any[];
}

export interface SectorInfo {
  sectorKey: string;
  sx: number;
  sz: number;
  targetLat: number;
  targetLon: number;
  status: string;
}
