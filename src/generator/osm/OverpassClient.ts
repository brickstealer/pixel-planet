import { OsmCache } from '../../utils/OsmCache.js';

export interface SectorFetchResult {
  success: boolean;
  fromCache: boolean;
  data?: any;
}

export class OverpassClient {
  private cache: OsmCache;
  private overpassMirrors = [
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass-api.de/api/interpreter'
  ];

  constructor(cache: OsmCache) {
    this.cache = cache;
  }

  buildQuery(south: number, west: number, north: number, east: number): string {
    return `
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
        node["natural"="peak"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
        node["natural"="volcano"](${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)});
      );
      out geom;
    `.trim();
  }

  async fetchSector(south: number, west: number, north: number, east: number): Promise<SectorFetchResult> {
    const cacheKey = `osm_v5_${south.toFixed(4)}_${west.toFixed(4)}_${north.toFixed(4)}_${east.toFixed(4)}`;

    // 1. Check local IndexedDB disk cache
    const cachedData = await this.cache.get(cacheKey);
    if (cachedData) {
      return { success: true, fromCache: true, data: cachedData };
    }

    // 2. Query network mirror if not in cache (with 7.5s timeout per mirror)
    const query = this.buildQuery(south, west, north, east);

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
          await this.cache.set(cacheKey, data);
          return { success: true, fromCache: false, data };
        }
      } catch {
        clearTimeout(timeoutId);
      }
    }

    return { success: false, fromCache: false };
  }
}
